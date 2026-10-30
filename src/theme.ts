import type { ThemePreference } from './types';

export function resolveTheme(preference: ThemePreference, systemDark: boolean): 'light' | 'dark' {
  return preference === 'system' ? systemDark ? 'dark' : 'light' : preference;
}

export function createThemeController(
  root: { dataset: { theme?: string } },
  media: Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>,
) {
  let preference: ThemePreference = 'dark';
  const systemChanged = (event: MediaQueryListEvent) => {
    if (preference === 'system') root.dataset.theme = resolveTheme(preference, event.matches);
  };
  media.addEventListener('change', systemChanged);
  return {
    setPreference(next: ThemePreference) { preference = next; root.dataset.theme = resolveTheme(next, media.matches); },
    setSystemTheme(theme: 'light' | 'dark') { if (preference === 'system') root.dataset.theme = theme; },
    dispose() { media.removeEventListener('change', systemChanged); },
  };
}
