import type { Snapshot } from './types';

const nodes = [
  ['pr', 'PR', 20, 20], ['mar', 'MAR', 160, 20], ['memory', 'MEMORY', 300, 20],
  ['mdr', 'MDR', 440, 20], ['ir', 'IR', 580, 20],
  ['sp', 'SP', 20, 145], ['gr', 'GR', 160, 145], ['alu', 'ALU', 300, 145],
  ['ea', 'EA', 440, 145], ['decoder', 'DECODER', 580, 145],
] as const;

export function cometMarkup(): string {
  return `<section id="comet-panel" class="comet-panel panel" hidden>
    <div class="panel-heading"><h2>COMET DATAPATH</h2><span id="cycle-count">0 microsteps</span></div>
    <div class="phase-strip" aria-label="次に実行するフェーズ">${['取出', '解読', 'アドレス生成', '実行'].map((name, i) => `<span id="phase-${i}"><b>0${i + 1}</b> ${name}</span>`).join('')}</div>
    <div class="comet-gr-strip" aria-label="COMET汎用レジスタ">${Array.from({ length: 8 }, (_, i) => `<div><span>GR${i}</span><b id="comet-gr-${i}">—</b></div>`).join('')}</div>
    <svg class="datapath" viewBox="0 0 710 220" role="img" aria-labelledby="datapath-title">
      <title id="datapath-title">COMET CPUのレジスタと転送経路。直前のSTEPで使用した部分を強調します。</title>
      <defs><marker id="bus-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z"/></marker></defs>
      <g class="bus-lines">
        <path d="M130 48H160 M270 48H300 M410 48H440 M550 48H580 M635 76V145 M580 173H550 M270 173H300 M410 173H440"/>
        <path d="M495 145V108H215V76 M75 145V121H190V76"/>
      </g>
      ${nodes.map(([id, label, x, y]) => `<g id="node-${id}" class="datapath-node" transform="translate(${x} ${y})"><rect width="110" height="56" rx="5"/><text class="node-label" x="12" y="19">${label}</text><text class="node-value" id="value-${id}" x="12" y="41">—</text></g>`).join('')}
    </svg>
    <div class="transfer-line"><span id="phase-position">次: 取出 / STEP 0</span><strong id="transfer">ロード待ち</strong></div>
    <div class="decoder-line"><span id="decoder-detail" title="1語命令ではIR2を保持します。">opcode / r / x / adr</span><span id="comet-flags">O 0 / S 0 / Z 0 · DEPTH 0</span></div>
  </section>`;
}

const hex = (value: number, length = 4) => value.toString(16).toUpperCase().padStart(length, '0');
export function renderComet(snapshot: Snapshot | null, previous: Snapshot | null, root: HTMLElement): void {
  const $ = (id: string) => root.querySelector<HTMLElement>(`[data-view="${id}"]`)!;
  const cpu = snapshot?.cpu;
  const pipeline = snapshot?.pipeline;
  const r = cpu?.decoder.r ?? 0;
  const values: Record<string, string> = cpu ? {
    pr: hex(cpu.pr), mar: hex(cpu.mar), memory: hex(snapshot!.memory[cpu.mar] ?? 0xffff),
    mdr: hex(cpu.mdr), ir: cpu.ir.map(value => hex(value)).join(' '), sp: hex(cpu.sp),
    gr: r < 8 ? `GR${r} ${hex(cpu.gr[r])}` : `r=${r} 不正`, alu: '16 bit',
    ea: hex(cpu.effective), decoder: `${hex(cpu.decoder.op, 2)} / ${r} / ${cpu.decoder.x}`,
  } : {};
  $('datapath-title')!.textContent = cpu
    ? `COMET CPU: PR #${values.pr} / MAR #${values.mar} / MDR #${values.mdr} / IR ${values.ir} / EA #${values.ea} / SP #${values.sp}`
    : 'COMET CPU: ロード待ち';
  for (const [id] of nodes) {
    $(`value-${id}`)!.textContent = values[id] ?? '—';
    $(`node-${id}`)!.classList.toggle('active', pipeline?.active.includes(id) ?? false);
  }
  for (let phase = 0; phase < 4; phase++) $(`phase-${phase}`)!.classList.toggle('active', pipeline?.phase === phase);
  for (let i = 0; i < 8; i++) {
    const value = $(`comet-gr-${i}`)!;
    value.textContent = cpu ? hex(cpu.gr[i]) : '—';
    value.classList.toggle('changed', !!cpu && !!previous && cpu.gr[i] !== previous.cpu.gr[i]);
  }
  const names = ['取出', '解読', 'アドレス生成', '実行'];
  $('cycle-count')!.textContent = `${pipeline?.cycles ?? 0} microsteps`;
  $('phase-position')!.textContent = pipeline && pipeline.phase > 3 ? '停止' : `次: ${names[pipeline?.phase ?? 0]} / STEP ${pipeline?.micro ?? 0}`;
  $('transfer')!.textContent = pipeline?.transfer ?? 'ロード待ち';
  $('decoder-detail')!.textContent = cpu ? `OP ${hex(cpu.decoder.op, 2)} / r ${r} / x ${cpu.decoder.x} / adr #${hex(cpu.decoder.adr)}` : 'opcode / r / x / adr';
  const fr = cpu?.fr ?? 0;
  $('comet-flags')!.textContent = `O ${(fr >> 2) & 1} / S ${(fr >> 1) & 1} / Z ${fr & 1} · DEPTH ${cpu?.depth ?? 0}`;
}
