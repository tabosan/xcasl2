export interface ContextMenuItem { label: string; shortcut?: string; disabled?: boolean; run: () => void | Promise<unknown> }
export type ContextMenuEntry = ContextMenuItem | null;

export function menuPosition(x: number, y: number, width: number, height: number, viewportWidth: number, viewportHeight: number) {
  return { x: Math.max(4, Math.min(x, viewportWidth - width - 4)), y: Math.max(4, Math.min(y, viewportHeight - height - 4)) };
}

/** Own the workbench menu; leave Monaco's editor/menu events to Monaco. */
export class AppContextMenu {
  private root = document.createElement('div');
  private origin: HTMLElement | null = null;
  private buttons: HTMLButtonElement[] = [];
  constructor(private resolve: (target: Element) => ContextMenuEntry[], private onError: (error: unknown) => void) {
    this.root.className = 'app-context-menu'; this.root.hidden = true;
    this.root.setAttribute('role', 'menu'); this.root.setAttribute('aria-label', 'コンテキストメニュー');
    document.body.append(this.root);
    document.addEventListener('contextmenu', event => {
      if (event.composedPath().some(node => node instanceof Element && node.matches('.monaco-editor,.monaco-component'))) { this.close(false); return; }
      event.preventDefault(); event.stopPropagation();
      const target = event.target instanceof Element ? event.target : document.body;
      if (this.root.contains(target)) return;
      this.close(false);
      const entries = this.resolve(target);
      this.origin = (target.closest('button,input,textarea,select,[tabindex]') as HTMLElement | null)
        ?? target.closest('.editor-group')?.querySelector<HTMLElement>('[role=tab][aria-selected=true]')
        ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      this.show(entries, event.clientX, event.clientY);
    }, true);
    document.addEventListener('pointerdown', event => { if (!this.root.contains(event.target as Node)) this.close(false); }, true);
    document.addEventListener('keydown', event => this.keydown(event), true);
    window.addEventListener('blur', () => this.close(false));
    window.addEventListener('resize', () => this.close(false));
    document.addEventListener('scroll', event => { if (!this.root.contains(event.target as Node)) this.close(false); }, true);
  }
  get isOpen() { return !this.root.hidden; }
  openAbove(entries: ContextMenuEntry[], origin: HTMLElement) {
    this.close(false); this.origin = origin;
    const box = origin.getBoundingClientRect(); this.show(entries, box.left, box.top, true);
  }
  private show(entries: ContextMenuEntry[], x: number, y: number, above = false) {
    this.root.replaceChildren(); this.buttons = [];
    for (const item of entries) {
      if (!item) { const separator = document.createElement('div'); separator.className = 'context-menu-separator'; separator.setAttribute('role', 'separator'); this.root.append(separator); continue; }
      const button = document.createElement('button'); button.type = 'button'; button.className = 'context-menu-item';
      button.setAttribute('role', 'menuitem'); button.tabIndex = -1; button.disabled = !!item.disabled;
      const label = document.createElement('span'); label.textContent = item.label;
      const shortcut = document.createElement('span'); shortcut.className = 'context-menu-shortcut'; shortcut.textContent = item.shortcut ?? '';
      button.append(label, shortcut);
      button.onclick = () => { this.close(true); try { Promise.resolve(item.run()).catch(this.onError); } catch (error) { this.onError(error); } };
      button.onpointermove = () => { if (!button.disabled) button.focus({ preventScroll: true }); };
      this.root.append(button); if (!button.disabled) this.buttons.push(button);
    }
    this.root.hidden = false;
    if (above) y -= this.root.offsetHeight;
    const position = menuPosition(x, y, this.root.offsetWidth, this.root.offsetHeight, window.innerWidth, window.innerHeight);
    this.root.style.left = `${position.x}px`; this.root.style.top = `${position.y}px`;
    if (this.buttons.length) this.buttons[0].focus({ preventScroll: true });
    else { this.root.tabIndex = -1; this.root.focus({ preventScroll: true }); }
  }
  close(restore = true) {
    if (this.root.hidden) return;
    this.root.hidden = true;
    if (restore && this.origin?.isConnected) this.origin.focus({ preventScroll: true });
  }
  private keydown(event: KeyboardEvent) {
    if (!this.isOpen) return;
    if (['Escape', 'Tab'].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); this.close(); return; }
    const index = this.buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? this.buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + this.buttons.length) % this.buttons.length;
      this.buttons[next]?.focus({ preventScroll: true }); return;
    }
    if (['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); this.buttons[index]?.click(); return; }
    if (event.ctrlKey || event.altKey || event.metaKey || /^F\d+$/.test(event.key)) this.close();
  }
}
