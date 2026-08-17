# Main Task reference slice

Issue #404のTask reference sliceとして、既存Desktop経路の5つのcore Task Commandを
Main feature moduleへ移す。IPC / Preload / HTTP / MCP adapterの共通化は#405で行う。

## 非交渉の互換条件

1. `application:command` / `application:command-batch`のchannelと既存envelopeを変更しない。
2. Create / Update / Delete / Complete / Reopenのidempotency、expectedVersion、receipt、Change Eventを変更しない。
3. Task + Schedule + Reference + Change Eventは従来と同じSQLite transactionで確定する。
4. SQLite schema、WorkspaceData、Snapshot、Import / Export、backup / restoreを変更しない。
5. Renderer、Today mini、Root、Captureから見えるTaskの結果と通知を変更しない。
6. #407 Task contractから既存Desktop envelopeへのtransport adapterは#405で一箇所だけ追加する。

## 現行inventory

| Surface | 所有者 | 現在の役割 | このsliceでの扱い |
|---|---|---|---|
| `src/main/index.ts` | Main bootstrap | lifecycle、composition、window notification | 変更しない |
| `registerIpc.ts` | legacy Main transport | `application:command` / batchを登録 | channelを維持。分割は#405 |
| `ApplicationCommandService` | command coordinator / compatibility facade | parse、transaction、idempotency、横断dispatch | core Task 5 commandをpublic Task moduleへdelegate |
| `WorkspaceService` | compatibility facade | Renderer向けworkspace/read model | 変更しない |
| `WorkspaceRepository` | SQLite compatibility facade | connection、migration、transaction、Workspace projection | 新methodを追加しない |
| `src/main/modules/task/public.ts` | Task | command/query ownerとSQLite adapter composition | 新しいMain側正本 |

### Core Task Command

- `CreateTask`
- `UpdateTask`
- `DeleteTask`
- `CompleteTask`
- `ReopenTask`

Task Work、Capture変換、学び付き完了等のcross-feature commandはこのsliceでは移動しない。
それらは同じTask policyをpublic module経由で利用し、巨大facade内のpolicy複製を増やさない。

### Repository consumers

- `ApplicationCommandService` → `createTaskModule(...)`だけを利用する。
- `repositories/domain.mjs` → legacy exportを維持し、Task assignment policyへdelegateする。
- `WorkspaceRepository` → 上記legacy exportを利用し、保存直前の防御を維持する。

## Dependency direction

```text
ApplicationCommandService (transaction / idempotency / receipt runtime)
  -> Task public module
       -> application command/query handler
       -> Task repository port
       -> SQLite Task adapter
            -> current WorkspaceRepository transaction
```

Task moduleは`ApplicationCommandService`、`WorkspaceService`、`registerIpc.ts`をimportしない。
SQLite adapterは新しいconnectionを作らず、coordinatorが開始したtransactionを利用する。

## 残作業

- #405: Task contractをIPC / Preload / HTTP / MCP adapterへ接続する。
- #406: Renderer Taskを新しいcapabilityへ移す。
- #408: `main.task_legacy_logic`とTask public boundaryをblocking化する。
- #404後続: Bootstrap、production smoke、残feature、Workspace projectionを段階移行する。
