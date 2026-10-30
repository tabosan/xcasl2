"""Reproducible static inventory of the supplied WCASL2 executable."""
import sys, json, hashlib, re, struct
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / 'vendor'))
import pefile
from capstone import Cs, CS_ARCH_X86, CS_MODE_32

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'analysis' / 'static'
OUT.mkdir(parents=True, exist_ok=True)
data = (ROOT / 'Wcasl2.exe').read_bytes()
pe = pefile.PE(data=data)
base = pe.OPTIONAL_HEADER.ImageBase

def va(off):
    try: return base + pe.get_rva_from_offset(off)
    except Exception: return None

summary = dict(sha256=hashlib.sha256(data).hexdigest(), size=len(data), machine=pe.FILE_HEADER.Machine,
               timestamp=pe.FILE_HEADER.TimeDateStamp, image_base=hex(base), entry=hex(base+pe.OPTIONAL_HEADER.AddressOfEntryPoint),
               sections=[dict(name=s.Name.rstrip(b'\0').decode(), rva=hex(s.VirtualAddress), raw=hex(s.PointerToRawData), size=s.SizeOfRawData) for s in pe.sections],
               imports={e.dll.decode():[i.name.decode() if i.name else f'ordinal:{i.ordinal}' for i in e.imports] for e in pe.DIRECTORY_ENTRY_IMPORT})
(OUT / 'pe.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
strings=[]
for m in re.finditer(rb'[\x20-\x7e\xa1-\xdf\x81-\x9f\xe0-\xfc]{4,}',data):
    value=m.group().decode('cp932',errors='replace')
    strings.append(dict(offset=hex(m.start()),va=hex(va(m.start()) or 0),text=value))
(OUT / 'strings.json').write_text(json.dumps(strings,ensure_ascii=False,indent=2),encoding='utf-8')

resources=[]
def walk(directory,path):
    for e in directory.entries:
        name=str(e.name) if e.name else str(e.id)
        p=path+[name]
        if hasattr(e,'directory'): walk(e.directory,p)
        else:
            d=e.data.struct
            raw=pe.get_data(d.OffsetToData,d.Size)
            fname='_'.join(p)+'.bin'
            (OUT/fname).write_bytes(raw)
            resources.append(dict(path=p,rva=hex(d.OffsetToData),va=hex(base+d.OffsetToData),size=d.Size,file=fname))
            if p[0]=='6':
                pos=0
                for n in range(16):
                    length=struct.unpack_from('<H',raw,pos)[0];pos+=2
                    s=raw[pos:pos+length*2].decode('utf-16le');pos+=length*2
                    if s: resource_strings.append(dict(id=(int(p[1])-1)*16+n,text=s))
resource_strings=[]
walk(pe.DIRECTORY_ENTRY_RESOURCE,[])
(OUT/'resources.json').write_text(json.dumps(resources,ensure_ascii=False,indent=2),encoding='utf-8')
(OUT/'resource_strings.json').write_text(json.dumps(resource_strings,ensure_ascii=False,indent=2),encoding='utf-8')
md=Cs(CS_ARCH_X86,CS_MODE_32)
md.skipdata=True
with (OUT/'disassembly.txt').open('w',encoding='utf-8') as f:
    for s in pe.sections:
        if s.Characteristics & 0x20000000:
            for ins in md.disasm(s.get_data(),base+s.VirtualAddress):
                f.write(f'{ins.address:08x}: {ins.bytes.hex():24s} {ins.mnemonic:8s} {ins.op_str}\n')
print(json.dumps(summary,ensure_ascii=False,indent=2))
print('Resource strings:',len(resource_strings),'resources:',len(resources))
