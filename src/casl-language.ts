import { tokenizeCaslLine, type CaslToken } from './highlight.ts';

export interface CaslOccurrence { name: string; line: number; column: number; endColumn: number; section: number; declaration: boolean }
export interface CaslSymbol extends CaslOccurrence { operation: string }
export function analyseCasl(source: string) {
  const symbols: CaslSymbol[] = [], occurrences: CaslOccurrence[] = [], sections: { start: number; end: number }[] = [];
  let section = 0, sectionStart = 0;
  source.split('\n').forEach((line, index) => {
    const tokens = tokenizeCaslLine(line), operation = tokens.find(t => ['instruction', 'directive', 'macro'].includes(t.kind ?? ''));
    const op = operation ? line.slice(operation.startIndex, operation.endIndex) : '';
    if (op === 'START') { section++; sectionStart = index + 1; }
    for (const token of tokens.filter(t => t.kind === 'label')) {
      const occurrence = { name: line.slice(token.startIndex, token.endIndex), line: index + 1, column: token.startIndex + 1, endColumn: token.endIndex + 1, section, declaration: token.startIndex === 0 };
      occurrences.push(occurrence);
      if (occurrence.declaration) symbols.push({ ...occurrence, operation: op });
    }
    if (op === 'END' && sectionStart) { sections.push({ start: sectionStart, end: index + 1 }); sectionStart = 0; }
  });
  return { symbols, occurrences, sections };
}
export function definitionsFor(analysis: ReturnType<typeof analyseCasl>, occurrence: CaslOccurrence) {
  const local = analysis.symbols.filter(s => s.name === occurrence.name && s.section === occurrence.section);
  return local.length ? local : analysis.symbols.filter(s => s.name === occurrence.name && s.operation === 'START');
}
export function occurrenceAt(analysis: ReturnType<typeof analyseCasl>, line: number, column: number) {
  return analysis.occurrences.find(o => o.line === line && o.column <= column && column <= o.endColumn);
}
export function referencesFor(analysis: ReturnType<typeof analyseCasl>, symbol: CaslSymbol) {
  return analysis.occurrences.filter(o => o.name === symbol.name && definitionsFor(analysis, o).some(s => s.line === symbol.line));
}
export function tokenAt(line: string, column: number): CaslToken | undefined {
  return tokenizeCaslLine(line).find(t => t.startIndex < column && column <= t.endIndex);
}
