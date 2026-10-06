# 日次 Activity と AI 作業ログの改善

既存 Activity を主画面にし、人の操作・フォーカスと AI セッションを同じ日の時間軸へ表示する。PC は重複をレーンで分け、390px の画面は時刻・依頼・成果要約・Repository の一覧から詳細を開く。週表示は補助の振り返りとして折りたたむ。タスクに関連付け済み／未関連を、読み上げラベルと tooltip のあるリンクアイコンで区別する。

詳細から既存タスクを後から関連付け・解除できる。関連付けは user origin の worked_on reference を追加し、重複を作らない。解除は既存の reference 削除 API を使い、セッションの成果・出典やタスクの状態を変えない。superseded は置き換え先 assertion を要求する契約なので、解除の代用には使わない。変更対象・判断・次の提案・確認結果も詳細で読める。

日境界・時刻・取り込み後の表示日は JST で統一する。終了未確認を現在まで伸ばさず、履歴は最終観測までに制限する。経過時間を実働時間と扱わず、費用と実働時間は未収録と示す。日跨ぎと同時セッションを保持し、日付移動では詳細を閉じる。

## hooks を使わない取り込み

日次画面の取込アイコンから、利用者が必要なときに生ログのファイルを選ぶ。Codex rollout と Claude Code transcript の JSONL を直接扱い、既存 Proposal の確認・採用を経て保存する。版付き tasken-ai-work-log/1 の従来5 provider契約も継承する。Copilot・OpenCode・DeepSeek の生ログ一般には対応したと主張しない。

Codex は CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl、Claude は CLAUDE_CONFIG_DIR/projects 配下（既定 ~/.claude/projects）の単一 Session JSONL が対象。既存の hooks 経由記録も表示できるが、この入口の前提ではない。

2MB、20000行、依頼・回答各200件という上限を維持する。壊れた行、複数 Session 混在、時刻のタイムゾーン不足、同じ発言 ID の矛盾を拒否する。選んだファイル内の path を追って別ファイルを開かない。推論・tool IO・system/developer・メタ指示・添付・保存先は保存せず、user/assistant 本文だけを取り込む。既知の credential 表記とローカルパスは既存処理で伏せる。turn の終了は Session 完了と扱わず、生ログは収録範囲 partial・status unknown とする。private log の実読込・アップロードは検証に使わない。

確認した公式形式: [Codex rollout fixture](https://github.com/openai/codex/blob/main/codex-rs/app-server/tests/common/rollout.rs)、[Codex ResponseItem/ContentItem](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/models.rs)、[Claude session reader](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/sessions.py)、[Claude session 保存先](https://code.claude.com/docs/en/agent-sdk/sessions)。本文の構造を参照し、上流コードはコピー・実行しない。

## 参考と検証

[cc-calendar](https://github.com/atinfinity/cc-calendar/tree/609f22d8c2e44923357f44715a3eee83e35161e1) の週表示・重複レーン・詳細導線を参考にした。MIT ©2026 atinfinity。コード・画像・assetsはコピーせず Tasken の既存 layout と Session 契約で実装する。上流の idle gap による実働推定や未知モデルの費用ゼロは採用しない。

合成データで parser・差分収集・時間表示・日次投影・関連付け・architecture audit 計55件、Core persistence 4件が成功。typecheck と build が成功。変更ファイル ESLint は error 0（既存の warning は残る）。既存 build の ::highlight warning は残る。

実 Electron smoke はファイル選択→Proposal確認→採用→保存→再起動を7 Session/5 providerで確認した。1760×1024 と390×844の画像を検査し、人のフォーカスと AI の同日表示、日／週移動、filters、詳細、成果展開、関連 Task を開く／閉じる、関連付け解除／再設定（task state は review のまま）、Escape／focus復帰、空表示、取込エラーを確認した。画像と結果は output/playwright/agent-work-logs に保存する。

保存先同期の実 Electron smoke は標準候補の確認・保存内容への同意・登録・新規同期・採用・同一ID更新・変更なし・取消・定期同期の有効/無効・解除・再起動・空/欠損を確認した。画像と結果は output/playwright/agent-log-sync に保存する。同期元には毎回作り直した合成フォルダーだけを使う。

未検証: Android 実機、本番配布、実ユーザーのログ、永続 Node REPL による対話操作。既存 Electron smoke の実操作と画像検査は実施済み。PC候補は別の一時保存先に合成データだけを持ち、通常版の入力を触らない。本番 PC・Fold・NAS、version draft、#546、既存 stash/worktree は変更しない。

## 保存先からの差分同期

PC の Activity に「ログ同期」を置く。サービス（Codex / Claude Code）を先に選び、PC のホームと CODEX_HOME / CLAUDE_CONFIG_DIR から作った保存先候補を提示する。候補表示だけではファイルを読まない。「場所を確認」で JSONL の件数と更新日時を確認し、保存内容と現在の Tasken 共有同期先を表示した上で利用者が登録する。Windows の環境変数は WSL 内部の設定を表さない。WSL / portable / 別プロファイルは所有者がフォルダーを指定し、ディストリビューションの起動やホーム全体の検索はしない。

登録場所はこの PC の userData にのみ保存する。「ログ同期」は新規・変更ファイルを読み取り専用で収集し、正規化した時刻・サービス・Session ID・秘匿処理済みの先頭依頼／最後の回答（各500文字以内）の提案を作る。生ログ・全文・tool / reasoning は保存も転送もしない。提案と採用した記録は既存の共有同期設定に従う。同期先が変わった場合は新しい収集を止め、保存先の再登録で確認を求める。採用前の変更は次回へ保留し（#629以降、提案は作成直後に採用される）、採用済み履歴は同一 Session を版確認付きで更新する。リンク・Task状態・既存の Agent 名・成果の補足を変更しない。新規ログだけから Repository や Task を推測せず、利用者が詳細から関連付ける。

### 採用待ちにせず履歴へ入れる（#629、2026-10-06）

ログ同期の記録は、提案を作った直後に既存の `ApplyAiProposal` 経路でそのまま Agent Session として保存する（actor `system:agent-log-sync`）。保存先の登録時に本人が読み込み内容と保存先を確認して許可しているため、1件ずつの採用は求めない。これはAIによる書き込みではなく本人のローカルログの読み込みであり、AIのProposal既定（AGENTS.md）を広げるものではない。外部AIからの他の提案は従来どおり採用待ちとする。

- 自動で保存できなかった記録や旧版で残った採用待ちは、接続hookの観測と同じく「受け身の観測」として扱い、対応待ちの件数・一覧に出さない（`isPassiveAgentSessionProposal`）。Debriefには観測として出る。
- 「ログ同期」の欄に、旧版で採用待ちのまま残った件数を出す。一括採用はしない（大半がsubagentのthreadだったため）。次のログ同期で全ファイルを読み直し、自分の会話は採用待ちを先に履歴へ入れてから更新し、委任threadの採用待ちは取り下げる。
- 依頼の要旨は、clientが付ける前置き（Codex IDE拡張の `# Context from my IDE setup … ## My request for Codex:`、Claude Code の `<ide_opened_file>` / `<ide_selection>` / `<system-reminder>`、slash command の包み）を外した本文にする（`userRequestText`）。前置きしかないメッセージは依頼として数えない。
- **委任thread**：Codexの `session_meta` で `thread_source` が `subagent` / `guardian_review`、または `parent_thread_id` を持つthread、Claude Codeで発言がすべてsidechainのファイル（`subagents/`）は、親の会話の一部として単独のSessionにしない。実測では本人のCodexログ1925件のうち約1550件がこれに当たった。
- **見出し**：`intent.title` に、Codexの `session_index.jsonl` の `thread_name`、Claude Codeの `custom-title`（なければ `ai-title`）を入れる。無い場合と旧記録は、依頼の最初の一文を40字までに切って使う（AIで要約しない）。依頼の全文は `intent.summary` と詳細に残す。
- **AIが動いた時間**：`observation.active_duration_ms` に、Codexは `task_complete` / `turn_aborted` の `duration_ms` の合計、Claude Codeは `cost-state` のAPI時間とツール時間の合計を入れる。clientの記録の合計であり、経過区間とは分けて表示し、実働時間・生産性とは呼ばない。記録が無ければ「未収録」。
- **依頼の抜粋**：1セッションの依頼を時刻順に最大5件×200文字だけ残す（`request_events`）。回答の途中経過・tool出力は残さない。
- parserの版（`NATIVE_AGENT_LOG_PARSER_VERSION`）をファイル指紋に含める。正規化を変えた版では、変更のないファイルも一度だけ読み直し、取り込み済みの Session は履歴の読み直し（版確認付き）で依頼の要旨・見出し・抜粋・AIが動いた時間も置き換える。読み直し以外の更新では、これまでどおり依頼の要旨を変えられない。

定期同期は初期状態で無効。利用者が有効にしたときだけ Tasken 起動中に5分ごとに動く。取消は完了済み提案を保持し、未処理を次回へ残す。欠損フォルダー、権限不足、未対応形式、空、書込み途中、資源上限を区別する。ファイルごと128MB、1行8MB、保存先ごと10000ファイル・100000エントリ・深さ6、1回512MB・120秒を上限に、ストリーム処理する。未完の末尾は次回再読込し、削除・ローテーションで既存記録を消さない。指紋は100件ごとと終了時に保存し、異常終了後の未保存分はCoreの提案識別と採用待ちの保留により再処理する。スマートフォンは正規化済み記録を表示し、PC の場所設定は行わない。

保存先候補の公式根拠: [Codex home の解決](https://github.com/openai/codex/blob/main/codex-rs/utils/home-dir/src/lib.rs)、[Codex rollout の保存構造](https://github.com/openai/codex/blob/main/codex-rs/app-server/tests/common/rollout.rs)、[Claude Code 保存先と環境変数](https://code.claude.com/docs/en/agent-sdk/sessions)。候補作成は文字列だけの処理であり、検証中に実ユーザーの保存先は開いていない。
