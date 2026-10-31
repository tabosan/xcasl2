import test from 'node:test';
import assert from 'node:assert/strict';
import { tooltipPosition } from '../src/tooltips.ts';

test('tooltips appear below controls, flip above the status bar and stay inside the viewport',()=>{
  assert.deepEqual(tooltipPosition({left:100,right:128,top:40,bottom:68},200,50,800,600),{x:100,y:75});
  assert.deepEqual(tooltipPosition({left:720,right:748,top:580,bottom:600},200,50,800,600),{x:592,y:523});
  for(const anchor of [{left:-20,right:8,top:0,bottom:28},{left:780,right:808,top:0,bottom:28},{left:300,right:328,top:570,bottom:598}]) {
    const {x,y}=tooltipPosition(anchor,300,90,800,600);
    assert.ok(x>=8&&y>=8&&x+300<=792&&y+90<=592);
  }
});

test('long, wrapped tooltip content remains visible when neither side has enough room',()=>{
  assert.deepEqual(tooltipPosition({left:25,right:50,top:80,bottom:105},200,250,240,280),{x:25,y:8});
});
