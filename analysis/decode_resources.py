import json,struct
from pathlib import Path
OUT=Path(__file__).parent/'static'
class Reader:
    def __init__(self,b): self.b=b; self.p=0
    def unpack(self,fmt):
        v=struct.unpack_from('<'+fmt,self.b,self.p); self.p+=struct.calcsize('<'+fmt); return v[0] if len(v)==1 else v
    def u16(self): return self.unpack('H')
    def text(self):
        a=[]
        while (n:=self.u16()): a.append(n)
        return bytes().join(struct.pack('<H',n) for n in a).decode('utf-16le')
    def field(self):
        n=self.u16()
        if n==0:return ''
        if n==0xffff:return self.u16()
        self.p-=2; return self.text()
    def align(self):self.p=(self.p+3)&~3

def menu(r):
    items=[]
    while r.p<len(r.b):
        flags=r.u16(); ident=None if flags&16 else r.u16(); text=r.text()
        item=dict(flags=hex(flags),id=ident,text=text)
        if flags&16:item['items']=menu(r)
        items.append(item)
        if flags&128:break
    return items

def dialog(r):
    if r.b[:4]==b'\x01\x00\xff\xff':
        version,signature,helpid,exstyle,style,count,x,y,cx,cy=r.unpack('HHIIIHhhhh')
        d=dict(style=hex(style),exstyle=hex(exstyle),rect=[x,y,cx,cy],menu=r.field(),windowclass=r.field(),title=r.field())
        if style&64:d['font']=[r.u16(),r.u16(),r.unpack('B'),r.unpack('B'),r.text()]
        d['controls']=[]
        for _ in range(count):
            r.align();helpid,exstyle,style,x,y,cx,cy,ident=r.unpack('IIIhhhhI')
            c=dict(id=ident,style=hex(style),exstyle=hex(exstyle),rect=[x,y,cx,cy],cls=r.field(),text=r.field())
            n=r.u16();r.p+=n;d['controls'].append(c)
        return d
    style,exstyle,count,x,y,cx,cy=r.unpack('IIHhhhh')
    d=dict(style=hex(style),exstyle=hex(exstyle),rect=[x,y,cx,cy],menu=r.field(),windowclass=r.field(),title=r.field())
    if style&64:d['font']=[r.u16(),r.text()]
    d['controls']=[]
    for _ in range(count):
        r.align();style,exstyle,x,y,cx,cy,ident=r.unpack('IIhhhhH')
        c=dict(id=ident,style=hex(style),exstyle=hex(exstyle),rect=[x,y,cx,cy],cls=r.field(),text=r.field())
        n=r.u16();r.p+=n;d['controls'].append(c)
    return d

allres={}
for entry in json.loads((OUT/'resources.json').read_text(encoding='utf-8')):
    kind=entry['path'][0];r=Reader((OUT/entry['file']).read_bytes())
    if kind=='4':
        version,offset=r.unpack('HH');r.p=4+offset
        value=menu(r)
    elif kind=='5':
        try:value=dialog(r)
        except Exception as e:value={'error':str(e)}
    elif kind=='9':
        value=[]
        while r.p+8<=len(r.b):
            flags,key,cmd,pad=r.unpack('HHHH');value.append(dict(flags=hex(flags),key=key,cmd=cmd))
    else:continue
    allres['/'.join(entry['path'])]=value
(OUT/'ui_resources.json').write_text(json.dumps(allres,ensure_ascii=False,indent=2),encoding='utf-8')
for name,val in allres.items():
    print(name,json.dumps(val,ensure_ascii=False))
