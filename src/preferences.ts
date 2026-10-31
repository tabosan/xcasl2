import { invoke } from '@tauri-apps/api/core';
import type { Settings, ThemePreference } from './types';

export function preferencesMarkup() {
  return `<dialog id="settings-dialog" class="devices-dialog"><h2>設定</h2>
    <p>配置と初期化の変更は次のアセンブルから有効です。設定は自動保存します。</p>
    <label class="device-heading" for="settings-theme">カラーテーマ</label><select id="settings-theme"><option value="light">ライト</option><option value="dark">ダーク</option><option value="system">OSと同期</option></select>
    <label class="device-heading" for="settings-font-family">エディターのフォントファミリー</label><input id="settings-font-family" type="text" maxlength="1024" placeholder="Consolas, 'Courier New', monospace" spellcheck="false" /><p class="device-note">候補をカンマ区切りで指定します。空白を含む名前は引用符で囲んでください。</p>
    <label class="device-heading" for="settings-font-size">エディターのフォントサイズ（px）</label><input id="settings-font-size" type="number" min="8" max="72" step="1" />
    <label class="device-heading" for="settings-auto-step">表示モード変更時のSTEP単位</label><select id="settings-auto-step"><option value="true">自動切り替え（CASL: 命令 / COMET: 最小STEP）</option><option value="false">手動（現在のSTEP単位を維持）</option></select>
    <label class="device-heading" for="settings-comment-overwrite">自動コメントと既存のコメント</label><select id="settings-comment-overwrite"><option value="false">既存のコメントを保持する</option><option value="true">生成対象の行のコメントを上書きする</option></select><p class="device-note">対象外の命令・エラー行のコメントは保持します。</p>
    <label class="device-heading" for="settings-base">配置先頭番地（16進数）</label><input id="settings-base" maxlength="4" aria-label="配置先頭番地" />
    <label class="device-heading" for="settings-fill">ロード時の初期化</label><select id="settings-fill"><option value="65535">FFFF（−1）</option><option value="0">0000（0）</option></select>
    <label class="device-heading" for="settings-interval">時間実行の間隔（ms / 0で高速）</label><input id="settings-interval" type="number" min="0" max="60000" />
    <label class="device-heading" for="settings-signed-decimal">CASLの10進表示（レジスタ・ラベル）</label><select id="settings-signed-decimal"><option value="true">符号付き（2の補数：FFFF → −1）</option><option value="false">符号なし（FFFF → 65535）</option></select>
    <p id="settings-path" class="device-note"></p><p id="settings-error" class="error" role="alert"></p>
    <div class="device-actions"><button id="settings-cancel">キャンセル</button><button id="settings-apply" class="primary">保存</button></div>
  </dialog>`;
}

export async function editPreferences(current: Settings, path: string): Promise<Settings | null> {
  const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const dialog = el<HTMLDialogElement>('settings-dialog');
  const base = el<HTMLInputElement>('settings-base'), fill = el<HTMLSelectElement>('settings-fill');
  const interval = el<HTMLInputElement>('settings-interval');
  const signedDecimal = el<HTMLSelectElement>('settings-signed-decimal');
  const theme = el<HTMLSelectElement>('settings-theme'); theme.value = current.theme;
  const fontFamily = el<HTMLInputElement>('settings-font-family'), fontSize = el<HTMLInputElement>('settings-font-size');
  const autoStep = el<HTMLSelectElement>('settings-auto-step');
  fontFamily.value = current.editor_font_family; fontSize.value = String(current.editor_font_size);
  autoStep.value = String(current.auto_switch_step_mode);
  const commentOverwrite = el<HTMLSelectElement>('settings-comment-overwrite'); commentOverwrite.value = String(current.auto_comment_overwrite);
  base.value = current.base.toString(16).toUpperCase().padStart(4, '0');
  fill.value = String(current.fill); interval.value = String(current.interval_ms);
  signedDecimal.value = String(current.signed_decimal);
  el('settings-path').textContent = `保存先: ${path}`;
  el('settings-error').textContent = '';
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
        el('settings-error').textContent = 'フォントファミリーと、8〜72の整数のフォントサイズを指定してください。'; return;
      }
      const next = { ...current, theme: theme.value as ThemePreference, base: parseInt(base.value, 16), fill: Number(fill.value), interval_ms: Number(interval.value), signed_decimal: signedDecimal.value === 'true', editor_font_family: fontFamily.value.trim(), editor_font_size: Number(fontSize.value), auto_switch_step_mode: autoStep.value === 'true', auto_comment_overwrite: commentOverwrite.value === 'true' };
      working = true;
      for (const control of dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input,select,button')) control.disabled = true;
      try { await invoke('set_settings', { settings: next }); result = next; dialog.close(); }
      catch (error) { el('settings-error').textContent = String(error); }
      finally {
        working = false;
        for (const control of dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input,select,button')) control.disabled = false;
      }
    };
    dialog.showModal();
  });
}
