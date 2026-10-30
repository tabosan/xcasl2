"""Check important observations and evidence consistency from followup probes."""
import json
from oracle import ROOT
from inspect_cmk import decode,serialize_original

out=ROOT/'analysis/results'
def read(name):return json.loads((out/name).read_text(encoding='utf-8'))

b=read('followup_boundaries.json');assert len(b)==54
assert all('probe_error' not in x for x in b)
by={x['id']:x for x in b}
for name,item in by.items():
    if name.startswith('crlf_'):
        other=by['lf_'+name[5:]]
        assert item['diagnostics']==other['diagnostics'],name
    expected_error=('_tail_comment' in name or '_tail_indented_comment' in name or
                    ('_after_end_' in name and name.endswith('comment')) or
                    (any('_'+pos+'_' in name for pos in ['before','middle','before_end']) and
                     name.endswith(('blank','space','tab'))))
    assert bool(item['errors'])==expected_error,name

r={x['id']:x for x in read('followup_replay.json')};assert len(r)==5
for name in ['out','in','rpush_rpop','file_out_replay']:
    x=r[name]
    assert x['back1']['steps']==x['trace'][-1]['steps']-1
    assert x['back2']['steps']==x['back1']['steps']-1
    for snap in x['rewind_to_zero']:
        original=x['trace'][snap['steps']]
        # Replay a full instruction must reproduce CPU/phase/stack state.
        for field in ['pr','sp','gr','fr','phase','micro','depth']:
            assert snap[field]==original[field],(name,snap['steps'],field)
    assert x['rewind_to_zero'][-1]['steps']==0
assert r['in']['back1']['input_requests']==2
assert r['in']['back2']['input_requests']==3
assert r['in']['back1']['memory_0020_005f'][14:16]==list(b'K2')
assert r['in']['back2']['memory_0020_005f'][14:16]==list(b'K3')
for snap in r['out']['rewind_to_zero']:
    assert snap['display_rows'][0]==('4142' if snap['steps']>=5 else '')
assert r['rpush_rpop']['trace'][7]['sp']==r['rpush_rpop']['trace'][0]['sp']-7
assert r['rpush_rpop']['trace'][14]['sp']==r['rpush_rpop']['trace'][0]['sp']
assert r['file_out_replay']['rewind_to_zero'][-1]['virtual_file_hex']=='41420a'
assert r['file_out_nul_endpoint']['final']['virtual_file_hex']=='41'
assert all(e['flags']=='0x5001' for e in r['file_out_replay']['back1']['events'] if e['event']=='open')

f=read('followup_file_input.json');assert len(f)==9
assert all('probe_error' not in x for x in f)
lengths={'plain':4,'spaces':4,'tab':1,'crlf':1,'all_space':0,'long':256,
         'long_space_tail':256,'empty':0,'eof':65535}
for x in f:
    assert x['length']==lengths[x['id']],x['id']
    n=0 if x['length']==65535 else x['length']
    assert x['buffer'][n]==0xcccc,(x['id'],'unexpected terminator overwrite')

c=read('followup_cmk.json');assert len(c)==3
for x in c:
    raw=(out/x['file']).read_bytes()
    assert decode(raw)==x['fields']
    assert serialize_original(x['fields'])==raw
before=c[1]['fields'];after=c[2]['fields']
assert after['files']==list(reversed(before['files']))
assert before['document_strings'][1]==before['files'][0][0]
assert after['document_strings'][1]==after['files'][0][0]

native=read('followup_native.json')
for x in native['observations']:assert (out/x['image']).is_file(),x['id']
settings=read('followup_settings.json')
assert settings['values']==dict(baseaddress='32',loadmode='1',intervaltime='1')
summary=dict(boundary_cases=len(b),replay_scenarios=len(r),file_input_cases=len(f),
             original_serializer_matches=len(c),native_saved_cmk_examples=2,
             native_observations=len(native['observations']),assertions='passed',
             limitations=['Reload image, UI dialogs, file/CRT endpoints are explicitly mocked.',
                          'Native disk CRLF/flush/error paths remain unmeasured.'])
(out/'followup_audit.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False,indent=2))
