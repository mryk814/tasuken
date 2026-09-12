# 稼働記録（observed deployment）

このファイルは「最後に実機NASで観測した稼働状態」を記録します。
Gitのbranch先端・build完了・ローカル検証とは別物です。更新後は下へ追記します。

## 実機NASの観測

### 2026-09-12 初回配置（DS723+ / DSM 7.2 / amd64）

- Host: `synologyds723`（Tailscale `100.109.102.122`）。SSHユーザーは`takuya_admin`（uid 1026, gid 100, administrators 101）。NAS上ではbuildせず、開発機のDocker Desktopで作った`linux/amd64` imageをSMB共有フォルダ経由で搬入。
- 配置: project `/volume1/docker/tasken`、compose project名 `tasken`（nemoriumの`synology`プロジェクトと分離）。sourceは`git archive HEAD`を`/volume1/docker/tasken`へ展開。
- Image: `tasken-headless:local`（`deploy/synology/Dockerfile`、Node 24 / Debian bookworm / amd64）。`nas-install.sh`でsource展開・`docker load`・`.env`作成・`state`/`sync`のchown・write-probe・`compose up`を実行。
- State: `/volume1/docker/tasken/deploy/synology/state`（bind、NASローカル）。SQLite/WALは同期フォルダに置いていない。
- Sync: 共有フォルダ `/volume1/tasken/sync`（PCは`\\synologyDS723\tasken\sync`を`T:`に割当）。ホスト端末`14efbb12-...`の差分をreplicaが受信。
- 実測:
  - `docker logs`: `TASKEN_HEADLESS_CORE_READY ... "capability_count":31,"sync_directory":"/sync"`、health `healthy`。
  - replica SQLite: `workspace_id=047c7258-51d5-4399-a22c-c38c6d274b07`（PC側と一致）、`tasks=19`、`pending=0`、cursor `14efbb12-...: 196`。
  - read-only MCP（`nas-read-check.mjs`をone-offコンテナで実行）: `TOOL_COUNT 29`、`HAS_WRITE false`、`IS_ERROR false`、Task IDを返却。
  - **PCのTaskenを終了した状態**でread-only MCPを再実行しても同じ結果。NAS単体でContextを返せることを確認（Desktop停止中の最初の成功journey）。
- 途中で解消した実機固有の問題:
  - 共有フォルダがコンテナ内でmode 0000表示になりEACCES。Synologyの`synoacl`（NFSv4 ACL）が`administrators`にのみ許可しているため。composeに`group_add: [101]`（`TASKEN_ADMIN_GID`）を追加して解消。
- 未確認: arm64/armv7、Synology Drive/Cloud Sync経由の同期、`backup.sh`のNAS上での一連実行、write有効化。

### 2026-09-12 Phase 3（Secure MCP Tunnel）— ChatGPT側の不具合で保留

- `deploy/synology/docker-compose.tunnel.yml` のサイドカーを`tasken-tunnel`として配置。Coreとnetwork namespaceを共有し、`node /app/mcp-dist/server.mjs`（`TASKEN_MCP_READ_ONLY=1`）をstdio子プロセスで起動。
- tunnel-id `tunnel_6aa4aa138f10819198458b82e82c079e`（workspace `3083b9a4-b8ca-4bfd-a492-d01dc70d1361` / org `org-eUJyc2qzXK19pSW6VV0RZhqO`）。daemonはhealth `healthy`、metadata取得成功、poller稼働。
- 途中修正: runtime imageへ`ca-certificates`追加（`x509: certificate signed by unknown authority`）、secretの所有者を`TASKEN_UID`へ（`permission denied`）。
- **保留理由**: ChatGPT Plus + Personal workspaceでは、developer-mode app作成の`Connection: Tunnel`にtunnelが一覧表示されない（「No available tunnels」）。OpenAI側の既知問題（`tunnel_principal_association_unverified`、2026年半ばから複数報告・Support対応中）で、Tasken側の設定漏れではない。
- 再開条件: OpenAI側の修正、またはBusiness/Enterprise workspaceでの接続。Codex plugin（PC側runtimeが必要）やResponses API/AgentKitは別経路として利用可能。
- 保留中の運用: `tasken-headless`（replica）は稼働継続。`tasken-tunnel`は起動したままでも負荷は小さく、止める場合は`sudo docker stop tasken-tunnel`（再開は`docker-compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --no-build`）。

## ローカル検証（NASではない）

### 2026-09-12 Linux amd64コンテナ（Docker Desktop）

- Image: `tasken-headless:local`（Node 24.20 / Debian bookworm / amd64）。source commit未固定の作業用build。
- 構成: `deploy/synology/Dockerfile` のruntimeを、`--user 1000:1000 --init --read-only --security-opt no-new-privileges --cap_drop ALL --tmpfs /tmp` 相当で起動。
- 結果:
  - ホスト役seedが共有volumeへ差分公開 → replicaが `TASKEN_HEADLESS_CORE_READY ... "sync_directory":"/sync"` で起動、health `healthy`。
  - replicaの `workspace_id` がホストと一致、Taskを受信、pending差分0。
  - `docker exec` + `TASKEN_MCP_READ_ONLY=1` で `tool_count 29`、write tools非公開、`search_items` で同期Taskを読み取り。
  - Capture/Task画像: host公開の`sha256`とMCP取得の`sha256`が一致。改ざん時はnot_found。
  - snapshot要素検証: `/data` tar化、隔離read-only SQLite `integrity_check` と `workspace_id` 検査、`docker stop --time 20` → `docker start` → health `healthy`。
