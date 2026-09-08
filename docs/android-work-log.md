# Androidでやったことを残す

Today上部の「記録」、またはTask詳細の「やったことを残す」から、本文と実施日を保存する。
実施日は今日が初期値で、ThemeとTaskは任意。
Task詳細から開いたときはTask参照だけを初期値にし、そのThemeや公開範囲を暗黙に引き継がない。
既存の音声認識を文字入力として利用できる。
Taskの完了や作業時間は推定しない。

最初のDesktop接続後はPC停止中でも「端末に保存」でRoomへ保存できる。
本文、実施日、入力時刻、参照、安定したCommand IDを表示用cacheとoutboxへ同一transactionで保存する。
保存済みの本文は「記録 → 保存した記録」で読める。
Todayの「今日の記録」ではTask完了やCaptureと一緒に[日ごとに振り返る](android-recall.md)こともできる。
下書きはCaptureとは別の保存先へ書き、閉じる操作・プロセス終了後も再表示する。
12,000文字までの入力を原文のまま保存し、上限を超えても入力を切り捨てない。
Desktopで後から編集されたNoteの表示にはAndroid入力欄の文字数制限を適用しない。

正式記録は[共通RecordWorkLog](work-log-command.md)が保存する通常Noteとcanonical Markdownで、AndroidのRoomは表示用cacheと未同期入力である。
`commandId = noteId`で、再送時はID・`issuedAt`・本文・実施日・参照を変更しない。
初回envelopeは受信後もcacheに保持し、Desktop編集後の二重submitを新規保存や巻き戻しへ変換しない。
Room 20→21は既存のTask/Capture/outboxを保持し、`work_log_cache`とnullableなoutboxの`workLogId`だけを追加する。

## 同期と回復

保存済みの記録を開くと、任意の「原文をAIで整理」を利用できる。
Desktopの既存AI設定を使用し、選んだ原文1件だけを送信する。
原文の保存にはAI接続を必要としない。
整理案は原文の文を「やったこと／気づき・所感／未解決・仮説」に分類する。
否定や不確実さを途中で切り落とさないよう、文末まで一致する引用だけを受け付ける。
句点や改行がない長い一文は、そのまま一項目になる。自由な要約や言い換えは行わない。

「整理案を補足として採用」は別Noteを保存し、元の本文・実施日・Task状態を変更しない。
AI整理と原文ID/versionを表示し、確認済みの知識や実績として扱わない。
採用後、明示された次の行動がある場合だけ個別にTaskへ追加できる。
候補0件も正常であり、補足の採用だけで完了する。
Task追加は採用とは別操作で、日付・時間・完了を推定しない。

整理APIは`POST /v1/work-log-organization`で、`mobile:read`と既存`mobile:work-log-write`を要求する。
採用は既存commands経路の`AdoptWorkLogOrganization`で送る。
補足の採用日時とTaskの追加日時は、それぞれ本人が初回操作した時刻をoutboxへ固定し、再送でも保持する。整理案の生成日時や原文の入力日時は流用しない。
Room 24→25は原文cacheとoutboxを保持し、原文IDに対応する整理案・生成ID・採用状態だけを別tableへ追加する。
原文versionの変更、取り消し後の遅延応答、再送・二重採用を検査する。
採用中の送信失敗は既存の再送操作、version競合は「Desktopの記録を確認」から回復する。
整理失敗や破棄でも原文は保持する。

書き込みは既存の`POST /v1/commands`へ`RecordWorkLog`、`DeleteWorkLog`、`RestoreWorkLog`を送る。
書き込みには`mobile:work-log-write`、単体取得`GET /v1/work-logs?id=...`には`mobile:read`が必要。
新規pairにだけ専用書き込みscopeを付与し、既存pairの権限を自動で広げない。
旧Desktopや権限不足では原文を保持して送信を止める。
Desktopを更新・再pairした後、「保存した記録 → 内容と操作 → 再送する」で同じCommandを再送できる。

保存前にTaskが消えた場合は共通Commandが全体を拒否し、Androidの本文・日付・参照を保持する。
本人が「参照を外して新しい記録へ」を選ぶと、原文と実施日を保った新しい入力を開く。
古い記録を無断で削除せず、送信済みenvelopeも書き換えない。
保存後にTaskが消えてもNoteは独立して残り、「Desktopの記録を確認」で参照切れを表示する。

未送信・試行0回の記録は端末内で取り消せる。
一度でも送信した記録は送信結果の確認後に共通Note削除へ進む。
削除中も本文を残し、受理後に削除状態を表示する。
「削除を元に戻す」は未送信取消しなら同じ作成Commandを復元し、同期済みなら共通Note restoreへ接続する。
Desktop編集で削除のversionが競合した場合は「Desktopの記録を確認」で最新表示へ戻し、必要なら新しい削除操作を行う。

| 到達元 | 削除・復元の導線                               |
| ------ | ---------------------------------------------- |
| 一覧   | 保存した記録 → 内容と操作                      |
| 詳細   | 本文の下の削除説明 → 未送信取消し／記録を削除  |
| 入力   | 新規入力には削除を置かず、既存記録の操作へ戻る |
| Undo   | 削除済み記録 → 内容と操作 → 削除を元に戻す     |

## 検証

専用emulatorとfixtureだけを利用し、実プロファイル・実端末のデータを流用しない。
Windows側のAndroid SDK/JBRは既存開発設定を利用する。

```powershell
rtk .\gradlew.bat :app:testDebugUnitTest --tests jp.personal.tasken.companion.MobileWorkLogContractTest
rtk .\gradlew.bat :app:assembleDebug :app:assembleDebugAndroidTest
```

`MobileWorkLogDatabaseTest`は原子保存失敗、二重submit、Room再open、旧Gateway拒否、同じenvelopeの再送、未送信取消し、削除・復元・version競合回復を検証する。
`MobileLocalDatabaseMigrationTest#migrationTwentyToTwentyOneKeepsExistingCommandsAndAddsWorkLogCache`は既存outboxの不変性とmigrationを検証する。
`MobileWorkLogUiTest`は長文、保存失敗、日付、保存済み表示、Task参照初期値、Task状態を変えない入口を検証する。
`MobileWorkLogOrganizationUiTest`は整理案、失敗、破棄、採用後の独立したTask追加と候補0件を検証する。
`MobileWorkLogDatabaseTest`には遅延応答・version競合・再open・二重採用と、生成後の採用／Task追加の操作日時および再送時の保持を含む。
固定provider応答で未完了の調査、失敗した試行、仮説、所感だけ、次の行動なしを検証する。実モデルの分類品質はこの検証に含まない。

Android APKをbuildしてからrepo rootで実Gatewayの別PID journeyを実行する。

```powershell
rtk node scripts/run-electron-node.mjs tests/helpers/run-android-offline-journey.mjs emulator-5556 MobileWorkLogGatewayTest#aSaveOfflineOriginalAndDateBeforeProcessExit MobileWorkLogGatewayTest#bReplayLostReceiptThenDeleteAndRestoreCanonicalNote --cleanup=MobileWorkLogGatewayTest#zCleanupOwnedFixture
```

日付別の記録一覧からこの原記録へ戻る読取契約は[Androidの日付別振り返り](mobile-activity-recall.md)を参照する。

Desktop側は`mobile-work-log-gateway.test.mjs`と`canonical-markdown-workspace.test.mjs`で、認証scope、同一Note/Markdown、応答喪失・再起動、Task削除、削除/Undoの原子失敗と古いCommand再送を検証する。
スクリーンショットは検証用アプリのexternal files配下`work-log-540`へ保存する。
マイク音声の実認識・物理端末・配布APKはこの隔離emulator検証とは別の境界である。
