"""Observe execution of data words whose opcode byte is NOP in the original x86."""
import json
import sys
from pathlib import Path
from oracle import Oracle, ROOT

destination = ROOT / 'analysis/results/k61-compatibility'
destination.mkdir(exist_ok=True)
results = []
for word in [0x0000, 0x0007, 0x0008, 0x0009, 0x000A, 0x000B, 0x000C, 0x000D, 0x000E, 0x000F, 0x0080, 0x00FF]:
    for mode in ['instruction', 'phase', 'micro']:
        oracle = Oracle()
        oracle.reset(minus_one=True)
        oracle.w16(oracle.CPU + 0x18, 0x20)
        oracle.w16(oracle.CPU + 0x14, 0x200)
        oracle.w32(oracle.DOC + 0x270, int(mode == 'phase'))
        oracle.w16(oracle.CPU + 0x1c, 0x1234)
        oracle.w16(oracle.MEM + 4 + 0x20 * 2, word)
        trace = [oracle.state()]
        for _ in range(40):
            oracle.call(0x40c480 if mode == 'instruction' else 0x40c410, oracle.DOC)
            trace.append(oracle.state())
            if oracle.r32(oracle.DOC + 0x274) == 0 and oracle.r32(oracle.DOC + 0x278) == 0:
                break
        else:
            raise RuntimeError(f'NOP did not finish: {word:04X}, {mode}')
        results.append(dict(word=word, mode=mode, trace=trace))
(destination / 'nop_padding_cases.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
print(len(results), 'NOP traces saved')

if len(sys.argv) > 1:
    path = Path(sys.argv[1])
    oracle = Oracle()
    oracle.instruction_budget = 20_000_000
    build = oracle.build(path.read_bytes().decode('cp932'))
    oracle.call(0x4097c0, oracle.CPU)  # Reset only CPU; retain the linked memory.
    oracle.w16(oracle.CPU + 0x18, build['entry'])
    oracle.w16(oracle.CPU + 0x14, build['end'] + 1)
    oracle.w32(oracle.DOC + 0x274, 0)
    oracle.w32(oracle.DOC + 0x278, 0)
    oracle.w32(oracle.DOC + 0x28c, 0)
    oracle.w32(oracle.DOC + 0x58, 0x586120)
    oracle.call(0x4098a0, 0x586120)
    oracle.w32(0x587dc8, oracle.make_string(b''))
    oracle.w32(0x587dcc, oracle.make_string(b''))
    oracle.hooks[0x429654] = (lambda: 0, 8)
    trace = []
    for step in range(100_000):
        if step < 12:
            trace.append(oracle.state())
        oracle.call(0x40c480, oracle.DOC)
        if oracle.r32(oracle.DOC + 0x274) == 0xFFFFFFFF:
            break
    else:
        raise RuntimeError('User program did not stop')
    display = [oracle.cstr(0x586120 + 45 * i).decode('cp932', errors='replace') for i in range(12)]
    result = dict(instructions=step + 1, initial_trace=trace, final=oracle.state(), memory=[oracle.r16(oracle.MEM + 4 + i * 2) for i in range(3000)], display=display)
    (destination / 'original_execution.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print('User program:', step + 1, 'instructions;', display)
