import hashlib,json,re,ast
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
expected='389365c3f036b9c5461d669dafe98d7772b412167d3aee1730fb441e8275f74e'
assert hashlib.sha256((ROOT/'Wcasl2.exe').read_bytes()).hexdigest()==expected
docs=[ROOT/'README.md',*sorted((ROOT/'docs').glob('*.md'))]
broken=[]
for p in docs:
    s=p.read_text(encoding='utf-8')
    for label,target in re.findall(r'\[([^\]]+)\]\(([^)]+)\)',s):
        if '://' not in target and not target.startswith('#') and not (p.parent/target.split('#')[0]).exists():broken.append((str(p),target))
    assert s.count('```')%2==0,(p,'unbalanced fence')
assert not broken,broken
for p in (ROOT/'analysis').glob('*.py'):ast.parse(p.read_text(encoding='utf-8'),filename=str(p))
summary=json.loads((ROOT/'analysis/results/audit_summary.json').read_text(encoding='utf-8'))
assert summary['cpu_probe_count']==1420
assert summary['cpu_reference_comparison_count']==980
assert summary['cpu_reference_mismatches']==[]
assert summary['files']['build_cases.json']['probe_errors']==[]
assert len(json.loads((ROOT/'analysis/static/op_table.json').read_text()))==46
native=json.loads((ROOT/'analysis/results/native_observations.json').read_text(encoding='utf-8'))
for item in native['observations']:assert (ROOT/'analysis/results'/item['image']).exists()
followup=json.loads((ROOT/'analysis/results/followup_audit.json').read_text(encoding='utf-8'))
assert followup['assertions']=='passed'
assert (followup['boundary_cases'],followup['replay_scenarios'],followup['file_input_cases'])==(54,5,9)
native_followup=json.loads((ROOT/'analysis/results/followup_native.json').read_text(encoding='utf-8'))
for item in native_followup['observations']:assert (ROOT/'analysis/results'/item['image']).exists()
native_audit=json.loads((ROOT/'analysis/results/native_audit_20261027.json').read_text(encoding='utf-8'))
assert native_audit['assertions']=='passed'
assert (native_audit['native_input_cases'],native_audit['disk_checkpoints'],native_audit['native_cmk_path_scenarios'])==(5,11,3)
files=[*docs,*sorted(p for p in (ROOT/'analysis/results').rglob('*') if p.is_file())]
manifest=dict(date='2026-10-27',target_sha256=expected,files=[dict(path=str(p.relative_to(ROOT)).replace('\\','/'),size=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in files])
(ROOT/'analysis/manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print('Verified:',len(docs),'Markdown documents, links, code fences, Python syntax, EXE hash and probe summary.')
for p in docs:print(str(p.relative_to(ROOT)),len(p.read_text(encoding='utf-8')),'characters')
