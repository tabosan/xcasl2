import json
from oracle import ROOT
p=ROOT/'analysis'/'fixtures';p.mkdir(exist_ok=True)
cases=json.loads((ROOT/'analysis/results/assembler_cases.json').read_text(encoding='utf-8'))
for case in cases:
    (p/(case['id']+'.cas')).write_bytes(case['source'].encode('cp932'))
valid="; header\r\n\r\nMAIN START ENTRY\r\nA_B DC -32769,65536,'あｱ','',+1,'A''B'\r\nENTRY RPUSH 1\r\n RPOP\r\n CALL SUB\r\n RET\r\n END\r\nSUB START\r\n RET\r\n END\r\n"
(p/'ui_valid.cas').write_bytes(valid.encode('cp932'))
invalid="MAIN START\r\n lad GR1,1\r\n LAD GR1,1,GR0\r\nA DC #abcd\r\nB DC 'A;B'\r\n RET\r\n END\r\n"
(p/'ui_invalid.cas').write_bytes(invalid.encode('cp932'))
