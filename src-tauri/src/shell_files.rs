use std::path::{Path, PathBuf};

#[cfg(windows)]
fn shell_thread<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    std::thread::spawn(move || {
        use windows::Win32::System::Com::{
            CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED,
        };
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED)
                .ok()
                .map_err(|e| e.to_string())?;
        }
        struct Apartment;
        impl Drop for Apartment {
            fn drop(&mut self) {
                unsafe { CoUninitialize() };
            }
        }
        let _apartment = Apartment;
        work()
    })
    .join()
    .map_err(|_| "Windowsのファイル操作を完了できませんでした。".to_owned())?
}

#[cfg(windows)]
fn wide(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str().encode_wide().chain(Some(0)).collect()
}

pub fn rename_without_replace(from: &Path, to: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::{
            core::PCWSTR,
            Win32::Storage::FileSystem::{MoveFileExW, MOVE_FILE_FLAGS},
        };
        let from = wide(from);
        let to = wide(to);
        unsafe {
            MoveFileExW(
                PCWSTR(from.as_ptr()),
                PCWSTR(to.as_ptr()),
                MOVE_FILE_FLAGS(0),
            )
        }
        .map_err(|e| {
            format!(
                "名前を変更できません（同名の項目や使用中のファイルがないか確認してください）: {e}"
            )
        })
    }
    #[cfg(not(windows))]
    {
        if to.symlink_metadata().is_ok() {
            return Err("同名の項目があります。".into());
        }
        std::fs::rename(from, to).map_err(|e| e.to_string())
    }
}

pub fn recycle(path: PathBuf) -> Result<(), String> {
    #[cfg(windows)]
    {
        shell_thread(move || {
            use windows::{
                core::PCWSTR,
                Win32::{
                    System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER},
                    UI::Shell::{
                        FileOperation, IFileOperation, IShellItem, SHCreateItemFromParsingName,
                        FOFX_EARLYFAILURE, FOFX_RECYCLEONDELETE, FOF_ALLOWUNDO, FOF_NOCONFIRMATION,
                        FOF_NOERRORUI, FOF_SILENT, FOF_WANTNUKEWARNING,
                    },
                },
            };
            let name = wide(&path);
            unsafe {
                let item: IShellItem = SHCreateItemFromParsingName(PCWSTR(name.as_ptr()), None)
                    .map_err(|e| e.to_string())?;
                let operation: IFileOperation =
                    CoCreateInstance(&FileOperation, None, CLSCTX_INPROC_SERVER)
                        .map_err(|e| e.to_string())?;
                operation
                    .SetOperationFlags(
                        FOF_ALLOWUNDO
                            | FOF_NOCONFIRMATION
                            | FOF_NOERRORUI
                            | FOF_SILENT
                            | FOF_WANTNUKEWARNING
                            | FOFX_RECYCLEONDELETE
                            | FOFX_EARLYFAILURE,
                    )
                    .map_err(|e| e.to_string())?;
                operation
                    .DeleteItem(&item, None)
                    .map_err(|e| e.to_string())?;
                operation.PerformOperations().map_err(|e| e.to_string())?;
                if operation
                    .GetAnyOperationsAborted()
                    .map_err(|e| e.to_string())?
                    .as_bool()
                    || path.symlink_metadata().is_ok()
                {
                    return Err("削除がキャンセルされたか、ごみ箱へ移動できませんでした。".into());
                }
            }
            Ok(())
        })
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("この環境のごみ箱操作には対応していません。".into())
    }
}

pub fn reveal(path: PathBuf) -> Result<(), String> {
    #[cfg(windows)]
    {
        shell_thread(move || {
            use windows::{
                core::PCWSTR,
                Win32::{
                    System::Com::CoTaskMemFree,
                    UI::Shell::{SHOpenFolderAndSelectItems, SHParseDisplayName},
                },
            };
            let name = wide(&path);
            unsafe {
                let mut item = std::ptr::null_mut();
                SHParseDisplayName(PCWSTR(name.as_ptr()), None, &mut item, 0, None)
                    .map_err(|e| e.to_string())?;
                let result = SHOpenFolderAndSelectItems(item, None, 0).map_err(|e| e.to_string());
                CoTaskMemFree(Some(item.cast()));
                result
            }
        })
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("この環境のファイルマネージャー表示には対応していません。".into())
    }
}
