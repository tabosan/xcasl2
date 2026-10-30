type TokenKind = 'label' | 'instruction' | 'directive' | 'macro' | 'register' | 'number' | 'string' | 'comment' | 'punctuation';

const instructions = new Set([
  'NOP', 'LD', 'ST', 'LAD', 'ADDA', 'SUBA', 'ADDL', 'SUBL', 'AND', 'OR', 'XOR',
  'CPA', 'CPL', 'SLA', 'SRA', 'SLL', 'SRL', 'JMI', 'JNZ', 'JZE', 'JUMP', 'JPL',
  'JOV', 'PUSH', 'POP', 'CALL', 'RET', 'SVC',
]);
const directives = new Set(['START', 'END', 'DS', 'DC']);
const macros = new Set(['IN', 'OUT', 'RPUSH', 'RPOP']);

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function span(kind: TokenKind, text: string): string {
  return `<span class="syntax-${kind}">${escapeHtml(text)}</span>`;
}

/** Presentation only. In particular, lowercase mnemonics remain unrecognised. */
export function highlightCasl(source: string): string {
  return source.split('\n').map(line => {
    // WCASL2 cuts comments even inside DC strings. Match the actual assembler.
    const commentStart = line.indexOf(';');
    const code = commentStart < 0 ? line : line.slice(0, commentStart);
    let result = '';
    let position = 0;
    let field: 'label' | 'operation' | 'operand' = /^[ \t]/.test(code) ? 'operation' : 'label';
    while (position < code.length) {
      const rest = code.slice(position);
      const whitespace = /^[ \t\r]+/.exec(rest)?.[0];
      if (whitespace) { result += escapeHtml(whitespace); position += whitespace.length; continue; }
      if (field !== 'operand') {
        const word = /^[^ \t\r]+/.exec(rest)![0];
        const kind = field === 'label' ? 'label' : directives.has(word) ? 'directive'
          : macros.has(word) ? 'macro' : instructions.has(word) ? 'instruction' : null;
        result += kind ? span(kind, word) : escapeHtml(word);
        field = field === 'label' ? 'operation' : 'operand';
        position += word.length;
        continue;
      }
      if (rest[0] === "'") {
        let end = position + 1;
        while (end < code.length) {
          if (code[end++] === "'") {
            if (code[end] !== "'") break;
            end++;
          }
        }
        result += span('string', code.slice(position, end)); position = end; continue;
      }
      if (rest[0] === ',' || rest[0] === '=') {
        result += span('punctuation', rest[0]); position++; continue;
      }
      const word = /^[^ \t\r,'=]+/.exec(rest)![0];
      const kind = /^GR[0-7]$/.test(word) ? 'register' : /^(?:-?\d+|#[0-9A-Fa-f]+)$/.test(word) ? 'number'
        : /^[A-Z]/.test(word) ? 'label' : null;
      result += kind ? span(kind, word) : escapeHtml(word);
      position += word.length;
    }
    return result + (commentStart < 0 ? '' : span('comment', line.slice(commentStart)));
  }).join('\n');
}

/** Keep the native textarea as the only editable and accessible text surface. */
export function attachHighlight(editor: HTMLTextAreaElement, layer: HTMLPreElement, gutter: HTMLPreElement): (() => void) & { dispose: () => void } {
  let rendered: string | null = null;
  const syncScroll = () => {
    // Use the text viewport, excluding native scrollbars, so the last column and
    // last line can scroll to exactly the same offset in both surfaces.
    layer.style.width = `${editor.clientWidth}px`;
    layer.style.height = `${editor.clientHeight}px`;
    gutter.style.paddingBottom = `${parseFloat(getComputedStyle(editor).paddingBottom) + editor.offsetHeight - editor.clientHeight}px`;
    layer.scrollTop = editor.scrollTop;
    layer.scrollLeft = editor.scrollLeft;
    gutter.scrollTop = editor.scrollTop;
  };
  const render = () => {
    if (rendered !== editor.value) {
      rendered = editor.value;
      // A zero-width sentinel keeps a final empty line measurable in the pre.
      layer.innerHTML = highlightCasl(rendered) + '\u200b';
    }
    syncScroll();
  };
  editor.addEventListener('scroll', syncScroll);
  const observer = new ResizeObserver(syncScroll);
  observer.observe(editor);
  return Object.assign(render, { dispose() { observer.disconnect(); editor.removeEventListener('scroll', syncScroll); } });
}
