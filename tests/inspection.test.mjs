import test from 'node:test';
import assert from 'node:assert/strict';
import { labelValues, labelSourceRow, stackValues, formatRegisterValue, registerValues } from '../src/inspection.ts';

test('GR values show hex/decimal together or all 16 bits; address registers always stay hex',()=>{
  assert.deepEqual(registerValues(0xffff,false),['FFFF','-1']);
  assert.deepEqual(registerValues(0x8000,false,false),['8000','32768']);
  assert.deepEqual(registerValues(1,true),['0000 0000 0000 0001']);
  assert.deepEqual(registerValues(0xffff,true),['1111 1111 1111 1111']);
  assert.deepEqual(registerValues(0x8000,true,false),['1000 0000 0000 0000']);
  for(const binary of [true,false])for(const signed of [true,false]) {
    assert.deepEqual(registerValues(0xffff,binary,signed,true),['FFFF']);
    assert.deepEqual(registerValues(0x20,binary,signed,true),['0020']);
  }
});

test('register decimal display defaults to signed two’s complement and can switch to unsigned',()=>{
  const values=[0x0000,0x0001,0x7fff,0x8000,0xfffe,0xffff];
  assert.deepEqual(values.map(value=>formatRegisterValue(value,true)),['0','1','32767','-32768','-2','-1']);
  assert.deepEqual(values.map(value=>formatRegisterValue(value,true,false)),['0','1','32767','32768','65534','65535']);
  for(const signed of [true,false]) assert.deepEqual(values.map(value=>formatRegisterValue(value,false,signed)),['0000','0001','7FFF','8000','FFFE','FFFF']);
});

const snapshot = () => ({
  symbols: [
    { name:'MAIN', scope:'MAIN', file:'a', line:1, address:32, words:0 },
    { name:'VAL', scope:'MAIN', file:'a', line:4, address:40, words:3 },
    { name:'VAL', scope:'SUB', file:'b', line:2, address:43, words:1 },
    { name:'=1', scope:'SUB', file:'b', line:0, address:44, words:1 },
  ],
  rows:[{ file:'a', line:4 }, { file:'b', line:2 }],
  memory:Array.from({length:3000},(_,i)=>({40:65535,41:32767,42:32768,43:9,44:1}[i]??0)),
  cpu:{sp:200},
});
test('data labels expand every word, preserving program scope and literal entries',()=>{
  const s=snapshot(), rows=labelValues(s);
  assert.deepEqual(rows.map(r=>[r.symbol.scope,r.symbol.name,r.offset,r.address,r.value,r.decimal]),[
    ['MAIN','VAL',0,40,65535,-1],['MAIN','VAL',1,41,32767,32767],['MAIN','VAL',2,42,32768,-32768],
    ['SUB','VAL',0,43,9,9],['SUB','=1',0,44,1,1],
  ]);
  assert.equal(labelSourceRow(s.symbols[1],s),s.rows[0]);
  assert.equal(labelSourceRow(s.symbols[2],s),s.rows[1]);
  assert.equal(labelSourceRow(s.symbols[3],s),undefined);
});
test('label values reflect current memory and share the register signed decimal setting',()=>{
  const s=snapshot(); assert.equal(labelValues(s)[0].decimal,-1);
  assert.equal(labelValues(s,false)[0].decimal,65535);
  s.memory[40]=0x8001; assert.equal(labelValues(s,true)[0].decimal,-32767);
  assert.equal(labelValues(s,false)[0].decimal,32769);
  for(const signed of [true,false]) for(const row of labelValues(s,signed)) {
    assert.equal(String(row.decimal),formatRegisterValue(row.value,true,signed));
  }
});
test('stack follows SP, shows retained popped values and permits manual address selection',()=>{
  const s=snapshot(); s.cpu.sp=199;s.memory[199]=0x1234;
  const rows=stackValues(s,null);assert.equal(rows[0].address,195);
  assert.deepEqual(rows.find(r=>r.current),{address:199,value:0x1234,current:true});
  s.cpu.sp=200;assert.equal(stackValues(s,null).find(r=>r.address===199).value,0x1234);
  assert.equal(stackValues(s,100)[0].address,100);
});
test('stack window stays within physical memory even when SP is outside it',()=>{
  const s=snapshot();s.cpu.sp=0;assert.equal(stackValues(s,null)[0].address,0);
  s.cpu.sp=65535;const rows=stackValues(s,null);
  assert.equal(rows.length,64);assert.equal(rows.at(-1).address,2999);assert.ok(rows.every(r=>!r.current&&r.value!==undefined));
  assert.equal(stackValues(s,2999).at(-1).address,2999);
  assert.equal(stackValues(s,2999)[0].address,2999);
  assert.equal(stackValues(s,2999).length,1);
});
