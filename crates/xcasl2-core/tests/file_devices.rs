use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
use xcasl2_core::devices::FileDevices;
use xcasl2_core::{assemble, DeviceConfig, Machine, Session, Status, StepMode};

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "xcasl2-io-{}-{stamp}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn path(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}
fn json(name: &str) -> Value {
    serde_json::from_slice(&fs::read(root().join("analysis/results").join(name)).unwrap()).unwrap()
}
fn unhex(text: &str) -> Vec<u8> {
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
        .collect()
}
fn source(name: &str) -> String {
    fs::read_to_string(root().join("analysis/fixtures").join(name)).unwrap()
}
fn session(source: &str, input: Option<PathBuf>, output: Option<PathBuf>) -> Session {
    let mut session = Session::new(assemble(source, 32).unwrap(), 0xffff);
    session
        .configure_devices(DeviceConfig {
            input_path: input,
            output_path: output,
        })
        .unwrap();
    session
}
fn cell(session: &Session, name: &str) -> u16 {
    session.snapshot().labels[&format!("MAIN:{name}")]
}

#[test]
fn original_nine_file_input_endpoints() {
    for case in json("followup_file_input.json").as_array().unwrap() {
        let mut machine = Machine::new(0xcccc, 32, 512);
        machine.cpu.gr[1] = 0x100;
        machine.cpu.gr[2] = 0x90;
        machine.cpu.fr = 7;
        machine.execute_decoded(0xf0, 0, 0, 1);
        let endpoint = case["endpoint_hex"].as_str().map(unhex);
        machine.supply_file_input(endpoint.as_deref()).unwrap();
        assert_eq!(
            machine.read(0x90) as u64,
            case["length"].as_u64().unwrap(),
            "{}",
            case["id"]
        );
        for (i, word) in case["buffer"].as_array().unwrap().iter().enumerate() {
            assert_eq!(
                machine.read(0x100 + i as u16) as u64,
                word.as_u64().unwrap(),
                "{} buffer {i}",
                case["id"]
            );
        }
        assert_eq!(machine.cpu.fr, 7);
        assert_eq!((machine.cpu.gr[1], machine.cpu.gr[2]), (0x100, 0x90));
    }
}

#[test]
fn original_five_native_file_input_cases() {
    let temp = Temp::new();
    for case in json("native_20261027.json")["input_cases"]
        .as_array()
        .unwrap()
    {
        let input = temp.path("input.dat");
        let bytes = if let Some(hex) = case["input_hex"].as_str() {
            unhex(hex)
        } else {
            fs::read(
                root()
                    .join("analysis/results")
                    .join(case["input_file"].as_str().unwrap()),
            )
            .unwrap()
        };
        fs::write(&input, bytes).unwrap();
        let mut session = session(&source("ui_native_io.cas"), Some(input), None);
        session.run_batch(3);
        assert_eq!(session.machine.cpu.pr as u64, case["pr"].as_u64().unwrap());
        let buffer = case["buffer_address"].as_u64().unwrap() as u16;
        for (i, word) in case["buffer"].as_array().unwrap().iter().enumerate() {
            assert_eq!(
                session.machine.read(buffer + i as u16) as u64,
                word.as_u64().unwrap(),
                "{}",
                case["id"]
            );
        }
        assert_eq!(
            session
                .machine
                .read(case["length_address"].as_u64().unwrap() as u16) as u64,
            case["length"].as_u64().unwrap()
        );
        assert_eq!(session.machine.status, Status::Ready);
        session.shutdown().unwrap();
    }
}

fn check_disk(path: &Path, observation: &Value) {
    if let Some(hex) = observation["hex"].as_str() {
        assert_eq!(fs::read(path).unwrap(), unhex(hex), "{}", observation["id"]);
    } else {
        assert_eq!(
            fs::metadata(path).unwrap().len(),
            observation["filesystem_size"].as_u64().unwrap_or(0),
            "{}",
            observation["id"]
        );
        #[cfg(windows)]
        {
            let error = fs::read(path).unwrap_err();
            // Rust classifies sharing violations differently from Python's PermissionError.
            assert!(
                matches!(error.raw_os_error(), Some(5 | 32 | 33)),
                "{}: {error:?}",
                observation["id"]
            );
        }
    }
}

#[test]
fn original_eleven_native_disk_checkpoints_including_replay() {
    let temp = Temp::new();
    let input = temp.path("input.txt");
    let output = temp.path("output.txt");
    let data = json("native_io_20261027.json");
    fs::write(&input, unhex(data["input_hex"].as_str().unwrap())).unwrap();
    fs::write(&output, unhex(data["initial_output_hex"].as_str().unwrap())).unwrap();
    let observations = data["observations"].as_array().unwrap();
    let mut session = session(
        &source("ui_native_io.cas"),
        Some(input),
        Some(output.clone()),
    );
    session.run_batch(3);
    check_disk(&output, &observations[0]);
    session.step();
    check_disk(&output, &observations[1]);
    session.step();
    check_disk(&output, &observations[2]);
    session.step();
    check_disk(&output, &observations[3]);
    session.step();
    check_disk(&output, &observations[4]);
    assert_eq!(session.machine.status, Status::Halted);
    session.back();
    check_disk(&output, &observations[5]);
    session.back();
    check_disk(&output, &observations[6]);
    assert_eq!(session.snapshot().devices.records_written, 1);
    session.back();
    session.back();
    check_disk(&output, &observations[7]);
    assert!(!session.snapshot().devices.output_open);
    session.shutdown().unwrap();
    let mut nul = session_for_nul(&output);
    nul.run_batch(2);
    check_disk(&output, &observations[8]);
    nul.step();
    check_disk(&output, &observations[9]);
    nul.step();
    check_disk(&output, &observations[10]);
}
fn session_for_nul(output: &Path) -> Session {
    session(
        &source("ui_native_out_nul.cas"),
        None,
        Some(output.to_owned()),
    )
}

#[test]
fn empty_out_does_not_open_but_a_leading_nul_does_truncate() {
    let temp = Temp::new();
    let output = temp.path("keep.txt");
    fs::write(&output, b"KEEP").unwrap();
    let source = "MAIN START\n OUT BUF,LEN\n RET\nBUF DC #0000\nLEN DC 0\n END\n";
    let mut zero = session(source, None, Some(output.clone()));
    zero.run_batch(100);
    assert_eq!(fs::read(&output).unwrap(), b"KEEP");
    assert!(!zero.snapshot().devices.output_started);
    let mut nul = session(
        &source.replace("LEN DC 0", "LEN DC 1"),
        None,
        Some(output.clone()),
    );
    nul.run_batch(100);
    assert_eq!(fs::read(&output).unwrap(), b"");
    assert_eq!(nul.snapshot().devices.records_written, 1);
}

#[test]
fn file_output_preserves_high_bytes_and_expands_every_lf() {
    let temp = Temp::new();
    let output = temp.path("raw.dat");
    let mut session = session("MAIN START\n OUT BUF,LEN\n RET\nBUF DC #0141,#00E0,#00FF,#000A,#000D,#000A\nLEN DC 6\n END\n", None, Some(output.clone()));
    session.run_batch(100);
    assert_eq!(
        fs::read(output).unwrap(),
        [b'A', 0xe0, 0xff, b'\r', b'\n', b'\r', b'\r', b'\n', b'\r', b'\n']
    );
    assert_eq!(session.machine.output(), [""]);
}

#[test]
fn streaming_input_trims_before_cut_and_has_distinct_empty_and_eof() {
    let temp = Temp::new();
    let input = temp.path("lines.txt");
    let mut bytes = b"\r\nA \t\r\n".to_vec();
    bytes.extend(vec![b'A'; 255]);
    bytes.extend_from_slice(b" Z\r\nLAST");
    fs::write(&input, bytes).unwrap();
    let mut device = FileDevices::new(DeviceConfig {
        input_path: Some(input),
        output_path: None,
    });
    assert_eq!(device.read_record().unwrap(), Some(vec![]));
    assert_eq!(device.read_record().unwrap(), Some(b"A".to_vec()));
    let mut long = vec![b'A'; 255];
    long.push(b' ');
    assert_eq!(device.read_record().unwrap(), Some(long));
    assert_eq!(device.read_record().unwrap(), Some(b"LAST".to_vec()));
    assert_eq!(device.read_record().unwrap(), None);
    assert_eq!(device.read_record().unwrap(), None);
    assert!(device.snapshot().input_eof);
    device.close().unwrap();
}

#[test]
fn japanese_256_byte_file_input_and_output_work_in_all_step_modes() {
    for mode in [StepMode::Instruction, StepMode::Phase, StepMode::Micro] {
        let temp = Temp::new();
        let input = temp.path("入力.txt");
        let output = temp.path("出力.txt");
        let bytes = xcasl2_core::encode_cp932(&"あ".repeat(128)).unwrap();
        let mut file = bytes.clone();
        file.extend_from_slice(b"  \r\n");
        fs::write(&input, file).unwrap();
        let mut session = session(
            "MAIN START\n IN BUF,LEN\n OUT BUF,LEN\n RET\nBUF DS 256\nLEN DS 1\n END\n",
            Some(input),
            Some(output.clone()),
        );
        session.step_mode = mode;
        session.run_batch(1000);
        assert_eq!(
            session.machine.status,
            Status::Halted,
            "{mode:?}: {:?}",
            session.machine.error
        );
        assert_eq!(session.machine.read(cell(&session, "LEN")), 256);
        let mut expected = bytes;
        expected.extend_from_slice(b"\r\n");
        assert_eq!(fs::read(output).unwrap(), expected);
        assert_eq!(session.snapshot().devices.records_read, 1);
        assert_eq!(session.snapshot().devices.records_written, 1);
    }
}

#[test]
fn missing_paths_stop_safely_without_keyboard_fallback() {
    let temp = Temp::new();
    let mut input = session(
        "MAIN START\n IN BUF,LEN\n RET\nBUF DS 256\nLEN DS 1\n END\n",
        Some(temp.path("missing.txt")),
        None,
    );
    input.run_batch(100);
    assert_eq!(input.machine.status, Status::Fault);
    assert!(input.machine.input.is_none());
    assert!(input
        .machine
        .error
        .as_deref()
        .unwrap()
        .contains("入力ファイルを開けません"));
    let mut output = session(
        "MAIN START\n OUT BUF,LEN\n RET\nBUF DC 'A'\nLEN DC 1\n END\n",
        None,
        Some(temp.path("missing/output.txt")),
    );
    output.run_batch(100);
    assert_eq!(output.machine.status, Status::Fault);
    assert!(output
        .machine
        .error
        .as_deref()
        .unwrap()
        .contains("出力ファイルを開けません"));
}

#[test]
fn same_file_and_hard_link_input_output_are_rejected_before_truncation() {
    let temp = Temp::new();
    let input = temp.path("input.txt");
    let alias = temp.path("alias.txt");
    fs::write(&input, b"KEEP").unwrap();
    fs::hard_link(&input, &alias).unwrap();
    let mut session = Session::new(assemble("MAIN START\n RET\n END\n", 32).unwrap(), 0xffff);
    for output in [input.clone(), alias] {
        assert!(session
            .configure_devices(DeviceConfig {
                input_path: Some(input.clone()),
                output_path: Some(output)
            })
            .is_err());
        assert_eq!(fs::read(&input).unwrap(), b"KEEP");
    }
}

#[test]
fn explicit_close_and_abnormal_exit_flush_short_output() {
    let temp = Temp::new();
    let output = temp.path("close.txt");
    let source = "MAIN START\n LAD GR1,BUF\n LAD GR2,LEN\n SVC 2\nBAD DC #FF00\nBUF DC 'AB'\nLEN DC 2\n END\n";
    let mut run = session(source, None, Some(output.clone()));
    run.run_batch(3);
    assert_eq!(fs::metadata(&output).unwrap().len(), 0);
    run.shutdown().unwrap();
    assert_eq!(fs::read(&output).unwrap(), b"AB\r\n");
    run.reset();
    run.run_batch(100);
    assert_eq!(run.machine.status, Status::Fault);
    assert_eq!(fs::read(&output).unwrap(), b"AB\r\n");
}
