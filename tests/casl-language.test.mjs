import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeCaslLine } from '../src/highlight.ts';
import { analyseCasl, definitionsFor, referencesFor, occurrenceAt } from '../src/casl-language.ts';

test('Monaco tokens retain all UTF-16 offsets, plain gaps and WCASL2 comment boundaries',()=>{
  const line="MSG DC '日本語it''s😀;GR1'",tokens=tokenizeCaslLine(line);
  assert.equal(tokens.map(t=>line.slice(t.startIndex,t.endIndex)).join(''),line);
  assert.equal(tokens.at(-1).kind,'comment');assert.equal(tokens.at(-1).startIndex,line.indexOf(';'));
  assert.ok(tokens.some(t=>t.kind===null));
  assert.deepEqual(tokenizeCaslLine(''),[]);
  assert.equal(tokenizeCaslLine(' lad GR1,1').find(t=>t.kind==='instruction'),undefined);
});

test('definitions/references exclude strings/comments and resolve duplicate labels per START section',()=>{
  const source="ONE START\nLOOP LAD GR1,1\n JUMP LOOP\n DC 'LOOP' ; LOOP\n END\nTWO START\nLOOP RET\n JUMP LOOP\n CALL ONE\n END";
  const analysis=analyseCasl(source),first=occurrenceAt(analysis,3,8),second=occurrenceAt(analysis,8,8);
  assert.equal(definitionsFor(analysis,first)[0].line,2);
  assert.equal(definitionsFor(analysis,second)[0].line,7);
  assert.deepEqual(referencesFor(analysis,definitionsFor(analysis,first)[0]).map(o=>o.line),[2,3]);
  assert.deepEqual(referencesFor(analysis,definitionsFor(analysis,second)[0]).map(o=>o.line),[7,8]);
  assert.equal(occurrenceAt(analysis,4,8),undefined);
  assert.equal(definitionsFor(analysis,occurrenceAt(analysis,9,8))[0].line,1);
  assert.deepEqual(analysis.sections,[{start:1,end:5},{start:6,end:10}]);
});
