// Run/assemble is intentionally distinct from the adjacent split-editor icon.
export const assembleIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 4 12 8-12 8z"/><path d="M4 4v16"/></svg>';
export const assembleInGroupIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 4 13 8-13 8z"/></svg>';

const icon = (paths: string) => `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
export const documentIcon = icon('<path d="M5 3h9l5 5v13H5zM14 3v6h5M8 13h8M8 17h6"/>');
export const casFileIcon = icon('<path d="M5 3h9l5 5v13H5zM14 3v6h5M10 12l-3 3 3 3m4-6 3 3-3 3"/>');
export const projectFileIcon = icon('<path d="M5 3h9l5 5v13H5zM14 3v6h5M12 11v3m-4 3v-3h8v3"/><path d="M7 17h2v2H7zm4-8h2v2h-2zm4 8h2v2h-2z"/>');
export const folderIcon = (open = false) => icon(open ? '<path d="M3 8V5h7l2 3h9M3 8h18l-3 12H3z"/>' : '<path d="M3 6h7l2 3h9v11H3z"/>');
export const chevronIcon = (expanded = false) => icon(expanded ? '<path d="m6 9 6 6 6-6"/>' : '<path d="m9 6 6 6-6 6"/>');
export const closeIcon = icon('<path d="m6 6 12 12M18 6 6 18"/>');
export const refreshIcon = icon('<path d="M20 10a8 8 0 1 0-2 8M20 4v6h-6"/>');
export const newFileIcon = icon('<path d="M5 3h9l5 5v3M14 3v6h5M5 3v18h6m6-8v8m-4-4h8"/>');
export const newFolderIcon = icon('<path d="M3 6h7l2 3h9v4M3 6v14h9m5-7v8m-4-4h8"/>');
export const mainFileIcon = icon('<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>');
export const simulatorFileIcon = icon('<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 8h18m-12 3 6 3-6 3z"/>');
export const menuIcon = icon('<path d="M4 6h16M4 12h16M4 18h16"/>');
export const fileKind = (name: string) => /\.cas$/i.test(name) ? 'cas' : /\.cmk$/i.test(name) ? 'cmk' : 'other';
export const sourceFileIcon = (name: string) => fileKind(name) === 'cas' ? casFileIcon : fileKind(name) === 'cmk' ? projectFileIcon : documentIcon;
