"""Original file-IN service with only CStdioFile endpoints replaced.

Input represents the string returned by ReadString, before the original
TrimRight and 256-byte cut. No claim about native disk newline/NUL decoding.
"""
import json
from oracle import Oracle,ROOT,UC_X86_REG_ECX

results=[]
for name,data in [('plain',b' ABC'),('spaces',b' ABC  '),('tab',b'A\t'),
                   ('crlf',b'A\r\n'),('all_space',b' \t\r\n'),('long',b'A'*257),
                   ('long_space_tail',b'A'*256+b'  '),('empty',b''),('eof',None)]:
    o=Oracle();o.reset();events=[]
    o.w32(0x587dc8,o.make_string('virtual-input.txt'));o.w32(o.DOC+0x290,o.make_string(''))
    vt=o.alloc(b'\0'*0x80);o.w32(o.DOC+0x298,vt)
    def open_file():events.append(dict(event='open',flags=o.arg(1)));return 1
    def read_line():
        o.w32(o.arg(0),o.make_string(data or b''));events.append(dict(event='ReadString',eof=data is None));return data is not None
    for off,addr,func,pop in [(0x20,0x1001200,open_file,12),(0x58,0x1001210,read_line,4)]:
        o.w32(vt+off,addr);o.hooks[addr]=(func,pop)
    o.w16(o.CPU+6,0x100);o.w16(o.CPU+8,0x90)
    for i in range(260):o.w16(o.MEM+4+(0x100+i)*2,0xcccc)
    try:
        o.call(0x40ea10,o.DOC)
        r=dict(id=name,endpoint_hex=data.hex() if data is not None else None,
               length=o.r16(o.MEM+4+0x90*2),buffer=[o.r16(o.MEM+4+(0x100+i)*2) for i in range(260)],events=events)
    except Exception as ex:r=dict(id=name,probe_error=str(ex))
    results.append(r);print(name,r.get('probe_error') or (r['length'],r['buffer'][:7]))
(ROOT/'analysis/results/followup_file_input.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
