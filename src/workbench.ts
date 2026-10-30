import type { Diagnostic, OpenedSource, Settings, Snapshot, StepMode } from './types';
import { TabLayout, tabKey } from './tab-layout.ts';

export interface SourceDocument {
  id: string; path: string | null; name: string; source: string; saved: string;
  diagnostics: Diagnostic[]; buildMessage: string;
}
export interface ProjectState { path: string | null; fileIds: string[]; dirty: boolean }
export interface SimulatorTab {
  id: string; snapshot: Snapshot | null; previous: Snapshot | null; buildKey: string | null;
  sourceIds: string[]; sourceFiles: Map<string, string>; mode: StepMode;
  cometView: boolean; cometFollow: boolean; binaryRegisters: boolean; memoryStart: number; interval: number;
  cometZoom: number; cometShare: number;
  stackStart: number | null; labelScrollTop: number; stackScrollTop: number;
  running: boolean; busy: boolean; epoch: number; pending: Promise<void>; inputText: string;
}
export const basename = (path: string): string => path.split(/[\\/]/).pop() || path;
export function pathKey(path: string): string {
  return path.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '').replace(/\//g, '\\').toLocaleLowerCase();
}

export class Workbench {
  layout = new TabLayout();
  documents = new Map<string, SourceDocument>();
  editorTabs: string[] = [];
  simulators = new Map<string, SimulatorTab>();
  activeSource: string | null = null;
  activeSimulator: string | null = null;
  project: ProjectState | null = null;
  private serial = 0;

  create(source: string, name?: string): SourceDocument {
    const id = `source-${++this.serial}`;
    const doc: SourceDocument = { id, path: null, name: name ?? `無題-${this.serial}.cas`, source, saved: source, diagnostics: [], buildMessage: 'アセンブル待ち' };
    this.documents.set(id, doc); this.editorTabs.push(id); this.activeSource = id; this.layout.open(tabKey('source', id)); return doc;
  }
  open(file: OpenedSource): SourceDocument {
    let doc = [...this.documents.values()].find(doc => doc.path && pathKey(doc.path) === pathKey(file.path));
    if (!doc) { doc = this.create(file.source.replace(/\r\n/g, '\n'), basename(file.path)); doc.path = file.path; }
    if (!this.editorTabs.includes(doc.id)) this.editorTabs.push(doc.id);
    this.activeSource = doc.id; this.layout.open(tabKey('source', doc.id)); return doc;
  }
  source(id = this.activeSource): SourceDocument | null { return id ? this.documents.get(id) ?? null : null; }
  simulation(id = this.activeSimulator): SimulatorTab | null { return id ? this.simulators.get(id) ?? null : null; }
  sourcesFor(id: string): SourceDocument[] {
    const ids = this.project?.fileIds.includes(id) ? [id, ...this.project.fileIds.filter(other => other !== id)] : [id];
    return ids.map(id => this.documents.get(id)).filter((doc): doc is SourceDocument => !!doc);
  }
  key(id: string, settings: Pick<Settings, 'base' | 'fill'>): string {
    return JSON.stringify([settings.base, settings.fill, this.sourcesFor(id).map(doc => [doc.id, doc.path, doc.source])]);
  }
  stale(sim: SimulatorTab, settings: Pick<Settings, 'base' | 'fill'>): boolean { return !sim.buildKey || sim.buildKey !== this.key(sim.id, settings); }
  ensureSimulator(id: string, settings: Settings): SimulatorTab {
    if (!this.documents.has(id)) throw new Error('ソースがありません。');
    let sim = this.simulators.get(id);
    if (!sim) {
      sim = { id, snapshot: null, previous: null, buildKey: null, sourceIds: [], sourceFiles: new Map(), mode: settings.step_mode,
        cometView: settings.comet_view, cometFollow: true, binaryRegisters: settings.binary_registers, memoryStart: settings.memory_start, interval: settings.interval_ms,
        cometZoom: 100, cometShare: 52.38,
        stackStart: null, labelScrollTop: 0, stackScrollTop: 0,
        running: false, busy: false, epoch: 0, pending: Promise.resolve(), inputText: '' };
      this.simulators.set(id, sim);
    }
    this.activeSimulator = id; this.layout.preview(tabKey('source', id), tabKey('simulator', id)); return sim;
  }
  closeSimulator(id: string) {
    const ids = [...this.simulators.keys()], index = ids.indexOf(id);
    this.simulators.delete(id);
    this.layout.close(tabKey('simulator', id));
    if (this.activeSimulator === id) this.activeSimulator = ids.filter(other => other !== id)[Math.max(0, index - 1)] ?? null;
  }
  closeSource(id: string) {
    const index = this.editorTabs.indexOf(id);
    this.editorTabs = this.editorTabs.filter(other => other !== id);
    this.layout.close(tabKey('source', id));
    if (this.activeSource === id) this.activeSource = this.editorTabs[Math.max(0, index - 1)] ?? null;
  }
  protectedSources(): SourceDocument[] {
    const ids = new Set([...this.editorTabs, ...(this.project?.fileIds ?? []), ...[...this.simulators.values()].flatMap(sim => sim.sourceIds)]);
    return [...ids].map(id => this.documents.get(id)).filter((doc): doc is SourceDocument => !!doc);
  }
  prune(): string[] {
    const keep = new Set(this.protectedSources().map(doc => doc.id));
    const removed = [...this.documents.keys()].filter(id => !keep.has(id));
    for (const id of removed) this.documents.delete(id);
    return removed;
  }
}
