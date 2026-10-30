# WCASL2 実ファイルI/O・cmkパスの追加解析

解析日: 2026-10-27。対象は既存のハッシュ固定EXE。前回の模擬ファイル試験を、原アプリと実ディスクで照合した。U/E/Sの意味は [詳細仕様書](WCASL2_COMPATIBILITY_SPEC.md) と同じ。

## 1. 今回確定した挙動

| 項目 | 観測結果 |
|---|---|
| OUTの実改行 | ABを2回出力するとディスクは`41 42 0D 0A 41 42 0D 0A` |
| 既存出力の扱い | 最初のOUTで既存22バイトを切り詰める |
| 短い出力の書出し時点 | 実行途中はサイズ0、RETでClose後に8バイトになる |
| Backspace後の出力 | 再出力を実行するが、全OUTより前へ戻しても直前の`AB\r\n`が残る |
| OUT中のNUL | A・NUL・B、LEN=3でも実ファイルはAの1バイト。末尾改行もない |
| ファイルINのNUL | `A\0B\r\n`はLEN=1、先頭NULはLEN=0 |
| ファイルINのCtrl+Z | `A\x1AB`はLEN=1、先頭Ctrl+ZはLEN=FFFF |
| cmkの欠損絶対パス | 読込は成功するがビルドでプロセス終了。再起動後も再現 |
| cmkの相対パス | 同じフォルダで開けば成功。別フォルダのCASLを開いた後のビルドで終了 |
| cmk保存先 | 「保存」ボタンは、開いたファイルの場所でなく内部に記録された旧パスを使う |
| 3ファイルのメイン変更 | 表示順は先頭挿入、パス配列は先頭との交換になり、2番目以降の対応がずれる |

これらは移植で比較すべき旧版の挙動である。アプリ終了や不意の別パスへの保存を、新実装でも無条件に再現する提案ではない。

## 2. 実ファイルOUTと巻き戻し

[ui_native_io.cas](../analysis/fixtures/ui_native_io.cas) は、GR1/GR2を設定し、IN・OUT・NOP・OUT・RETを順に実行する。SVCを直接使い、マクロのPUSH/POPとファイル処理を切り分けた。ロードは0020、FFFF初期化。

入力は`AB  \r\nNEXT\r\n`。実機のINは末尾空白2個を除去し、BUF=0041 0042、LEN=2になった。前回のTrimRightプローブと整合する。

出力先は解析用の`output-active.txt`。初期内容は22バイトの`PREEXISTING-SENTINEL\r\n`で、既存データの有無を明確にした。

| 停止位置 | PR | ディスクサイズ・読取 | 意味 |
|---|---|---|---|
| 実行前 | 0020 | 22バイト、初期内容 | まだ出力先は開かない |
| 最初のOUT後〜NOP後 | 0028〜0029 | サイズ0、外部読取PermissionError | Createによる切詰め。短い出力はまだバッファ内 |
| 2回目のOUT後 | 002B | サイズ0、外部読取PermissionError | 開いたファイルを使って出力を継続 |
| RET後 | 002C | 8バイト、`AB\r\nAB\r\n` | Closeで内容が見える |
| BackspaceでRET前 | 002B | サイズ0、外部読取PermissionError | リロード・再Open・2回のOUTを再実行 |
| さらに2回戻す | 0028 | 1回のOUTを再実行した状態 | Close→再Openが繰り返される |
| 最初のOUTより前へ戻す | 0026 | 4バイト、`AB\r\n` | 前回のバッファがCloseで書き出され、新しいOUTがないので残る |

ファイルが読めないことだけからflush状態を推定してはいない。別に取得したファイルサイズと、Close後のバイト列を照合した。ここで観察したバッファリングはこの短い出力条件であり、長い出力やI/OエラーでもRETまで書き出さないという保証ではない。

全11チェックポイントのバイト・サイズ・読取失敗は [native_io_20261027.json](../analysis/results/native_io_20261027.json)。読めた内容は`native-io/*.bin`としても保存した。

証拠: [IN直後](../analysis/results/ui-20261027/native-io-in-read.png)、[RET直後](../analysis/results/ui-20261027/native-io-ret-closed.png)、[OUTより前へ戻した状態](../analysis/results/ui-20261027/native-io-back-before-any-out.png)。

## 3. 実ファイルのNUL・Ctrl+Z

### OUT

[ui_native_out_nul.cas](../analysis/fixtures/ui_native_out_nul.cas) で、メモリの`0041 0000 0042`をLEN=3としてSVC 2へ渡した。RET後の実ファイルはhex `41`、1バイトのみ。前回の元WriteString/fputs/strlen→模擬fwrite試験と一致した。

後ろのBだけでなく、OUTが追加するLFもNULより後なので保存されない。LEN分をそのままバイナリ出力するRust実装では、この点が異なる。

証拠: [元データとLEN](../analysis/results/ui-20261027/native-out-nul-initial.png)、[RET後](../analysis/results/ui-20261027/native-out-nul-ret.png)、[保存した1バイト](../analysis/results/native-io/nul-ret-closed.bin)。

### IN

各ケースでBackspaceをSVC 1の前まで戻し、ファイルが閉じた状態で入力ファイルを差し替えた。その後の最初のINを観察した。BUFとLENはリロード時にFFFFへ戻る。

| 実ファイル先頭 | LEN | BUF |
|---|---|---|
| `AB  \r\nNEXT\r\n` | 0002 | 0041 0042、後続FFFF |
| `A\0B\r\nNEXT\r\n` | 0001 | 0041、後続FFFF |
| `A\x1AB\r\nNEXT\r\n` | 0001 | 0041、後続FFFF |
| `\x1AB\r\nNEXT\r\n` | FFFF | 保持されたFFFF |
| `\0B\r\nNEXT\r\n` | 0000 | 保持されたFFFF |

先頭NULと先頭Ctrl+Zは異なる。先頭NULは空文字列として成功し、Ctrl+ZはこのWindowsテキスト入力でEOFとなる。NULで見えなくなった後半が次のINでどう扱われるかは、今回の1回目INだけから断定しない。

[native_20261027.json](../analysis/results/native_20261027.json) に実機値、入力fixtureと画像を対応付けた。操作直後の画面は再描画前のことがあるため、先頭NUL・Ctrl+Zは状態を再取得して確定した。

## 4. cmk移動・パス解決

`analysis/results/cmk-paths/` に専用の`old`、`moved`、`other`ディレクトリを用意した。ユーザーの既存ソースは移動・削除していない。生成時のCASLは`moved`だけに存在し、`old`には存在しない。

### 記録された絶対パスが不在

[missing-absolute.cmk](../analysis/results/cmk-paths/moved/missing-absolute.cmk) は、`old/pathmain.cas`等の絶対パスを保持し、実ファイルはcmkと同じ`moved`に置いた。cmk一覧の読込自体は成功したが、アセンブルを選ぶと原アプリのプロセスが終了した。再起動直後にも同条件で再現し、WCASL2のプロセスとウィンドウがなくなったことを別々に確認した。

元のファイル読込ルーチン`004081D0`は、`004081F0`で`fopen(path,"rb")`を呼び、戻り値を検査せず`004081FA`の`fgetc`へ渡す。開く処理だけを失敗へ置換したプローブでも`fgetc(NULL)`まで到達した。[missing_cmk_file_20261027.json](../analysis/results/missing_cmk_file_20261027.json) に引数を記録。

終了の直接のWindows例外コード・クラッシュダンプは取得していない。イベントログの読取はこの環境では許可されなかった。静的なNULL検査欠落と元呼出コードのプローブは、実機での終了と整合する根拠だが、ダンプによる例外位置の断定とは区別する。

### 相対パスとカレントディレクトリ

同じ3ファイルを相対パスで記録したcmkは、ファイルダイアログで`moved/relative.cmk`を開いた直後は正常にビルドできた。その後`other/change-directory.cas`を開き、ファイルダイアログを再度開かず元のcmkウィンドウを選んでビルドすると、プロセスが終了した。

元のローダーは保存されたパスをそのまま`fopen`へ渡す。以上から、相対パスはcmkディレクトリへ固定されず、プロセスのカレントディレクトリに依存すると判断できる。ファイルダイアログの操作順まで互換性へ影響する。

証拠: [3ファイル成功](../analysis/results/ui-20261027/cmk-relative-three-success.png)、[別フォルダを開いた状態](../analysis/results/ui-20261027/cmk-other-directory-opened.png)、[終了後のウィンドウ不在](../analysis/results/ui-20261027/cmk-relative-after-other-no-window.json)。

## 5. cmk保存先と3ファイルの順序不整合

相対パスcmkの内部+50には、意図的に旧保存先`old/project.cmk`を記録していた。実際に開いたのは`moved/relative.cmk`で、ウィンドウのタイトルも後者だった。

3番目の`paththird.cas`をメインに設定して「保存」ボタンを押すと、**movedのファイルは変わらず、old/project.cmkが新規作成された**。内部+50をそのまま保存先に使っており、表示中の文書パスとは独立している。これは「保存」ボタンの経路の確認であり、すべてのメニュー保存・名前を付けて保存まで同じとは断定しない。

保存結果には、次のずれがあった。

| 順位 | UI・保存表示名 | 保存パス |
|---|---|---|
| 1 | paththird.cas | paththird.cas |
| 2 | pathmain.cas | pathsub.cas |
| 3 | pathsub.cas | pathmain.cas |

UIは選択行を削除して先頭へ挿入するが、内部のパス配列は先頭と選択位置を交換する。`0040B830`以降と`0040B2B0`の転記処理で、この差が説明できる。2ファイルの場合は同じ順序になるため、前回の2ファイル試験では発見できなかった。

[変更前cmk](../analysis/results/cmk-paths/relative-before-main.cmk)、[実際の保存結果](../analysis/results/cmk-paths/relative-after-main.cmk)、[デコード結果](../analysis/results/cmk_reorder_20261027.json)を保存。実保存の182バイトは、デコードしたフィールドを元シリアライザへ与えて全バイト一致した。

## 6. Rust移植への反映

- ディスクOUTは単なる`Vec<u8>`書込みと区別し、NULによる途中終端と、Windowsテキスト出力の改行を互換層で扱う。
- BackspaceはCPU状態だけの復元と外部ファイル処理を分ける。原版の再Open・再出力・内容残存を比較可能にする。
- プロジェクトには「現在開いたパス」と「cmk内の記録パス」を別フィールドとして保持する。既存cmkを読み込んだだけで後者を捨てない。
- 欠損ファイルによるアプリ終了は診断へ置き換える。失敗条件の互換性とプロセスの安全性を分ける。
- ファイルの表示名とパスを組で管理し、UIでの順序変更では組ごと動かす。旧cmkに既にある不一致を、読み込んだだけで勝手に修復しない。元のフィールドを保持し、明示的な修復・互換エクスポートの扱いを設計する。

## 7. 再実行・残件

```powershell
python analysis/prepare_cmk_paths.py
python analysis/probe_missing_cmk_file.py
# UI試験と各時点での capture_native_file.py の呼出しを実施
python analysis/audit_native_20261027.py
python analysis/verify_artifacts.py
```

`prepare_cmk_paths.py`は試験入力の生成用で、実機保存後のファイルとは別工程。監査だけを行う際に再生成する必要はない。UI操作は自動プローブとして再実行されない。

残件は、出力先切替・I/Oエラー・長い出力、複数INでのNUL/Ctrl+Z後のストリーム位置、cmkの他保存経路・4ファイル以上の並べ替え・破損データ、手動編集をまたぐBackspaceなど。今回の確認結果を全I/O経路の完全復元とはしない。
