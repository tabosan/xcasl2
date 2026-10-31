import { pathKey } from './workbench.ts';
import { rebasePath } from './path-changes.ts';

export interface FolderEntry { path: string; name: string; directory: boolean }
export interface OpenedFolder { path: string; name: string; entries: FolderEntry[] }
export interface FolderRow { entry: FolderEntry; depth: number; position: number; siblings: number }
export const explorerFileKind = (name: string) => /\.cas$/i.test(name) ? 'cas' : /\.cmk$/i.test(name) ? 'cmk' : null;

/** Filesystem tree state is separate from open editors and cmk membership. */
export class FolderTree {
  root: FolderEntry | null = null;
  selected: string | null = null;
  expanded = new Set<string>();
  children = new Map<string, FolderEntry[]>();
  reset(folder: OpenedFolder | null) {
    this.root = folder ? { path: folder.path, name: folder.name, directory: true } : null;
    this.selected = folder?.path ?? null; this.expanded.clear(); this.children.clear();
    if (folder) { this.expanded.add(pathKey(folder.path)); this.setChildren(folder.path, folder.entries); }
  }
  entry(path: string) {
    const key = pathKey(path);
    if (this.root && pathKey(this.root.path) === key) return this.root;
    for (const entries of this.children.values()) { const entry = entries.find(entry => pathKey(entry.path) === key); if (entry) return entry; }
    return null;
  }
  parent(path: string) {
    const key = pathKey(path);
    for (const [parent, entries] of this.children) if (entries.some(entry => pathKey(entry.path) === key)) return this.entry(parent)?.path ?? this.root?.path ?? null;
    return null;
  }
  creationParent(path = this.selected) {
    const entry = path ? this.entry(path) : null;
    return entry?.directory ? entry.path : entry ? this.parent(entry.path) : this.root?.path ?? null;
  }
  rename(from: string, to: string) {
    const children = new Map<string, FolderEntry[]>();
    for (const [parent, entries] of this.children) children.set(pathKey(rebasePath(parent, from, to)), entries.map(entry => ({
      ...entry, path: rebasePath(entry.path, from, to), name: pathKey(entry.path) === pathKey(from) ? to.split(/[\\/]/).at(-1)! : entry.name,
    })));
    this.children = children;
    this.expanded = new Set([...this.expanded].map(path => pathKey(rebasePath(path, from, to))));
    if (this.selected) this.selected = rebasePath(this.selected, from, to);
  }
  setChildren(parent: string, entries: FolderEntry[]) {
    const key = pathKey(parent), kept = new Set(entries.map(entry => pathKey(entry.path)));
    const remove = (path: string) => {
      const key = pathKey(path);
      for (const entry of this.children.get(key) ?? []) remove(entry.path);
      this.children.delete(key); this.expanded.delete(key);
      if (this.selected && pathKey(this.selected) === key) this.selected = parent;
    };
    for (const entry of this.children.get(key) ?? []) if (!kept.has(pathKey(entry.path))) remove(entry.path);
    this.children.set(key, entries);
  }
  rows(): FolderRow[] {
    const rows: FolderRow[] = [];
    const visit = (entry: FolderEntry, depth: number, position: number, siblings: number) => {
      rows.push({ entry, depth, position, siblings });
      if (entry.directory && this.expanded.has(pathKey(entry.path))) {
        const children = this.children.get(pathKey(entry.path)) ?? [];
        children.forEach((child, index) => visit(child, depth + 1, index + 1, children.length));
      }
    };
    if (this.root) visit(this.root, 1, 1, 1);
    return rows;
  }
}
