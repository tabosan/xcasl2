import { pathKey, basename, type Workbench } from './workbench.ts';

export function pathWithin(path: string | null, parent: string) {
  if (!path) return false;
  const key = pathKey(path), base = pathKey(parent).replace(/\\+$/, '');
  return key === base || key.startsWith(base + '\\');
}
export function rebasePath(path: string, from: string, to: string) {
  if (!pathWithin(path, from)) return path;
  const ordinary = (value: string) => value.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '').replace(/\//g, '\\').replace(/\\+$/, '');
  const oldParts = ordinary(from).split('\\');
  const parts = ordinary(path).split('\\');
  const suffix = parts.slice(oldParts.length).join('\\');
  return to.replace(/[\\/]+$/, '') + (suffix ? '\\' + suffix : '');
}

export function renameWorkbenchPaths(wb: Workbench, from: string, to: string) {
  const changed = new Set<string>();
  for (const doc of wb.documents.values()) if (doc.path && pathWithin(doc.path,from)) {
    doc.path = rebasePath(doc.path,from,to); doc.name = basename(doc.path); changed.add(doc.id);
  }
  if (wb.project) {
    if (wb.project.path) wb.project.path = rebasePath(wb.project.path,from,to);
    if (wb.project.fileIds.some(id => changed.has(id))) wb.project.dirty = true;
  }
  for (const sim of wb.simulators.values()) {
    if (changed.has(sim.id) || sim.sourceIds.some(id => changed.has(id))) sim.buildKey = null;
    for (const id of sim.sourceFiles.keys()) { const doc=wb.source(id); if (doc) sim.sourceFiles.set(id,doc.name); }
  }
  return changed;
}
