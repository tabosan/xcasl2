import test from 'node:test';
import assert from 'node:assert/strict';
import { TabLayout, tabKey } from '../src/tab-layout.ts';
import { Workbench } from '../src/workbench.ts';
import { scopedMarkup } from '../src/scoped-view.ts';
const a=tabKey('source','a'),b=tabKey('source','b'),c=tabKey('source','c');

test('reorder supports both directions and insertion at the end without duplicates',()=>{
  const layout=new TabLayout();[a,b,c].forEach(key=>layout.open(key));
  const id=layout.focused;layout.move(a,id,3);assert.deepEqual(layout.group().tabs,[b,c,a]);
  layout.move(a,id,0);assert.deepEqual(layout.group().tabs,[a,b,c]);
  layout.move(b,id,2);assert.deepEqual(layout.group().tabs,[a,b,c]);
  assert.equal(layout.current(),b);
});
test('split creates adjacent source groups and move collapses an empty origin',()=>{
  const layout=new TabLayout();[a,b,c].forEach(key=>layout.open(key));const left=layout.focused;
  layout.split(b,left,'right');const right=layout.focused;
  assert.deepEqual(layout.groups.map(g=>g.tabs),[[a,c],[b]]);
  layout.move(c,right,0);assert.deepEqual(layout.groups.map(g=>g.tabs),[[a],[c,b]]);
  layout.move(a,right,2);assert.equal(layout.groups.length,1);assert.deepEqual(layout.group().tabs,[c,b,a]);
  layout.split(a,right,'left');assert.deepEqual(layout.groups.map(g=>g.tabs),[[a],[c,b]]);
});
test('preview uses the group beside its source and reuses an existing simulator location',()=>{
  const layout=new TabLayout();layout.open(a);layout.open(b);layout.split(b,layout.focused,'right');
  const right=layout.focused,sa=tabKey('simulator','a');layout.preview(a,sa);
  assert.equal(layout.groups.length,2);assert.deepEqual(layout.group(right).tabs,[b,sa]);
  layout.move(sa,layout.groups[0].id,0);const owner=layout.focused;
  layout.preview(a,sa);assert.equal(layout.focused,owner);assert.equal(layout.groups.flatMap(g=>g.tabs).filter(k=>k===sa).length,1);
});

test('same-group preview opens next to its source even when another group is focused',()=>{
  const layout=new TabLayout();layout.open(a);layout.open(b);layout.split(b,layout.focused,'right');
  const sourceGroup=layout.owner(a).id,sa=tabKey('simulator','a');
  layout.preview(a,sa,'same-group');
  assert.deepEqual(layout.group(sourceGroup).tabs,[a,sa]);
  assert.equal(layout.groups.length,2);assert.equal(layout.current(),sa);assert.equal(layout.focused,sourceGroup);
  layout.preview(a,sa,'same-group');
  assert.deepEqual(layout.group(sourceGroup).tabs,[a,sa]);
});

test('same-group preview moves an existing simulator and removes an empty origin without duplicates',()=>{
  const wb=new Workbench(),doc=wb.create('source'),settings={step_mode:'instruction',interval_ms:100,memory_start:32};
  const source=tabKey('source',doc.id),key=tabKey('simulator',doc.id),sim=wb.ensureSimulator(doc.id,settings);
  sim.snapshot={steps:42};sim.inputText='keep input';
  assert.equal(wb.layout.groups.length,2);
  const moved=wb.ensureSimulator(doc.id,settings,'same-group');
  assert.equal(moved,sim);assert.equal(moved.snapshot.steps,42);assert.equal(moved.inputText,'keep input');
  assert.equal(wb.layout.groups.length,1);assert.deepEqual(wb.layout.group().tabs,[source,key]);
  assert.equal(wb.layout.current(),key);assert.equal(wb.simulators.size,1);
  wb.ensureSimulator(doc.id,settings,'same-group');
  assert.deepEqual(wb.layout.group().tabs,[source,key]);
  wb.closeSource(doc.id);wb.ensureSimulator(doc.id,settings,'same-group');
  assert.deepEqual(wb.layout.group().tabs,[key]);assert.equal(wb.layout.current(),key);
});
test('closing an active tab selects its neighbor, closing a group keeps a valid focused group',()=>{
  const layout=new TabLayout();layout.open(a);layout.open(b);layout.split(b,layout.focused,'right');
  layout.close(b);assert.equal(layout.groups.length,1);assert.equal(layout.current(),a);
  layout.close(a);assert.equal(layout.groups.length,1);assert.deepEqual(layout.group().tabs,[]);assert.equal(layout.current(),null);
  layout.open(c);assert.equal(layout.current(),c);
});
test('opening a moved source focuses its existing group; joining preserves order and active tab',()=>{
  const layout=new TabLayout();[a,b,c].forEach(key=>layout.open(key));layout.split(b,layout.focused,'right');
  const right=layout.focused;layout.open(b);assert.equal(layout.focused,right);
  layout.join();assert.equal(layout.groups.length,1);assert.deepEqual(layout.group().tabs,[a,c,b]);assert.equal(layout.current(),b);
  layout.split(b,layout.focused,'right');layout.split(b,layout.focused,'right');assert.equal(layout.groups.length,2);
});
test('layout changes retain unsaved source objects, simulator state and project link order',()=>{
  const wb=new Workbench(),a=wb.create('one'),b=wb.create('two');const settings={step_mode:'instruction',interval_ms:100,memory_start:32};
  wb.project={path:'demo.cmk',fileIds:[a.id,b.id],dirty:false};a.source='unsaved';
  const sim=wb.ensureSimulator(a.id,settings);sim.snapshot={steps:71};sim.running=true;
  const key=tabKey('source',a.id);wb.layout.split(key,wb.layout.owner(key).id,'left');
  wb.layout.move(tabKey('simulator',a.id),wb.layout.owner(key).id,0);wb.layout.join();
  assert.equal(wb.source(a.id),a);assert.equal(a.source,'unsaved');assert.equal(wb.simulation(a.id),sim);assert.equal(sim.snapshot.steps,71);assert.equal(sim.running,true);
  assert.deepEqual(wb.sourcesFor(a.id).map(d=>d.id),[a.id,b.id]);assert.equal(wb.project.dirty,false);
});
test('simultaneous simulator markup uses unique label, accessibility and SVG targets',()=>{
  const markup='<label for="input">Text</label><input id="input"><svg aria-labelledby="title"><title id="title">CPU</title><marker id="arrow"></marker></svg>';
  const first=scopedMarkup(markup,'one'),second=scopedMarkup(markup,'two');
  assert.ok(first.includes('data-view="input" id="one-input"'));assert.ok(first.includes('for="one-input"'));assert.ok(first.includes('aria-labelledby="one-title"'));
  const ids=s=>[...s.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set([...ids(first),...ids(second)]).size,6);
});
