# Androidのオフライン連続操作検証

`MobileOfflineJourneyTest`は同じTask・Capture・入力draftを二つのinstrumentation processで扱う。
最初のprocessでPCへの通信を切り、Task作成の送信を一度試してから名前・Theme・今日割当・予定・Checklist・完了／再開を保存する。
長文Capture、未保存draft、期限超過から回復した入力も同じfixtureへ残す。
次のprocessではPIDが変わったこととRoom・draftの保持を確認し、接続を戻す。
最初の成功receiptを失わせ、Desktop側のSQLiteを閉じて開き直してから同じcommandを再送する。
最終値、同一ID、原文、送信済みenvelope、重複Create不在、再送後のevent件数を検証する。
失われたTask Createのevent／receiptを再送前後で照合し、別Taskの競合と後続blockedが独立Taskの同期を止めないことも確認する。

Gateway側は`tests/helpers/mobile-offline-gateway.mjs`にある。
実際の`TaskenCoreRuntime.createMobileGateway`、`MobileGatewayHost`、`WorkspaceDatabase`を使う。
障害を入れるのはloopback proxyだけで、端末のネットワーク設定や実PCの電源状態は変更しない。
Desktop DBはOSの一時ディレクトリ、Android DB・preferencesはGatewayごとの固有名を使う。
AIは使用しない。

ビルド済みdebug APKを、作業用として起動したAPI35 emulatorで実行する。
以下のserialはその実行者が所有するemulatorのものへ置き換える。
通常版APK、実ユーザーDB、OneDrive、利用中のFold7は使用しない。

```powershell
rtk .\gradlew.bat :app:assembleDebug :app:assembleDebugAndroidTest
```

上は`android-app`、下はrepository rootで実行する。

```powershell
rtk node scripts/run-electron-node.mjs tests/helpers/run-android-offline-journey.mjs emulator-5556 MobileOfflineJourneyTest#aSaveOfflineInputAndEditsBeforeProcessExit MobileOfflineJourneyTest#bReloadSameInputsAndConvergeAfterLostReceipt --cleanup=MobileOfflineJourneyTest#cCleanupOwnedFixture
```

runnerはemulatorだけを受け付け、loopback専用の`adb reverse`を追加する。
既存の同一portの転送があれば上書きせず失敗する。
終了・失敗時は明示したcleanup test、追加したreverse、proxy、Gateway、一時Desktop DBを片付ける。
cleanup testはこのfixture固有のAndroid DBとpreferencesだけを削除する。
emulator自体は停止しない。
debug buildだけが127.0.0.1へのHTTPを許可し、通常版のHTTPS制約は維持する。

個別機能の検証は`android-today-local-first.md`、`android-unsent-create-editing.md`、`android-task-followup-edits.md`、`mobile-long-capture.md`、`android-input-recovery.md`に記録する。
本journeyはそれらの代替ではない。

2026-09-06、Gateway fixtureの自己検証2件は成功した。
長文Captureの通信遮断・成功receipt喪失・Desktop再起動・同一要求の再送で、本文とevent件数が維持された。
Desktopで同じTaskの名前を変えるcontrol操作は、実Gatewayから409を返し、双方の入力を区別できた。
Androidの連続journey本体もAPI35 compactで成功した。
別PIDからの復元、Createの応答喪失、Desktop DB再生成、同一envelopeの再送、競合と別Taskの同期継続を通過した。
最終状態はTask 4件、Capture 1件、event 13件で、失われた成功応答は1回だった。
Createのevent／receiptは再送前後で同一かつ各1件、原文と入力draftも維持された。
一度も送信していない別Taskの名前・Theme・今日・Checklist編集も、一つのCreateにまとめたまま別PIDで復元し、Task／event／receipt各一件へ同期した。
実SQLiteを生成するfixtureの依存だけは、公開されたDB生成口がまだないため、`architecture/suppressions.json`で#537に紐づけて期限付きで記録する。
`OfflineWidthActivityTest`はAPI35の作業用emulatorで成功した。
未接続debugの実MainActivityをcompactからexpandedへ変更し、Taskの選択、編集中の名前、未保存のCapture入力をActivity再生成後まで保持した。
実画面で選択表示と名前欄・操作ボタンを確認し、終了後に元の画面サイズへ戻ったことも確認した。
このfixtureはHTTP loopbackの検証であり、実S23、実サービスのTLS／Tailscale、release APKの検証を兼ねない。

## 検証ビルド

2026-09-06の最終実行は、`ab8e2b66fa07d5e49bbcdf214c13e286a1837911`を基点とした`codex/530-offline-input`の本変更を含むソースを使用した。
Gatewayは同じcheckoutから実行時にbundleし、APKは同じAndroidソースからbuildした。
記録時はcommit前であり、基点commitだけの検証結果ではない。
以下のAPKは最終の未使用private関数削除の直前に検証したもの。削除後はAndroid compileを確認し、同じ動作の検証結果を引き継ぐ。

- debug APK SHA-256: `00bfbb51b2ccdacf09b5805ae371fb5735e9dc7c5477f8de613fcb9a3d46cfad`
- androidTest APK SHA-256: `b86378c4ff31db5ae00ea30a717d8c84e7f1576fcf191bf1bc7729498e37d487`
- `rtk npm run ci`: 全ゲート成功。全テスト1,552件、監査、build、隔離Electron smokeを含む。
- CI詳細ログ: ローカルの`artifacts/epic530-ci.log`。
