export type TabKind = 'source' | 'simulator';
export type PreviewPlacement = 'beside' | 'same-group';
export type TabKey = `${TabKind}:${string}`;
export const tabKey = (kind: TabKind, id: string): TabKey => `${kind}:${id}`;
export function parseTab(key: TabKey) { const at = key.indexOf(':'); return { kind: key.slice(0, at) as TabKind, id: key.slice(at + 1) }; }
export interface EditorGroup { id: string; tabs: TabKey[]; active: TabKey | null; weight: number }

/** Layout only: moving tabs never changes documents, build inputs or sessions. */
export class TabLayout {
  groups: EditorGroup[] = [{ id: 'group-1', tabs: [], active: null, weight: 1 }];
  focused = 'group-1';
  private serial = 1;
  group(id = this.focused) { return this.groups.find(group => group.id === id)!; }
  owner(key: TabKey) { return this.groups.find(group => group.tabs.includes(key)); }
  current() { return this.group()?.active ?? null; }
  focus(key: TabKey) {
    const group = this.owner(key); if (!group) return;
    group.active = key; this.focused = group.id;
  }
  open(key: TabKey, groupId = this.focused) {
    if (this.owner(key)) { this.focus(key); return; }
    const group = this.group(groupId) ?? this.groups[0];
    group.tabs.push(key); group.active = key; this.focused = group.id;
  }
  insertGroup(reference: string, side: 'left' | 'right') {
    const index = this.groups.findIndex(group => group.id === reference);
    if (index < 0) throw new Error('グループがありません。');
    const original = this.groups[index], weight = original.weight / 2;
    original.weight = weight;
    const group: EditorGroup = { id: `group-${++this.serial}`, tabs: [], active: null, weight };
    this.groups.splice(index + (side === 'right' ? 1 : 0), 0, group); return group;
  }
  preview(source: TabKey, simulator: TabKey, placement: PreviewPlacement = 'beside') {
    if (placement === 'same-group') {
      const target = this.owner(source) ?? this.group();
      if (this.owner(simulator)?.id === target.id) { this.focus(simulator); return; }
      this.open(simulator, target.id);
      this.move(simulator, target.id, target.tabs.indexOf(source) + 1);
      return;
    }
    if (this.owner(simulator)) { this.focus(simulator); return; }
    const owner = this.owner(source) ?? this.group();
    const next = this.groups[this.groups.indexOf(owner) + 1] ?? this.insertGroup(owner.id, 'right');
    this.open(simulator, next.id);
  }
  move(key: TabKey, targetId: string, index: number) {
    const source = this.owner(key), target = this.group(targetId); if (!source || !target) return;
    const old = source.tabs.indexOf(key);
    const insertion = Math.max(0, Math.min(index, target.tabs.length));
    source.tabs.splice(old, 1);
    if (source.active === key) source.active = source.tabs[Math.max(0, old - 1)] ?? null;
    target.tabs.splice(insertion - (source === target && old < insertion ? 1 : 0), 0, key);
    target.active = key; this.focused = target.id; this.compact();
  }
  split(key: TabKey, reference: string, side: 'left' | 'right') {
    const owner = this.owner(key); if (!owner || !this.group(reference)) return;
    // A lone tab already occupies this group: splitting it would add no view.
    if (owner.id === reference && owner.tabs.length === 1) return;
    const target = this.insertGroup(reference, side); this.move(key, target.id, 0);
  }
  close(key: TabKey) {
    const group = this.owner(key); if (!group) return;
    const index = group.tabs.indexOf(key); group.tabs.splice(index, 1);
    if (group.active === key) group.active = group.tabs[Math.max(0, index - 1)] ?? null;
    this.compact();
  }
  join() {
    const active = this.current(), first = this.groups[0];
    first.tabs = this.groups.flatMap(group => group.tabs); first.active = active ?? first.tabs[0] ?? null;
    first.weight = 1; this.groups = [first]; this.focused = first.id;
  }
  private compact() {
    const oldIndex = this.groups.findIndex(group => group.id === this.focused);
    if (this.groups.some(group => group.tabs.length)) this.groups = this.groups.filter(group => group.tabs.length);
    else this.groups = [this.groups[0]];
    if (!this.group()) this.focused = this.groups[Math.min(Math.max(oldIndex, 0), this.groups.length - 1)].id;
  }
}
