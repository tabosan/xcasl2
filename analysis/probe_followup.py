"""Additional boundary and replay probes of the original x86 code.

Replay hooks replace only source reloading with a saved assembled image and
Windows dialog/file endpoints. Reset, STEP, Backspace and SVC logic stay native.
The file endpoints log calls; their bytes are NOT claimed as native disk bytes.
"""
import json
from oracle import Oracle, ROOT
from unicorn.x86_const import UC_X86_REG_ECX

OUT = ROOT / 'analysis/results'

def boundaries():
    cases = {}
    core = 'MAIN START{e} RET{e} END'
    for name, e in [('crlf', '\r\n'), ('lf', '\n')]:
        s = core.format(e=e)
        for suffix, value in [('none',''),('one',e),('two',e*2),('three',e*3),
                              ('space',e+' '),('comment',e+'; tail'),
                              ('indented_comment',e+' ; tail')]:
            cases[f'{name}_tail_{suffix}'] = s + value
        for position in ['before','middle','before_end','after_end']:
            for content_name, content in [('blank',''),('space',' '),('tab','\t'),
                                           ('comment','; test'),('indented_comment',' ; test')]:
                lines = ['MAIN START',' RET',' END']
                lines.insert({'before':0,'middle':1,'before_end':2,'after_end':3}[position],content)
                cases[f'{name}_{position}_{content_name}'] = e.join(lines)+e
    results=[]
    for name,source in cases.items():
        o=Oracle();o.instruction_budget=20000000
        try:
            r=o.build(source);r.pop('memory')
            results.append(dict(id=name,source=source,**r))
        except Exception as ex:results.append(dict(id=name,source=source,probe_error=str(ex)))
    (OUT/'followup_boundaries.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    print('Boundary cases:',len(results),'probe errors:',sum('probe_error' in r for r in results))
    for r in results:print(r['id'],r.get('errors'),r.get('diagnostics',r.get('probe_error')))

class Replay:
    def __init__(self, source, mode=1, file_output=False):
        self.o=o=Oracle();o.instruction_budget=20000000
        built=o.build(source,mode=mode)
        assert not built['errors'],built
        image=bytes(o.u.mem_read(o.MEM+4,6000))
        self.events=[];self.input_count=0;self.virtual_file=b''
        # Original Backspace calls the build pipeline again. This hook restores
        # precisely the original linked image without unrelated document/UI work.
        def reload_image():
            o.u.mem_write(o.MEM+4,image)
            o.w32(0x4f2818,built['entry']);o.w32(0x4f2814,built['end'])
            self.events.append(dict(event='reload'))
        o.w32(0x587da8,o.DOC+0x10000);o.w32(0x587dac,0)
        o.hooks[0x406ec0]=(reload_image,0);o.hooks[0x407130]=(lambda:0,0)
        o.w32(o.DOC+0x58,0x586120);o.w32(o.DOC+0x270,2)
        for a in [0x587dc8,0x587dcc,o.DOC+0x290,o.DOC+0x2ac]:o.w32(a,o.make_string(''))
        o.hooks[0x429654]=(lambda:0,8)
        o.hooks[0x4292fb]=(lambda:0,0)  # CDialog destruction, no native HWND
        def dialog():
            self.input_count+=1;data=f'K{self.input_count}'
            o.w32(o.u.reg_read(UC_X86_REG_ECX)+0x5c,o.make_string(data))
            self.events.append(dict(event='keyboard',data=data));return 1
        o.hooks[0x429709]=(dialog,0)
        # CString character/append hooks preserve embedded NUL and stored length.
        def raw_string(ptr):return bytes(o.u.mem_read(ptr,o.r32(ptr-8)))
        def add_char():
            obj=o.u.reg_read(UC_X86_REG_ECX)
            o.w32(obj,o.make_string(raw_string(o.r32(obj))+bytes([o.arg(0)&255])));return obj
        def add_raw():
            obj=o.u.reg_read(UC_X86_REG_ECX)
            o.w32(obj,o.make_string(raw_string(o.r32(obj))+o.cstr(o.arg(0))));return obj
        o.hooks[0x427b47]=(add_char,4);o.hooks[0x427b20]=(add_raw,4)
        if file_output:
            o.w32(0x587dcc,o.make_string('virtual-output.txt'))
            vt=o.alloc(b'\0'*0x80);o.w32(o.DOC+0x2b4,vt)
            def open_file():
                self.events.append(dict(event='open',flags=hex(o.arg(1))))
                self.virtual_file=b'';return 1
            def close_file():self.events.append(dict(event='close'))
            def write_file():
                # Original CStdioFile::WriteString and fputs compute count via
                # their original strlen. Intercept only the final fwrite call.
                assert o.arg(1)==1
                data=bytes(o.u.mem_read(o.arg(0),o.arg(2)));self.virtual_file+=data
                self.events.append(dict(event='write',c_string_hex=data.hex()))
                return o.arg(2)
            for off,addr,func,pop in [(0x20,0x1001100,open_file,12),(0x4c,0x1001110,close_file,0),
                                      ]:
                o.w32(vt+off,addr);o.hooks[addr]=(func,pop)
            o.w32(vt+0x54,0x42d64f)
            o.w32(o.DOC+0x2b4+0x10,o.alloc(b'\0'*64))
            for addr in [0x41ca07,0x41fba7,0x41fc34,0x41ca59]:o.hooks[addr]=(lambda:0,0)
            o.hooks[0x41ae62]=(write_file,0)
        o.call(0x40cd90,o.DOC)
        self.events.clear()
    def snapshot(self):
        o=self.o
        return dict(**o.state(),steps=o.r32(o.DOC+0x2cc),input_requests=self.input_count,
                    memory_0020_005f=[o.r16(o.MEM+4+i*2) for i in range(0x20,0x60)],
                    display_rows=[o.cstr(0x586120+45*i).hex() for i in range(12)],
                    virtual_file_hex=self.virtual_file.hex(),events=list(self.events))
    def step(self):self.o.call(0x40c300,self.o.DOC);return self.snapshot()
    def back(self):self.o.call(0x40d260,self.o.DOC);return self.snapshot()

def replay():
    results=[]
    for kind,body,steps in [('out'," OUT BUF,LEN\r\n NOP",8),
                            ('in',' IN BUF,LEN\r\n NOP',8),
                            ('rpush_rpop',' RPUSH\r\n RPOP\r\n NOP',15)]:
        source='MAIN START\r\n'+body+"\r\n RET\r\nBUF DC 'AB'\r\nLEN DC 2\r\n END\r\n"
        r=Replay(source);trace=[r.snapshot()]
        for _ in range(steps):trace.append(r.step())
        back1=r.back();back2=r.back();forward=r.step()
        rewind=[r.back() for _ in range(forward['steps'])]
        results.append(dict(id=kind,source=source,trace=trace,back1=back1,back2=back2,forward=forward,rewind_to_zero=rewind))
        print(kind,'steps',trace[-1]['steps'],'back',back1['steps'],back2['steps'],'input',forward['input_requests'])
    source="MAIN START\r\n OUT BUF,LEN\r\n NOP\r\n OUT BUF,LEN\r\n NOP\r\n RET\r\nBUF DC 'AB'\r\nLEN DC 2\r\n END\r\n"
    r=Replay(source,file_output=True);trace=[r.snapshot()]
    for _ in range(16):trace.append(r.step())
    back1=r.back();back2=r.back()
    results.append(dict(id='file_out_replay',source=source,trace=trace,back1=back1,back2=back2,
                        rewind_to_zero=[r.back() for _ in range(back2['steps'])]))
    source="MAIN START\r\n OUT BUF,LEN\r\n RET\r\nBUF DC #0041,#0000,#0042\r\nLEN DC 3\r\n END\r\n"
    r=Replay(source,file_output=True)
    for _ in range(5):r.step()
    results.append(dict(id='file_out_nul_endpoint',source=source,final=r.snapshot()))
    (OUT/'followup_replay.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')

if __name__=='__main__':
    import sys
    if len(sys.argv)==1 or 'boundaries' in sys.argv:boundaries()
    if len(sys.argv)==1 or 'replay' in sys.argv:replay()
