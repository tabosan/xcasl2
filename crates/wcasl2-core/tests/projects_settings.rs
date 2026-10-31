use std::{
    fs,
    path::{Path, PathBuf},
};
use wcasl2_core::{
    assemble_sources,
    project::{Project, ProjectFile},
    settings::{atomic_write, Settings},
    Session, Status, StepMode,
};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}
struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let path = root().join("target/test-data").join(format!(
            "project-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn original_mfc_archives_roundtrip_byte_for_byte() {
    let cases: serde_json::Value = serde_json::from_slice(
        &fs::read(root().join("analysis/results/followup_cmk.json")).unwrap(),
    )
    .unwrap();
    for case in cases.as_array().unwrap() {
        let bytes = fs::read(
            root()
                .join("analysis/results")
                .join(case["file"].as_str().unwrap()),
        )
        .unwrap();
        let project = Project::decode(&bytes).unwrap();
        assert_eq!(project.encode().unwrap(), bytes);
        assert_eq!(project.stored_path, case["fields"]["document_strings"][0]);
        assert_eq!(project.main_path, case["fields"]["document_strings"][1]);
        for (file, expected) in project
            .files
            .iter()
            .zip(case["fields"]["files"].as_array().unwrap())
        {
            assert_eq!(file.path, expected[0]);
            assert_eq!(file.name, expected[1]);
        }
    }
    // Keep the legacy display-name/path mismatch in the codec; UI uses actual paths.
    let bytes = fs::read(root().join("analysis/results/cmk-paths/old/project.cmk")).unwrap();
    let project = Project::decode(&bytes).unwrap();
    assert_eq!(project.encode().unwrap(), bytes);
    assert!(project.files[1].path.ends_with("pathsub.cas"));
    assert_eq!(project.files[1].name, "pathmain.cas");
}

#[test]
fn mfc_string_length_prefix_boundaries_and_cp932() {
    for length in [0, 254, 255, 65533, 65534, 65535] {
        let project = Project {
            stored_path: "x".repeat(length),
            main_path: "副プログラム.cas".into(),
            files: vec![],
        };
        let bytes = project.encode().unwrap();
        let prefix = &bytes[4..];
        match length {
            0..=254 => assert_eq!(prefix[0] as usize, length),
            255..=65533 => assert_eq!(
                &prefix[..3],
                &[255, (length & 255) as u8, (length >> 8) as u8]
            ),
            _ => assert_eq!(
                &prefix[..7],
                &[
                    255,
                    255,
                    255,
                    (length & 255) as u8,
                    (length >> 8) as u8,
                    0,
                    0
                ]
            ),
        }
        assert_eq!(Project::decode(&bytes).unwrap(), project);
    }
    assert!(Project {
        stored_path: "😀".into(),
        ..Project::default()
    }
    .encode()
    .is_err());
}

#[test]
fn malformed_cmk_is_bounded_and_rejected() {
    let project = Project {
        stored_path: "日本語.cmk".into(),
        main_path: "main.cas".into(),
        files: vec![ProjectFile {
            path: "main.cas".into(),
            name: "main.cas".into(),
        }],
    };
    let bytes = project.encode().unwrap();
    for len in 0..bytes.len() {
        assert!(Project::decode(&bytes[..len]).is_err(), "prefix {len}");
    }
    let mut trailing = bytes.clone();
    trailing.push(0);
    assert!(Project::decode(&trailing).is_err());
    for bytes in [
        vec![255, 255, 255, 255],
        vec![21, 0, 0, 0],
        vec![0, 0, 0, 0, 255, 254, 255],
        vec![0, 0, 0, 0, 1, 0x81, 0],
        vec![0, 0, 0, 0, 1, 0, 0],
    ] {
        assert!(Project::decode(&bytes).is_err());
    }
    let too_many = Project {
        files: vec![
            ProjectFile {
                path: "x".into(),
                name: "x".into()
            };
            21
        ],
        ..Project::default()
    };
    assert!(too_many.encode().is_err());
}

#[test]
fn relocated_relative_project_uses_opened_archive_directory() {
    let path = root()
        .canonicalize()
        .unwrap()
        .join("analysis/results/cmk-relocated/relative.cmk");
    let mut project = Project::decode(&fs::read(&path).unwrap()).unwrap();
    project.stored_path = "Z:\\missing\\old.cmk".into();
    let paths = project.resolved_paths(&path).unwrap();
    assert_eq!(paths.len(), 2);
    for path in paths {
        assert_eq!(
            path.parent(),
            Some(
                root()
                    .canonicalize()
                    .unwrap()
                    .join("analysis/results/cmk-relocated")
                    .as_path()
            )
        );
        assert!(fs::read(path).is_ok());
    }
    project.files[0].path.clear();
    assert!(project.resolved_paths(&path).is_err());
}

const MAIN: &str = "MAIN START GO\nSKIP DC 99\nGO CALL SUB\n RET\nLOCAL DC 1\n END\n";
const SUB: &str = "SUB START\n LD GR1,LOCAL\n ADDA GR1,=3\n RET\nLOCAL DC 7\n END\n";
#[test]
fn separate_files_link_public_names_keep_locals_and_entry() {
    let image = assemble_sources(&[(Some("main.cas"), MAIN), (Some("副.cas"), SUB)], 0x40).unwrap();
    assert_eq!(image.entry, 0x41);
    assert_ne!(image.labels["MAIN:LOCAL"], image.labels["SUB:LOCAL"]);
    assert_eq!(image.words[2], Some(image.labels["SUB:SUB"]));
    assert!(image
        .rows
        .iter()
        .any(|row| row.file.as_deref() == Some("副.cas") && row.line == 2));
    let mut session = Session::new(image, 0xffff);
    session.run_batch(100);
    assert_eq!(session.machine.status, Status::Halted);
    assert_eq!(session.machine.cpu.gr[1], 10);
    let reversed =
        assemble_sources(&[(Some("副.cas"), SUB), (Some("main.cas"), MAIN)], 0x40).unwrap();
    assert_eq!(reversed.entry, 0x40);
    let mut session = Session::new(reversed, 0);
    session.run_batch(100);
    assert_eq!(session.machine.cpu.gr[1], 10);
    assert_eq!(session.machine.status, Status::Halted);
}

#[test]
fn files_do_not_supply_each_others_end_and_errors_keep_file_and_line() {
    let errors = assemble_sources(
        &[
            (Some("one.cas"), "MAIN START\n RET\n"),
            (Some("two.cas"), " END\n"),
        ],
        32,
    )
    .unwrap_err();
    assert!(errors
        .iter()
        .any(|e| e.file.as_deref() == Some("one.cas") && e.message.contains("END")));
    let errors = assemble_sources(
        &[
            (Some("main.cas"), "MAIN START\n CALL HIDDEN\n END\n"),
            (Some("sub.cas"), "SUB START\nHIDDEN RET\n END\n"),
        ],
        32,
    )
    .unwrap_err();
    assert!(errors
        .iter()
        .any(|e| e.file.as_deref() == Some("main.cas") && e.line == 2 && e.code == 9));
    let errors = assemble_sources(
        &[
            (Some("main.cas"), MAIN),
            (Some("bad.cas"), "SUB START\n lad GR1,1\n END\n"),
        ],
        32,
    )
    .unwrap_err();
    assert!(errors
        .iter()
        .any(|e| e.file.as_deref() == Some("bad.cas") && e.line == 2));
    assert!(assemble_sources(&[], 32).is_err());
}

#[test]
fn settings_defaults_and_full_roundtrip_replace_existing_file() {
    let temp = Temp::new();
    let path = temp.0.join("nested/settings.json");
    assert_eq!(Settings::load(&path).unwrap(), Settings::default());
    let mut settings = Settings::default();
    settings.save(&path).unwrap();
    settings.base = 64;
    settings.fill = 0;
    settings.interval_ms = 2345;
    settings.step_mode = StepMode::Micro;
    settings.binary_registers = true;
    settings.signed_decimal = false;
    settings.theme = wcasl2_core::settings::ThemePreference::Light;
    settings.editor_font_family = "Consolas, 'Courier New', monospace".into();
    settings.editor_font_size = 20;
    settings.auto_switch_step_mode = false;
    settings.auto_comment_overwrite = true;
    settings.auto_save = true;
    settings.recent_files = vec![temp.0.join("日本語.cas").to_string_lossy().into()];
    settings.comet_view = true;
    settings.memory_start = 100;
    settings.devices.input_path = Some(temp.0.join("入力.txt"));
    settings.devices.output_path = Some(temp.0.join("出力.txt"));
    settings.save(&path).unwrap();
    assert_eq!(Settings::load(&path).unwrap(), settings);
    assert!(!temp.0.join("出力.txt").exists());
    assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 1);
    assert_eq!(
        serde_json::from_str::<Settings>("{}").unwrap(),
        Settings::default()
    );
    // Older decimal-only preferences adopt hex/decimal columns and signed display.
    let old: Settings = serde_json::from_str(r#"{"version":1,"decimal":true}"#).unwrap();
    assert!(!old.binary_registers && old.signed_decimal);
    assert!(!old.auto_save && old.recent_files.is_empty());
    assert_eq!(old.theme, wcasl2_core::settings::ThemePreference::Dark);
    assert_eq!(
        old.editor_font_family,
        Settings::default().editor_font_family
    );
    assert_eq!(old.editor_font_size, 14);
    assert!(old.auto_switch_step_mode);
    assert!(!old.auto_comment_overwrite);
    for theme in [
        wcasl2_core::settings::ThemePreference::Light,
        wcasl2_core::settings::ThemePreference::Dark,
        wcasl2_core::settings::ThemePreference::System,
    ] {
        settings.theme = theme;
        settings.save(&path).unwrap();
        assert_eq!(Settings::load(&path).unwrap().theme, theme);
    }
    assert!(serde_json::from_str::<Settings>(r#"{"theme":"unknown"}"#).is_err());
}

#[test]
fn settings_invalid_input_preserves_original_and_backs_up_on_change() {
    let temp = Temp::new();
    let path = temp.0.join("settings.json");
    fs::write(&path, b"broken").unwrap();
    assert!(Settings::load(&path).is_err());
    assert_eq!(fs::read(&path).unwrap(), b"broken");
    Settings::default().save(&path).unwrap();
    assert_eq!(Settings::load(&path).unwrap(), Settings::default());
    let backup = fs::read_dir(&temp.0)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|p| {
            p.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("settings-invalid-")
        })
        .unwrap();
    assert_eq!(fs::read(backup).unwrap(), b"broken");
    let good = fs::read(&path).unwrap();
    for patch in [
        r#"{"version":2}"#,
        r#"{"base":3000}"#,
        r#"{"fill":1}"#,
        r#"{"interval_ms":60001}"#,
        r#"{"memory_start":3000}"#,
        r#"{"editor_font_size":7}"#,
        r#"{"editor_font_size":73}"#,
        r#"{"editor_font_family":"   "}"#,
        r#"{"editor_font_family":"Consolas\nmonospace"}"#,
    ] {
        let invalid: Settings = serde_json::from_str(patch).unwrap();
        assert!(invalid.save(&path).is_err());
        assert_eq!(fs::read(&path).unwrap(), good);
    }
}

#[test]
fn atomic_write_failure_leaves_no_partial_or_temporary_file() {
    let temp = Temp::new();
    let directory_target = temp.0.join("exists");
    fs::create_dir(&directory_target).unwrap();
    assert!(atomic_write(&directory_target, b"data").is_err());
    assert!(directory_target.is_dir());
    assert_eq!(fs::read_dir(&temp.0).unwrap().count(), 1);
}
