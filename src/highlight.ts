export type TokenKind = 'label' | 'instruction' | 'directive' | 'macro' | 'register' | 'number' | 'string' | 'comment' | 'punctuation';
export interface CaslToken { startIndex: number; endIndex: number; kind: TokenKind | null }

export const instructions = new Set([
  'NOP', 'LD', 'ST', 'LAD', 'ADDA', 'SUBA', 'ADDL', 'SUBL', 'AND', 'OR', 'XOR',
  'CPA', 'CPL', 'SLA', 'SRA', 'SLL', 'SRL', 'JMI', 'JNZ', 'JZE', 'JUMP', 'JPL',
  'JOV', 'PUSH', 'POP', 'CALL', 'RET', 'SVC',
]);
export const directives = new Set(['START', 'END', 'DS', 'DC']);
export const macros = new Set(['IN', 'OUT', 'RPUSH', 'RPOP']);

/** The existing WCASL2 scanner, shared by Monaco and the HTML renderer.
 * Offsets use UTF-16, like Monaco. Lowercase operations stay unrecognised. */
export function tokenizeCaslLine(line: string): CaslToken[] {
  const commentStart = line.indexOf(';'); // WCASL2 cuts comments even inside DC strings.
  const code = commentStart < 0 ? line : line.slice(0, commentStart);
  const tokens: CaslToken[] = [];
  let position = 0;
  const emit = (kind: TokenKind | null, end: number) => { tokens.push({ startIndex: position, endIndex: end, kind }); position = end; };
  let field: 'label' | 'operation' | 'operand' = /^[ \t]/.test(code) ? 'operation' : 'label';
  while (position < code.length) {
    const rest = code.slice(position), whitespace = /^[ \t\r]+/.exec(rest)?.[0];
    if (whitespace) { emit(null, position + whitespace.length); continue; }
    if (field !== 'operand') {
      const word = /^[^ \t\r]+/.exec(rest)![0];
      const kind = field === 'label' ? 'label' : directives.has(word) ? 'directive'
        : macros.has(word) ? 'macro' : instructions.has(word) ? 'instruction' : null;
      emit(kind, position + word.length); field = field === 'label' ? 'operation' : 'operand'; continue;
    }
    if (rest[0] === "'") {
      let end = position + 1;
      while (end < code.length) {
        if (code[end++] === "'") { if (code[end] !== "'") break; end++; }
      }
      emit('string', end); continue;
    }
    if (rest[0] === ',' || rest[0] === '=') { emit('punctuation', position + 1); continue; }
    const word = /^[^ \t\r,'=]+/.exec(rest)![0];
    const kind = /^GR[0-7]$/.test(word) ? 'register' : /^(?:-?\d+|#[0-9A-Fa-f]+)$/.test(word) ? 'number'
      : /^[A-Z]/.test(word) ? 'label' : null;
    emit(kind, position + word.length);
  }
  if (commentStart >= 0) tokens.push({ startIndex: commentStart, endIndex: line.length, kind: 'comment' });
  return tokens;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}
export function highlightCasl(source: string): string {
  return source.split('\n').map(line => tokenizeCaslLine(line).map(token => {
    const text = escapeHtml(line.slice(token.startIndex, token.endIndex));
    return token.kind ? `<span class="syntax-${token.kind}">${text}</span>` : text;
  }).join('')).join('\n');
}
