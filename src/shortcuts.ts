/** Reserve workbench commands without consuming Monaco's shifted editing keys. */
export function workbenchShortcut(event: { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): string | null {
  if (event.key === 'F1' && !event.ctrlKey && !event.altKey && !event.shiftKey) return 'command-palette';
  if (!event.ctrlKey || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (event.shiftKey) return ({ s: 'save-as', p: 'command-palette' } as Record<string, string>)[key] ?? null;
  return ({ n: 'new', o: 'open', s: 'save', w: 'close-tab', f: 'find', h: 'replace', b: 'sidebar', j: 'output-panel', '1': 'focus-source', '2': 'focus-simulator', ',': 'settings' } as Record<string, string>)[key] ?? null;
}
