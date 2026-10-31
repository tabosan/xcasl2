import type { Row, Snapshot } from './types';
import { cometDiagramMarkup } from './comet-diagram.ts';
import { cometDiagramState, cometMemoryRows, cometWireActive, hexWord as hex, instructionAddress, phaseNames } from './comet-model.ts';

export function cometMarkup(): string {
  return `<section id="comet-panel" class="comet-panel panel" hidden>
    <div class="panel-heading comet-heading"><h2>COMET CPU</h2><span id="cycle-count">0 microsteps</span><div class="comet-zoom-controls" role="group" aria-label="CPUブロック図の拡大率"><button id="comet-zoom-out" data-tooltip="ブロック図を縮小" aria-label="ブロック図を縮小">−</button><button id="comet-zoom-reset" data-tooltip="等倍（100%）に戻す" aria-label="ブロック図を等倍に戻す">100%</button><button id="comet-zoom-in" data-tooltip="ブロック図を拡大" aria-label="ブロック図を拡大">＋</button><button id="comet-zoom-fit" data-tooltip="ブロック図全体を表示領域に合わせる">全体</button></div></div>
    <div class="phase-strip" aria-label="次に実行するフェーズ">${phaseNames.map((name,i)=>`<span id="phase-${i}"><b>0${i+1}</b> ${name}</span>`).join('')}</div>
    <div class="datapath-scroll" tabindex="0" aria-label="CPUブロック図をスクロール" data-tooltip="Ctrl＋ホイールで拡大・縮小">
      <div class="datapath-canvas">${cometDiagramMarkup()}</div>
    </div>
    <div class="transfer-line"><span id="phase-position">次: 取出 / STEP 0</span><strong id="transfer">ロード待ち</strong></div>
    <div class="decoder-line"><span>直前の転送経路を強調表示</span><span id="comet-flags">O 0 / S 0 / Z 0 · DEPTH 0</span></div>
  </section>
  <div id="comet-divider" class="comet-divider" role="separator" tabindex="0" aria-label="COMET CPU・出力とメモリ・ソースの幅" aria-orientation="vertical" data-tooltip="ドラッグで左右の比率を変更、ダブルクリックで元の比率に戻す" hidden></div>
  <section id="comet-memory-panel" class="comet-memory-panel panel" hidden>
    <div class="panel-heading"><h2>メモリ / ソース</h2><button id="comet-follow" aria-pressed="true" data-tooltip="現在の命令へ追従">PR追従</button></div>
    <div class="comet-address-bar"><label class="memory-address"># <input id="comet-memory-address" maxlength="4" aria-label="COMETメモリ表示の先頭番地"></label><span id="comet-memory-info"></span></div>
    <div id="comet-listing-scroll" class="comet-listing-scroll" tabindex="0" aria-label="メモリと対応ソースをスクロール"><table class="comet-listing"><thead><tr><th>番地</th><th>値</th><th>ソース</th></tr></thead><tbody id="comet-listing"></tbody></table></div>
  </section>`;
}

interface CometOptions { start:number; follow:boolean; sourceFiles:Map<string,string>; onRow:(row:Row)=>void }
export function renderComet(snapshot: Snapshot | null, previous: Snapshot | null, root: HTMLElement, options:CometOptions): void {
  const $ = <T extends Element=HTMLElement>(id:string)=>root.querySelector<T>(`[data-view="${id}"]`)!;
  if ($<HTMLElement>('comet-panel').hidden) return;
  const cpu=snapshot?.cpu,pipeline=snapshot?.pipeline,state=cometDiagramState(snapshot);
  $('datapath-title').textContent=cpu?`COMET CPU: PR #${state.values.pr} / SP #${state.values.sp} / MAR #${state.values.mar} / MDR #${state.values.mdr} / IR ${state.values.ir1} ${state.values.ir2} / EA #${state.values.ea}`:'COMET CPU: ロード待ち';
  for(const key of ['pr','sp','mar','mdr','ir1','ir2','ea','opcode','r','x','adr','fr','controller']) $(`value-${key}`).textContent=state.values[key]??'—';
  for(const id of ['pr','sp','ir','decoder','controller','gr','mar','adder','ea','mdr','alu','fr','memory']) $(`node-${id}`).classList.toggle('active',state.active.has(id));
  for(const path of root.querySelectorAll<SVGPathElement>('.bus-lines path')) {
    const from=path.dataset.from!,to=path.dataset.to!;
    path.classList.toggle('active',cometWireActive(from,to,snapshot,previous,state.active));
  }
  for(let i=0;i<8;i++) {
    $(`comet-gr-${i}`).textContent=cpu?hex(cpu.gr[i]):'—';
    $(`gr-row-${i}`).classList.toggle('selected',state.selected.has(i));
    $(`gr-row-${i}`).classList.toggle('changed',!!cpu&&!!previous&&cpu.gr[i]!==previous.cpu.gr[i]);
  }
  for(let phase=0;phase<4;phase++)$(`phase-${phase}`).classList.toggle('active',pipeline?.phase===phase);
  $('cycle-count').textContent=`${pipeline?.cycles??0} microsteps`;
  $('phase-position').textContent=pipeline&&pipeline.phase>3?'停止':`次: ${phaseNames[pipeline?.phase??0]} / STEP ${pipeline?.micro??0}`;
  $('transfer').textContent=pipeline?.transfer??'ロード待ち';
  const fr=cpu?.fr??0;
  $('comet-flags').textContent=`O ${(fr>>2)&1} / S ${(fr>>1)&1} / Z ${fr&1} · DEPTH ${cpu?.depth??0}`;
  const start=snapshot&&options.follow?Math.floor(instructionAddress(snapshot)/32)*32:options.start;
  const rows=snapshot?cometMemoryRows(snapshot,start):[];
  const scroll=$<HTMLElement>('comet-listing-scroll'),oldTop=scroll.scrollTop,oldLeft=scroll.scrollLeft;
  $('comet-listing').replaceChildren(...rows.map(item=>{
    const tr=document.createElement('tr');tr.classList.toggle('at-instruction',item.current);tr.classList.toggle('at-pr',item.pr);tr.classList.toggle('at-mar',item.mar);
    if(previous&&previous.memory[item.address]!==item.value)tr.classList.add('changed');
    for(const text of [hex(item.address),hex(item.value),item.source]){const td=document.createElement('td');td.textContent=text;tr.append(td);}
    if(item.row){tr.dataset.tooltip=`${options.sourceFiles.get(item.row.file??'')??''}:${item.row.line}`;tr.classList.add('has-source');tr.onclick=()=>options.onRow(item.row!);}
    return tr;
  }));
  scroll.scrollTop=oldTop;scroll.scrollLeft=oldLeft;
  if(options.follow){const row=$<HTMLElement>('comet-listing').querySelector<HTMLElement>('.at-instruction,.at-pr');if(row){const a=row.getBoundingClientRect(),b=scroll.getBoundingClientRect();if(a.top<b.top+25)scroll.scrollTop+=a.top-b.top-25;else if(a.bottom>b.bottom)scroll.scrollTop+=a.bottom-b.bottom;}}
  const address=$<HTMLInputElement>('comet-memory-address');if(document.activeElement!==address)address.value=hex(rows[0]?.address??options.start);
  $('comet-follow').setAttribute('aria-pressed',String(options.follow));
  $('comet-memory-info').textContent=cpu?`PR #${hex(cpu.pr)} · MAR #${hex(cpu.mar)}`:'';
}
