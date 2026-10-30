"""Additional frozen original-x86 traces for implementing Rust micro/phase stepping.

The expectations come from Wcasl2.exe; this script never imports the Rust implementation.
Run with the dependencies in analysis/requirements.txt available (or analysis/vendor).
"""
import json
from oracle import Oracle, ROOT, UC_X86_REG_ECX

o = Oracle()
scenarios = []
for entry in o.op_table()[:38]:
    op = entry['opcode']
    r = 1 if op in [0x10, 0x11, 0x12, 0x14, *range(0x20, 0x28), *range(0x30, 0x37), 0x40, 0x41, 0x44, 0x45, *range(0x50, 0x54), 0x71] else 0
    x = 2 if op not in [0, 0x71, 0x81, 0xf0] else 0
    words = [(op << 8) | (r << 4) | x]
    if entry['words'] == 2:
        words.append(3 if op == 0xf0 else 0x100)
    scenarios.append(dict(id=entry['name'] + '-' + f'{op:02X}', words=words,
                          gr={1: 0x7fff, 2: 4}, fr=7, depth=1 if op == 0x81 else 0))
for op in range(0x61, 0x67):
    for fr in range(8):
        scenarios.append(dict(id=f'branch-{op:02X}-fr{fr}', words=[op << 8, 0x100], fr=fr))
scenarios += [
    dict(id='RET-main', words=[0x8100]),
    dict(id='unknown', words=[0xff00, 0]),
    dict(id='stale-ir', words=[0x1210, 7, 0x1412, 0, 0x8100], instructions=4, gr={2: 0x1234}),
    dict(id='fetch-oob', words=[0x1010], entry=2999),
    dict(id='index-wrap', words=[0x1012, 0xfffe], gr={2: 6}),
    dict(id='PUSH-sp0', words=[0x7000, 0x1234], sp=0),
    dict(id='POP-spFFFF', words=[0x7110], sp=65535),
    dict(id='CALL-sp0', words=[0x8000, 0x100], sp=0),
    dict(id='RET-spFFFF', words=[0x8100], sp=65535, depth=1),
    dict(id='zero-shift', words=[0x5010, 0], gr={1: 0x8001}, fr=7),
    dict(id='IN', words=[0xf000, 1], gr={1: 0x100, 2: 0x90}, input='あｱ'),
    dict(id='OUT', words=[0xf000, 2], gr={1: 0x100, 2: 0x90}, memory={0x100: 65, 0x101: 66, 0x90: 2}),
]

results = []
tracked = [4, 0x90, 0x100, 0x101, 0x102, 0x104, 0x1ff, 0x200, 2999]
for scenario in scenarios:
    for mode in ['micro', 'phase', 'instruction']:
        o.reset()
        o.w16(o.CPU + 0x18, scenario.get('entry', 0x20))
        o.w16(o.CPU + 0x14, scenario.get('sp', 0x200))
        o.w16(o.CPU + 0x16, scenario.get('fr', 0))
        o.w32(o.DOC + 0x28c, scenario.get('depth', 0))
        o.w32(o.DOC + 0x270, int(mode == 'phase'))
        for index, value in scenario.get('gr', {}).items():
            o.w16(o.CPU + 4 + index * 2, value)
        memory = {4: 0x1357, 0x100: 0x8001, 0x104: 0x8001, 0x200: 0x3456}
        memory.update(scenario.get('memory', {}))
        for address, value in memory.items():
            o.w16(o.MEM + 4 + address * 2, value)
        for index, word in enumerate(scenario['words']):
            o.w16(o.MEM + 4 + (scenario.get('entry', 0x20) + index) * 2, word)
        o.w32(o.DOC + 0x58, 0x586120)
        o.call(0x4098a0, 0x586120)
        o.w32(0x587dc8, o.make_string(b''))
        o.w32(0x587dcc, o.make_string(b''))
        o.hooks[0x429654] = (lambda: 0, 8)
        def modal():
            dialog = o.u.reg_read(UC_X86_REG_ECX)
            o.w32(dialog + 0x5c, o.make_string(scenario.get('input', '').encode('cp932')))
            return 1
        o.hooks[0x429709] = (modal, 0)
        def snapshot():
            return dict(**o.state(), memory={str(a): o.r16(o.MEM + 4 + a * 2) for a in tracked},
                        display=[o.cstr(0x586120 + 45 * i).hex() for i in range(12)])
        trace = [snapshot()]
        completed = 0
        for _ in range(160):
            o.call(0x40c480 if mode == 'instruction' else 0x40c410, o.DOC)
            trace.append(snapshot())
            if o.r32(o.DOC + 0x274) == 0xffffffff:
                break
            if o.r32(o.DOC + 0x274) == 0 and o.r32(o.DOC + 0x278) == 0:
                completed += 1
                if completed >= scenario.get('instructions', 1):
                    break
        else:
            raise RuntimeError(f"Trace did not finish: {scenario['id']} {mode}")
        results.append(dict(id=scenario['id'], mode=mode, setup=dict(scenario, memory=memory), trace=trace))

path = ROOT / 'analysis/results/pipeline_port_cases.json'
path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
print(len(results), 'original-x86 traces;', sum(len(c['trace']) - 1 for c in results), 'transitions;', path)
for c in results:
    if c['mode'] != 'micro' or c['id'].startswith('branch-'):
        continue
    print(c['id'], len(c['trace']) - 1, [(s['phase'], s['micro'], s['mar'], s['mdr'], s['effective']) for s in c['trace'] if s['phase'] in [2, 3]])
