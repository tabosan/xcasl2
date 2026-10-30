import { attachHighlight } from './highlight';
import type { SourceDocument } from './workbench';
import { EditHistory, type EditState } from './edit-history';

export class SourceEditor {
  readonly root = document.createElement('div');
  readonly textarea: HTMLTextAreaElement;
  readonly gutter: HTMLPreElement;
  readonly renderHighlight: ReturnType<typeof attachHighlight>;
  private history: EditHistory;
  composing = false;
  constructor(readonly document: SourceDocument, private onChange: () => void, private onPosition: () => void) {
    this.root.className = 'editor-wrap editor-buffer';
    this.root.innerHTML = '<pre class="gutter" aria-hidden="true"></pre><div class="source-editor"><pre class="source-highlight" aria-hidden="true"></pre><textarea wrap="off" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off"></textarea></div>';
    this.textarea = this.root.querySelector('textarea')!;
    this.gutter = this.root.querySelector('.gutter')!;
    this.textarea.value = document.source;
    this.history = new EditHistory(this.editState());
    this.renderHighlight = attachHighlight(this.textarea, this.root.querySelector('.source-highlight')!, this.gutter);
    this.textarea.addEventListener('beforeinput', () => this.history.before(this.editState()));
    this.textarea.addEventListener('compositionstart', () => { this.composing = true; });
    this.textarea.addEventListener('compositionend', () => { this.composing = false; onChange(); });
    this.textarea.addEventListener('input', event => { this.history.record(this.editState(), /history/i.test((event as InputEvent).inputType)); document.source = this.textarea.value; this.render(); onChange(); onPosition(); });
    for (const event of ['click', 'keyup', 'select', 'focus']) this.textarea.addEventListener(event, onPosition);
    this.textarea.addEventListener('keydown', event => {
      if (event.ctrlKey && !event.altKey && !event.isComposing && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault(); event.stopPropagation(); this.editCommand(event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo'); return;
      }
      if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.isComposing) {
        event.preventDefault();
        // insertText participates in the textarea's native undo history.
        if (!window.document.execCommand('insertText', false, '    ')) {
          this.history.before(this.editState());
          this.textarea.setRangeText('    ', this.textarea.selectionStart, this.textarea.selectionEnd, 'end');
          this.history.record(this.editState());
          document.source = this.textarea.value; this.render(); onChange();
        }
      }
    });
    this.render();
  }
  private editState(): EditState { const field = this.textarea; return { value: field.value, start: field.selectionStart, end: field.selectionEnd, top: field.scrollTop, left: field.scrollLeft }; }
  editCommand(command: 'undo' | 'redo') {
    this.textarea.focus({ preventScroll: true });
    // Keep native coalescing/IME behavior while its history is available.
    const before = this.textarea.value;
    window.document.execCommand(command);
    if (this.textarea.value !== before) return;
    const state = this.history.move(command === 'undo' ? -1 : 1); if (!state) return;
    this.textarea.value = state.value; this.textarea.setSelectionRange(state.start, state.end);
    this.textarea.scrollTop = state.top; this.textarea.scrollLeft = state.left;
    this.document.source = state.value; this.render(); this.onChange(); this.onPosition();
  }
  render() {
    this.textarea.setAttribute('aria-label', `${this.document.name} — CASL II ソースコード`);
    this.gutter.textContent = Array.from({ length: this.document.source.split('\n').length }, (_, i) => String(i + 1)).join('\n');
    this.renderHighlight();
  }
  reveal(line: number, length: number) {
    const start = this.textarea.value.split('\n').slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
    this.textarea.focus(); this.textarea.setSelectionRange(start, start + length);
    this.textarea.scrollTop = Math.max(0, (line - 1) * parseFloat(getComputedStyle(this.textarea).lineHeight) - this.textarea.clientHeight / 3);
    this.renderHighlight();
  }
  dispose() { this.renderHighlight.dispose(); this.root.remove(); }
}
