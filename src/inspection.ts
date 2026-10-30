import type { LabelInfo, Snapshot } from './types';

export const signedWord = (value: number): number => value >= 0x8000 ? value - 0x10000 : value;
export function formatRegisterValue(value: number, decimal: boolean, signed = true): string {
  return decimal ? String(signed ? signedWord(value) : value) : value.toString(16).toUpperCase().padStart(4, '0');
}
export function labelValues(snapshot: Snapshot, signed = true) {
  return snapshot.symbols.flatMap(symbol => Array.from({ length: symbol.words }, (_, offset) => {
    const address = symbol.address + offset, value = snapshot.memory[address];
    return { symbol, offset, address, value, decimal: value === undefined ? null : signed ? signedWord(value) : value };
  }));
}

/** A scrollable 64-word window, following SP or a manually selected address. */
export function stackValues(snapshot: Snapshot, start: number | null) {
  const limit = snapshot.memory.length;
  const first = Math.max(0, Math.min(start ?? snapshot.cpu.sp - 4, Math.max(0, limit - (start === null ? 64 : 1))));
  const count = Math.min(64, limit - first);
  return Array.from({ length: count }, (_, offset) => {
    const address = first + offset;
    return { address, value: snapshot.memory[address], current: address === snapshot.cpu.sp };
  });
}

export function labelSourceRow(symbol: LabelInfo, snapshot: Snapshot) {
  return symbol.line ? snapshot.rows.find(row => row.file === symbol.file && row.line === symbol.line) : undefined;
}
