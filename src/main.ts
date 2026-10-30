import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './theme.css';
import './style.css';
import './comet-diagram.css';
import { applyCometLayout } from './comet-layout';
import { createThemeController } from './theme';
import { Workbench, basename, pathKey, type SourceDocument, type SimulatorTab } from './workbench';
import { SourceEditor } from './editor';
import { createSimulatorRenderer, simulatorMarkup, hex } from './simulator';
import { WorkbenchView } from './workbench-view';
import { tabKey, parseTab, type TabKey } from './tab-layout';
import { scopedMarkup } from './scoped-view';
import { layout } from './layout';
import { editDevices } from './devices';
import { editPreferences } from './preferences';
import { examples } from './examples';
import { AutoSave, recentFiles } from './file-features';
import { workbenchShortcut } from './shortcuts';
import type { Diagnostic, OpenedSource, Row, Settings, Snapshot, StepMode } from './types';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = layout();
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const desktop = isTauri();
const wb = new Workbench();
const editors = new Map<string, SourceEditor>();
const simulationViews = new Map<string, { root: HTMLElement; render: ReturnType<typeof createSimulatorRenderer> }>();
let settings: Settings = { version: 1, theme: 'dark', base: 32, fill: 65535, interval_ms: 100, step_mode: 'instruction', binary_registers: false, signed_decimal: true, auto_save: false, recent_files: [], comet_view: false, memory_start: 32, devices: { input_path: null, output_path: null } };
const themeController = createThemeController(document.documentElement, window.matchMedia('(prefers-color-scheme: dark)'));
async function applyTheme() {
  themeController.setPreference(settings.theme);
  if (desktop && settings.theme === 'system') {
    const theme = await getCurrentWindow().theme();
    if (theme) themeController.setSystemTheme(theme);
  }
}
let settingsPath = '', settingsReady = false, ioBusy = false, closing = false, outputOpen = false;
let focusedGroup: 'source' | 'simulator' = 'source';
let settingsQueue = Promise.resolve();
let lastTitle = '';
let lastFocusedTab: TabKey | null = null;
const autoSave = new AutoSave(async id => {
  const doc = wb.source(id);
  if (!desktop || !settings.auto_save || !doc?.path || doc.source === doc.saved) return false;
  if (ioBusy || closing || document.querySelector('dialog[open]') || editors.get(id)?.composing) return true;
  await withIo(async () => {
    try { await saveDocument(doc); } catch (error) { showError(error, doc); }
  });
  return false;
});
function scheduleAutoSave(doc: SourceDocument) {
  if (settings.auto_save && doc.path && doc.source !== doc.saved) autoSave.schedule(doc.id);
  else autoSave.cancel(doc.id);
}
function rememberFiles(paths: string[]) {
  settings = { ...settings, recent_files: recentFiles(settings.recent_files, paths) };
  persistSettings(null);
}
async function toggleAutoSave() {
  await settingsQueue;
  const next = { ...settings, auto_save: !settings.auto_save };
  await invoke('set_settings', { settings: next });
  settings = next; autoSave.cancelAll();
  if (settings.auto_save) for (const doc of wb.documents.values()) scheduleAutoSave(doc);
  message(`自動保存を${settings.auto_save ? '有効' : '無効'}にしました。${settings.auto_save ? '保存先のあるCASファイルを編集後1秒で保存します。' : ''}`);
}

function message(text: string, error = false) { $('message').textContent = text; $('message').title = text; $('message').classList.toggle('error', error); }
function showError(error: unknown, doc: SourceDocument | null = wb.source()) {
  const items: Diagnostic[] = Array.isArray(error) ? error : [{ line: 0, code: 0, message: String(error) }];
  if (doc) { doc.diagnostics = items; doc.buildMessage = ''; outputOpen = true; }
  message(`${doc ? `${doc.name}: ` : ''}${items[0]?.message ?? 'エラー'}`, true); renderSource();
}
async function withIo(work: () => Promise<unknown>) {
  if (ioBusy || closing || document.querySelector('dialog[open]')) return;
  ioBusy = true; render();
  try { await work(); } catch (error) { showError(error); }
  finally { ioBusy = false; render(); }
}
function syncBackend() {
  if (!desktop) return Promise.resolve();
  return invoke<void>('sync_workspace', { paths: wb.protectedSources().flatMap(doc => doc.path ? [doc.path] : []), projectPaths: wb.project?.path ? [wb.project.path] : [] });
}
function ensureEditor(doc: SourceDocument) {
  let editor = editors.get(doc.id);
  if (!editor) {
    editor = new SourceEditor(doc, () => { invalidateChanged(); scheduleAutoSave(doc); render(); }, updatePosition);
    editors.set(doc.id, editor);
  }
  return editor;
}
function focusGroup(index: number) {
  const group = wb.layout.groups[index]; if (group?.active) selectTab(group.active, true);
}
function moveToNeighbor(direction: number) {
  const key = wb.layout.current(); if (!key) return;
  const index = wb.layout.groups.findIndex(group => group.id === wb.layout.focused);
  const target = wb.layout.groups[index + direction];
  if (target) wb.layout.move(key, target.id, target.tabs.length);
  else wb.layout.split(key, wb.layout.focused, direction < 0 ? 'left' : 'right');
  render(); view.focusTab(key);
}
function ensureSimulationView(id: string): HTMLElement {
  const existing = simulationViews.get(id); if (existing) return existing.root;
  const root = document.createElement('div'); root.className = 'simulation-buffer';
  root.innerHTML = scopedMarkup('<div class="sim-document-actions"><button id="sim-source" title="対応するソースを開く">対応するソースを開く</button></div>' + simulatorMarkup(), id);
  applyCometLayout(root.querySelector<SVGSVGElement>('.datapath')!);
  const el = <T extends HTMLElement = HTMLElement>(name: string) => root.querySelector(`[data-view="${name}"]`) as T;
  for (const path of root.querySelectorAll('.bus-lines path')) path.setAttribute('marker-end', `url(#${id}-bus-arrow)`);
  const sim = () => wb.simulation(id);
  for (const name of ['run', 'step', 'stop', 'back', 'reset', 'devices']) el(name).onclick = () => { selectSimulator(id); action(name); };
  el('sim-source').onclick = () => selectSource(id, true);
  el('sim-rebuild').onclick = () => buildPreview(id);
  el('binary-registers').onchange = () => { const current = sim(); if (current) { current.binaryRegisters = el<HTMLInputElement>('binary-registers').checked; persistSettings(current); renderSim(); } };
  el('speed').onchange = () => { const current = sim(); if (current) { current.interval = Number(el<HTMLSelectElement>('speed').value); persistSettings(current); } };
  for (const [name, value] of [['view-program', false], ['view-comet', true]] as const) el(name).onclick = () => { const current = sim(); if (current) { current.cometView = value; persistSettings(current); renderSim(); } };
  el('step-mode').onchange = async () => { const current = sim(); if (!current) return; const mode = el<HTMLSelectElement>('step-mode').value as StepMode; if (mode !== 'instruction') current.cometView = true; await control(current, 'mode', { mode }); persistSettings(current); renderSim(); };
  el('memory-address').onchange = () => { const current = sim(), value = el<HTMLInputElement>('memory-address').value; if (!current) return; if (!/^[0-9a-fA-F]{1,4}$/.test(value) || parseInt(value, 16) >= 3000) { message('メモリ番地は0000〜0BB7で指定してください。', true); return; } current.memoryStart = parseInt(value, 16); persistSettings(current); renderSim(); };
  el('comet-follow').onclick = () => {
    const current = sim(); if (!current) return;
    const start = parseInt(el<HTMLInputElement>('comet-memory-address').value,16);
    if (current.cometFollow && Number.isFinite(start)) current.memoryStart = start;
    current.cometFollow = !current.cometFollow; persistSettings(current); renderSim();
  };
  el('comet-memory-address').onchange = () => {
    const current = sim(), value = el<HTMLInputElement>('comet-memory-address').value;
    if (!current) return;
    if (!/^[0-9a-fA-F]{1,4}$/.test(value) || parseInt(value,16) >= 3000) { message('メモリ番地は0000〜0BB7で指定してください。',true); return; }
    current.memoryStart = parseInt(value,16); current.cometFollow = false; persistSettings(current); renderSim();
  };
  el('stack-follow').onclick = () => { const current = sim(); if (current) { current.stackStart = current.stackStart === null ? parseInt(el<HTMLInputElement>('stack-address').value, 16) : null; current.stackScrollTop = 0; renderSim(); } };
  el('stack-address').onchange = () => { const current = sim(), value = el<HTMLInputElement>('stack-address').value; if (!current) return; if (!/^[0-9a-fA-F]{1,4}$/.test(value) || parseInt(value, 16) >= 3000) { message('スタック番地は0000〜0BB7で指定してください。', true); return; } current.stackStart = parseInt(value, 16); current.stackScrollTop = 0; renderSim(); };
  el('input-text').oninput = () => { const current = sim(); if (current) current.inputText = el<HTMLInputElement>('input-text').value; };
  el('input-form').onsubmit = async event => { event.preventDefault(); const current = sim(); if (current) { await control(current, 'input', { text: current.inputText }); if (current.snapshot?.replay_target != null) run(current, true); } };
  el('eof').onclick = async () => { const current = sim(); if (current) { await control(current, 'input', { text: null }); if (current.snapshot?.replay_target != null) run(current, true); } };
  simulationViews.set(id, { root, render: createSimulatorRenderer(root) }); return root;
}
function selectSource(id: string, focus = false) {
  const doc = wb.source(id); if (!doc) return;
  if (!wb.editorTabs.includes(id)) wb.editorTabs.push(id);
  wb.layout.open(tabKey('source', id)); ensureEditor(doc); selectTab(tabKey('source', id), focus);
}
function selectSimulator(id: string, focus = false) {
  if (wb.simulators.has(id)) selectTab(tabKey('simulator', id), focus);
}
function stop(sim: SimulatorTab | null) { if (!sim) return; sim.running = false; sim.epoch++; renderTabs(); renderSim(); }
function stopAll() { for (const sim of wb.simulators.values()) stop(sim); }
function invalidateChanged() { for (const sim of wb.simulators.values()) if (wb.stale(sim, settings)) stop(sim); }
const view = new WorkbenchView($('editor-groups'), wb, {
  editor: ensureEditor, simulator: ensureSimulationView,
  renderSimulator: id => { const sim = wb.simulation(id); if (sim) simulationViews.get(id)!.render(sim, wb.stale(sim, settings), ioBusy, row => revealRow(sim, row), wb.layout.current() === tabKey('simulator', id), settings.signed_decimal); },
  select: selectTab, focus: adoptFocus,
  close: key => withIo(() => parseTab(key).kind === 'source' ? closeDocument(parseTab(key).id) : closeSimulator(parseTab(key).id)),
  build: buildPreview, action, changed: () => { render(); const key = wb.layout.current(); if (key) view.focusTab(key); },
  blocked: () => ioBusy || closing || !!document.querySelector('dialog[open]'),
});
function adoptFocus(key: TabKey | null) {
  if (key) {
    const { kind, id } = parseTab(key); focusedGroup = kind;
    if (kind === 'source') { wb.activeSource = id; if (wb.simulation(id)) wb.activeSimulator = id; }
    else { wb.activeSimulator = id; wb.activeSource = id; }
  }
  updateTitle(); updatePosition(); view.updateFocus();
  if (lastFocusedTab !== key) { lastFocusedTab = key; renderSidebar(); renderDiagnostics(); }
}
function selectTab(key: TabKey, focus = false) {
  wb.layout.focus(key); adoptFocus(key); render(); if (focus) view.focusTab(key);
}
function renderTabs() { view.renderTabs(settings); }
function renderSidebar() {
  $('open-editors').replaceChildren(...wb.editorTabs.map(id => {
    const doc = wb.source(id)!, button = document.createElement('button'); button.className = `tree-file ${id === wb.activeSource ? 'active' : ''}`;
    const icon = document.createElement('span'); icon.className = 'tree-file-icon'; icon.textContent = 'Ⅱ';
    const label = document.createElement('span'); label.textContent = doc.name;
    const dirty = document.createElement('span'); dirty.className = 'tree-dirty'; dirty.textContent = doc.source !== doc.saved ? '●' : '';
    button.append(icon, label, dirty); button.title = doc.path ?? '未保存'; button.onclick = () => selectSource(id, true); return button;
  }));
  const project = wb.project;
  $('project-name').textContent = project ? `${project.path ? basename(project.path) : '新規cmk'}${project.dirty ? ' ●' : ''}` : 'cmkは開かれていません';
  $('project-name').title = project?.path ?? '';
  $('project-tree').replaceChildren(...(project?.fileIds ?? []).map((id, i) => {
    const doc = wb.source(id)!, button = document.createElement('button'); button.className = 'tree-file';
    const icon = document.createElement('span'); icon.className = 'tree-file-icon'; icon.textContent = i === 0 ? '★' : 'Ⅱ';
    const label = document.createElement('span'); label.textContent = doc.name;
    button.append(icon, label); button.title = `${doc.path ?? '未保存'}${i === 0 ? '\nメインファイル' : ''}`; button.onclick = () => selectSource(id, true); return button;
  }));
}
function renderSource() { view.render(settings, ioBusy || !settingsReady, desktop); renderDiagnostics(); updatePosition(); }
function renderDiagnostics() {
  const markers = new Map<string, Diagnostic[]>();
  for (const owner of wb.documents.values()) for (const item of owner.diagnostics) {
    const id = item.file ?? owner.id;
    const list = markers.get(id) ?? []; list.push(item); markers.set(id, list);
  }
  for (const [id, editor] of editors) editor.setDiagnostics(markers.get(id) ?? []);
  const doc = wb.source(); $('diagnostics-panel').hidden = !outputOpen;
  const diagnostics = $('diagnostics'); diagnostics.replaceChildren();
  if (doc?.diagnostics.length) {
    for (const item of doc.diagnostics) {
      const p = document.createElement('button'); p.className = 'diagnostic error';
      const source = item.file ? wb.source(item.file) : doc;
      p.textContent = `${source?.name ?? item.file ?? doc.name}${item.line ? `:${item.line}` : ''}  ${item.message}`;
      p.onclick = () => { if (source) { selectSource(source.id, true); if (item.line) editors.get(source.id)!.reveal(item.line, 0); } }; diagnostics.append(p);
    }
  } else diagnostics.textContent = doc?.buildMessage ?? 'ソースを開いてアセンブルしてください。';
  $('diagnostic-count').textContent = doc?.diagnostics.length ? `${doc.diagnostics.length}件のエラー` : '';
}
function renderSim() { view.renderSimulators(); }
function render() {
  adoptFocus(wb.layout.current()); view.render(settings, ioBusy || !settingsReady, desktop);
  renderSidebar(); renderDiagnostics(); updatePosition(); updateTitle();
}
function updateTitle() {
  const doc = focusedGroup === 'simulator' ? wb.source(wb.activeSimulator) : wb.source();
  const title = `${doc ? `${doc.source !== doc.saved ? '● ' : ''}${doc.name} — ` : ''}xCASL2`;
  if (desktop && title !== lastTitle) { lastTitle = title; getCurrentWindow().setTitle(title).catch(() => {}); }
}
function updatePosition() {
  const doc = wb.source(), position = doc ? editors.get(doc.id)?.position() : null;
  $('cursor-position').textContent = position ? `行 ${position.lineNumber}、列 ${position.column}` : '';
}
function revealRow(sim: SimulatorTab, row: Row) {
  const id = row.file && wb.documents.has(row.file) ? row.file : sim.id;
  selectSource(id, true); editors.get(id)!.reveal(row.line, row.source.length);
}

async function buildPreview(id = wb.activeSource) {
  if (!id || !desktop) return;
  await withIo(async () => {
    const doc = wb.source(id); if (!doc) return;
    let sim = wb.simulation(id); stop(sim); if (sim) await sim.pending;
    const inputs = wb.sourcesFor(id), key = wb.key(id, settings), mode = sim?.mode ?? settings.step_mode;
    if (sim) { sim.snapshot = null; sim.previous = null; sim.buildKey = null; }
    doc.diagnostics = []; doc.buildMessage = 'アセンブル中…'; outputOpen = true; render();
    try {
      const next = await invoke<Snapshot>('build', { id, sources: inputs.map(input => ({ file: input.id, path: input.path, source: input.source })), base: settings.base, fill: settings.fill, mode });
      sim = wb.ensureSimulator(id, settings); sim.snapshot = next; sim.previous = null; sim.buildKey = key;
      sim.sourceIds = inputs.map(input => input.id); sim.sourceFiles = new Map(inputs.map(input => [input.id, input.name]));
      doc.buildMessage = `アセンブル・リンク成功。${next.program_end - settings.base}語 / 開始番地 #${hex(next.entry)} / 初期SP #${hex(next.cpu.sp)}${inputs.length > 1 ? ` / ${inputs.length}ファイルをリンク` : ''}`;
      adoptFocus(wb.layout.current()); message(`${doc.name} のシミュレーターを右に開きました。`);
    } catch (error) { showError(error, doc); }
    await syncBackend();
  });
  const selected = wb.layout.current();
  if (selected === tabKey('simulator', id)) view.focusTab(selected);
}
async function control(sim: SimulatorTab, action: string, extra: Record<string, unknown> = {}) {
  if (sim.busy || wb.simulators.get(sim.id) !== sim || wb.stale(sim, settings) || !sim.snapshot) return;
  sim.busy = true; renderSim();
  const pending = (async () => {
    try {
      const next = await invoke<Snapshot>('control', { id: sim.id, action, ...extra });
      if (wb.simulators.get(sim.id) !== sim) return;
      sim.previous = sim.snapshot; sim.snapshot = next; sim.mode = next.step_mode;
      if (action === 'input') sim.inputText = '';
      if (next.status !== 'ready') {
        sim.running = false;
        if (wb.activeSimulator === sim.id) message(`${wb.source(sim.id)?.name}: ${next.error ?? (next.status === 'halted' ? '正常終了しました。' : 'キーボード入力を待っています。')}`, next.status === 'fault');
      }
    } catch (error) { stop(sim); showError(error, wb.source(sim.id)); }
    finally { sim.busy = false; renderTabs(); renderSim(); }
  })();
  sim.pending = pending; await pending;
}
async function run(sim: SimulatorTab | null, replay = false) {
  if (!sim || sim.running || sim.busy || wb.stale(sim, settings) || sim.snapshot?.status !== 'ready') return;
  sim.running = true; const epoch = ++sim.epoch; renderTabs(); renderSim();
  while (sim.running && sim.epoch === epoch && wb.simulators.get(sim.id) === sim && !wb.stale(sim, settings) && sim.snapshot?.status === 'ready') {
    if (replay && sim.snapshot.replay_target === null) break;
    await control(sim, 'run', { count: replay ? 1 : sim.interval === 0 ? 200 : 1 });
    if (!sim.running || sim.epoch !== epoch) break;
    await new Promise(resolve => setTimeout(resolve, replay ? 0 : sim.interval || 16));
  }
  if (sim.epoch === epoch) { sim.running = false; renderTabs(); renderSim(); }
}
async function stepBack() {
  const sim = wb.simulation(); if (!sim || sim.running || ioBusy) return;
  await control(sim, 'back'); if (sim.snapshot?.replay_target != null) run(sim, true);
}
async function closeSimulator(id: string) {
  const sim = wb.simulation(id); if (!sim) return;
  stop(sim); await sim.pending; if (desktop) await invoke('discard_session', { id });
  wb.closeSimulator(id); simulationViews.get(id)?.root.remove(); simulationViews.delete(id); wb.prune().forEach(id => { editors.get(id)?.dispose(); editors.delete(id); });
  await syncBackend(); render();
}
async function confirm(title: string, text: string): Promise<string> {
  const dialog = $<HTMLDialogElement>('confirm-dialog'); $('confirm-title').textContent = title; $('confirm-message').textContent = text;
  return new Promise(resolve => { dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true }); dialog.returnValue = 'cancel'; dialog.showModal(); });
}
async function saveDocument(doc: SourceDocument, saveAs = false): Promise<boolean> {
  autoSave.cancel(doc.id);
  const source = doc.source;
  const path = await invoke<string | null>('save_source', { source, previousPath: doc.path, saveAs });
  if (!path) return false;
  const changedPath = !doc.path || pathKey(doc.path) !== pathKey(path);
  doc.path = path; doc.name = basename(path); doc.saved = source;
  rememberFiles([path]); scheduleAutoSave(doc);
  if (changedPath && wb.project?.fileIds.includes(doc.id)) wb.project.dirty = true;
  invalidateChanged(); await syncBackend(); render(); message(`${doc.name} をCP932 / CRLFで保存しました。`); return true;
}
async function confirmDocument(doc: SourceDocument): Promise<boolean> {
  if (doc.source === doc.saved) return true;
  const answer = await confirm('変更を保存しますか？', `${doc.name} に保存されていない変更があります。`);
  if (answer === 'save') return saveDocument(doc);
  if (answer !== 'discard') return false;
  doc.source = doc.saved;
  autoSave.cancel(doc.id);
  editors.get(doc.id)?.replaceSource(doc.source);
  invalidateChanged(); return true;
}
async function closeDocument(id: string) {
  const doc = wb.source(id); if (!doc || !await confirmDocument(doc)) return;
  autoSave.cancel(id);
  await closeSimulator(id); wb.closeSource(id); editors.get(id)?.dispose(); editors.delete(id);
  wb.prune(); await syncBackend(); render();
}
async function saveProject(saveAs = false): Promise<boolean> {
  const project = wb.project; if (!project) { message('先にcmkを開くか、作成してください。'); return false; }
  for (const id of project.fileIds) { const doc = wb.source(id)!; if (!doc.path && !await saveDocument(doc)) return false; }
  const path = await invoke<string | null>('save_project', { files: project.fileIds.map(id => ({ path: wb.source(id)!.path!, name: wb.source(id)!.name })), previousPath: project.path, saveAs });
  if (!path) return false;
  project.path = path; project.dirty = false; await syncBackend(); render(); message('cmkを保存しました。ソースの本文は各casへ保存してください。'); return true;
}
async function confirmProject(): Promise<boolean> {
  if (!wb.project?.dirty) return true;
  const answer = await confirm('cmkの変更を保存しますか？', `${wb.project.path ? basename(wb.project.path) : '新規cmk'} の登録・メイン指定に未保存の変更があります。`);
  if (answer === 'save') return saveProject(); return answer === 'discard';
}
async function openSources(addToProject = false) {
  const files = await invoke<OpenedSource[] | null>('open_sources'); if (!files) return;
  if (addToProject && !wb.project) wb.project = { path: null, fileIds: [], dirty: true };
  if (addToProject) {
    const keys = new Set(wb.project!.fileIds.map(id => { const doc = wb.source(id)!; return doc.path ? pathKey(doc.path) : doc.id; }));
    for (const file of files) keys.add(pathKey(file.path));
    if (keys.size > 20) throw 'cmkには20ファイルまで登録できます。';
  }
  for (const file of files) {
    const doc = wb.open(file); ensureEditor(doc);
    if (addToProject && !wb.project!.fileIds.includes(doc.id)) { wb.project!.fileIds.push(doc.id); wb.project!.dirty = true; }
  }
  invalidateChanged(); await syncBackend(); selectSource(wb.activeSource!, true);
  rememberFiles(files.map(file => file.path));
}
async function openRecent(path: string) {
  const existing = [...wb.documents.values()].find(doc => doc.path && pathKey(doc.path) === pathKey(path));
  if (existing) { selectSource(existing.id, true); rememberFiles([existing.path!]); return; }
  const file = await invoke<OpenedSource>('open_recent', { path });
  const doc = wb.open(file); ensureEditor(doc); await syncBackend(); selectSource(doc.id, true); rememberFiles([file.path]);
}
async function openProject() {
  if (!await confirmProject()) return;
  const project = await invoke<{ path: string; files: OpenedSource[] } | null>('open_project'); if (!project) return;
  const ids = project.files.map(file => { const doc = wb.open(file); ensureEditor(doc); return doc.id; });
  wb.project = { path: project.path, fileIds: [...new Set(ids)], dirty: false };
  invalidateChanged(); await syncBackend(); if (ids.length) selectSource(ids[0], true); else render();
  message(`${basename(project.path)} を開きました。${ids.length}ファイル / ★がメインです。`);
  rememberFiles(project.files.map(file => file.path));
}
async function changeProject(action: string) {
  if (action === 'project-new') {
    if (!await confirmProject()) return;
    if (wb.editorTabs.length > 20) throw 'cmkには20ファイルまで登録できます。';
    wb.project = { path: null, fileIds: [...wb.editorTabs], dirty: true };
  } else if (action === 'project-close') {
    if (!await confirmProject()) return; wb.project = null;
  } else {
    const project = wb.project, id = wb.activeSource;
    if (!project || !id || !project.fileIds.includes(id)) { message('プロジェクトに登録されたソースを選択してください。'); return; }
    project.fileIds = project.fileIds.filter(other => other !== id);
    if (action === 'project-main') project.fileIds.unshift(id);
    project.dirty = true;
  }
  invalidateChanged(); await syncBackend(); render();
}
function persistSettings(sim: SimulatorTab | null = wb.simulation()) {
  if (!desktop || !settingsReady) return;
  if (sim) settings = { ...settings, step_mode: sim.mode, comet_view: sim.cometView, binary_registers: sim.binaryRegisters, memory_start: sim.memoryStart, interval_ms: sim.interval };
  const next = { ...settings };
  settingsQueue = settingsQueue.then(() => invoke<void>('set_settings', { settings: next })).catch(error => showError(error));
}
async function preferences() {
  await settingsQueue;
  const sim = wb.simulation();
  const next = await editPreferences({ ...settings, interval_ms: sim?.interval ?? settings.interval_ms }, settingsPath); if (!next) return;
  if (sim) sim.interval = next.interval_ms;
  settings = next; await applyTheme(); invalidateChanged(); render(); message('設定を保存しました。テーマと符号表示は即時反映し、配置・初期化の変更は再アセンブルで反映します。');
}
async function devices() {
  const sim = wb.simulation(); if (sim?.running || sim?.busy) return;
  const update = await editDevices(sim?.snapshot ? sim.id : null, sim ? wb.source(sim.id)!.name : '');
  if (update) {
    settings.devices = update.config;
    if (sim && update.snapshot) { sim.previous = null; sim.snapshot = update.snapshot; sim.inputText = ''; }
    render(); message('対象タブの入出力装置を設定しました。ファイルは最初のIN／OUTで開きます。');
  }
}
async function closeAllTabs() {
  stopAll(); await Promise.all([...wb.simulators.values()].map(sim => sim.pending));
  for (const id of wb.editorTabs) if (!await confirmDocument(wb.source(id)!)) return;
  for (const id of [...wb.simulators.keys()]) await closeSimulator(id);
  for (const id of [...wb.editorTabs]) { wb.closeSource(id); editors.get(id)?.dispose(); editors.delete(id); }
  wb.prune(); await syncBackend(); render();
}
async function attemptClose() {
  if (closing || ioBusy || document.querySelector('dialog[open]')) return;
  closing = true; stopAll();
  try {
    await Promise.all([...wb.simulators.values()].map(sim => sim.pending));
    for (const doc of wb.documents.values()) if (!await confirmDocument(doc)) return;
    if (!await confirmProject()) return;
    await settingsQueue; await invoke('close_devices'); await getCurrentWindow().destroy();
  } catch (error) { showError(error); } finally { closing = false; }
}
function newDocument(source = 'MAIN     START\n         RET\n         END\n', name?: string) {
  const doc = wb.create(source, name); ensureEditor(doc); selectSource(doc.id, true); return doc;
}
function toggleSidebar() { const sidebar = $('sidebar'); sidebar.hidden = !sidebar.hidden; $('activity-explorer').classList.toggle('selected', !sidebar.hidden); $('activity-explorer').setAttribute('aria-expanded', String(!sidebar.hidden)); }
function editCommand(command: 'undo' | 'redo') {
  const active = document.activeElement;
  const source = editors.get(wb.activeSource ?? '');
  if (source && (source.hasTextFocus() || focusedGroup === 'source' && !(active instanceof HTMLInputElement) && !(active instanceof HTMLTextAreaElement))) { source.editCommand(command); return; }
  const editor = active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement ? active : null;
  if (editor) { editor.focus(); document.execCommand(command); }
}

async function action(name: string) {
  if (document.querySelector('dialog[open]')) return;
  if (name === 'stop') { stop(wb.simulation()); return; }
  if (name === 'quit') { await attemptClose(); return; }
  if (ioBusy || closing || !settingsReady) return;
  if (name.startsWith('recent:')) { await withIo(() => openRecent(name.slice(7))); return; }
  switch (name) {
    case 'new': newDocument(); break;
    case 'open': await withIo(() => openSources()); break;
    case 'auto-save': await withIo(toggleAutoSave); break;
    case 'recent-clear': settings = { ...settings, recent_files: [] }; persistSettings(null); message('最近使用したファイルの履歴を消去しました。'); break;
    case 'save': { const doc = focusedGroup === 'simulator' ? wb.source(wb.activeSimulator) : wb.source(); if (doc) await withIo(() => saveDocument(doc)); } break;
    case 'save-as': { const doc = focusedGroup === 'simulator' ? wb.source(wb.activeSimulator) : wb.source(); if (doc) await withIo(() => saveDocument(doc, true)); } break;
    case 'save-all': await withIo(async () => { for (const doc of wb.documents.values()) if ((!doc.path && wb.editorTabs.includes(doc.id)) || doc.source !== doc.saved) if (!await saveDocument(doc)) return; if (wb.project?.dirty) await saveProject(); }); break;
    case 'close-tab': if (focusedGroup === 'simulator' && wb.activeSimulator) await withIo(() => closeSimulator(wb.activeSimulator!)); else if (wb.activeSource) await withIo(() => closeDocument(wb.activeSource!)); break;
    case 'close-all': await withIo(closeAllTabs); break;
    case 'preview': await buildPreview(focusedGroup === 'simulator' ? wb.activeSimulator : wb.activeSource); break;
    case 'run': run(wb.simulation()); break;
    case 'step': if (wb.simulation() && !wb.simulation()!.running) await control(wb.simulation()!, 'step'); break;
    case 'back': await stepBack(); break;
    case 'reset': if (wb.simulation() && !wb.simulation()!.running) await control(wb.simulation()!, 'reset'); break;
    case 'devices': await withIo(devices); break;
    case 'settings': await withIo(preferences); break;
    case 'sidebar': toggleSidebar(); break;
    case 'output-panel': outputOpen = !outputOpen; renderSource(); break;
    case 'focus-source': focusGroup(0); break;
    case 'focus-simulator': focusGroup(1); break;
    case 'split-right': { const key = wb.layout.current(); if (key) { wb.layout.split(key, wb.layout.focused, 'right'); render(); view.focusTab(key); } } break;
    case 'join-groups': wb.layout.join(); render(); if (wb.layout.current()) view.focusTab(wb.layout.current()!); break;
    case 'move-left': case 'move-right': moveToNeighbor(name === 'move-left' ? -1 : 1); break;
    case 'undo': case 'redo': editCommand(name); break;
    case 'find': case 'replace': case 'command-palette':
      if (wb.source()) { selectSource(wb.activeSource!, true); const source = editors.get(wb.activeSource!)!; if (name === 'command-palette') source.commandPalette(); else source.find(name === 'replace'); } break;
    case 'project-open': await withIo(openProject); break;
    case 'project-new': case 'project-main': case 'project-remove': case 'project-close': await withIo(() => changeProject(name)); break;
    case 'project-add': await withIo(() => openSources(true)); break;
    case 'project-save': await withIo(() => saveProject()); break;
    case 'project-save-as': await withIo(() => saveProject(true)); break;
    case 'project-build': if (wb.project?.fileIds[0]) { selectSource(wb.project.fileIds[0]); await buildPreview(wb.project.fileIds[0]); } break;
    case 'about': $<HTMLDialogElement>('about-dialog').showModal(); break;
    default: if (name.startsWith('sample-') && examples[name.slice(7)]) newDocument(examples[name.slice(7)], `${name.slice(7)}.cas`);
  }
}

$('activity-explorer').onclick = toggleSidebar; $('status-sidebar').onclick = toggleSidebar;
$('activity-settings').onclick = () => action('settings'); $('sidebar-new').onclick = () => action('new'); $('sidebar-project-open').onclick = () => action('project-open');
$('diagnostics-close').onclick = () => { outputOpen = false; renderSource(); };
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-action]')) button.onclick = () => action(button.dataset.action!);

document.addEventListener('keydown', event => {
  if (document.querySelector('dialog[open]') || event.isComposing) return;
  const reserve = () => { event.preventDefault(); event.stopPropagation(); };
  if (event.ctrlKey && event.key === 'Tab') {
    reserve(); const group = wb.layout.group(), index = group.tabs.indexOf(group.active!);
    const key = group.tabs[(index + (event.shiftKey ? -1 : 1) + group.tabs.length) % group.tabs.length];
    if (key) selectTab(key, true); return;
  }
  if (event.ctrlKey && event.key === '\\') { reserve(); action('split-right'); return; }
  if (event.ctrlKey && !event.altKey && /^[3-9]$/.test(event.key)) { reserve(); focusGroup(Number(event.key) - 1); return; }
  if (event.ctrlKey && event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { reserve(); action(event.key === 'ArrowLeft' ? 'move-left' : 'move-right'); return; }
  if (event.ctrlKey && event.shiftKey && event.key === 'Enter') { reserve(); buildPreview(); return; }
  if (event.key === 'F5') { reserve(); action(event.shiftKey ? 'stop' : 'preview'); return; }
  if (event.key === 'F6' || event.key === 'F10') { reserve(); action(event.key === 'F6' ? 'run' : 'step'); return; }
  if (event.ctrlKey && event.key.toLowerCase() === 'q') { reserve(); action('stop'); return; }
  // Native menu accelerators do not reach every WebView focus path on Windows.
  // Monaco handles its editing keys; reserve workbench file/group commands here.
  const command = workbenchShortcut(event);
  if (command) { reserve(); action(command); return; }
  const editing = event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement;
  if (focusedGroup === 'simulator' && !editing && !ioBusy) {
    if (event.key === 'Enter') { reserve(); action('step'); }
    if (event.key === 'Backspace') { reserve(); action('back'); }
  }
}, true);
async function initialize() {
  if (!desktop) { settingsReady = true; $('connection').textContent = 'ブラウザプレビュー'; message('実行・ファイル操作はTauriデスクトップ版で利用できます。'); render(); return; }
  ioBusy = true; render();
  try {
    await listen<string>('menu-action', event => {
      action(event.payload).catch(error => showError(error)).finally(() => {
        if (event.payload === 'auto-save') invoke('refresh_file_menu').catch(error => showError(error));
      });
    });
    await getCurrentWindow().onCloseRequested(event => { event.preventDefault(); attemptClose(); });
    await getCurrentWindow().onThemeChanged(event => { themeController.setSystemTheme(event.payload); });
    const info = await invoke<{ settings: Settings; path: string; warning: string | null }>('get_settings');
    settings = info.settings; settingsPath = info.path; settingsReady = true;
    await applyTheme();
    if (info.warning) message(info.warning, true);
    await syncBackend();
  } catch (error) { showError(error); }
  finally { ioBusy = false; render(); }
}
render(); initialize();
