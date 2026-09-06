# AndroidのTask関連資料Reader

Task詳細の「関連資料を読む」から、関連一覧と選択したNote/Captureの本文を表示する。
Task詳細はDialogの背後に保持し、戻ったときにTask選択と詳細のスクロール位置を保つ。
一覧から本文への往復でも一覧のスクロールを保持する。

## 読み取り契約

- `GET /v1/task-related-documents`: `apiVersion=1`、`schemaVersion=7`、`taskId`、任意の `limit`（既定・最大50）と `cursor`。
- `GET /v1/task-related-document`: 同じバージョンと `taskId`、`type`（`note` / `capture_entry`）、`id`。
- 両方とも `mobile:read` が必要。Healthの `mobile.task-related.read` は両方のread portを持つGatewayだけが返す。
- 本人端末の読み取り権限を使い、AIの共有範囲を決める `ai_visibility` や `mobile:context-read` と混同しない。
- Taskと直接結び付くasserted Reference、およびTaskへ整理されたCaptureの明示的な作成元を対象にする。suggested / rejected / supersededの関連や、同じThemeという理由だけでは含めない。
- 一覧には型・ID・タイトル・version・利用可否・最大3件の関連理由だけを返す。本文は選択した1件だけを取得し、最大50,000 UTF-16 code unitsで切る。サロゲートペアを分断せず、総文字数と省略有無を返す。
- 一覧のカーソルはTaskと一覧内容に結び付く。途中で関連や資料versionが変わったら `cursor_stale` を返し、先頭からの再取得を案内する。
- 存在しないTaskは `not_found`、消えた本文は `not_found`、解除された関連は `not_related`。認識したAPIの業務上の欠落はHTTP 200内の状態で表し、旧Gatewayの404と区別する。
- ファイルパス、添付、リンク先は読み込まない。Markdownは選択可能な原文テキストとして表示し、リンクを自動取得しない。

## 端末保存

Room 23で `related_document_cache` と `related_body_cache` を追加する。
前者はserver/Task別の一覧・取得日時・継続位置・取得エラー、後者はserver/Task/資料別の本文と取得日時を保存する。
長文を複数取得しても1行へ本文を集約せず、Android CursorWindowの1行上限を避ける。
移行は既存Task、Capture、作業記録、Recall、outboxを変更しない。

取得済み本文はAndroidプロセス終了後やPCに接続できないときも表示する。
未取得本文は接続が必要と明示し、最終取得時刻、一覧の続き、本文の更新有無、参照切れを分けて表示する。
本文取得失敗や旧Gateway応答では保存した内容を保持する。
資料の削除・関連解除を受信したら該当本文を除外し、401/403を受信したらそのserverの関連資料キャッシュ全体を削除する。
一覧の全ページ取得が終わると、一覧から外れた本文を削除する。
PCへ接続できない間に起きた未受信の削除や権限変更を、端末が検出したとは表示しない。

## 検証

- `tests/mobile-related-documents.test.mjs`: 認可、strict query、明示関連、選択本文、50件継続、カーソル失効、Unicode境界、実Gateway/Core/SQLiteでのNote/Capture読取とDesktop再起動・削除。
- `MobileRelatedDocumentsDatabaseTest`: Room再読込とoffline、未取得本文、更新、全server権限失効、旧Gateway・不正version、複数長文を分けた保存。
- `MobileLocalDatabaseMigrationTest#migrationTwentyTwoToTwentyThreePreservesRecallAndAddsEmptyRelatedCache`: 22→23の非破壊移行。
- `MobileRelatedDocumentsGatewayTest`: 実HTTP/Kotlin DTO/Roomへの52件取得、Android別プロセス＋PC停止後の本文再表示、PC再起動後の削除受信。
- `MobileRelatedDocumentsUiTest` / `MobileRelatedDocumentsTodayUiTest`: 未取得・空・エラー・参照切れ・長文、一覧内の位置、Task詳細への復帰。compact / expandedのスクリーンショットを確認する。

全文検索、添付やローカルファイルの転送、AIへの追加共有、本文編集はこのReaderに含めない。
