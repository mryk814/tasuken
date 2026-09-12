# 稼働記録（observed deployment）

このファイルは「最後に実機NASで観測した稼働状態」を記録します。
Gitのbranch先端・build完了・ローカル検証とは別物です。更新後は下へ追記します。

## 実機NASの観測

- 未実施。このリポジトリからNASへはまだ配置していない。

## ローカル検証（NASではない）

### 2026-09-12 Linux amd64コンテナ（Docker Desktop）

- Image: `tasken-headless:local`（Node 24.20 / Debian bookworm / amd64）。source commit未固定の作業用build。
- 構成: `deploy/synology/Dockerfile` のruntimeを、`--user 1000:1000 --init --read-only --security-opt no-new-privileges --cap_drop ALL --tmpfs /tmp` 相当で起動。
- 結果:
  - ホスト役seedが共有volumeへ差分公開 → replicaが `TASKEN_HEADLESS_CORE_READY ... "sync_directory":"/sync"` で起動、health `healthy`。
  - replicaの `workspace_id` がホストと一致、`task-smoke-a` を受信、pending差分0。
  - `docker exec` + `TASKEN_MCP_READ_ONLY=1` で `tool_count 29`、`start_task_work` 非公開、`search_items` で同期Taskを読み取り。
  - snapshot要素検証: `/data` tar化、隔離read-only SQLite `integrity_check` と `workspace_id` 検査、`docker stop --time 20` → `docker start` → health `healthy`。
- 未確認: 実Synology実機、arm64/armv7、Synology Drive同期の遅延、`backup.sh` のNAS上での一連実行、MCP transport/tunnel。
