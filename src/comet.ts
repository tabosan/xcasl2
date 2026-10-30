import type { Row, Snapshot } from './types';
import { cometDiagramState, cometMemoryRows, cometWireActive, hexWord as hex, instructionAddress, phaseNames } from './comet-model.ts';

// Orthogonal paths follow the reference layout: decode on the left, register bank
// in the middle, address generation and arithmetic on the right, memory at the edge.
const wires = [
  ['pr','mar','M326 64H350V42H456'],
  ['sp','mar','M326 108H344V42H456'],
  ['ir','decoder','M78 84V124'],
  ['ir','adder','M154 84V110H364V145H386'],
  ['decoder','adder','M198 220H216V164H386'],
  ['gr','adder','M326 187H352V156H386'],
  ['adder','ea','M430 155H456'],
  ['ea','mar','M500 140V104H564V42H546'],
  ['mar','memory','M546 42H584V210H606'],
  ['memory','mdr','M606 260H580'],
  ['mdr','memory','M580 274H606'],
  ['mdr','ir','M535 244V16H122V48'],
  ['gr','mdr','M326 254H490'],
  ['mdr','gr','M490 268H352V214H326'],
  ['gr','alu','M326 294H365V324H390'],
  ['mdr','alu','M534 280V298H500V310'],
  ['alu','gr','M460 390V416H214V267H238'],
  ['alu','fr','M390 350H380'],
  ['sp','alu','M281 124V136H370V335H390'],
  ['ea','pr','M456 158H338V64H326'],
  ['ea','gr','M456 172H358V240H326'],
  ['pr','mdr','M281 48V8H594V253H580'],
  ['mdr','pr','M490 254H344V64H326'],
] as const;

function register(id: string, label: string, x: number, y: number, width = 90) {
  return `<g id="node-${id}" class="datapath-node"><text class="node-label" x="${x}" y="${y-9}">${label}</text><rect x="${x}" y="${y}" width="${width}" height="36" rx="3"/><text class="node-value" id="value-${id}" x="${x+width/2}" y="${y+24}" text-anchor="middle">—</text></g>`;
}

export function cometMarkup(): string {
  return `<section id="comet-panel" class="comet-panel panel" hidden>
    <div class="panel-heading"><h2>COMET CPU</h2><span id="cycle-count">0 microsteps</span></div>
    <div class="phase-strip" aria-label="次に実行するフェーズ">${phaseNames.map((name,i)=>`<span id="phase-${i}"><b>0${i+1}</b> ${name}</span>`).join('')}</div>
    <div class="datapath-scroll" tabindex="0" aria-label="CPUブロック図をスクロール">
      <svg class="datapath" viewBox="0 0 620 438" role="img" aria-labelledby="datapath-title">
        <title id="datapath-title">COMET CPUのレジスタ、制御部、加算器、ALUと転送経路</title>
        <defs><marker id="bus-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z"/></marker></defs>
        <g class="bus-lines">${wires.map(([from,to,d])=>`<path data-from="${from}" data-to="${to}" d="${d}"/>`).join('')}</g>
        <g id="node-ir" class="datapath-node"><text class="node-label" x="30" y="38">IR</text><rect x="30" y="48" width="168" height="36" rx="3"/><path class="node-divider" d="M114 48V84"/><text id="value-ir1" class="node-value" x="72" y="72" text-anchor="middle">—</text><text id="value-ir2" class="node-value" x="156" y="72" text-anchor="middle">—</text></g>
        <g id="node-decoder" class="datapath-node"><rect x="30" y="124" width="168" height="120" rx="4"/><text class="node-label" x="42" y="146">Decoder</text><text class="node-caption" x="42" y="167">OP</text><text id="value-opcode" class="node-value small-value" x="76" y="167">—</text><text class="node-caption" x="112" y="167">ADR</text><text id="value-adr" class="node-value small-value" x="146" y="167">—</text><text class="node-caption" x="48" y="192">r</text><text class="node-caption" x="126" y="192">x</text><rect class="decoder-field" x="42" y="199" width="66" height="30" rx="2"/><rect class="decoder-field" x="119" y="199" width="67" height="30" rx="2"/><text id="value-r" class="node-value" x="75" y="221" text-anchor="middle">—</text><text id="value-x" class="node-value" x="152" y="221" text-anchor="middle">—</text></g>
        <g id="node-controller" class="datapath-node"><rect x="30" y="274" width="168" height="78" rx="4"/><text class="node-label" x="42" y="297">Controller</text><text id="value-controller" class="controller-value" x="42" y="326">—</text></g>
        ${register('pr','PR',238,48,88)}${register('sp','SP',238,92,88)}
        <g id="node-gr" class="datapath-node register-bank"><text class="node-label" x="238" y="148">GR</text><rect x="238" y="160" width="88" height="216" rx="3"/>${Array.from({length:8},(_,i)=>`<g id="gr-row-${i}" class="gr-row"><rect x="239" y="${161+i*27}" width="86" height="26"/><text class="gr-index" x="249" y="${180+i*27}">${i}</text><text class="node-value" id="comet-gr-${i}" x="317" y="${180+i*27}" text-anchor="end">—</text></g>`).join('')}</g>
        ${register('mar','MAR',456,24)}
        <g id="node-adder" class="datapath-node"><path class="logic-shape" d="M386 128L408 136L430 148V162L408 174L386 182V162L397 155L386 148Z"/><text class="node-label" x="386" y="203">Adder</text></g>
        ${register('ea','EA',456,140)}${register('mdr','MDR',490,244)}
        <g id="node-alu" class="datapath-node"><path class="logic-shape" d="M390 310H432L460 341L488 310H530V358L495 390H425L390 358Z"/><text class="logic-label" x="460" y="368" text-anchor="middle">ALU</text></g>
        <g id="node-fr" class="datapath-node"><text class="node-label" x="335" y="330">FR</text><rect x="335" y="340" width="45" height="33" rx="3"/><text id="value-fr" class="node-value" x="357" y="363" text-anchor="middle">—</text><text class="node-caption" x="335" y="391">O S Z</text></g>
        <g id="node-memory" class="memory-port"><text class="node-caption" x="570" y="231">MEM</text><circle cx="606" cy="210" r="3"/><circle cx="606" cy="260" r="3"/><circle cx="606" cy="274" r="3"/></g>
      </svg>
    </div>
    <div class="transfer-line"><span id="phase-position">次: 取出 / STEP 0</span><strong id="transfer">ロード待ち</strong></div>
    <div class="decoder-line"><span>直前の転送経路を強調表示</span><span id="comet-flags">O 0 / S 0 / Z 0 · DEPTH 0</span></div>
  </section>
  <section id="comet-memory-panel" class="comet-memory-panel panel" hidden>
    <div class="panel-heading"><h2>メモリ / ソース</h2><button id="comet-follow" aria-pressed="true" title="現在の命令へ追従">PR追従</button></div>
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
    if(item.row){tr.title=`${options.sourceFiles.get(item.row.file??'')??''}:${item.row.line}`;tr.classList.add('has-source');tr.onclick=()=>options.onRow(item.row!);}
    return tr;
  }));
  scroll.scrollTop=oldTop;scroll.scrollLeft=oldLeft;
  if(options.follow){const row=$<HTMLElement>('comet-listing').querySelector<HTMLElement>('.at-instruction,.at-pr');if(row){const a=row.getBoundingClientRect(),b=scroll.getBoundingClientRect();if(a.top<b.top+25)scroll.scrollTop+=a.top-b.top-25;else if(a.bottom>b.bottom)scroll.scrollTop+=a.bottom-b.bottom;}}
  const address=$<HTMLInputElement>('comet-memory-address');if(document.activeElement!==address)address.value=hex(rows[0]?.address??options.start);
  $('comet-follow').setAttribute('aria-pressed',String(options.follow));
  $('comet-memory-info').textContent=cpu?`PR #${hex(cpu.pr)} · MAR #${hex(cpu.mar)}`:'';
}
