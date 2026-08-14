# 開発環境の正本

Taskenはコードの正本と実行環境を分ける。
編集場所を複数にせず、同じcommitを用途に合うruntimeで検証する。

## 標準ルート

| 役割 | 正本 |
|---|---|
| 編集・Git・通常の依存管理 | WSL2のext4上にある `/home/<user>/src/tasuken` |
| test・CI・自動Electron smoke | WSL2。画面はXvfbを使う |
| 日常の対話的UI確認 | 同じWSL checkoutをWSLgで起動する |
| Windows固有の実動確認 | commit済みSHAを専用Windows runtime cloneへ同期して起動する |
| package・release | GitHub ActionsのWindows x64 runner |

Windows runtime cloneは編集場所ではない。
未commit変更を置かず、Windows専用`node_modules`と検証用userDataだけを持つ。
通常のWindows checkoutや他のAIが作業中のworktreeをruntimeとして流用しない。

## 日常のWSL開発

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

## Windows固有の実動確認

Windows PowerShellから、WSL正本にあるスクリプトを実行する。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "\\wsl.localhost\Ubuntu-24.04\home\<user>\src\tasuken\scripts\run-windows-runtime.ps1"
```

スクリプトは次を行う。

1. WSL正本がcleanで、commit済みSHAを持つことを確認する。
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

- WSLの`npm run ci`: merge前の正本ゲート。
- WSLgの`npm run dev:wsl`: 日常のレイアウト・入力・導線確認。
- Windows runtime clone: tray、global shortcut、clipboard、screen recording、Windows file dialogなどのWindows固有確認。
- GitHub Actions: Windows package、packaged smoke、release artifactの正本。

自動testが通っても、操作対象が見えない、選択範囲が分からない、Windows固有機能を未確認、のいずれかが残る場合は実動確認完了にしない。
