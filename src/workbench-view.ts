import { parseTab, tabKey, type EditorGroup, type TabKey, type PreviewPlacement } from './tab-layout';
import { basename, type Workbench, type SourceDocument } from './workbench';
import type { Settings } from './types';
import type { SourceEditor } from './editor';
import { assembleIcon, assembleInGroupIcon } from './ui-icons';

interface Callbacks {
  editor(doc: SourceDocument): SourceEditor;
  simulator(id: string): HTMLElement;
  renderSimulator(id: string, root: HTMLElement): void;
  select(key: TabKey, focus?: boolean): void;
  focus(key: TabKey | null): void;
  close(key: TabKey): void;
  build(id: string, placement: PreviewPlacement): void;
  comment(id: string): void;
  source(id: string): void;
  action(name: string): void;
  changed(): void;
  blocked(): boolean;
}
interface GroupView { root: HTMLElement; strip: HTMLElement; breadcrumb: HTMLElement; split: HTMLButtonElement; preview: HTMLButtonElement; comment: HTMLButtonElement; source: HTMLButtonElement; buffers: HTMLElement; welcome: HTMLElement }
interface DropTarget { group: string; index: number; side?: 'left' | 'right' }
const splitIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16"/><path d="M12 4v16"/></svg>';
const previewIcon = assembleIcon;
const sourceIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16"/><path d="M12 4v16m-3-11-3 3 3 3"/></svg>';
const commentIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v12H9l-5 4zM8 8h8m-8 4h5"/></svg>';

export class WorkbenchView {
  private alternatePreview = false;
  private groups = new Map<string, GroupView>();
  private tabs = new Map<TabKey, HTMLElement>();
  private separators = new Map<string, HTMLElement>();
  private drag: { key: TabKey; x: number; y: number; pointer: number; started: boolean; target?: DropTarget } | null = null;
  private ghost = document.createElement('div');
  private overlay = document.createElement('div');
  constructor(private host: HTMLElement, private wb: Workbench, private callbacks: Callbacks) {
    this.ghost.className = 'tab-drag-ghost'; this.ghost.hidden = true;
    this.overlay.className = 'tab-drop-overlay'; this.overlay.hidden = true;
    document.body.append(this.ghost, this.overlay);
    host.addEventListener('pointermove', event => this.dragMove(event));
    host.addEventListener('pointerup', event => this.dragEnd(event));
    host.addEventListener('pointercancel', () => this.cancelDrag());
    host.addEventListener('lostpointercapture', () => this.cancelDrag());
    window.addEventListener('blur', () => this.cancelDrag());
    document.addEventListener('keydown', event => { if (event.key === 'Escape') this.cancelDrag(); }, true);
    const modifierChanged = (event: KeyboardEvent | PointerEvent) => this.setAlternatePreview(event.altKey && !event.ctrlKey && !event.metaKey);
    document.addEventListener('keydown', modifierChanged, true);
    document.addEventListener('keyup', modifierChanged, true);
    host.addEventListener('pointermove', modifierChanged);
    window.addEventListener('blur', () => this.setAlternatePreview(false));
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.setAlternatePreview(false); });
  }
  private setAlternatePreview(alternate: boolean) {
    if (this.alternatePreview === alternate) return;
    this.alternatePreview = alternate;
    for (const group of this.groups.values()) this.updatePreviewButton(group.preview);
  }
  private updatePreviewButton(button: HTMLButtonElement) {
    const label = this.alternatePreview ? 'アセンブルしてシミュレーターを開く' : 'アセンブルしてシミュレーターを横に表示';
    button.dataset.tooltip = this.alternatePreview ? `${label} (Alt+F5)` : `${label} (F5)\n[Alt] アセンブルしてシミュレーターを開く (Alt+F5)`;
    button.setAttribute('aria-label', label);
    button.innerHTML = this.alternatePreview ? assembleInGroupIcon : previewIcon;
  }
  render(settings: Settings, blocked: boolean, canBuild = true) {
    const activeElement = document.activeElement;
    const ordered: HTMLElement[] = [];
    // Keep each file's Monaco instance and model while hiding inactive buffers.
    for (const [id, view] of this.groups) {
      const active = this.wb.layout.group(id)?.active;
      for (const child of view.buffers.children) (child as HTMLElement).hidden = (child as HTMLElement).dataset.bufferKey !== active;
    }
    for (const [index, group] of this.wb.layout.groups.entries()) {
      let view = this.groups.get(group.id);
      if (!view) { view = this.makeGroup(group); this.groups.set(group.id, view); }
      if (index > 0) ordered.push(this.placeSeparator(this.wb.layout.groups[index - 1], group));
      ordered.push(view.root);
      view.root.style.flexGrow = String(100 * group.weight / this.wb.layout.groups.reduce((sum, item) => sum + item.weight, 0));
      view.root.setAttribute('aria-label', `エディターグループ ${index + 1}`);
      const tab = group.active ? parseTab(group.active) : null, doc = tab ? this.wb.source(tab.id) : null;
      view.root.classList.toggle('simulator-group', tab?.kind === 'simulator');
      view.breadcrumb.textContent = doc ? `${doc.name}${tab?.kind === 'simulator' ? ' › シミュレーター' : ''}` : 'xCASL2';
      view.breadcrumb.dataset.tooltip = doc?.path ?? '';
      view.preview.hidden = tab?.kind !== 'source'; view.preview.disabled = blocked || !canBuild;
      view.comment.hidden = tab?.kind !== 'source'; view.comment.disabled = blocked || !canBuild;
      view.source.hidden = tab?.kind !== 'simulator'; view.source.disabled = blocked;
      view.split.disabled = !group.active || blocked;
      view.welcome.hidden = !!tab;
      view.buffers.hidden = !tab;
      if (tab && doc) {
        const buffer = tab.kind === 'source' ? this.callbacks.editor(doc).root : this.callbacks.simulator(tab.id);
        buffer.dataset.bufferKey = group.active!;
        if (buffer.parentElement !== view.buffers) view.buffers.append(buffer);
        buffer.hidden = false;
        if (tab.kind === 'source') this.callbacks.editor(doc).render();
      }
    }
    for (const [index, node] of ordered.entries()) if (this.host.children[index] !== node) this.host.insertBefore(node, this.host.children[index] ?? null);
    // Remove empty groups only after their buffers have been reparented.
    for (const [id, view] of this.groups) if (!this.wb.layout.groups.some(group => group.id === id)) { view.root.remove(); this.groups.delete(id); }
    const boundaries = new Set(this.wb.layout.groups.slice(1).map((group, i) => `${this.wb.layout.groups[i].id}/${group.id}`));
    for (const [key, separator] of this.separators) if (!boundaries.has(key)) { separator.remove(); this.separators.delete(key); }
    this.renderTabs(settings); this.updateFocus();
    // Moving the same DOM node can blur its input; restore focus without
    // changing its selection, scroll offsets, value, or undo stack.
    if (activeElement instanceof HTMLElement && activeElement !== document.activeElement && activeElement.isConnected && activeElement.closest('.editor-buffer:not([hidden]), .simulation-buffer:not([hidden])')) activeElement.focus({ preventScroll: true });
    this.renderSimulators();
  }
  renderTabs(settings: Settings) {
    const open = new Set(this.wb.layout.groups.flatMap(group => group.tabs));
    for (const [key, node] of this.tabs) if (!open.has(key)) { node.remove(); this.tabs.delete(key); }
    for (const group of this.wb.layout.groups) {
      const strip = this.groups.get(group.id)?.strip; if (!strip) continue;
      for (const [index, key] of group.tabs.entries()) {
        const { kind, id } = parseTab(key), doc = this.wb.source(id)!;
        let node = this.tabs.get(key);
        if (!node) {
          node = document.createElement('div'); node.className = 'workbench-tab'; node.dataset.tabKey = key;
          const select = document.createElement('button'); select.type = 'button'; select.className = 'tab-select'; select.setAttribute('role', 'tab');
          select.innerHTML = `<span class="tab-icon">${kind === 'source' ? 'Ⅱ' : '▷'}</span><span class="tab-title"></span><span class="tab-description"></span><span class="tab-state" aria-hidden="true"></span>`;
          select.onclick = event => { if (this.suppressClick) { event.preventDefault(); return; } this.callbacks.select(key); };
          select.onpointerdown = event => this.dragStart(event, key);
          const close = document.createElement('button'); close.type = 'button'; close.className = 'tab-close'; close.textContent = '×'; close.tabIndex = -1;
          close.onclick = () => this.callbacks.close(key);
          node.append(select, close); this.tabs.set(key, node);
          node.addEventListener('auxclick', event => { if (event.button === 1) { event.preventDefault(); this.callbacks.close(key); } });
        }
        if (strip.children[index] !== node) strip.insertBefore(node, strip.children[index] ?? null);
        const button = node.querySelector<HTMLButtonElement>('[role=tab]')!, sim = this.wb.simulation(id), dirty = doc.source !== doc.saved;
        node.classList.toggle('active', group.active === key); node.classList.toggle('source-tab', kind === 'source'); node.classList.toggle('sim-tab', kind === 'simulator');
        node.classList.toggle('dirty', kind === 'source' && dirty); node.classList.toggle('running', kind === 'simulator' && !!sim?.running);
        node.classList.toggle('waiting', kind === 'simulator' && sim?.snapshot?.status === 'waiting_input'); node.classList.toggle('stale', kind === 'simulator' && !!sim && this.wb.stale(sim, settings));
        button.setAttribute('aria-selected', String(group.active === key)); button.tabIndex = group.active === key ? 0 : -1;
        button.setAttribute('aria-label', `${doc.name}${kind === 'simulator' ? ' のシミュレーター' : dirty ? '、未保存' : ''}`);
        button.dataset.tooltip = `${doc.path ?? doc.name}${kind === 'simulator' ? '\nシミュレーター' : ''}\nドラッグで並べ替え・グループ移動。端へドロップで左右に分割。`;
        node.querySelector('.tab-title')!.textContent = doc.name;
        const duplicate = group.tabs.some(other => other !== key && this.wb.source(parseTab(other).id)?.name === doc.name && parseTab(other).kind === kind);
        node.querySelector('.tab-description')!.textContent = kind === 'simulator' ? 'シミュレーター' : duplicate && doc.path ? basename(doc.path.replace(/\\/g, '/').split('/').slice(0, -1).join('/')) : '';
        node.querySelector('.tab-close')!.setAttribute('aria-label', `${doc.name}${kind === 'simulator' ? ' のシミュレーター' : ''}を閉じる`);
      }
    }
  }
  renderSimulators() {
    for (const group of this.wb.layout.groups) if (group.active) {
      const { kind, id } = parseTab(group.active);
      if (kind === 'simulator') this.callbacks.renderSimulator(id, this.callbacks.simulator(id));
    }
  }
  updateFocus() { for (const [id, view] of this.groups) view.root.classList.toggle('focused', this.wb.layout.focused === id); }
  focusTab(key: TabKey) {
    const { kind, id } = parseTab(key);
    if (kind === 'source') this.callbacks.editor(this.wb.source(id)!).focus();
    else this.tabs.get(key)?.querySelector<HTMLButtonElement>('[role=tab]')?.focus({ preventScroll: true });
    this.groups.get(this.wb.layout.focused)?.root.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }
  private makeGroup(group: EditorGroup): GroupView {
    const root = document.createElement('section'); root.className = 'editor-group'; root.dataset.groupId = group.id;
    root.innerHTML = `<div class="group-titlebar"><div class="tab-strip" role="tablist" aria-label="ファイルとシミュレーターのタブ"></div><div class="group-actions" role="toolbar" aria-label="エディターの操作"><button class="icon-button split-source" data-tooltip="タブを右に分割して移動 (Ctrl+\\)" aria-label="タブを右に分割して移動">${splitIcon}</button><button class="icon-button source-preview" data-tooltip="アセンブルしてシミュレーターを右に開く (F5)" aria-label="アセンブルしてシミュレーターを右に開く">${previewIcon}</button><button class="icon-button show-source" data-tooltip="対応するソースを開く" aria-label="対応するソースを開く">${sourceIcon}</button></div></div><div class="group-breadcrumb"><span></span></div><div class="editor-buffers"></div><div class="welcome"><div class="welcome-logo">x<span>CASL2</span></div><p>CASL II ワークスペース</p><div class="welcome-actions"><button data-action="new">新しいファイル<span>Ctrl+N</span></button><button data-action="open">ファイルを開く…<span>Ctrl+O</span></button><button data-action="sample-hello">Hello, CASL II を開く<span>サンプル</span></button><button data-action="sample-sum">1〜10の合計を開く<span>サンプル</span></button></div><p class="welcome-note">タブを端へドラッグすると左右に並べられます。</p></div>`;
    const comment = document.createElement('button'); comment.className = 'icon-button source-comment'; comment.type = 'button';
    comment.dataset.tooltip = '命令に沿った定型コメントを追加 (Ctrl+Shift+C)'; comment.setAttribute('aria-label', '自動コメント'); comment.innerHTML = commentIcon;
    root.querySelector('.group-actions')!.insertBefore(comment, root.querySelector('.source-preview'));
    const view: GroupView = { root, strip: root.querySelector('.tab-strip')!, breadcrumb: root.querySelector('.group-breadcrumb>span')!, split: root.querySelector('.split-source')!, preview: root.querySelector('.source-preview')!, comment, source: root.querySelector('.show-source')!, buffers: root.querySelector('.editor-buffers')!, welcome: root.querySelector('.welcome')! };
    this.updatePreviewButton(view.preview);
    const focused = () => { this.wb.layout.focused = group.id; this.callbacks.focus(group.active); this.updateFocus(); };
    root.addEventListener('focusin', focused);
    view.preview.onclick = event => { focused(); if (group.active) this.callbacks.build(parseTab(group.active).id, event.altKey && !event.ctrlKey && !event.metaKey ? 'same-group' : 'beside'); };
    view.comment.onclick = () => { focused(); if (group.active) this.callbacks.comment(parseTab(group.active).id); };
    view.source.onclick = () => { focused(); if (group.active) this.callbacks.source(parseTab(group.active).id); };
    view.split.onclick = () => { if (group.active) { this.wb.layout.split(group.active, group.id, 'right'); this.callbacks.changed(); } };
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-action]')) button.onclick = () => { focused(); this.callbacks.action(button.dataset.action!); };
    view.strip.addEventListener('keydown', event => {
      let index = group.tabs.indexOf(group.active!);
      if (event.key === 'ArrowLeft') index = (index - 1 + group.tabs.length) % group.tabs.length;
      else if (event.key === 'ArrowRight') index = (index + 1) % group.tabs.length;
      else if (event.key === 'Home') index = 0; else if (event.key === 'End') index = group.tabs.length - 1; else return;
      event.preventDefault(); if (group.tabs[index]) { this.callbacks.select(group.tabs[index]); this.tabs.get(group.tabs[index])?.querySelector<HTMLButtonElement>('[role=tab]')?.focus(); }
    });
    return view;
  }
  private placeSeparator(left: EditorGroup, right: EditorGroup) {
    const key = `${left.id}/${right.id}`; let separator = this.separators.get(key);
    if (!separator) {
      separator = document.createElement('div'); separator.className = 'group-divider'; separator.tabIndex = 0; separator.setAttribute('role', 'separator'); separator.setAttribute('aria-orientation', 'vertical'); separator.setAttribute('aria-label', '左右のエディターグループの幅');
      let resize: { pointer: number; x: number; width: number; left: number; right: number } | null = null;
      const update = (delta: number) => { if (!resize) return; const total = resize.left + resize.right; const next = Math.max(total * .15, Math.min(total * .85, resize.left + delta / resize.width * total)); left.weight = next; right.weight = total - next; const sum = this.wb.layout.groups.reduce((sum, item) => sum + item.weight, 0); this.groups.get(left.id)!.root.style.flexGrow = String(100 * left.weight / sum); this.groups.get(right.id)!.root.style.flexGrow = String(100 * right.weight / sum); };
      separator.onpointerdown = event => { const width = this.groups.get(left.id)!.root.clientWidth + this.groups.get(right.id)!.root.clientWidth; resize = { pointer: event.pointerId, x: event.clientX, width, left: left.weight, right: right.weight }; separator!.setPointerCapture(event.pointerId); };
      separator.onpointermove = event => { if (resize?.pointer === event.pointerId) update(event.clientX - resize.x); };
      const finish = () => { resize = null; };
      separator.onpointerup = finish; separator.onpointercancel = finish; separator.onlostpointercapture = finish;
      separator.onkeydown = event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); resize = { pointer: -1, x: 0, width: 500, left: left.weight, right: right.weight }; update(event.key === 'ArrowLeft' ? -25 : 25); resize = null; } };
      this.separators.set(key, separator);
    }
    return separator;
  }
  private suppressClick = false;
  private dragStart(event: PointerEvent, key: TabKey) {
    if (event.button !== 0 || this.callbacks.blocked()) return;
    this.drag = { key, x: event.clientX, y: event.clientY, pointer: event.pointerId, started: false };
  }
  private dragMove(event: PointerEvent) {
    const drag = this.drag; if (!drag || event.pointerId !== drag.pointer) return;
    if (!drag.started) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
      drag.started = true; this.suppressClick = true; this.host.setPointerCapture(event.pointerId);
      this.ghost.textContent = this.wb.source(parseTab(drag.key).id)?.name ?? ''; this.ghost.hidden = false; document.body.classList.add('tab-dragging');
    }
    event.preventDefault(); this.ghost.style.left = `${event.clientX + 14}px`; this.ghost.style.top = `${event.clientY + 14}px`;
    this.clearDrop(); drag.target = undefined;
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-group-id]');
    const group = hit ? this.wb.layout.group(hit.dataset.groupId) : null; if (!group || !hit) return;
    const view = this.groups.get(group.id)!, box = hit.getBoundingClientRect(), stripBox = view.strip.getBoundingClientRect();
    if (event.clientY <= stripBox.bottom) {
      const tabs = [...view.strip.children] as HTMLElement[];
      const index = tabs.findIndex(node => event.clientX < node.getBoundingClientRect().left + node.clientWidth / 2);
      drag.target = { group: group.id, index: index < 0 ? tabs.length : index };
      const before = tabs[drag.target.index];
      if (before) before.classList.add('drop-before'); else view.strip.classList.add('drop-at-end');
      if (event.clientX < stripBox.left + 32) view.strip.scrollLeft -= 15;
      else if (event.clientX > stripBox.right - 32) view.strip.scrollLeft += 15;
      return;
    }
    const relative = (event.clientX - box.left) / box.width;
    const side = relative < .23 ? 'left' : relative > .77 ? 'right' : undefined;
    drag.target = { group: group.id, index: group.tabs.length, side };
    const width = side ? box.width / 2 : box.width;
    this.overlay.style.cssText = `left:${box.left + (side === 'right' ? width : 0)}px;top:${stripBox.bottom}px;width:${width}px;height:${box.bottom - stripBox.bottom}px`;
    this.overlay.textContent = side === 'left' ? '左に分割' : side === 'right' ? '右に分割' : 'このグループへ移動'; this.overlay.hidden = false;
  }
  private dragEnd(event: PointerEvent) {
    const drag = this.drag; if (!drag || event.pointerId !== drag.pointer) return;
    const target = drag.target;
    if (drag.started && target && !this.callbacks.blocked()) {
      if (target.side) this.wb.layout.split(drag.key, target.group, target.side);
      else this.wb.layout.move(drag.key, target.group, target.index);
      this.callbacks.changed(); this.focusTab(drag.key);
    }
    this.cancelDrag();
  }
  private clearDrop() { this.overlay.hidden = true; for (const node of this.tabs.values()) node.classList.remove('drop-before'); for (const view of this.groups.values()) view.strip.classList.remove('drop-at-end'); }
  private cancelDrag() {
    const pointer = this.drag?.pointer; this.drag = null; this.ghost.hidden = true; this.clearDrop(); document.body.classList.remove('tab-dragging');
    if (pointer !== undefined && this.host.hasPointerCapture(pointer)) this.host.releasePointerCapture(pointer);
    // A browser click follows pointerup; it must not reselect the old position.
    setTimeout(() => { this.suppressClick = false; }, 0);
  }
}
