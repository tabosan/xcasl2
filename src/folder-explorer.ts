import { invoke } from '@tauri-apps/api/core';
import { FolderTree, explorerFileKind, type FolderEntry, type OpenedFolder } from './folder-tree';
import { pathKey } from './workbench';
import { chevronIcon, folderIcon, sourceFileIcon } from './ui-icons';

interface Callbacks {
  open(entry: FolderEntry): void;
  create(directory: boolean, parent?: string): void;
  rename(entry: FolderEntry): void;
  remove(entry: FolderEntry): void;
  openFolder(): void;
  closeFolder(): void;
  blocked(): boolean;
  error(error: unknown): void;
}
interface NameEdit {
  parent: string; entry?: FolderEntry; directory: boolean; input: HTMLInputElement;
  busy: boolean; error: string; commit(name: string): Promise<FolderEntry>; resolve(entry: FolderEntry | null): void;
}

export class FolderExplorer {
  readonly tree = new FolderTree();
  private generation = 0;
  private loading = new Set<string>();
  private errors = new Map<string, string>();
  private refreshing = false;
  private activePath: string | null = null;
  private enabled = false;
  private edit: NameEdit | null = null;
  constructor(private section: HTMLElement, private callbacks: Callbacks) {
    const button = (id: string) => section.querySelector<HTMLButtonElement>(`#${id}`)!;
    button('folder-open').onclick = callbacks.openFolder;
    button('folder-new-file').onclick = () => callbacks.create(false);
    button('folder-new-directory').onclick = () => callbacks.create(true);
    button('folder-close').onclick = callbacks.closeFolder;
    button('folder-refresh').onclick = () => { void this.refresh().catch(callbacks.error); };
    this.host.addEventListener('keydown', event => this.keydown(event));
    this.render();
  }
  private get host() { return this.section.querySelector<HTMLElement>('#folder-tree')!; }
  setFolder(folder: OpenedFolder | null) {
    this.cancelEdit();
    this.generation++; this.tree.reset(folder); this.loading.clear(); this.errors.clear(); this.refreshing = false; this.render();
  }
  update(enabled: boolean, activePath: string | null) {
    this.enabled = enabled; this.activePath = activePath; this.updateControls();
    for (const row of this.host.querySelectorAll<HTMLButtonElement>('[data-explorer-path]')) {
      row.classList.toggle('active', !!activePath && pathKey(row.dataset.explorerPath!) === pathKey(activePath));
      row.disabled = !enabled;
    }
  }
  private updateControls() {
    for (const button of this.section.querySelectorAll<HTMLButtonElement>('.folder-actions button')) button.disabled = !this.enabled || !this.tree.root || this.refreshing;
    this.section.querySelector<HTMLButtonElement>('#folder-open')!.disabled = !this.enabled;
    this.section.querySelector<HTMLButtonElement>('#folder-refresh')!.classList.toggle('loading', this.refreshing);
  }
  async editName(parent: string, directory: boolean, commit: NameEdit['commit'], entry?: FolderEntry): Promise<FolderEntry | null> {
    if (this.callbacks.blocked()) return null;
    this.cancelEdit(); const generation = this.generation;
    this.tree.expanded.add(pathKey(parent));
    if (!this.tree.children.has(pathKey(parent))) await this.load(parent);
    if (generation !== this.generation || this.callbacks.blocked()) return null;
    return new Promise(resolve => {
      const input = document.createElement('input'); input.className = 'folder-name-input'; input.type = 'text'; input.maxLength = 255;
      input.spellcheck = false; input.autocomplete = 'off'; input.value = entry?.name ?? '';
      input.placeholder = directory ? 'フォルダー名' : 'ファイル名（.cas / .cmk）';
      input.setAttribute('aria-label', entry ? '新しい名前' : directory ? '新しいフォルダー名' : '新しいファイル名');
      this.edit = { parent, directory, entry, input, busy: false, error: '', commit, resolve };
      input.onkeydown = event => {
        if (event.key === 'Enter' || event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation();
          if (event.key === 'Enter') void this.commitEdit(); else this.cancelEdit();
        }
      };
      input.onblur = () => queueMicrotask(() => {
        if (this.edit?.input === input && !this.edit.busy && document.activeElement !== input && !(document.activeElement as Element | null)?.closest('.app-context-menu')) this.cancelEdit();
      });
      this.render(); input.focus();
      if (entry) input.setSelectionRange(0, !directory && entry.name.lastIndexOf('.') > 0 ? entry.name.lastIndexOf('.') : entry.name.length);
    });
  }
  private cancelEdit() {
    const edit = this.edit; if (!edit || edit.busy) return;
    this.edit = null; this.render(); this.focus(edit.entry?.path ?? edit.parent); edit.resolve(null);
  }
  private async commitEdit() {
    const edit = this.edit; if (!edit || edit.busy) return;
    if (!edit.input.value) { this.cancelEdit(); return; }
    edit.busy = true; edit.error = ''; this.render();
    try {
      const entry = await edit.commit(edit.input.value);
      this.edit = null; await this.refreshParent(edit.parent); this.render(); this.selectPath(entry.path); edit.resolve(entry);
    } catch (error) {
      edit.busy = false; edit.error = String(error); this.render(); edit.input.focus(); edit.input.select();
    }
  }
  private appendEdit(fragment: DocumentFragment, depth: number) {
    const edit = this.edit!;
    const row = document.createElement('div'); row.className = 'folder-row folder-editor-row'; row.style.paddingLeft = `${24 + (depth - 1) * 14}px`;
    row.setAttribute('role', 'treeitem'); row.setAttribute('aria-level', String(depth)); row.setAttribute('aria-busy', String(edit.busy));
    const icon = document.createElement('span'); icon.className = `folder-icon ${edit.directory ? 'directory-icon' : 'file-icon'}`;
    icon.innerHTML = edit.directory ? folderIcon() : sourceFileIcon(edit.input.value || '.cas');
    edit.input.disabled = edit.busy; edit.input.setAttribute('aria-invalid', String(!!edit.error));
    row.append(icon, edit.input); fragment.append(row);
    if (edit.error) { const error = document.createElement('p'); error.className = 'folder-inline-error error'; error.setAttribute('role', 'alert'); error.textContent = edit.error; fragment.append(error); }
  }
  private async load(path: string, generation = this.generation) {
    const key = pathKey(path); this.loading.add(key); this.errors.delete(key); this.render();
    try {
      const entries = await invoke<FolderEntry[]>('read_folder', { path });
      if (generation === this.generation) this.tree.setChildren(path, entries);
    } catch (error) { if (generation === this.generation) this.errors.set(key, String(error)); }
    finally { if (generation === this.generation) { this.loading.delete(key); this.render(); } }
  }
  async toggle(path: string) {
    if (this.callbacks.blocked()) return;
    const entry = this.tree.entry(path); if (!entry?.directory) return;
    const key = pathKey(path); this.tree.selected = path;
    if (this.tree.expanded.has(key)) this.tree.expanded.delete(key);
    else {
      this.tree.expanded.add(key);
      if (!this.tree.children.has(key) && !this.loading.has(key)) { await this.load(path); return; }
    }
    this.render();
  }
  async refresh(force = false) {
    if (!this.tree.root || this.refreshing || !force && this.callbacks.blocked()) return;
    this.refreshing = true; const generation = this.generation; this.updateControls();
    const visit = async (path: string) => {
      await this.load(path, generation);
      if (generation !== this.generation) return;
      await Promise.all((this.tree.children.get(pathKey(path)) ?? []).filter(entry => entry.directory && this.tree.expanded.has(pathKey(entry.path))).map(entry => visit(entry.path)));
    };
    try { await visit(this.tree.root.path); }
    finally { if (generation === this.generation) { this.refreshing = false; this.updateControls(); } }
  }
  async refreshParent(path: string) {
    const parent = this.tree.entry(path);
    if (parent?.directory) { this.tree.expanded.add(pathKey(path)); await this.load(path); }
  }
  private select(path: string) {
    this.tree.selected = path;
    for (const row of this.host.querySelectorAll<HTMLButtonElement>('[data-explorer-path]')) {
      const selected = pathKey(row.dataset.explorerPath!) === pathKey(path);
      row.setAttribute('aria-selected', String(selected)); row.tabIndex = selected ? 0 : -1;
    }
  }
  selectPath(path: string) { this.select(path); }
  private render() {
    const inputFocused = !!this.edit && document.activeElement === this.edit.input;
    const focused = this.host.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.explorerPath : null;
    const rows = this.tree.rows(), fragment = document.createDocumentFragment();
    if (!rows.length) {
      const note = document.createElement('p'); note.className = 'folder-note'; note.textContent = 'フォルダーは開かれていません'; fragment.append(note);
    }
    const selected = rows.find(row => row.entry.path === this.tree.selected)?.entry.path ?? this.tree.root?.path;
    for (const { entry, depth, position, siblings } of rows) {
      if (this.edit?.entry && pathKey(this.edit.entry.path) === pathKey(entry.path)) { this.appendEdit(fragment, depth); continue; }
      const key = pathKey(entry.path), expanded = this.tree.expanded.has(key), kind = explorerFileKind(entry.name);
      const row = document.createElement('button'); row.type = 'button'; row.className = `folder-row${!entry.directory && !kind ? ' unsupported' : ''}`;
      row.dataset.explorerPath = entry.path; row.dataset.tooltip = entry.path; row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-level', String(depth)); row.setAttribute('aria-posinset', String(position)); row.setAttribute('aria-setsize', String(siblings));
      row.setAttribute('aria-label', entry.name); row.setAttribute('aria-selected', String(entry.path === selected)); row.tabIndex = entry.path === selected ? 0 : -1;
      if (entry.directory) row.setAttribute('aria-expanded', String(expanded));
      row.style.paddingLeft = `${8 + (depth - 1) * 14}px`;
      const arrow = document.createElement('span'); arrow.className = 'folder-arrow'; arrow.innerHTML = entry.directory ? chevronIcon(expanded) : '';
      const icon = document.createElement('span'); icon.className = `folder-icon ${entry.directory ? 'directory-icon' : 'file-icon'}`;
      icon.innerHTML = entry.directory ? folderIcon(expanded) : sourceFileIcon(entry.name);
      const name = document.createElement('span'); name.className = 'folder-name'; name.textContent = entry.name;
      row.append(arrow, icon, name);
      row.onfocus = () => this.select(entry.path);
      row.onclick = () => {
        if (this.callbacks.blocked()) return;
        this.select(entry.path);
        if (entry.directory) void this.toggle(entry.path);
        else if (kind) this.callbacks.open(entry);
      };
      row.setAttribute('aria-busy', String(this.loading.has(key))); fragment.append(row);
      if (this.edit && !this.edit.entry && pathKey(this.edit.parent) === key) this.appendEdit(fragment, depth + 1);
      const error = this.errors.get(key);
      if (entry.directory && expanded && (error || this.loading.has(key) || !this.tree.children.get(key)?.length)) {
        const note = document.createElement('p'); note.className = `folder-note${error ? ' error' : ''}`; note.style.paddingLeft = `${28 + depth * 14}px`;
        note.textContent = error ?? (this.loading.has(key) ? '読み込み中…' : '空のフォルダー'); if (error) note.setAttribute('role', 'alert'); fragment.append(note);
      }
    }
    this.host.replaceChildren(fragment); this.update(this.enabled, this.activePath);
    if (inputFocused && this.edit && !this.edit.busy) this.edit.input.focus();
    else if (focused) this.focus(focused);
  }
  private focus(path: string) {
    const row = [...this.host.querySelectorAll<HTMLButtonElement>('[data-explorer-path]')].find(row => pathKey(row.dataset.explorerPath!) === pathKey(path));
    row?.focus({ preventScroll: true }); row?.scrollIntoView({ block: 'nearest' });
  }
  private keydown(event: KeyboardEvent) {
    if ((event.target as Element).closest('.folder-editor-row')) return;
    if (this.callbacks.blocked() || event.ctrlKey || event.altKey || event.metaKey) return;
    const path = (event.target as HTMLElement).dataset.explorerPath; if (!path) return;
    const rows = this.tree.rows(), index = rows.findIndex(row => row.entry.path === path), entry = this.tree.entry(path); if (!entry) return;
    let next: string | undefined;
    if (event.key === 'F2' && pathKey(path) !== pathKey(this.tree.root!.path)) this.callbacks.rename(entry);
    else if (event.key === 'Delete' && !event.shiftKey && pathKey(path) !== pathKey(this.tree.root!.path)) this.callbacks.remove(entry);
    else if (event.key === 'ArrowDown') next = rows[Math.min(index + 1, rows.length - 1)]?.entry.path;
    else if (event.key === 'ArrowUp') next = rows[Math.max(0, index - 1)]?.entry.path;
    else if (event.key === 'Home') next = rows[0]?.entry.path;
    else if (event.key === 'End') next = rows.at(-1)?.entry.path;
    else if (event.key === 'ArrowRight' && entry.directory) {
      if (!this.tree.expanded.has(pathKey(path))) void this.toggle(path);
      else next = this.tree.children.get(pathKey(path))?.[0]?.path;
    } else if (event.key === 'ArrowLeft') {
      if (entry.directory && this.tree.expanded.has(pathKey(path))) void this.toggle(path);
      else next = this.tree.parent(path) ?? undefined;
    } else return;
    event.preventDefault(); event.stopPropagation(); if (next) this.focus(next);
  }
}
