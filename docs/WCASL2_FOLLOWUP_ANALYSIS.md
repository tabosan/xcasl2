# WCASL2 未確認事項の追加解析

解析日: 2026-10-26。対象EXE・根拠区分は [詳細互換仕様書](WCASL2_COMPATIBILITY_SPEC.md) と同じ。

本書は2026-10-26時点の記録。翌日の [実ファイルI/O・cmkパスの追加解析](WCASL2_NATIVE_IO_AND_PATHS.md) で、実ディスクの改行・書出し・巻き戻し、NUL/Ctrl+Z、cmk移動・保存・3ファイルの不整合を追加確認した。本書の「未測定」は当日時点の制約を示す。

## 1. 今回確認できたこと

| 項目 | 結果 | 根拠 |
|---|---|---|
| 長い行の診断・復帰 | 200バイトのコメント行は成功。201/255/256は「1行が長すぎます．」で中止し、編集・再アセンブル可能 | U |
| 空行と改行 | 54ケースでCRLF/LFの結果が一致。END前の空行はエラー、END後の空白は受理 | E |
| END後のコメント | コメントだけでも残りを別プログラムとして処理し「ENDがありません．」 | E |
| INを含む巻き戻し | 再実行がINを通ると入力を再要求する。新しい入力がメモリとLENに反映 | U/E |
| OUTを含む巻き戻し | 画面を消去して再出力する。SVC前まで戻すと該当出力は消える | E |
| RPUSH/RPOP | 展開後14命令を通し、1命令ずつ先頭まで戻せる。SPも各段階で復元 | E |
| ファイルOUTの再実行 | Close→Open(5001)→Writeを再発行。最初のOUTより前へ戻しただけでは再Openしない | E/S |
| ファイルOUTのNUL | A・NUL・Bを出すと、元のWriteString/fputsはfwriteへAの1バイトだけを渡す | E/S |
| ファイルINの末尾空白 | 元のTrimRightが末尾の空白・タブ・CR/LFを除去し、その後256バイトに制限 | E/S |
| cmkの実保存 | UI保存2例をデコードし、元のシリアライザで全バイト一致 | U/E |
| cmkのメイン指定 | 選択ファイルを先頭へ移し、メインのパスも更新 | U |
| 相対パスcmk | ファイルを同じディレクトリに置き、開くダイアログ経由で読み込んでビルド成功 | U |
| 保存設定の場所 | この環境ではVirtualStore配下のWcasl2.INI、[wcasl-ii] | ファイル実読取/S |

## 2. 行長の実機試験

`MAIN START`、`;`+ASCIIのx、` RET`、` END` の4行を使用。長さは改行を除いたコメント行のバイト数。201バイトのファイルを開き、同じ編集バッファを200/255/256へ変更して再アセンブルした。タイトルの`line_201.cas`は各試験の行長を意味しない。ディスク上の元のfixtureは変更していない。

200では「アセンブルエラーは ありません．」「ｴﾗｰはありません．」。201/255/256では「1行が長すぎます．」「ｱｾﾝﾌﾞﾙｴﾗｰが生じましたので，ｱｾﾝﾌﾞﾙﾘﾝｸを中止します．」。201の失敗後に200へ直して成功したので、例外がアプリ全体の異常終了を意味しないことも確認できた。

証拠: [200成功](../analysis/results/ui-followup/line-200-success.png)、[201中止](../analysis/results/ui-followup/line-201-abort.png)、[255中止](../analysis/results/ui-followup/line-255-abort.png)、[256中止](../analysis/results/ui-followup/line-256-abort.png)。日本語を含む行長のUI境界と極端な長さは別途試験が必要。

## 3. 空行・末尾処理54ケース

元のソース分割→アセンブル→リンクを通した。CRLF/LFそれぞれ27ケース。入力と全診断は [followup_boundaries.json](../analysis/results/followup_boundaries.json)。

| 配置 | 空行・空白だけ・タブだけ | コメント・空白+コメント |
|---|---|---|
| MAIN STARTより前 | 命令コードエラー | 成功 |
| MAIN STARTとRETの間 | 命令コードエラー | 成功 |
| RETとENDの間 | 命令コードエラー | 成功 |
| ENDより後 | 成功 | END不足エラー |

END直後の改行なし、改行1/2/3個、末尾の空白も成功した。コメントの可否は行だけのパーサでは判断できず、プログラム分割後に残ったソースの扱いまで移植する必要がある。複数プログラムの間の全配置、CRのみ、NULやDBCSとの組合せまで網羅した試験ではない。

## 4. 巻き戻しとI/O

原コード`0040D260`は`0040CD90`で再初期化し、STEP回数を1減らした位置まで`0040C300`で再実行する。入力の結果を保存して再利用する経路は今回のキーボードINにはなかった。

実機の [ui_replay.cas](../analysis/fixtures/ui_replay.cas) では次を確認した。

| 操作後 | PR | SP | BUF先頭 | LEN |
|---|---|---|---|---|
| AAを入力しSVC完了 | 002A | 013A | 0041 0041 | 0002 |
| 次のPOP GR2完了 | 002B | 013B | 0041 0041 | 0002 |
| Backspace→再入力BBB→復帰 | 002A | 013A | 0042 0042 0042 | 0003 |
| さらにBackspace | 0028 | 013A | FFFF FFFF FFFF | FFFF |

証拠: [初回AA](../analysis/results/ui-followup/in-aa-service-complete.png)、[巻き戻し中の入力要求](../analysis/results/ui-followup/in-back-requests-input.png)、[BBBで復帰](../analysis/results/ui-followup/in-back-bbb-complete.png)、[SVCより前](../analysis/results/ui-followup/in-back-before-service.png)。

自動試験は [followup_replay.json](../analysis/results/followup_replay.json) の5シナリオ。OUTの再描画、INのK1→K2→K3という再要求、RPUSH/RPOP全展開、ファイルOUT再オープン、NULの出力経路を採取した。再ロード部分だけを元のリンク済みイメージのコピーへ置換し、UI・ダイアログ・ファイルの最終受け口を模擬した。STEP・Backspace・SVC・画面バッファ処理は元コード。ファイル出力では元のCStdioFile::WriteStringとfputs、strlenも通し、最終fwriteだけを受け取っている。CString確保・連結とCRTのロック・バッファ準備はハーネスが補助する。

ファイル出力を2回した後の巻き戻しでは、再実行にOUTが含まれる間はClose→Open(5001)→Writeが繰り返される。最初のOUTより前へ戻ると、Closeだけで再Open・再Writeがなく、試験用ファイル受け口には最後の内容が残る。従って「巻き戻した時点の出力ファイルへ常に復元される」という仕様にしてはいけない。実ディスクでの切詰め、バッファflush、CRLF変換は未測定。

画面OUTではSVC後の状態へ戻すと出力ABが再生成され、SVC前へ戻すと空になる。RPUSH7命令でSPは187→180、RPOP7命令で187へ戻り、巻き戻しでも同じ途中状態を再現した。この187は当該fixtureの初期SPであり、固定値ではない。

### ファイルINの追加仕様

[followup_file_input.json](../analysis/results/followup_file_input.json) は、ReadStringの戻り文字列だけを模擬した9ケース。元の`00425425`によるTrimRight、その後の`0040ECE1`の長さ検査と書込みを実行した。

`' ABC  '`は先頭空白を残してLEN=4、`'A\t'`および`'A\r\n'`はLEN=1、空白だけはLEN=0。257個のAは256語になり、次の語は元のCCCCを保持。EOFはLEN=FFFF。ファイルINとキーボードINに共通のtrimを適用しない。ネイティブReadString自体の埋込NUL・Ctrl+Z・文字コード処理は別の未確認項目。

## 5. cmkのフィールド確定

実機保存例: [メイン変更前339バイト](../analysis/results/native-project-before-main.cmk)、[変更後343バイト](../analysis/results/native-project.cmk)。

| 内部フィールド | UIでの意味 |
|---|---|
| +F8 | ファイル数、今回は2 |
| +50 | 保存先cmk自身のパス |
| +54 | メインCASLファイルのパス |
| +A8+4i | i番目のCASLファイルのパス |
| +58+4i | 一覧表示のファイル名 |

日本語の表示名・パスはCP932。baseline.casを先頭、次に副プログラム.casとして保存後、後者をメインへ変更した。順序と+54の両方が更新された。デコード結果を元の`0040AB50`へ戻すと339/343バイト全体が一致した。合成81バイトの旧試験も一致。[followup_cmk.json](../analysis/results/followup_cmk.json) に全フィールドとhexを記録。

相対パスだけの合成cmkを作り、同じフォルダのCASL2ファイル2本でビルド成功した。ただしファイルダイアログで当該ディレクトリを開いた条件での確認であり、プロセスのカレントディレクトリを変えた後もcmk基準で解決するとは断定しない。保存先変更時のパス再計算、元CASLを消して移動先だけ残す試験、破損cmkのUI復帰は未確認。

## 6. 設定ファイル

この実機環境では`C:\Users\tabos\AppData\Local\VirtualStore\Windows\Wcasl2.INI`を確認。`[wcasl-ii]`に`baseaddress=32`、`loadmode=1`、`intervaltime=1`があった。[followup_settings.json](../analysis/results/followup_settings.json) はこの節だけを保存し、最近使用したファイル等の他節は含めていない。

元コードの`004411D7`と`004371D3`にはGet/WritePrivateProfile系の経路があり、MFCのプロファイル名は実行ファイル名から`.INI`を作る。この環境の保存場所を全OS・全ユーザーの固定パスとはしない。移植時は実行ファイル名、Windows配下の従来INI、VirtualStoreを候補とし、見つからない場合に勝手な設定値を読み込まない。

## 7. 再実行と残件

```powershell
python analysis/probe_followup.py
python analysis/probe_file_input.py
python analysis/inspect_cmk.py
python analysis/audit_followup.py
python analysis/verify_artifacts.py
```

UI試験は自動プローブとは別。`inspect_cmk.py`は今回UI保存した2例を必要とし、相対パス用fixtureを再生成する。実機での入力・出力ファイルのバイト照合、cmk移動後のカレントディレクトリ依存、手動変更後の巻き戻し、無初期化ロードモード、STEP粒度変更をまたぐ巻き戻しなどは [残る検証項目](WCASL2_REVERSE_ENGINEERING.md#10-残る検証項目) を参照。
