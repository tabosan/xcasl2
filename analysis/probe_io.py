import json
from oracle import Oracle,ROOT,UC_X86_REG_ECX
results=[]
for name,data,eof in [('ascii',b'ABC',False),('empty',b'',False),('eof',b'',True),('kana',bytes([0xb1]),False),('jp', 'あ'.encode('cp932'),False),('128-bytes',b'A'*128,False)]:
    o=Oracle();o.reset();o.w32(0x587dc8,o.make_string(b''));o.w32(o.DOC+0x58,0x586120)
    o.call(0x4098a0,0x586120)
    o.hooks[0x429654]=(lambda:0,8)
    def modal():
        dialog=o.u.reg_read(UC_X86_REG_ECX)
        o.w32(dialog+0x5c,o.make_string(data));return 2 if eof else 1
    o.hooks[0x429709]=(modal,0)
    o.w16(o.CPU+6,0x100);o.w16(o.CPU+8,0x90);o.w16(o.CPU+0x16,7)
    for i in range(256):o.w16(o.MEM+4+(0x100+i)*2,0xcccc)
    try:
        o.call(0x40ea10,o.DOC)
        results.append(dict(id='IN-'+name,input_hex=data.hex(),eof=eof,length=o.r16(o.MEM+4+0x90*2),buffer=[o.r16(o.MEM+4+(0x100+i)*2) for i in range(min(len(data)+2,256))],state=o.state()))
    except Exception as e:results.append(dict(id='IN-'+name,probe_error=str(e)))
for name,values in [('ascii',[65,66,67]),('empty',[]),('filter',[0,1,9,10,13,31,32,127,128,0xa1,0xdf,0xe0,0xff,0x141]),('wrap',list(b'A'*45))]:
    o=Oracle();o.reset();o.w32(0x587dcc,o.make_string(b''));o.w32(o.DOC+0x58,0x586120);o.call(0x4098a0,0x586120)
    o.w16(o.CPU+6,0x100);o.w16(o.CPU+8,0x90);o.w16(o.CPU+0x16,7);o.w16(o.MEM+4+0x90*2,len(values))
    for i,v in enumerate(values):o.w16(o.MEM+4+(0x100+i)*2,v)
    o.call(0x40e7a0,o.DOC)
    results.append(dict(id='OUT-'+name,words=values,display_rows_hex=[o.cstr(0x586120+45*i).hex() for i in range(12)],cursor=[o.r32(0x586120+0x21c),o.r32(0x586120+0x220)],state=o.state()))
(ROOT/'analysis/results/io_cases.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
for x in results:print(x['id'],x.get('probe_error') or {k:v for k,v in x.items() if k in ['length','buffer','display_rows_hex','cursor']})
