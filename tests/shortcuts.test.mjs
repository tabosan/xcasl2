import test from 'node:test';
import assert from 'node:assert/strict';
import { workbenchShortcut } from '../src/shortcuts.ts';
const key=(key,shiftKey=false,altKey=false,ctrlKey=true)=>({key,shiftKey,altKey,ctrlKey});
test('file commands coexist with Monaco symbol, occurrence and cursor shortcuts',()=>{
  assert.equal(workbenchShortcut(key('o')),'open');
  assert.equal(workbenchShortcut(key('O',true)),null); // Monaco: Go to Symbol
  assert.equal(workbenchShortcut(key('L',true)),null); // Monaco: select all occurrences
  assert.equal(workbenchShortcut(key('ArrowDown',true,true)),null); // add cursor below
  assert.equal(workbenchShortcut(key('s')),'save');assert.equal(workbenchShortcut(key('S',true)),'save-as');
});
test('palette and find/replace have explicit bindings without intercepting AltGr text',()=>{
  assert.equal(workbenchShortcut(key('F1',false,false,false)),'command-palette');
  assert.equal(workbenchShortcut(key('P',true)),'command-palette');
  assert.equal(workbenchShortcut(key('f')),'find');assert.equal(workbenchShortcut(key('h')),'replace');
  assert.equal(workbenchShortcut(key('s',false,true)),null);
});

test('automatic comments use Ctrl+Shift+C without consuming normal copy or AltGr',()=>{
  assert.equal(workbenchShortcut(key('C',true)),'auto-comment');
  assert.equal(workbenchShortcut(key('c',true)),'auto-comment');
  assert.equal(workbenchShortcut(key('c')),null);
  assert.equal(workbenchShortcut(key('C',true,true)),null);
  assert.equal(workbenchShortcut(key('C',true,false,false)),null);
});
