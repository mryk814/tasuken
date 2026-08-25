# Tasken MCP native cleanup (#413)

## 結論

MCP bridgeはplain system Nodeのstdio processであり、Tasken Desktop Mainが所有するCoreへ認証付きloopback HTTPで接続する。bridgeはSQLite、Electron、native addon、filesystem Proposal inboxを使わない。

## Production graph

```text
node scripts/mcp-server.mjs
  -> src/main/mcp/server.mjs
  -> TaskenCoreClient
  -> owner-only tasken-core.json discovery
  -> authenticated /health, /version, /capabilities, query/command endpoint
```

package版ではsystem Nodeが`resources/mcp/server.mjs`を起動する。Tasken executableをNode互換runtimeとして使わない。

## 削除した経路

- `scripts/tasken-mcp-launcher.mjs`
- `scripts/mcp-runtime.mjs`
- `src/main/mcp/readOnlyContext.mjs`
- `src/main/mcp/proposalInbox.mjs`
- `ELECTRON_RUN_AS_NODE` guard
- `TASKEN_MCP_INBOX_PATH` queue/import
- MCP bundleの`better-sqlite3` external/native resolution

過去のCore parityを再現するlegacy oracleは`tests/fixtures/`に隔離し、production、package、client configから到達不能にする。filesystem inboxは現行runtimeのfallbackではない。

## 残すDesktop native境界

- `src/main/repositories/workspaceRepository.mjs`
- `better-sqlite3` dependency
- `rebuild:electron`
- `scripts/run-electron-node.mjs`

これらはDesktopの正本repositoryとtest runtime用であり、MCP bridge用ではない。

## Acceptance evidence

1. read 23 / proposal 13 registrationsが`withCoreClient`のみを使う。
2. Core停止時はtyped `CORE_UNAVAILABLE`となりDB/inboxへfallbackしない。
3. doctorがdiscovery/auth/health/version/live capabilitiesを照合し、secret/pathを出さない。
4. source/bundle scanにnative/Electron/inbox symbolがない。
5. packaged Windows Desktop Coreへsystem Node MCPが接続し、33 tools、read、Proposalを実行する。
6. Settingsのactual client configが`node <server.mjs>`でありInbox UIがない。

`TASKEN_MCP_NATIVE_CLEANUP_ENFORCE=1`でbundle sentinelを有効にする場合は、先に`npm run build:mcp`を実行する。
