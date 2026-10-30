import { initializeMonaco, monaco } from './monaco';
import type { Diagnostic } from './types';
import type { SourceDocument } from './workbench';

export class SourceEditor {
  readonly root = document.createElement('div');
  readonly model: monaco.editor.ITextModel;
  readonly editor: monaco.editor.IStandaloneCodeEditor;
  composing = false;
  private replacing = false;
  private label = '';
  private markers = '';
  private disposables: monaco.IDisposable[] = [];
  constructor(readonly document: SourceDocument, private onChange: () => void, private onPosition: () => void) {
    initializeMonaco();
    this.root.className = 'editor-wrap editor-buffer monaco-source';
    // Floating shadow-root menus inherit their theme variables from this host.
    const host = window.document.createElement('div'); host.className = 'monaco-host monaco-component'; this.root.append(host);
    this.model = monaco.editor.createModel(document.source, 'casl2', monaco.Uri.from({ scheme: 'inmemory', authority: 'xcasl2', path: `/${document.id}/${document.name}` }));
    this.model.setEOL(monaco.editor.EndOfLineSequence.LF);
    this.model.updateOptions({ tabSize: 4, insertSpaces: true });
    this.editor = monaco.editor.create(host, {
      model: this.model, theme: 'xcasl2', automaticLayout: true,
      fontFamily: '"Cascadia Code", Consolas, "BIZ UDGothic", monospace', fontSize: 14, lineHeight: 23,
      tabSize: 4, insertSpaces: true, detectIndentation: false,
      minimap: { enabled: true }, folding: true, showFoldingControls: 'mouseover',
      lineNumbers: 'on', glyphMargin: true, scrollBeyondLastLine: true,
      wordWrap: 'off', padding: { top: 16, bottom: 16 }, contextmenu: true,
      // Fixed menus escape the editor group's clipped/scrolling viewport.
      useShadowDOM: true, fixedOverflowWidgets: true, accessibilitySupport: 'auto',
      // Use Monaco's established input path for WebView IME/native edit menus.
      editContext: false,
      // These are part of WCASL2's source syntax; do not flag Japanese strings.
      unicodeHighlight: { ambiguousCharacters: false, nonBasicASCII: false },
      quickSuggestions: { other: true, comments: false, strings: false },
    });
    this.disposables.push(
      this.model.onDidChangeContent(() => {
        if (this.replacing) return;
        document.source = this.model.getValue(); this.onChange(); this.onPosition();
      }),
      this.editor.onDidChangeCursorPosition(onPosition),
      this.editor.onDidFocusEditorText(onPosition),
      this.editor.onDidCompositionStart(() => { this.composing = true; }),
      this.editor.onDidCompositionEnd(() => { this.composing = false; onChange(); }),
    );
    this.render();
  }
  focus() { this.editor.focus(); }
  hasTextFocus() { return this.editor.hasTextFocus(); }
  position() { return this.editor.getPosition(); }
  editCommand(command: 'undo' | 'redo') { this.focus(); this.editor.trigger('menu', command, null); }
  find(replace = false) {
    this.focus(); void this.editor.getAction(replace ? 'editor.action.startFindReplaceAction' : 'actions.find')?.run();
  }
  commandPalette() { this.focus(); void this.editor.getAction('editor.action.quickCommand')?.run(); }
  replaceSource(source: string) {
    if (this.model.getValue() === source) return;
    this.replacing = true;
    try { this.model.setValue(source); } finally { this.replacing = false; }
  }
  setDiagnostics(diagnostics: Diagnostic[]) {
    const key = JSON.stringify(diagnostics); if (key === this.markers) return; this.markers = key;
    monaco.editor.setModelMarkers(this.model, 'xcasl2-assembler', diagnostics.filter(d => d.line > 0).map(d => {
      const line = Math.min(d.line, this.model.getLineCount());
      return { severity: monaco.MarkerSeverity.Error, message: d.message, code: String(d.code), startLineNumber: line, endLineNumber: line,
        startColumn: 1, endColumn: Math.max(2, this.model.getLineMaxColumn(line)) };
    }));
  }
  render() {
    // The model/editor live as long as this file. Rendering or moving tabs never
    // recreates them, so Monaco retains undo, selections and find state.
    this.replaceSource(this.document.source);
    const label = `${this.document.name} — CASL II ソースコード`;
    if (label !== this.label) { this.label = label; this.editor.updateOptions({ ariaLabel: label }); }
    this.editor.layout();
  }
  reveal(line: number, length: number) {
    const target = Math.max(1, Math.min(line, this.model.getLineCount()));
    this.editor.setSelection(new monaco.Range(target, 1, target, Math.min(length + 1, this.model.getLineMaxColumn(target))));
    this.editor.revealLineInCenterIfOutsideViewport(target); this.focus();
  }
  dispose() {
    this.disposables.forEach(item => item.dispose()); this.editor.dispose(); this.model.dispose(); this.root.remove();
  }
}
