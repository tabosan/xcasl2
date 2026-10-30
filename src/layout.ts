import { devicesMarkup } from './devices';
import { preferencesMarkup } from './preferences';

const previewIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M12 4v16M6 9l3 3-3 3m10-6 3 3-3 3"/></svg>';
const fileIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6"/></svg>';
const explorerIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h11v15H8zM5 7H3v14h12v-2"/></svg>';
const gearIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 3-.6 2.3-2 .9L4.3 5.5 2.5 8.6l1.8 1.6v2.3l-1.8 1.7 1.8 3.1 2.1-.7 2 .9.6 2.5h3.7l.6-2.5 2-.9 2.1.7 1.8-3.1-1.8-1.7v-2.3l1.8-1.6-1.8-3.1-2.1.7-2-.9L12.7 3z"/><circle cx="10.8" cy="11.5" r="3"/></svg>';

export function layout() {
  return `<main class="workbench" id="workbench">
    <nav class="activity-bar" aria-label="アクティビティ"><button id="activity-explorer" class="activity selected" title="エクスプローラー (Ctrl+B)" aria-label="エクスプローラー" aria-expanded="true">${explorerIcon}</button><div class="activity-spacer"></div><button id="activity-settings" class="activity" title="設定" aria-label="設定">${gearIcon}</button></nav>
    <aside id="sidebar" class="sidebar" aria-label="エクスプローラー"><div class="sidebar-heading"><span>エクスプローラー</span><button id="sidebar-new" class="icon-button" title="新しいCASLファイル (Ctrl+N)" aria-label="新しいCASLファイル">＋</button></div><h2 class="tree-heading">⌄ 開いているファイル</h2><div id="open-editors" class="tree-list"></div><h2 class="tree-heading">⌄ プロジェクト</h2><div class="project-heading"><span id="project-name">cmkは開かれていません</span></div><div id="project-tree" class="tree-list"></div><button id="sidebar-project-open" class="sidebar-link">cmkを開く…</button><div class="sidebar-hint">ソース右上の ${previewIcon} から<br>シミュレーターを右に開けます。</div></aside>
    <div class="workbench-main">
      <div id="find-bar" class="find-bar" hidden><input id="find-text" type="search" placeholder="検索" aria-label="ソース内を検索"><span id="find-result"></span><button id="find-previous" class="icon-button" title="前を検索" aria-label="前を検索">↑</button><button id="find-next" class="icon-button" title="次を検索" aria-label="次を検索">↓</button><button id="find-close" class="icon-button" title="検索を閉じる" aria-label="検索を閉じる">×</button></div>
      <div id="editor-groups" class="editor-groups" aria-label="エディターグループ"></div>
      <section id="diagnostics-panel" class="diagnostics-panel" hidden><div class="panel-heading"><h2>アセンブラ出力</h2><span id="diagnostic-count"></span><button id="diagnostics-close" class="icon-button" title="出力を閉じる" aria-label="アセンブラ出力を閉じる">×</button></div><div id="diagnostics" role="status" aria-live="polite"></div></section>
    </div>
  </main>
  <footer class="status-bar"><button id="status-sidebar" title="エクスプローラー切替" aria-label="エクスプローラー切替">☰</button><span id="message" role="status">ファイルを開いて編集を始められます。</span><span id="cursor-position"></span><span>CP932</span><span>CRLF</span><span>CASL II</span><span id="connection">Rust + Tauri</span></footer>
  <dialog id="confirm-dialog"><h2 id="confirm-title"></h2><p id="confirm-message"></p><form method="dialog"><button value="cancel">キャンセル</button><button value="discard">保存しない</button><button value="save" class="primary">保存する</button></form></dialog>
  <dialog id="about-dialog"><h2>xCASL2</h2><p>Rust + TauriによるWCASL2互換のCASL IIワークベンチです。</p><p>ファイルごとの編集タブとシミュレーター、シンタックスハイライト、命令／フェーズ／最小STEP、COMET、再実行による戻り、CP932の入出力、cmk、設定の保存に対応しています。</p><p>シミュレーターはアセンブル時のソースを使います。編集・配置設定の変更後は再アセンブルしてください。cmkに含まれるソースでは、選択ファイルを先頭にして登録ファイルをリンクします。</p><p>開いているタブと実行状態の再起動後の復元、印刷は未実装です。</p><form method="dialog"><button class="primary">閉じる</button></form></dialog>
  ${devicesMarkup()}${preferencesMarkup()}`;
}
