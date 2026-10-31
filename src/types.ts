export type StepMode = 'instruction' | 'phase' | 'micro';
export type ThemePreference = 'light' | 'dark' | 'system';
export interface DeviceConfig { input_path: string | null; output_path: string | null }
export interface Settings {
  version: number; base: number; fill: number; interval_ms: number; step_mode: StepMode;
  binary_registers: boolean; signed_decimal: boolean; comet_view: boolean; memory_start: number; devices: DeviceConfig;
  auto_save: boolean; recent_files: string[];
  theme: ThemePreference;
  editor_font_family: string; editor_font_size: number;
  editor_insert_spaces: boolean; editor_tab_size: number; editor_detect_indentation: boolean;
  auto_switch_step_mode: boolean;
  auto_comment_overwrite: boolean;
}
export interface CommentEdit { line: number; text: string }
export interface OpenedSource { path: string; source: string }
export interface DeviceSnapshot {
  config: DeviceConfig; input_open: boolean; input_eof: boolean; output_open: boolean;
  output_started: boolean; records_read: number; records_written: number;
  output_bytes: number; buffered_bytes: number;
}
export interface Cpu {
  gr: number[]; pr: number; sp: number; fr: number; ir: number[]; depth: number;
  mar: number; mdr: number; effective: number;
  decoder: { op: number; r: number; x: number; adr: number };
}
export interface Row { file: string | null; line: number; address: number; words: number; source: string }
export interface LabelInfo { name: string; scope: string; file: string | null; line: number; address: number; words: number }
export interface Snapshot {
  cpu: Cpu; memory: number[]; status: 'ready' | 'waiting_input' | 'halted' | 'fault';
  error: string | null; input: { buffer: number; length_cell: number } | null;
  output: string[]; steps: number; replay_target: number | null;
  rows: Row[]; labels: Record<string, number>; symbols: LabelInfo[]; program_end: number; entry: number;
  step_mode: StepMode;
  devices: DeviceSnapshot;
  pipeline: {
    phase: number; micro: number; cycles: number; instructions: number;
    instruction_address: number; transfer: string; active: string[];
  };
}
export interface Diagnostic { file?: string | null; line: number; code: number; message: string }
