import { version } from '../package.json';
import { devicesMarkup } from './devices';
import { preferencesMarkup } from './preferences';
import { deleteConfirmationMarkup } from './delete-confirmation';
import { assembleIcon, newFileIcon, newFolderIcon, closeIcon, refreshIcon, chevronIcon, menuIcon } from './ui-icons';


const previewIcon = assembleIcon;
const fileIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6"/></svg>';
const explorerIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h11v15H8zM5 7H3v14h12v-2"/></svg>';
const gearIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 3-.6 2.3-2 .9L4.3 5.5 2.5 8.6l1.8 1.6v2.3l-1.8 1.7 1.8 3.1 2.1-.7 2 .9.6 2.5h3.7l.6-2.5 2-.9 2.1.7 1.8-3.1-1.8-1.7v-2.3l1.8-1.6-1.8-3.1-2.1.7-2-.9L12.7 3z"/><circle cx="10.8" cy="11.5" r="3"/></svg>';

export function layout() {
  return `<main class="workbench" id="workbench">
    <nav class="activity-bar" aria-label="アクティビティ"><button id="activity-explorer" class="activity selected" data-tooltip="エクスプローラー (Ctrl+B)" aria-label="エクスプローラー" aria-expanded="true">${explorerIcon}</button><div class="activity-spacer"></div><button id="activity-settings" class="activity" data-tooltip="設定" aria-label="設定">${gearIcon}</button></nav>
    <aside id="sidebar" class="sidebar" aria-label="エクスプローラー"><div class="sidebar-heading"><span>エクスプローラー</span><button id="sidebar-new" class="icon-button" data-tooltip="新しいCASLファイル (Ctrl+N)" aria-label="新しいCASLファイル">${newFileIcon}</button></div><section class="sidebar-section"><h2 class="tree-heading"><button class="section-toggle" data-sidebar-section="open-editors-content"><span class="section-chevron">${chevronIcon(true)}</span>開いているファイル</button></h2><div id="open-editors-content"><div id="open-editors" class="tree-list"></div></div></section><section id="folder-section" class="folder-section" aria-label="開いているフォルダー"><div class="tree-heading folder-heading"><h2><button class="section-toggle" data-sidebar-section="folder-content"><span class="section-chevron">${chevronIcon(true)}</span>フォルダー</button></h2><div class="folder-actions"><button id="folder-new-file" class="icon-button" aria-label="新しいファイル" data-tooltip="選択したフォルダーにファイルを作成">${newFileIcon}</button><button id="folder-new-directory" class="icon-button" aria-label="新しいフォルダー" data-tooltip="選択したフォルダーにフォルダーを作成">${newFolderIcon}</button><button id="folder-refresh" class="icon-button" aria-label="フォルダーを更新" data-tooltip="フォルダーを更新">${refreshIcon}</button><button id="folder-close" class="icon-button" aria-label="フォルダーを閉じる" data-tooltip="フォルダーを閉じる">${closeIcon}</button></div></div><div id="folder-content"><div id="folder-tree" class="folder-tree" role="tree" aria-label="フォルダーの内容"></div><button id="folder-open" class="sidebar-link">フォルダーを開く…</button></div></section><section class="sidebar-section"><h2 class="tree-heading"><button class="section-toggle" data-sidebar-section="project-content"><span class="section-chevron">${chevronIcon(true)}</span>プロジェクト</button></h2><div id="project-content"><div class="project-heading"><span id="project-name">cmkは開かれていません</span></div><div id="project-tree" class="tree-list"></div><button id="sidebar-project-open" class="sidebar-link">cmkを開く…</button></div></section><div class="sidebar-hint">ソース右上の ${previewIcon} から<br>シミュレーターを右に開けます。</div></aside>
    <div id="sidebar-divider" class="sidebar-divider" role="separator" aria-label="エクスプローラーの幅" aria-orientation="vertical" aria-controls="sidebar" tabindex="0" data-tooltip="ドラッグで幅を変更、ダブルクリックで元の幅に戻す"></div>
    <div class="workbench-main">
      <div id="editor-groups" class="editor-groups" aria-label="エディターグループ"></div>
      <section id="diagnostics-panel" class="diagnostics-panel" hidden><div class="panel-heading"><h2>アセンブラ出力</h2><span id="diagnostic-count"></span><button id="diagnostics-close" class="icon-button" data-tooltip="出力を閉じる" aria-label="アセンブラ出力を閉じる">×</button></div><div id="diagnostics" role="status" aria-live="polite"></div></section>
    </div>
  </main>
  <footer class="status-bar"><button id="status-sidebar" data-tooltip="エクスプローラー切替" aria-label="エクスプローラー切替">${menuIcon}</button><span id="message" role="status">ファイルを開いて編集を始められます。</span><span id="cursor-position"></span><button id="status-indentation" aria-label="インデント設定" aria-haspopup="menu" data-tooltip="現在のファイルのインデント設定" hidden>スペース: 4</button><span>CP932</span><span>CRLF</span><span>CASL II</span><span id="connection">Rust + Tauri</span></footer>
  <dialog id="confirm-dialog"><h2 id="confirm-title"></h2><p id="confirm-message"></p><form method="dialog"><button value="cancel">キャンセル</button><button value="discard">保存しない</button><button value="save" class="primary">保存する</button></form></dialog>
  <dialog id="about-dialog"><h2>xCASL2</h2><p id="about-version">バージョン ${version}</p><p>Rust + TauriによるCASL IIワークベンチです。</p><p>ファイルごとの編集タブとシミュレーター、シンタックスハイライト、命令／フェーズ／最小STEP、COMET、再実行による戻り、CP932の入出力、cmk、設定の保存に対応しています。</p><p>シミュレーターはアセンブル時のソースを使います。編集・配置設定の変更後は再アセンブルしてください。cmkに含まれるソースでは、選択ファイルを先頭にして登録ファイルをリンクします。</p><p>開いているタブと実行状態の再起動後の復元、印刷は未実装です。</p><form method="dialog"><button class="primary">閉じる</button></form></dialog>
  ${deleteConfirmationMarkup}${devicesMarkup()}${preferencesMarkup()}`;
}
