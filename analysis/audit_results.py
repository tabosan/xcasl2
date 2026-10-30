import json
from oracle import ROOT
p=ROOT/'analysis/results'
cases=json.loads((p/'cpu_cases.json').read_text())
checks=[]
def signed(x):return x-65536 if x&32768 else x
def flags(x,of=0):return (4 if of else 0)|(2 if x&32768 else 0)|(1 if x==0 else 0)
for c in cases:
    op=int(c['opcode'],16)
    if op not in [0x10,0x14,0x20,0x21,0x22,0x23,0x24,0x25,0x26,0x27,0x30,0x31,0x32,0x34,0x35,0x36,0x40,0x41,0x44,0x45]:continue
    args=c['input'];a=args['gr']['1'];b=args['gr']['2'] if op in [0x14,0x24,0x25,0x26,0x27,0x34,0x35,0x36,0x44,0x45] else args['operand']
    if op in [0x10,0x14]:r=b;fr=flags(r)
    elif op in [0x20,0x21,0x24,0x25]:
        v=signed(a)+signed(b) if op in [0x20,0x24] else signed(a)-signed(b)
        r=v&65535;fr=flags(r,v < -32768 or v > 32767)
    elif op in [0x22,0x23,0x26,0x27]:
        v=a+b if op in [0x22,0x26] else a-b;r=v&65535;fr=flags(r,v<0 or v>65535)
    elif op in [0x30,0x34,0x31,0x35,0x32,0x36]:
        r=a&b if op in [0x30,0x34] else a|b if op in [0x31,0x35] else a^b;fr=flags(r)
    else:
        aa,bb=(signed(a),signed(b)) if op in [0x40,0x44] else (a,b)
        r=a;fr=1 if aa==bb else 2 if aa<bb else 0
    actual=c['final'];checks.append(dict(id=c['id'],match=(r==actual['gr'][1] and fr==actual['fr']),expected_gr1=r,expected_fr=fr))
result=dict(binary_sha256='389365c3f036b9c5461d669dafe98d7772b412167d3aee1730fb441e8275f74e',
            cpu_probe_count=len(cases),cpu_reference_comparison_count=len(checks),cpu_reference_mismatches=[x for x in checks if not x['match']],
            files={})
for fname in ['assembler_cases.json','build_cases.json','pipeline_cases.json','io_cases.json']:
    data=json.loads((p/fname).read_text(encoding='utf-8'))
    result['files'][fname]=dict(cases=len(data),probe_errors=[x['id'] for x in data if 'probe_error' in x])
(p/'audit_summary.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=True,indent=2))
