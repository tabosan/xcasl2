import test from 'node:test';
import assert from 'node:assert/strict';
import { highlightCasl } from '../src/highlight.ts';

function tokens(source) {
  return [...highlightCasl(source).matchAll(/<span class="syntax-([a-z]+)">([^]*?)<\/span>/g)]
    .map(([, kind, text]) => [kind, text]);
}

test('operation fields distinguish instructions, directives, macros and label references', () => {
  const result = tokens('LD START\n CALL LD\n IN BUF,LEN\n RPUSH\n lad GR1,1');
  assert.deepEqual(result.slice(0, 5), [
    ['label', 'LD'], ['directive', 'START'], ['instruction', 'CALL'], ['label', 'LD'], ['macro', 'IN'],
  ]);
  assert.ok(result.some(([kind, value]) => kind === 'macro' && value === 'RPUSH'));
  assert.ok(!result.some(([, value]) => value === 'lad'));
});

test('registers, decimal / hex constants, literals and punctuation are recognised', () => {
  assert.deepEqual(tokens(' ADDA GR1,=-32768\n LAD GR7,#00AF\n LD GR0,GR8'), [
    ['instruction', 'ADDA'], ['register', 'GR1'], ['punctuation', ','], ['punctuation', '='], ['number', '-32768'],
    ['instruction', 'LAD'], ['register', 'GR7'], ['punctuation', ','], ['number', '#00AF'],
    ['instruction', 'LD'], ['register', 'GR0'], ['punctuation', ','], ['label', 'GR8'],
  ]);
});

test('Japanese strings and doubled quotes remain one string token', () => {
  assert.deepEqual(tokens("MSG DC '日本語it''s GR1',2"), [
    ['label', 'MSG'], ['directive', 'DC'], ['string', '&#39;日本語it&#39;&#39;s GR1&#39;'], ['punctuation', ','], ['number', '2'],
  ]);
  assert.ok(tokens(" DC '編集中").some(([kind]) => kind === 'string'));
});

test('semicolon starts a comment even within a string, matching WCASL2 preprocessing', () => {
  assert.deepEqual(tokens(" DC 'a;GR1'\n; LD GR1,3"), [
    ['directive', 'DC'], ['string', '&#39;a'], ['comment', ';GR1&#39;'], ['comment', '; LD GR1,3'],
  ]);
});

test('source markup cannot create elements and every source character is preserved', () => {
  const source = "\tDC '<img src=x onerror=alert(1)>&\"'\r\n; </span><script>alert('x')</script>\n\n";
  const html = highlightCasl(source);
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script'));
  const restored = html.replace(/<\/?span\b[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39);/g, (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity]);
  assert.equal(restored, source);
});

test('blank lines, trailing newlines and a 2000-line document keep their line boundaries', () => {
  for (const source of ['', '\n', '\n\n', 'MAIN START\n', ' ; comment\n\n']) {
    assert.equal(highlightCasl(source).split('\n').length, source.split('\n').length);
  }
  const source = Array.from({ length: 2000 }, (_, index) => ` LAD GR1,${index}`).join('\n');
  const html = highlightCasl(source);
  assert.equal(html.split('\n').length, 2000);
  assert.equal([...html.matchAll(/syntax-instruction/g)].length, 2000);
});
