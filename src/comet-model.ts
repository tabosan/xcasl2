import type { Snapshot } from './types';

export const hexWord = (value: number, length = 4) => value.toString(16).toUpperCase().padStart(length, '0');
export const phaseNames = ['取出', '解読', 'アドレス生成', '実行'];

export function instructionAddress(snapshot: Snapshot): number {
  const p = snapshot.pipeline;
  return p.phase <= 3 && (p.phase !== 0 || p.micro !== 0) ? p.instruction_address : snapshot.cpu.pr;
}

export function cometDiagramState(snapshot: Snapshot | null) {
  const cpu = snapshot?.cpu, pipeline = snapshot?.pipeline;
  const active = new Set(pipeline?.active ?? []);
  // The core uses its ALU for address generation; the diagram shows that route as Adder.
  if (active.has('alu') && active.has('decoder')) { active.delete('alu'); active.add('adder'); }
  if (pipeline && pipeline.cycles > 0 && pipeline.phase <= 3) active.add('controller');
  const values: Record<string, string> = cpu ? {
    pr: hexWord(cpu.pr), sp: hexWord(cpu.sp), mar: hexWord(cpu.mar), mdr: hexWord(cpu.mdr),
    ir1: hexWord(cpu.ir[0]), ir2: hexWord(cpu.ir[1]), ea: hexWord(cpu.effective),
    opcode: hexWord(cpu.decoder.op, 2), r: cpu.decoder.r.toString(2).padStart(4,'0'),
    x: cpu.decoder.x.toString(2).padStart(4,'0'), adr: hexWord(cpu.decoder.adr),
    fr: (cpu.fr & 7).toString(2).padStart(3,'0'),
    controller: pipeline!.phase > 3 ? '停止' : `${phaseNames[pipeline!.phase]} / STEP ${pipeline!.micro}`,
  } : {};
  const selected = new Set<number>();
  if (cpu && active.has('gr')) {
    if (cpu.decoder.r < 8) selected.add(cpu.decoder.r);
    if (cpu.decoder.x > 0 && cpu.decoder.x < 8) selected.add(cpu.decoder.x);
  }
  return { values, active, selected };
}

/** One physical word per row keeps memory and source aligned, including macro expansions. */
export function cometMemoryRows(snapshot: Snapshot, start: number, count = 128) {
  const first = Math.max(0, Math.min(start, snapshot.memory.length - 1));
  const sources = new Map<number, Snapshot['rows'][number]>();
  for (const row of snapshot.rows) for (let offset = 0; offset < row.words; offset++) {
    if (row.address + offset >= first && row.address + offset < first + count) sources.set(row.address + offset,row);
  }
  const current = instructionAddress(snapshot);
  return Array.from({length:Math.min(count,snapshot.memory.length-first)},(_,offset)=>{
    const address=first+offset, row=sources.get(address);
    return {address,value:snapshot.memory[address],row,source:row?.address===address?row.source:'',
      current:address===current && snapshot.status!=='halted' && snapshot.status!=='fault',
      pr:address===snapshot.cpu.pr, mar:address===snapshot.cpu.mar};
  });
}

/** Gate directions whose endpoints can be active for a separate, simultaneous transfer. */
export function cometWireActive(from:string,to:string,snapshot:Snapshot|null,previous:Snapshot|null,active:Set<string>):boolean {
  if (!snapshot || !active.has(from) || !active.has(to)) return false;
  const text=snapshot.pipeline.transfer;
  switch (`${from}-${to}`) {
    case 'pr-mdr': return text.startsWith('PR → MDR');
    case 'mdr-pr': return text.includes('MDR → PR');
    case 'memory-mdr': return text.startsWith('Memory[MAR] → MDR');
    case 'mdr-memory': return text.startsWith('MDR → Memory');
    case 'gr-mdr': return text.includes('GRr → MDR');
    case 'mdr-gr': return text.includes('MDR → GR');
    case 'ea-gr': return text.includes('実効アドレス → GRr');
    case 'alu-gr': return !!previous && snapshot.cpu.gr.some((value,i)=>value!==previous.cpu.gr[i]);
    default: return true;
  }
}
