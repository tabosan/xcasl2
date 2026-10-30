"""Validate captured native bytes, cmk archives and manually observed evidence."""
import json,hashlib
from pathlib import Path
from oracle import ROOT
from inspect_cmk import decode,serialize_original
out=ROOT/'analysis/results'
def read(name):return json.loads((out/name).read_text(encoding='utf-8'))
d=read('native_io_20261027.json');by={x['id']:x for x in d['observations']}
assert by['before-out']['hex']==d['initial_output_hex']
assert by['ret-closed']['hex']=='41420d0a41420d0a'
assert by['back-before-any-out']['hex']=='41420d0a'
assert by['nul-ret-closed']['hex']=='41'
for x in d['observations']:
    if 'hex' in x:
        raw=(out/'native-io'/f"{x['id']}.bin").read_bytes()
        assert raw.hex()==x['hex']
        assert hashlib.sha256(raw).hexdigest()==x['sha256']
    if x['id'] in ['first-out-after-nop','second-out-open','back-two-out-open','back-one-out-open','nul-out-open']:
        assert x['filesystem_size']==0 and x['read_error']=='PermissionError'
n=read('native_20261027.json');assert len(n['input_cases'])==5
for x in n['input_cases']:
    assert (out/'ui-20261027'/f"{x['id']}.png").exists()
    if 'input_file' in x:assert (out/x['input_file']).exists()
for x in n['cmk_cases']:
    for field in ['image','before_image','after_windows']:
        if field in x:assert (out/x[field]).exists()
    if 'after_windows' in x:assert read(x['after_windows'])['wcasl_windows']==[]
before=decode((out/'cmk-paths/relative-before-main.cmk').read_bytes())
after_raw=(out/'cmk-paths/relative-after-main.cmk').read_bytes();after=decode(after_raw)
assert before['files']==[[s,s] for s in n['cmk_reorder']['before']]
assert [x[1] for x in after['files']]==n['cmk_reorder']['display_after']
assert [x[0] for x in after['files']]==n['cmk_reorder']['stored_paths_after']
assert after['document_strings'][1]=='paththird.cas'
assert after['document_strings'][0].endswith('old\\project.cmk')
assert (out/'cmk-paths/old/project.cmk').read_bytes()==after_raw
assert (out/'cmk-paths/moved/relative.cmk').read_bytes()==(out/'cmk-paths/relative-before-main.cmk').read_bytes()
assert serialize_original(after)==after_raw
missing=decode((out/'cmk-paths/moved/missing-absolute.cmk').read_bytes())
assert all(not Path(x[0]).exists() for x in missing['files'])
assert all((out/'cmk-paths/moved'/x[1]).exists() for x in missing['files'])
p=read('missing_cmk_file_20261027.json')
assert p['events']==[dict(function='fopen',path='missing.cas',mode='rb',return_value=0),dict(function='fgetc',file_pointer=0)]
summary=dict(date='2026-10-27',native_input_cases=5,disk_checkpoints=len(d['observations']),
    native_cmk_path_scenarios=len(n['cmk_cases']),three_file_reorder_mismatch_confirmed=True,
    legacy_saved_path_used=True,unchecked_fopen_failure_confirmed=True,assertions='passed')
(out/'native_audit_20261027.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False,indent=2))
