import { invoke } from '@tauri-apps/api/core';
import type { DeviceConfig, Snapshot } from './types';

export function devicesMarkup(): string {
  return `<dialog id="devices-dialog" class="devices-dialog">
    <h2>入出力装置</h2><p id="devices-context"></p><p>適用すると対象のシミュレーターをリロードし、入力を先頭から読み直します。他のタブの実行状態は保持します。</p>
    <label class="device-heading" for="device-input-mode">入力元</label>
    <select id="device-input-mode"><option value="keyboard">キーボード</option><option value="file">ファイル（CP932）</option></select>
    <div class="device-path-row"><input id="device-input-path" aria-label="入力ファイルのパス" placeholder="入力ファイルを選択"><button id="pick-input" type="button">選択…</button></div>
    <label class="device-heading" for="device-output-mode">出力先</label>
    <select id="device-output-mode"><option value="display">ディスプレイ</option><option value="file">ファイル（最初のOUTで上書き）</option></select>
    <div class="device-path-row"><input id="device-output-path" aria-label="出力ファイルのパス" placeholder="出力ファイルを選択"><button id="pick-output" type="button">選択…</button></div>
    <p class="device-note">ファイルは最初のIN／OUTで開きます。出力は終了・リロード・画面を閉じる際に確定します。戻る操作でOUTを再実行すると、出力ファイルも書き直されます。</p>
    <p id="device-error" class="error" role="alert"></p>
    <div class="device-actions"><button id="device-cancel" type="button">キャンセル</button><button id="device-apply" class="primary" type="button">適用してリロード</button></div>
  </dialog>`;
}

export async function editDevices(id: string | null, name: string): Promise<{ config: DeviceConfig; snapshot: Snapshot | null } | null> {
  const dialog = document.getElementById('devices-dialog') as HTMLDialogElement;
  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const inputMode = element<HTMLSelectElement>('device-input-mode');
  const outputMode = element<HTMLSelectElement>('device-output-mode');
  const inputPath = element<HTMLInputElement>('device-input-path');
  const outputPath = element<HTMLInputElement>('device-output-path');
  element('devices-context').textContent = id ? `対象: ${name}（次回ビルドの既定値にも保存）` : '次に開くシミュレーターの既定値を設定します。';
  const config = await invoke<DeviceConfig>('get_devices', { id });
  inputMode.value = config.input_path ? 'file' : 'keyboard';
  outputMode.value = config.output_path ? 'file' : 'display';
  inputPath.value = config.input_path ?? ''; outputPath.value = config.output_path ?? '';
  element('device-error').textContent = '';
  let working = false;
  const refresh = () => {
    inputPath.disabled = working || inputMode.value !== 'file';
    outputPath.disabled = working || outputMode.value !== 'file';
    element<HTMLButtonElement>('pick-input').disabled = inputPath.disabled;
    element<HTMLButtonElement>('pick-output').disabled = outputPath.disabled;
    inputMode.disabled = working; outputMode.disabled = working;
    element<HTMLButtonElement>('device-apply').disabled = working;
    element<HTMLButtonElement>('device-cancel').disabled = working;
  };
  inputMode.onchange = refresh; outputMode.onchange = refresh;
  const pick = async (kind: 'input' | 'output') => {
    working = true; refresh();
    try {
      const path = await invoke<string | null>('pick_device_file', { kind });
      if (path) (kind === 'input' ? inputPath : outputPath).value = path;
    } catch (error) { element('device-error').textContent = String(error); }
    finally { working = false; refresh(); }
  };
  element('pick-input').onclick = () => pick('input');
  element('pick-output').onclick = () => pick('output');
  refresh();
  return new Promise(resolve => {
    let update: { config: DeviceConfig; snapshot: Snapshot | null } | null = null;
    dialog.addEventListener('close', () => resolve(update), { once: true });
    dialog.oncancel = event => { if (working) event.preventDefault(); };
    element('device-cancel').onclick = () => dialog.close();
    element('device-apply').onclick = async () => {
      const chosen = { input_path: inputMode.value === 'file' ? inputPath.value.trim() : null,
        output_path: outputMode.value === 'file' ? outputPath.value.trim() : null };
      if (chosen.input_path === '' || chosen.output_path === '') { element('device-error').textContent = 'ファイルのパスを指定してください。'; return; }
      working = true; refresh();
      try { update = await invoke('set_devices', { id, config: chosen }); dialog.close(); }
      catch (error) { element('device-error').textContent = String(error); }
      finally { working = false; refresh(); }
    };
    dialog.showModal();
  });
}
