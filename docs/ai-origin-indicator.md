# AI作成の由来表示（#628）

TaskとNoteのAI由来はTabler Sparkles、未確認は小さな点で示す。
既読後も由来アイコンを残し、作成元・日付・状態はタップ／クリック／キーボードで読む。
PC詳細の「見た」は既存のmarkAiItemSeenを使う。Task完了やAI報告の採用は別操作。
Androidの説明を開いても既読を変更しない。PCで保存した既読を同期で表示する。
動きや色だけに依存せず、読み上げ名に由来と状態を含める。

## Androidに表示されなかった原因と互換性

候補の基準コード（Android versionName 0.1.71）は、GatewayのTask射影、Android DTO・Roomキャッシュ・UIにAI作成情報を持たなかった。
既存の共有folder同期ではTask/Noteのai_creationとai_seen_atが保持されることを隔離DBで確認済み。
利用者のAndroid実機の配布版は今回読み取っていない。

新Androidは既存HTTPリクエストへ `X-Tasken-Ai-Origin: 1` を付ける。
新Gatewayはこのheaderを受けたTask応答と明示的に関連付けられたNote応答だけに、
optionalな `aiOrigin: { caller, receivedAt, seenAt }` を追加する。
旧クライアントには追加項目を返さず、旧Gatewayもheaderを無視して従来応答を返す。
API/schema version 1/7、strict JSON検証、認可・scope・AI作成経路は保持する。
authorityやAIによる編集から由来を推測せず、正式なai_creationだけを読む。

Room 26→27はtask_cacheへnullableなaiOriginJson列を追加する。
既存Task・Outboxは保持し、次の既存bootstrap/syncで由来を補完する。
関連Noteは既存の関連資料JSONキャッシュを再利用する。
Android表示を配布する際は、このGatewayを含むDesktopとAndroidの双方の更新が必要。

## 検証

- `tests/mobile-ai-origin.test.mjs`: 実HTTP/Core/SQLiteで旧形式維持、Today/bootstrap/sync、関連Note一覧／本文、既読・再起動、Task状態不変。
- `MobileAiOriginContractTest`: 旧／新DTOとstrict JSON、由来の長さ・日付の検証。
- `MobileAiOriginRepositoryTest`: 実Android repositoryのbootstrap/sync→Room→再open→既読再同期。HTTP応答はfixture。
- `MobileLocalDatabaseMigrationTest#migrationTwentySixToTwentySevenKeepsTaskAndPendingWrites`: 実Room移行でTaskと未送信入力を保持。
- `AiOriginUiTest`: 実ComposeのTask／関連Note、タップ説明、既読と未確認、読み上げ名、48dp操作領域。新規Temp内AVDで410dp相当と884dp相当、後者はアニメーション無効。
- `scripts/task-handoff-audit.mjs --task-board --integrated`: PCの実Electron一周にアイコン、未確認点、Enter／Escapeとfocus、420/820/1400幅、reduced motionを追加。

画像は候補の `output/android-phone` / `output/android-fold` / `output/task-board-audit`。
Androidの `task-before-no-origin.png` は同じfixtureから由来を省いた旧表示相当の比較であり、実機の旧配布版を撮影したものではない。
実機、通常Desktop更新、NAS配布、公開は行っていない。
