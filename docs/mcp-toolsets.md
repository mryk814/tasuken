# MCPのツール選択と軽量化

MCP bridgeは接続ごとに公開するツールを選べます。stdioでは環境変数`TASKEN_MCP_TOOLSETS`、HTTPでは既存のクライアント設定内の`toolsets`配列を使います。未指定は`all`です。これはツール一覧の選択であり、Coreの権限を付与する設定ではありません。

## セットの内容

| セット      | ツール（`tasken.`は省略）                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `core`      | `search_items`, `list_open_items`, `get_task_context`, `get_note`, `search_notes`, `get_activity`                                                |
| `coding`    | `resolve_repository_context`, `get_repository_context`, `get_agent_session_context`, `list_agent_ready_tasks`, `get_task_assignment`             |
| `context`   | `get_theme_context`, `get_feed_context`                                                                                                          |
| `proposals` | `get_proposal_status`, `list_proposals`                                                                                                          |
| `meta`      | `get_capabilities`                                                                                                                               |
| `write`     | `start_task_work`, `report_work`, `create_task`, `create_note`, `propose_note`, `propose_note_edit`, `propose_feed_post`, `answer_feed_question` |
| `all`       | 上記6セット。互換用の`legacy`は含めない                                                                                                          |
| `legacy`    | 旧名`append_work_receipt`, `report_task_done`, `report_task_blocked`                                                                             |

複数指定は和集合です。空配列・空文字・未知のセット名は起動エラーにし、全公開へフォールバックしません。正本は`src/main/mcp/toolAvailability.mjs`の`MCP_TOOL_REQUIREMENTS`です。

## 接続設定

stdioでは、起動するbridgeの環境に`TASKEN_MCP_TOOLSETS=core`を渡すと6ツールになります。コーディング連携には`core,coding,meta`などを指定できます。書き込みを使う場合は必要なセットに`write`を追加し、Core側の許可と`TASKEN_MCP_READ_ONLY`も確認してください。

HTTPでは`TASKEN_MCP_HTTP_CLIENTS_FILE`の既存の各クライアント項目へ`"toolsets": ["core"]`などを追加します。認証情報はそのまま保持し、この例だけで設定ファイルを置き換えないでください。クライアントの`toolsets`が未指定ならHTTP bridgeの`TASKEN_MCP_TOOLSETS`を継承し、それも未指定なら`all`です。指定した配列は環境変数の選択を置き換えます。クライアント間で選択は共有されません。

`TASKEN_MCP_READ_ONLY`とHTTPのクライアント別`readOnly`は従来どおり書き込みを制限します。読み取り専用なら`write`や`legacy`を指定しても書き込みは公開されません。Core capabilityと配備profileによる拒否も維持します。実際の設定変更やNASへの反映は別作業です。

`meta`を含めると`get_capabilities`で`bridge.toolsets`と各ツールの`listed`・`available`・`reason`を確認できます。セット外は`toolset_not_enabled`、読み取り専用による書き込み拒否は優先して`bridge_read_only`です。`writes`も接続で利用できる入口を反映します。外したツールの呼び出しはSDKのunknown toolエラーになります。

## 作業報告と互換性

新しい入口は`tasken.report_work`です。

| `status`   | 従来の入口            | 保存するaction   | 条件付き必須欄             |
| ---------- | --------------------- | ---------------- | -------------------------- |
| `progress` | `append_work_receipt` | `append_receipt` | `summary`, `executor_kind` |
| `done`     | `report_task_done`    | `report_done`    | `summary`, `executor_kind` |
| `blocked`  | `report_task_blocked` | `report_blocked` | `blocker`                  |

共通で`task_id`・`expected_version`・`idempotency_key`・`caller`・`executor_label`が必要です。人に質問するときは`request_id`に安定したUUIDを付けます。従来どおり任意欄であり、単なる障害報告には必須ではありません。再送時は日時・版・内容・キーを保持します。Proposalの保存形式、旧requestのtool識別子、採用・再送判定は変更しません。`done`も人が採用する報告であり、Taskの完了は別の人間操作です。

旧3名は既定の一覧から外しました。移行期間に必要なら`TASKEN_MCP_TOOLSETS=all,legacy`、HTTPなら`"toolsets": ["all", "legacy"]`で追加できます。外部クライアントのツールキャッシュは再読み込みしてください。読み取り専用の既定は16個を維持します。書き込みあり・capabilities未指定の既定は、3入口を1入口に統合したため26個から24個になります。`all,legacy`では27個です。NASの`proposals`配備はread 16 + write 3の19個です。

## 必要時に読むガイド

詳しい運用・記法はMCPの`resources/list`と`resources/read`で取得します。ガイドはどのセットでも読める静的情報で、ツール数や権限を増やしません。

| URI                           | 内容                                                     |
| ----------------------------- | -------------------------------------------------------- |
| `tasken://guide/feed_post`    | 発見の記録、根拠と仮説、重複回避、記事・画像・外部リンク |
| `tasken://guide/note_article` | Noteと記事のMarkdown、画像アップロードと採用             |
| `tasken://guide/work_report`  | 報告の必須欄、委任・質問ID、再送、チェック項目と採用     |
| `tasken://guide/proposals`    | 権限、直接作成・開始とProposalの違い、dry runと採否      |

tools/listのJSON Schemaから`minLength`・`maxLength`・`minimum`・`maximum`・`pattern`・`$schema`・`additionalProperties: false`を省きます。`type`・`required`・`enum`・`format`・配列上限・`additionalProperties`がschemaの場合の型は残します。型を決めるUUIDの`format`も維持します。パターン・数値上限に例外は設けず、version・再送キー・UUIDの要点は短い説明と上記ガイドに残します。SDKが呼び出し時に使うZod schemaは元の制約のままです。違反時はフィールドのpathとmessageを含むSDK入力エラーを返します。

この縮小は実際のMCP bridgeの一覧だけに適用します。`taskMcpAdapter.ts`の内部operation metadataは別契約のため変更しません。

## 回帰検証

`tests/mcp-lightweight.test.mjs`が実SDKのinitialize・tools/list・tools/call・resources/readを通し、ツール数、文字数、条件付き検証、旧入口とのCore要求の一致を確認します。`tests/mcp-http.test.mjs`はクライアント別の選択と環境変数の継承を確認します。実stdio・一時SQLiteの協働テストは新入口で採用・再起動まで検証します。

初回測定（2026-10-28、tools配列をJSON.stringifyした文字数。instructionsは別計測）:

| 構成                                | tools | tools JSON | instructions | 上限                                |
| ----------------------------------- | ----- | ---------- | ------------ | ----------------------------------- |
| 読み取り専用all                     | 16    | 10,174     | 105          | tools JSON 11,000                   |
| 読み取り専用core                    | 6     | 4,244      | 105          | tools JSON 6,000                    |
| 書き込みありall、capabilities未指定 | 24    | 25,101     | 508          | tools JSON 30,000、instructions 800 |

説明文は全ツール200文字以内とし、テストで維持します。実測値は同テストのdiagnostic出力を正本とします。
