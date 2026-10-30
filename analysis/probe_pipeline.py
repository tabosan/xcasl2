import json
from oracle import Oracle,ROOT
o=Oracle();out=[]
for name,words,gr in [
    ('LAD',[0x1210,1],{}),('LD-memory',[0x1010,0x100],{}),('LD-register',[0x1412],{2:0x8000}),
    ('ADDA',[0x2412],{1:0x7fff,2:1}),('SLL-33',[0x5210,33],{1:1}),
    ('PUSH',[0x7001,0],{1:0x1234}),('POP',[0x7110],{}),('CALL',[0x8000,0x100],{}),('RET-main',[0x8100],{}),
    ('invalid',[0xffff],{}),('SVC-unsupported',[0xf000,3],{})]:
    o.reset();o.w16(o.CPU+0x18,0x20);o.w16(o.CPU+0x14,0x200)
    for i,n in gr.items():o.w16(o.CPU+4+i*2,n)
    for i,n in enumerate(words):o.w16(o.MEM+4+(0x20+i)*2,n)
    trace=[o.state()]
    for n in range(80):
        o.call(0x40c410,o.DOC);trace.append(o.state())
        if o.r32(o.DOC+0x274)in [0,0xffffffff] and o.r32(o.DOC+0x278)==0:break
        if o.r32(o.DOC+0x274)==0xffffffff:break
    out.append(dict(id=name,words=words,trace=trace))
(ROOT/'analysis/results/pipeline_cases.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
for x in out:print(x['id'],len(x['trace'])-1,x['trace'][-1])
