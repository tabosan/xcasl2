use serde_json::Value;
use wcasl2_core::{assemble, Machine, Session, Status, StepMode};

fn fixture(name: &str) -> Vec<Value> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../analysis/results")
        .join(name);
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}

fn check(machine: &Machine, expected: &Value, context: &str) {
    let actual = serde_json::to_value(&machine.cpu).unwrap();
    for key in [
        "gr",
        "pr",
        "sp",
        "fr",
        "ir",
        "mar",
        "mdr",
        "effective",
        "decoder",
        "depth",
    ] {
        assert_eq!(actual[key], expected[key], "{context}: {key}");
    }
    assert_eq!(
        machine.pipeline.phase as u64,
        expected["phase"].as_u64().unwrap(),
        "{context}: phase"
    );
    assert_eq!(
        machine.pipeline.micro as u64,
        expected["micro"].as_u64().unwrap(),
        "{context}: micro"
    );
    if let Some(memory) = expected["memory"].as_object() {
        for (address, word) in memory {
            assert_eq!(
                machine.read(address.parse().unwrap()) as u64,
                word.as_u64().unwrap(),
                "{context}: memory #{address}"
            );
        }
    }
    if let Some(rows) = expected["display"].as_array() {
        let output = machine.output();
        for (index, row) in rows.iter().enumerate() {
            let hex = row.as_str().unwrap();
            let bytes: Vec<u8> = (0..hex.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
                .collect();
            assert_eq!(
                output.get(index).map_or("", String::as_str),
                wcasl2_core::decode_cp932(&bytes),
                "{context}: display row {index}"
            );
        }
    }
}

#[test]
fn original_11_micro_traces() {
    for case in fixture("pipeline_cases.json") {
        let trace = case["trace"].as_array().unwrap();
        let mut machine = Machine::new(0, 0x20, 0x200);
        for (index, value) in trace[0]["gr"].as_array().unwrap().iter().enumerate() {
            machine.cpu.gr[index] = value.as_u64().unwrap() as u16;
        }
        for (offset, word) in case["words"].as_array().unwrap().iter().enumerate() {
            machine.write(32 + offset as u16, word.as_u64().unwrap() as u16);
        }
        for (index, state) in trace.iter().enumerate() {
            if index != 0 {
                machine.step_mode(StepMode::Micro);
            }
            check(
                &machine,
                state,
                &format!("{} transition {index}", case["id"]),
            );
        }
    }
}

#[test]
fn original_294_micro_phase_instruction_traces() {
    let cases = fixture("pipeline_port_cases.json");
    assert_eq!(cases.len(), 294);
    let mut transitions = 0;
    for case in cases {
        let setup = &case["setup"];
        let entry = setup["entry"].as_u64().unwrap_or(32) as u16;
        let mut machine = Machine::new(0, entry, setup["sp"].as_u64().unwrap_or(512) as u16);
        machine.cpu.fr = setup["fr"].as_u64().unwrap_or(0) as u16;
        machine.cpu.depth = setup["depth"].as_u64().unwrap_or(0) as u32;
        if let Some(registers) = setup["gr"].as_object() {
            for (index, value) in registers {
                machine.cpu.gr[index.parse::<usize>().unwrap()] = value.as_u64().unwrap() as u16;
            }
        }
        for (address, word) in setup["memory"].as_object().unwrap() {
            machine.write(address.parse().unwrap(), word.as_u64().unwrap() as u16);
        }
        for (offset, word) in setup["words"].as_array().unwrap().iter().enumerate() {
            machine.write(
                entry.wrapping_add(offset as u16),
                word.as_u64().unwrap() as u16,
            );
        }
        let mode: StepMode = serde_json::from_value(case["mode"].clone()).unwrap();
        for (index, state) in case["trace"].as_array().unwrap().iter().enumerate() {
            if index != 0 {
                machine.step_mode(mode);
                if machine.status == Status::WaitingInput {
                    machine.supply_input(setup["input"].as_str()).unwrap();
                }
                transitions += 1;
            }
            check(
                &machine,
                state,
                &format!("{} {:?} transition {index}", case["id"], mode),
            );
        }
    }
    assert_eq!(transitions, 1790);
}

#[test]
fn original_36_nop_traces_include_unused_register_nibbles() {
    let cases = fixture("k61-compatibility/nop_padding_cases.json");
    assert_eq!(cases.len(), 36);
    for case in cases {
        let mut machine = Machine::new(0xffff, 0x20, 0x200);
        machine.cpu.ir[1] = 0x1234;
        machine.write(0x20, case["word"].as_u64().unwrap() as u16);
        let mode: StepMode = serde_json::from_value(case["mode"].clone()).unwrap();
        for (index, state) in case["trace"].as_array().unwrap().iter().enumerate() {
            if index != 0 {
                machine.step_mode(mode);
            }
            check(
                &machine,
                state,
                &format!("NOP {} {mode:?} transition {index}", case["word"]),
            );
        }
        assert_eq!(machine.status, Status::Ready);
        assert_eq!(machine.pipeline.instructions, 1);
    }
}

#[test]
fn all_256_nop_encodings_are_harmless_in_all_step_modes() {
    for mode in [StepMode::Instruction, StepMode::Phase, StepMode::Micro] {
        for word in 0..=255 {
            let mut machine = Machine::new(0xffff, 0x20, 0x200);
            machine.cpu.fr = 5;
            machine.cpu.ir[1] = 0x1234;
            machine.write(0x20, word);
            let memory = machine.memory.clone();
            for _ in 0..40 {
                machine.step_mode(mode);
                if machine.at_instruction_boundary() || machine.status != Status::Ready {
                    break;
                }
            }
            assert_eq!(machine.status, Status::Ready, "#{word:04X} {mode:?}");
            assert_eq!(machine.cpu.gr, [0xffff; 8]);
            assert_eq!(machine.cpu.fr, 5);
            assert_eq!(machine.cpu.sp, 0x200);
            assert_eq!(machine.cpu.pr, 0x21);
            assert_eq!(machine.memory, memory);
            assert_eq!(machine.pipeline.instructions, 1);
        }
    }
    let mut machine = Machine::new(0xffff, 0x20, 0x200);
    machine.execute_decoded(0, 15, 15, 0);
    assert_eq!(machine.status, Status::Ready);
    assert_eq!(machine.cpu.gr, [0xffff; 8]);
}

#[test]
fn invalid_registers_for_real_operations_still_stop_safely() {
    for mode in [StepMode::Instruction, StepMode::Phase, StepMode::Micro] {
        for word in [0x10f0, 0x101a, 0x14fa] {
            let mut machine = Machine::new(0xffff, 0x20, 0x200);
            machine.write(0x20, word);
            machine.write(0x21, 0x100);
            for _ in 0..40 {
                machine.step_mode(mode);
                if machine.status != Status::Ready {
                    break;
                }
            }
            assert_eq!(machine.status, Status::Fault, "#{word:04X} {mode:?}");
            assert_eq!(machine.cpu.gr, [0xffff; 8]);
        }
    }
}

#[test]
fn calling_a_section_with_leading_dc_ten_passes_the_nop() {
    let source =
        "MAIN START\n CALL SUB\n RET\n END\nSUB START GO\nVALUE DC 10\nGO LAD GR1,7\n RET\n END\n";
    for mode in [StepMode::Instruction, StepMode::Phase, StepMode::Micro] {
        let image = assemble(source, 32).unwrap();
        // Preserve the original linker: CALL uses the START name's allocated address.
        assert_eq!(image.words[1], Some(0x23));
        assert_eq!(image.words[3], Some(10));
        let mut session = Session::new(image, 0xffff);
        session.step_mode = mode;
        session.run_batch(1000);
        assert_eq!(session.machine.status, Status::Halted, "{mode:?}");
        assert_eq!(session.machine.cpu.gr[1], 7);
        assert_eq!(session.machine.pipeline.instructions, 5);
        session.back();
        assert_eq!(session.machine.status, Status::Ready);
    }
}

#[test]
fn original_k61_linked_image_completes_in_all_step_modes() {
    let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../analysis/results/k61-compatibility");
    let build: Value =
        serde_json::from_slice(&std::fs::read(directory.join("original_build.json")).unwrap())
            .unwrap();
    let execution: Value =
        serde_json::from_slice(&std::fs::read(directory.join("original_execution.json")).unwrap())
            .unwrap();
    for mode in [StepMode::Instruction, StepMode::Phase, StepMode::Micro] {
        let mut machine = Machine::new(
            0xffff,
            build["entry"].as_u64().unwrap() as u16,
            build["end"].as_u64().unwrap() as u16 + 1,
        );
        machine.memory = serde_json::from_value(build["memory"].clone()).unwrap();
        for _ in 0..100_000 {
            machine.step_mode(mode);
            if machine.status != Status::Ready {
                break;
            }
        }
        assert_eq!(
            machine.status,
            Status::Halted,
            "{mode:?}: {:?}",
            machine.error
        );
        assert_eq!(
            machine.pipeline.instructions,
            execution["instructions"].as_u64().unwrap()
        );
        check(&machine, &execution["final"], &format!("K61 {mode:?}"));
        assert_eq!(
            serde_json::to_value(&machine.memory).unwrap(),
            execution["memory"]
        );
        for (index, expected) in execution["display"].as_array().unwrap().iter().enumerate() {
            assert_eq!(
                machine.output().get(index).map_or("", String::as_str),
                expected.as_str().unwrap()
            );
        }
    }
}

#[test]
fn micro_rewind_restores_an_unfinished_fetch() {
    let mut session = Session::new(
        assemble("MAIN START\n LAD GR1,7\n RET\n END\n", 32).unwrap(),
        0xffff,
    );
    session.step_mode = StepMode::Micro;
    session.run_batch(3);
    assert_eq!(session.machine.cpu.pr, 33);
    assert_eq!(session.machine.cpu.mdr, 0x1210);
    session.back();
    assert_eq!(session.steps, 2);
    assert_eq!(session.machine.pipeline.micro, 2);
    assert_eq!(session.machine.pipeline.cycles, 2);
    assert_eq!(session.machine.cpu.pr, 32);
    assert_eq!(session.machine.cpu.mar, 32);
    assert_eq!(session.machine.cpu.mdr, 0xffff);
}

#[test]
fn rewind_replays_the_current_mode_like_the_original_counter() {
    let mut session = Session::new(
        assemble("MAIN START\n LAD GR1,7\n LAD GR2,8\n RET\n END\n", 32).unwrap(),
        0xffff,
    );
    session.run_batch(2);
    assert_eq!(session.machine.pipeline.instructions, 2);
    session.step_mode = StepMode::Micro;
    session.back();
    assert_eq!(session.steps, 1);
    assert_eq!(session.machine.pipeline.instructions, 0);
    assert_eq!(session.machine.pipeline.micro, 1);
    assert_eq!(session.machine.cpu.gr, [0xffff; 8]);
}

#[test]
fn fetched_operand_is_latched_and_store_waits_for_its_write_cycle() {
    let mut machine = Machine::new(0, 32, 512);
    machine.write(32, 0x1010);
    machine.write(33, 0x100);
    machine.write(0x100, 1);
    for _ in 0..3 {
        machine.step_mode(StepMode::Phase);
    }
    for _ in 0..3 {
        machine.step_mode(StepMode::Micro);
    }
    assert_eq!(machine.cpu.mdr, 1);
    machine.write(0x100, 2);
    machine.step_mode(StepMode::Micro);
    assert_eq!(machine.cpu.gr[1], 1);
    machine.write(34, 0x1110);
    machine.write(35, 0x100);
    for _ in 0..3 {
        machine.step_mode(StepMode::Phase);
    }
    machine.step_mode(StepMode::Micro);
    assert_eq!(machine.cpu.mdr, 1);
    assert_eq!(machine.read(0x100), 2);
    machine.cpu.gr[1] = 99;
    machine.step_mode(StepMode::Micro);
    assert_eq!(machine.read(0x100), 2);
    machine.step_mode(StepMode::Micro);
    assert_eq!(machine.read(0x100), 1);
}

#[test]
fn micro_input_and_replay_pause_without_an_extra_svc_cycle() {
    let mut session = Session::new(
        assemble(
            "MAIN START\n IN BUF,LEN\n OUT BUF,LEN\n RET\nBUF DS 128\nLEN DS 1\n END\n",
            32,
        )
        .unwrap(),
        0xffff,
    );
    session.step_mode = StepMode::Micro;
    session.run_batch(1000);
    assert_eq!(session.machine.status, Status::WaitingInput);
    assert_eq!(session.machine.pipeline.instructions, 5);
    let cycles = session.machine.pipeline.cycles;
    session.input(Some("AA")).unwrap();
    assert_eq!(session.machine.pipeline.cycles, cycles);
    session.run_batch(1000);
    assert_eq!(session.machine.status, Status::Halted);
    session.back();
    assert_eq!(session.machine.status, Status::WaitingInput);
    session.input(Some("BBB")).unwrap();
    assert_eq!(session.machine.output(), ["BBB"]);
    assert_eq!(session.machine.status, Status::Ready);
    session.step();
    assert_eq!(session.machine.status, Status::Halted);
}
