# Headless Core

Issue #588「Synologyを常時稼働Tasken replica + MCP Gatewayにし、Desktop停止中もAIから使えるようにする」のPhase 1（headless起動）とPhase 2（read-only replica参加）を実装した。
Electron / renderer / Windows UIを必要とせずにTasken Coreを起動し、空のnodeを既存の共有フォルダ同期へreplicaとして参加させて、Desktop停止中もMCPからContextを読めるようにする。
既存のMCP contractとdiscovery・loopback host・ApplicationCommandService・共有フォルダ同期は変えず、Desktop compositionと並ぶ2つ目のcomposition rootとしてheadless runtimeを配線する。

## 起動と停止

```powershell
npm run build:core:headless
node core-dist/headless.mjs --user-data-dir=D:\tasken-headless
node core-dist/headless.mjs --user-data-dir=/volume1/tasken --sync-directory=/volume1/tasken-sync
```

- `--user-data-dir` 省略時は `TASKEN_USER_DATA_DIR`、それも無ければOS標準のTasken保存先。
- `--db-path` 省略時は `TASKEN_DB_PATH`、または `<userData>/research-desk.sqlite`。
- `--sync-directory` 省略時は `TASKEN_SYNC_DIRECTORY`。指定すると共有フォルダ同期へreplica参加する（後述）。
- `--write-mode` は `read-only`（既定）または `proposals`。省略時は `TASKEN_CORE_WRITE_MODE`。既定の `read-only` は書き込みcapabilityを公開せず、`proposals` はテキストのFeed投稿・Note案・Task案だけを受け付ける。
- stdoutへ1行ずつ次を出す。token・秘密は出さない。

```text
TASKEN_HEADLESS_CORE_READY {"schema_version":1,"origin":"http://127.0.0.1:PORT","discovery_path":"...","database_path":"...","api_version":"1","capability_count":31,"sync_directory":null,"write_mode":"read-only","pid":1234}
TASKEN_HEADLESS_CORE_STOPPED {"schema_version":1,"reason":"SIGTERM"}
```

- READYはloopback hostの起動と `/health`・`/version`・`/capabilities` のinspector成功後にだけ出る。
- `SIGINT`・`SIGTERM`・`SIGHUP` でCore hostを閉じ、discoveryを削除し、SQLiteをcloseして終了コード0で終わる。WindowsではCtrl+C（SIGINT）を使う。
- 起動失敗は `TASKEN_HEADLESS_CORE_DIAGNOSTIC` をstderrへ出し、終了コード78で終わる。
- 既存MCP bridge（`scripts/mcp-server.mjs`）はこれまで通りdiscovery経由で接続する。headless側の変更は不要。

同一userDataでDesktopまたは別のHeadless Coreが稼働中なら、2つ目の起動は `CORE_ALREADY_RUNNING` で拒否する。SQLiteの単一writer境界を壊さないため、live discoveryがある間は共存させない。

## 含む境界・含まない境界

含む:

- `WorkspaceDatabase` を唯一のconnection ownerとする読み書き
- `ApplicationCommandService` と `TaskenCoreRuntime`（Coreのread capabilities、Proposal、Task query/command）
- `127.0.0.1` のephemeral portとowner-only discovery file
- `--sync-directory` 指定時の共有フォルダ同期へのreplica参加（差分の受信と添付同期）
- Capture / Taskに添付された画像の読み取り（`get_capture_image`・`get_task_image`）。`size`・`sha256`照合付きのread-only port

含まない:

- Note Proposal画像のstageと撮影画像のdecode（`nativeImage`依存）。画像付きProposalの作成はできない
- Mobile Gateway、Desktop IPC、トレイ・ウィンドウ・ショートカット
- Snapshot、attachment protocol、renderer通知
- 既定構成での書き込み（`--write-mode=proposals` を選んだ場合だけ、後述の限定された提案受付を公開する）

## 書き込みの範囲（`--write-mode`）

常時稼働nodeは既定で書き込みを公開しない。`--write-mode=proposals`（または `TASKEN_CORE_WRITE_MODE=proposals`）を選んだ場合だけ、次を公開する。

| 公開する                                                  | 公開しない                                                                        |
| --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `propose_content`（`feed_post`・画像なしの`note_create`） | `note_edit`、`feed_reply`、`artifact`、`sketch`、`knowledge`                      |
| `propose_repository_task`（`task`）                       | `repository_context`                                                              |
| 既存の読み取りcapability                                  | `task.command`（`start_task_work`）、`propose_task_work`、`propose_agent_session` |

- 範囲外の種類は、capabilityを残したまま実行時に `WRITE_NOT_ALLOWED`（HTTP 403）で拒否する。AIは `next_action` から送り直し方を判断できる。
- 公開しないcapabilityは `/capabilities` に出さないため、MCP bridgeは呼び出し時点で `CAPABILITY_UNAVAILABLE` を返す。
- 許可範囲はCore側で強制する。MCP bridgeの `TASKEN_MCP_READ_ONLY` は公開toolを減らすための追加の境界であり、Core側の制御を置き換えない。
- 提案受付を使う配備では、bridge側も `TASKEN_MCP_READ_ONLY=0` にする必要がある（両方が要る）。
- Desktopは `proposalAccess: "full"` のままで、この制限の影響を受けない。

`proposals` は提案を作るだけで、正式データの採用・Task完了・直接開始は行わない。`scripts/mcp-doctor.mjs` は `read-only`・`proposals`・`full` を配備として認識し、既知でない組み合わせだけを不足として報告する。

## Phase 2: read-only replicaとして同期へ参加

`--sync-directory` に、データ端末（Desktopなど）が既に設定済みの共有フォルダを指定すると、headless nodeが空の参加端末として同期へ加わる。同期の実装はDesktopと同じ `src/main/services/sharedFolderSync.mjs` を使う。

参加の条件と挙動:

- 参加できるのは**空のnode**（`WorkspaceDatabase` 直後のentity 0件）だけ。既存データがあるnodeは参加せず起動に失敗する。
- 共有フォルダのmanifestが無い場合は `SYNC_FOLDER_NOT_READY` で失敗する。先にデータ端末で同期を設定しておく。
- ホストの`workspaceId`を採用し、node自身の`deviceId`は固定のまま。同期カーソル・適用済みsequence・取り込んだentityはnodeのSQLiteに永続化されるため、再起動後も同じidentityとstateで復帰する。
- 初回や途中の差分がOneDrive等で未到着でも、poll（10秒間隔）で再試行する。解消しない場合の「差分を再公開」はデータ端末側で行う（`docs/shared-folder-sync.md`）。
- このnodeは読み取り専用の運用を既定とする。MCP clientは`TASKEN_MCP_READ_ONLY=1`で起動し、write tools（`start_task_work`・`report_task_done`・`propose_*`等）を公開しない。`--write-mode=proposals`を選んだ場合だけ提案受付を公開する（前節）。proposals配備では、replicaが作ったProposalとDesktopの採否が変更差分として往復する。1つの`idempotency_key`は1つのnodeだけへ送る。
- 添付画像は共有フォルダ同期の対象で、受信後に`get_capture_image`・`get_task_image`で読める。`ContentDetailQueryService`がmanifestの`size`・`sha256`と照合するため、欠落・不一致はnot_foundになる。
- Note Proposal画像のstage（`nativeImage`によるdecode）は含まないため、画像付きProposalの作成はできない。

```text
[データ端末 Tasken] ──共有フォルダへ差分公開──▶ [共有フォルダ] ──replicaが受信──▶ [Headless replica]
        ▲                                                                      ├─ 自分のSQLiteへ適用
        └────────────────採否の変更差分が戻る（proposals配備）─────────────────┴─ MCPでContextを提供
```

## Desktop compositionとの依存inventory（#588 Phase 0/1調査）

| 依存               | Desktop（現行）                                                                              | Headless                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 起動ライフサイクル | `src/main/index.ts` の `startDesktopApp` が `app.whenReady` 後に起動                         | `src/main/headless/main.ts` → `startTaskenHeadlessCore`                            |
| composition        | `src/main/composition/taskenDesktopComposition.ts` が `nativeImage` をimport（同ファイル:4） | `TaskenCoreRuntime` を直接配線し、Electronをimportしない                           |
| userData           | `app.getPath("userData")`                                                                    | `resolveTaskenUserDataPath`（`src/shared/taskenPaths.mjs`）                        |
| native module      | `better-sqlite3` をElectron ABIでロード                                                      | 同じくNode runtimeのABIでロード                                                    |
| shutdown           | `before-quit` でrenderer flush後に `composition.stop()`                                      | シグナルで `runtime.stop()` → discovery削除 → DB close                             |
| 画像decode         | `nativeImage`                                                                                | `get_capture_image`/`get_task_image`はread-only portで読み取り。decode/stageはなし |

`npm run build:core:headless` は `scripts/build-core-headless.mjs` がViteで単一バンドル `core-dist/headless.mjs` を作る。`better-sqlite3` だけをexternalに残す。`core-dist` はgit管理外のビルド成果物。

### native moduleのABI

このリポジトリの `better-sqlite3` は `npm run rebuild:electron` 後のElectron ABIが既定で、そのままではsystem Nodeからロードできない（`NODE_MODULE_VERSION` 不一致）。headlessを同じWindows機のNodeで動かす検証では `npm rebuild better-sqlite3` でNode ABIへ切り替え、確認後に `npm run rebuild:electron` で戻す。Synology・コンテナではその環境のNode向けに `npm ci` / `npm rebuild better-sqlite3` した状態が正となる。APIはどちらのruntimeでも同じSQLiteファイル形式を読む。

## Synology / コンテナでの運用（Phase 2以降の前提）

具体的なNASセットアップ（Dockerfile・Container ManagerのProject・権限・MCP接続）は[synology-headless-node.md](synology-headless-node.md)を正本とする。要点:

- NAS上のNode（またはNode入りコンテナ）で `npm ci`、`npm run build:core:headless` を実行し、`core-dist/headless.mjs` と `node_modules` を配置する。
- `node core-dist/headless.mjs --user-data-dir=/volume1/tasken --sync-directory=/volume1/tasken-sync` をsystemd・Container Manager等で常時起動する。停止はSIGTERMでgraceful。
- MCP clientはNAS上で `node scripts/mcp-server.mjs` をstdio起動するか、transport（Secure MCP Tunnel等）で公開する。replica運用では`TASKEN_MCP_READ_ONLY=1`を付ける。Tasken domain側へtransport固有logicは入れない。
- discovery fileはuserData配下のowner-only。MCPへtoken・local path・credentialを返さない現在の境界をそのまま維持する。

## #427 / shared-folder syncとの関係

- 端末間同期はapplication-levelの差分で、live SQLiteファイルは共有しない（`docs/shared-folder-sync.md`）。
- Headless nodeは自分の `userData` とSQLiteを持ち、Desktopと同じDBを同時に開かない。NAS replicaはPhase 2として、空のnodeへ共有フォルダの差分を適用する形で参加する。
- sync relay・tombstone・conflict・bootstrap ownerの決定はPhase 5まで保留し、headless Coreはrelay責務を持たない。

## 検証（2026-09-12 / 2026-09-21 追記）

- 2026-09-21に追加した検証:
  - `tests/tasken-headless-core.test.mjs`の「Headless replicaが受けたProposalはDesktopへ届き、採否はreplicaへ戻る」が、`proposals`モードのreplica→Desktop役→採否の戻りを一時DBで確認。
  - 「proposalsモードのHeadless Coreは許可した種類だけを受け付ける」が、Feed投稿・Note案・Task案の許可と、`note_edit`・`feed_reply`・`repository_context`・画像付きNote・直接開始の拒否を確認。拒否された要求はProposalもTask変更も残さない。
  - 既定のHeadless Coreは書き込みcapabilityを公開しない。
  - `scripts/mcp-doctor.mjs`は`read-only`・`proposals`配備を正常として診断し、既知でない書き込みcapabilityの組み合わせだけを不足として報告する。
  - 上記は**実Synologyでの実測ではない**。実環境の確認は別途行う。

- system Node 24 + Node ABIの `better-sqlite3` で `core-dist/headless.mjs` を隔離userData起動。`npm run doctor:mcp` がCore health/version/capabilitiesと実stdio MCPの43 tools・AI Ready読み取りに成功。DesktopプロセスもElectron UIも未使用。
- `tests/tasken-headless-core.test.mjs` の5件が、隔離一時DBでMCP読み取り→`stop()`→discovery削除→再起動、`CORE_ALREADY_RUNNING` の拒否、CLI引数検証、replica参加、添付画像読み取りを確認。
- replica参加testは、データ端末が共有フォルダへ公開→headless replicaが空nodeから参加して`workspaceId`を採用→read-only MCPでホストのTaskを読む→ホストの後続変更を`syncNow()`で受信→停止・再起動後も同じ`workspaceId`/`deviceId`と受信済みstateで復帰→replica側のpending差分0を確認する。
- 添付画像testは、hostのCapture/Task画像が共有フォルダでreplicaへ届き、`get_capture_image`・`get_task_image`が`sha256`一致のbytesを返すこと、replica上のbytesを改ざんするとnot_foundになることを確認する。
- 関連テスト、`npm run typecheck`、`npm run build`、`npm run lint`（0 errors）、`audit:scripts`、`audit:architecture --enforce task|core-mcp`（0 blocking）、`audit:consistency --strict` が成功。

## 残作業

- Phase 0: 実ChatGPT等からSecure MCP Tunnel経由で既存MCP contractへ接続する実証（利用者アカウント・tunnel設定が必要）
- Phase 2（残り）: 実Synologyでの参加検証、bootstrap/compaction/revoke/schema upgradeのowner決定。Core側の提案受付gate（`--write-mode=proposals`）は2026-09-21に実装済みで、実環境への配置が残る
- Phase 3: NAS上の常時稼働MCP、transport切断・再接続時の状態非破壊、NAS再起動後の自動復帰
- Phase 4: 通常command経路でのwrite有効化とconflict/Tombstone/undo検証、read-only feature gate
- Phase 5: relay責務のADR（Synology thin relay・共有フォルダ・Desktop Gateway・managed backendの比較）

回帰の入口: `src/main/headless/`、`scripts/build-core-headless.mjs`、`scripts/mcp-doctor.mjs`、`docs/tasken-core-migration.md`。
