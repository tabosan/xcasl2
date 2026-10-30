import test from 'node:test';
import assert from 'node:assert/strict';
import { Workbench, pathKey } from '../src/workbench.ts';
const settings = { base:32, fill:65535, step_mode:'instruction', interval_ms:100, comet_view:false, decimal:false, memory_start:32 };

test('opening an existing path focuses its tab and preserves unsaved text', () => {
  const workbench = new Workbench();
  const a = workbench.open({ path:'C:\\demo\\a.cas', source:'A START\r\n END\r\n' });
  a.source = 'edited';
  const b = workbench.open({ path:'C:\\demo\\b.cas', source:'different' });
  const again = workbench.open({ path:'\\\\?\\C:\\DEMO\\a.cas', source:'disk content' });
  assert.equal(again, a); assert.equal(a.source,'edited'); assert.equal(b.source,'different');
  assert.deepEqual(workbench.editorTabs,[a.id,b.id]); assert.equal(workbench.activeSource,a.id);
  assert.equal(pathKey('\\\\?\\UNC\\server\\share\\a.cas'),pathKey('\\\\server\\share\\a.cas'));
});
test('each source has exactly one simulator and tab selection preserves snapshots', () => {
  const wb = new Workbench(), a = wb.create('one'), b = wb.create('two');
  const sa = wb.ensureSimulator(a.id,settings), sb = wb.ensureSimulator(b.id,settings);
  sa.snapshot = { steps:12, cpu:{gr:[7]} }; sb.snapshot = { steps:3,cpu:{gr:[42]} };
  wb.activeSource = a.id; wb.activeSimulator = a.id;
  assert.equal(wb.ensureSimulator(a.id,settings),sa);
  assert.equal(wb.simulators.size,2); assert.equal(sa.snapshot.steps,12); assert.equal(sb.snapshot.cpu.gr[0],42);
  sa.running=true; assert.equal(sb.running,false);
  sa.stackStart=42;sa.labelScrollTop=120;sa.stackScrollTop=240;
  assert.equal(sb.stackStart,null);
  assert.equal(sb.labelScrollTop,0);assert.equal(sb.stackScrollTop,0);
});
test('only a simulator whose build inputs changed becomes stale', () => {
  const wb = new Workbench(), a = wb.create('one'), b = wb.create('two'), c = wb.create('independent');
  wb.project={path:null,fileIds:[a.id,b.id],dirty:false};
  const sa=wb.ensureSimulator(a.id,settings), sc=wb.ensureSimulator(c.id,settings);
  sa.buildKey=wb.key(a.id,settings); sc.buildKey=wb.key(c.id,settings);
  assert.deepEqual(wb.sourcesFor(b.id).map(doc=>doc.id),[b.id,a.id]);
  b.source='changed'; assert.equal(wb.stale(sa,settings),true); assert.equal(wb.stale(sc,settings),false);
  b.source='two'; assert.equal(wb.stale(sa,settings),false);
  wb.project.fileIds=[a.id]; assert.equal(wb.stale(sa,settings),true);
  assert.equal(wb.stale(sc,{...settings,base:64}),true);
});
test('save-as keeps the source/simulator association but requires a rebuild', () => {
  const wb=new Workbench(),doc=wb.create('program'),sim=wb.ensureSimulator(doc.id,settings);
  sim.buildKey=wb.key(doc.id,settings); doc.path='C:\\new.cas';doc.name='new.cas';
  assert.equal(wb.simulation(doc.id),sim);assert.equal(wb.stale(sim,settings),true);
});
test('closing one simulator preserves all other tabs and their state', () => {
  const wb=new Workbench(),a=wb.create('a'),b=wb.create('b');
  wb.ensureSimulator(a.id,settings);const sb=wb.ensureSimulator(b.id,settings);sb.snapshot={steps:42};
  wb.closeSimulator(a.id);wb.closeSource(a.id);wb.prune();
  assert.equal(wb.simulation(),sb);assert.equal(sb.snapshot.steps,42);assert.deepEqual(wb.editorTabs,[b.id]);
  const next=wb.create('c');assert.notEqual(next.id,a.id);
});
test('closed project files and simulation dependencies remain available for linking', () => {
  const wb=new Workbench(),a=wb.create('a'),b=wb.create('b');
  wb.project={path:'project.cmk',fileIds:[a.id,b.id],dirty:false};
  wb.closeSource(b.id);wb.prune();assert.equal(wb.source(b.id),b);
  const sim=wb.ensureSimulator(a.id,settings);sim.sourceIds=[a.id,b.id];wb.project=null;
  wb.prune();assert.equal(wb.source(b.id),b);
  wb.closeSimulator(a.id);wb.prune();assert.equal(wb.source(b.id),null);
});
