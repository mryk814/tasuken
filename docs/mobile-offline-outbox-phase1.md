# Android offline CreateTask outbox Phase 1

Issue #399 の最初の縦断として、Android側へ `TaskCache`、`OutboxCommand`、`SyncState` を追加した。
DesktopのSQLiteは引き続き正本であり、Roomは表示用cacheと未送信commandの保管だけを担う。

## 成立経路

```text
CreateTask intent
  -> 1 Room transactionでoptimistic TaskCache + immutable OutboxCommand
  -> Room FlowをToday UIへ投影
  -> network接続時にunique WorkManager
  -> 保存済みenvelopeを変更せずPOST /v1/commands
  -> receipt + canonical Task + SyncStateを1 Room transactionで反映
  -> transaction成功後にoutboxを削除
```

再送では `commandId`、`idempotencyKey`、`requestId`、`clientDeviceId`、`issuedAt`、payloadを作り直さない。
`sending`中にprocessが終了したcommandは次回worker開始時に`retry_wait`へ戻す。
HTTP timeout、rate limit、Desktop停止、token失効はoutboxを保持し、再接続後の再送対象にする。

## 非交渉の互換条件

- DesktopだけがTaskのbusiness ruleとcanonical resultを決定する。
- optimistic Taskとoutboxは同じtransactionで保存する。
- network responseを直接UI stateへ書かず、Roomへ反映した結果を表示する。
- receipt反映とoutbox削除を同じtransactionにし、重複receiptを二重Taskにしない。
- Android Gateway tokenは既存どおりAndroid Keystoreで暗号化し、Roomへ保存しない。
- instrumentation testは実アプリのSharedPreferencesやpairing情報を変更しない。

## 検証結果

- Windows Android Studio JBR: `:app:testDebugUnitTest :app:assembleDebug :app:connectedDebugAndroidTest` 成功。
- JVM unit test: 13件成功。Room Flowがnetwork戻り値ではなくToday UIの表示元になることを含む。
- S23（SC-51D）Room instrumentation: 3件成功。
  - offline CreateTaskのTaskCache/outbox同時保存
  - `sending`中断後の同一envelope回復
  - receipt収束、outbox削除、重複receiptの安全性
- S23へ`adb install -r`成功。cold launch成功、fresh crash / ANR marker 0。
- S23のMobile Gateway pairingを再確認し、再起動後にToday stateへ到達。

## このPhaseで未実装・未検証

- CompleteTask / ReopenTaskと`expectedVersion` conflict UI
- `/v1/bootstrap`、cursor delta、tombstone、server reset検出
- Room migration 1→2
- Widget / Shortcutの実UIとoffline action
- Doze、端末reboot、長時間offline後の実送信E2E
- Desktop sleep / wake

したがってIssue #399全体はcloseしない。
