import test from 'node:test';
import assert from 'node:assert/strict';
import {cloneLayout,defaultCometLayout,parseCometLayout,validateCometLayout,wirePoints,setWirePoints,orthogonalPoints} from '../src/comet-layout.ts';

test('layout JSON round trips block, text and route edits without shared mutable defaults',()=>{
  const original=cloneLayout(defaultCometLayout),layout=cloneLayout(defaultCometLayout);
  layout.nodes.pr={x:25,y:-10};layout.texts['pr.0']={x:0,y:12};
  const points=wirePoints(layout,'pr-mar');points[1].x+=20;setWirePoints(layout,'pr-mar',points);
  assert.deepEqual(parseCometLayout(JSON.stringify(layout)),layout);
  assert.deepEqual(defaultCometLayout,original);
});

test('moving blocks carries attached endpoints and keeps interior route coordinates',()=>{
  const layout=cloneLayout(defaultCometLayout),before=wirePoints(layout,'pr-mar');
  layout.nodes.pr.x+=25;layout.nodes.pr.y+=15;
  layout.nodes.mar.x-=10;layout.nodes.mar.y+=20;
  const points=wirePoints(layout,'pr-mar');
  assert.deepEqual(points[0],{x:before[0].x+25,y:before[0].y+15});
  assert.deepEqual(points.at(-1),{x:before.at(-1).x-10,y:before.at(-1).y+20});
  for(const point of before.slice(1,-1))assert.ok(points.some(p=>p.x===point.x&&p.y===point.y));
  assert.deepEqual(wirePoints(layout,'gr-alu'),wirePoints(defaultCometLayout,'gr-alu'));
  assert.ok(points.slice(1).every((p,i)=>p.x===points[i].x||p.y===points[i].y));
  setWirePoints(layout,'pr-mar',points);
  assert.deepEqual(wirePoints(layout,'pr-mar'),points);
});

test('diagonal edits are converted to rectilinear paths without losing endpoints',()=>{
  const points=orthogonalPoints([{x:1,y:2},{x:1,y:2},{x:30,y:40},{x:50,y:40}]);
  assert.deepEqual(points,[{x:1,y:2},{x:30,y:2},{x:30,y:40},{x:50,y:40}]);
});

test('invalid layout files cannot change topology or inject SVG attributes',()=>{
  for(const change of [
    layout=>{layout.version=2;},layout=>{layout.width=0;},
    layout=>{layout.nodes.pr.x=NaN;},layout=>{delete layout.nodes.pr;},
    layout=>{layout.texts['constructor.0']={x:0,y:0};},
    layout=>{layout.texts['pr.2']={x:0,y:0};},layout=>{layout.texts['pr.00']={x:0,y:0};},
    layout=>{layout.wires[0].from='gr';},layout=>{layout.wires[0].id='unknown';},
    layout=>{layout.wires[1]=structuredClone(layout.wires[0]);},
    layout=>{layout.wires[0].points=[];},layout=>{layout.wires[0].points[0].x='onload=alert(1)';}
  ]){const layout=cloneLayout(defaultCometLayout);change(layout);assert.throws(()=>validateCometLayout(layout));}
  assert.throws(()=>parseCometLayout('x'.repeat(2_000_001)));
});
