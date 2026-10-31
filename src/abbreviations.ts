import { whitespaceToColumn } from './indentation.ts';

export interface CaslAbbreviation { prefix: string; snippet: string; description: string }

/** Expand only a complete abbreviation in an otherwise empty statement field. */
export function caslAbbreviation(line: string, column: number, options: { tabSize: number; insertSpaces: boolean; indentSize?: number }): CaslAbbreviation | null {
  const before = line.slice(0, column - 1);
  if (line.slice(column - 1).trim()) return null;
  const match = /^([ \t]*)(!|(?:inc|dec|clr)(?:\.gr[0-7])?)$/.exec(before);
  if (!match) return null;
  const [, leading, prefix] = match;
  const indent = whitespaceToColumn(0, options.insertSpaces ? options.indentSize ?? options.tabSize : options.tabSize, options.tabSize, options.insertSpaces);
  if (prefix === '!') {
    if (leading) return null; // START's program label must begin in column one.
    const column = (Math.floor(4 / options.tabSize) + 1) * options.tabSize;
    const gap = whitespaceToColumn(4, column, options.tabSize, options.insertSpaces);
    const body = whitespaceToColumn(0, column, options.tabSize, options.insertSpaces);
    return { prefix, snippet: '${1:MAIN}' + gap + 'START\n' + body + '${2:RET}\n' + body + 'END\n$0', description: 'CASL IIのプログラムひな形' };
  }
  const [operation, register] = prefix.split('.');
  if (register === 'gr0' && operation !== 'clr') return null; // GR0 is not an index register.
  const gr = register?.toUpperCase() ?? '${1|GR1,GR2,GR3,GR4,GR5,GR6,GR7|}';
  const same = register?.toUpperCase() ?? '$1';
  const operand = operation === 'clr' ? `${gr},0` : `${gr},${operation === 'inc' ? '1' : '-1'},${same}`;
  return { prefix, snippet: (leading ? '' : indent) + `LAD ${operand}$0`,
    description: operation === 'inc' ? 'レジスタを1増やす（FRを保持）' : operation === 'dec' ? 'レジスタを1減らす（FRを保持）' : 'レジスタを0にする（FRを保持）' };
}
