use serde::Serialize;

#[derive(Clone, Debug, Default, Serialize)]
pub struct Decoder {
    pub op: u8,
    pub r: u8,
    pub x: u8,
    pub adr: u16,
}

pub const MEMORY_WORDS: usize = 3000;

#[derive(Clone, Debug, Serialize)]
pub struct Cpu {
    pub gr: [u16; 8],
    pub sp: u16,
    pub pr: u16,
    /// Bits 2, 1, 0 are OF, SF, ZF.
    pub fr: u16,
    pub ir: [u16; 2],
    pub depth: u32,
    pub mar: u16,
    pub mdr: u16,
    pub effective: u16,
    pub decoder: Decoder,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Ready,
    WaitingInput,
    Halted,
    Fault,
}

#[derive(Clone, Debug, Serialize)]
pub struct InputRequest {
    pub buffer: u16,
    pub length_cell: u16,
}

#[derive(Clone, Debug)]
pub struct Machine {
    pub cpu: Cpu,
    pub memory: Vec<u16>,
    pub status: Status,
    pub error: Option<String>,
    pub input: Option<InputRequest>,
    pub pipeline: crate::pipeline::Pipeline,
    pub output_to_file: bool,
    pub(crate) pending_output: Option<Vec<u8>>,
    display: Vec<Vec<u8>>,
}

impl Machine {
    pub fn new(fill: u16, entry: u16, sp: u16) -> Self {
        Self {
            cpu: Cpu {
                gr: [fill; 8],
                sp,
                pr: entry,
                fr: 0,
                ir: [fill; 2],
                depth: 0,
                mar: fill,
                mdr: fill,
                effective: fill,
                decoder: Decoder::default(),
            },
            memory: vec![fill; MEMORY_WORDS],
            status: Status::Ready,
            error: None,
            input: None,
            pipeline: crate::pipeline::Pipeline::new(entry),
            output_to_file: false,
            pending_output: None,
            display: vec![Vec::new()],
        }
    }

    pub fn read(&self, address: u16) -> u16 {
        self.memory.get(address as usize).copied().unwrap_or(0xffff)
    }

    pub fn write(&mut self, address: u16, value: u16) {
        if let Some(cell) = self.memory.get_mut(address as usize) {
            *cell = value;
        }
    }

    pub fn output(&self) -> Vec<String> {
        self.display
            .iter()
            .map(|line| crate::decode_cp932(line))
            .collect()
    }

    pub(crate) fn flags(&mut self, value: u16, overflow: bool) {
        self.cpu.fr = (u16::from(overflow) << 2) | ((value >> 14) & 2) | u16::from(value == 0);
    }

    pub(crate) fn fault(&mut self, message: String) {
        self.status = Status::Fault;
        self.error = Some(message);
    }

    pub fn instruction_words(op: u8) -> Option<u16> {
        match op {
            0x00 | 0x14 | 0x24..=0x27 | 0x34..=0x36 | 0x44..=0x45 | 0x71 | 0x81 => Some(1),
            0x10..=0x12
            | 0x20..=0x23
            | 0x30..=0x32
            | 0x40..=0x41
            | 0x50..=0x53
            | 0x61..=0x66
            | 0x70
            | 0x80
            | 0xf0 => Some(2),
            _ => None,
        }
    }

    /// Instruction execution stage, exposed for comparison against the original x86 oracle.
    pub fn execute_decoded(&mut self, op: u8, r: usize, x: usize, effective: u16) {
        // The original dispatches NOP by its high byte and ignores both unused nibbles.
        // Data such as DC 10 (#000A) can therefore be executed as NOP.
        if op == 0 {
            return;
        }
        if r >= 8 || x >= 8 {
            self.fault("不正なレジスタ指定".into());
            return;
        }
        let register_form = matches!(op, 0x14 | 0x24..=0x27 | 0x34..=0x36 | 0x44..=0x45);
        let b = if register_form {
            self.cpu.gr[x]
        } else {
            self.read(effective)
        };
        self.execute_operand(op, r, x, effective, b);
    }

    /// The bus operand has already been latched; committing must not re-read memory.
    pub(crate) fn execute_operand(&mut self, op: u8, r: usize, _x: usize, effective: u16, b: u16) {
        let a = self.cpu.gr[r];
        match op {
            0x00 => (),
            0x10 | 0x14 => {
                self.cpu.gr[r] = b;
                self.flags(b, false);
            }
            0x11 => self.write(effective, a),
            0x12 => self.cpu.gr[r] = effective,
            0x20..=0x27 => {
                let kind = op & 3;
                let (value, carry) = if kind & 1 == 0 {
                    a.overflowing_add(b)
                } else {
                    a.overflowing_sub(b)
                };
                let overflow = match kind {
                    0 => (a as i16).overflowing_add(b as i16).1,
                    1 => (a as i16).overflowing_sub(b as i16).1,
                    _ => carry,
                };
                self.cpu.gr[r] = value;
                self.flags(value, overflow);
            }
            0x30..=0x32 | 0x34..=0x36 => {
                let value = match op & 3 {
                    0 => a & b,
                    1 => a | b,
                    _ => a ^ b,
                };
                self.cpu.gr[r] = value;
                self.flags(value, false);
            }
            0x40 | 0x41 | 0x44 | 0x45 => {
                let less = if op & 1 == 0 {
                    (a as i16) < (b as i16)
                } else {
                    a < b
                };
                self.cpu.fr = (u16::from(less) << 1) | u16::from(a == b);
            }
            0x50..=0x53 => {
                let mut value = a;
                let mut overflow = false;
                if effective != 0 {
                    let k = ((effective - 1) & 31) as u32;
                    // x86 performs a masked (n-1)-bit shift followed by a final 1-bit shift.
                    match op {
                        0x50 => {
                            let mid = (((a & 0x7fff) as u32) << k) as u16;
                            overflow = mid & 0x4000 != 0;
                            value = (a & 0x8000) | ((mid << 1) & 0x7fff);
                        }
                        0x51 => {
                            let mid = ((a as i16 as i32) >> k) as u16;
                            overflow = mid & 1 != 0;
                            value = ((mid as i16) >> 1) as u16;
                        }
                        0x52 => {
                            let mid = ((a as u32) << k) as u16;
                            overflow = mid & 0x8000 != 0;
                            value = mid << 1;
                        }
                        _ => {
                            let mid = ((a as u32) >> k) as u16;
                            overflow = mid & 1 != 0;
                            value = mid >> 1;
                        }
                    }
                }
                self.cpu.gr[r] = value;
                self.flags(value, overflow);
            }
            0x61..=0x66 => {
                let take = match op {
                    0x61 => self.cpu.fr & 2 != 0,
                    0x62 => self.cpu.fr & 1 == 0,
                    0x63 => self.cpu.fr & 1 != 0,
                    0x64 => true,
                    0x65 => self.cpu.fr & 3 == 0,
                    _ => self.cpu.fr & 4 != 0,
                };
                if take {
                    self.cpu.pr = effective;
                }
            }
            0x70 | 0x80 => {
                self.cpu.sp = self.cpu.sp.wrapping_sub(1);
                self.write(
                    self.cpu.sp,
                    if op == 0x70 { effective } else { self.cpu.pr },
                );
                if op == 0x80 {
                    self.cpu.depth = self.cpu.depth.wrapping_add(1);
                    self.cpu.pr = effective;
                }
            }
            0x71 => {
                self.cpu.gr[r] = self.read(self.cpu.sp);
                self.cpu.sp = self.cpu.sp.wrapping_add(1);
            }
            0x81 => {
                if self.cpu.depth == 0 {
                    self.status = Status::Halted;
                } else {
                    self.cpu.pr = self.read(self.cpu.sp);
                    self.cpu.sp = self.cpu.sp.wrapping_add(1);
                    self.cpu.depth -= 1;
                }
            }
            0xf0 => match effective {
                1 => {
                    self.input = Some(InputRequest {
                        buffer: self.cpu.gr[1],
                        length_cell: self.cpu.gr[2],
                    });
                    self.status = Status::WaitingInput;
                }
                2 => {
                    let length = self.read(self.cpu.gr[2]);
                    if self.output_to_file {
                        if length != 0 {
                            self.pending_output = Some(
                                (0..length)
                                    .map(|i| self.read(self.cpu.gr[1].wrapping_add(i)) as u8)
                                    .collect(),
                            );
                        }
                        return;
                    }
                    for i in 0..length {
                        let byte = self.read(self.cpu.gr[1].wrapping_add(i)) as u8;
                        self.display_byte(byte);
                    }
                }
                _ => (),
            },
            _ => self.fault(format!("異常終了: 未定義命令 #{op:02X}")),
        }
    }

    fn display_byte(&mut self, byte: u8) {
        let byte = if byte == 0 || byte >= 0xe0 {
            b' '
        } else {
            byte
        };
        if byte == b'\n' {
            self.new_line();
        } else {
            if self.display.last().is_some_and(|line| line.len() == 44) {
                self.new_line();
            }
            self.display
                .last_mut()
                .expect("display always has a row")
                .push(byte);
        }
    }

    fn new_line(&mut self) {
        if self.display.len() == 12 {
            self.display.remove(0);
        }
        self.display.push(Vec::new());
    }

    pub fn supply_input(&mut self, text: Option<&str>) -> Result<(), String> {
        let bytes = text.map(crate::encode_cp932).transpose()?;
        if bytes.as_ref().is_some_and(|value| value.len() > 128) {
            return Err("初版のキーボード入力はCP932で128バイト以内にしてください。".into());
        }
        self.complete_input(bytes.as_deref())
    }

    /// CString endpoint before TrimRight/cut; useful for the original file-IN oracle.
    pub fn supply_file_input(&mut self, endpoint: Option<&[u8]>) -> Result<(), String> {
        let record = crate::devices::file_input_record(endpoint);
        self.complete_input(record.as_deref())
    }

    pub(crate) fn complete_input(&mut self, bytes: Option<&[u8]>) -> Result<(), String> {
        let request = self.input.clone().ok_or("入力待ちではありません。")?;
        if let Some(bytes) = bytes {
            for (i, byte) in bytes.iter().enumerate() {
                self.write(request.buffer.wrapping_add(i as u16), *byte as u16);
            }
            self.write(request.length_cell, bytes.len() as u16);
        } else {
            self.write(request.length_cell, 0xffff);
        }
        self.input = None;
        self.status = Status::Ready;
        Ok(())
    }
}
