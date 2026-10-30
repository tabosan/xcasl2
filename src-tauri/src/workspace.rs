use serde::Deserialize;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};
use wcasl2_core::{
    assemble_sources, devices::same_path, settings::Settings, DeviceConfig, Diagnostic, Session,
    Snapshot, StepMode,
};

#[derive(Deserialize)]
pub struct BuildSource {
    pub file: String,
    pub path: Option<PathBuf>,
    pub source: String,
}

pub struct Simulation {
    pub session: Session,
    pub source_paths: Vec<PathBuf>,
}

#[derive(Default)]
pub struct Workspace {
    pub simulations: BTreeMap<String, Simulation>,
    pub devices: DeviceConfig,
    pub source_paths: Vec<PathBuf>,
    pub project_paths: Vec<PathBuf>,
    pub settings: Settings,
    pub settings_path: PathBuf,
    pub settings_warning: Option<String>,
}

fn diagnostic(message: String) -> Vec<Diagnostic> {
    vec![Diagnostic {
        file: None,
        line: 0,
        code: 0,
        message,
    }]
}

impl Workspace {
    pub fn close_simulation(&mut self, id: &str) -> Result<(), String> {
        if let Some(simulation) = self.simulations.get_mut(id) {
            simulation.session.shutdown()?;
        }
        self.simulations.remove(id);
        Ok(())
    }

    pub fn shutdown(&mut self) -> Result<(), String> {
        let mut errors = Vec::new();
        for (id, simulation) in &mut self.simulations {
            if let Err(error) = simulation.session.shutdown() {
                errors.push(format!("{id}: {error}"));
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("\n"))
        }
    }

    pub fn validate_devices(
        &self,
        config: &DeviceConfig,
        owner: Option<&str>,
    ) -> Result<(), String> {
        config.validate()?;
        if let Some(output) = &config.output_path {
            let protected = self
                .source_paths
                .iter()
                .chain(&self.project_paths)
                .chain(std::iter::once(&self.settings_path))
                .chain(
                    self.simulations
                        .values()
                        .flat_map(|sim| sim.source_paths.iter()),
                );
            if protected.into_iter().any(|path| same_path(output, path)) {
                return Err("編集中のソース・cmk・設定ファイルを出力先には指定できません。".into());
            }
        }
        for (id, other) in &self.simulations {
            if Some(id.as_str()) == owner {
                continue;
            }
            let other = other.session.device_config();
            let conflict = config.output_path.as_ref().is_some_and(|output| {
                [&other.input_path, &other.output_path]
                    .into_iter()
                    .flatten()
                    .any(|path| same_path(output, path))
            }) || other.output_path.as_ref().is_some_and(|output| {
                config
                    .input_path
                    .as_ref()
                    .is_some_and(|input| same_path(input, output))
            });
            if conflict {
                return Err("このファイルは別のシミュレーターの入出力先です。そのタブを閉じるか、別のパスを指定してください。".into());
            }
        }
        Ok(())
    }

    pub fn validate_open_paths(&self, paths: &[PathBuf]) -> Result<(), String> {
        for output in self
            .simulations
            .values()
            .filter_map(|sim| sim.session.device_config().output_path.as_ref())
            .chain(self.devices.output_path.iter())
        {
            if paths.iter().any(|path| same_path(path, output)) {
                return Err(
                    "出力装置のファイルをCASLソースまたはcmkとして開くことはできません。".into(),
                );
            }
        }
        Ok(())
    }

    pub fn sync_paths(
        &mut self,
        sources: Vec<PathBuf>,
        projects: Vec<PathBuf>,
    ) -> Result<(), String> {
        self.validate_open_paths(&sources)?;
        self.validate_open_paths(&projects)?;
        self.source_paths = sources;
        self.project_paths = projects;
        Ok(())
    }

    pub fn build(
        &mut self,
        id: String,
        sources: Vec<BuildSource>,
        base: u16,
        fill: u16,
        mode: StepMode,
    ) -> Result<Snapshot, Vec<Diagnostic>> {
        if id.is_empty() || id.len() > 128 {
            return Err(diagnostic("シミュレーターIDが不正です。".into()));
        }
        let config = self.simulations.get(&id).map_or_else(
            || self.devices.clone(),
            |sim| sim.session.device_config().clone(),
        );
        // A failed rebuild invalidates only this source's previous executable.
        self.close_simulation(&id).map_err(diagnostic)?;
        if sources.is_empty() || sources.len() > 20 {
            return Err(diagnostic(
                "ビルド対象は1〜20ファイルで指定してください。".into(),
            ));
        }
        self.validate_devices(&config, Some(&id))
            .map_err(diagnostic)?;
        let paths: Vec<PathBuf> = sources
            .iter()
            .filter_map(|source| source.path.clone())
            .collect();
        if config
            .output_path
            .as_ref()
            .is_some_and(|output| paths.iter().any(|path| same_path(output, path)))
        {
            return Err(diagnostic("CASLソースを出力先には指定できません。".into()));
        }
        let references: Vec<_> = sources
            .iter()
            .map(|source| (Some(source.file.as_str()), source.source.as_str()))
            .collect();
        let mut session = Session::new(assemble_sources(&references, base)?, fill);
        session.configure_devices(config).map_err(diagnostic)?;
        session.step_mode = mode;
        let snapshot = session.snapshot();
        self.simulations.insert(
            id,
            Simulation {
                session,
                source_paths: paths,
            },
        );
        Ok(snapshot)
    }

    pub fn control(
        &mut self,
        id: &str,
        action: &str,
        count: Option<u32>,
        text: Option<&str>,
        mode: Option<StepMode>,
    ) -> Result<Snapshot, String> {
        let sim = self
            .simulations
            .get_mut(id)
            .ok_or("このファイルを先にアセンブルしてください。")?;
        match action {
            "step" => sim.session.step(),
            "run" => sim.session.run_batch(count.unwrap_or(100)),
            "reset" => sim.session.reset(),
            "back" => sim.session.back(),
            "input" => sim.session.input(text)?,
            "mode" => sim.session.step_mode = mode.ok_or("STEP粒度を指定してください。")?,
            _ => return Err("不明な操作です。".into()),
        }
        Ok(sim.session.snapshot())
    }

    pub fn device_config(&self, id: Option<&str>) -> DeviceConfig {
        id.and_then(|id| self.simulations.get(id)).map_or_else(
            || self.devices.clone(),
            |sim| sim.session.device_config().clone(),
        )
    }

    pub fn apply_devices(
        &mut self,
        id: Option<&str>,
        config: DeviceConfig,
    ) -> Result<Option<Snapshot>, String> {
        self.validate_devices(&config, id)?;
        let mut settings = self.settings.clone();
        settings.devices = config.clone();
        settings.save(&self.settings_path)?;
        if let Some(sim) = id.and_then(|id| self.simulations.get_mut(id)) {
            if let Err(error) = sim.session.configure_devices(config.clone()) {
                if let Err(rollback) = self.settings.save(&self.settings_path) {
                    return Err(format!("{error} 設定の復元にも失敗しました: {rollback}"));
                }
                return Err(error);
            }
        }
        self.settings = settings;
        self.devices = config;
        Ok(id
            .and_then(|id| self.simulations.get(id))
            .map(|sim| sim.session.snapshot()))
    }

    pub fn validate_save(&self, path: &Path, previous: Option<&Path>) -> Result<(), String> {
        for other in &self.source_paths {
            if !previous.is_some_and(|previous| same_path(other, previous))
                && same_path(other, path)
            {
                return Err("別の編集中ソースへ上書きすることはできません。".into());
            }
        }
        for protected in self
            .project_paths
            .iter()
            .chain(std::iter::once(&self.settings_path))
            .chain(self.simulations.values().flat_map(|sim| {
                [
                    sim.session.device_config().input_path.as_ref(),
                    sim.session.device_config().output_path.as_ref(),
                ]
                .into_iter()
                .flatten()
            }))
            .chain(
                [
                    self.devices.input_path.as_ref(),
                    self.devices.output_path.as_ref(),
                ]
                .into_iter()
                .flatten(),
            )
        {
            if same_path(protected, path) {
                return Err(
                    "cmk・設定・入出力装置のファイルへソースを保存することはできません。".into(),
                );
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sources(value: u16) -> Vec<BuildSource> {
        vec![BuildSource {
            file: "main.cas".into(),
            path: None,
            source: format!("MAIN START\n LAD GR1,{value}\n RET\n END\n"),
        }]
    }
    fn temporary() -> PathBuf {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../target/test-data")
            .join(format!(
                "tabs-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
        std::fs::create_dir_all(&root).unwrap();
        root
    }
    #[test]
    fn cpu_rebuild_failure_reset_and_close_are_isolated() {
        let mut workspace = Workspace::default();
        workspace
            .build("a".into(), sources(7), 32, 65535, StepMode::Instruction)
            .unwrap();
        workspace
            .build("b".into(), sources(42), 32, 65535, StepMode::Instruction)
            .unwrap();
        workspace.control("a", "step", None, None, None).unwrap();
        assert_eq!(workspace.simulations["a"].session.machine.cpu.gr[1], 7);
        assert_eq!(workspace.simulations["b"].session.steps, 0);
        workspace
            .control("b", "run", Some(100), None, None)
            .unwrap();
        assert_eq!(workspace.simulations["b"].session.machine.cpu.gr[1], 42);
        assert_eq!(workspace.simulations["a"].session.steps, 1);
        let mut broken = sources(1);
        broken[0].source = "bad".into();
        assert!(workspace
            .build("a".into(), broken, 32, 65535, StepMode::Instruction)
            .is_err());
        assert!(!workspace.simulations.contains_key("a"));
        assert_eq!(workspace.simulations["b"].session.steps, 2);
        workspace
            .build("a".into(), sources(8), 32, 0, StepMode::Micro)
            .unwrap();
        workspace.control("a", "step", None, None, None).unwrap();
        workspace.control("b", "reset", None, None, None).unwrap();
        assert_eq!(workspace.simulations["a"].session.steps, 1);
        workspace.close_simulation("b").unwrap();
        assert!(workspace.simulations.contains_key("a"));
    }
    #[test]
    fn input_wait_and_rewind_belong_to_the_requested_simulator() {
        let mut workspace = Workspace::default();
        let echo = vec![BuildSource {
            file: "input.cas".into(),
            path: None,
            source: "MAIN START\n IN BUF,LEN\n OUT BUF,LEN\n RET\nBUF DS 128\nLEN DS 1\n END\n"
                .into(),
        }];
        workspace
            .build("a".into(), echo, 32, 0, StepMode::Instruction)
            .unwrap();
        workspace
            .build("b".into(), sources(42), 32, 0, StepMode::Instruction)
            .unwrap();
        workspace
            .control("a", "run", Some(100), None, None)
            .unwrap();
        workspace
            .control("b", "run", Some(100), None, None)
            .unwrap();
        workspace
            .control("a", "input", None, Some("あ"), None)
            .unwrap();
        workspace
            .control("a", "run", Some(100), None, None)
            .unwrap();
        assert_eq!(
            workspace.simulations["a"].session.machine.output(),
            vec!["あ"]
        );
        assert_eq!(
            workspace.simulations["b"].session.machine.output(),
            vec![""]
        );
        workspace.control("a", "back", None, None, None).unwrap();
        assert_eq!(
            workspace.simulations["a"].session.machine.status,
            wcasl2_core::Status::WaitingInput
        );
        assert_eq!(workspace.simulations["b"].session.steps, 2);
    }
    #[test]
    fn device_changes_are_local_and_conflicting_files_are_reserved() {
        let root = temporary();
        let mut workspace = Workspace {
            settings_path: root.join("settings.json"),
            ..Workspace::default()
        };
        workspace
            .build("a".into(), sources(7), 32, 0, StepMode::Instruction)
            .unwrap();
        workspace
            .build("b".into(), sources(42), 32, 0, StepMode::Instruction)
            .unwrap();
        workspace.control("b", "step", None, None, None).unwrap();
        let config = DeviceConfig {
            input_path: None,
            output_path: Some(root.join("out.txt")),
        };
        workspace.apply_devices(Some("a"), config.clone()).unwrap();
        assert_eq!(workspace.simulations["b"].session.steps, 1);
        assert_eq!(
            workspace.simulations["b"].session.device_config(),
            &DeviceConfig::default()
        );
        assert!(workspace.apply_devices(Some("b"), config.clone()).is_err());
        assert!(workspace
            .validate_open_paths(&[root.join("out.txt")])
            .is_err());
        workspace.close_simulation("a").unwrap();
        workspace.apply_devices(Some("b"), config).unwrap();
        assert_eq!(workspace.simulations["b"].session.steps, 0);
        workspace.shutdown().unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn device_settings_save_failure_does_not_rewind_any_session() {
        let root = temporary();
        let directory = root.join("settings.json");
        std::fs::create_dir(&directory).unwrap();
        let mut workspace = Workspace {
            settings_path: directory,
            ..Workspace::default()
        };
        for id in ["a", "b"] {
            workspace
                .build(id.into(), sources(7), 32, 0, StepMode::Instruction)
                .unwrap();
            workspace.control(id, "step", None, None, None).unwrap();
        }
        assert!(workspace
            .apply_devices(
                Some("a"),
                DeviceConfig {
                    input_path: Some(root.join("missing.txt")),
                    output_path: None
                }
            )
            .is_err());
        for sim in workspace.simulations.values() {
            assert_eq!(sim.session.steps, 1);
            assert_eq!(sim.session.machine.cpu.gr[1], 7);
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
