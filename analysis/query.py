import sys,re,struct,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent/'vendor'))
import pefile
from capstone import *
p=pefile.PE(str(Path(__file__).resolve().parents[1]/'Wcasl2.exe'))
base=p.OPTIONAL_HEADER.ImageBase
def read(a,n):return p.get_data(a-base,n)
def string(a):
    try:
        b=read(a,500).split(b'\0')[0]
        return b.decode('cp932') if b and all(c>=32 for c in b) else ''
    except:return ''
if sys.argv[1]=='classes':
    b=p.__data__
    for match in re.finditer(rb'\.\?AV(C\w+)@@\0',b):
        name=match[1].decode();td=base+p.get_rva_from_offset(match.start()-8)
        if name not in ['CCPU','CDecoder','CMemory','CAsmDoc','CAsmData','CSimDoc','COpTable']:continue
        refs=[base+p.get_rva_from_offset(m.start()) for m in re.finditer(re.escape(struct.pack('<I',td)),b)]
        for r in refs:
            col=r-12
            if read(col,4)!=b'\0'*4:continue
            for m in re.finditer(re.escape(struct.pack('<I',col)),b):
                vt=base+p.get_rva_from_offset(m.start()+4)
                print(name,'vtable',hex(vt),'functions',*[hex(x) for x in struct.unpack('<8I',read(vt,32))])
else:
    start=int(sys.argv[1],16);end=int(sys.argv[2],16)
    md=Cs(CS_ARCH_X86,CS_MODE_32);md.skipdata=True
    for i in md.disasm(read(start,end-start),start):
        if i.mnemonic=='nop':continue
        note=[]
        for n in re.findall(r'0x([0-9a-f]+)',i.op_str):
            a=int(n,16)
            if 0x45c000<=a<0x45d240:
                s=string(a)
                if s:note.append(s)
        print(f'{i.address:08x}: {i.mnemonic:8} {i.op_str:45}',repr(' | '.join(note)) if note else '')
