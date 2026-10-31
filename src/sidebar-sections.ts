import { chevronIcon } from './ui-icons';

export function initializeSidebarSections(sidebar: HTMLElement) {
  let saved: Record<string, boolean> = {};
  try { const value = JSON.parse(localStorage.getItem('xcasl2.sidebar.sections') ?? '{}'); if (value && typeof value === 'object' && !Array.isArray(value)) saved = value; } catch { /* Use expanded defaults. */ }
  const buttons = [...sidebar.querySelectorAll<HTMLButtonElement>('[data-sidebar-section]')];
  const set = (button: HTMLButtonElement, expanded: boolean, persist = true) => {
    const id = button.dataset.sidebarSection!, content = document.getElementById(id)!;
    button.setAttribute('aria-expanded', String(expanded)); button.setAttribute('aria-controls', id);
    button.querySelector('.section-chevron')!.innerHTML = chevronIcon(expanded); content.hidden = !expanded;
    if (persist) { saved[id] = expanded; try { localStorage.setItem('xcasl2.sidebar.sections', JSON.stringify(saved)); } catch { /* Still usable without storage. */ } }
  };
  for (const button of buttons) {
    set(button, saved[button.dataset.sidebarSection!] !== false, false);
    button.onclick = () => set(button, button.getAttribute('aria-expanded') !== 'true');
  }
  return { expand(id: string) { const button = buttons.find(button => button.dataset.sidebarSection === id); if (button) set(button, true); } };
}
