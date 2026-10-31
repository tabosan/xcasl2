use crate::{DeviceConfig, StepMode, MEMORY_WORDS};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThemePreference {
    Light,
    #[default]
    Dark,
    System,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub version: u32,
    pub theme: ThemePreference,
    pub editor_font_family: String,
    pub editor_font_size: u16,
    pub editor_insert_spaces: bool,
    pub editor_tab_size: u16,
    pub editor_detect_indentation: bool,
    pub auto_switch_step_mode: bool,
    pub auto_comment_overwrite: bool,
    pub base: u16,
    pub fill: u16,
    pub interval_ms: u32,
    pub step_mode: StepMode,
    pub binary_registers: bool,
    pub signed_decimal: bool,
    pub auto_save: bool,
    pub recent_files: Vec<String>,
    pub comet_view: bool,
    pub memory_start: u16,
    pub devices: DeviceConfig,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: 1,
            theme: ThemePreference::Dark,
            editor_font_family: "\"Cascadia Code\", Consolas, \"BIZ UDGothic\", monospace".into(),
            editor_font_size: 14,
            editor_insert_spaces: true,
            editor_tab_size: 4,
            editor_detect_indentation: true,
            auto_switch_step_mode: true,
            auto_comment_overwrite: false,
            base: 32,
            fill: 65535,
            interval_ms: 100,
            step_mode: StepMode::default(),
            binary_registers: false,
            signed_decimal: true,
            auto_save: false,
            recent_files: Vec::new(),
            comet_view: false,
            memory_start: 32,
            devices: DeviceConfig::default(),
        }
    }
}
impl Settings {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1 {
            return Err("未対応の設定ファイルのバージョンです。".into());
        }
        if self.base as usize >= MEMORY_WORDS || self.memory_start as usize >= MEMORY_WORDS {
            return Err("番地は0000〜0BB7で指定してください。".into());
        }
        if self.fill != 0 && self.fill != 65535 {
            return Err("初期化値は0000またはFFFFで指定してください。".into());
        }
        if self.interval_ms > 60_000 {
            return Err("実行間隔は0〜60000 msで指定してください。".into());
        }
        if self.editor_font_family.trim().is_empty()
            || self.editor_font_family.chars().count() > 1024
            || self.editor_font_family.chars().any(char::is_control)
        {
            return Err("フォントファミリーは1〜1024文字で指定してください。".into());
        }
        if !(8..=72).contains(&self.editor_font_size) {
            return Err("フォントサイズは8〜72の整数で指定してください。".into());
        }
        if !(1..=16).contains(&self.editor_tab_size) {
            return Err("タブの表示サイズは1〜16の整数で指定してください。".into());
        }
        self.devices.validate()
    }
    pub fn load(path: &Path) -> Result<Self, String> {
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::default())
            }
            Err(error) => return Err(error.to_string()),
        };
        let settings: Self =
            serde_json::from_slice(&bytes).map_err(|e| format!("設定を読み取れません: {e}"))?;
        settings.validate()?;
        Ok(settings)
    }
    pub fn save(&self, path: &Path) -> Result<(), String> {
        self.validate()?;
        let bytes = serde_json::to_vec_pretty(self).map_err(|e| e.to_string())?;
        // Preserve malformed / newer settings before the first explicit user change.
        if path.exists() && Self::load(path).is_err() {
            let backup = path.with_file_name(format!("settings-invalid-{}.json", unique_id()));
            fs::copy(path, backup).map_err(|e| e.to_string())?;
        }
        atomic_write(path, &bytes)
    }
}

fn unique_id() -> String {
    static SERIAL: AtomicU64 = AtomicU64::new(0);
    format!(
        "{}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        SERIAL.fetch_add(1, Ordering::Relaxed)
    )
}

/// Same-directory replacement: readers see either the old or the complete new file.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or("保存先フォルダーがありません。")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temporary = parent.join(format!(".xcasl2-{}.tmp", unique_id()));
    let result = (|| -> std::io::Result<()> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result.map_err(|e| e.to_string())
}
