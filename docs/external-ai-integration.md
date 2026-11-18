# 外部AI連携

TaskenのTaskをClaude Code、Codex、GitHub Copilot CLIに依頼するための利用ガイドです。
Taskenは正本を保持し、外部AIはMCPで文脈を読み、結果をAgent Deskへ返します。
会話の成果をFeed・Note・Taskとして残す使い方は[会話から気軽に残す](#会話から気軽に残す)を参照してください。

## 最初の接続

Windows版Taskenと同じWindowsユーザーで、Nodeと各CLIを使います。
Taskenの「設定 → AI & Context → 接続設定をコピー」からserverの絶対パスを取得してください。
以下の`C:/path/to/Tasken/resources/mcp/server.mjs`をそのパスへ置き換えます。
既存の`tasken`登録がある場合は、先に`get`で内容を確認してください。

### Claude Code

```powershell
rtk claude mcp add --scope user --transport stdio tasken -- node C:/path/to/Tasken/resources/mcp/server.mjs
rtk claude mcp get tasken
```

ユーザー設定に登録するため、別のRepositoryでも利用できます。
新しい対話セッションで`/mcp`を開き、接続とツール権限を確認します。
解除は`rtk claude mcp remove --scope user tasken`です。

### Codex

```powershell
rtk codex mcp add tasken -- node C:/path/to/Tasken/resources/mcp/server.mjs
rtk codex mcp get tasken --json
```

ユーザーの`config.toml`に登録されます。同じホストのアプリ・CLI・IDE拡張で共有します。
新しいセッションの`/mcp`で接続を確認します。解除は`rtk codex mcp remove tasken`です。
Tasken停止時も他の作業を続けられるよう、通常設定では`required=true`を指定しません。

### GitHub Copilot CLI

```powershell
rtk copilot mcp add tasken -- node C:/path/to/Tasken/resources/mcp/server.mjs
rtk copilot mcp get tasken
```

ユーザーの`.copilot/mcp-config.json`に登録されます。
新しいセッションで`/mcp`を確認し、Taskenのツール利用を許可します。
解除は`rtk copilot mcp remove tasken`です。
AIの作業の記録は、AIが`tasken.report_work`で書く1件と、Desktopが登録済みの保存先のログから拾う1件です（hooksは使いません。前に入れたhooksの外し方はREADME）。
ここでの登録・実接続確認はCopilot CLIが対象です。VS Code内のGitHub CopilotやWeb版とは設定を区別し、それらへの接続は未検証です。

### 接続できない場合

Taskenを起動して、Repositoryから次を実行します。

```powershell
rtk node scripts/mcp-doctor.mjs --server C:/path/to/Tasken/resources/mcp/server.mjs --json
```

省略時はRepositoryの`scripts/mcp-server.mjs`を検査します。
`--node`にはAI側で使用するNodeの絶対パスも指定できます。
診断はCoreのhealth・認証・capabilitiesを確認後、指定したMCPを実際に起動し、ツール・Prompt・Resourceの一覧と`list_open_items`の読み取りを確認します。
Task本文は出力せず、書き込みやProposal送信もしません。
`write_available=false`なら書き込みのツールが公開されていません。読み取り専用設定またはMCP bridgeの版を確認してください。
診断成功と、各AIの権限・モデルによる作業完遂は別の検証です。

配布版TaskenのSettingsがコピーするMCP設定には、開発用環境変数を継承しないため
`env: { "TASKEN_USER_DATA_DIR": "" }`が含まれます。Portable版・インストーラー版とも、
設定は各WindowsのTaskenから生成してください。server pathはインストール先に依存するため、
別端末へ設定JSONだけをコピーしないでください。
独自の保存先を使う開発版では、診断と各MCP設定の`env`に同じ`TASKEN_USER_DATA_DIR`を設定します。
起動中Taskenの保存先と一致させ、discoveryファイルやtokenを手でコピーしないでください。
調べるだけの接続には`TASKEN_MCP_READ_ONLY=1`を設定できます。
アプリを移動した場合は、各クライアントのserverパスも更新します。
WSL・別PC・Web版AIからの接続はこのWindows用設定では検証していません。

## 日常の一周

AIへの仕事の頼み方は、AIとの会話で伝えることだけです。AI Readyの切り替え・依頼文のコピー・MCPの開始（`start_task_work`）は外しました（#755 束10a）。TaskenからCLIを起動する機能もありません。

1. 設定 → AI & Context の「ローカルのAIに直接の書き込みを許す」が有効であることを確かめます（新しい版の最初の起動で一度だけ有効になります。PCごとの設定です）。
2. 普段使うAIに、会話でTaskを伝えます。AIは`search_items`や`get_task_context`で対象と作業先を確かめます。
3. AIは、あなたの言葉を`said`に写して`change_task`でTaskを編集・完了・再開します（`undo_change`で取り消せます）。新しいTaskやNoteは`create_task`・`create_note`で作ります。どれもAIの操作として記録され、日誌のActivityから取り消せます。
4. 作業の終わりに、AIは`report_work`を`task_id`なしで一度呼び、自分の作業を1件残します（案を通さず、Taskは変えません）。

前の版で委任したTask（作業中・確認待ち）への報告は、`task_id`を付けた`report_work`で送ると、これまでどおり案として届きます。人がFeedで採用し、Taskの完了は別に判断します。検証済みのチェック項目IDを`completed_checklist_item_ids`に添えると、採用時に反映されます。同じ`idempotency_key`で内容を変えると競合になるため、再送時は日時・内容も維持します。作業単位ID（`work_attempt_id`）と`request_id`の扱いは [agent-work-contract.md](./agent-work-contract.md)。

## 会話から気軽に残す

Taskを任せるほどではない発見や文章も、既存の入口へそのまま送れます。接続済みのAI（ChatGPT・Codex・Claudeなど）に、次の使い分けを伝えてください。

| 残したいもの                         | 入口                       | 人の手間                                 |
| ------------------------------------ | -------------------------- | ---------------------------------------- |
| 気づき・比較・参考情報・短い学び     | `tasken.propose_feed_post` | 読むだけ。採用は不要                     |
| 残しておきたいまとまった文章         | `tasken.propose_note`      | 必要ならプレビューして採用               |
| レイアウトを保ちたい報告書（HTML等） | `tasken.propose_artifact`  | プレビューして採用。Taskにも紐づけられる |

Feedへの投稿は届いた時点でFeedに表示され、**採用操作は要りません。** 正式Note・Taskになるのは人が採用したときだけです。どちらなのかは各呼び出しの`message`と`payload_type`で区別できます。

MCPの案内は、依頼された作業で検証した再利用可能な発見を自発的に残すようAIへ伝えます。意外な制約、落とし穴、原因と対策、比較やトレードオフが対象です。短い発見はFeedへ、仕組みや再現手順を説明したい場合は`propose_feed_post`の`article`へ技術記事草稿を添えます。独立した記事は`propose_note`を使います。
投稿数のノルマはありません。新しい発見がなければ投稿せず、既出内容や定例進捗の転載を避け、同じ発見はまとめます。観測と推測を分け、秘密情報は含めず、記事のために依頼外の調査を増やしません。記事草稿は採用前でも読めますが、正式Note化には人の採用が必要です。これらの投稿はTaskの成果・中断報告を置き換えません。

AIへ渡す依頼文の例:

> Tasken MCPを使えます。依頼された作業で検証した、あとでも役立つ技術的な発見は、追加の依頼を待たず`tasken.propose_feed_post`で短く残してください。仕組みや再現手順まで説明すると役立つ場合は`article`に技術記事草稿を添え、独立した記事には`tasken.propose_note`を使ってください。ThemeやTaskが決まっていなければ省略できます。観測と推測を分け、秘密情報や依頼外の調査は含めません。毎回の要約や既出内容の繰り返しは不要で、新しい発見がなければ投稿しません。記事の採用や外部公開はせず、Taskの成果・中断報告は別に行ってください。

再送する可能性があるときは、`idempotency_key`を自分で決めて同じ内容で使い回します。省略すると呼び出しごとに新しいkeyになるため、同じ依頼の再送が別の投稿として増えます。`recent_post_ids`は互換のために受け取るだけで、Tasken側では重複判定に使いません。重複を避けるときは`tasken.get_feed_context`で最近の投稿を確認してください。

ChatGPTのWeb版は、MCPコネクタの対応状況がアカウントとワークスペースに依存します。接続できる場合も、どの入口が許可されているかは接続先の`tools/list`で確認してください。読み取り専用の接続では書き込みtoolが公開されません。

## 読み取り専用のローカルクライアント

MCPを経由しない同じPC上の道具（個人のコンテキスト・ハブなど）は、Coreの全権tokenを持たずに、クライアント別の読み取り専用tokenで検索できます。

```bash
node scripts/tasken-core-client.mjs issue awai > ~/AppData/Roaming/awai/tasken-token   # tokenは標準出力に一度だけ出る
node scripts/tasken-core-client.mjs list                                                # 名前・作成日時・取り消し状態だけ
node scripts/tasken-core-client.mjs revoke awai                                         # 次の要求から401
```

- 通るのは`/v1/queries/*`と`/v1/task/query`の読み取りだけです。Proposalの状態（`get-proposal-status`、`list-proposals`）と、書き込み・Proposal作成の`/v1/commands/*`は`403 READ_ONLY_CLIENT`になります。汎用のTask変更（`/v1/task/command`）は、どのtokenにも公開していません。
- Coreのポートは起動ごとに変わります。接続先は、tokenを含まない`<userData>/core-endpoint/tasken-core-endpoint.json`の`origin`から読みます。全権tokenを含む`tasken-core.json`は読まないでください。別のコンテナの読み手（NAS の awai）には、`core-endpoint/`のフォルダだけを読み取りで渡します（Coreはファイルをrenameで置き直すので、ファイルだけを渡すと古い中身が見え続けます）。
- tokenはuserDataの`tasken-core-clients.json`にSHA-256だけが保存されます。取り消しはCoreの再起動なしで反映されます。再発行は取り消してから行います。
- Windows PowerShell 5の`>`はUTF-16で書くため、Git BashかPowerShell 7で実行してください。

## その他の入口

| 目的                 | 入口                                                 | 返り先                     |
| -------------------- | ---------------------------------------------------- | -------------------------- |
| 日報                 | MCP Prompt `daily-report`、Debriefの依頼文           | Note Proposal → Agent Desk |
| 選択会話を公開する   | Conversation AI Context（`conversationContext.mjs`） | 明示公開したMarkdown       |
| AI作業の履歴を集める | `tasken.report_work`、日誌の「AI のログから拾う」    | AI の作業／日誌            |

Context Packから構造化JSONを貼り戻して既存Taskを更新するUIは、現在のAgent Deskにはありません。
新規Taskの作成には、Today・ToDoの[外部AI取り込み](mobile-capture-organizer-providers.md)で自然文を外部AIへ渡し、返ってきたJSONをプレビューして採用できます。
MCPツールの正確な引数は接続先の`tools/list`、Contextの選び方は[Context設計](tasken-context-architecture.md)を参照してください。

## 検証と設定の出典

### 2026-09-05の実機確認

完了済み:

- Windowsのユーザー設定でCodexの既存登録を確認し、Claude CodeとCopilot CLIに`tasken`を登録。
- 一時データ専用のTaskenとMCPを使い、Codex・Copilot CLIのモデルからAI Ready一覧を実際に読み取り。
- DesktopのToday・ToDoでAI Ready保存後の自動コピー、解除時のクリップボード保持、コピー失敗後の保存保持と手動再コピーを確認。
- 実stdio MCPで開始・完了報告後、再読み込みなしでAgent Deskから採用し、Task完了とReceipt保存を確認。
- 開始コマンドのschema version不一致と、Core経由の開始後にDesktopへ変更通知が届かない不具合を修正。後者はDesktop compositionを通す回帰テストを追加。
- 関連30テスト、AI協働E2E 2テスト、型検査、Desktop buildが成功。

残作業・未検証:

- このPCのClaude CodeはOAuth認証期限切れで未検証。利用先は会社PCで、利用者から過去の接続成功を確認済み。今回の変更を使った結果は会社PCでのフィードバック待ち。
- ユーザー設定はインストール済みTaskenの`resources/mcp/server.mjs`を参照している。このPCは下記のローカル更新まで完了。GitHub公開リリースと会社PCへの更新は未実施。
- 実際の個人Taskを書き換える検証は行っていない。上記の作業開始・採用はすべて隔離したテストデータ。

### 同日のローカル更新

- インストール済みTaskenを0.1.45から0.1.49へ更新。通常のNSISインストーラーが終了コード0で完了し、実行ファイルのversionも0.1.49を確認。
- 更新前のDB・WAL・SHMを`C:/Users/ootan/AppData/Local/TaskenUpdateBackups/before-0.1.49-20260905`へコピーし、コピー前後のハッシュ一致を確認。
- installer / portableを作成し、配布版のMCP smokeとlive Proposal smokeが成功。インストール先の実行ファイルでもMCP smokeが成功し、同梱MCPのハッシュが検証済みbuildと一致。
- 作業ブランチは`codex/local-update-0.1.49`。未コミットで保持し、push・タグ作成・GitHub Release公開は行っていない。
- 新しいMCPを使うにはTaskenを起動し、AIクライアントの既存セッションは再接続または新規セッションへ切り替える。会社PCのClaude Codeでの実使用フィードバックは別途確認する。

### 2026-09-08の隔離検証

一時userDataで実Electronとstdio MCPを使い、報告の採用だけではTaskを完了しないこと、人が別操作で完了できること、完了後の追加報告でTask本文・完了状態を維持することを確認しました。
Agent Deskの項目名プレビューから指定Checklist itemだけをチェックし、古いTask versionのチェック報告は採用を拒否してプレビューを保持することも確認しました。

### 2026-09-26の実クライアント往復（Codex CLI）

実プロファイルのTasken（v0.1.69）へ、ユーザー設定のCodex CLI `0.155.1` から接続して一往復を通しました。

- `codex exec --json -s read-only` で `tasken.list_agent_ready_tasks` を実行し、実データを読めることを確認。
- `get_task_context` → `start_task_work`（`applied`）→ `append_work_receipt`（Proposal）→ `report_task_blocked`（Proposal）→ 実機Androidから回答 →
  `get_task_context` で `human_reply` を取得 → `report_task_done`（Proposal）→ Desktopで採用。
- **採用してもTaskは完了しない**（`state === "todo"` のまま）。3 Proposal は採用後に `accepted`、Receipt 4件が正式化。
- 同じTaskをDesktopで編集した後に古い `expected_version` で開始すると `CONFLICT`（`retryable: false`）になる。再送せず読み直すのが正しい。

実クライアント特有の注意:

- Codexのツール一覧には、ユーザー設定の `tasken` MCP と、Codexアプリ側が公開する `tasken.tasken.*` の**2経路が見える**。
  後者を選ぶと `get_task_context` が `not_found` になる（別環境を見ている）。`tasken.*` を明示して使う。
- 作業報告（今の名前は `report_work`）はProposalを作るだけで**Taskのversionを進めない**。
  続けて送るときの `expected_version` は据え置きになる。

### 参照先

- [AI collaboration E2E](ai-collaboration-e2e.md): 一時DB・実stdioによる着手、報告、採用、再起動の検証。
- `tests/mcp-runtime.test.mjs`: 起動不能、無応答、Core停止、読み取り専用、診断からの内容漏出防止。
- [Claude Code MCP](https://code.claude.com/docs/en/mcp)、[Codex MCP](https://developers.openai.com/codex/mcp/)、GitHub Copilot CLIの`copilot mcp --help`で登録方法を確認（2026-09-05）。
