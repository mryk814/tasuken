# #413 MCP native runtime cleanup characterization

基準: `origin/main` `8cbada9`（2026-08-21）。

この文書は、Issue #412 の最後の read / Proposal 移行が完了したあとに、MCP bridge から Electron-as-Node と native SQLite 依存を撤去するための実行境界を固定する。
ここでいう「MCP package」は `scripts/mcp-server.mjs` を `scripts/build-mcp-bridge.mjs` で生成する `mcp-dist/server.mjs` と、Windows package の `resources/mcp/server.mjs` を指す。
Desktop Main の正式な SQLite owner（`src/main/repositories/workspaceRepository.mjs`）まで削除する話ではない。

## 現在の実行経路

### MCP stdio の起動

```text
npm run mcp
  -> scripts/tasken-mcp-launcher.mjs
  -> node_modules/electron/dist/electron[.exe]
       ELECTRON_RUN_AS_NODE=1
       scripts/mcp-server.mjs
  -> guard in scripts/mcp-server.mjs
  -> src/main/mcp/server.mjs
```

Packaged Desktop の設定は `src/main/services/workspaceService.ts#getMcpBridgeInfo` が返す。
現在は `process.execPath`（Tasken executable）、`resources/mcp/server.mjs`、`ELECTRON_RUN_AS_NODE=1` を組み合わせる。
`scripts/mcp-package-smoke.mjs` も同じ起動方法を使う。

### Read

現在の `src/main/mcp/server.mjs` の22 read toolsは、登録上はすべて `TaskenCoreClient` の named capabilityへ接続されている。
`readOnlyContextModulePromise` / `defaultReadContextProvider` / `withReadContext` は残留した旧経路であり、登録された read tool のfallbackとして使ってはいけない。
`src/main/mcp/readOnlyContext.mjs` 自体は `better-sqlite3`、DB path discovery、direct read modelを保持している。
また、`src/main/services/workspaceService.ts#getAiContextPreview` はCoding Agent previewのために同クラスをin-processで生成しているため、MCPだけでなくこのconsumerもCoreのprojectionへ置き換える必要がある。

### Proposal

11 Proposal toolsのうち、Task-work 4件はすでに `TaskenCoreClient.proposeTaskWork` へ移行済みである。
残る7件は `queueMcpProposal` から userData配下の `mcp-inbox` へ直接atomic file writeする。

| 状態 | tool |
|---|---|
| Core command | `tasken.start_task_work` |
| Core command | `tasken.append_work_receipt` |
| Core command | `tasken.report_task_done` |
| Core command | `tasken.report_task_blocked` |
| legacy inbox writer | `tasken.propose_repository_context` |
| legacy inbox writer | `tasken.propose_task` |
| legacy inbox writer | `tasken.propose_note` |
| legacy inbox writer | `tasken.propose_note_edit` |
| legacy inbox writer | `tasken.propose_knowledge` |
| legacy inbox writer | `tasken.propose_sketch` |
| legacy inbox writer | `tasken.propose_artifact` |

Desktop Main は `src/main/index.ts` で `McpProposalInboxService` を起動し、inbox envelopeを `ai_proposal` として正式DBへ取り込む。
この importerはMCP packageの読み取り・書き込み境界とは別だが、7件をCore proposal commandへ移したあと、MCP専用filesystem bridgeとしては不要になる。
Proposalは正式エンティティを直接変更せず、既存の `ai_proposal` → Preview → User accept/reject → Application Command のreview semanticsを維持する。

## 現在の legacy inventory（削除・置換対象）

| path | 現在の責務 | 最終状態 |
|---|---|---|
| `scripts/tasken-mcp-launcher.mjs` | Electron executableをspawnし、`ELECTRON_RUN_AS_NODE=1`を付ける | 削除。MCP packageはplain system Nodeで `server.mjs` を起動 |
| `scripts/mcp-server.mjs` | Electron-as-Node guard後に `src/main/mcp/server.mjs` をdynamic import | guardを削除し、Node entrypointへ置換 |
| `scripts/mcp-runtime.mjs` | Electron path、runtime kind、Node/Electron ABI、native binding、DB path diagnostics | 削除またはCore診断へ完全置換。ABI / native / DB pathを診断項目に残さない |
| `scripts/mcp-doctor.mjs` | better-sqlite3をNode/Electron双方でprobeし、DB存在を確認 | Core discovery、health、API version、named capability、authを診断 |
| `scripts/build-mcp-bridge.mjs` | bundleから `better-sqlite3` をexternal扱いにする | native externalを削除し、生成bundleがplain Nodeで自己完結する境界を検査 |
| `scripts/mcp-package-smoke.mjs` | packaged Tasken executable + `ELECTRON_RUN_AS_NODE` + inbox pathでstdio smoke | plain Node MCP + 起動中Desktop Core + read / Proposal command smokeへ置換 |
| `package.json` `mcp` script | `node scripts/tasken-mcp-launcher.mjs` | `node scripts/mcp-server.mjs`（または同等のplain Node entrypoint） |
| `package.json` `rebuild:electron` / `better-sqlite3` | Desktop native dependencyのrebuild | Desktop package用には残せるが、MCP bundleの依存境界からは消す |
| `package.json` `extraResources` | `mcp-dist`を`resources/mcp`へコピー | 維持。生成物がnative-freeであることをpackage gateで検査 |
| `src/main/mcp/readOnlyContext.mjs` | direct SQLite read、`better-sqlite3` dynamic load、legacy DB path discovery | MCPおよびCoding Agent previewの全consumerをCoreへ移した後に削除 |
| `src/main/mcp/server.mjs` read legacy loader | `ReadOnlyTaskenContext`を遅延loadする旧fallbackの残留 | `readOnlyContextModulePromise`、`loadReadOnlyContext`、`defaultReadContextProvider`、`withReadContext`を削除 |
| `src/main/mcp/server.mjs` Proposal handlers | 7 handlersが`queueMcpProposal`を直接呼ぶ | 11 handlersすべてnamed Core proposal commandへ接続。MCPからFSを触らない |
| `src/main/mcp/proposalInbox.mjs` `queueMcpProposal` | envelope validation、inbox filesystem write | MCP bridgeからは削除。既存envelopeのimportが不要になった時点でmoduleも削除 |
| `src/main/mcp/proposalInbox.mjs` `McpProposalInboxService` | Desktop起動中のinbox drainと`ai_proposal`保存 | Core proposal commandが同じ`ai_proposal` review semanticsを提供した証拠後に削除 |
| `src/main/services/workspaceService.ts` `ReadOnlyTaskenContext` import | Coding Agent Context Previewのlegacy projection | Core query / shared projectionへ置換。UIのpreview/empty/error semanticsを維持 |
| `src/main/services/workspaceService.ts#getMcpBridgeInfo` | Electron executable + env flag + inbox statusをMCP設定へ出す | plain Node command + Core discovery/health情報へ置換。絶対pathやtokenを公開しない |
| `src/main/index.ts` inbox service lifecycle | inbox watcherをDesktop Mainで開始・停止 | Core proposal commandのlifecycleへ置換後、inbox専用 import/start/stopを削除 |

以下は #413 の削除対象ではない。

- `src/main/repositories/workspaceRepository.mjs` の `better-sqlite3`: Desktop Mainの正式なSQLite ownerである。
- `src/main/infrastructure/sqlite/*` と `TaskenCoreRuntime`: Coreへ注入するDesktop persistence adapterである。
- Renderer、Desktop UIの `ai_proposals`: ProposalをPreviewし、利用者が採用するreview UIの正本である。
- 既存のProposal validation: Core proposal commandへ移植し、payload上限、SVG / Artifact、credential/path redaction、idempotencyを失わない。

## 最終受け入れマトリクス

| 完了条件 | 必要な証拠 | 現在の状態 |
|---|---|---|
| 22 read toolsがCore queryを通る | named capability一覧、Core/in-process/HTTP/MCP parity、fallback sentinelが呼ばれない | source登録はCore。native-free packageは未証明 |
| 11 Proposal toolsがCore proposal commandを通る | 11 toolごとの strict input、idempotency、`ai_proposal` pending保存、UI accept/reject後のApplication Command | 4/11のみCore。7/11はinbox |
| MCP bridge sourceにnative importがない | source scanで `better-sqlite3` / `ReadOnlyTaskenContext` / DB path / inbox writerがMCP経路から0件 | 未達 |
| `mcp-dist/server.mjs`がplain Nodeで起動する | `node mcp-dist/server.mjs` の initialize/listTools、native ABI stackなし | 未達。現行serverはElectron guard前提 |
| Core unavailableでDB fallbackしない | Desktop停止時、全22 read / 11 Proposalが同じ診断可能な `CORE_UNAVAILABLE` 系エラー | readは部分証明、Proposal 7件はCore未接続 |
| doctorがABI workaroundを診断しない | Core discovery、health、version、capability、authの各失敗をredacted JSONで報告 | 未達。native/DB probeが現役 |
| packaged WindowsがCore + MCPを実際に起動する | package smokeでDesktop executableを起動、Core discoveryを発見、plain Node `resources/mcp/server.mjs`へstdio接続 | 未達。現行はTasken executableをElectron-as-Nodeとして起動 |
| packaged readが実DBを返す | fixtureまたは隔離userDataの正本DBをCore経由でread、MCP resultにpath/tokenを含めない | 未達。Core単体/loopback証拠は別テストにある |
| packaged Proposalが正式化可能なpendingになる | MCP call → Core proposal → `ai_proposal` pending → Desktop UI preview → accept/reject → transaction | 未達。現行はinbox file→import |
| cleanup後に古い launcher / guard / inbox path が実行経路に残らない | static inventory gate + package contents + `TASKEN_MCP_NATIVE_CLEANUP_ENFORCE=1`で強制テスト | 未達。characterization testで現在地を固定 |

## 検証の順序

1. #412の残read / Proposal 11件をCoreへ移し、既存のcharacterizationと同じfixtureで結果・visibility・limit・redaction・errorを比較する。
2. source bridgeをplain Nodeで起動する最小smokeを追加する。Core discoveryがない場合は診断して終了し、legacy DBを開かないことを確認する。
3. `npm run build:mcp`後の`mcp-dist/server.mjs`を静的scanし、native import、Electron runtime guard、DB path、inbox filesystem writerを0件にする。
4. Windows packageでDesktopを起動し、Core discovery / health / named capability / authを確認したplain Node MCP clientからreadとProposalを実際に呼ぶ。
5. package smokeのcleanup、doctorのCore診断、`getMcpBridgeInfo`のplain Node設定を確認してから、launcher、runtime、legacy context、inbox writerを削除する。

`tests/tasken-mcp-native-cleanup-characterization.test.mjs` はこの文書の現在地を固定する。
将来の撤去PRでは `TASKEN_MCP_NATIVE_CLEANUP_ENFORCE=1` を付けて同テストを実行し、現在地のassertを最終境界assertへ更新する。
