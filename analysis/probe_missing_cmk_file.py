"""Observe unchecked fopen failure in the original cmk source-file loader."""
import json
from oracle import Oracle,ROOT
o=Oracle();doc=o.DOC+0x10000;make=o.DOC+0x30000
o.w32(doc+0x522c,make);o.w32(make+0xa8,o.make_string('missing.cas'))
events=[]
def fopen():
    events.append(dict(function='fopen',path=o.cstr(o.arg(0)).decode('cp932'),mode=o.cstr(o.arg(1)).decode('ascii'),return_value=0))
    return 0
def fgetc():
    events.append(dict(function='fgetc',file_pointer=o.arg(0)))
    # Stop before the CRT dereferences NULL. This probe observes the caller's
    # unchecked invocation, not a reconstruction of Windows exception handling.
    raise RuntimeError('Probe stopped at fgetc(NULL)')
o.hooks[0x418fb3]=(fopen,0);o.hooks[0x418f51]=(fgetc,0)
try:o.call(0x4081d0,doc,0)
except RuntimeError as ex:
    assert events[-1]==dict(function='fgetc',file_pointer=0)
assert len(events)==2
r=dict(entry='004081D0',events=events,scope='Original caller; fopen failure mocked; stop before native CRT NULL dereference')
(ROOT/'analysis/results/missing_cmk_file_20261027.json').write_text(json.dumps(r,indent=2),encoding='utf-8')
print(json.dumps(r))
