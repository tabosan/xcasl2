use crate::{
    assembler::{Image, LabelInfo},
    devices::FileDevices,
    machine::InputRequest,
    pipeline::Pipeline,
    Cpu, DeviceConfig, DeviceSnapshot, Machine, SourceRow, Status, StepMode,
};
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Serialize)]
pub struct Snapshot {
    pub cpu: Cpu,
    pub memory: Vec<u16>,
    pub status: Status,
    pub error: Option<String>,
    pub input: Option<InputRequest>,
    pub output: Vec<String>,
    pub steps: u64,
    pub replay_target: Option<u64>,
    pub rows: Vec<SourceRow>,
    pub labels: BTreeMap<String, u16>,
    pub symbols: Vec<LabelInfo>,
    pub program_end: u16,
    pub entry: u16,
    pub pipeline: Pipeline,
    pub step_mode: StepMode,
    pub devices: DeviceSnapshot,
}

pub struct Session {
    image: Image,
    fill: u16,
    pub machine: Machine,
    pub steps: u64,
    replay_target: Option<u64>,
    pub step_mode: StepMode,
    replay_mode: StepMode,
    devices: FileDevices,
}

impl Session {
    pub fn new(image: Image, fill: u16) -> Self {
        let machine = image.load(fill);
        Self {
            image,
            fill,
            machine,
            steps: 0,
            replay_target: None,
            step_mode: StepMode::Instruction,
            replay_mode: StepMode::Instruction,
            devices: FileDevices::default(),
        }
    }

    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            cpu: self.machine.cpu.clone(),
            memory: self.machine.memory.clone(),
            status: self.machine.status,
            error: self.machine.error.clone(),
            input: self.machine.input.clone(),
            output: self.machine.output(),
            steps: self.steps,
            replay_target: self.replay_target,
            rows: self.image.rows.clone(),
            labels: self.image.labels.clone(),
            symbols: self.image.symbols.clone(),
            program_end: self.image.program_end,
            entry: self.image.entry,
            pipeline: self.machine.pipeline.clone(),
            step_mode: self.step_mode,
            devices: self.devices.snapshot(),
        }
    }

    pub fn device_config(&self) -> &DeviceConfig {
        self.devices.config()
    }

    pub fn reset(&mut self) {
        if let Err(error) = self.devices.rewind() {
            self.fail_io(error);
            return;
        }
        self.machine = self.image.load(self.fill);
        self.machine.output_to_file = self.devices.config().output_path.is_some();
        self.steps = 0;
        self.replay_target = None;
    }

    pub fn step(&mut self) {
        if self.replay_target.is_some() {
            self.advance_replay();
            return;
        }
        if self.machine.status == Status::Ready {
            self.machine.step_mode(self.step_mode);
            self.steps += 1;
            self.service_devices();
        }
    }

    pub fn run_batch(&mut self, count: u32) {
        for _ in 0..count.min(1000) {
            if self.machine.status != Status::Ready {
                break;
            }
            let replaying = self.replay_target.is_some();
            self.step();
            // Stop at the rewind destination instead of running past it in the same batch.
            if replaying {
                break;
            }
        }
    }

    pub fn back(&mut self) {
        let target = self.steps.saturating_sub(1);
        let mode = self.step_mode;
        self.reset();
        if self.machine.status == Status::Fault {
            return;
        }
        // 0040D260 replays the selected mode, not a journal of former mode choices.
        self.replay_mode = mode;
        self.replay_target = Some(target);
        self.advance_replay();
    }

    fn advance_replay(&mut self) {
        let Some(target) = self.replay_target else {
            return;
        };
        // Keep each IPC request bounded, including rewinding a long-running program.
        for _ in 0..1000 {
            if self.steps >= target {
                self.replay_target = None;
                break;
            }
            if self.machine.status != Status::Ready {
                break;
            }
            self.machine.step_mode(self.replay_mode);
            self.steps += 1;
            self.service_devices();
        }
        if self.steps >= target && self.machine.status != Status::WaitingInput {
            self.replay_target = None;
        }
        if matches!(self.machine.status, Status::Halted | Status::Fault) {
            self.replay_target = None;
        }
    }

    pub fn input(&mut self, text: Option<&str>) -> Result<(), String> {
        self.machine.supply_input(text)?;
        self.advance_replay();
        Ok(())
    }

    /// Applying device settings reloads the CPU and resets both streams lazily.
    pub fn configure_devices(&mut self, config: DeviceConfig) -> Result<(), String> {
        let config = config.absolute()?;
        config.validate()?;
        self.shutdown()?;
        config.validate()?;
        self.devices = FileDevices::new(config);
        self.reset();
        Ok(())
    }

    pub fn shutdown(&mut self) -> Result<(), String> {
        self.devices
            .close()
            .inspect_err(|error| self.fail_io(error.clone()))
    }

    fn fail_io(&mut self, error: String) {
        self.machine.fault(error);
        self.machine.input = None;
        self.machine.pipeline.phase = u32::MAX;
        self.replay_target = None;
    }

    fn service_devices(&mut self) {
        let result = (|| -> Result<(), String> {
            if self.machine.status == Status::WaitingInput
                && self.devices.config().input_path.is_some()
            {
                let record = self.devices.read_record()?;
                self.machine.complete_input(record.as_deref())?;
            }
            if let Some(record) = self.machine.pending_output.take() {
                self.devices.write_record(&record)?;
            }
            Ok(())
        })();
        if let Err(error) = result {
            self.fail_io(error);
        }
        if matches!(self.machine.status, Status::Halted | Status::Fault) {
            if let Err(error) = self.devices.close() {
                self.fail_io(error);
            }
        }
    }
}
