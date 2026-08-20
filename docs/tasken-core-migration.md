# Tasken Core migration baseline

Issue #412のPhase 0として、Tasken Coreへ移す境界と既存挙動を固定する。
この文書は`39c7202dd6c7527b2ad48407d8e903488a27ada9`時点の実装を調査した結果である。
Phase 1以降でtoolや経路を移行した場合は、同じ変更でinventoryとcharacterizationを更新する。

## 現在の実行境界

DesktopはElectron Mainが`WorkspaceDatabase`を生成し、Application Command、Workspace Service、IPCへ同じrepository instanceを渡す。
Task capabilityは`src/main/modules/task/`にあり、Desktop IPC、HTTP adapter、MCP adapterが`TaskCapabilityService`へ到達する参照スライスを持つ。

stdio MCP serverの`tasken.list_agent_ready_tasks`、Wave 2のrepository/assignment 3 tools、Wave 3の`tasken.get_task_context`は、Desktop Main内のCore hostへloopback HTTPで問い合わせる。
この5 toolsは`ReadOnlyTaskenContext`を生成せず、Core unavailable、version mismatch、unauthorizedでもDB direct readへ戻らない。
未移行のread tool 17件は引き続き各呼び出しで`ReadOnlyTaskenContext`を生成し、別processから`better-sqlite3`で同じDBをread-only openする。
そのため、残るreadの意味とElectron ABI、native module resolutionはPhase 3までMCP bridgeに残る。

write toolはSQLiteへ直接書かない。
`queueMcpProposal`がuserData配下のMCP inboxへProposal envelopeを書き、起動中のDesktopが検証してApplication Commandのtransactionへ取り込む。

```text
tasken.list_agent_ready_tasks / resolve_repository_context /
find_tasks_for_repository / get_task_assignment
tasken.get_task_context
  -> pure HTTP client
  -> 127.0.0.1 Core host
  -> injected WorkspaceDatabase adapter

unmigrated read tool (17 tools)
  -> ReadOnlyTaskenContext
  -> better-sqlite3
  -> Tasken SQLite

write tool
  -> queueMcpProposal
  -> MCP inbox
  -> Desktop proposal import
  -> Application Command transaction
```

## 非交渉の互換条件

### 1. 正式データとSQLite owner

DB schema、data path、migration、backup形式はPhase 0からPhase 4まで維持する。
Electron Mainが生成する`WorkspaceDatabase`を唯一のconnection、migration、write ownerとし、Coreのapplication serviceは注入されたrepository portだけを使う。
MCP bridge、Mobile Gateway、Core transportがSQLiteを再openする実装は追加しない。

### 2. Task command semantics

#405で成立したTask contractと`TaskCapabilityService`をCoreのTask command境界として育てる。
`expectedVersion`、idempotency、actor、source、transaction、Activity、Relationの意味をtransportごとに再実装しない。
既存Desktop IPCのTask CRUD結果も移行前後で変えない。

### 3. MCP contractと公開範囲

既存のtool名、input、output、limit、並び順、`include_archived`、typed errorをtool単位の移行前後で維持する。
AI visibilityは件数制限より先に適用し、除外したrecordの本文とheaderを返さない。
local path、資格情報、Note本文など、現在保護されている情報を新しいCore projectionへ追加しない。

### 4. 一方向のtool移行

移行単位はMCP server全体ではなくtoolとする。
Coreへ移したtoolは、Core unavailable時に`ReadOnlyTaskenContext`やSQLite direct readへ戻さない。
未移行toolだけがPhase 3までlegacy read経路を利用する。

### 5. #413のsupported launcher

Phase 0からPhase 2では、#413のcanonical launcher、Electron-as-Node、runtime guard、doctor、packaged module resolutionを維持する。
未移行read toolが`better-sqlite3`を必要とするためである。
これらはPhase 3の撤去条件をすべて満たした変更でまとめて削除またはCore診断へ置換する。

## MCP tool inventory

`src/main/mcp/server.mjs`にはread toolが22件、Proposal toolが11件ある。
Core移行済み7 toolsはpure client、残る15 toolsだけが`withReadContext`を通る。
表の「追加policy」は、DB read以外に正本化すべき選択、投影、制限を示す。

### Read tools

| Tool | 現在の責務 | 追加policy | 移行予定 |
|---|---|---|---|
| `tasken.search_items` | Task、Waiting、Plan Node、legacy Itemの検索 | Schedule統合、AI visibility、件数制限 | Wave 4でCore移行済み |
| `tasken.list_open_items` | open workの一覧 | Schedule統合、状態変換、日付順、AI visibility | Wave 4でCore移行済み |
| `tasken.list_agent_ready_tasks` | Coding Agentが着手可能なTaskの一覧 | executor、work state、Task state、Theme、AI visibility、件数制限 | Phase 1の最初のslice |
| `tasken.get_task_assignment` | Task、Work Receipt、RepositoryContextの取得 | AI visibility、repository resolution | Wave 2でCore移行済み |
| `tasken.get_task_context` | bounded Task contextの取得 | AI visibility、Context Graph、provenance、text budget、repository match | Wave 3でCore移行済み |
| `tasken.get_note` | Note detailの取得 | AI visibility、本文長制限 | Phase 3 |
| `tasken.get_conversation` | Chat Ref detailの取得 | AI visibility、本文長制限、URL credential除去 | Phase 3 |
| `tasken.get_artifact_metadata` | Artifact metadataの取得 | AI visibility、pathと外部file本文の除外 | Phase 3 |
| `tasken.get_activity_entries` | Task Activityの取得 | AI visibility、Activity projection、件数制限 | Phase 3 |
| `tasken.resolve_repository_context` | workspaceとRepositoryContextの照合 | ambiguity保持、private path非公開 | Wave 2でCore移行済み |
| `tasken.find_themes_for_repository` | repositoryに関連するThemeの検索 | repository resolution、AI visibility | Phase 3 |
| `tasken.find_tasks_for_repository` | repositoryに関連するTaskの検索 | subdirectory判定、AI visibility | Wave 2でCore移行済み |
| `tasken.get_repository_context` | RepositoryContext detailの取得 | ThemeとTaskの関連、AI visibility、path redaction | Phase 3 |
| `tasken.get_theme_context` | Theme単位のwork、Note、Knowledge、healthの取得 | 複合projection、AI visibility、Context Graph、件数制限 | Phase 3 |
| `tasken.get_recent_notes` | recent Noteの一覧 | AI visibility、本文の既定非公開、本文長制限 | Phase 3 |
| `tasken.search_knowledge` | Knowledge Nodeの検索 | AI visibility、node type、本文長と件数制限 | Phase 3 |
| `tasken.get_knowledge_context` | Knowledge NodeとRelationの取得 | AI visibility、source projection、本文長と件数制限 | Phase 3 |
| `tasken.get_plan_health` | open、overdue、waiting、unscheduledの集計 | legacy work統合、Schedule判定 | Phase 3 |
| `tasken.get_knowledge_health` | unresolved questionなどの集計 | Knowledge health policy | Phase 3 |
| `tasken.get_activity` | Activity indexのJSONまたはMarkdown出力 | 日付範囲、AI visibility、Activity ordering | Phase 3 |
| `tasken.get_context_subgraph` | bounded Context Graphの取得 | nodeとedge上限、token budget、suggested relation分離、AI visibility | Phase 3 |
| `tasken.export_ai_context` | bounded AI contextのJSONまたはMarkdown出力 | scope、AI visibility、本文と件数制限、health | Phase 3 |

### Proposal tools

| Tool | Proposal payload | 現在の正式化経路 | 移行予定 |
|---|---|---|---|
| `tasken.start_task_work` | `task_work/start` | MCP inboxからDesktop review | Phase 3 |
| `tasken.append_work_receipt` | `task_work/append_receipt` | MCP inboxからDesktop review | Phase 3 |
| `tasken.report_task_done` | `task_work/report_done` | MCP inboxからDesktop review | Phase 3 |
| `tasken.report_task_blocked` | `task_work/report_blocked` | MCP inboxからDesktop review | Phase 3 |
| `tasken.propose_repository_context` | `repository_contexts` | MCP inboxからDesktop review | Phase 3 |
| `tasken.propose_task` | `items` | MCP inboxからDesktop review | Phase 3 |
| `tasken.propose_note` | `notes/create` | MCP inboxからDesktop review | Phase 3 |
| `tasken.propose_note_edit` | `notes/merge` | MCP inboxからDesktop review | Phase 3 |
| `tasken.propose_knowledge` | `knowledge_nodes` | MCP inboxからDesktop review | Phase 3 |
| `tasken.propose_sketch` | `sketches` | MCP inboxからDesktop review | Phase 3 |
| `tasken.propose_artifact` | `artifacts` | MCP inboxからDesktop review | Phase 3 |

Proposal toolはPhase 3まで現在のinboxを使う。
Core commandへ移す場合も、Coding Agentが正式データを直接変更できるAPIにはしない。
Core側でProposalを作成し、利用者がDesktop UIで採用した後に既存Application Commandへ到達させる。

### Wave 2 優先順位

33 toolsを、Coding Agentの一周に対する価値、必要なprojection依存、移行難度で順位付けした。

| 順位 | tools | 価値 | 主な依存 | 難度 / 判断 |
|---|---|---|---|---|
| 移行済み | `list_agent_ready_tasks` | Coding Agentが着手可能なTaskを直接選べる | Task、Theme、AI visibility | 低。Wave 1で移行済み |
| 1 | `resolve_repository_context` → `find_tasks_for_repository` → `get_task_assignment` | 現在地の特定、対象選択、assignment/receipt取得が一周する | Task、Theme、RepositoryContext、Work Receipt、AI visibility | 中。Wave 2で移行 |
| 移行済み | `get_task_context` | 選択後のbounded contextを一括取得できる | Context Graph、provenance、Activity、receipt、repository match、text budget | 高。Wave 3で単独移行 |
| 移行済み | `search_items`, `list_open_items` | 横断的な状況把握と対象選択 | Task、Waiting、Plan Node、legacy Item、Schedule、状態・日付順 | Wave 4でexact characterization後に移行 |
| 4 | `get_activity_entries`, `get_activity`, `get_plan_health` | 作業履歴と計画状態の確認 | Activity projection、root registry、legacy work、timezone | 中〜高 |
| 5 | `find_themes_for_repository`, `get_repository_context`, `get_theme_context` | repository/theme単位の周辺把握 | repository resolution、複数entity、health | 中〜高 |
| 6 | `get_note`, `get_conversation`, `get_artifact_metadata`, `get_recent_notes` | stable locatorから詳細を読む | 本文budget、credential/path redaction、AI visibility | 低〜中 |
| 7 | `search_knowledge`, `get_knowledge_context`, `get_knowledge_health` | 知識探索と未解決事項の把握 | Knowledge relation/source projection、本文budget | 中〜高 |
| 8 | `get_context_subgraph`, `export_ai_context` | 横断的な探索・持ち出し | graph bounds、token budget、scope、health | 高 |
| 9 | 11 Proposal tools | 調査結果をTaskenへ返す | proposal-only inbox、検証、Desktop review | 中。read wave後も直接writeにはしない |

Wave 2は、既存`list_agent_ready_tasks`と合わせて「repositoryから対象を絞る／ready一覧から選ぶ → assignmentとreceiptを読む → Proposalを返す」を成立させる。
Wave 3は`get_task_context`だけをquery-specific snapshot portへ移し、legacyのGraph、provenance、Activity、Work Receipt、repository match、text budgetをexact parityで維持した。
Work Receiptの自由文は共通projectionでURL credential/query/hash、absolute local path、credential assignmentを除去し、通常の説明文は保持する。
Wave 4は`search_items`と`list_open_items`をquery-specific snapshot portへ移し、mixed entity merge、legacy ID重複排除、Schedule、状態変換、検索・日付順、archived semanticsを維持した。
各結果には正本entityの`locator`とresponse-level `next_tools`を追加し、Coding AgentがTask contextへ迷わず進めるようにした。
またloopback HTTPのvalidation errorをcode/message/detailsの構造で返し、Core clientとMCP tool resultへstack、local path、tokenを出さずlosslessに伝播する。

#### Wave 2.1 / Phase 3 gaps

Wave 2は既存MCP contractのexact parityを優先し、次の改善は出力やエラー契約を変えず保留する。

- `find_tasks_for_repository`にはpublicな件数上限がない。件数制限を追加する場合は既存の無制限結果をversioned contractとして扱う。
- `get_task_assignment`のWork Receipt本文にはtext budgetがない。切り詰め方とtruncation metadataを先に契約化する。
- loopback HTTPのstructured errorはCore clientとMCPへlosslessに投影済み。今後のdomain queryは同じpublic error境界を使う。
- response schemaは安定envelopeだけを検証し、legacy extension fieldsを保持している。strict schema化はversion移行と同時に行う。
- response-level `next_tools`は`search_items`と`list_open_items`で導入済み。他toolへ広げる場合は同じmetadata形を使う。

## 最初のcharacterization対象

最初の縦断sliceには`tasken.list_agent_ready_tasks`を使う。
このtoolはTaskだけを扱うため、#405のTask read modelとrepository portを再利用できる。
一方でAI visibilityとbounded resultを含むため、単なるhealth endpointよりCore queryの責任を検証できる。

`search_items`と`list_open_items`は、Taskに加えてWaiting、Plan Node、legacy Item、Scheduleの互換投影を同時に移す必要がある。
`get_task_context`はContext Graph、provenance、repository match、Activity、Work Receipt、text budgetを含む。
これらを最初のsliceへ含めると、Query boundaryと複合context移行の失敗を区別できなくなる。

### Characterization matrix

| 条件 | 現在の結果 | 固定する理由 |
|---|---|---|
| `intended_executor`が`ai_agent` | 候補になる | Agent向けqueueの入口である |
| `intended_executor`がそれ以外または未設定 | 除外する | 人間向けTaskを誤取得しない |
| `work_state`が`ready_for_agent` | 候補になる | 明示的なready状態である |
| `work_state`が未設定 | `ready_for_agent`として扱う | 既存Taskとの互換条件である |
| `work_state`がそれ以外 | 除外する | 作業中やreview中の重複着手を防ぐ |
| `state`が`done`または`cancelled` | 除外する | 終端Taskをqueueへ戻さない |
| `theme_id`を指定 | `project_id`が一致するTaskだけを返す | 現在のMCP input semanticsである |
| `include_archived`が偽または未指定 | `deleted_at`があるTaskを除外する | 通常一覧の論理削除規則である |
| `include_archived`が真 | 論理削除済みTaskも候補判定へ含める | 調査用の既存挙動である |
| AI visibilityが`coding_agent`を含む | TaskとAI headerを返す | MCPの既定audienceである |
| AI visibilityが`coding_agent`を含まない | Taskとheaderを返さず、除外件数と理由だけを返す | 非公開本文の存在を漏らさない |
| 複数候補 | `updated_at`降順で返す | `ReadOnlyTaskenContext.list`の既存順序である |
| `limit`未指定 | 最大20件 | 現在の既定値である |
| `limit`が1以上100以下 | 指定件数まで返す | public MCP schemaと実装の上限である |
| `limit`が100を超える | MCP input validationで拒否する | silent clampをpublic contractにしない |
| result metadata | `limit`、`ai_audience: coding_agent`、`read_only: true`、除外集計を返す | adapter間のparity対象である |

Phase 0のtestは、候補判定、Theme filter、論理削除、AI visibility、並び順、limit、result metadataをin-memory workspaceで固定する。
Phase 1では同じfixtureをCore application serviceへ適用し、legacy結果とのdeep equalityを要求する。
Phase 2ではin-process Core、loopback transport、MCP toolのtransport固有metadataを除いた結果を比較する。

## Migration phases

### Phase 0: Inventory and characterization

この文書とcharacterization testを基準にする。
DB schemaやarchitecture baselineは変更しない。
MCP toolを追加または削除する変更は、同じ変更でinventory件数と分類を更新する。

### Phase 1: In-process Core query boundary

shared contract、Core application service、repository port、既存`WorkspaceDatabase`へのinfrastructure adapterを追加する。
最初は`list_agent_ready_tasks`だけを実装し、Desktop Main内でin-process実行する。
Core applicationはElectron、HTTP、MCP SDK、`better-sqlite3`をimportしない。
`src/main/core/`を独立moduleとして強制し、`src/main/infrastructure/sqlite/`のadapterがCoreのread portを実装する。
Phase 1ではfactoryをfixtureから生成してin-process境界を検証し、実runtimeのcomposition rootへはまだ接続しない。
既存`WorkspaceDatabase` instanceの注入は、実consumerになるloopback hostを追加するPhase 2と同じ変更で行う。
`tests/tasken-core-phase1.test.mjs`は同一fixtureに対するCoreとlegacy `ReadOnlyTaskenContext`のdeep equalityを固定する。

Task command endpointは`TaskCapabilityService`へdelegateする。
新しいcommand handlerやTask mutation policyは作らない。

### Phase 2: Loopback Core transport

Electron Mainが`127.0.0.1`のrandom portへCore hostをbindする。
health、Core API version、capability handshake、request size、timeout、auth tokenを実装する。
endpointとtokenのdiscovery情報はuserData配下へ原子的に保存し、同一OS userだけが読める扱いにする。
token、DB path、local pathをログやtool resultへ出さない。
discoveryはschema version、API version、capability、loopback origin、256-bit token、owner、permission、symlinkをclient側でも検証する。
capabilityは包括的な「Core read可」ではなくnamed operationである。clientは各HTTP request前に対応する`list_agent_ready_tasks`、`resolve_repository_context`、`find_tasks_for_repository`、`get_task_assignment`を個別に要求する。
hostはJSON Content-Type、64 KiB request body、5秒timeout、method、pathを境界で検証する。

MCP bridgeは`tasken.list_agent_ready_tasks`に加え、Wave 2で`resolve_repository_context`、`find_tasks_for_repository`、`get_task_assignment`をpure HTTP clientへ切り替える。
Core unavailable、version mismatch、unauthorizedをtyped errorへ変換し、SQLite direct readへfallbackしない。
他のtoolはPhase 3までlegacy contextを使うため、#413のlauncherを残す。
Phase 2ではquery sliceだけを完成させ、Task command endpointは追加しない。

### Phase 3: Pure MCP bridge

残るread query、AI Context、Activity、RepositoryContext、Knowledge queryをCoreへ移す。
Proposal toolは既存のreview semanticsを保ったCore proposal commandへ移す。
最後のDB consumerを移した後に`ReadOnlyTaskenContext`のDB openとMCP packageのnative dependencyを削除する。

通常Nodeでsourceとpackaged MCP bridgeを起動し、Desktop稼働中のCoreへ接続する。
Core unavailable時は診断可能なerrorを返し、DB direct readへ戻さない。

### Phase 4: Mobile Gateway reuse

#398 Mobile GatewayをCoreの外向きHTTP adapterとして接続する。
local MCP transportのtoken、bind、exposure policyはMobileへ流用しない。
Task mutationは#405のApplication Commandへ到達させ、Mobile専用のTask ruleを作らない。

Phase 4Aでは、外向きserverを起動する前に`shared/contracts/mobile`、pure client、provider注入Gateway adapterを固定する。
Mobile deviceのCreateTaskは認証済みdevice identityからactor/sourceを生成してTask capabilityへ委譲し、agent writeは既存Proposal review経路を維持する。
具体的な完了・未達境界は`docs/mobile-gateway-phase4a.md`を正本とする。

## 撤去条件

### #405の互換境界

Phase 0からPhase 2では、Task contract、`TaskCapabilityService`、Task repository port、typed IPCを撤去しない。
これらはCoreのTask commandとqueryを成立させる既存実装である。

汎用`EntityType` port、legacy Workspace command consumer、aggregate preloadの撤去は、対応するcapabilityへ全consumerを移してparity testが通った単位で行う。
Core化だけを理由に旧経路と新経路を恒久的に並存させない。

### #413のnative runtime workaround

次の条件を同じ変更で満たした時点を#413 workaroundの撤去境界とする。

1. MCP read tool 22件がCore queryへ移り、`ReadOnlyTaskenContext`がDBをopenしない。
2. Proposal tool 11件がCore proposal commandへ移り、MCP bridgeがinbox filesystemへ直接書かない。
3. MCP sourceとpackageから`better-sqlite3` importおよびnative addon resolutionが消える。
4. Core unavailable時のDB fallbackがなく、healthとversion mismatchを診断できる。
5. 通常Nodeのsource smokeとpackaged Windows E2Eで実DB readおよびProposal作成を確認する。

条件を満たした変更で、`ELECTRON_RUN_AS_NODE` launcher、Electron ABI guard、native binding doctorを削除する。
`doctor:mcp`はCore discovery、health、version、capability、authの診断へ置換する。

## Phase 0からPhase 2で未達の受け入れ基準

Phase 2で一つのtoolがCoreを通っても、Issue #412は完了しない。
MCP packageのnative依存ゼロ、通常Node起動、全read tool、AI Context抽出、Mobile実装、DesktopとMCPとMobileのfull parityはPhase 3以降の証拠を必要とする。
packaged Windowsで実DBを使うE2Eも、DesktopとCore hostを実際に起動した結果を残すまで未検証とする。
