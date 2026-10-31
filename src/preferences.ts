import { invoke } from '@tauri-apps/api/core';
import type { Settings, ThemePreference } from './types';

const sections = [['appearance', '外観'], ['editor', 'エディター'], ['assembly', 'アセンブル'], ['simulator', 'シミュレーター'], ['storage', '保存先']] as const;

export function preferencesMarkup() {
  return `<dialog id="settings-dialog" class="settings-dialog" aria-labelledby="settings-title">
    <h2 id="settings-title">設定</h2><p class="settings-intro">設定は「保存」で適用します。</p>
    <div class="settings-body"><nav class="settings-index" aria-label="設定の目次">${sections.map(([id, label]) => `<button type="button" data-settings-section="${id}">${label}</button>`).join('')}</nav>
    <div class="settings-content" id="settings-content">
      <section id="settings-section-appearance" class="settings-section"><h3 tabindex="-1">外観</h3>
        <label class="device-heading" for="settings-theme">カラーテーマ</label><select id="settings-theme"><option value="light">ライト</option><option value="dark">ダーク</option><option value="system">OSと同期</option></select>
      </section>
      <section id="settings-section-editor" class="settings-section"><h3 tabindex="-1">エディター</h3>
        <label class="device-heading" for="settings-font-family">フォントファミリー</label><input id="settings-font-family" type="text" maxlength="1024" placeholder="Consolas, 'Courier New', monospace" spellcheck="false" /><p class="device-note">候補をカンマ区切りで指定します。空白を含む名前は引用符で囲んでください。</p>
        <label class="device-heading" for="settings-font-size">フォントサイズ（px）</label><input id="settings-font-size" type="number" min="8" max="72" step="1" />
        <h4>既定のインデント</h4><p class="device-note">次に作成・開くファイルに使います。現在のファイルの設定や変換は、ステータスバーから操作できます。</p>
        <label class="settings-check"><input id="settings-insert-spaces" type="checkbox" />Editor: Insert Spaces — Tabキーでスペースを挿入</label>
        <label class="device-heading" for="settings-tab-size">Editor: Tab Size — タブの表示サイズ／インデント幅</label><input id="settings-tab-size" type="number" min="1" max="16" step="1" />
        <label class="settings-check"><input id="settings-detect-indentation" type="checkbox" />Editor: Detect Indentation — 開いたファイルの内容からインデントを検出</label>
        <h4>自動コメント</h4><label class="device-heading" for="settings-comment-overwrite">既存のコメント</label><select id="settings-comment-overwrite"><option value="false">既存のコメントを保持する</option><option value="true">生成対象の行のコメントを上書きする</option></select><p class="device-note">対象外の命令・エラー行のコメントは保持します。</p>
        <h4>略記の展開</h4><p class="device-note"><code>!</code>＋Tabでプログラムひな形、<code>inc</code>／<code>dec</code>／<code>clr</code>＋Tabでレジスタ操作を生成します。<code>inc.gr3</code>のようにレジスタも指定できます。</p>
      </section>
      <section id="settings-section-assembly" class="settings-section"><h3 tabindex="-1">アセンブル</h3><p class="device-note">配置と初期化の変更は次のアセンブルから有効です。</p>
        <label class="device-heading" for="settings-base">配置先頭番地（16進数）</label><input id="settings-base" maxlength="4" aria-label="配置先頭番地" />
        <label class="device-heading" for="settings-fill">ロード時の初期化</label><select id="settings-fill"><option value="65535">FFFF（−1）</option><option value="0">0000（0）</option></select>
      </section>
      <section id="settings-section-simulator" class="settings-section"><h3 tabindex="-1">シミュレーター</h3>
        <label class="device-heading" for="settings-auto-step">表示モード変更時のSTEP単位</label><select id="settings-auto-step"><option value="true">自動切り替え（CASL: 命令 / COMET: 最小STEP）</option><option value="false">手動（現在のSTEP単位を維持）</option></select>
        <label class="device-heading" for="settings-interval">時間実行の間隔（ms / 0で高速）</label><input id="settings-interval" type="number" min="0" max="60000" />
        <label class="device-heading" for="settings-signed-decimal">CASLの10進表示（レジスタ・ラベル）</label><select id="settings-signed-decimal"><option value="true">符号付き（2の補数：FFFF → −1）</option><option value="false">符号なし（FFFF → 65535）</option></select>
      </section>
      <section id="settings-section-storage" class="settings-section"><h3 tabindex="-1">保存先</h3><p id="settings-path" class="device-note"></p></section>
    </div></div>
    <div class="settings-footer"><p id="settings-error" class="error" role="alert"></p><div class="device-actions"><button id="settings-cancel">キャンセル</button><button id="settings-apply" class="primary">保存</button></div></div>
  </dialog>`;
}

export async function editPreferences(current: Settings, path: string): Promise<Settings | null> {
  const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const dialog = el<HTMLDialogElement>('settings-dialog'), content = el('settings-content');
  const navigate = (id: string) => {
    const section = el(`settings-section-${id}`);
    content.scrollTo({ top: section.offsetTop }); section.querySelector<HTMLElement>('h3')!.focus({ preventScroll: true });
    for (const button of dialog.querySelectorAll<HTMLElement>('[data-settings-section]')) button.setAttribute('aria-current', String(button.dataset.settingsSection === id));
  };
  for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-settings-section]')) button.onclick = () => navigate(button.dataset.settingsSection!);
  const base = el<HTMLInputElement>('settings-base'), fill = el<HTMLSelectElement>('settings-fill');
  const interval = el<HTMLInputElement>('settings-interval'), signedDecimal = el<HTMLSelectElement>('settings-signed-decimal');
  const theme = el<HTMLSelectElement>('settings-theme'); theme.value = current.theme;
  const fontFamily = el<HTMLInputElement>('settings-font-family'), fontSize = el<HTMLInputElement>('settings-font-size');
  const tabSize = el<HTMLInputElement>('settings-tab-size'), insertSpaces = el<HTMLInputElement>('settings-insert-spaces'), detectIndentation = el<HTMLInputElement>('settings-detect-indentation');
  fontFamily.value = current.editor_font_family; fontSize.value = String(current.editor_font_size);
  tabSize.value = String(current.editor_tab_size); insertSpaces.checked = current.editor_insert_spaces; detectIndentation.checked = current.editor_detect_indentation;
  const autoStep = el<HTMLSelectElement>('settings-auto-step'); autoStep.value = String(current.auto_switch_step_mode);
  const commentOverwrite = el<HTMLSelectElement>('settings-comment-overwrite'); commentOverwrite.value = String(current.auto_comment_overwrite);
  base.value = current.base.toString(16).toUpperCase().padStart(4, '0'); fill.value = String(current.fill); interval.value = String(current.interval_ms); signedDecimal.value = String(current.signed_decimal);
  el('settings-path').textContent = `保存先: ${path}`; el('settings-error').textContent = '';
  let working = false;
  return new Promise(resolve => {
    let result: Settings | null = null;
    dialog.addEventListener('close', () => resolve(result), { once: true });
    dialog.oncancel = event => { if (working) event.preventDefault(); };
    el('settings-cancel').onclick = () => dialog.close();
    el('settings-apply').onclick = async () => {
      if (!/^[0-9a-fA-F]{1,4}$/.test(base.value) || parseInt(base.value, 16) >= 3000 || interval.value === '' || !interval.checkValidity()) {
        el('settings-error').textContent = '番地は0000〜0BB7、間隔は0〜60000の整数で指定してください。'; return;
      }
      if (!fontFamily.value.trim() || fontFamily.value.length > 1024 || /[\u0000-\u001f\u007f]/.test(fontFamily.value) || fontSize.value === '' || !fontSize.checkValidity() || !Number.isInteger(Number(fontSize.value))) {
        el('settings-error').textContent = 'フォントファミリーと、8〜72の整数のフォントサイズを指定してください。'; navigate('editor'); return;
      }
      if (tabSize.value === '' || !tabSize.checkValidity() || !Number.isInteger(Number(tabSize.value))) {
        el('settings-error').textContent = 'タブの表示サイズは1〜16の整数で指定してください。'; navigate('editor'); return;
      }
      const next = { ...current, theme: theme.value as ThemePreference, base: parseInt(base.value, 16), fill: Number(fill.value), interval_ms: Number(interval.value), signed_decimal: signedDecimal.value === 'true', editor_font_family: fontFamily.value.trim(), editor_font_size: Number(fontSize.value), editor_tab_size: Number(tabSize.value), editor_insert_spaces: insertSpaces.checked, editor_detect_indentation: detectIndentation.checked, auto_switch_step_mode: autoStep.value === 'true', auto_comment_overwrite: commentOverwrite.value === 'true' };
      working = true;
      for (const control of dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input,select,button')) control.disabled = true;
      try { await invoke('set_settings', { settings: next }); result = next; dialog.close(); }
      catch (error) { el('settings-error').textContent = String(error); }
      finally { working = false; for (const control of dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input,select,button')) control.disabled = false; }
    };
    dialog.showModal(); navigate('appearance');
  });
}
