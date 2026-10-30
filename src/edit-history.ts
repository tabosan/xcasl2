export interface EditState { value: string; start: number; end: number; top: number; left: number }
/** Backup for WebView native undo stacks, which may be cleared by DOM reparenting. */
export class EditHistory {
  private states: EditState[];
  private index = 0;
  constructor(initial: EditState) { this.states = [{ ...initial }]; }
  before(state: EditState) {
    if (this.states[this.index].value !== state.value) { this.states = [{ ...state }]; this.index = 0; }
    else this.states[this.index] = { ...state };
  }
  record(state: EditState, nativeHistory = false) {
    if (this.states[this.index].value === state.value) return;
    if (nativeHistory) {
      let found = -1;
      for (let i = 0; i < this.states.length; i++) if (this.states[i].value === state.value && (found < 0 || Math.abs(i - this.index) < Math.abs(found - this.index))) found = i;
      if (found >= 0) { this.index = found; return; }
    }
    this.states.splice(this.index + 1); this.states.push({ ...state }); this.index++;
    while (this.states.length > 200 || this.states.length > 2 && this.states.reduce((size, item) => size + item.value.length, 0) > 16_000_000) { this.states.shift(); this.index--; }
  }
  move(direction: -1 | 1): EditState | null {
    const index = this.index + direction;
    if (index < 0 || index >= this.states.length) return null;
    this.index = index; return { ...this.states[index] };
  }
}
