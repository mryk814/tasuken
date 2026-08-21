# Android offline task capture Phase 2

Issue #400 のwrite UX最初の縦断として、Today画面からTask名を入力し、network状態に依存せず
Roomのoptimistic cacheとoutboxへ保存できる導線を追加した。
DesktopのApplication Commandが引き続きbusiness ruleとcanonical resultを決定する。

Today詳細にはComplete / Reopenを可視のbuttonとして追加した。
操作はRoomへ即時反映し、canonical versionを持つimmutable commandとして自動送信する。

## 成立経路

```text
Todayの「追加」
  -> bottom sheetでTask名を入力
  -> TodayViewModelが入力を検証
  -> MobileOutbox.enqueueCreateTask
  -> 1 Room transactionでoptimistic TaskCache + immutable OutboxCommand
  -> Room FlowからTodayへ「送信待ち」Taskを再表示
  -> WorkManagerがDesktop Gatewayへ自動送信
```

入力エラーではsheetと入力値を保持する。
画面再生成時は`TodayPaneState`の同じSaverで、選択Task、scroll位置、capture sheet、draftを復元する。

## 検証結果

- Windows Android Studio JBR: `:app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest` 成功。
- S23（SC-51D）へ`adb install -r`成功。cold launch成功、fresh crash / ANR marker 0。
- S23 Compose instrumentation: 1件成功。
  - 「追加」から`rotationdraft`を入力
  - `ActivityScenario.recreate()`でActivityを再生成
  - capture sheetとdraftの再表示を確認
- S23 Compose / Room instrumentation: 合計9件成功。
  - todo Taskには「完了する」、done Taskには「再開する」を表示
  - pending Taskでは理由を示して重複state actionを抑止
  - Complete / ReopenのexpectedVersion envelopeとreceipt収束
  - Room 1→2 migrationで既存cache / outboxを保持
- S23の通常画面で「追加」とToday空状態を実描画確認。cold launch成功、fresh crash / ANR marker 0。
- 実データを汚さないため、実Taskのsubmitは行っていない。

## このPhaseで未実装・未検証

- Gateway到達時のCreate / Complete / Reopen実データE2EとDesktop canonical stateへの収束
- TaskのUpdate
- theme、schedule、checklist編集
- conflict解決UI
- fold / unfoldの物理ヒンジ操作
- Widget / Shortcut / AI Inboxの同一deep link
- signed APK

したがってIssue #400全体はcloseしない。
