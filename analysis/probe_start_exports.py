"""Freeze START entry/export observations from the original executable's x86 linker.

Optional argv[1]: an additional CP932 CASL file to compare without modifying it.
"""
import hashlib
import json
import sys
from pathlib import Path
from oracle import Oracle, ROOT

cases = {
    'export_with_leading_data': 'MAIN START\n CALL SUB\n RET\n END\nSUB START GO\nVALUE DC 10\nGO LAD GR1,7\n RET\n END\n',
    'local_reference_to_start_name': 'MAIN START GO\nVALUE DC 10\nGO LAD GR1,MAIN\n RET\n END\n',
    'secondary_missing_entry': 'MAIN START\n RET\n END\nSUB START MISSING\n RET\n END\n',
    'secondary_self_entry': 'MAIN START\n CALL SUB\n RET\n END\nSUB START SUB\n LAD GR1,7\n RET\n END\n',
    'entry_to_external_name': 'MAIN START SUB\n RET\n END\nSUB START GO\nVALUE DC 10\nGO LAD GR1,7\n RET\n END\n',
    'secondary_entry_to_external': 'MAIN START\n CALL SUB\n RET\n END\nSUB START OTHER\n RET\n END\nOTHER START\n LAD GR1,7\n RET\n END\n',
    'cyclic_start_entries': 'MAIN START SUB\n RET\n END\nSUB START MAIN\n RET\n END\n',
}
destination = ROOT / 'analysis/results/k61-compatibility'
destination.mkdir(exist_ok=True)
results = []
for name, source in cases.items():
    oracle = Oracle()
    oracle.instruction_budget = 20_000_000
    result = oracle.build(source.replace('\n', '\r\n'))
    result['memory'] = result['memory'][:max(128, result['end'] + 2)]
    results.append(dict(id=name, source=source, **result))
    print(name, result['entry'], result['errors'], result['diagnostics'])
(destination / 'start_export_cases.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')

if len(sys.argv) > 1:
    path = Path(sys.argv[1])
    raw = path.read_bytes()
    oracle = Oracle()
    oracle.instruction_budget = 20_000_000
    result = oracle.build(raw.decode('cp932'))
    result['source_sha256'] = hashlib.sha256(raw).hexdigest()
    result['source_path'] = str(path)
    (destination / 'original_build.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print('User source:', result['entry'], result['end'], result['errors'], result['diagnostics'])
