# xCASL2 — Rust + Tauri によるWCASL2移植

WCASL2を解析した仕様・期待値を使い、Rust + Tauri 2で移植を進めている。シンタックスハイライト付き編集、アセンブル、命令／フェーズ／最小STEP、COMETデータパス、レジスタ・メモリ表示、キーボード／ファイルIN・画面／ファイルOUT、cmkの複数ファイル管理、設定の保存復元を備える。完全移植は進行中。

## 起動

```powershell
npm ci
npm run tauri dev
```

Rust (MSVC)、C++ Build Tools / Windows SDK、Node.js、WebView2が必要。

```powershell
cargo test -p xcasl2-core --locked
npm run tauri -- build --debug --no-bundle
```

上部メニューからファイルを開く・保存できる。casごとの編集タブを複数開き、ソース右上のプレビューアイコン（F5）で、そのファイル専用のシミュレーターを右に開く。各シミュレーターはCPU・メモリ・入出力を独立して保持する。[タブとメニューの操作](docs/WORKBENCH_UI.md)を参照。

複数ファイルのサンプルは `examples/project/sample.cmk`。「プロジェクト → cmkを開く」から読み込める。

ビルド成果物は `target/debug/xcasl2-desktop.exe`。操作・構成・照合範囲・未実装事項は[実装状況](docs/IMPLEMENTATION_STATUS.md)を参照。

## 文書

- [GitHub Releasesの設定・バージョン更新・公開手順](docs/RELEASING.md)

- [ソースの左右表示とタブのドラッグ移動](docs/SPLIT_TABS.md)
- [CASLモードのラベル・スタック表示](docs/CASL_INSPECTION.md)

- [メニューバーと複数タブのワークスペース](docs/WORKBENCH_UI.md)
- [フォルダーのエクスプローラー](docs/FOLDER_EXPLORER.md)
- [エディターのシンタックスハイライト](docs/EDITOR_HIGHLIGHT.md)
- [COMETブロック図の配置エディター](docs/COMET_LAYOUT_EDITOR.md)
- [Monaco Editorの編集機能とCASL連携](docs/MONACO_EDITOR.md)
- [インデント設定・ステータスバーの操作・略記展開](docs/EDITOR_INDENTATION.md)
- [K61_advance.casの異常終了の原因と修正](docs/K61_ADVANCE_COMPATIBILITY_FIX.md)
- [詳細互換仕様書](docs/WCASL2_COMPATIBILITY_SPEC.md)
- [COMETパイプラインの実装・追加照合](docs/WCASL2_PIPELINE_IMPLEMENTATION.md)
- [cmkと設定の実装・検証](docs/WCASL2_PROJECT_SETTINGS_IMPLEMENTATION.md)
- [ファイル入出力装置の実装・検証](docs/WCASL2_FILE_DEVICES_IMPLEMENTATION.md)
- [解析手順・コード位置・未確定事項](docs/WCASL2_REVERSE_ENGINEERING.md)
- [Rust移植設計案](docs/WCASL2_PORTING_DESIGN.md)
- [構文・ビルドの試験一覧](docs/WCASL2_TEST_MATRIX.md)
- [未確認事項の追加解析・実機証拠](docs/WCASL2_FOLLOWUP_ANALYSIS.md)
- [実ファイルI/O・cmkパスと不具合の追加解析（2026-10-27）](docs/WCASL2_NATIVE_IO_AND_PATHS.md)

## 対象

SHA-256: `389365c3f036b9c5461d669dafe98d7772b412167d3aee1730fb441e8275f74e`

ファイル版情報は1.0.7.0、内蔵バージョン表示は1.08。両者が食い違うため、ハッシュで対象を固定する。EXEは変更していない。

## 主な固有挙動

- 物理メモリは3000語。範囲外読込はFFFF、範囲外書込は無視。
- 0020ロード、FFFF初期化を実機で確認。
- DCとINで非ASCIIバイトの拡張方法が異なる。
- 空行、ラベル後続文字検査、長いシフト量に原版固有の挙動がある。
- 画面OUTは自動改行せず44桁×12行。ファイル出力には別の変換規則がある。
- COMETは4フェーズをさらに細分化した最小STEPを持つ。
- Backspaceは再実行方式。INを再通過すると入力を求め直すことを実機確認。
- cmkの実保存形式とメイン指定、200バイトの行長境界、INIの実保存先を追加確認。

`analysis/results/` に元のx86ルーチンから採取した期待値、`analysis/fixtures/` に再現用ソース、`analysis/results/ui/` に一部の実機証拠を保存した。1,420件のCPUプローブのうち、LD・算術・論理・比較980件は独立な演算式との比較で差がなかった。

画面全操作や外部I/Oを含む100%の互換性を証明する資料ではない。測定済み・静的確認・未確定を文書で区別し、残る試験も記載している。

追加試験は `followup_*.json` と `ui-followup/` に分けて保存した。空行・末尾処理54ケース、巻き戻し5シナリオ、ファイル入力後処理9ケース、cmkのUI保存2例を含む。

2026-10-27には、実ディスク出力11時点・ファイル入力5ケースも採取した。cmkでは欠損パスの検査漏れ、カレントディレクトリ依存、旧保存先の再利用、3ファイル並び替えの表示名とパスの不整合を確認した。
