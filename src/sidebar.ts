/** Resize the explorer without recreating editor models or their view state. */
export function initializeSidebarResize(workbench: HTMLElement, sidebar: HTMLElement, separator: HTMLElement) {
  const storageKey = 'xcasl2.sidebar-width.v1';
  let preferred = 190;
  try {
    const stored = Number(localStorage.getItem(storageKey));
    if (Number.isFinite(stored) && stored >= 150) preferred = stored;
  } catch { /* Width changes still work when storage is unavailable. */ }
  let drag: { pointer: number; x: number; width: number } | null = null;
  const limits = () => {
    const activityWidth = workbench.querySelector<HTMLElement>('.activity-bar')!.offsetWidth;
    return { min: 150, max: Math.max(150, Math.min(600, workbench.clientWidth - activityWidth - separator.offsetWidth - 280)) };
  };
  const apply = () => {
    const { min, max } = limits(), width = Math.round(Math.max(min, Math.min(max, preferred)));
    sidebar.style.setProperty('--sidebar-width', `${width}px`);
    separator.setAttribute('aria-valuemin', String(min));
    separator.setAttribute('aria-valuemax', String(Math.floor(max)));
    separator.setAttribute('aria-valuenow', String(width));
    separator.setAttribute('aria-valuetext', `${width}ピクセル`);
  };
  const save = () => { try { localStorage.setItem(storageKey, String(preferred)); } catch { /* Optional layout preference. */ } };
  const setWidth = (width: number) => {
    const { min, max } = limits(); preferred = Math.max(min, Math.min(max, width)); apply();
  };
  const finish = () => {
    const pointer = drag?.pointer; drag = null;
    workbench.classList.remove('sidebar-resizing'); separator.classList.remove('dragging');
    if (pointer !== undefined && separator.hasPointerCapture(pointer)) separator.releasePointerCapture(pointer);
    save();
  };
  separator.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag = { pointer: event.pointerId, x: event.clientX, width: sidebar.getBoundingClientRect().width };
    separator.setPointerCapture(event.pointerId);
    workbench.classList.add('sidebar-resizing'); separator.classList.add('dragging');
  });
  separator.addEventListener('pointermove', event => { if (drag?.pointer === event.pointerId) setWidth(drag.width + event.clientX - drag.x); });
  separator.addEventListener('pointerup', finish);
  separator.addEventListener('pointercancel', finish);
  separator.addEventListener('lostpointercapture', () => { if (drag) finish(); });
  window.addEventListener('blur', () => { if (drag) finish(); });
  separator.addEventListener('dblclick', () => { setWidth(190); save(); });
  separator.addEventListener('keydown', event => {
    const { min, max } = limits(), current = sidebar.getBoundingClientRect().width;
    const next = event.key === 'Home' ? min : event.key === 'End' ? max
      : event.key === 'ArrowLeft' ? current - (event.shiftKey ? 50 : 10)
      : event.key === 'ArrowRight' ? current + (event.shiftKey ? 50 : 10) : null;
    if (next === null) return;
    event.preventDefault(); setWidth(next); save();
  });
  new ResizeObserver(apply).observe(workbench);
  apply();
}
