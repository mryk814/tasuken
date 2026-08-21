# Android dependent commands and coalescing Phase 4

## Scope

Issue #399 の未送信command依存関係と、同一Taskの状態command compact化を実装する。

- offline `CreateTask` の直後に `CompleteTask` を操作できる。
- 後続commandは `dependsOnCommandId` でCreate receiptを待ち、送信対象にならない。
- Create receiptのcanonical Task versionを後続commandへ注入してから送信する。
- 未送信かつ送信試行0回の `CompleteTask → ReopenTask` は相殺し、不要なcommandを残さない。
- Create依存のCompleteを相殺した場合は、元のCreateだけを保持する。
- sending / retry_wait / 送信試行済みcommandは書き換えず、receiptまたはconflictを待つ。
- Android UIは安全にcompact可能なpending state actionだけを操作可能として表示する。

## Data compatibility

Room schemaは3から4へ更新した。`MIGRATION_3_4` は既存outboxを保持したまま、`taskId` と `dependsOnCommandId` をnullable columnとして追加する。既存commandは従来どおり独立commandとして送信される。

## Verification

- Windows Android build: `testDebugUnitTest assembleDebug assembleDebugAndroidTest` pass
- S23 SC-51D instrumentation: 18 tests pass
  - Room migration: 3
  - outbox/create/state/conflict/dependency/coalescing: 9
  - Compose capture/state/conflict/coalescing UI: 6
- Create → Completeの送信順とreceipt version注入をRoom instrumentationで確認
- Complete → Reopen、およびCreate → Complete → Reopenの相殺をRoom instrumentationで確認
- S23 `adb install -r` とRoom v4移行後のcold launch: pass
- error logの対象package、FATAL EXCEPTION、ANR marker: 0
- Test APKは検証後に削除し、アプリデータはclear/uninstallしていない。

## Remaining #399 boundaries

- UpdateTask field-level conflict and three-way field merge
- bootstrap, cursor delta, tombstone, server reset detection
- real Desktop-online conflict race using a personal-device-safe fixture
- Widget/background projection and reboot/process-death end-to-end evidence
