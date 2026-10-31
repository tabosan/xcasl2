import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSampleIndentation, whitespaceToColumn } from '../src/indentation.ts';
import { caslAbbreviation } from '../src/abbreviations.ts';
import { tokenizeCaslLine } from '../src/highlight.ts';
import { examples } from '../src/examples.ts';

const options = (size, spaces) => ({ editor_tab_size:size, editor_insert_spaces:spaces, editor_detect_indentation:true });
const meaningful = source => source.split('\n').map(line => tokenizeCaslLine(line).filter(t => t.kind !== null).map(t => [t.kind, line.slice(t.startIndex,t.endIndex)]));
const column = (text, size) => [...text].reduce((n,c) => c==='\t' ? n+size-n%size : n+1,0);

test('sample formatting follows tab stops while retaining operands, strings, labels and comments',()=>{
  for(const source of Object.values(examples)) for(const size of [2,4,8]) for(const spaces of [true,false]) {
    const formatted=formatSampleIndentation(source,options(size,spaces));
    assert.deepEqual(meaningful(formatted),meaningful(source));
    assert.equal(formatted.endsWith('\n'),source.endsWith('\n'));
    assert.equal(formatSampleIndentation(formatted,options(size,spaces)),formatted);
    const positions=formatted.split('\n').flatMap(line=>{
      const op=tokenizeCaslLine(line).find(t=>['instruction','directive','macro'].includes(t.kind));
      return op ? [column(line.slice(0,op.startIndex),size)] : [];
    });
    assert.equal(new Set(positions).size,1);
    assert.equal(positions[0]%size,0);
    if(spaces) assert.ok(!formatted.includes('\t'));
    else assert.ok(formatted.includes('\t'));
  }
  const text="MAIN START\nTEXT DC 'a b,c''d' ;keep exactly\n END\n";
  assert.deepEqual(meaningful(formatSampleIndentation(text,options(4,false))),meaningful(text));
});

test('tabs in fields advance to display columns without corrupting column-one labels',()=>{
  assert.equal(whitespaceToColumn(0,8,4,false),'\t\t');
  assert.equal(whitespaceToColumn(3,8,4,false),'\t\t');
  assert.equal(whitespaceToColumn(3,7,4,true),'    ');
  assert.match(formatSampleIndentation(examples.hello,options(4,false)),/^MAIN\tSTART/);
});

test('program abbreviation is only allowed in column one and uses configured indentation',()=>{
  for(const tabSize of [2,4,8]) for(const insertSpaces of [true,false]) {
    const expansion=caslAbbreviation('!',2,{tabSize,insertSpaces});
    assert.ok(expansion.snippet.includes('${1:MAIN}'));
    assert.ok(expansion.snippet.includes('${2:RET}'));
    assert.ok(expansion.snippet.includes('END'));
    const body=expansion.snippet.split('\n')[1];
    assert.ok(insertSpaces ? body.startsWith(' '.repeat(tabSize)) : body.startsWith('\t'));
  }
  for(const line of [' !',';!','DATA DC \'!\'','! existing','LABEL !']) assert.equal(caslAbbreviation(line,line.indexOf('!')+2,{tabSize:4,insertSpaces:true}),null);
});

test('register abbreviations preserve existing indentation and exclude GR0 indexing and non-statement contexts',()=>{
  const opts={tabSize:4,insertSpaces:true};
  assert.equal(caslAbbreviation('inc.gr3',8,opts).snippet,'    LAD GR3,1,GR3$0');
  assert.equal(caslAbbreviation('\tdec.gr7',9,opts).snippet,'LAD GR7,-1,GR7$0');
  assert.equal(caslAbbreviation('clr.gr0',8,opts).snippet,'    LAD GR0,0$0');
  assert.equal(caslAbbreviation('inc.gr1',8,{...opts,tabSize:8,indentSize:2}).snippet,'  LAD GR1,1,GR1$0');
  assert.ok(caslAbbreviation('inc',4,opts).snippet.includes('$1'));
  for(const line of ['inc.gr0','dec.gr0','INC','LD GR1,inc',';inc'," DC 'inc'",'inc.gr8']) assert.equal(caslAbbreviation(line,line.length+1,opts),null);
});
