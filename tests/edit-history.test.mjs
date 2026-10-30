import test from 'node:test';
import assert from 'node:assert/strict';
import { EditHistory } from '../src/edit-history.ts';
const state=(value,start=value.length)=>({value,start,end:start,top:123,left:45});
test('fallback undo/redo retains text, selection and scroll when native history disappears',()=>{
  const history=new EditHistory(state('initial',3));history.before(state('initial',2));history.record(state('in9itial',3));
  assert.deepEqual(history.move(-1),state('initial',2));assert.deepEqual(history.move(1),state('in9itial',3));
});
test('native grouped undo aligns backup history and new edits discard redo',()=>{
  const history=new EditHistory(state(''));history.record(state('a'));history.record(state('ab'));history.record(state('abc'));
  history.record(state(''),true);assert.equal(history.move(-1),null);history.before(state(''));history.record(state('x'));
  assert.equal(history.move(1),null);assert.equal(history.move(-1).value,'');
});
test('independent histories do not mix when editor groups move',()=>{
  const a=new EditHistory(state('a')),b=new EditHistory(state('b'));a.record(state('a9'));b.record(state('b7'));
  assert.equal(a.move(-1).value,'a');assert.equal(b.move(-1).value,'b');assert.equal(a.move(1).value,'a9');
});
