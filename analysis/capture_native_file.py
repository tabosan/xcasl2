"""Capture disk bytes at manually selected native UI milestones; no app control."""
import json,sys,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
out=ROOT/'analysis/results';p=out/'native-io/output-active.txt'
log=out/'native_io_20261027.json'
data=json.loads(log.read_text(encoding='utf-8')) if log.exists() else dict(date='2026-10-27',
    source='analysis/fixtures/ui_native_io.cas',input_hex=(out/'native-io/input.txt').read_bytes().hex(),
    initial_output_hex=b'PREEXISTING-SENTINEL\r\n'.hex(),observations=[])
item=dict(id=sys.argv[1],output_path=str(p.relative_to(ROOT)))
item['source']='analysis/fixtures/ui_native_out_nul.cas' if sys.argv[1].startswith('nul-') else data['source']
try:item['filesystem_size']=p.stat().st_size
except OSError:pass
try:
    raw=p.read_bytes();item.update(size=len(raw),hex=raw.hex(),sha256=hashlib.sha256(raw).hexdigest())
    (out/'native-io'/f'{sys.argv[1]}.bin').write_bytes(raw)
except OSError as e:item.update(read_error=type(e).__name__,winerror=e.winerror)
data['observations'].append(item);log.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(item,ensure_ascii=False))
