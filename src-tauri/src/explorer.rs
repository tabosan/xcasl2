use crate::{shell_files, AppState};
use serde::Serialize;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::State;
use tauri_plugin_dialog::DialogExt;
use xcasl2_core::project::Project;

#[derive(Default)]
pub struct Explorer(pub Mutex<Option<PathBuf>>);

#[derive(Clone, Serialize)]
pub struct Entry {
    path: String,
    name: String,
    directory: bool,
}

#[derive(Serialize)]
pub struct Folder {
    path: String,
    name: String,
    entries: Vec<Entry>,
}
#[derive(Serialize)]
pub struct PathChange {
    from: String,
    to: String,
    entry: Entry,
}

pub fn path_suffix(path: &Path, parent: &Path) -> Option<PathBuf> {
    let path = PathBuf::from(display_path(path));
    let parent = PathBuf::from(display_path(parent));
    let mut components = path.components();
    for component in parent.components() {
        if components
            .next()?
            .as_os_str()
            .to_string_lossy()
            .to_lowercase()
            != component.as_os_str().to_string_lossy().to_lowercase()
        {
            return None;
        }
    }
    Some(components.as_path().to_owned())
}
fn rebase(path: &Path, from: &Path, to: &Path) -> PathBuf {
    path_suffix(path, from).map_or_else(|| path.to_owned(), |suffix| to.join(suffix))
}

impl Explorer {
    fn mutation_target(&self, path: &Path) -> Result<PathBuf, String> {
        if !path.is_absolute() {
            return Err("絶対パスを指定してください。".into());
        }
        let parent = self.resolve(
            path.parent()
                .ok_or("開いているルートフォルダーは操作できません。")?,
        )?;
        let target = parent.join(path.file_name().ok_or("名前を取得できません。")?);
        target.symlink_metadata().map_err(|e| e.to_string())?;
        Ok(target)
    }
    fn rename(&self, path: &Path, name: &str) -> Result<PathChange, String> {
        validate_name(name)?;
        let from = self.mutation_target(path)?;
        let to = from.with_file_name(name);
        if from.file_name() != to.file_name() {
            shell_files::rename_without_replace(&from, &to)?;
        }
        let directory = fs::metadata(&to).is_ok_and(|m| m.is_dir());
        Ok(PathChange {
            from: display_path(&from),
            to: display_path(&to),
            entry: Entry {
                path: display_path(&path.with_file_name(name)),
                name: name.into(),
                directory,
            },
        })
    }
    pub fn resolve(&self, path: &Path) -> Result<PathBuf, String> {
        let root = self.0.lock().map_err(|_| "フォルダーを取得できません。")?;
        let root = root.as_ref().ok_or("フォルダーを開いてください。")?;
        let resolved = path.canonicalize().map_err(|e| e.to_string())?;
        if !resolved.starts_with(root) {
            return Err("開いているフォルダーの外は操作できません。".into());
        }
        Ok(resolved)
    }

    fn open(&self, path: &Path) -> Result<Folder, String> {
        let root = path.canonicalize().map_err(|e| e.to_string())?;
        let entries = list(&root)?;
        let folder = Folder {
            path: crate::canonical_path(&root)?.to_string_lossy().into(),
            name: root.file_name().map_or_else(
                || path.to_string_lossy().into_owned(),
                |name| name.to_string_lossy().into_owned(),
            ),
            entries,
        };
        *self.0.lock().map_err(|_| "フォルダーを取得できません。")? = Some(root);
        Ok(folder)
    }

    fn create(&self, parent: &Path, name: &str, directory: bool) -> Result<Entry, String> {
        validate_name(name)?;
        let visible_path = parent.join(name);
        let parent = self.resolve(parent)?;
        if !parent.is_dir() {
            return Err("作成先がフォルダーではありません。".into());
        }
        let path = parent.join(name);
        if directory {
            fs::create_dir(&path).map_err(|e| format!("フォルダーを作成できません: {e}"))?;
        } else {
            let bytes = if path
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("cmk"))
            {
                Project {
                    stored_path: crate::canonical_path(&parent)?
                        .join(name)
                        .to_string_lossy()
                        .into(),
                    ..Project::default()
                }
                .encode()?
            } else {
                Vec::new()
            };
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(|e| {
                    format!("ファイルを作成できません（同名の項目がないか確認してください）: {e}")
                })?;
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|e| e.to_string())?;
        }
        Ok(Entry {
            path: display_path(&visible_path),
            name: name.into(),
            directory,
        })
    }
}

fn validate_name(name: &str) -> Result<(), String> {
    let stem = name
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end_matches([' ', '.'])
        .to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"].contains(&stem.as_str())
        || ["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix).is_some_and(|suffix| {
                matches!(
                    suffix,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
        });
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.ends_with([' ', '.'])
        || name.encode_utf16().count() > 255
        || reserved
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
    {
        return Err("名前にはフォルダーの区切りや使用できない記号・予約名を含めず、255文字以内で指定してください。".into());
    }
    Ok(())
}

fn display_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        text.strip_prefix(r"\\?\").unwrap_or(&text).to_owned()
    }
}

fn list(path: &Path) -> Result<Vec<Entry>, String> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(path).map_err(|e| format!("フォルダーを読み込めません: {e}"))?
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        entries.push(Entry {
            // Keep the lexical entry path: resolve() checks symlink destinations
            // before a directory is listed or an item is created/opened.
            path: display_path(&path),
            name: entry.file_name().to_string_lossy().into(),
            directory: fs::metadata(path).is_ok_and(|metadata| metadata.is_dir()),
        });
        if entries.len() > 20_000 {
            return Err("1つのフォルダーに表示できる項目は20,000件までです。".into());
        }
    }
    entries.sort_by(|a, b| {
        b.directory
            .cmp(&a.directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(entries)
}

#[tauri::command]
pub async fn open_folder(
    app: tauri::AppHandle,
    explorer: State<'_, Explorer>,
) -> Result<Option<Folder>, String> {
    let Some(folder) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    explorer
        .open(&folder.into_path().map_err(|e| e.to_string())?)
        .map(Some)
}

#[tauri::command]
pub async fn read_folder(
    path: PathBuf,
    explorer: State<'_, Explorer>,
) -> Result<Vec<Entry>, String> {
    explorer.resolve(&path)?;
    list(&path)
}

#[tauri::command]
pub async fn create_explorer_entry(
    parent: PathBuf,
    name: String,
    directory: bool,
    explorer: State<'_, Explorer>,
) -> Result<Entry, String> {
    explorer.create(&parent, &name, directory)
}

#[tauri::command]
pub fn explorer_mutation_path(
    path: PathBuf,
    explorer: State<'_, Explorer>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let target = explorer.mutation_target(&path)?;
    state
        .0
        .lock()
        .map_err(|_| "実行状態を取得できません。")?
        .validate_explorer_mutation(&target)?;
    Ok(display_path(&target))
}

#[tauri::command]
pub async fn rename_explorer_entry(
    path: PathBuf,
    name: String,
    explorer: State<'_, Explorer>,
    state: State<'_, AppState>,
) -> Result<PathChange, String> {
    let target = explorer.mutation_target(&path)?;
    let mut data = state.0.lock().map_err(|_| "実行状態を取得できません。")?;
    data.validate_explorer_mutation(&target)?;
    let change = explorer.rename(&path, &name)?;
    let from = Path::new(&change.from);
    let to = Path::new(&change.to);
    for path in data.source_paths.iter_mut() {
        *path = rebase(path, from, to);
    }
    for path in data.project_paths.iter_mut() {
        *path = rebase(path, from, to);
    }
    for simulation in data.simulations.values_mut() {
        for path in &mut simulation.source_paths {
            *path = rebase(path, from, to);
        }
    }
    Ok(change)
}

#[tauri::command]
pub async fn delete_explorer_entry(
    path: PathBuf,
    explorer: State<'_, Explorer>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let target = explorer.mutation_target(&path)?;
    let mut data = state.0.lock().map_err(|_| "実行状態を取得できません。")?;
    data.validate_explorer_mutation(&target)?;
    // Shell APIs receive an ordinary absolute path; never follow the final
    // symlink/junction and never substitute recursive permanent deletion.
    shell_files::recycle(PathBuf::from(display_path(&target)))?;
    data.source_paths
        .retain(|path| path_suffix(path, &target).is_none());
    data.project_paths
        .retain(|path| path_suffix(path, &target).is_none());
    Ok(display_path(&target))
}

#[tauri::command]
pub async fn reveal_in_explorer(path: PathBuf) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("絶対パスを指定してください。".into());
    }
    path.symlink_metadata().map_err(|e| e.to_string())?;
    let path = if let (Some(parent), Some(name)) = (path.parent(), path.file_name()) {
        crate::canonical_path(parent)?.join(name)
    } else {
        crate::canonical_path(&path)?
    };
    shell_files::reveal(path)
}

#[tauri::command]
pub fn close_folder(explorer: State<Explorer>) -> Result<(), String> {
    *explorer
        .0
        .lock()
        .map_err(|_| "フォルダーを取得できません。")? = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            static SERIAL: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "xcasl2-explorer-{}-{}",
                std::process::id(),
                SERIAL.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn listing_creation_and_empty_projects_keep_existing_files() {
        let temp = Temp::new();
        let explorer = Explorer::default();
        explorer.open(&temp.0).unwrap();
        explorer.create(&temp.0, "日本語", true).unwrap();
        let cas = explorer.create(&temp.0, "HELLO.CAS", false).unwrap();
        let cmk = explorer.create(&temp.0, "project.CMK", false).unwrap();
        assert_eq!(fs::read(cas.path).unwrap(), b"");
        assert!(Project::decode(&fs::read(cmk.path).unwrap())
            .unwrap()
            .files
            .is_empty());
        fs::write(temp.0.join("keep.cas"), b"KEEP").unwrap();
        assert!(explorer.create(&temp.0, "keep.cas", false).is_err());
        assert!(explorer.create(&temp.0, "日本語", true).is_err());
        assert_eq!(fs::read(temp.0.join("keep.cas")).unwrap(), b"KEEP");
        assert!(list(&temp.0).unwrap()[0].directory);
    }
    #[test]
    fn creation_is_confined_to_the_selected_folder_and_valid_names() {
        let temp = Temp::new();
        let outside = Temp::new();
        let explorer = Explorer::default();
        assert!(explorer.create(&temp.0, "a.cas", false).is_err());
        explorer.open(&temp.0).unwrap();
        assert!(explorer.create(&outside.0, "a.cas", false).is_err());
        for name in [
            "",
            ".",
            "..",
            "../escape.cas",
            "sub\\escape.cas",
            "CON.cas",
            "LPT1",
            "a:stream",
            "a.",
            "a ",
            "a\0b",
        ] {
            assert!(explorer.create(&temp.0, name, false).is_err(), "{name:?}");
        }
        assert_eq!(fs::read_dir(&outside.0).unwrap().count(), 0);
        assert_eq!(fs::read_dir(&temp.0).unwrap().count(), 0);
    }
    #[test]
    fn rename_preserves_contents_and_rejects_collisions_roots_and_outside_paths() {
        let temp = Temp::new();
        let outside = Temp::new();
        let explorer = Explorer::default();
        explorer.open(&temp.0).unwrap();
        fs::write(temp.0.join("before.cas"), b"UNSAVED ON DISK").unwrap();
        fs::write(temp.0.join("keep.cas"), b"KEEP").unwrap();
        assert!(explorer
            .rename(&temp.0.join("before.cas"), "keep.cas")
            .is_err());
        assert_eq!(fs::read(temp.0.join("keep.cas")).unwrap(), b"KEEP");
        assert_eq!(
            fs::read(temp.0.join("before.cas")).unwrap(),
            b"UNSAVED ON DISK"
        );
        let change = explorer
            .rename(&temp.0.join("before.cas"), "日本語.cas")
            .unwrap();
        assert_eq!(fs::read(&change.to).unwrap(), b"UNSAVED ON DISK");
        assert!(!temp.0.join("before.cas").exists());
        assert!(explorer.rename(&temp.0, "root-new").is_err());
        fs::write(outside.0.join("outside.cas"), b"OUTSIDE").unwrap();
        assert!(explorer
            .rename(&outside.0.join("outside.cas"), "new.cas")
            .is_err());
        assert!(explorer.rename(Path::new(&change.to), "../escape").is_err());
        fs::create_dir(temp.0.join("sub")).unwrap();
        fs::write(temp.0.join("sub/child.cas"), b"CHILD").unwrap();
        let directory = explorer.rename(&temp.0.join("sub"), "Renamed").unwrap();
        assert!(directory.entry.directory);
        assert_eq!(
            fs::read(temp.0.join("Renamed/child.cas")).unwrap(),
            b"CHILD"
        );
        #[cfg(windows)]
        {
            explorer.rename(&temp.0.join("Renamed"), "renamed").unwrap();
            assert!(list(&temp.0)
                .unwrap()
                .iter()
                .any(|entry| entry.name == "renamed"));
        }
    }
    #[test]
    fn mutation_paths_and_rebasing_use_component_boundaries() {
        let base = Path::new(r"C:\work\src");
        assert!(path_suffix(Path::new(r"C:\work\src-old\a.cas"), base).is_none());
        assert_eq!(
            rebase(
                Path::new(r"C:\work\src\sub\a.cas"),
                base,
                Path::new(r"C:\new")
            ),
            PathBuf::from(r"C:\new\sub\a.cas")
        );
        #[cfg(windows)]
        assert_eq!(
            path_suffix(Path::new(r"\\?\C:\WORK\src\a.cas"), base),
            Some(PathBuf::from("a.cas"))
        );
    }
    #[cfg(windows)]
    #[test]
    #[ignore = "Moves only this test's temporary fixture to the Windows Recycle Bin"]
    fn recycle_owned_fixture() {
        let temp = Temp::new();
        let target = temp.0.join("recycle-fixture");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("owned.cas"), b"TEST FIXTURE").unwrap();
        shell_files::recycle(target.clone()).unwrap();
        assert!(!target.exists());
    }
    #[test]
    fn failed_switch_keeps_the_root_and_successful_switch_revokes_the_old_root() {
        let first = Temp::new();
        let second = Temp::new();
        let explorer = Explorer::default();
        explorer.open(&first.0).unwrap();
        fs::write(first.0.join("a.cas"), b"").unwrap();
        assert!(explorer.open(&first.0.join("a.cas")).is_err());
        assert!(explorer.resolve(&first.0).is_ok());
        explorer.open(&second.0).unwrap();
        assert!(explorer.resolve(&first.0).is_err());
        assert!(explorer.resolve(&second.0).is_ok());
    }
    #[cfg(unix)]
    #[test]
    fn symbolic_links_cannot_escape_the_root() {
        let temp = Temp::new();
        let outside = Temp::new();
        let explorer = Explorer::default();
        std::os::unix::fs::symlink(&outside.0, temp.0.join("link")).unwrap();
        explorer.open(&temp.0).unwrap();
        assert!(explorer.resolve(&temp.0.join("link")).is_err());
        assert!(explorer
            .create(&temp.0.join("link"), "escape.cas", false)
            .is_err());
    }
}
