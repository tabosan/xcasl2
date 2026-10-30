import { cometMarkup, renderComet } from './comet';
import type { Row, Snapshot } from './types';
import type { SimulatorTab } from './workbench';
import { labelValues, labelSourceRow, stackValues, registerValues } from './inspection';
import { initializeCometViewport } from './comet-viewport';

export const hex = (value: number) => value.toString(16).toUpperCase().padStart(4, '0');
export function simulatorMarkup(): string {
  return `<div class="sim-toolbar" aria-label="シミュレーターの操作">
    <button id="run" class="icon-button run" title="実行 (F6)" aria-label="実行">▶</button><button id="stop" class="icon-button" title="停止 (Shift+F5)" aria-label="停止">■</button>
    <button id="step" title="1STEP実行 (F10)">1 STEP</button><button id="back" title="1STEP戻る">↶ 戻る</button><button id="reset" title="リロード">↻</button>
    <span class="toolbar-divider"></span><label>STEP <select id="step-mode" aria-label="STEP粒度"><option value="instruction">命令</option><option value="phase">フェーズ</option><option value="micro">最小STEP</option></select></label>
    <label>間隔 <select id="speed" aria-label="実行間隔"><option value="100">100 ms</option><option value="500">500 ms</option><option value="16">16 ms</option><option value="0">高速</option></select></label>
    <button id="devices" class="icon-button" title="このシミュレーターの入出力装置" aria-label="入出力装置">⚙</button>
  </div>
  <div id="sim-stale" class="sim-alert" hidden><span>ソースまたは配置設定が変わりました。</span><button id="sim-rebuild">再アセンブル</button></div>
  <div class="execution-heading"><div class="view-switch"><button id="view-program" class="selected">CASL</button><button id="view-comet">COMET</button></div><span id="state" class="state">未ロード</span><span id="step-count">0 STEP · 0 instructions</span></div>
  <div id="sim-runtime-error" class="runtime-error" role="status" hidden></div>
  <div id="sim-content" class="sim-content">
    <section id="register-panel" class="register-panel panel" aria-label="レジスタ">
      <div class="panel-heading"><h2>レジスタ</h2><label class="compact-label"><input id="binary-registers" type="checkbox" title="GR0〜GR7を2進のみで表示。オフは16進・10進を同時表示。PR・SPは常に16進。">2進のみ</label><span class="flag-label">FR <b id="flags">O 0　S 0　Z 0</b></span></div>
      <div id="registers" class="registers"></div><div class="cpu-detail"><span>IR <b id="ir">—</b></span><span>CALL DEPTH <b id="depth">0</b></span></div>
    </section>
    <section id="program-panel" class="program-panel panel"><div class="panel-heading"><h2>プログラム</h2><span id="program-info"></span></div><div class="table-scroll"><table class="program-table"><thead><tr><th>行</th><th>番地</th><th>機械語</th><th>ソース</th></tr></thead><tbody id="program"></tbody></table></div></section>
    <div id="casl-inspection" class="casl-inspection">
      <section class="panel label-panel" aria-label="ラベルと現在のメモリ値"><div class="panel-heading"><h2>ラベル</h2></div><div id="labels-scroll" class="inspection-scroll" tabindex="0" aria-label="ラベル一覧をスクロール"><table class="inspection-table label-table"><thead><tr><th>ラベル</th><th>番地</th><th>16進</th><th>10進</th></tr></thead><tbody id="labels"></tbody></table><p id="labels-empty" class="inspection-empty" hidden>DC・DS・リテラルのデータがありません。</p></div></section>
      <section class="panel stack-panel" aria-label="スタックエリア"><div class="panel-heading"><h2>スタックエリア</h2><button id="stack-follow" title="現在のSPに追従" aria-label="現在のSPに追従" aria-pressed="true">SP追従</button></div><div class="stack-address-bar"><label class="memory-address"># <input id="stack-address" maxlength="4" aria-label="スタック表示の先頭番地"></label><span id="stack-pointer"></span></div><div id="stack-scroll" class="inspection-scroll" tabindex="0" aria-label="スタック一覧をスクロール"><table class="inspection-table stack-table"><thead><tr><th aria-label="SP位置"></th><th>番地</th><th>16進</th></tr></thead><tbody id="stack"></tbody></table></div></section>
    </div>
    ${cometMarkup()}
    <div class="bottom-panels">
      <section class="output-panel panel"><div class="panel-heading"><h2 id="output-heading">出力</h2><span id="output-detail">44 bytes × 12 rows</span></div><pre id="output" aria-label="ディスプレイ出力"></pre><div id="file-output" class="file-output" role="status" hidden><p id="output-path"></p><b id="output-state"></b><p id="output-stats"></p></div>
        <form id="input-form" hidden><label for="input-text">キーボード入力 <span id="input-address"></span></label><div class="input-controls"><input id="input-text" type="text" autocomplete="off" placeholder="CP932で128バイト以内"><button class="primary" type="submit">入力</button><button id="eof" type="button">EOF</button></div><p>空文字は長さ0、EOFはFFFF。戻りでも再入力します。</p></form>
      </section>
      <section class="memory-panel panel"><div class="panel-heading"><h2>メモリ</h2><label class="memory-address"># <input id="memory-address" value="0020" maxlength="4" aria-label="メモリ表示の先頭番地"></label></div><div class="memory-scroll"><table id="memory" class="memory-table"></table></div></section>
    </div>
  </div>`;
}

export function createSimulatorRenderer(root: HTMLElement) {
const viewport = initializeCometViewport(root);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector(`[data-view="${id}"]`) as T;
let lastId: string | null = null;
let wasWaiting = false;
function renderSimulator(tab: SimulatorTab | null, stale: boolean, blocked: boolean, onRow: (row: Row) => void, focusInput: boolean, signedDecimal = true) {
  if (!tab) { lastId = null; return; }
  const snapshot = tab.snapshot, previous = tab.previous, cpu = snapshot?.cpu;
  const switched = lastId !== tab.id; lastId = tab.id;
  $('sim-content').classList.toggle('comet-view', tab.cometView);
  $('register-panel').hidden = tab.cometView; $('program-panel').hidden = tab.cometView; $('comet-panel').hidden = !tab.cometView;
  $('comet-memory-panel').hidden = !tab.cometView;
  $('comet-divider').hidden = !tab.cometView;
  $('casl-inspection').hidden = tab.cometView;
  $('view-program').classList.toggle('selected', !tab.cometView); $('view-comet').classList.toggle('selected', tab.cometView);
  $<HTMLSelectElement>('step-mode').value = tab.mode;
  const speed = $<HTMLSelectElement>('speed');
  if (!Array.from(speed.options).some(option => Number(option.value) === tab.interval)) { const option = document.createElement('option'); option.value = String(tab.interval); option.textContent = `${tab.interval} ms`; speed.append(option); }
  speed.value = String(tab.interval);
  $<HTMLInputElement>('binary-registers').checked = tab.binaryRegisters;
  $('registers').classList.toggle('binary-registers', tab.binaryRegisters);
  $('sim-stale').hidden = !stale;
  const ready = !!snapshot && !stale && snapshot.status === 'ready';
  for (const id of ['step', 'run']) $<HTMLButtonElement>(id).disabled = !ready || tab.busy || tab.running || blocked;
  $<HTMLButtonElement>('stop').disabled = !tab.running;
  $<HTMLButtonElement>('back').disabled = !snapshot?.steps || stale || tab.busy || tab.running || blocked;
  $<HTMLButtonElement>('reset').disabled = !snapshot || stale || tab.busy || tab.running || blocked;
  $<HTMLButtonElement>('devices').disabled = tab.busy || tab.running || blocked;
  $<HTMLButtonElement>('sim-rebuild').disabled = tab.busy || blocked;
  $<HTMLSelectElement>('step-mode').disabled = tab.busy || tab.running || !!snapshot?.input || snapshot?.replay_target != null || blocked;
  const state = !snapshot ? '未ロード' : snapshot.replay_target !== null ? '戻りを再実行中' : ({ ready: '実行可能', halted: '正常終了', waiting_input: '入力待ち', fault: '異常終了' })[snapshot.status];
  $('state').textContent = stale ? '要アセンブル' : tab.running ? '実行中' : state;
  $('state').className = `state ${stale ? 'stale' : snapshot?.status ?? ''}`;
  $('step-count').textContent = `${snapshot?.steps ?? 0} STEP · ${snapshot?.pipeline.instructions ?? 0} instructions`;
  $('sim-runtime-error').textContent = snapshot?.error ?? ''; $('sim-runtime-error').hidden = !snapshot?.error;
  const values = cpu ? [...cpu.gr, cpu.pr, cpu.sp] : Array(10).fill(null), old = previous?.cpu;
  const oldValues = old ? [...old.gr, old.pr, old.sp] : [];
  const columns = document.createElement('div'); columns.className = 'register-columns';
  const grHeading = document.createElement('span'); grHeading.textContent = 'GR';
  const valueHeadings = document.createElement('div'); valueHeadings.className = 'register-values';
  for (const text of tab.binaryRegisters ? ['2進'] : ['16進', '10進']) {
    const heading = document.createElement('span'); heading.textContent = text; valueHeadings.append(heading);
  }
  columns.append(grHeading, valueHeadings);
  $('registers').replaceChildren(columns, ...values.map((value, i) => {
    const cell = document.createElement('div'); cell.className = `register ${i > 7 ? 'special' : ''} ${value !== null && oldValues[i] !== undefined && oldValues[i] !== value ? 'changed' : ''}`;
    const label = document.createElement('span'); label.textContent = i < 8 ? `GR${i}` : i === 8 ? 'PR' : 'SP';
    const content = document.createElement('div'); content.className = 'register-values';
    const formatted = value === null ? Array(i > 7 || tab.binaryRegisters ? 1 : 2).fill('—') : registerValues(value, tab.binaryRegisters, signedDecimal, i > 7);
    for (const [column, text] of formatted.entries()) {
      const number = document.createElement('b'); number.textContent = text;
      const radix = i > 7 || !tab.binaryRegisters && column === 0 ? '16進' : tab.binaryRegisters ? '2進' : '10進';
      number.title = `${label.textContent} ${radix}: ${text}`;
      content.append(number);
    }
    cell.append(label, content); return cell;
  }));
  $('flags').textContent = `O ${(cpu?.fr ?? 0) >> 2 & 1}　S ${(cpu?.fr ?? 0) >> 1 & 1}　Z ${(cpu?.fr ?? 0) & 1}`;
  $('ir').textContent = cpu ? cpu.ir.map(hex).join(' ') : '—'; $('depth').textContent = String(cpu?.depth ?? 0);
  renderProgram(snapshot, onRow, !switched && !tab.cometView, tab.sourceFiles);
  if (!tab.cometView) renderInspection(tab, switched, onRow, signedDecimal);
  renderMemory(snapshot, previous, tab.memoryStart);
  const address = $<HTMLInputElement>('memory-address');
  if (switched || document.activeElement !== address) address.value = hex(tab.memoryStart);
  renderComet(snapshot, previous, root, {start:tab.memoryStart, follow:tab.cometFollow, sourceFiles:tab.sourceFiles, onRow});
  viewport.render(tab);
  const device = snapshot?.devices, outputPath = device?.config.output_path ?? null;
  $('output').textContent = snapshot?.output.join('\n') ?? '';
  $('output').hidden = !!outputPath; $('file-output').hidden = !outputPath;
  $('output-heading').textContent = outputPath ? 'ファイル出力' : '出力';
  $('output-detail').textContent = outputPath ? 'CP932 · CRLF' : '44 bytes × 12 rows';
  $('output-path').textContent = outputPath ?? '';
  $('output-state').textContent = device?.output_open ? '出力中 — 終了・リロードで確定' : device?.output_started ? '出力を確定しました' : '最初のOUTを待っています';
  $('output-stats').textContent = `${device?.records_written ?? 0} レコード / ${device?.output_bytes ?? 0} bytes${device?.output_open ? ` / バッファ ${device.buffered_bytes} bytes` : ''}`;
  const waiting = !!snapshot?.input && !stale;
  $<HTMLFormElement>('input-form').hidden = !waiting;
  for (const element of $<HTMLFormElement>('input-form').elements) (element as HTMLInputElement).disabled = tab.busy || blocked;
  if (waiting) {
    $('input-address').textContent = `BUF #${hex(snapshot!.input!.buffer)} / LEN #${hex(snapshot!.input!.length_cell)}`;
    if (switched || !wasWaiting) { $<HTMLInputElement>('input-text').value = tab.inputText; if (focusInput) queueMicrotask(() => $<HTMLInputElement>('input-text').focus()); }
  }
  wasWaiting = waiting;
}

function renderInspection(tab: SimulatorTab, switched: boolean, onRow: (row: Row) => void, signedDecimal: boolean) {
  const snapshot = tab.snapshot, previous = tab.previous;
  const labelRows = snapshot ? labelValues(snapshot, signedDecimal) : [];
  $('labels').replaceChildren(...labelRows.map(({ symbol, offset, address, value, decimal }) => {
    const tr = document.createElement('tr');
    const name = offset ? `+${offset}` : `${symbol.scope}:${symbol.name}`;
    const label = document.createElement('td');
    const source = labelSourceRow(symbol, snapshot!);
    if (source) { const button = document.createElement('button'); button.textContent = name; button.onclick = () => onRow(source); label.append(button); }
    else label.textContent = name;
    tr.title = `${symbol.scope} / ${tab.sourceFiles.get(symbol.file ?? '') ?? ''}${symbol.line ? `:${symbol.line}` : ''} / ${symbol.name}${offset ? `+${offset}` : ''}`;
    tr.append(label);
    for (const text of [hex(address), value === undefined ? '—' : hex(value), decimal === null ? '—' : String(decimal)]) { const cell = document.createElement('td'); cell.textContent = text; tr.append(cell); }
    if (previous && previous.memory[address] !== value) tr.classList.add('changed');
    return tr;
  }));
  $('labels-empty').hidden = labelRows.length > 0;
  const labelsScroll = $('labels-scroll'); labelsScroll.scrollTop = tab.labelScrollTop;
  labelsScroll.onscroll = () => { tab.labelScrollTop = labelsScroll.scrollTop; };
  const rows = snapshot ? stackValues(snapshot, tab.stackStart) : [];
  $('stack').replaceChildren(...rows.map(({ address, value, current }) => {
    const tr = document.createElement('tr'); tr.classList.toggle('at-sp', current);
    if (previous && previous.memory[address] !== value) tr.classList.add('changed');
    for (const text of [current ? 'SP ▶' : '', hex(address), hex(value)]) { const cell = document.createElement('td'); cell.textContent = text; tr.append(cell); }
    return tr;
  }));
  const follow = tab.stackStart === null;
  $('stack-follow').setAttribute('aria-pressed', String(follow));
  $('stack-pointer').textContent = snapshot ? `SP #${hex(snapshot.cpu.sp)}${snapshot.cpu.sp >= snapshot.memory.length ? '（範囲外）' : ''}` : '';
  const address = $<HTMLInputElement>('stack-address');
  if (switched || document.activeElement !== address) address.value = hex(rows[0]?.address ?? 0);
  const stackScroll = $('stack-scroll');
  if (follow && (switched || !previous || previous.cpu.sp !== snapshot?.cpu.sp)) tab.stackScrollTop = 0;
  stackScroll.scrollTop = tab.stackScrollTop;
  stackScroll.onscroll = () => { tab.stackScrollTop = stackScroll.scrollTop; };
}

function renderProgram(snapshot: Snapshot | null, onRow: (row: Row) => void, follow: boolean, sourceFiles: Map<string, string>) {
  const active = snapshot?.status !== 'halted' && snapshot?.status !== 'fault';
  $('program').replaceChildren(...(snapshot?.rows.filter(row => row.words > 0) ?? []).map(row => {
    const tr = document.createElement('tr'); const pipeline = snapshot!.pipeline;
    const pc = pipeline.phase <= 3 && (pipeline.phase !== 0 || pipeline.micro !== 0) ? pipeline.instruction_address : snapshot!.cpu.pr;
    if (active && pc >= row.address && pc < row.address + row.words) tr.className = 'active';
    const words = snapshot!.memory.slice(row.address, row.address + Math.min(row.words, 4)).map(hex).join(' ');
    for (const text of [String(row.line), hex(row.address), words + (row.words > 4 ? ' …' : ''), row.source]) { const td = document.createElement('td'); td.textContent = text; tr.append(td); }
    tr.title = `${sourceFiles.get(row.file ?? '') ?? ''}:${row.line} / ${row.words}語`; tr.addEventListener('click', () => onRow(row)); return tr;
  }));
  if (follow) {
    const activeRow = $('program').querySelector<HTMLElement>('.active'), scroller = $('program').closest<HTMLElement>('.table-scroll');
    if (activeRow && scroller) {
      const row = activeRow.getBoundingClientRect(), box = scroller.getBoundingClientRect();
      const header = scroller.querySelector('thead')?.getBoundingClientRect().height ?? 0;
      if (row.top < box.top + header) scroller.scrollTop += row.top - box.top - header;
      else if (row.bottom > box.bottom) scroller.scrollTop += row.bottom - box.bottom;
    }
  }
  $('program-info').textContent = snapshot ? `ENTRY #${hex(snapshot.entry)} · END #${hex(snapshot.program_end)}` : '';
}
function renderMemory(snapshot: Snapshot | null, previous: Snapshot | null, start: number) {
  const table = $('memory'); table.replaceChildren();
  for (let address = start; address < Math.min(start + 64, 3000); address += 4) {
    const tr = document.createElement('tr'), th = document.createElement('th'); th.textContent = hex(address); tr.append(th);
    for (let i = 0; i < 4 && address + i < 3000; i++) {
      const td = document.createElement('td'), value = snapshot?.memory[address + i]; td.textContent = value === undefined ? '····' : hex(value);
      if (snapshot?.cpu.pr === address + i) td.classList.add('at-pr'); if (snapshot?.cpu.sp === address + i) td.classList.add('at-sp');
      if (value !== undefined && previous && previous.memory[address + i] !== value) td.classList.add('changed'); td.title = `#${hex(address + i)}`; tr.append(td);
    }
    table.append(tr);
  }
}

return Object.assign(renderSimulator, { dispose: () => viewport.dispose() });
}
