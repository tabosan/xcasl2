import json
from oracle import Oracle,ROOT
cases=json.loads((ROOT/'analysis/results/assembler_cases.json').read_text(encoding='utf-8'))
extra={
 'external_resolved':'MAIN START\r\n CALL SUB\r\n RET\r\n END\r\nSUB START\r\n LD GR1,=7\r\n RET\r\n END\r\n',
 'private_label_scope':'MAIN START\r\n LAD GR1,HIDDEN\r\n RET\r\n END\r\nSUB START\r\nHIDDEN DC 1\r\n RET\r\n END\r\n',
 'duplicate_global':'MAIN START\r\n RET\r\n END\r\nMAIN START\r\n RET\r\n END\r\n',
 'header_comment':'\r\n; header\r\nMAIN START\r\n RET\r\n END\r\n',
 'ui_valid':(ROOT/'analysis/fixtures/ui_valid.cas').read_bytes().decode('cp932'),
}
tests=[x for x in cases if 'probe_error' not in x]+[dict(id=k,source=v) for k,v in extra.items()]
results=[]
for x in tests:
    o=Oracle();o.instruction_budget=20000000
    try:
        r=o.build(x['source']);r['memory']=r['memory'][:min(max(r['end']+2,64),3000)]
        r['link_diagnostic_count']=sum(t.startswith('Link Errer') for t in r['diagnostics'])
        r['link_aborted']=any('ﾘﾝｸを中止' in t for t in r['diagnostics'])
        item=dict(id=x['id'],source=x['source'],**r)
    except Exception as e:item=dict(id=x['id'],source=x['source'],probe_error=str(e))
    results.append(item)
    print(x['id'],item.get('probe_error') or f"asm={r['errors']} link_diagnostics={r['link_diagnostic_count']} entry={r['entry']} end={r['end']} "+repr(r['diagnostics']))
(ROOT/'analysis/results/build_cases.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
