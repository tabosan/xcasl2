import test from 'node:test';
import assert from 'node:assert/strict';
import { cometDiagramState,cometMemoryRows,cometWireActive,instructionAddress } from '../src/comet-model.ts';
import { cometMarkup } from '../src/comet.ts';
import { scopedMarkup } from '../src/scoped-view.ts';

const snapshot=()=>({cpu:{pr:34,sp:195,mar:40,mdr:0x5678,ir:[0x2012,0x0028],effective:0x3456,fr:5,depth:0,
  gr:[0xffff,1,2,3,4,5,6,7],decoder:{op:0x20,r:1,x:2,adr:40}},
  pipeline:{phase:2,micro:1,cycles:10,instruction_address:32,active:['decoder','gr','alu','ea'],transfer:'adr + GRx → 実効アドレス'},
  status:'ready',memory:Array.from({length:3000},(_,i)=>i),rows:[
    {file:'a',line:2,address:32,words:2,source:' LD GR1,VALUE'},
    {file:'a',line:3,address:34,words:12,source:' OUT BUF,LEN'},
  ]});

test('COMET block diagram uses real latch values, both IR words, GR bank and address-generation route',()=>{
  const s=snapshot(),state=cometDiagramState(s);
  assert.equal(state.values.ir1,'2012');assert.equal(state.values.ir2,'0028');
  assert.equal(state.values.pr,'0022');assert.equal(state.values.sp,'00C3');
  assert.equal(state.values.mar,'0028');assert.equal(state.values.mdr,'5678');assert.equal(state.values.ea,'3456');
  assert.equal(state.values.r,'0001');assert.equal(state.values.x,'0010');assert.equal(state.values.fr,'101');
  assert.ok(state.active.has('adder'));assert.ok(!state.active.has('alu'));assert.deepEqual([...state.selected],[1,2]);
  s.pipeline.active=['mdr','gr','alu','fr'];assert.ok(cometDiagramState(s).active.has('alu'));
  s.cpu.decoder.r=10;s.cpu.decoder.x=15;assert.deepEqual([...cometDiagramState(s).selected],[]);
  assert.deepEqual(cometDiagramState(null).values,{});
  s.pipeline.active=['memory','mdr','pr'];s.pipeline.transfer='Memory[MAR] → MDR / PR + 1';
  const bus=cometDiagramState(s).active;
  assert.ok(cometWireActive('memory','mdr',s,null,bus));
  assert.ok(!cometWireActive('pr','mdr',s,null,bus));
  assert.ok(!cometWireActive('mdr','memory',s,null,bus));
});

test('word-aligned memory/source rows retain macro continuations, runtime values and safe physical bounds',()=>{
  const s=snapshot();s.memory[35]=0xffff;
  const rows=cometMemoryRows(s,32,16);
  assert.equal(rows[0].source,' LD GR1,VALUE');assert.equal(rows[1].source,'');assert.equal(rows[1].row,s.rows[0]);
  assert.equal(rows[2].source,' OUT BUF,LEN');assert.equal(rows[3].source,'');assert.equal(rows[13].row,s.rows[1]);assert.equal(rows[14].row,undefined);
  assert.equal(rows[3].value,0xffff);assert.ok(rows[0].current);assert.ok(rows[2].pr);assert.ok(rows[8].mar);
  s.pipeline.phase=0;s.pipeline.micro=0;assert.equal(instructionAddress(s),34);
  s.pipeline.micro=1;assert.equal(instructionAddress(s),32);
  s.status='halted';assert.ok(cometMemoryRows(s,32).every(row=>!row.current));
  assert.equal(cometMemoryRows(s,65535).length,1);assert.equal(cometMemoryRows(s,65535)[0].address,2999);
});

test('simultaneous COMET diagrams keep independent SVG nodes, register values and memory controls',()=>{
  const first=scopedMarkup(cometMarkup(),'first'),second=scopedMarkup(cometMarkup(),'second');
  const ids=text=>[...text.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  const all=[...ids(first),...ids(second)];assert.equal(new Set(all).size,all.length);
  assert.ok(first.includes('first-comet-gr-7'));assert.ok(second.includes('second-comet-memory-address'));
  assert.ok(first.includes('aria-labelledby="first-datapath-title"'));
});
