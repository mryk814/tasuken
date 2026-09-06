# やったことを記録

Todayの「やったことを記録」から、本文と実施日、任意のTheme・既存Taskを保存する。
実施日は今日を初期値とし、日単位の申告として保持する。
時刻・作業時間・Task完了・確認済みの知識を推定しない。

共通入力は `src/shared/workLog.ts` の `RecordWorkLogCommand` v1、例は `tests/fixtures/work-log-v1.json`。
`commandId` はクライアントが一度だけ生成し、同じ入力の再送では `issuedAt` を含めて変えない。
Mainの `WorkspaceService.recordWorkLog` に渡すactorは信頼済みadapterが供給する。
Desktop IPCは入力payloadのactorを採用せず、desktop-userを使う。
将来のMobile adapterは認証principalからactorを指定し、HTTP payloadから指定させない。

正本は通常のNoteとcanonical Markdown。
`properties_json.work_log` はschema、実施日、day精度、入力時刻、actor、Task参照、元receiptを保持する。
Activityは入力時刻順に表示し、実施日と「本人の申告」を別に示す。
実施日の午前0時を発生時刻に作り替えない。
AI authorityをuser_confirmedへ昇格せず、Themeの公開範囲を通常Noteと同様に継承する。
Taskだけを指定した場合も、手入力NoteのThemeは個人業務のままにする。
Task本文を転記しないため、関連TaskのTheme・公開範囲を暗黙にコピーしない。
本文は通常Noteと同様に文字数で切り捨てず、well-formed Unicodeを検証する。
本文から作る一覧用タイトルだけを80 Unicode code pointに収め、原文は保持する。

Note・Task Reference・Activity eventは同一DB transactionで保存する。
canonical file成功後のDB失敗は、型を限定したwork-log companionを復旧receiptに残して再起動時に復旧する。
同じcommandはNote編集後・削除後にも初回receiptを返し、本文を巻き戻したり復活させたりしない。
異なる入力・actorによるID再利用は拒否する。
保存前に参照Taskが削除されていれば全体を拒否し、フォームは原文を保持して参照を選び直せる。
保存後のTask削除ではNoteを保持する。
削除・Undo・Snapshotは既存Noteの導線を使う。

Desktopの閉じる操作ではTodayを開いている間の下書きを保持する。
アプリ終了をまたぐ未送信下書き、AndroidのRoom/outbox、Mobile HTTPはこの実装の対象外。
