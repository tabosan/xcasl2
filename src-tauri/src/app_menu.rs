use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Manager, Wry,
};
use wcasl2_core::settings::Settings;

struct FileMenu {
    recent: Submenu<Wry>,
    auto_save: CheckMenuItem<Wry>,
}

pub fn sync(app: &AppHandle, settings: &Settings) -> tauri::Result<()> {
    let state = app.state::<FileMenu>();
    state.auto_save.set_checked(settings.auto_save)?;
    for item in state.recent.items()? {
        state.recent.remove(&item)?;
    }
    if settings.recent_files.is_empty() {
        state.recent.append(&MenuItem::with_id(
            app,
            "recent-empty",
            "履歴はありません",
            false,
            None::<&str>,
        )?)?;
    } else {
        for path in settings.recent_files.iter().take(20) {
            let label = path.replace('&', "&&").replace(['\n', '\r', '\t'], " ");
            state
                .recent
                .append(&item(app, &format!("recent:{path}"), &label, None)?)?;
        }
        state.recent.append(&PredefinedMenuItem::separator(app)?)?;
        state
            .recent
            .append(&item(app, "recent-clear", "履歴を消去(&C)", None)?)?;
    }
    Ok(())
}

fn item(app: &AppHandle, id: &str, label: &str, key: Option<&str>) -> tauri::Result<MenuItem<Wry>> {
    MenuItem::with_id(app, id, label, true, key)
}

pub fn create(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let recent = Submenu::new(app, "最近使用したファイル(&R)", true)?;
    let auto_save =
        CheckMenuItem::with_id(app, "auto-save", "自動保存(&U)", true, false, None::<&str>)?;
    let file = Submenu::with_items(
        app,
        "ファイル(&F)",
        true,
        &[
            &item(app, "new", "新しいCASLファイル(&N)", Some("Ctrl+N"))?,
            &item(app, "open", "ファイルを開く(&O)…", Some("Ctrl+O"))?,
            &recent,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "save", "保存(&S)", Some("Ctrl+S"))?,
            &item(
                app,
                "save-as",
                "名前を付けて保存(&A)…",
                Some("Ctrl+Shift+S"),
            )?,
            &item(app, "save-all", "すべて保存(&L)", None)?,
            &auto_save,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "close-tab", "タブを閉じる(&C)", Some("Ctrl+W"))?,
            &item(app, "close-all", "すべてのタブを閉じる", None)?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "settings", "設定(&P)…", Some("Ctrl+Comma"))?,
            &item(app, "quit", "終了(&X)", None)?,
        ],
    )?;
    // Undo/redo predefined items are unsupported on Windows. Route them to the
    // focused native textarea's edit history instead of maintaining a second history.
    let edit = Submenu::with_items(
        app,
        "編集(&E)",
        true,
        &[
            &item(app, "undo", "元に戻す(&U)", Some("Ctrl+Z"))?,
            &item(app, "redo", "やり直し(&R)", Some("Ctrl+Y"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("切り取り(&T)"))?,
            &PredefinedMenuItem::copy(app, Some("コピー(&C)"))?,
            &PredefinedMenuItem::paste(app, Some("貼り付け(&P)"))?,
            &PredefinedMenuItem::select_all(app, Some("すべて選択(&A)"))?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "find", "検索(&F)…", Some("Ctrl+F"))?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        "表示(&V)",
        true,
        &[
            &item(app, "sidebar", "エクスプローラー", Some("Ctrl+B"))?,
            &item(app, "output-panel", "アセンブラ出力", Some("Ctrl+J"))?,
            &item(app, "focus-source", "第1グループへ移動", Some("Ctrl+1"))?,
            &item(app, "focus-simulator", "第2グループへ移動", Some("Ctrl+2"))?,
            &PredefinedMenuItem::separator(app)?,
            &item(
                app,
                "split-right",
                "タブを右に分割して移動",
                Some("Ctrl+Backslash"),
            )?,
            &item(
                app,
                "move-left",
                "タブを左のグループへ移動",
                Some("Ctrl+Alt+Left"),
            )?,
            &item(
                app,
                "move-right",
                "タブを右のグループへ移動",
                Some("Ctrl+Alt+Right"),
            )?,
            &item(app, "join-groups", "グループを1つにまとめる", None)?,
        ],
    )?;
    let run = Submenu::with_items(
        app,
        "実行(&R)",
        true,
        &[
            &item(
                app,
                "preview",
                "アセンブルしてシミュレーターを右に開く",
                Some("F5"),
            )?,
            &item(app, "run", "実行", Some("F6"))?,
            &item(app, "step", "1STEP実行", Some("F10"))?,
            &item(app, "stop", "停止", Some("Shift+F5"))?,
            &item(app, "back", "1STEP戻る", None)?,
            &item(app, "reset", "リロード", None)?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "devices", "入出力装置…", None)?,
        ],
    )?;
    let project = Submenu::with_items(
        app,
        "プロジェクト(&P)",
        true,
        &[
            &item(app, "project-new", "開いているファイルでcmkを作成", None)?,
            &item(app, "project-open", "cmkを開く…", None)?,
            &item(app, "project-save", "cmkを保存", None)?,
            &item(app, "project-save-as", "cmkを名前を付けて保存…", None)?,
            &item(app, "project-close", "cmkを閉じる", None)?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "project-add", "CASLファイルを追加…", None)?,
            &item(app, "project-main", "現在のファイルをメインにする", None)?,
            &item(app, "project-remove", "現在のファイルを登録から除外", None)?,
            &item(app, "project-build", "メインをアセンブルして右に開く", None)?,
        ],
    )?;
    let samples = Submenu::with_items(
        app,
        "サンプル",
        true,
        &[
            &item(app, "sample-hello", "Hello, CASL II", None)?,
            &item(app, "sample-echo", "入力と出力", None)?,
            &item(app, "sample-sum", "1〜10の合計", None)?,
            &item(app, "sample-files", "ファイル入出力", None)?,
        ],
    )?;
    let help = Submenu::with_items(
        app,
        "ヘルプ(&H)",
        true,
        &[&samples, &item(app, "about", "xCASL2について", None)?],
    )?;
    let menu = Menu::with_items(app, &[&file, &edit, &view, &run, &project, &help])?;
    app.manage(FileMenu { recent, auto_save });
    Ok(menu)
}
