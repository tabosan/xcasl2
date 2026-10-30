"""Decode captured ANSI MFC archives and compare against original serialization.

This inspection utility bounds-checks input. It is not a claim about malformed
archive handling by the legacy application; Unicode CString archives excluded.
"""
import json, struct
from oracle import Oracle, ROOT

def decode(raw):
    pos=0
    def take(n):
        nonlocal pos
        if n<0 or pos+n>len(raw):raise ValueError('Truncated archive')
        out=raw[pos:pos+n];pos+=n;return out
    def string():
        n=take(1)[0]
        if n==255:
            n=struct.unpack('<H',take(2))[0]
            if n==65534:raise ValueError('Unicode archive is outside this probe')
            if n==65535:n=struct.unpack('<I',take(4))[0]
        return take(n).decode('cp932')
    count=struct.unpack('<i',take(4))[0]
    if not 0<=count<=20:raise ValueError('File count outside legacy UI capacity')
    fields=dict(document_strings=[string(),string()],files=[[string(),string()] for _ in range(count)])
    if pos!=len(raw):raise ValueError('Trailing archive bytes')
    return fields

def serialize_original(fields):
    o=Oracle();doc=o.DOC+0x30000;archive=o.DOC+0x40000;buf=o.DOC+0x50000
    o.w32(doc+0xf8,len(fields['files']))
    for off,s in zip([0x50,0x54],fields['document_strings']):o.w32(doc+off,o.make_string(s))
    for i,(path,name) in enumerate(fields['files']):
        o.w32(doc+0xa8+4*i,o.make_string(path));o.w32(doc+0x58+4*i,o.make_string(name))
    o.w32(archive+0x24,buf);o.w32(archive+0x28,buf+0x10000)
    o.call(0x40ab50,doc,archive)
    return bytes(o.u.mem_read(buf,o.r32(archive+0x24)-buf))

def main():
    result=[]
    for name in ['synthetic-archive.cmk','native-project-before-main.cmk','native-project.cmk']:
        path=ROOT/'analysis/results'/name;raw=path.read_bytes();fields=decode(raw)
        generated=serialize_original(fields)
        assert generated==raw,(name,'original serializer mismatch')
        result.append(dict(file=name,size=len(raw),fields=fields,original_serializer_byte_match=True,hex=raw.hex()))
        print(name,len(raw),json.dumps(fields,ensure_ascii=False))
    dest=ROOT/'analysis/results/cmk-relocated';dest.mkdir(exist_ok=True)
    import shutil
    fields=decode((ROOT/'analysis/results/native-project-before-main.cmk').read_bytes())
    # Keep the captured absolute paths intact: moving the archive alone test.
    shutil.copyfile(ROOT/'analysis/results/native-project-before-main.cmk',dest/'absolute.cmk')
    # Separate synthetic relative-path fixture, no modification of native sample.
    for file in fields['files']:
        shutil.copyfile(ROOT/'analysis/fixtures'/file[1],dest/file[1]);file[0]=file[1]
    fields['document_strings']=['relative.cmk',fields['files'][0][0]]
    (dest/'relative.cmk').write_bytes(serialize_original(fields))
    (ROOT/'analysis/results/followup_cmk.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')

if __name__=='__main__':main()
