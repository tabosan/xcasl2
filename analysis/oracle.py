"""Execute original x86 routines in Unicorn; this is NOT a replacement CASL VM.

Only the original executable's CPU/assembler methods run. Host CString allocation
and non-semantic MFC plumbing are supplied by small explicit hooks.
"""
import sys,struct,json,re
from collections import deque
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent/'vendor'))
import pefile
from unicorn import Uc,UC_ARCH_X86,UC_MODE_32,UC_HOOK_CODE
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
class Oracle:
    CPU=0x586348
    MEM=0x586388
    DOC=0x2000000
    def __init__(self):
        self.pe=pefile.PE(str(ROOT/'Wcasl2.exe'))
        self.u=Uc(UC_ARCH_X86,UC_MODE_32)
        self.u.mem_map(0,0x10000)
        self.u.mem_map(0x400000,0x200000)
        self.u.mem_write(0x400000,self.pe.get_memory_mapped_image())
        self.u.mem_map(0x1000000,0x100000)
        self.u.mem_map(0x2000000,0x200000)
        self.u.mem_map(0x3000000,0x4000000)
        self.heap=0x3000000
        self.instruction_budget=2000000
        self.recent=deque(maxlen=30)
        self.lists={}
        self.w32(0x45d290,self.make_string(b''))
        self.hooks={0x4278cd:(self.assign,4),0x427790:(lambda:0,0),0x418671:(lambda:0,20),0x427505:(self.copy_string,4),
                    0x42787d:(self.copy_string,4),0x427771:(lambda:0,0),0x4277fe:(self.assign,4),
                    0x427b5c:(self.append,4),0x425412:(self.format,0),0x430190:(lambda:0,12),
                    0x42f0e6:(lambda:0,0),0x4268a5:(lambda:0,4),0x4035c0:(lambda:0,0),
                    0x4269ad:(self.list_add,4),0x4269e1:(self.list_index,4),
                    0x42771b:(self.empty_string,0),
                    0x427b20:(self.append_raw,4),0x4279d9:(self.concat_right,12),0x427a4d:(self.concat_left,12),
                    0x4275fd:(self.alloc_string_buffer,4),0x42767f:(lambda:0,0),
                    0x1001000:(self.wsprintf,0),0x1001010:(lambda:1,4)}
        self.w32(0x44a5f8,0x1001000);self.w32(0x44a5f4,0x1001010)
        self.u.hook_add(UC_HOOK_CODE,self.on_code)
        self.call(0x4096f0,self.CPU)
        self.call(0x415920,0x587b40)
        self.w32(self.DOC+0x50,self.MEM);self.w32(self.DOC+0x54,self.CPU)
    def r32(self,a):return struct.unpack('<I',self.u.mem_read(a,4))[0]
    def r16(self,a):return struct.unpack('<H',self.u.mem_read(a,2))[0]
    def w32(self,a,n):self.u.mem_write(a,struct.pack('<I',n&0xffffffff))
    def w16(self,a,n):self.u.mem_write(a,struct.pack('<H',n&65535))
    def arg(self,n):return self.r32(self.u.reg_read(UC_X86_REG_ESP)+4+n*4)
    def cstr(self,a):
        buf=bytearray()
        while (b:=self.u.mem_read(a+len(buf),1))!=b'\0':buf+=b
        return bytes(buf)
    def alloc(self,b):
        a=self.heap;self.heap+=(len(b)+3)&~3;self.u.mem_write(a,b);return a
    def make_string(self,b):
        if isinstance(b,str):b=b.encode('cp932')
        return self.alloc(struct.pack('<iii',1,len(b),len(b))+b+b'\0')+12
    def assign(self):
        ecx=self.u.reg_read(UC_X86_REG_ECX)
        self.w32(ecx,self.make_string(self.cstr(self.arg(0))));return ecx
    def copy_string(self):
        ecx=self.u.reg_read(UC_X86_REG_ECX)
        self.w32(ecx,self.r32(self.arg(0)));return ecx
    def append(self):
        ecx=self.u.reg_read(UC_X86_REG_ECX)
        self.w32(ecx,self.make_string(self.cstr(self.r32(ecx))+self.cstr(self.r32(self.arg(0)))));return ecx
    def append_raw(self):
        ecx=self.u.reg_read(UC_X86_REG_ECX)
        self.w32(ecx,self.make_string(self.cstr(self.r32(ecx))+self.cstr(self.arg(0))));return ecx
    def alloc_string_buffer(self):
        ecx=self.u.reg_read(UC_X86_REG_ECX);self.w32(ecx,self.make_string(b'\0'*self.arg(0)));return ecx
    def empty_string(self):
        ecx=self.u.reg_read(UC_X86_REG_ECX);self.w32(ecx,self.make_string(b''));return ecx
    def list_add(self):
        ecx=self.u.reg_read(UC_X86_REG_ECX);node=self.alloc(b'\0'*12)
        self.w32(node+8,self.r32(self.arg(0)))
        self.lists.setdefault(ecx,[]).append(node);return node
    def list_index(self):return self.lists[self.u.reg_read(UC_X86_REG_ECX)][self.arg(0)]
    def concat_right(self):
        ptr=self.arg(0);self.w32(ptr,self.make_string(self.cstr(self.r32(self.arg(1)))+self.cstr(self.arg(2))));return ptr
    def concat_left(self):
        ptr=self.arg(0);self.w32(ptr,self.make_string(self.cstr(self.arg(1))+self.cstr(self.r32(self.arg(2)))));return ptr
    def wsprintf(self):
        ptr=self.arg(0);s=self.render_format();self.u.mem_write(ptr,s+b'\0');return len(s)
    def format(self):
        ptr=self.arg(0);self.w32(ptr,self.make_string(self.render_format()));return ptr
    def render_format(self):
        fmt=self.cstr(self.arg(1)).decode('cp932');n=2
        def sub(m):
            nonlocal n
            v=self.arg(n);n+=1
            if m[0].endswith('s'):v=self.cstr(v).decode('cp932',errors='replace')
            elif m[0].endswith('d') and v>=0x80000000:v-=0x100000000
            return m[0]%v
        return re.sub(r'%[-+0-9.]*[sduxX]',sub,fmt).encode('cp932')
    def on_code(self,u,a,size,user):
        self.recent.append(a)
        if a in self.hooks:
            func,pop=self.hooks[a];value=func();esp=u.reg_read(UC_X86_REG_ESP)
            ret=self.r32(esp);u.reg_write(UC_X86_REG_EAX,value or 0);u.reg_write(UC_X86_REG_ESP,esp+4+pop);u.reg_write(UC_X86_REG_EIP,ret)
        elif a==0x1000000:u.emu_stop()
        elif a<0x400000 or a>=0x449000:raise RuntimeError(f'Unexpected execution {a:08x}')
    def call(self,a,this,*args):
        esp=0x10ff000
        self.u.mem_write(esp,struct.pack('<'+'I'*(1+len(args)),0x1000000,*[n&0xffffffff for n in args]))
        self.u.reg_write(UC_X86_REG_ESP,esp);self.u.reg_write(UC_X86_REG_ECX,this)
        try:self.u.emu_start(a,0x1000000,count=self.instruction_budget)
        except Exception as e:raise RuntimeError(f'{e} at EIP={self.u.reg_read(UC_X86_REG_EIP):08x}; trace='+','.join(f'{a:x}' for a in self.recent)) from e
        if self.u.reg_read(UC_X86_REG_EIP)!=0x1000000:raise RuntimeError('Instruction budget exceeded')
        return self.u.reg_read(UC_X86_REG_EAX)
    def op_table(self):
        a=0x587b40
        return [dict(index=i,name=self.cstr(self.r32(a+4+i*4)).decode('cp932'),words=self.r32(a+0xbc+i*4),opcode=self.u.mem_read(a+0x174+i,1)[0]) for i in range(46)]
    def assemble(self,source):
        self.hooks.pop(0x418671,None)
        self.call(0x416020,0x587b00)
        doc=self.DOC+0x10000
        self.u.mem_write(doc,b'\0'*0x6000)
        self.call(0x402db0,doc)
        self.w32(doc+0x5884,self.make_string(source))
        self.call(0x403fe0,doc)
        count=self.r32(doc+0x521c)
        return dict(errors=self.r32(doc+0x5214),words=count,
                    memory=[self.r16(0x45e8d8+4+i*2) for i in range(min(count,3000))],
                    diagnostics=[self.cstr(self.r32(doc+0x5230+i*4)).decode('cp932',errors='replace') for i in range(min(self.r32(doc+0x5870),200))],
                    rows=[dict(address=self.r32(0x46004c+i*4),label=self.cstr(0x4e8bcc+i*20).decode('cp932',errors='replace'),
                               op=self.cstr(0x4def8c+i*20).decode('cp932',errors='replace'),operand=self.cstr(0x461f8c+i*256).decode('cp932',errors='replace')) for i in range(min(self.r32(doc+0x5208),2000))])
    def build(self,source,base=32,mode=1):
        self.hooks.pop(0x418671,None);self.hooks.pop(0x4035c0,None)
        self.call(0x416020,0x587b00)
        doc=self.DOC+0x10000;srcdoc=self.DOC+0x20000
        self.u.mem_write(doc,b'\0'*0x6000);self.call(0x402db0,doc)
        self.w32(srcdoc+0x50,self.make_string('probe.cas'));self.w32(srcdoc+0x54,self.make_string(source))
        self.w32(doc+0x5228,srcdoc);self.w32(doc+0x78,1);self.w16(0x45c0e8,base)
        self.u.mem_write(0x587db8,bytes([mode==0,mode==1,mode==2]))
        self.call(0x406ec0,doc)
        return dict(errors=self.r32(doc+0x5214),raw_link_counter=self.r32(doc+0x587c),entry=self.r32(0x4f2818),end=self.r32(0x4f2814),
                    memory=[self.r16(self.MEM+4+i*2) for i in range(3000)],
                    diagnostics=[self.cstr(self.r32(doc+0x5230+i*4)).decode('cp932',errors='replace') for i in range(min(self.r32(doc+0x5870),200))])
    def reset(self,minus_one=False):
        self.call(0x4097c0 if minus_one else 0x409780,self.CPU)
        self.call(0x402cf0 if minus_one else 0x402ce0,self.MEM)
        self.u.mem_write(self.DOC+0x68,b'\0'*0x400)
        self.w32(self.DOC+0x280,0xffffffff)
    def state(self):
        return dict(gr=[self.r16(self.CPU+4+i*2) for i in range(8)],pr=self.r16(self.CPU+0x18),sp=self.r16(self.CPU+0x14),fr=self.r16(self.CPU+0x16),
                    ir=[self.r16(self.CPU+0x1a),self.r16(self.CPU+0x1c)],mar=self.r16(self.CPU+0x2c),mdr=self.r16(self.CPU+0x2e),
                    effective=self.r16(self.CPU+0x30),decoder=dict(op=self.r16(self.CPU+0x24),r=self.r16(self.CPU+0x26),x=self.r16(self.CPU+0x28),adr=self.r16(self.CPU+0x2a)),
                    phase=self.r32(self.DOC+0x274),micro=self.r32(self.DOC+0x278),depth=self.r32(self.DOC+0x28c))
    def execute(self,opcode,r=1,x=2,effective=0x100,gr=None,operand=0,fr=0,sp=0x200,depth=0):
        self.reset()
        if gr:
            for i,n in gr.items():self.w16(self.CPU+4+int(i)*2,n)
        self.w16(self.CPU+0x24,opcode);self.w16(self.CPU+0x26,r);self.w16(self.CPU+0x28,x)
        self.w16(self.CPU+0x30,effective);self.w16(self.CPU+0x16,fr);self.w16(self.CPU+0x14,sp)
        self.w16(self.MEM+4+effective*2,operand);self.w32(self.DOC+0x28c,depth)
        trace=[]
        for n in range(12):
            self.w32(self.DOC+0x278,n)
            self.call(0x40cb50,self.DOC)
            trace.append(self.state())
            if self.r32(self.DOC+0x278)==10 or self.r32(self.DOC+0x274)==0xffffffff:break
        return dict(final=self.state(),trace=trace,memory={hex(a):self.r16(self.MEM+4+a*2) for a in [effective,sp,(sp-1)&65535] if a<3000})

if __name__=='__main__':
    o=Oracle()
    (ROOT/'analysis/static/op_table.json').write_text(json.dumps(o.op_table(),indent=2),encoding='utf-8')
    print(json.dumps(o.op_table(),indent=2))
