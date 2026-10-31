export interface TooltipAnchor { left: number; right: number; top: number; bottom: number }

export function tooltipPosition(anchor: TooltipAnchor, width: number, height: number, viewportWidth: number, viewportHeight: number) {
  const margin = 8, gap = 7;
  const below = anchor.bottom + gap;
  return {
    x: Math.max(margin, Math.min(anchor.left, viewportWidth - width - margin)),
    y: Math.max(margin, Math.min(below + height <= viewportHeight - margin ? below : anchor.top - gap - height, viewportHeight - height - margin)),
  };
}

/** Workbench hints use DOM text, independent of WebView's native title tooltip. */
export class AppTooltips {
  private root = document.createElement('div');
  private target: HTMLElement | null = null;
  private reason: 'pointer' | 'focus' = 'pointer';
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.root.id = 'workbench-tooltip'; this.root.className = 'app-tooltip'; this.root.hidden = true;
    this.root.setAttribute('role', 'tooltip'); this.root.setAttribute('popover', 'manual');
    document.body.append(this.root);
    document.addEventListener('pointerover', event => {
      if (event.pointerType === 'touch' || event.buttons) return;
      const target = this.fromEvent(event);
      if (target) this.schedule(target, 'pointer');
    });
    document.addEventListener('pointerout', event => {
      if (this.reason === 'pointer' && this.target && (!(event.relatedTarget instanceof Node) || !this.target.contains(event.relatedTarget))) this.hide();
    });
    document.addEventListener('focusin', event => {
      const target = this.fromEvent(event);
      if (target?.matches(':focus-visible')) this.schedule(target, 'focus');
    });
    document.addEventListener('focusout', () => { if (this.reason === 'focus') this.hide(); });
    document.addEventListener('keydown', event => {
      // Alt changes the current button's hint. Keep it open and let the
      // data-tooltip mutation refresh the text without restarting the delay.
      if (!['Alt', 'AltGraph', 'Control', 'Shift', 'Meta'].includes(event.key)) this.hide();
    }, true);
    document.addEventListener('pointerdown', () => this.hide(), true);
    document.addEventListener('contextmenu', () => this.hide(), true);
    document.addEventListener('scroll', () => this.hide(), true);
    window.addEventListener('blur', () => this.hide());
    window.addEventListener('resize', () => this.hide());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.hide(); });
    new MutationObserver(() => {
      if (!this.target) return;
      if (!this.valid()) this.hide();
      else if (!this.root.hidden) this.refresh();
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-tooltip', 'hidden', 'open'] });
  }

  private fromEvent(event: Event) {
    const path = event.composedPath();
    if (path.some(node => node instanceof Element && node.matches('.monaco-editor,.monaco-component'))) return null;
    return path.find((node): node is HTMLElement => node instanceof HTMLElement && !!node.dataset.tooltip?.trim()) ?? null;
  }

  private valid() {
    const target = this.target, modal = document.querySelector('dialog[open]');
    return !!target?.isConnected && !!target.dataset.tooltip?.trim() && !target.closest('[hidden]') && target.getClientRects().length > 0 && (!modal || modal.contains(target));
  }

  private schedule(target: HTMLElement, reason: 'pointer' | 'focus') {
    if (this.target === target) return;
    this.hide(); this.target = target; this.reason = reason;
    if (!this.valid()) { this.hide(); return; }
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.valid()) { this.hide(); return; }
      // A popover occupies the top layer, above split panes and modal dialogs.
      // Older WebViews fall back to the current dialog's own stacking context.
      if (typeof this.root.showPopover !== 'function') (target.closest('dialog[open]') ?? document.body).append(this.root);
      this.root.hidden = false;
      if (typeof this.root.showPopover === 'function') this.root.showPopover();
      const describedBy = new Set((target.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean));
      describedBy.add(this.root.id); target.setAttribute('aria-describedby', [...describedBy].join(' '));
      this.refresh();
    }, 450);
  }

  private refresh() {
    if (!this.target) return;
    const text = this.target.dataset.tooltip ?? '';
    if (this.root.textContent !== text) this.root.textContent = text;
    const position = tooltipPosition(this.target.getBoundingClientRect(), this.root.offsetWidth, this.root.offsetHeight, window.innerWidth, window.innerHeight);
    this.root.style.left = `${position.x}px`; this.root.style.top = `${position.y}px`;
  }

  private hide() {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    if (this.target) {
      const describedBy = (this.target.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(id => id && id !== this.root.id);
      if (describedBy.length) this.target.setAttribute('aria-describedby', describedBy.join(' '));
      else this.target.removeAttribute('aria-describedby');
    }
    this.target = null;
    if (typeof this.root.hidePopover === 'function' && this.root.matches(':popover-open')) this.root.hidePopover();
    this.root.hidden = true;
  }
}
