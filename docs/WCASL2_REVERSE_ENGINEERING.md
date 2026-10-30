# WCASL2 解析ノート・証拠・再実行方法

対象ハッシュは仕様書冒頭に記載。本書のVAはImageBase `00400000` に基づく32ビット仮想アドレス。実ファイルオフセットと混同しない。

## 1. 実施した解析

1. SHA-256とWindows版情報を取得。
2. PEのセクション、インポート、RTTI、リソースを抽出。
3. メニュー、アクセラレータ、通常・拡張ダイアログ、文字列テーブルをデコード。
4. Capstoneによるx86逆アセンブルを保存。
5. RTTIからCPU、メモリ、アセンブラ等のクラスとvtableを関連付け。
6. 元のx86ルーチンをUnicornで実行し、CPU・アセンブラ・リンク・入出力・パイプラインを調査。
7. 実機を起動し、編集→アセンブル→CASL/COMET表示、Enter、Backspace、設定画面を観察。

ソースコードを復元したわけではない。アドレス・分岐・定数・入力出力から仕様を抽出した。

## 2. 生成物の索引

| パス | 内容 |
|---|---|
| `analysis/static/pe.json` | PE構造、セクション、インポート |
| `analysis/static/resources.json` | 88件のリソース目録 |
| `analysis/static/ui_resources.json` | メニュー、ダイアログ、アクセラレータ |
| `analysis/static/resource_strings.json` | 158件の文字列リソース |
| `analysis/static/op_table.json` | 元コードのコンストラクタから抽出した46命令形式 |
| `analysis/static/disassembly.txt` | 実行セクションの線形逆アセンブル |
| `analysis/results/assembler_cases.json` | 単一セクション用アセンブラの構文・定数試験 |
| `analysis/results/build_cases.json` | ソース分割、アセンブル、リンク、ロードまでの試験 |
| `analysis/results/cpu_cases.json` | 1,420件の元の命令処理本体の状態 |
| `analysis/results/pipeline_cases.json` | フェーズ・最小STEPの遷移11件 |
| `analysis/results/io_cases.json` | 模擬キーボード入力と画面バッファ出力10件 |
| `analysis/results/cmk_case.json` | 元のcmkシリアライザから得た合成例の内容と実バイト |
| `analysis/results/synthetic-archive.cmk` | 合成cmk例。実ユーザーのプロジェクトではない |
| `analysis/results/audit_summary.json` | 試験数、ハーネス制限、参考演算との比較集計 |
| `analysis/results/ui/` | 実機の一部画面とアクセシビリティ文字列 |
| `analysis/results/followup_*.json` | 追加54境界ケース、巻き戻し5シナリオ、ファイルIN9ケース、cmk照合、設定と監査 |
| `analysis/results/ui-followup/` | 長い行、cmk実保存、相対パスビルド、IN再要求の実機証拠 |
| `analysis/results/native_io_20261027.json` | 実ディスク出力の11チェックポイント |
| `analysis/results/native_20261027.json` | ファイル入力5ケース、cmkパスの実機結果 |
| `analysis/results/cmk_reorder_20261027.json` | 3ファイルでの表示名・パス不整合と旧保存先 |
| `analysis/results/missing_cmk_file_20261027.json` | 元ローダーがfopen失敗をfgetc(NULL)へ渡す引数記録 |
| `analysis/results/ui-20261027/` | 実ファイルI/O、cmk移動・並び替え・終了確認の証拠 |
| `analysis/fixtures/` | CP932の再現用CASLソース |

`strings.json` は探索補助用の候補文字列集。バイナリのバイト範囲によってCP932の文字列が分断されたり、コードが文字列として拾われたりするため、**仕様根拠に使うときはC文字列を改めてデコードした**。抽出候補をそのまま全文検索して完全な日本語メッセージ一覧とみなさない。

## 3. 元コード実行ハーネスの範囲

`analysis/oracle.py` はCASL仮想マシンをPythonで書き直したものではない。次をUnicornのx86メモリへマップする。

- EXEのイメージとゼロ領域。
- ホストCPU用スタック。
- 模擬ヒープ、MFCオブジェクト、入力・出力用領域。

CPU命令処理、メモリアクセス、アセンブラ、セクション分割、リンク処理は、指定VAから元の機械語を実行する。

実行に必要なMFCの補助処理の一部はPythonで置き換えた。

| 置き換え | 理由・影響 |
|---|---|
| CStringの確保、代入、コピー、連結、空化 | WindowsヒープやMFC固定長アロケータに依存しない領域を用意 |
| CString::Format / wsprintfの使用範囲 | 診断・中間表現の文字列を生成 |
| CStringListの追加・インデックス参照 | 中間アセンブル結果をリンク処理へ渡す |
| MFC文書基底コンストラクタ、ビュー更新、ビープ等 | 表示を伴わない処理に置換 |
| IN試験時のDialog::DoModal | OKまたはEOFと入力バイト列を供給 |

このため、Eの証拠はWindowsアプリ全体のネイティブ実行と同じ強さではない。特にMFCの例外、文字列境界、コードページ変換、ファイルI/O、ダイアログ検証の完全再現はしない。

全体ビルドでは、元のCAsmDocが生成する中間テキストを元のリンク処理が読み直す。単一セクション試験では、この中間テキスト生成の最終段階を省略している。

`probe_error` は**解析ハーネス側が結果を得られなかった**ことを示す。WCASL2のユーザー向けエラーとは区別する。特に長い行でのRaiseExceptionや命令数制限到達を、旧アプリのクラッシュや拒否結果として数えない。

## 4. CPUの検証強度

境界値 `0000,0001,0002,7FFF,8000,FFFE,FFFF` の組合せを中心に、ロード、符号付き/符号なし加減算、論理演算、比較、シフト、分岐、スタックを調査した。

このうちLD・算術・論理・比較の980件は、独立に書いた通常の16ビット演算式とGR1・FRを比較し、差は0件だった。これは符号・桁あふれ実装の読み違いを検出するための補助検査であり、全命令・全入力・全UIの互換性証明ではない。

シフト量は0、1、2、14、15、16、17、31、32、33、255、65535を採取。規格上の一般論をそのまま期待値にせず、元コードの結果を互換オラクルとした。

`probe_cpu.py` は命令実行フェーズの本体を直接呼ぶ。PRのフェッチ更新やデコードを含む完全な1命令は `probe_pipeline.py` で別に確認した。両者のPR値を同じ期待値と扱わない。

## 5. 主なコード位置

| VA | 解析上の意味 |
|---|---|
| `00402C70` | 2語のメモリ書き込み、有効先頭範囲の検査 |
| `00402CA0` | 1語書き込み、3000語範囲外は無視 |
| `00402CC0` | 1語読み込み、範囲外FFFF |
| `00402CE0` / `00402CF0` | 3000語の0 / FFFF初期化 |
| `00402DB0` | CAsmDoc構築 |
| `00403550` | アセンブラ作業状態のリセット |
| `004035C0` | アセンブル結果の中間テキスト生成 |
| `00403920` | 中間テキストの読み戻し |
| `00403FE0` | 単一セクションのアセンブル本体 |
| `00404630` | 元ソースからの行取得、CR/LF処理 |
| `00404EE0` | IN/OUT展開処理の周辺 |
| `00405120` | RPUSH/RPOP展開処理 |
| `004051B0` | DC処理 |
| `00405720` | DS処理 |
| `00405880` | ラベル登録・検査 |
| `00405B78` | ラベル長・文字検査の不具合を確認した箇所 |
| `004062E0` | 行診断の整形 |
| `00406520` | 行の前処理・分割 |
| `0040657E` | 行長200との比較 |
| `00406809` | 行長超過の例外送出側 |
| `00406EC0` | 単一ファイルのセクション分割→アセンブル→リンク全体 |
| `00407210` | リンク配置・メモリ転送の周辺 |
| `00407460` | 再配置・グローバル登録の周辺 |
| `00407890` | メイク文書からのビルド経路 |
| `00407D30` | リンク本体 |
| `00408280` | ソースをEND単位に取り出す処理 |
| `004096F0` | CCPU構築 |
| `00409780` / `004097C0` | CPUの0 / FFFF系初期化 |
| `004098A0` | Displayのリセット |
| `004098F0` | Displayへの1バイト追加、44桁・12行 |
| `0040A570` | キーボード入力のDDX/DDV、128指定 |
| `0040AB50` | CMakeDocのCArchive保存・読込 |
| `0040BC20` | シミュレータ初期状態、SP設定など |
| `0040C2A0` | STEP実行コマンドの周辺 |
| `0040C300` | 選択したSTEP粒度による実行 |
| `0040C410` | 最小STEP/フェーズSTEPの分岐 |
| `0040C480` | 1機械語命令の完了まで進める処理 |
| `0040C600` | 取出マイクロステップ |
| `0040C7D0` | 解読マイクロステップ |
| `0040C990` | アドレス生成マイクロステップ |
| `0040CA90` | 実行フェーズの進行 |
| `0040CB50` | opcodeによる命令実行ディスパッチ |
| `0040D260` | 戻る操作: 初期状態からSTEP数に応じて再実行 |
| `0040E060` | シフト本体、x86のシフト量マスクの影響 |
| `0040E520` / `0040E680` | CALL / 内部RET |
| `0040E7A0` | 出力サービス |
| `0040EA10` | 入力サービス |
| `0040ECE1` | ファイル入力長と256の比較 |
| `00415920` | 命令テーブル構築 |
| `00416020` | 診断テーブル構築 |
| `00416759`付近 | baseaddress=0020、loadmode=1、intervaltime=2の読込フォールバック |
| `00430214` | CArchiveへのANSI CString保存 |
| `0043028D` | CArchive文字列長の読込 |

線形逆アセンブルの途中にはジャンプテーブル等のデータが含まれる。`disassembly.txt` の全行が実命令とは限らない。関数境界をまたぐ断片やテーブルを逆アセンブルした表示から、動作を断定しない。

## 6. オブジェクト内レイアウト

移植コードのABIとして固定するためではなく、証拠追跡のための情報。

### CCPU

| 相対位置 | 内容 |
|---|---|
| +04〜+12 | GR0〜GR7、各16ビット |
| +14 | SP |
| +16 | FR |
| +18 | PR |
| +1A / +1C | IRの第1 / 第2語 |
| +20 | CDecoderオブジェクト先頭 |
| +24 / +26 / +28 / +2A | opcode / r / x / adr |
| +2C / +2E / +30 | MAR / MDR / 実効アドレス相当 |
| +32 / +34 | 割り込み関連状態の候補。全意味は未確定 |
| +38 | メモリオブジェクトへの参照 |

主要なグローバル実体はCCPU=`00586348`、実行メモリ=`00586388`、Display=`00586120`、命令テーブル=`00587B40`。

### CSimDoc

| 相対位置 | 内容 |
|---|---|
| +50 / +54 / +58 | メモリ / CPU / Display参照 |
| +270 | STEP粒度0〜4 |
| +274 | 現在フェーズ0〜3、終了FFFFFFFF |
| +278 | フェーズ内の最小STEP番号 |
| +27C | 時間実行間隔 |
| +284 | 指定停止アドレス |
| +288 | 表示種別 |
| +28C | CALL深さ |
| +290以降 | 入出力ファイル等 |
| +2CC | STEP履歴の回数管理 |
| +2DC以降 | データパスの強調表示用フラグ群 |

## 7. cmkの文字列符号化

元の `00430214` はANSI CStringを次のように書く。

```text
length < 255:
    u8 length
255 <= length < 65534:
    FF + u16_le length
length >= 65534:
    FF FF FF + u32_le length
followed by length bytes (no terminating NUL)
```

読込ルーチンには `FF FE FF`（先頭FF、word FFFE）のUnicode判別用経路もある。今回のシリアライザが通常のcmk保存でUnicodeを出力することは確認していない。

元のCMakeDoc保存ルーチンへ2ファイル分の合成データを与えると、81バイトが生成された。`cmk_case.json` には入力フィールドと全バイトを保存。日本語ファイル名「副」はCP932 `95 9B` となった。

追加解析でUI保存した339/343バイトのcmkを比較し、元のシリアライザで全バイト一致した。+50は記録された保存先、+54はメインのCASLパス、+A8側は各CASLパス、+58側は表示名。2026-10-27には、欠損絶対パス・カレントディレクトリ変更後の終了、旧保存先への保存、3ファイルの名前とパスの不整合も実機確認した。詳細は [実ファイルI/O・パスの追加解析](WCASL2_NATIVE_IO_AND_PATHS.md)。破損データの全経路は残件。

## 8. 実機で保存した証拠

| 画像・テキスト | 確認内容 |
|---|---|
| `load-mode.*` | ロード先0020、-1初期化の選択 |
| `blank-line-assembly-error.*` | 空行を含むソースでの命令コードエラー。Eの結果と整合 |
| `comet-initial.*` | COMETのデータパスと初期PR/SP/GR/FR |
| `comet-first-step.*` | 最小STEP後のPR→MAR強調 |
| `comet-step-options.*` | 5種類のSTEP粒度 |
| `casl-initial.*` / `casl-after-lad.*` | CASL画面の初期状態とLAD後 |
| `casl-before-out.*` / `casl-out-first-expanded-instruction.*` | OUTのEnter1回は展開後PUSH1命令だけを実行 |
| `casl-back-before-out.*` | マクロの最初のPUSHからBackspaceで戻る |

画像には高DPIの見切れが含まれる。スクリーンショットは製品UIの再実装に使う視覚資料であり、読めない数値を補完して測定値にしていない。

## 9. 再実行

Python 3と `pefile==2024.8.26`、`capstone==5.0.9`、`unicorn==2.1.4` を使用。今回の依存パッケージは `analysis/vendor` に格納。入力EXEは変更していない。

作業フォルダで、使えるPythonの実体を指定して順に実行する。

```powershell
python analysis/inspect_pe.py
python analysis/decode_resources.py
python analysis/oracle.py
python analysis/probe_assembler.py
python analysis/make_fixtures.py
python analysis/probe_build.py
python analysis/probe_cpu.py
python analysis/probe_pipeline.py
python analysis/probe_io.py
python analysis/probe_cmk.py
python analysis/probe_followup.py
python analysis/probe_file_input.py
python analysis/inspect_cmk.py
python analysis/audit_followup.py
python analysis/probe_missing_cmk_file.py
python analysis/audit_native_20261027.py
python analysis/audit_results.py
python analysis/write_matrix.py
```

コード位置の再確認は次のように行う。

```powershell
python analysis/query.py classes
python analysis/query.py 40e060 40e2a4
```

命令数の上限は解析プロセスの暴走防止用で、旧アプリの実行上限ではない。WindowsのRaiseExceptionと構造化例外処理は未実装。

## 10. 残る検証項目

優先度は移植の互換性リスクによる。

| 優先度 | 未確定項目 | 追加試験 |
|---|---|---|
| 中 | 長い出力・装置変更を越えるBackspace | 短い実出力の切詰め・CRLF・Close・内容残存は確認済み。I/Oエラー、出力先切替、バッファ境界を追加 |
| 中 | cmkの他保存経路 | 欠損パスの終了、相対パスのカレントディレクトリ依存、保存ボタンの旧パス再利用は確認済み。メニュー保存・名前を付けて保存を比較 |
| 中 | 日本語を含む行長と極端に長い行 | ASCIIの200/201/255/256バイト診断・復帰は実機確認済み。CP932境界を追加 |
| 中 | 複数プログラム間の空白・コメント | CRLF/LFの54ケースは確認済み。複数START–END間の配置やNULとの組合せを追加 |
| 中 | マクロと各ロードモードの巻き戻し | IN/OUT/RPUSH/RPOPのE試験とIN再要求のU試験済み。無初期化、STEP粒度変更、手動編集を組み合わせる |
| 中 | レジスタ値・メモリ値の編集全経路 | 無効値、文字、下位語の選択、キャンセル |
| 中 | ラベル・行・メモリ配列の厳密な上限 | 200/201ラベル、2000付近の行、2999/3000語 |
| 中 | 設定ストアの環境差 | 当該実機のVirtualStore/Windows/Wcasl2.INIは特定済み。他OS・実行名・権限による配置差を確認 |
| 中 | 複数INとNUL・Ctrl+Z | 最初のINのNUL/EOF差と、OUTの実ディスクNUL終端は確認済み。次回INのストリーム位置、長い行を追加 |
| 中 | cmkの4ファイル以上・破損入力 | 3ファイルの先頭挿入とパス交換の不整合は実保存で確認済み。別の選択位置、範囲外ファイル数、読込失敗時の復帰を追加 |
| 中 | 重複グローバル名での成功扱い | エラー文後に成功文が出る経路を実機確認 |
| 中 | 異常な機械語のr/x、自己書換え | 全ニブル値、範囲外フェッチ、戻り先不正 |
| 低 | 印刷・プレビュー、最近使ったファイル、DDE | 原版と同程度の操作を残す範囲を決定 |
| 低 | 割り込み・IMRの全モデル | `0040ED40` 以降と画面操作の対応を追加解析 |

上記が残るため、本資料を「全経路100%復元済み」とはしない。一方、命令・アセンブラの主要部分と、互換を壊しやすい多数の固有挙動については、実装と比較に使える具体的な証拠が揃っている。
