# GitHub Releasesでの配布

現在はWindows x64のNSISインストーラーを配布します。コード署名とアプリ内の更新機能は含みません。配布物は`--release`相当の最適化ビルドで、従来の`target/debug`のEXEとは別です。

## 初回のGitHub設定

1. `.github/workflows/release.yml`を含む変更をコミットし、GitHubへpushします。
2. リポジトリのSettings → Actions → GeneralでActionsの実行を許可します。組織の制限がある場合は、このworkflowが使うActionも許可してください。
3. `dev`を通常の作業先、`main`をリリース対象とします。必要なら`git switch -c dev`で作成して`git push -u origin dev`で公開します。
4. Settings → Rules → Rulesetsでmainへの直接pushを制限し、PRと`check`ジョブの成功を必須にする運用を勧めます。初回のActions実行後にチェック名を選択できます。

通常は追加のSecretsやPersonal Access Tokenは不要です。Release作成ジョブだけに`contents: write`を与え、GitHubが用意する`GITHUB_TOKEN`を使用します。組織ポリシーで書き込みが制限されている場合は管理者側で調整してください。

## 通常のリリース手順

バージョンはMAJOR.MINOR.PATCHの安定版形式に揃えます。最初のバージョンは`0.1.0`です。初回から上げる必要はありません。次回の例:

```powershell
# devで変更を完成させてから
npm run version:set -- 0.1.1
npm run version:check
git diff
git add package.json package-lock.json Cargo.toml Cargo.lock src-tauri/tauri.conf.json
git commit -m "Release 0.1.1"
git push origin dev
```

`version:set`はnpm・Tauri・Cargoとそれぞれのロックファイルを同時に更新します。「ヘルプ → xCASL2について」にはデスクトップアプリ自身のバージョンが表示されます。ブラウザプレビューではpackage.jsonのバージョンを使います。

GitHubでdev → mainのPRを作り、Actionsの成功を確認してマージします。続いてローカルのmainを更新し、タグを付けます。初回は下記を`v0.1.0`に読み替えてください。

```powershell
git switch main
git pull --ff-only origin main
npm run version:check
git tag -a v0.1.1 -m "xCASL2 0.1.1"
git push origin v0.1.1
```

タグはmainに含まれるコミットに付けてください。設定とタグのバージョンが違う場合、またはmainに含まれないコミットの場合、Releaseは作成されません。

## Actionsの動作

| きっかけ | 実行内容 |
| --- | --- |
| dev・mainへのpush、これらを対象とするPR | バージョン照合、エディター試験、Rustワークスペース試験、フロントエンドのビルド |
| vから始まるタグのpush | 上記に加え、タグ照合、mainへの所属確認、Windows x64インストーラーのビルド、SHA256作成、Release下書き作成 |
| Actions → Run workflow | チェックのみ。Releaseは作成しません |

下書きのAssetsには`xCASL2_v0.1.1_windows-x64-setup.exe`と`SHA256SUMS.txt`が入ります。同じファイルはActionsのArtifactsにも保存されます。実際のアプリ・インストーラーのバージョンは`0.1.1`です。

失敗した実行はActions画面からRe-runできます。すでに同じタグの下書きがあれば成果物を更新します。公開済みReleaseの上書きは拒否します。公開したタグを移動せず、修正は次のバージョンとして配布してください。

## 下書きから公開する

1. GitHubのReleasesで下書きを開き、変更点・既知の制限・対応OSを確認します。
2. Assetsのインストーラーをダウンロードし、起動、CASの編集・保存、シミュレーター、前バージョンからの上書きインストールを確認します。
3. 別PCやクリーンなWindows環境でWebView2の導入も確認します。インストーラーは通常、現在のユーザー向けに導入し、日本語・英語を選択できます。
4. 署名なしの配布であることをRelease本文に明記します。
5. 問題なければ「Publish release」で公開します。自動更新はないため、利用者は新しいインストーラーをダウンロードして更新します。

公開前にライセンス文書、依存ライブラリの表記、同梱ファイルの配布可否も確認してください。

## ローカルでの生成

```powershell
npm ci
npm run tauri -- build --bundles nsis -- --locked
```

生成先は`target/release/bundle/nsis/`です。初回はNSISなどのビルド用ツールのダウンロードにネットワーク接続が必要です。

参考: [TauriのGitHub Actionsガイド](https://v2.tauri.app/distribute/pipelines/github/)、[Windowsインストーラー](https://v2.tauri.app/distribute/windows-installer/)。
