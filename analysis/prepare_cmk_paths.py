"""Prepare isolated path-resolution probes; original files are not moved."""
import json
from pathlib import Path
from inspect_cmk import serialize_original,ROOT

base=ROOT/'analysis/results/cmk-paths'
old=base/'old';moved=base/'moved';other=base/'other'
for p in [old,moved,other]:p.mkdir(parents=True,exist_ok=True)
files=[]
for i,name in enumerate(['pathmain.cas','pathsub.cas','paththird.cas']):
    source=f'P{i} START\r\n LAD GR1,{i+1}\r\n RET\r\n END\r\n'.encode('cp932')
    (moved/name).write_bytes(source)
    files.append([str(old/name),name])
fields=dict(document_strings=[str(old/'project.cmk'),files[0][0]],files=files)
(moved/'missing-absolute.cmk').write_bytes(serialize_original(fields))
fields=dict(document_strings=[str(old/'project.cmk'),files[0][1]],files=[[f[1],f[1]] for f in files])
(moved/'relative.cmk').write_bytes(serialize_original(fields))
# An unrelated CASL file is opened afterwards, so the legacy file dialog changes
# directory. Resolve the cmk again without relying on an external process probe.
(other/'change-directory.cas').write_bytes(b'CHANGE START\r\n RET\r\n END\r\n')
(base/'setup.json').write_text(json.dumps(dict(old_directory=str(old),moved_directory=str(moved),
    other_directory=str(other),missing_absolute=files,relative=fields),ensure_ascii=False,indent=2),encoding='utf-8')
print(base)
