# Androidで今日の記録を振り返る

Todayの「今日の記録」から、今日と直近7日の日別一覧を開く。
Task完了、本人の作業記録、未整理Capture、計画、AI報告、人間による採用を別のラベルで表示する。
「一言残す」は既存の[Android作業記録](android-work-log.md)を開く。
新しい日報データやActivityの正本は作らない。

## キャッシュと取得

画面はRoomにある記録を先に表示し、「再取得」でDesktopへ問い合わせる。
日付は端末のtimezoneの暦日で、日付・timezone・接続先serverIdをキャッシュのキーにする。
取得した日、最終取得、未取得、部分取得を表示し、接続失敗を0件取得へ変換しない。
空と表示するのは、その日の正式一覧を最後まで取得した場合だけである。

`GET /v1/activity`はMobileの`mobile:read`認証を通し、共通の振り返りqueryを利用する。
本人が自分の端末で読む経路であり、AI公開visibilityを閲覧制限へ流用しない。
新しい外部共有は追加しない。

1ページは500件までで、返されたopaque cursorをそのまま次の取得へ渡す。
最初の取得は部分ページを表示できる。
以前に完全取得した日を再取得する場合は、その表示を保持したまま別の取得途中領域へページを蓄積し、全ページが揃った時点で置き換える。
続き取得の失敗や`resync_required`でも、前回の501件目以降を失わない。
「再取得」はcursorなしで新しく取得を始める。
serverId・timezone・日付・revision・offsetが一致しない応答を別のページへ継ぎ足さない。

## 端末で保存した入力

未同期WorkLogとCaptureは同じ日へ重ねて表示する。
Capture本文は作成outboxと同じtransactionで表示用キャッシュへ保持するため、receipt受理でoutboxが消えた直後にも本文を読める。
正式一覧との重複排除はevent IDではなくsourceのtypeとIDで行う。

受理済みだがまだ正式一覧に掲載されていない入力は、掲載まで端末表示を保つ。
公開済みの完全取得結果でsourceを確認した後は正式一覧を優先する。
その後Desktopで削除・整理・日付変更されたsourceを、古い本文キャッシュから一覧へ復活させない。
取得途中の未公開ページだけを根拠に、端末表示を先に消すこともしない。
本文キャッシュ自体は確認済み索引と分けて保持する。

Room 21→22は日別キャッシュ・Capture本文キャッシュ・確認済みsource索引を追加する。
既存のTask、WorkLog、outbox、送信試行回数を維持し、既存未同期Captureのenvelopeから原文を引き継ぐ。
未送信Captureの取消しと同期済み削除は、既存receipt削除と同じtransactionで表示用本文を削除する。

## 原記録を開く

取得済みTaskは既存Task詳細へ、作業記録は既存の保存済みWorkLog詳細へ移動する。
Desktop作成のWorkLogは単体取得してから同じ詳細を開く。
端末に保持したCapture原文は既存Capture詳細を再利用する。
DesktopだけにあるCaptureの全文取得には未対応で、一覧の索引と未取得理由を表示する。
未対応の種類、消えた原記録、未取得Taskも、本文を持っていない理由を明示する。
別のDesktopが同じNote IDを持つ場合は、既存本文を上書きせず、そのDesktopでの確認を案内する。
入力や原文から戻ると、選択した日と一覧の位置を保つ。

## 検証

`MobileRecallDatabaseTest`は500件超、取得世代の置き換え、再open後のPC停止、source重複、削除後の再表示防止、timezoneとserver分離、旧Gateway、原子失敗、取消し、別serverのNote ID衝突を確認する。
`MobileLocalDatabaseMigrationTest#migrationTwentyOneToTwentyTwoPreservesPendingCaptureTextAndExistingWorkLogs`は21→22で原文と既存outboxを維持する。
`MobileRecallUiTest`と`MobileRecallTodayUiTest`は取得済み・未取得・空・部分取得・原文未取得の表示、Today入口、既存入力への接続と日選択の復帰を確認する。

`MobileRecallGatewayTest`は既存の隔離Gateway runnerを使い、501件のCapture・Task完了・実施日付きWorkLogを共通queryから取得する。
Androidを別PIDで再起動してPC停止中の保存済み表示を確認し、Desktop再起動後に別timezoneで取得し直す。
テスト用DBと接続だけを使い、実プロファイルを流用しない。
スクリーンショットは検証アプリのexternal files配下`recall-549`へ保存する。
物理端末と配布APKは、この隔離emulator検証とは別の境界である。
