import json,itertools
from pathlib import Path
from oracle import Oracle,ROOT
o=Oracle(); cases=[]
values=[0,1,2,0x7fff,0x8000,0xfffe,0xffff]
names={x['opcode']:x['name'] for x in o.op_table()[:38]}
def run(tag,op,**kwargs):
    try:r=o.execute(op,**kwargs);cases.append(dict(id=tag,opcode=f'{op:02X}',input=kwargs,**r))
    except Exception as e:cases.append(dict(id=tag,opcode=f'{op:02X}',input=kwargs,error=str(e)))
for op in [0x10,0x14,0x20,0x21,0x22,0x23,0x24,0x25,0x26,0x27,0x30,0x31,0x32,0x34,0x35,0x36,0x40,0x41,0x44,0x45]:
    for a,b in itertools.product(values,repeat=2):
        run(f'{names[op]}-{op:02X}-{a:04X}-{b:04X}',op,gr={1:a,2:b},operand=b,fr=7)
for op in range(0x50,0x54):
    for value,count in itertools.product(values,[0,1,2,14,15,16,17,31,32,33,255,65535]):
        run(f'{names[op]}-{value:04X}-{count}',op,gr={1:value},effective=count,fr=7)
for op in range(0x61,0x67):
    for fr in range(8):run(f'{names[op]}-FR{fr}',op,fr=fr)
for op in [0x00,0x11,0x12,0x70,0x71,0x80,0x81,0x90,0xff]:
    for sp in [0,1,128,2999,3000,65535]:
        run(f'{names.get(op,"INVALID")}-{op:02X}-SP{sp}',op,gr={1:0x1234},sp=sp,fr=7)
run('RET-with-call-depth',0x81,depth=1,sp=0x100,operand=0x456)
run('unsupported-SVC',0xf0,effective=3)
out=ROOT/'analysis'/'results';out.mkdir(exist_ok=True)
(out/'cpu_cases.json').write_text(json.dumps(cases,indent=2),encoding='utf-8')
errors=[x for x in cases if 'error'in x]
print('Original x86 routine probes:',len(cases),'errors:',len(errors))
for x in errors[:8]:print(x['id'],x['error'])
print('Selected shift results:')
for x in cases:
    if x['id'].startswith(('SLA-FFFF-','SRA-8000-','SLL-FFFF-','SRL-FFFF-')):
        print(x['id'],x.get('final',{}).get('gr',[None,None])[1],x.get('final',{}).get('fr'))
