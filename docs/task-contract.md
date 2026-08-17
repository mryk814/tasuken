# Task contract boundary

Issue #407のうち、#404/#405/#406に先行して固定するKernelとTask contractの正本を定義する。
この段階では既存runtime経路を切り替えず、次のvertical sliceが依存できる境界を作る。

## 非交渉の互換条件

1. SQLite schemaと既存Task rowを変更しない。
2. Workspace / Snapshot / Import / Export / Syncの保存形式を変更しない。
3. 既存Application Command名・payload・IPC channelを変更しない。
4. RendererのTask view / form stateを#406までは変更しない。
5. Main / Preload / Renderer / HTTP / MCPのruntime adapterはこのIssueで切り替えない。
6. Task contract schema v1は新しいtransport境界であり、SQLite migration versionとは別に管理する。未知の将来versionは構造化エラーで拒否する。

## 境界と所有者

| 役割 | 現在の所有者 | 責任 |
|---|---|---|
| SQLite row | Main Repository | DB schema、row読書き、migration |
| Main domain | Main Service / Repository domain | 永続化前後の正規化と業務制約 |
| Task transport DTO | `src/shared/contracts/task/public.ts` | runtime非依存のCommand / Query / Event / Error / read model schema |
| Renderer view / form state | Renderer workspace feature | 表示用派生値、入力途中値、Projection固有状態 |

Task transport DTOはDB rowでもRenderer stateでもない。境界を越える値だけを検証し、
adapterが各ownerの表現へ明示的に変換する。

## Kernel

`src/shared/kernel/public.ts` はopaque ID、entity/schema version、ISO日時、構造化error、
`Result`とversioned schema parserだけを公開する。Electron、React、Zustand、Node API、
SQLiteには依存しない。

## Task contract v1

- Command: Create / Update / Delete / Complete / Reopen
- Query: Get / List とversioned result
- Event: Created / Updated / Completed / Reopened / Deleted
- Error: validation、future/old schema、not found、conflict、invalid transition
- Source: Desktop / Mobile / HTTP / MCP / Systemを同じschemaで識別する

Mobileのoffline captureを妨げないよう、Create TaskのIDは呼び出し側が生成する。
未知fieldはrejectし、optional / nullable / enumの意味をschemaで固定する。

## 既存sharedの分類

`architecture/shared-ownership.json` が `src/shared` 全体をKernel、feature contract、
IPC/platform、pure domain、compatibilityへ分類する。`applicationCommand.ts` と
`types/workspace.ts` は互換層として明示し、#404/#405/#406のconsumer移行完了後に撤去する。
新規の `.mjs` と手書き `.d.mts` の組は作らない。

## 次の接続順

1. #404: Main側のTask reference vertical sliceをTask contractへ接続する。
2. #405: IPC / Preload / HTTP / MCP adapterで同じcapabilityを共有する。
3. #406: Renderer Taskを新境界へ移す。
4. #408: Task関連architecture ruleをblocking化する。
