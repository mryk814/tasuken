# 開発環境の正本

ユーザーが選んだcheckoutを編集・Gitの作業先とし、開始時にbranch・未commit変更を確認する。
別のcheckoutを使う検証では、対象commitを照合してから実行する。

## 標準ルート

| 役割                            | 正本                                                                |
| ------------------------------- | ------------------------------------------------------------------- |
| 編集・Git・通常の依存管理       | ユーザーが選んだcheckout。OSを理由に別のcloneへ自動的に切り替えない |
| test・CI・自動Electron smoke    | 作業先と同じ変更を含み、そのOS用の依存を導入したcheckout            |
| 日常の対話的UI確認              | 作業先で検証用userDataを指定して起動する                            |
| commit済みSHAの独立した実動確認 | 必要に応じて専用Windows runtime cloneへ同期して起動する             |
| package・release                | GitHub ActionsのWindows x64 runner                                  |

Windows runtime cloneは編集場所ではない。
未commit変更を置かず、Windows専用`node_modules`と検証用userDataだけを持つ。
通常のWindows checkoutや他のAIが作業中のworktreeをruntimeとして流用しない。

## 日常のWindows開発

初回は `rtk npm ci`、起動前診断は `rtk npm run doctor:desktop` を使う。
Node/npm、Electron、native moduleはWindows用を同じcheckoutへ導入する。

対話的な検証では、PowerShellで専用の保存先を指定してから起動する。

```powershell
$env:TASKEN_DEV_USER_DATA_DIR = Join-Path $env:LOCALAPPDATA 'TaskenDevRuntime\interactive-user-data'
rtk npm run dev
```

通常起動のプロファイル、実データ、同期先を検証に流用しない。
自動smokeは既存runnerが用意する一時userDataを使う。
チェックの選び方は `AGENTS.md` のTestingに従う。

## WSLでの補助検証

WSL checkoutのbranch・commit・未commit変更を確認し、検証対象と一致させる。
WSLを使うことだけを理由に普段の編集先を移したり、Windowsの依存を共有したりしない。

初回だけ依存を入れる。

```bash
npm ci
```

起動前診断を実行する。

```bash
npm run doctor:desktop
```

診断を含めてTaskenを起動する。

```bash
npm run dev:wsl
```

`npm run dev`も同じ診断付き起動を使う。
WSLではXWaylandを明示し、GPUを無効化してElectronを起動する。
別のOzone backendを検証するときだけ`TASKEN_OZONE_PLATFORM`を指定する。

```bash
TASKEN_OZONE_PLATFORM=wayland npm run dev:wsl
```

`npm`自体がNodeより先に失敗する場合は、npmを介さずdoctorを実行する。

```bash
node scripts/desktop-dev-doctor.mjs
```

doctorは次を検査する。

- Node、npm、Electronが同じOS向けか
- WSL2か
- WSLInteropが登録されているか
- WSLgのsocketへ接続できるか
- Westonが0×0ではないmonitorを持つか
- 同じcheckoutのTaskenが二重起動していないか
- staleなElectron SingletonLockがないか

エラーが一つでもある場合、Electronを起動しない。
「プロセスだけ残り、画面がない」状態を正常起動として扱わない。

## WSLgが壊れた場合

doctorが`WSLgの画面サイズが0×0`、`WSLgの画面ソケットへ接続できません`、または`WSLInteropが登録されていません`を出した場合、Taskenの再起動では復旧しない。

1. WSL内の開発サーバー、テスト、計算、Codex作業を終了する。
2. Windows PowerShellで稼働状況を確認する。
3. 停止してよいことを確認してから`wsl --shutdown`を実行する。
4. Ubuntu-24.04を起動し直し、`npm run doctor:desktop`を再実行する。

`wsl --shutdown`は全distroとWSLgを停止する。
doctorや起動スクリプトから自動実行しない。

## commit済みSHAをWindows runtime cloneで確認する

Windows checkoutのルートで、PowerShellから次を実行する。

```powershell
rtk powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/run-windows-runtime.ps1
```

スクリプトは次を行う。

1. 呼び出し元checkoutがcleanで、commit済みSHAを持つことを確認する。
2. `%LOCALAPPDATA%\TaskenDevRuntime\source`を専用cloneとして作成または更新する。
3. runtime cloneがcleanであることを確認し、同じSHAをdetached HEADでcheckoutする。
4. Windows側で`npm.cmd ci`を実行し、Windows用Electronとnative moduleを用意する。
5. `%LOCALAPPDATA%\TaskenDevRuntime\user-data`を指定してTaskenを起動する。

Sourceまたはruntimeに未commit変更があれば停止する。
自動stash、reset、clean、既存checkoutの上書きは行わない。

依存の再インストールを省く場合だけ`-SkipInstall`を指定する。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "...\run-windows-runtime.ps1" -SkipInstall
```

## 検証の分担

- `rtk npm run ci`: merge前の品質ゲート。
- Windowsの`rtk npm run dev`: 隔離userDataで日常のレイアウト・入力・導線とWindows固有機能を確認。
- Windows runtime clone: commit済みSHAでtray、global shortcut、clipboard、screen recording、Windows file dialogなどを独立して確認する場合に使う。
- WSLgの`npm run dev:wsl`: WSL固有の表示・入力に変更がある場合の補助検証。
- GitHub Actions: Windows package、packaged smoke、release artifactの正本。

自動testが通っても、操作対象が見えない、選択範囲が分からない、Windows固有機能を未確認、のいずれかが残る場合は実動確認完了にしない。
