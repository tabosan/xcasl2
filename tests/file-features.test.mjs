import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { AutoSave, recentFiles } from '../src/file-features.ts';

test('recent files promote existing Windows paths, deduplicate aliases and cap history at 20', () => {
  const history = ['C:\\demo\\a.cas', 'C:\\demo\\b.cas'];
  assert.deepEqual(recentFiles(history, ['\\\\?\\C:\\DEMO\\a.cas']), ['\\\\?\\C:\\DEMO\\a.cas', history[1]]);
  const paths = Array.from({length:25}, (_,i)=>`C:\\日本語\\${i}.cas`);
  assert.deepEqual(recentFiles(history,paths),paths.toReversed().slice(0,20));
  assert.deepEqual(recentFiles([],['','C:/demo/a.cas','C:\\DEMO\\A.CAS']),['C:\\DEMO\\A.CAS']);
});

test('auto save debounces documents independently and cancels pending writes when disabled', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const saved=[], auto=new AutoSave(async id=>{saved.push(id);return false;});
  auto.schedule('a');t.mock.timers.tick(500);auto.schedule('a');auto.schedule('b');
  t.mock.timers.tick(999);assert.deepEqual(saved,[]);
  t.mock.timers.tick(1);await setImmediate();assert.deepEqual(saved,['a','b']);
  auto.schedule('a');auto.cancelAll();t.mock.timers.tick(2000);assert.deepEqual(saved,['a','b']);
});

test('blocked auto saves retry and disabling during a pending attempt prevents rescheduling', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let calls=0, release;
  const auto=new AutoSave(async()=>{calls++;return calls===1 ? true : new Promise(resolve=>{release=resolve;});});
  auto.schedule('a');t.mock.timers.tick(1000);await setImmediate();assert.equal(calls,1);
  t.mock.timers.tick(1000);await setImmediate();assert.equal(calls,2);
  auto.cancelAll();release(true);await setImmediate();t.mock.timers.tick(2000);assert.equal(calls,2);
});
