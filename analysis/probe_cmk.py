"""Capture actual CMakeDoc::Serialize output, without any host file writes by EXE."""
import json,struct
from oracle import Oracle,ROOT
o=Oracle();doc=o.DOC+0x30000;archive=o.DOC+0x40000;buf=o.DOC+0x50000
fields=dict(document_strings=['fixture.cmk','metadata'],files=[['C:\\fixtures\\main.cas','main.cas'],['C:\\fixtures\\副.cas','副.cas']])
o.w32(doc+0xf8,len(fields['files']))
for off,s in zip([0x50,0x54],fields['document_strings']):o.w32(doc+off,o.make_string(s))
for i,(path,name) in enumerate(fields['files']):
    o.w32(doc+0xa8+i*4,o.make_string(path));o.w32(doc+0x58+i*4,o.make_string(name))
o.w32(archive+0x24,buf);o.w32(archive+0x28,buf+0x10000)
o.call(0x40ab50,doc,archive)
raw=bytes(o.u.mem_read(buf,o.r32(archive+0x24)-buf))
(ROOT/'analysis/results/synthetic-archive.cmk').write_bytes(raw)
(ROOT/'analysis/results/cmk_case.json').write_text(json.dumps(dict(fields=fields,hex=raw.hex(),size=len(raw)),ensure_ascii=False,indent=2),encoding='utf-8')
print('Serialized',len(raw),'bytes:',raw.hex())
