# Release

Taskenの配布版はGitHub Releaseで管理する。開発は利用者が選んだcheckoutで行い、Windows向けのnative依存を含む配布物はGitHub ActionsのWindows runnerで作成する。
タグは`vX.Y.Z`、`package.json`の`version`は`X.Y.Z`で一致させる。

## 役割分担

| 場所                        | 実行すること                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| Windows / WSLの作業checkout | `npm run ci`によるtypecheck、test、audit、build、Electron smoke                                |
| GitHub Actions / Windows    | Windows ABIの再構築、NSIS / portable生成、packaged desktop・Activity・live Proposal・MCP smoke |
| GitHub Release              | 利用者が取得するinstaller、portable、SHA-256 checksum                                          |

WSLで`npm run package`または`npm run release:check`を実行すると、Windows配布物を誤ってLinux向けnative moduleで作らないように停止する。

## 通常手順

1. 作業checkoutで`main`を最新化し、リリース用ブランチを作る。

```bash
git fetch --prune --tags origin
git switch main
git pull --ff-only origin main
git switch -c codex/release-vX.Y.Z
```

2. バージョンを更新し、品質ゲートを通す。Androidも公開する場合は`android-app/app/build.gradle.kts`のversionNameとversionCodeを更新する。

```bash
npm version patch --no-git-tag-version
npm ci
npm run ci
```

必要に応じて`patch`を`minor`または`major`に変える。

3. 変更をcommitしてpushし、Pull Requestを作る。Pull RequestではWindows／Android quality workflowが実行される。

```bash
git add package.json package-lock.json
git commit -m "chore: release vX.Y.Z"
git push -u origin codex/release-vX.Y.Z
```

4. PRの品質ゲート成功とmainへのマージを確認し、そのマージcommitでannotated tagを作ってpushする。

```bash
git tag -a vX.Y.Z -m "Tasken vX.Y.Z"
git push origin vX.Y.Z
```

5. `Windows release` workflowが同じタグのcommitをcheckoutし、そのcommitが`origin/main`に含まれることを検証してから、`npm ci` → `npm run release:check`を実行する。packaged appでDebrief Activityを含む実画面smokeまで成功すると、GitHub Releaseが作成または更新される。全test・auditはPull Requestのquality workflowで完了しているため、Releaseでは再実行しない。

手動で再実行する場合は、GitHub Actionsの`Windows release`から`vX.Y.Z`タグを指定する。

Activity smokeは孤立userDataへ代表的な材料研究者の1日を作り、08:00–19:00のカレンダー、range・point、Theme色、AI source chip、詳細、Task編集導線、横方向のclipを確認する。成功時の`activity-packaged.png`（失敗時は`activity-failure.png`）は、GitHub Actionsの`activity-packaged-smoke-vX.Y.Z` artifactから確認できる。

## Release assets

Androidは`Android release signing`をmainの対象commitで手動実行し、恒久署名jobのAPK artifactを取得する。
APKのversionCode・versionName、証明書と既存端末の署名互換を確認し、同じReleaseへ`Tasken-Android-X.Y.Z.apk`とそのSHA-256を追加する。
端末更新はデータを保持する`adb -s <serial> install -r <apk>`で行い、アプリ削除やデータ消去を更新手順に含めない。

GitHub Releaseには通常、以下が添付される。

- `Tasken-Setup-X.Y.Z-x64.exe`
- `Tasken-Portable-X.Y.Z-x64.exe`
- `SHA256SUMS.txt`

Windows runnerの生成先は`release/`だが、このディレクトリはGit管理しない。

## 失敗時

- tag名と`package.json`のversionが違う場合はworkflowが止まる。tagを作り直す前に、どちらが正しいversionか確認する。
- packageまたはpackaged smokeに失敗した場合は、同じcommitでWSLの`npm run ci`を再実行し、Windows runnerのworkflowログでWindows固有の失敗（native module、installer、packaged smoke）を確認する。Activity実画面の失敗はworkflow artifactのスクリーンショットも確認する。
- Releaseが既に存在するタグをworkflow_dispatchで再実行した場合は、同じタグのassetsをchecksumを含めて更新する。
- すでに公開したtagを動かす必要がある場合は、配布済みの利用者に影響するため、force pushせず別versionを切る。
