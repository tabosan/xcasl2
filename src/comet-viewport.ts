import type { SimulatorTab } from './workbench';

/** Presentation state belongs to each simulator, independently of its CPU state. */
export function initializeCometViewport(root: HTMLElement) {
  const el = <T extends Element = HTMLElement>(name: string) => root.querySelector<T>(`[data-view="${name}"]`)!;
  const content = el<HTMLElement>('sim-content'), divider = el<HTMLElement>('comet-divider');
  const scroll = root.querySelector<HTMLElement>('.datapath-scroll')!, svg = root.querySelector<SVGSVGElement>('.datapath')!;
  const events = new AbortController(), options = { signal: events.signal };
  let current: SimulatorTab | null = null, pointer: number | null = null;
  const bounds = () => {
    const width = Math.max(364, content.clientWidth - 20) - 4;
    return { width, min: Math.max(10, 180 / width * 100), max: Math.min(90, (width - 180) / width * 100) };
  };
  const layout = () => {
    if (!current?.cometView) return;
    const { min, max } = bounds(), share = Math.max(min, Math.min(max, current.cometShare));
    content.style.setProperty('--comet-left-share', String(share / 100));
    divider.setAttribute('aria-valuemin', String(Math.ceil(min)));
    divider.setAttribute('aria-valuemax', String(Math.floor(max)));
    divider.setAttribute('aria-valuenow', String(Math.round(share)));
    divider.setAttribute('aria-valuetext', `CPU・出力 ${Math.round(share)}%、メモリ・ソース ${Math.round(100 - share)}%`);
  };
  const zoom = (percent: number) => {
    if (!current) return;
    current.cometZoom = Math.max(25, Math.min(300, Math.round(percent)));
    const box = svg.viewBox.baseVal;
    svg.style.width = `${box.width * current.cometZoom / 100}px`;
    svg.style.height = `${box.height * current.cometZoom / 100}px`;
    el('comet-zoom-reset').textContent = `${current.cometZoom}%`;
    el<HTMLButtonElement>('comet-zoom-out').disabled = current.cometZoom <= 25;
    el<HTMLButtonElement>('comet-zoom-in').disabled = current.cometZoom >= 300;
  };
  el('comet-zoom-out').addEventListener('click', () => zoom((current?.cometZoom ?? 100) - 25), options);
  el('comet-zoom-in').addEventListener('click', () => zoom((current?.cometZoom ?? 100) + 25), options);
  el('comet-zoom-reset').addEventListener('click', () => zoom(100), options);
  el('comet-zoom-fit').addEventListener('click', () => {
    const box = svg.viewBox.baseVal;
    zoom(Math.floor(Math.min((scroll.clientWidth - 16) / box.width, (scroll.clientHeight - 16) / box.height) * 100));
    scroll.scrollTo(0, 0);
  }, options);
  scroll.addEventListener('wheel', event => {
    if (!event.ctrlKey || !event.deltaY || !current?.cometView) return;
    // Handle diagram zoom instead of WebView zoom or ordinary scrolling.
    event.preventDefault(); event.stopPropagation();
    const before = svg.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - before.left) / before.width));
    const y = Math.max(0, Math.min(1, (event.clientY - before.top) / before.height));
    zoom(current.cometZoom + (event.deltaY < 0 ? 25 : -25));
    // Keep the diagram point beneath the pointer in place where scrolling allows.
    const after = svg.getBoundingClientRect();
    scroll.scrollLeft += after.left + after.width * x - event.clientX;
    scroll.scrollTop += after.top + after.height * y - event.clientY;
  }, { ...options, passive: false });
  const setShare = (value: number) => {
    if (!current) return;
    const { min, max } = bounds(); current.cometShare = Math.max(min, Math.min(max, value)); layout();
  };
  const finish = () => {
    const released = pointer; pointer = null; divider.classList.remove('dragging'); content.classList.remove('comet-resizing');
    if (released !== null && divider.hasPointerCapture(released)) divider.releasePointerCapture(released);
  };
  divider.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault(); pointer = event.pointerId; divider.setPointerCapture(pointer);
    divider.classList.add('dragging'); content.classList.add('comet-resizing');
  }, options);
  divider.addEventListener('pointermove', event => {
    if (pointer === event.pointerId) setShare((event.clientX - content.getBoundingClientRect().left - 10 + content.scrollLeft) / bounds().width * 100);
  }, options);
  divider.addEventListener('pointerup', finish, options);
  divider.addEventListener('pointercancel', finish, options);
  divider.addEventListener('lostpointercapture', finish, options);
  window.addEventListener('blur', finish, options);
  divider.addEventListener('dblclick', () => setShare(52.38), options);
  divider.addEventListener('keydown', event => {
    if (!current) return;
    const { min, max } = bounds();
    const value = event.key === 'Home' ? min : event.key === 'End' ? max
      : event.key === 'ArrowLeft' ? current.cometShare - (event.shiftKey ? 10 : 2)
      : event.key === 'ArrowRight' ? current.cometShare + (event.shiftKey ? 10 : 2) : null;
    if (value !== null) { event.preventDefault(); setShare(value); }
  }, options);
  const observer = new ResizeObserver(layout); observer.observe(content);
  return {
    render(tab: SimulatorTab) { current = tab; if (tab.cometView) { layout(); zoom(tab.cometZoom); } },
    dispose() { finish(); observer.disconnect(); events.abort(); current = null; },
  };
}
