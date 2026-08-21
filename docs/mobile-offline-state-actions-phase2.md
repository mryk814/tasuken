# Android offline Task state actions Phase 2

Issue #399の第2縦断として、Desktop Mobile APIとAndroid outboxをCompleteTask / ReopenTaskへ拡張した。
MobileのTask summaryへcanonical `version`を含め、state commandはRoomに保存したversionを
`expectedVersion`としてimmutable envelopeへ固定する。

## 成立経路

```text
canonical Task summary + version
  -> Room TaskCache.serverVersion
  -> Complete / Reopen intent
  -> optimistic Task state + immutable OutboxCommandを1 transactionで保存
  -> Mobile Gatewayがactor / sourceをDesktop側で固定
  -> Application Commandへexpected_version付きで委譲
  -> receiptのcanonical Task + versionへRoomを収束
```

versionがないTask、または既に未送信commandがあるTaskへ、推測したversionでstate commandを追加しない。
Mobile Gatewayはstale versionを`version_conflict`として返し、silent overwriteしない。

## Migration

Room schema 1→2で`task_cache.serverVersion`をnullable追加する。
既存cacheとoutboxは保持し、既存行のversionは次回Today取得またはreceipt収束までnullとする。
destructive migrationは使用しない。

## 検証結果

- Mobile Gateway focused test: 8件成功。
  - CompleteTask / ReopenTaskのversion遷移
  - 同一command replayの非二重適用
  - stale expectedVersionの`version_conflict`
- Linux TypeScript typecheck成功。
- Windows Android Studio JBR: `:app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest`成功。
- S23（SC-51D）instrumentation: 5件成功。
  - Room 1→2 migrationでcache / outbox保持
  - offline CreateTask
  - interrupted send recovery
  - duplicate receipt convergence
  - Complete / Reopen envelopeとcanonical version収束
- S23へ`adb install -r`成功。migration後のcold launch成功、fresh crash / ANR marker 0。

## このPhaseで未実装・未検証

- 未送信CreateTaskへ続くdependent Complete / Reopen
- 同一Taskの未送信state action coalesce
- conflict recordと採用UI
- bootstrap / cursor delta / tombstone / server reset
- Widget offline action
- Desktop停止→Android操作→Desktop復帰の実データE2E

したがってIssue #399全体はcloseしない。
