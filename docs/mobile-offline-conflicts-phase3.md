# Android offline conflict Phase 3

## Scope

Issue #399 の `CompleteTask` / `ReopenTask` version conflictを、Mobile GatewayからAndroid UIまで縦断する。

- Task application serviceはversion conflict時にcanonical Taskを返す。
- Mobile Gatewayは409応答へcanonical Task、端末のintent、送信時versionを含める。
- Androidは409をretryやrejectedへ潰さず、Roomへoutbox commandと競合記録を保持する。
- Task cacheはDesktopのcanonical stateへ戻し、端末のintentは競合記録として別に表示する。
- 「この端末を採用」はcanonical versionを使う新しいcommandIdへ置換して再送する。
- 「Desktopを採用」は競合と元commandを削除し、canonical stateを維持する。

## Data compatibility

Room schemaは2から3へ更新した。`MIGRATION_2_3` は既存の `task_cache` と `outbox_command` を保持し、`conflictCommandId` と `task_conflict` を追加する。destructive migrationは使用しない。

## Verification

- TypeScript typecheck: pass
- Task/Mobile focused contracts: 27 tests pass
- Windows Android build: `testDebugUnitTest assembleDebug assembleDebugAndroidTest` pass
- S23 SC-51D instrumentation: 13 tests pass
  - Room migration: 2
  - outbox/create/state/conflict lifecycle: 6
  - Compose capture/state/conflict UI: 5
- S23 `adb install -r`: app APK and test APK pass
- S23 cold launch after migration: pass
- Test APK was removed after verification. App data was not cleared or uninstalled.

## Remaining #399 boundaries

- UpdateTask field-level conflict and three-way field merge
- dependent commands for an unsent CreateTask and command coalescing
- bootstrap, cursor delta, tombstone, server reset detection
- real Desktop-online conflict race using a personal-device-safe fixture
- Widget/background projection and reboot/process-death end-to-end evidence
