// The full entry point registers Monaco's standard editor contributions.
// NLS must run before editor contributions register their labels.
import 'monaco-editor/nls/lang/ja';
import * as monaco from 'monaco-editor';
import EditorWorker from './workers/editor.worker?worker';
import JsonWorker from './workers/json.worker?worker';
import CssWorker from './workers/css.worker?worker';
import HtmlWorker from './workers/html.worker?worker';
import TsWorker from './workers/ts.worker?worker';
import { directives, instructions, macros, tokenizeCaslLine } from './highlight';
import { analyseCasl, definitionsFor, occurrenceAt, referencesFor, tokenAt, type CaslOccurrence } from './casl-language';
import { caslAbbreviation } from './abbreviations';

(self as typeof self & { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === 'json') return new JsonWorker();
    if (['css', 'scss', 'less'].includes(label)) return new CssWorker();
    if (['html', 'handlebars', 'razor'].includes(label)) return new HtmlWorker();
    if (['typescript', 'javascript'].includes(label)) return new TsWorker();
    return new EditorWorker();
  },
};

const language = 'casl2';
const rangeOf = (item: CaslOccurrence) => new monaco.Range(item.line, item.column, item.line, item.endColumn);
class LineState implements monaco.languages.IState {
  clone() { return this; }
  equals(other: monaco.languages.IState) { return other instanceof LineState; }
}
let initialized = false;
function applyEditorTheme() {
  const light = document.documentElement.dataset.theme === 'light', css = getComputedStyle(document.documentElement);
  const color = (name: string) => css.getPropertyValue(`--${name}`).trim();
  const kinds = ['instruction', 'directive', 'register', 'label', 'number', 'string', 'comment'] as const;
  monaco.editor.defineTheme('xcasl2', {
    base: light ? 'vs' : 'vs-dark', inherit: true,
    rules: [...kinds.map(kind => ({ token: `${kind}.casl2`, foreground: color(`syntax-${kind}`).slice(1) })),
      { token: 'macro.casl2', foreground: color('syntax-directive').slice(1) },
      { token: 'punctuation.casl2', foreground: color('editor-fg').slice(1) }],
    colors: { 'editor.background': color('bg'), 'editor.foreground': color('editor-fg'),
      'editorLineNumber.foreground': color('subtle'), 'editorCursor.foreground': color('caret'),
      'editorWidget.background': color('raised'), 'editorWidget.border': color('border-strong'),
      'menu.background': color('context-menu-bg'), 'menu.foreground': color('context-menu-fg'),
      'menu.border': color('context-menu-border'), 'menu.separatorBackground': color('context-menu-separator'),
      'menu.selectionBackground': color('context-menu-selection-bg'), 'menu.selectionForeground': color('context-menu-selection-fg'),
      'menu.selectionBorder': '#00000000', 'disabledForeground': color('muted'),
      // Monaco's menu implementation also reads the shared list hover colors.
      'list.hoverBackground': color('context-menu-selection-bg'), 'list.hoverForeground': color('context-menu-selection-fg') },
  });
  monaco.editor.setTheme('xcasl2');
}
export function initializeMonaco() {
  if (initialized) return;
  initialized = true;
  monaco.languages.register({ id: language, extensions: ['.cas'], aliases: ['CASL II', 'casl2'] });
  monaco.languages.setTokensProvider(language, {
    getInitialState: () => new LineState(),
    tokenize: (line, state) => ({ tokens: tokenizeCaslLine(line).map(t => ({ startIndex: t.startIndex, scopes: t.kind ? `${t.kind}.casl2` : '' })), endState: state }),
  });
  monaco.languages.setLanguageConfiguration(language, {
    comments: { lineComment: ';' },
    wordPattern: /[A-Za-z_][A-Za-z0-9_]*|#[0-9A-Fa-f]+|-?\d+/g,
    brackets: [], autoClosingPairs: [], surroundingPairs: [{ open: "'", close: "'" }],
    folding: { markers: { start: /^\s*;\s*#region\b/, end: /^\s*;\s*#endregion\b/ } },
  });
  const cache = new WeakMap<monaco.editor.ITextModel, { version: number; value: ReturnType<typeof analyseCasl> }>();
  const analyse = (model: monaco.editor.ITextModel) => {
    const old = cache.get(model), version = model.getVersionId();
    if (old?.version === version) return old.value;
    const value = analyseCasl(model.getValue()); cache.set(model, { version, value }); return value;
  };
  const at = (model: monaco.editor.ITextModel, position: monaco.Position) => occurrenceAt(analyse(model), position.lineNumber, position.column);
  monaco.languages.registerCompletionItemProvider(language, {
    triggerCharacters: [',', '=', '!', '.'],
    provideCompletionItems(model, position) {
      const line = model.getLineContent(position.lineNumber), previous = tokenAt(line, position.column - 1);
      if (previous?.kind === 'comment' || previous?.kind === 'string') return { suggestions: [] };
      const word = model.getWordUntilPosition(position), range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      const prefix = line.slice(0, position.column - 1), operationField = /^(?:[ \t]+|[^ \t]+[ \t]+)[^ \t]*$/.test(prefix);
      const suggestions: monaco.languages.CompletionItem[] = [];
      const expansion = caslAbbreviation(line, position.column, model.getOptions());
      if (expansion) suggestions.push({ label: expansion.prefix, detail: expansion.description,
        kind: monaco.languages.CompletionItemKind.Snippet, insertText: expansion.snippet,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet | monaco.languages.CompletionItemInsertTextRule.KeepWhitespace,
        range: new monaco.Range(position.lineNumber, position.column - expansion.prefix.length, position.lineNumber, position.column), sortText: '0' });
      if (operationField) {
        for (const [set, detail] of [[instructions, 'CASL II 命令'], [directives, 'アセンブラ指令'], [macros, 'マクロ']] as const)
          for (const label of set) suggestions.push({ label, insertText: label, kind: monaco.languages.CompletionItemKind.Keyword, detail, range });
      } else if (/\s/.test(prefix)) {
        for (let i = 0; i < 8; i++) suggestions.push({ label: `GR${i}`, insertText: `GR${i}`, kind: monaco.languages.CompletionItemKind.Variable, detail: '汎用レジスタ', range });
        const analysis = analyse(model), section = [...analysis.occurrences].reverse().find(o => o.line <= position.lineNumber)?.section ?? 0;
        const seen = new Set<string>();
        for (const symbol of analysis.symbols.filter(s => s.section === section || s.operation === 'START')) {
          if (seen.has(symbol.name)) continue; seen.add(symbol.name);
          suggestions.push({ label: symbol.name, insertText: symbol.name, kind: monaco.languages.CompletionItemKind.Reference, detail: `${symbol.operation || 'ラベル'} · ${symbol.line}行`, range });
        }
      }
      return { suggestions };
    },
  });
  monaco.languages.registerDefinitionProvider(language, {
    provideDefinition(model, position) {
      const item = at(model, position); return item ? definitionsFor(analyse(model), item).map(s => ({ uri: model.uri, range: rangeOf(s) })) : [];
    },
  });
  monaco.languages.registerReferenceProvider(language, {
    provideReferences(model, position, context) {
      const analysis = analyse(model), item = at(model, position); if (!item) return [];
      const definitions = definitionsFor(analysis, item); if (definitions.length !== 1) return [];
      return referencesFor(analysis, definitions[0]).filter(o => context.includeDeclaration || !o.declaration).map(o => ({ uri: model.uri, range: rangeOf(o) }));
    },
  });
  monaco.languages.registerRenameProvider(language, {
    resolveRenameLocation(model, position) {
      const item = at(model, position); return item ? { range: rangeOf(item), text: item.name } : null;
    },
    provideRenameEdits(model, position, name) {
      const analysis = analyse(model), item = at(model, position), definitions = item ? definitionsFor(analysis, item) : [];
      if (!/^[A-Z][A-Z0-9]{0,7}$/.test(name) || /^GR[0-7]$/.test(name)) return { edits: [], rejectReason: '新しいラベルは英大文字で始まる8文字以内の英大文字・数字で指定してください（GR0〜GR7を除く）。' };
      if (definitions.length !== 1) return { edits: [], rejectReason: 'このファイルで定義を一意に特定できません。' };
      if (definitions[0].operation === 'START') return { edits: [], rejectReason: 'STARTのプログラム名は他のファイルから参照されるため、呼出し元と合わせて編集してください。' };
      if (analysis.symbols.some(s => s.name === name && s.line !== definitions[0].line)) return { edits: [], rejectReason: '同じ名前のラベルが既にあります。' };
      return { edits: referencesFor(analysis, definitions[0]).map(o => ({ resource: model.uri, versionId: model.getVersionId(), textEdit: { range: rangeOf(o), text: name } })) };
    },
  });
  monaco.languages.registerHoverProvider(language, {
    provideHover(model, position) {
      const line = model.getLineContent(position.lineNumber), token = tokenAt(line, position.column);
      if (!token?.kind) return null;
      const word = line.slice(token.startIndex, token.endIndex), range = new monaco.Range(position.lineNumber, token.startIndex + 1, position.lineNumber, token.endIndex + 1);
      if (token.kind === 'label') {
        const item = at(model, position), definitions = item ? definitionsFor(analyse(model), item) : [];
        return definitions.length ? { range, contents: definitions.map(s => ({ value: `**${s.name}** · ${s.line}行目\n\n${s.operation || 'ラベル'}`, isTrusted: false })) } : null;
      }
      if (token.kind === 'register') return { range, contents: [{ value: `**${word}** — 16ビット汎用レジスタ` }] };
      return null;
    },
  });
  monaco.languages.registerDocumentSymbolProvider(language, {
    provideDocumentSymbols(model) {
      return analyse(model).symbols.map(s => ({ name: s.name, detail: s.operation, kind: s.operation === 'START' ? monaco.languages.SymbolKind.Function : s.operation === 'DC' ? monaco.languages.SymbolKind.Constant : monaco.languages.SymbolKind.Variable, tags: [], range: rangeOf(s), selectionRange: rangeOf(s) }));
    },
  });
  monaco.languages.registerFoldingRangeProvider(language, {
    provideFoldingRanges: model => analyse(model).sections.filter(s => s.end > s.start).map(s => ({ start: s.start, end: s.end })),
  });
  applyEditorTheme();
  new MutationObserver(applyEditorTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
export { monaco };
