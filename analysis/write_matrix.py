import json
from oracle import ROOT
p=ROOT/'analysis/results'
asm=json.loads((p/'assembler_cases.json').read_text(encoding='utf-8'))
build=json.loads((p/'build_cases.json').read_text(encoding='utf-8'))
bmap={x['id']:x for x in build}
def esc(s):return str(s).replace('|','\\|').replace('\r','').replace('\n',' / ')
lines=['# WCASL2 構文・リンク試験一覧','',
       '対象EXEの元のx86ルーチンを、MFC補助処理付きのエミュレータで実行した結果。入力全文・機械語・診断全文はJSONを参照。成功と失敗の双方が仕様を示す。', '',
       '- 低レベル: `analysis/results/assembler_cases.json`',
       '- 全体ビルド: `analysis/results/build_cases.json`',
       '- この表の「未測定」はハーネス側の制約。旧アプリの動作を意味しない。', '',
       '| ケース | 単一セクション | 語数 | 全体ビルド | 診断抜粋 |','|---|---|---:|---|---|']
for a in asm:
    b=bmap.get(a['id']);status='未測定' if 'probe_error'in a else f"エラー{a['errors']}件" if a['errors'] else '受理'
    if not b:bs='未測定'
    elif 'probe_error'in b:bs='ハーネス上限'
    elif b['errors']:bs=f"アセンブルエラー{b['errors']}件"
    elif b.get('link_aborted'):bs='リンク中止'
    elif b.get('link_diagnostic_count'):bs='リンク診断あり・成功文併存'
    else:bs='成功'
    messages=a.get('diagnostics',[])
    if b and b.get('link_diagnostic_count'):messages=[s for s in b['diagnostics'] if s.startswith('Link Errer')]
    diag=messages[0] if messages else ('例外経路の最終状態未測定' if 'probe_error'in a else '')
    lines.append(f"| `{a['id']}` | {status} | {a.get('words','—')} | {bs} | {esc(diag)} |")
lines+=['','## 複数プログラムの追加試験','','| ケース | 結果 | 診断 |','|---|---|---|']
for b in build:
    if b['id']in {a['id']for a in asm}:continue
    status='未測定' if 'probe_error'in b else 'アセンブルエラー' if b['errors'] else 'リンク中止' if b.get('link_aborted') else 'リンク診断あり' if b.get('link_diagnostic_count') else '成功'
    lines.append(f"| `{b['id']}` | {status} | {esc(' / '.join(s for s in b.get('diagnostics',[]) if s.startswith('Link Errer') or '行目' in s))} |")
lines+=['','## 解釈上の注意','',
       '`multiple_programs` は、単一セクション用ルーチンへ一括投入するとENDエラーになるが、全体ビルドでは分割して成功する。', '',
       '`label_expression` はアセンブラでは外部名として受理するが、`A+1` という名前を定義していないためリンク中止となる。算術式対応ではない。','',
       '`ui_valid` はコメントに続く空行を含むため、このEXEでは失敗する。実機の同じ診断も保存している。','',
       '`line_201` 等は長い行の例外をハーネスが扱えないため未測定。静的には200との比較と例外送出を確認した。', '']
(ROOT/'docs/WCASL2_TEST_MATRIX.md').write_text('\n'.join(lines),encoding='utf-8')
print('Wrote matrix:',len(asm),'assembler cases,',len(build),'build cases')
