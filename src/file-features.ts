import { pathKey } from './workbench.ts';

export function recentFiles(previous: string[], paths: string[]): string[] {
  const seen = new Set<string>();
  return [...paths].reverse().concat(previous).filter(path => {
    const key = pathKey(path);
    if (!path || seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 20);
}

/** Debounce each document independently; retry when a dialog or file operation blocks saving. */
export class AutoSave {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private generation = 0;
  private save: (id: string) => Promise<boolean>;
  private delay: number;
  constructor(save: (id: string) => Promise<boolean>, delay = 1000) { this.save = save; this.delay = delay; }
  schedule(id: string) {
    this.cancel(id);
    const generation = this.generation;
    this.timers.set(id, setTimeout(async () => {
      this.timers.delete(id);
      const retry = await this.save(id);
      if (retry && generation === this.generation && !this.timers.has(id)) this.schedule(id);
    }, this.delay));
  }
  cancel(id: string) { clearTimeout(this.timers.get(id)); this.timers.delete(id); }
  cancelAll() { this.generation++; for (const id of this.timers.keys()) this.cancel(id); }
}
