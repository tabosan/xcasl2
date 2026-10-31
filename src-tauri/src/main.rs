#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_menu;
mod workspace;

use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use workspace::{BuildSource, Workspace};
use xcasl2_core::{
    project::{Project, ProjectFile},
    settings::{atomic_write, Settings, ThemePreference},
    DeviceConfig, Diagnostic, Snapshot, StepMode,
};

struct AppState(Mutex<Workspace>);

fn apply_theme(app: &tauri::AppHandle, preference: ThemePreference) {
    app.set_theme(match preference {
        ThemePreference::Light => Some(tauri::Theme::Light),
        ThemePreference::Dark => Some(tauri::Theme::Dark),
        ThemePreference::System => None,
    });
}

#[tauri::command]
async fn build(
    id: String,
    sources: Vec<BuildSource>,
    base: u16,
    fill: u16,
    mode: StepMode,
    state: State<'_, AppState>,
) -> Result<Snapshot, Vec<Diagnostic>> {
    state
        .0
        .lock()
        .map_err(|_| {
            vec![Diagnostic {
                file: None,
                line: 0,
                code: 0,
                message: "実行状態を取得できません。".into(),
            }]
        })?
        .build(id, sources, base, fill, mode)
}

#[tauri::command]
async fn control(
    id: String,
    action: String,
    count: Option<u32>,
    text: Option<String>,
    mode: Option<StepMode>,
    state: State<'_, AppState>,
) -> Result<Snapshot, String> {
    state
        .0
        .lock()
        .map_err(|_| "実行状態を取得できません。")?
        .control(&id, &action, count, text.as_deref(), mode)
}

#[tauri::command]
fn generate_comments(
    sources: Vec<BuildSource>,
    target: String,
    base: u16,
    overwrite: bool,
) -> Vec<xcasl2_core::assembler::CommentEdit> {
    let inputs: Vec<_> = sources
        .iter()
        .map(|s| (Some(s.file.as_str()), s.source.as_str()))
        .collect();
    xcasl2_core::assembler::auto_comments(&inputs, Some(&target), base, overwrite)
}

#[derive(Serialize)]
struct OpenedSource {
    path: String,
    source: String,
}

fn canonical_path(path: &Path) -> Result<PathBuf, String> {
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    let text = canonical.to_string_lossy();
    // Legacy cmk stores ordinary ANSI Windows paths, rather than extended syntax.
    Ok(if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{unc}"))
    } else if let Some(ordinary) = text.strip_prefix(r"\\?\") {
        PathBuf::from(ordinary)
    } else {
        canonical
    })
}
fn read_cas(path: &Path) -> Result<OpenedSource, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let source =
        xcasl2_core::decode_source(&bytes).map_err(|e| format!("{}: {e}", path.display()))?;
    let path = canonical_path(path)?;
    Ok(OpenedSource {
        path: path.to_string_lossy().into(),
        source,
    })
}

#[tauri::command]
async fn open_sources(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<Vec<OpenedSource>>, String> {
    let Some(files) = app
        .dialog()
        .file()
        .add_filter("CASL II (CP932)", &["cas"])
        .blocking_pick_files()
    else {
        return Ok(None);
    };
    let paths = files
        .into_iter()
        .map(|file| file.into_path().map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    let sources = paths
        .iter()
        .map(|path| read_cas(path))
        .collect::<Result<Vec<_>, _>>()?;
    state
        .0
        .lock()
        .map_err(|_| "実行状態を取得できません。")?
        .validate_open_paths(&paths)?;
    Ok(Some(sources))
}

#[tauri::command]
async fn open_recent(path: PathBuf, state: State<'_, AppState>) -> Result<OpenedSource, String> {
    let source = read_cas(&path)?;
    state
        .0
        .lock()
        .map_err(|_| "実行状態を取得できません。")?
        .validate_open_paths(&[path])?;
    Ok(source)
}

#[tauri::command]
async fn refresh_file_menu(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let settings = state
        .0
        .lock()
        .map_err(|_| "設定を取得できません。")?
        .settings
        .clone();
    app_menu::sync(&app, &settings).map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_source(
    source: String,
    previous_path: Option<String>,
    save_as: bool,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let normalized = source.replace("\r\n", "\n").replace('\n', "\r\n");
    let bytes = xcasl2_core::encode_cp932(&normalized)?;
    let previous = previous_path.as_deref().map(Path::new);
    let path = if let Some(path) = previous.filter(|_| !save_as) {
        path.to_owned()
    } else {
        let mut picker = app
            .dialog()
            .file()
            .add_filter("CASL II (CP932)", &["cas"])
            .set_file_name(
                previous
                    .and_then(Path::file_name)
                    .map_or("main.cas".into(), |name| {
                        name.to_string_lossy().into_owned()
                    }),
            );
        if let Some(parent) = previous.and_then(Path::parent) {
            picker = picker.set_directory(parent);
        }
        let Some(file) = picker.blocking_save_file() else {
            return Ok(None);
        };
        file.into_path().map_err(|e| e.to_string())?
    };
    let data = state.0.lock().map_err(|_| "実行状態を取得できません。")?;
    data.validate_save(&path, previous)?;
    atomic_write(&path, &bytes)?;
    Ok(Some(canonical_path(&path)?.to_string_lossy().into()))
}

#[tauri::command]
fn get_devices(id: Option<String>, state: State<AppState>) -> Result<DeviceConfig, String> {
    Ok(state
        .0
        .lock()
        .map_err(|_| "実行状態を取得できません。")?
        .device_config(id.as_deref()))
}
#[derive(Serialize)]
struct DeviceUpdate {
    config: DeviceConfig,
    snapshot: Option<Snapshot>,
}
#[tauri::command]
async fn set_devices(
    id: Option<String>,
    config: DeviceConfig,
    state: State<'_, AppState>,
) -> Result<DeviceUpdate, String> {
    let config = config.absolute()?;
    let mut data = state.0.lock().map_err(|_| "実行状態を取得できません。")?;
    let snapshot = data.apply_devices(id.as_deref(), config.clone())?;
    Ok(DeviceUpdate { config, snapshot })
}
#[tauri::command]
async fn pick_device_file(kind: String, app: tauri::AppHandle) -> Result<Option<String>, String> {
    let picker = app
        .dialog()
        .file()
        .add_filter("テキスト", &["txt", "out", "dat"])
        .add_filter("すべて", &["*"]);
    let picked = match kind.as_str() {
        "input" => picker.blocking_pick_file(),
        "output" => picker.set_file_name("output.txt").blocking_save_file(),
        _ => return Err("不明な装置です。".into()),
    };
    picked
        .map(|file| {
            file.into_path()
                .map(|path| path.to_string_lossy().into_owned())
                .map_err(|e| e.to_string())
        })
        .transpose()
}
#[tauri::command]
async fn discard_session(id: String, state: State<'_, AppState>) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|_| "実行状態を取得できません。")?
        .close_simulation(&id)
}
#[tauri::command]
async fn close_devices(state: State<'_, AppState>) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|_| "実行状態を取得できません。")?
        .shutdown()
}
#[tauri::command]
async fn sync_workspace(
    paths: Vec<PathBuf>,
    project_paths: Vec<PathBuf>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|_| "実行状態を取得できません。")?
        .sync_paths(paths, project_paths)
}

#[derive(Serialize)]
struct SettingsInfo {
    settings: Settings,
    path: String,
    warning: Option<String>,
}
#[tauri::command]
fn get_settings(state: State<AppState>) -> Result<SettingsInfo, String> {
    let data = state.0.lock().map_err(|_| "設定を取得できません。")?;
    Ok(SettingsInfo {
        settings: data.settings.clone(),
        path: data.settings_path.to_string_lossy().into(),
        warning: data.settings_warning.clone(),
    })
}
#[tauri::command]
async fn set_settings(
    mut settings: Settings,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut data = state.0.lock().map_err(|_| "設定を取得できません。")?;
    settings.devices = data.devices.clone();
    settings.recent_files.truncate(20);
    let menu_changed = settings.auto_save != data.settings.auto_save
        || settings.recent_files != data.settings.recent_files;
    let theme_changed = settings.theme != data.settings.theme;
    settings.save(&data.settings_path)?;
    data.settings = settings.clone();
    data.settings_warning = None;
    drop(data);
    if theme_changed {
        apply_theme(&app, settings.theme);
    }
    if menu_changed {
        app_menu::sync(&app, &settings).map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[derive(Serialize)]
struct OpenedProject {
    path: String,
    files: Vec<OpenedSource>,
}
#[tauri::command]
async fn open_project(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<OpenedProject>, String> {
    let Some(file) = app
        .dialog()
        .file()
        .add_filter("WCASL2 プロジェクト", &["cmk"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|e| e.to_string())?;
    let path = canonical_path(&path)?;
    let project = Project::decode(&std::fs::read(&path).map_err(|e| e.to_string())?)?;
    let paths = project.resolved_paths(&path)?;
    let files = paths
        .iter()
        .map(|path| read_cas(path))
        .collect::<Result<Vec<_>, _>>()?;
    let data = state.0.lock().map_err(|_| "実行状態を取得できません。")?;
    data.validate_open_paths(&paths)?;
    data.validate_open_paths(std::slice::from_ref(&path))?;
    Ok(Some(OpenedProject {
        path: path.to_string_lossy().into(),
        files,
    }))
}
#[tauri::command]
async fn save_project(
    files: Vec<ProjectFile>,
    previous_path: Option<String>,
    save_as: bool,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    if files.len() > 20 {
        return Err("cmkには20ファイルまで登録できます。".into());
    }
    if files
        .iter()
        .any(|file| !Path::new(&file.path).is_absolute())
    {
        return Err("先に各CASLソースを保存してください。".into());
    }
    let previous = previous_path.as_deref().map(Path::new);
    let path = if let Some(path) = previous.filter(|_| !save_as) {
        path.to_owned()
    } else {
        let mut picker = app
            .dialog()
            .file()
            .add_filter("WCASL2 プロジェクト", &["cmk"])
            .set_file_name(
                previous
                    .and_then(Path::file_name)
                    .map_or("project.cmk".into(), |name| {
                        name.to_string_lossy().into_owned()
                    }),
            );
        if let Some(parent) = previous.and_then(Path::parent) {
            picker = picker.set_directory(parent);
        }
        let Some(file) = picker.blocking_save_file() else {
            return Ok(None);
        };
        file.into_path().map_err(|e| e.to_string())?
    };
    let data = state.0.lock().map_err(|_| "実行状態を取得できません。")?;
    let protected = data
        .source_paths
        .iter()
        .chain(std::iter::once(&data.settings_path))
        .chain(data.project_paths.iter().filter(|other| {
            !previous.is_some_and(|previous| xcasl2_core::devices::same_path(previous, other))
        }))
        .chain(data.simulations.values().flat_map(|sim| {
            [
                sim.session.device_config().input_path.as_ref(),
                sim.session.device_config().output_path.as_ref(),
            ]
            .into_iter()
            .flatten()
        }))
        .chain(
            [
                data.devices.input_path.as_ref(),
                data.devices.output_path.as_ref(),
            ]
            .into_iter()
            .flatten(),
        );
    for other in protected {
        if xcasl2_core::devices::same_path(other, &path) {
            return Err(
                "ソース・設定・他のcmk・装置ファイルへcmkを保存することはできません。".into(),
            );
        }
    }
    for file in &files {
        if xcasl2_core::devices::same_path(Path::new(&file.path), &path) {
            return Err("CASLソースへcmkを保存することはできません。".into());
        }
    }
    let project = Project {
        stored_path: path.to_string_lossy().into(),
        main_path: files
            .first()
            .map_or(String::new(), |file| file.path.clone()),
        files,
    };
    atomic_write(&path, &project.encode()?)?;
    Ok(Some(canonical_path(&path)?.to_string_lossy().into()))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let directory = std::env::var_os("XCASL2_CONFIG_DIR")
                .map(PathBuf::from)
                .unwrap_or(app.path().app_config_dir()?);
            let path = directory.join("settings.json");
            let (settings, warning) = match Settings::load(&path) {
                Ok(settings) => (settings, None),
                Err(error) => (
                    Settings::default(),
                    Some(format!(
                        "設定を復元できませんでした。既定値で起動します。{error}"
                    )),
                ),
            };
            app.manage(AppState(Mutex::new(Workspace {
                devices: settings.devices.clone(),
                settings,
                settings_path: path,
                settings_warning: warning,
                ..Workspace::default()
            })));
            app.set_menu(app_menu::create(app.handle())?)?;
            let settings = app
                .state::<AppState>()
                .0
                .lock()
                .map_err(|_| "設定を取得できません。")?
                .settings
                .clone();
            app_menu::sync(app.handle(), &settings)?;
            apply_theme(app.handle(), settings.theme);
            Ok(())
        })
        .on_menu_event(|app, event| {
            let _ = app.emit("menu-action", event.id().as_ref());
        })
        .invoke_handler(tauri::generate_handler![
            build,
            generate_comments,
            control,
            open_sources,
            open_recent,
            refresh_file_menu,
            save_source,
            get_devices,
            set_devices,
            pick_device_file,
            discard_session,
            close_devices,
            sync_workspace,
            get_settings,
            set_settings,
            open_project,
            save_project
        ])
        .run(tauri::generate_context!())
        .expect("xCASL2の起動に失敗しました。");
}
