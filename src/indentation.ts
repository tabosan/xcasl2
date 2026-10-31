import { tokenizeCaslLine } from './highlight.ts';
import type { Settings } from './types';

export type IndentationDefaults = Pick<Settings, 'editor_insert_spaces' | 'editor_tab_size' | 'editor_detect_indentation'>;

export function whitespaceToColumn(start: number, end: number, tabSize: number, insertSpaces: boolean): string {
  let text = '';
  for (let column = start; column < end;) {
    const next = column + tabSize - column % tabSize;
    if (!insertSpaces && next <= end) { text += '\t'; column = next; }
    else { text += ' '; column++; }
  }
  return text;
}

/** Format only bundled sample fields; strings, operands and comment text survive verbatim. */
export function formatSampleIndentation(source: string, options: IndentationDefaults): string {
  const rows = source.split('\n').map(raw => {
    const tokens = tokenizeCaslLine(raw);
    const operation = tokens.find(t => ['instruction', 'directive', 'macro'].includes(t.kind ?? ''));
    if (!operation) return { raw };
    const label = tokens.find(t => t.kind === 'label' && t.startIndex === 0);
    const comment = tokens.find(t => t.kind === 'comment');
    return { raw, label: label ? raw.slice(label.startIndex, label.endIndex) : '',
      operation: raw.slice(operation.startIndex, operation.endIndex),
      operand: raw.slice(operation.endIndex, comment?.startIndex ?? raw.length).trim(),
      comment: comment ? raw.slice(comment.startIndex) : '' };
  });
  const size = options.editor_tab_size, spaces = options.editor_insert_spaces;
  const nextStop = (length: number) => (Math.floor(length / size) + 1) * size;
  const operationColumn = nextStop(Math.max(0, ...rows.map(r => r.label?.length ?? 0)));
  const operandColumn = operationColumn + nextStop(Math.max(0, ...rows.map(r => r.operation?.length ?? 0)));
  return rows.map(row => {
    if (!row.operation) return row.raw;
    let text = row.label! + whitespaceToColumn(row.label!.length, operationColumn, size, spaces) + row.operation;
    if (row.operand) text += whitespaceToColumn(operationColumn + row.operation.length, operandColumn, size, spaces) + row.operand;
    if (row.comment) text += (spaces ? ' '.repeat(size) : '\t') + row.comment;
    return text;
  }).join('\n');
}
