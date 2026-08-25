# Tasken Context architecture

## Purpose

Taskenは、AIへ渡す情報量を増やすためではなく、仕事の目的・現在地・証拠を失わず、用途ごとに必要な量だけ再構成するためにContextを持つ。

AIで仕事を速めても、利用者が判断と学習の所有権を失わないことを最上位の目的とする。

## Referent map

| Source                                | Purpose                          | Concrete referent                                              | Role                         | Relation                | Label               |
| ------------------------------------- | -------------------------------- | -------------------------------------------------------------- | ---------------------------- | ----------------------- | ------------------- |
| 利用者がThemeへ書く比較的安定した意図 | Themeの存在理由を保つ            | 目的、到達像、原則、範囲、長期の問い、学習関心                 | canonical human record       | Themeに一つ             | Theme Charter       |
| 利用者がThemeへ書く現在の理解         | いま考えていることを保つ         | 現在の方向、問い、仮説、障害、未決定、次の地平                 | canonical human record       | Themeに一つ、上書き更新 | Theme State         |
| 既存のStatus Update                   | Themeの推移を後から辿る          | 日付、概要、進捗、リスク、次アクション                         | canonical dated history      | Themeに複数             | 現在地の履歴        |
| Taskの任意の短文                      | タイトルだけでは落ちる一言を残す | 背景、違和感、避けたい方向                                     | canonical lightweight record | Taskに最大一つ          | Task Context / memo |
| hookとAgent Sessionから得た記録       | 実際に起きたことを保つ           | prompt event、response checkpoint、commit、files、verification | observed evidence            | Sessionに複数           | Session Packet      |
| 一つの正本から用途別に選んだ応答      | AIへ必要量だけ渡す               | Theme意図、Task、関連作業、判断、証拠、学習履歴の部分集合      | derived read-only projection | requestごとに生成       | Context View        |

`Theme State`は既存Entityの`state`（active / archived等）とは別物である。保存名は衝突を避けて`theme_state`とする。

## Canonical records

### Theme Charter

`theme_charter`は`tasken-theme-charter/v1`としてTheme Entityへ保存する。全項目は任意で、空でもThemeは成立する。

- `purpose`: なぜこのThemeを続けるのか
- `desired_outcome`: どうなれば嬉しいか
- `principles`: 守りたい判断原則
- `scope`: 扱う範囲
- `non_goals`: 扱わないもの
- `long_term_questions`: 長く考えたい問い
- `learning_interests`: このThemeを通じて理解したいこと

### Theme State

`theme_state`は`tasken-theme-state/v1`としてTheme Entityへ保存する。Charterより速く変化するが、Sessionから自動上書きしない。

- `current_direction`: 現在有力な方向
- `active_questions`: いま答えが出ていない問い
- `current_bets`: 試している仮説・方針
- `blockers`: 進行を止めている条件
- `unresolved_decisions`: まだ利用者が決めていないこと
- `next_frontier`: 次に掘りたい領域
- `updated_at`: 利用者がTheme Stateを変更した時刻

AIはTheme Stateの更新案を作れても、正式Entityを直接書き換えない。既存のAI Proposal境界を通し、利用者が確認・採用する。

### Task Context / memo

新しい構造化入力は作らない。既存のTask `description`を任意の短いContextとして利用する。タイトルだけで十分なTaskは空欄のまま成立する。

## Context Views

Context Viewはcanonical dataを複製保存しない。すべてread-only、bounded、provenance付きの派生応答とする。

### Work Context

実装・調査を始めるAI向け。

- Theme Charterの目的・原則・範囲
- Theme Stateの現在方向・active questions・blockers
- Current Taskのtitle・任意memo・状態・assignment
- 関連Repository、直近Session、Work Receipt、verification
- 未完了・未検証

### Planning Context

次の方針を考えるAI向け。

- Theme Charter全体
- Theme State全体
- open tasks / waiting / milestones
- recent human decisions
- unresolved questionsとrecent activity

### Debrief Context

一日の判断を本人へ戻すための既存View。

- 当日のSession PacketとEvidence strength
- 関連Themeのpurpose・current direction
- 直近のHuman reflection
- AIは`My decision`と`Next return`を代筆しない

### Learning Context

AI Columnの編集者向け。

- Themeのpurpose・current questions・learning interests
- recent sessions、bugs、diff、verification、design decisions
- 過去の記事題材と利用者の反応
- 既出回避に必要なLearning History

良い題材がなければ空の候補を返してよい。記事生成を成立させるために一般論を水増ししない。

## 現行のエージェント設計との対応

Taskenは、正本を毎回丸ごとpromptへ詰め込まない。常時見せるThemeの意図は小さく保ち、Task、Session、commit、検証結果などの証拠はIDとrelationを手掛かりに必要時だけ取得する。これは「hot context + just-in-time retrieval」の構成である。

MCPのsurfaceは制御主体で分ける。

- Prompt: 利用者がDebriefやLearning Columnを明示的に始める入口
- Resource: Taskenが管理するCharter / Stateの安定したread-only参照
- Tool: AIが目的に応じてWork / Planning / Debrief / Learning Contextを取得する操作
- Task: MCP仕様ではexperimentalのため、Taskenの中心モデルには依存しない

Context Viewには`view_id`、`generated_at`、`content_hash`、`budget`、`source_versions`を付ける。同じ正本からいつ、どの上限で投影したかを判別できるようにし、応答本文は`context_selection`のincluded / excluded理由へ接続する。

Session、Memory、Trace、Stateは統合しない。

- Session Packet: 会話と作業の観測記録
- Trace / Activity: toolや状態遷移の時系列証拠
- Memory: 証拠から抽出した再利用可能な派生知識
- Theme State: 人間が確認した現在地

検索はまずstructured filter、明示relation、完全一致、recencyを使う。Issue番号、commit hash、関数名、エラーコードを落としやすいsemantic searchを正本の探索経路にはしない。必要性が確認できた時点でlexical + semantic + rerankへ拡張する。

参考:

- [Anthropic: Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Model Context Protocol: Server features](https://modelcontextprotocol.io/specification/2025-11-25/server/index)
- [OpenAI: Harness engineering](https://openai.com/index/harness-engineering/)
- [OpenAI Agents SDK: Sessions](https://openai.github.io/openai-agents-python/ref/memory/session/)
- [Anthropic: Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval)

## Context selection rules

1. AI visibilityを通過したEntityだけを候補にする。
2. 明示されたTaskまたはThemeをseedとし、relation pathを失わない。
3. purposeごとにfieldと件数の上限を持ち、巨大dumpを返さない。
4. raw transcript、hidden reasoning、tool call列、credential、absolute local pathを返さない。
5. `observed`、`agent_reported`、`inferred`を混ぜない。
6. canonical human record、observed evidence、derived projectionを応答上でも区別する。
7. 除外・打ち切りは無言にせず、reasonとlimitを返す。

## Non-negotiable compatibility conditions

1. 既存Theme、Task、Status Update、Session Packet、Debrief、Snapshot、Import / Exportを読み続ける。
2. Themeの概要`description`と日付付きStatus UpdateをCharter / Stateへ黙って移行しない。
3. 空のCharter / Stateを入力必須にせず、既存Themeをそのまま保存・表示できる。
4. MCPの既存`get_task_context`、`get_theme_context`、`get_debrief_context`のread-only・visibility・bounded契約を弱めない。
5. Context ViewはTaskやThemeの状態を変更せず、AI報告から完了・判断・学習済みを推定保存しない。
6. Rendererは汎用DBやfilesystemへ直接アクセスせず、既存の保存境界とCore queryを使う。

## Learning loop

AI ColumnはContext基盤の後段に置く。

1. `Learning Context`から複数の題材候補を見つける。
2. personal relevance、surprise、generalizability、learning gap、technical depth、story quality、freshnessで一本を選ぶ。
3. 実際の出来事から問いを立て、一般原理と一段遠い接続へ進み、最後に自分のコード・研究へ戻る。
4. 読んだ、面白かった、既知だった、もっと知りたい、をLearning Historyへ利用者の反応として保存する。
5. 反応は次の記事選定に使うが、すべての記事を教材や復習課題へ変えない。

### Learning Historyの状態

記事生成や閲覧を学習完了として保存しない。少なくとも次の状態を別々の事実として扱う。

- `article_generated`
- `article_opened`
- `question_answered`
- `concept_explained_by_user`
- `later_reused`

最初のContext基盤ではLearning Historyを正本化せず、Learning Contextが「学習済み」を推定しない契約までを実装する。実際の読書・回答体験を接続するときに、利用者の操作から各状態を明示的に記録する。

## Completion boundary

Context基盤の一周は、Theme Contextを作成・保存し、再起動後に再表示でき、同じ内容がWork / Planning / Debrief / Learningの各Viewへ目的別に投影され、AI visibilityと上限が守られるところまでとする。
