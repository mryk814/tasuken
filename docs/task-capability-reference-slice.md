# Task capability reference slice

Issue #405 のうち、Taskをtransport横断capabilityのreference sliceにする範囲を記録する。
Mobile Gateway本体、Task Rendererのfeature移行、既存MCP serverの全面置換はこのsliceへ含めない。

## 非交渉の互換条件

1. SQLite schema、migration、保存場所を変更しない。
2. 既存Application Commandのtransaction、idempotency、expectedVersion、receipt、change_event semanticsを維持する。
3. Schedule / Reference同伴更新とTask Work Receiptは既存Command経路を維持する。
4. Today Mini、Quick Capture、Tasken Rootの公開surfaceを広げない。
5. MCPのTask書き込みは既定でProposal-onlyを維持する。
6. legacy `ResearchDeskApi.entities` / `commands`をこのsliceでは削除せず、新consumerも追加しない。

## 正本と実行経路

```text
Task contract v1
  src/shared/contracts/task/public.ts
        ↓ runtime validation
TaskCapabilityService
  command → ApplicationCommandService → TaskCommandHandler → TaskRepository
  query   → TaskQueryHandler → TaskRepository
        ↓
Electron IPC / HTTP adapter / MCP adapter
        ↓
Preload TaskCapability / future Gateway / MCP host policy
```

`TaskCapabilityService`だけがtransport DTOを既存Application Commandへ写像する。
HTTPやMCP adapterはdomain ruleを持たず、認可、status/error mapping、serializationだけを担当する。

## Capability surface

| Surface | 公開範囲 | 現在の接続 |
|---|---|---|
| Main Workspace preload | create / update / delete / complete / reopen / get / listToday / subscribe | `task:command`、`task:query`、`task:changed`。Main window senderだけを許可 |
| Today Mini | list / add / toggle / open等の既存subsetのみ | 既存controllerがApplication Commandへdelegate。Main用TaskCapability IPCは `FORBIDDEN` |
| HTTP | command / query adapter | serverは所有しない。#398 Mobile Gatewayから利用可能 |
| MCP | `task.create/update/delete/complete/reopen/get/list_today` | operationごとにJSON Schemaをdiscoverできる。direct writeは既定拒否し、既存Proposal workflowを維持 |

Rendererは `features/task/api/taskClient.ts` だけからTask capabilityを利用する。
mutationではretry間で固定する`commandId`と、更新系の`expectedVersion`を明示する。
`subscribe`で既知versionより2以上先の`task_version`を受信した場合、callbackへ渡す前に`GetTask`で正本を再取得する。
Main Workspaceはcommand responseを局所反映し、Task command成功ごとの`workspace:changed`全再読込は行わない。Today Miniだけは既存の限定projectionを再取得する。

## Contract境界

- public input、command result、query result、eventをZod schemaで検証する。
- public read modelはDB rowをspreadせず、schema fieldだけをprojectionする。
- SQLite / Electron / providerの生errorは返さず、TaskError codeへ写像する。
- Task eventはschemaVersion、event_id、task_id、task_version、occurred_at、actorを持つ。
- event受信側のPreloadでもruntime validationし、不正eventをRendererへ渡さない。
- HTTP adapterは任意path、secret、Workspace全体を返さない。

## Compatibility boundary

Task単体の5 Commandは新capabilityで表現できる。
一方、現行Rendererの一部はTaskとSchedule / Referenceを同じApplication Command transactionで保存する。
この複合処理をTask v1 DTOへ無理に混ぜず、旧facadeを互換境界として維持する。

次のconsumer移行は #406 で行う。

- RendererのTask view/form modelをTask clientへ接続する。
- 文字列Command名をTask feature codeから撤去する。
- Task eventとQuery resyncで、Task変更時のglobal Workspace reload依存を減らす。
- consumer 0を確認してからgeneric Task guardとlegacy methodをblocking化・撤去する。

## Fitness function更新

#408 Phase 0-1のreport-only監査に対し、今回の増加は次のreviewed edgeだけをbaselineへ反映する。

- `main.transport → main.task`
- `main.task → shared.ipc`
- Main preloadの`task` capability
- Task IPC wiringに必要なcomposition-root signal

generic CRUD consumerは182件のまま、新規candidateは0件を維持する。
