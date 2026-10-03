# 本人用Task/Noteの直接新規作成

新規作成だけを明示的に有効化する。既存Proposalの受付・採用・却下とpendingは維持し、自動採用や移行は行わない。

## 接続と入力

Headlessの`--write-mode=create-only`は従来のproposals受付に加え、`create_ai_item`だけを公開する。read-only/proposalsの挙動は維持する。汎用`task.command`・直接開始・編集・削除・完了・委任を公開しない。接続先のworkspaceと個人業務に固定し、入力からactor/workspace/既存Entity ID/保存パスを受け付けない。

MCPは`tasken.create_task`と`tasken.create_note`を追加する。必須入力は`title`・`caller`・`idempotency_key`、任意は`body`・`reason`・`source_app`・`source_session`。Taskは期限なし・本人実行・未委任、Noteは通常のmemo。正式ID/version/本文/削除状態とこのnodeのworkspace IDを読み戻す。NoteのMarkdown保存状態も返し、ファイル保存が未完了なら`internal_ahead`/`unavailable`を明示する。

Desktop Coreは`TASKEN_CORE_AI_ITEM_CREATE=1`を明示した起動だけが新規作成を有効にする。稼働後に権限を差し替えない。

## 表示・保存

AI作成の由来は`ai_creation`、情報の根拠は`ai_authority`、認識状態は`ai_seen_at`に分ける。Desktopの「見た」は既読だけを保存し、事実確認や採用を意味しない。Task/Notes一覧にAI作成・未確認を表示し、詳細には作成者・受信日・理由を残す。削除/Undoは既存の人間操作を利用する。

同じkey/内容は保存済みEntityを返し、内容違いは競合。削除後の再送は削除状態を返し復活させない。NoteはDesktopと同じWorkspaceServiceのCanonical Markdown保存・復旧処理を使い、作成イベントを同伴して保存する。headless bundleではDesktop APIを明示的に利用不可にし、画像とOS操作は公開しない。新経路から`accepted_from_proposal_id`を生成しない。

## 導入と検証

NASへの導入はbackup/image交換/再起動の独立した配備作業であり、PCのビルド完了を本番接続確認と扱わない。旧設定値を黙って変更しない。Core/bridge更新と`create-only`の明示指定後、接続を再読込して`get_capabilities`と新ツール一覧を確認する。

`tests/ai-item-creation.test.mjs`は隔離DB、実stdio MCP、権限・入力範囲、同時再送・再起動・内容違い・削除後再送、旧pending共存、Canonical Note失敗復旧とUndoを確認する。

NAS導入の順序:

1. 現在のimageと`proposals`設定を控え、既存backup手順で停止中の`/data`を退避する。Note正本の保存rootがNASで有効か確認する。DesktopのWindows絶対パスをNASで有効な保存先と扱わない。
2. Linux Node向けに新Core/bridgeを含むimageを作成し、TaskenのCore/tunnelだけを更新する。同じUID/GID・state・同期mountを維持し、ネットワークやtunnel認証設定は変更しない。
3. `TASKEN_CORE_WRITE_MODE=create-only`と既存の`TASKEN_MCP_READ_ONLY=0`で起動する。停止中はMCPが一時的に使えない。DesktopとNASで同じSQLiteを同時に開かない。
4. 実接続を再読込し、`create-only`・新2ツール・編集/削除/開始の非公開を確認する。実データの作成は同名Task・既存Note・Proposalを先に確認した上で担当者が行い、正式ID・読戻し・Desktop同期を確認する。
5. 問題があれば旧imageと`proposals`へ戻す。作成済みEntityは自動削除しない。state全体をbackupへ戻す判断は、停止後に増えたデータを確認してから行う。

移行負債は`architecture/suppressions.json`で期限・既存追跡Issue・除去条件を明示した。HeadlessのCanonical Note writer再利用と隔離DB fixtureは#588、Desktopの人間専用既読metadata書込み・aggregate adapterは#405。監査のglobal policyやbaselineは緩めない。
