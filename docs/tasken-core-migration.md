# Tasken Core migration

Issue #412 / #413で、Desktop・MCP・Mobileが同じapplication serviceを使うための実行境界を固定する。

## 現在の境界

Desktop Mainが`WorkspaceDatabase`を生成して`TaskenDesktopComposition`へ注入する。compositionは`ApplicationCommandService`、`TaskenCoreRuntime`、単一の`TaskCapabilityService`を所有し、Desktop IPC、Core HTTP、Mobile adapterへ同じinstanceを渡す。Core hostは`127.0.0.1`のephemeral portだけで待ち受け、userData配下のowner-only discovery documentにAPI version、named capabilities、origin、256-bit tokenを原子的に公開する。

Windowsでdiscoveryのrenameが`EPERM`になった場合だけ、50ms間隔で最大3回試行する。既存discoveryを先に削除せず、回復しない場合は元のエラーで起動を失敗させ、待ち受けserverを閉じる。`node --test tests/tasken-core-discovery.test.mjs`で一過性エラーからの回復、恒久失敗時の既存ファイル保全と一時ファイル・serverの後始末を検証する。

stdio MCP bridgeはplain system Nodeで動作し、SQLite、Electron、native addon、filesystem inboxを読み書きしない。read 27 toolsとProposal 14 toolsはすべて認証済みCore clientを通る。

```text
MCP client
  -> plain Node stdio bridge
  -> discovery validation + bearer auth
  -> Tasken Core loopback host
  -> query / proposal command service
  -> injected WorkspaceDatabase repository
```

Core unavailable、API version mismatch、named capability不足、auth failure、invalid responseではfail closedとする。DB direct read、legacy context、filesystem queueへ戻らない。

## Canonical Task composition (#412)

`TaskenDesktopComposition`をDesktop lifecycleとTasken Coreのcomposition rootとする。Taskのread/write経路は次の単一serviceへ収束する。

```text
Desktop IPC ─┐
Core HTTP ───┼─> TaskCapabilityService -> ApplicationCommandService / WorkspaceDatabase
Mobile ──────┘
```

Core discoveryとlive statusは`task.query`、`task.command` capabilityを公開する。Desktop IPCはin-process、Mobile adapterはCoreの外向きadapter、Core HTTPはloopback transportだが、query semantics、expected version、idempotency、Activity/Relation副作用は同じserviceで処理する。

MCP stdio bridgeはCore HTTPを利用するが、正式Taskを直接更新する`task.command`は公開しない。MCPのwrite権限は引き続きProposal作成だけに限定し、利用者のPreview/採用を迂回させない。

## 非交渉の互換条件

1. DB schema、data path、migration、backup形式を変えない。
2. Electron Mainの`WorkspaceDatabase`を唯一のconnection、migration、write ownerとする。
3. MCP tool名、public input/output、limit、並び順、`include_archived`、typed errorを維持する。
4. AI visibilityをlimitより先に適用し、local path、資格情報、非公開本文を返さない。
5. write toolは`ai_proposal`だけを作り、正式データは利用者のPreview/採用後に既存Application Commandへ到達させる。
6. idempotencyはcaller/source identityとpayloadへ結び、process restart後も同じkeyの重複作成を防ぐ。

## MCP inventory

### Read 27 / 27 Core

- Work selection: `search_items`, `list_open_items`, `list_agent_ready_tasks`, `get_task_assignment`
- Task detail: `get_task_context`, `get_note`, `get_conversation`, `get_artifact_metadata`, `get_activity_entries`
- Repository: `resolve_repository_context`, `find_themes_for_repository`, `find_tasks_for_repository`, `get_repository_context`
- Agent session: `get_agent_session_context`, `get_debrief_context`
- Purpose-built Context: `get_work_context`, `get_planning_context`, `get_learning_context`
- Theme / Knowledge: `get_theme_context`, `get_recent_notes`, `search_knowledge`, `get_knowledge_context`, `get_plan_health`, `get_knowledge_health`
- Cross-cutting: `get_activity`, `get_context_subgraph`, `export_ai_context`

### Proposal 14 / 14 Core

- Task work: `start_task_work`, `append_work_receipt`, `report_task_done`, `report_task_blocked`
- Agent session: `start_agent_session`, `finish_agent_session`, `submit_agent_session_record`
- Repository/Task: `propose_repository_context`, `propose_task`
- Content: `propose_note`, `propose_note_edit`, `propose_knowledge`, `propose_sketch`, `propose_artifact`

Task work proposalはexpected versionとagent identityを必須にする。public compatibility上caller/idempotencyが省略可能なcontent系toolはMCP境界で安全なdefault/UUIDを補い、Core command自体はstrictに要求する。Note/Artifact bodyは実UTF-8 byte数で64 KiBを上限とし、path、credential URL、scriptable SVG、filename/media mismatchを拒否する。

## Native runtime cleanup (#413)

次を撤去した。

- Electron-as-Node launcherとruntime/ABI guard
- MCP bridgeの`better-sqlite3` resolution
- `ReadOnlyTaskenContext` production implementation
- filesystem Proposal inbox writer/import service
- Desktop Context Previewのin-memory legacy context
- SettingsのInbox path/開く導線

`doctor:mcp`はCore discovery、auth、health、API version、discovery/live capability一致、MCP必須capabilityを診断する。token、origin、discovery pathはreportへ出さない。

`better-sqlite3`、`rebuild:electron`、`scripts/run-electron-node.mjs`はDesktop repositoryとDesktop test runtimeが使うため残す。MCP package graphには含めない。

## 実証gate

- typecheck、full Electron tests、build、build:mcp、architecture/consistency/script audits
- production Runtime parity: Desktop service、Core HTTP、Mobile adapterが同じTaskを作成・更新・再読込し、同一idempotency keyのretryでeventを増やさない
- contract hardening: unknown request field、unknown response field、Core停止後のqueryをfail closedにする
- plain Node source MCP: Core停止時のstructured fail-closed、native import sentinel
- built `mcp-dist/server.mjs`: native/Electron/inbox symbol sentinel
- Windows packaged Desktop: Desktop Core起動後、system Nodeでbundled MCPへ接続し、41 tools、read、Proposal commandを確認
- actual MCP client config: Settingsからコピーした`node <resources>/mcp/server.mjs`で接続
- architecture audit: `main.composition`をenforced moduleにし、`src/main/index.ts`の#412 suppressionを撤去する。監査結果は65 findings / 3 new candidates / 0 blocking

package/buildだけではWindows packaged E2Eやactual client接続の代わりにならない。未実施の境界はIssueに明記する。

## Mobile境界

Mobile GatewayはCoreの外向きadapterだが、local MCPのdiscovery tokenやloopback exposure policyを流用しない。device identity、scope、conflict、offline/pending、deep link、release signing、実機postureは`docs/mobile-gateway-phase4a.md`を正本とする。
