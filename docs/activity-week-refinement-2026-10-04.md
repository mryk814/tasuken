# 日次 Activity と AI 作業ログの改善

既存 Activity を主画面にし、人の操作・フォーカスと AI セッションを同じ日の時間軸へ表示する。PC は重複をレーンで分け、390px の画面は時刻・依頼・成果要約・Repository の一覧から詳細を開く。週表示は補助の振り返りとして折りたたむ。タスクに関連付け済み／未関連を、読み上げラベルと tooltip のあるリンクアイコンで区別する。

詳細から既存タスクを後から関連付け・解除できる。関連付けは user origin の worked_on reference を追加し、重複を作らない。解除は既存の reference 削除 API を使い、セッションの成果・出典やタスクの状態を変えない。superseded は置き換え先 assertion を要求する契約なので、解除の代用には使わない。変更対象・判断・次の提案・確認結果も詳細で読める。

日境界・時刻・取り込み後の表示日は JST で統一する。終了未確認を現在まで伸ばさず、履歴は最終観測までに制限する。経過時間を実働時間と扱わず、費用と実働時間は未収録と示す。日跨ぎと同時セッションを保持し、日付移動では詳細を閉じる。

## hooks を使わない取り込み

日次画面の取込アイコンから、利用者が必要なときに生ログのファイルを選ぶ。Codex rollout と Claude Code transcript の JSONL を直接扱い、既存 Proposal の確認・採用を経て保存する。版付き tasken-ai-work-log/1 の従来5 provider契約も継承する。Copilot・OpenCode・DeepSeek の生ログ一般には対応したと主張しない。

Codex は CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl、Claude は CLAUDE_CONFIG_DIR/projects 配下（既定 ~/.claude/projects）の単一 Session JSONL が対象。自動探索・監視、hooks の追加／設定変更、新しい権限は必要としない。画面更新は保存済みデータの読み直しで、自動収集ではない。既存の hooks 経由記録も表示できるが、この入口の前提ではない。

2MB、20000行、依頼・回答各200件という上限を維持する。壊れた行、複数 Session 混在、時刻のタイムゾーン不足、同じ発言 ID の矛盾を拒否する。選んだファイル内の path を追って別ファイルを開かない。推論・tool IO・system/developer・メタ指示・添付・保存先は保存せず、user/assistant 本文だけを取り込む。既知の credential 表記とローカルパスは既存処理で伏せる。turn の終了は Session 完了と扱わず、生ログは収録範囲 partial・status unknown とする。private log の実読込・アップロードは検証に使わない。

確認した公式形式: [Codex rollout fixture](https://github.com/openai/codex/blob/main/codex-rs/app-server/tests/common/rollout.rs)、[Codex ResponseItem/ContentItem](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/models.rs)、[Claude session reader](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/sessions.py)、[Claude session 保存先](https://code.claude.com/docs/en/agent-sdk/sessions)。本文の構造を参照し、上流コードはコピー・実行しない。

## 参考と検証

[cc-calendar](https://github.com/atinfinity/cc-calendar/tree/609f22d8c2e44923357f44715a3eee83e35161e1) の週表示・重複レーン・詳細導線を参考にした。MIT ©2026 atinfinity。コード・画像・assetsはコピーせず Tasken の既存 layout と Session 契約で実装する。上流の idle gap による実働推定や未知モデルの費用ゼロは採用しない。

合成データで時間表示・日次投影・関連付け・生ログ parser 33件、architecture audit 18件、Core persistence 2件が成功。typecheck と build が成功。変更ファイル ESLint は error 0（Activity の既存 warning 3件）。既存 build の ::highlight warning は残る。

実 Electron smoke はファイル選択→Proposal確認→採用→保存→再起動を7 Session/5 providerで確認した。1760×1024 と390×844の画像を検査し、人のフォーカスと AI の同日表示、日／週移動、filters、詳細、成果展開、関連 Task を開く／閉じる、関連付け解除／再設定（task state は review のまま）、Escape／focus復帰、空表示、取込エラーを確認した。画像と結果は output/playwright/agent-work-logs に保存する。

未検証: Android 実機、本番配布、実ユーザーのログ、永続 Node REPL による対話操作。既存 Electron smoke の実操作と画像検査は実施済み。PC候補は別の一時保存先に合成データだけを持ち、通常版の入力を触らない。本番 PC・Fold・NAS、version draft、#546、既存 stash/worktree は変更しない。
