# 外部AI連携

TaskenのTaskをClaude Code、Codex、GitHub Copilot CLIに依頼するための利用ガイドです。
Taskenは正本を保持し、外部AIはMCPで文脈を読み、結果をAI Inboxへ返します。

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
TaskenのAgent Session hooksは別の機能で、MCP登録の代わりにはなりません。
ここでの登録・実接続確認はCopilot CLIが対象です。VS Code内のGitHub CopilotやWeb版とは設定を区別し、それらへの接続は未検証です。

### 接続できない場合

Taskenを起動して、Repositoryから次を実行します。

```powershell
rtk node scripts/mcp-doctor.mjs --server C:/path/to/Tasken/resources/mcp/server.mjs --json
```

省略時はRepositoryの`scripts/mcp-server.mjs`を検査します。
`--node`にはAI側で使用するNodeの絶対パスも指定できます。
診断はCoreのhealth・認証・capabilitiesを確認後、指定したMCPを実際に起動し、ツール・Prompt・Resourceの一覧とAI Readyの読み取りを確認します。
Task本文は出力せず、着手やProposal送信もしません。
`task_work_available=false`なら着手ツールが公開されていません。読み取り専用設定またはMCP bridgeの版を確認してください。
診断成功と、各AIの権限・モデルによる作業完遂は別の検証です。

独自の保存先を使っている場合は、診断と各MCP設定の`env`に同じ`TASKEN_USER_DATA_DIR`を設定します。
起動中Taskenの保存先と一致させ、discoveryファイルやtokenを手でコピーしないでください。
調べるだけの接続には`TASKEN_MCP_READ_ONLY=1`を設定できます。
アプリを移動した場合は、各クライアントのserverパスも更新します。
WSL・別PC・Web版AIからの接続はこのWindows用設定では検証していません。

## 日常の一周

1. Taskenで完了条件と関連Themeを整え、TaskをAI Readyにします。デスクトップでは保存成功後に依頼文を自動コピーします。
2. 普段使うAIに依頼文を貼り付けます。Taskドロワーの「依頼文をコピー」から取り直せます。解除時や既存AI Readyの編集時はクリップボードを変えません。コピー失敗時もAI Readyは保存され、再コピーの案内を表示します。
3. AIは`get_task_context`で対象と作業先を確認し、実際に着手するときだけ`start_task_work`を呼びます。
4. AIは通常、完了時に最新versionで`report_task_done`を一度だけ送ります。完了直前に同じ結果を`append_work_receipt`で送る必要はありません。途中報告は長期作業で必要なとき、中断報告は人の対応が必要なときに使います。`reported_at`にはAIが作業を終えた時刻を指定します。
5. 人がAI InboxでTaskごとの時系列を確認し、「採用してTaskを完了」を押します。確認した過去報告も同時に履歴化します。ActivityとDebriefのAI作業期間は、採用日時ではなく開始・報告時刻で表示します。

AI ReadyにしただけではAIを起動せず、定期実行も開始しません。
まずは必要なときに依頼する運用とし、自動巡回が必要になった場合に実行間隔と対象を決めます。

一覧から相談したいときは、次を外部AIに渡します。

> Tasken MCPでAI ReadyのTaskを確認し、今の作業先で扱える候補を示してください。今回は一覧とContextの確認までにしてください。

作業を任せるときは対象Taskを指定し、次の手順を使います。

1. `get_task_context`へTask IDと現在のworkspace情報を渡す。対象、完了条件、Repositoryの一致を確認し、曖昧なら着手前に確認する。
2. AI Readyを確認して`start_task_work`を送る。`expected_version`、`caller`、`idempotency_key`、ISO日時の`started_at`を指定する。成功したら最新のTask/versionを読み直す。
3. 作業と検証を行い、結果に応じて`report_task_done`または`report_task_blocked`を送る。必要な途中報告は`append_work_receipt`を使う。
4. `queued`は人の採用待ち。Proposal ID、実施した検証、残作業を伝えて依頼を閉じる。AI自身は採用しない。

通信結果が不明な同じ要求を再送するときはkey・日時・内容を維持します。
version競合はTaskを読み直して内容を再判断します。新しい要求として送る場合は新しいkeyにします。
作業開始は直接保存されますが、結果報告は採用まで正式反映されません。
既存のReceipt採用経路は、開始を省略したAI Ready Taskにも開始記録を補います。

## その他の入口

| 目的                     | 入口                                                  | 返り先                   |
| ------------------------ | ----------------------------------------------------- | ------------------------ |
| 日報                     | MCP Prompt `daily-report`、Debriefの依頼文            | Note Proposal → AI Inbox |
| 学びのコラム             | MCP Prompt `learning-column`                          | 提案内容を確認して採用   |
| 選んだ資料を任意AIへ渡す | [Context Pack](context-pack.md)                       | 通常Noteとして回答を保存 |
| M365へThemeを渡す        | [Theme AI Pack](theme-ai-pack.md)                     | OneDrive上の読み取り投影 |
| 選択会話を公開する       | [Conversation AI Context](conversation-ai-context.md) | 明示公開したMarkdown     |
| AI作業の履歴を集める     | [Agent Session hooks](agent-session-provenance.md)    | Session記録／Debrief     |

Context Packから構造化JSONを貼り戻してTaskへ適用するUIは、現在のAI Inboxにはありません。
MCP以外の往復が必要になった際の追加候補です。
MCPツールの正確な引数は接続先の`tools/list`、Contextの選び方は[Context設計](tasken-context-architecture.md)を参照してください。

## 検証と設定の出典

### 2026-09-05の実機確認

完了済み:

- Windowsのユーザー設定でCodexの既存登録を確認し、Claude CodeとCopilot CLIに`tasken`を登録。
- 一時データ専用のTaskenとMCPを使い、Codex・Copilot CLIのモデルからAI Ready一覧を実際に読み取り。
- DesktopのToday・ToDoでAI Ready保存後の自動コピー、解除時のクリップボード保持、コピー失敗後の保存保持と手動再コピーを確認。
- 実stdio MCPで開始・完了報告後、再読み込みなしでAI Inboxから採用し、Task完了とReceipt保存を確認。
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

### 参照先

- [AI collaboration E2E](ai-collaboration-e2e.md): 一時DB・実stdioによる着手、報告、採用、再起動の検証。
- `tests/mcp-runtime.test.mjs`: 起動不能、無応答、Core停止、読み取り専用、診断からの内容漏出防止。
- [Claude Code MCP](https://code.claude.com/docs/en/mcp)、[Codex MCP](https://developers.openai.com/codex/mcp/)、GitHub Copilot CLIの`copilot mcp --help`で登録方法を確認（2026-09-05）。
