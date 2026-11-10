# AIによるTask/Noteの直接新規作成

本人が許した接続だけが、Task/Noteを直接新規作成できる。既存Proposalの受付・採用・却下とpendingは維持し、自動採用や移行は行わない。

## 接続と入力

Desktop Coreは`create_ai_item`を常に公開し、使えるかは設定「AI & Context → ローカルのAIに直接の書き込みを許す」（preference `aiDirectWriteEnabled`、既定は無効、端末ごとで同期しない）を要求のたびに読む。無効なら`DIRECT_WRITE_DISABLED`（403）で断る。切り替えてもCoreを作り直さず、MCPも接続し直さなくてよい。`GET /capabilities`の`direct_write_enabled`と`tasken.get_capabilities`の`core.direct_write_enabled`で今の値が分かる。MCPは無効の間も作成toolを一覧に残し、理由を`disabled_in_settings`と返す。

Headlessの`--write-mode=create-only`は従来のproposals受付に加え、`create_ai_item`だけを公開する（設定は見ない）。read-only/proposalsの挙動は維持する。汎用`task.command`・編集・削除・完了・委任を公開しない。入力からactor/workspace/既存Entity ID/保存パスを受け付けない。

MCPは`tasken.create_task`と`tasken.create_note`。必須入力は`title`・`caller`・`idempotency_key`、任意は`body`・`reason`・`source_app`・`source_session`・`theme_id`（省略時は個人業務。無いThemeは`INVALID_REFERENCE`）。DesktopのTaskはさらに`priority`・`schedule`（期限だけなら`end_date`、一日なら`start_date`、期間なら両方。`date_kind`はCoreが導く）・`today_date`・`checklist`（項目名の配列）を受ける。Noteは`note_type`（memo/report/prompt）と、reportなら`report_date`を受ける。他方の種類の欄は断る。NAS（create-only）は今までどおり個人業務への題名と本文だけを受け、`theme_id`ほかの欄は`WRITE_NOT_ALLOWED`（403）で断る。NASのAIはThemeのAI公開範囲を見ずに書けてしまうのと、replicaが出す同期差分の形を増やさないため。日報の日付は、提案の採用と同じく`properties_json.daily_report.date`に置く。Taskは本人実行・未委任・未着手で作る。正式ID/version/本文/Theme/削除状態とこのnodeのworkspace IDを読み戻す。NoteのMarkdown保存状態も返し、ファイル保存が未完了なら`internal_ahead`/`unavailable`を明示する。

指定されなかった欄はEntityに足さない。NAS replicaの同期差分の形（`contracts/sync/ai-item-packets.json`）を、欄を使わない作成では変えないため。

## 表示・保存

AI作成の由来は`ai_creation`、情報の根拠は`ai_authority`、認識状態は`ai_seen_at`に分ける。Desktopの「見た」は既読だけを保存し、事実確認や採用を意味しない。Task/Notes一覧は小さなAI由来アイコンと未確認の点を使い、タップ／クリック／キーボードで作成者・受信日・理由を読む。削除/Undoは既存の人間操作を利用する。Androidとの互換表示は`src/shared/contracts/mobile/aiOrigin.ts`を参照。

同じkey/内容は保存済みEntityを返し、内容違いは競合。削除後の再送は削除状態を返し復活させない。NoteはDesktopと同じWorkspaceServiceのCanonical Markdown保存・復旧処理を使い、作成イベントを同伴して保存する。headless bundleではDesktop APIを明示的に利用不可にし、画像とOS操作は公開しない。新経路から`accepted_from_proposal_id`を生成しない。

## 導入と検証

NASへの導入はbackup/image交換/再起動の独立した配備作業であり、PCのビルド完了を本番接続確認と扱わない。旧設定値を黙って変更しない。Core/bridge更新と`create-only`の明示指定後、接続を再読込して`get_capabilities`と新ツール一覧を確認する。

`tests/ai-item-creation.test.mjs`は隔離DB、実stdio MCP、権限・入力範囲、同時再送・再起動・内容違い・削除後再送、旧pending共存、Canonical Note失敗復旧とUndo、Desktopの設定の即時反映と広げた入力（Theme・日程・優先度・チェックリスト・今日）を確認する。

表示だけの手動確認はbuild後に `rtk node scripts/ai-item-creation-ui-smoke.mjs` を使う。
Tempの専用profileでTask/Noteを作成し、由来アイコンと未確認の点、説明の表示、既読の保存、Task状態の保持を確認する。通常データや本番同期先は使わない。

NAS導入の順序:

1. 現在のimageと`proposals`設定を控え、既存backup手順で停止中の`/data`を退避する。Note正本の保存rootがNASで有効か確認する。DesktopのWindows絶対パスをNASで有効な保存先と扱わない。
2. Linux Node向けに新Core/bridgeを含むimageを作成し、TaskenのCore/tunnelだけを更新する。同じUID/GID・state・同期mountを維持し、ネットワークやtunnel認証設定は変更しない。
3. `TASKEN_CORE_WRITE_MODE=create-only`と既存の`TASKEN_MCP_READ_ONLY=0`で起動する。停止中はMCPが一時的に使えない。DesktopとNASで同じSQLiteを同時に開かない。
4. 実接続を再読込し、`create-only`・新2ツール・編集/削除/開始の非公開を確認する。実データの作成は同名Task・既存Note・Proposalを先に確認した上で担当者が行い、正式ID・読戻し・Desktop同期を確認する。
5. 問題があれば旧imageと`proposals`へ戻す。作成済みEntityは自動削除しない。state全体をbackupへ戻す判断は、停止後に増えたデータを確認してから行う。

移行負債は`architecture/suppressions.json`で期限・既存追跡Issue・除去条件を明示した。HeadlessのCanonical Note writer再利用と隔離DB fixtureは#588、Desktopの人間専用既読metadata書込み・aggregate adapterは#405。監査のglobal policyやbaselineは緩めない。
