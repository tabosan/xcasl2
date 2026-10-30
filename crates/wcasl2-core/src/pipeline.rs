//! Transfers and completion points transcribed from the original x86 routines.
//! Phase/micro routing: 0040C410. Instruction routing: 0040C480.
use crate::machine::{Decoder, Machine, Status};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepMode {
    Micro,
    Phase,
    #[default]
    Instruction,
}

#[derive(Clone, Debug, Serialize)]
pub struct Pipeline {
    /// Original numeric phases: 0 fetch, 1 decode, 2 address, 3 execute, FFFFFFFF stopped.
    pub phase: u32,
    pub micro: u32,
    pub cycles: u64,
    pub instructions: u64,
    pub instruction_address: u16,
    pub transfer: String,
    pub active: Vec<&'static str>,
}

impl Pipeline {
    pub(crate) fn new(entry: u16) -> Self {
        Self {
            phase: 0,
            micro: 0,
            cycles: 0,
            instructions: 0,
            instruction_address: entry,
            transfer: "ロード完了".into(),
            active: Vec::new(),
        }
    }
}

impl Machine {
    pub fn step(&mut self) {
        self.step_mode(StepMode::Instruction);
    }

    pub fn step_mode(&mut self, mode: StepMode) {
        if self.status != Status::Ready {
            return;
        }
        match mode {
            StepMode::Micro => self.micro_tick(),
            StepMode::Phase => {
                // The original skips phase 2 for one-word instructions and executes phase 3 here.
                if self.pipeline.phase == 2
                    && Self::instruction_words(self.cpu.decoder.op).unwrap_or(0) <= 1
                {
                    self.pipeline.phase = 3;
                }
                let phase = self.pipeline.phase;
                for _ in 0..16 {
                    self.raw_tick();
                    if self.pipeline.phase != phase || self.status != Status::Ready {
                        break;
                    }
                }
            }
            StepMode::Instruction => {
                // Unlike minimum/phase STEP, 0040C480 visits address generation for one-word
                // instructions too. IR[1] is retained, so this affects the visible EA register.
                for _ in 0..40 {
                    self.raw_tick();
                    if self.status != Status::Ready || self.at_instruction_boundary() {
                        break;
                    }
                }
            }
        }
    }

    pub fn at_instruction_boundary(&self) -> bool {
        self.pipeline.phase == 0 && self.pipeline.micro == 0
    }

    fn micro_tick(&mut self) {
        if self.pipeline.phase == 2
            && Self::instruction_words(self.cpu.decoder.op).unwrap_or(0) <= 1
        {
            self.pipeline.phase = 3;
        }
        self.raw_tick();
    }

    fn transfer(&mut self, text: impl Into<String>, active: &[&'static str]) {
        self.pipeline.transfer = text.into();
        self.pipeline.active = active.to_vec();
    }

    fn next_phase(&mut self, phase: u32) {
        self.pipeline.phase = phase;
        self.pipeline.micro = 0;
    }

    fn finish_instruction(&mut self) {
        self.pipeline.instructions += 1;
        self.next_phase(0);
    }

    fn raw_tick(&mut self) {
        if self.status != Status::Ready {
            return;
        }
        self.pipeline.cycles += 1;
        self.transfer("制御信号の切り替え", &[]);
        match self.pipeline.phase {
            0 => self.fetch_tick(),
            1 => self.decode_tick(),
            2 => self.address_tick(),
            3 => self.execute_tick(),
            _ => (),
        }
    }

    fn fetch_tick(&mut self) {
        let micro = self.pipeline.micro;
        match micro {
            0 | 4 => {
                if micro == 0 {
                    self.pipeline.instruction_address = self.cpu.pr;
                }
                self.cpu.mar = self.cpu.pr;
                self.transfer("PR → MAR", &["pr", "mar"]);
            }
            1 | 5 => self.transfer("MAR → メモリアドレスバス", &["mar", "memory"]),
            2 | 6 => {
                self.cpu.mdr = self.read(self.cpu.mar);
                self.cpu.pr = self.cpu.pr.wrapping_add(1);
                self.transfer("Memory[MAR] → MDR / PR + 1", &["memory", "mdr", "pr"]);
            }
            3 | 7 => {
                self.cpu.ir[(micro / 4) as usize] = self.cpu.mdr;
                self.transfer(format!("MDR → IR{}", micro / 4 + 1), &["mdr", "ir"]);
            }
            _ => (),
        }
        if micro == 7
            || (micro == 3 && Self::instruction_words((self.cpu.ir[0] >> 8) as u8) == Some(1))
        {
            self.next_phase(1);
        } else {
            self.pipeline.micro += 1;
        }
    }

    fn decode_tick(&mut self) {
        if self.pipeline.micro == 0 {
            self.cpu.decoder = Decoder {
                op: (self.cpu.ir[0] >> 8) as u8,
                r: ((self.cpu.ir[0] >> 4) & 15) as u8,
                x: (self.cpu.ir[0] & 15) as u8,
                adr: self.cpu.ir[1],
            };
            self.transfer("IR → opcode / r / x / adr", &["ir", "decoder"]);
            self.pipeline.micro = 1;
        } else {
            self.next_phase(2);
        }
    }

    fn address_tick(&mut self) {
        if self.pipeline.micro == 0 {
            self.transfer("adr・指標レジスタを選択", &["decoder", "gr", "alu"]);
            self.pipeline.micro = 1;
        } else {
            let x = self.cpu.decoder.x as usize;
            let index = match x {
                0 => 0,
                1..=7 => self.cpu.gr[x],
                _ if self.cpu.decoder.op == 0 => {
                    // Instruction STEP also generates the unused EA for NOP. The
                    // original's GR[x] read aliases the fixed CCPU object layout
                    // (0040C9DC). Model those bounded reads, without indexing GR
                    // out of bounds or exposing a host pointer. x=10 reads PR.
                    match x {
                        8 => self.cpu.sp,
                        9 => self.cpu.fr,
                        10 => self.cpu.pr,
                        11 => self.cpu.ir[0],
                        12 => self.cpu.ir[1],
                        13 => 0,      // padding at CCPU+1E
                        14 => 0xb18c, // target EXE's CDecoder vtable (00409684)
                        15 => 0x0044,
                        _ => unreachable!("x is decoded from a four-bit field"),
                    }
                }
                _ => {
                    self.stop_invalid_register();
                    return;
                }
            };
            self.cpu.effective = self.cpu.decoder.adr.wrapping_add(index);
            self.transfer("adr + GRx → 実効アドレス", &["decoder", "gr", "alu", "ea"]);
            self.next_phase(3);
        }
    }

    fn stop_invalid_register(&mut self) {
        self.fault(format!("不正なレジスタ指定: #{:04X}", self.cpu.ir[0]));
        self.pipeline.phase = u32::MAX;
        self.pipeline.micro = 1;
    }

    fn execute_tick(&mut self) {
        let op = self.cpu.decoder.op;
        let r = self.cpu.decoder.r as usize;
        let x = self.cpu.decoder.x as usize;
        let micro = self.pipeline.micro;
        let ea = self.cpu.effective;
        if Self::instruction_words(op).is_none() {
            self.fault(format!("異常終了: 未定義命令 #{op:02X}"));
            self.pipeline.phase = u32::MAX;
            self.pipeline.micro += 1;
            return;
        }
        if op != 0 && (r >= 8 || x >= 8) {
            self.stop_invalid_register();
            return;
        }
        let mut finished = false;
        match op {
            0x00 => {
                self.transfer("NOP", &[]);
                finished = true;
            }
            0x10 | 0x20..=0x23 | 0x30..=0x32 | 0x40..=0x41 => {
                match micro {
                    0 => {
                        self.cpu.mar = ea;
                        self.transfer("実効アドレス → MAR", &["ea", "mar"]);
                    }
                    1 => self.transfer("MAR → メモリアドレスバス", &["mar", "memory"]),
                    2 => {
                        self.cpu.mdr = self.read(self.cpu.mar);
                        self.transfer("Memory[MAR] → MDR", &["memory", "mdr"]);
                    }
                    _ => (),
                }
                if micro == if op == 0x10 { 3 } else { 4 } {
                    self.execute_operand(op, r, x, ea, self.cpu.mdr);
                    self.transfer("MDR → 演算・フラグ更新", &["mdr", "alu", "gr", "fr"]);
                    finished = true;
                }
            }
            0x14 => {
                if micro == 0 {
                    self.flags(self.cpu.gr[x], false);
                    self.transfer("GRx → フラグ更新", &["gr", "fr"]);
                }
                if micro == 1 {
                    self.cpu.gr[r] = self.cpu.gr[x];
                    self.transfer("GRx → GRr", &["gr"]);
                    finished = true;
                }
            }
            0x24..=0x27 | 0x34..=0x36 | 0x44..=0x45 => {
                if micro == 2 {
                    self.execute_operand(op, r, x, ea, self.cpu.gr[x]);
                    self.transfer("GRr・GRx → 演算・フラグ更新", &["gr", "alu", "fr"]);
                    finished = true;
                }
            }
            0x11 => match micro {
                0 => {
                    self.cpu.mar = ea;
                    self.cpu.mdr = self.cpu.gr[r];
                    self.transfer(
                        "実効アドレス → MAR / GRr → MDR",
                        &["ea", "mar", "gr", "mdr"],
                    );
                }
                1 => self.transfer("メモリ書込信号", &["mar", "memory"]),
                2 => {
                    self.write(self.cpu.mar, self.cpu.mdr);
                    self.transfer("MDR → Memory[MAR]", &["mdr", "memory"]);
                    finished = true;
                }
                _ => (),
            },
            0x12 => {
                self.cpu.gr[r] = ea;
                self.transfer("実効アドレス → GRr", &["ea", "gr"]);
                finished = true;
            }
            0x50..=0x53 => {
                if micro == 1 {
                    self.execute_operand(op, r, x, ea, 0);
                    self.transfer("GRrをシフト / フラグ更新", &["gr", "alu", "fr"]);
                    finished = true;
                }
            }
            0x61..=0x66 => {
                self.execute_operand(op, r, x, ea, 0);
                self.transfer("分岐条件を判定 / PR更新", &["fr", "ea", "pr"]);
                finished = true;
            }
            0x70 | 0x80 => match micro {
                0 => {
                    self.cpu.sp = self.cpu.sp.wrapping_sub(1);
                    self.transfer("SP - 1 → SP", &["sp", "alu"]);
                }
                1 => {
                    self.cpu.mar = self.cpu.sp;
                    if op == 0x70 {
                        self.cpu.mdr = ea;
                    }
                    self.transfer("SP → MAR", &["sp", "mar", "mdr"]);
                }
                2 if op == 0x80 => {
                    self.cpu.mdr = self.cpu.pr;
                    self.transfer("PR → MDR", &["pr", "mdr"]);
                }
                3 => {
                    self.write(self.cpu.mar, self.cpu.mdr);
                    self.transfer("MDR → Memory[MAR]", &["mdr", "memory"]);
                    finished = op == 0x70;
                }
                4 if op == 0x80 => {
                    self.cpu.pr = ea;
                    self.cpu.depth = self.cpu.depth.wrapping_add(1);
                    self.transfer("実効アドレス → PR / CALL深さ + 1", &["ea", "pr"]);
                    finished = true;
                }
                _ => (),
            },
            0x71 | 0x81 => {
                if op == 0x81 && self.cpu.depth == 0 {
                    self.status = Status::Halted;
                    self.pipeline.instructions += 1;
                    self.pipeline.phase = u32::MAX;
                    self.pipeline.micro += 1;
                    self.transfer("トップレベルRET / 正常終了", &[]);
                    return;
                }
                match micro {
                    0 => {
                        self.cpu.mar = self.cpu.sp;
                        self.transfer("SP → MAR", &["sp", "mar"]);
                    }
                    1 => {
                        self.cpu.sp = self.cpu.sp.wrapping_add(1);
                        self.transfer("SP + 1 → SP", &["sp", "alu"]);
                    }
                    2 => {
                        self.cpu.mdr = self.read(self.cpu.mar);
                        self.transfer("Memory[MAR] → MDR", &["memory", "mdr"]);
                    }
                    3 => {
                        if op == 0x71 {
                            self.cpu.gr[r] = self.cpu.mdr;
                        } else {
                            self.cpu.pr = self.cpu.mdr;
                            self.cpu.depth -= 1;
                        }
                        self.transfer(
                            if op == 0x71 {
                                "MDR → GRr"
                            } else {
                                "MDR → PR / CALL深さ - 1"
                            },
                            &["mdr", "gr", "pr"],
                        );
                        finished = true;
                    }
                    _ => (),
                }
            }
            0xf0 => {
                if matches!(ea, 1 | 2) {
                    self.execute_operand(op, r, x, ea, 0);
                    self.transfer(
                        if ea == 1 {
                            "SVC 1 / 入力要求"
                        } else {
                            "SVC 2 / 出力"
                        },
                        &["gr", "memory"],
                    );
                    finished = true;
                } else if micro == 10 {
                    self.transfer("未知のSVC / 状態を保持して完了", &[]);
                    finished = true;
                }
            }
            _ => unreachable!("instruction_words covered all supported opcodes"),
        }
        if finished {
            self.finish_instruction();
        } else {
            self.pipeline.micro += 1;
        }
    }
}
