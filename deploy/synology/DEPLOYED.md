# 稼働記録（observed deployment）

このファイルは実機NASで確認した状態を記録します。Gitのbranch先端やGitHub Releaseとは別の情報です。
共有先を公開する文書のため、個別の端末・Workspace・Taskを識別する値、実際の投稿本文やデータ件数は記録しません。

## 実機NASの観測

### 2026-09-12 初回配置（Synology DSM 7.2 / amd64）

- Linux/amd64のimageは開発機で作り、共有フォルダ経由でNASへ搬入。SQLiteはNASローカル、端末間の同期データは別の共有フォルダに保存。
- Coreとread-only MCPはhealthy。Desktop停止中にもNASからTask contextを取得できた。
- Synology ACLにより共有フォルダがコンテナ内で読めない問題は、composeへ追加グループを設定して解消。
- Secure MCP Tunnelのsidecarも起動し、metadata取得とpoller稼働を確認。当初はChatGPT側の一覧に表示されなかったが、2026-09-27に実クライアントから接続できることを確認。

### 2026-09-20 / 21 共有状態の再確認

PC側から共有フォルダを確認しただけでは、コンテナやSQLiteが稼働中か判断できないことを確認。NAS内部の状態はNAS上で読み取り確認する手順に切り替えた。

### 2026-09-26 replica同期の復旧

- replicaが同期の途中で停止していた原因は、既存のWork Receiptを後続revisionとして取り込む際、append-only制約が更新を拒否していたこと。
- 親revisionが現在のheadに一致する後続revisionを扱えるようにし、実質同じ内容の再公開では内容を変えずheadだけ進めるよう修正。
- 再配置後、read-only運用で同期が再開し、エラーが解消され、競合なしで差分を取り込むことを確認。
- 定期同期の失敗は、内容が変わった場合に一度ログへ記録する。

### 2026-09-27 proposals配備とMCP接続

- Coreの既定はread-only。Proposal受付には `TASKEN_CORE_WRITE_MODE=proposals` と `TASKEN_MCP_READ_ONLY=0` の両方が必要。
- CoreはFeed投稿・画像なしNote・Task案とTask作業報告のProposalを受け付ける。直接のTask開始とAgent Sessionは公開しない。正式データはDesktopで採用されるまで変わらない。
- NAS上のCore capabilityとMCP tool一覧を確認し、許可外の編集・返信・直接開始は拒否されることを確認。拒否された要求はProposalを作らない。
- 実クライアントからFeed投稿とTask作業報告を送り、どちらもpending Proposalとして受理され、共有フォルダ経由でDesktopへ届くことを確認。
- 隔離コピーでは、正規Themeを持つTaskの作業報告を採用でき、Taskの完了状態と作業報告の採用状態が別であることを確認。既存データに正規ThemeがないTaskは採用時に拒否される。TaskをDesktopで保存し直して正規Themeを付けると再試行できる。
- この観測時のNAS imageはリリース候補とは別の以前のbuildです。この記録を `v0.1.71` の配備確認として扱わないでください。

### 2026-09-28 MCP改善の配備（commit `be8d519`）

- 固定commit `be8d519` からimage `tasken-headless:be8d519`（同一imageを`:local`にも付与）を作成し、共有フォルダ経由で搬入。NAS上でimage・source・`nas-install.sh`のSHA256照合が一致。
- 交換前に `backup.sh` でsnapshotを取得し `VERIFIED` を確認。元のコンテナがhealthyへ戻ってから交換した。
- `nas-install.sh` で配置。既存の `.env`（`proposals`配備・tunnel設定）を保持したまま起動し、`WRITE_OK`、`TASKEN_HEADLESS_CORE_READY`（`write_mode: proposals`、capability 32）、health `healthy`、tunnel-clientの起動を確認。
- `nas-read-check.mjs`（`TASKEN_MCP_READ_ONLY=0`）で `TOOL_COUNT 21`（read 16 + write 5）。`get_capabilities`・`list_proposals`・`search_notes` が一覧に出て、この配備で使えない `start_task_work`・`propose_note_edit`・`answer_feed_question` は一覧に出ないことを確認。`search_items` の読み取りも成功。
- 未確認: ChatGPT側でのConnector再読み込み後のtool一覧と `get_capabilities` の応答。

## ローカル隔離検証（NASではない）

2026-09-27にNASデータのコピーを一時環境へ置き、Proposalの受付、共有フォルダへの公開、Desktop相当の採用経路を確認。本番NASと実データには書き込んでいません。

- 許可されたFeed投稿とTask作業報告はpending Proposalとして保存・同期された。
- 許可外の書き込みは拒否され、TaskやWork Receiptに直接変更を加えなかった。
- 正規Themeのない既存Taskは採用時に拒否されることを確認した。
- Linux/amd64の隔離コンテナでread-only起動、同期、MCP経由の読み取り、snapshotのSQLite整合性確認、停止・再起動後のhealthを確認。

## 未確認

- amd64以外のSynology、Synology Drive / Cloud Sync経由の同期。
- `backup.sh` のNAS上での一連実行。
- Desktop停止・NAS再起動・transport再接続を含めた一連の復旧。
- リリース候補 `v0.1.71` のNASへの配備。この記録はその配備を示しません。
