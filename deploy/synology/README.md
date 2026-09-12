# Synology headless node（Container Manager）

Issue #588 Phase 2 のTasken headless replica配置です。詳細な手順・運用・未検証事項は
[docs/synology-headless-node.md](../../docs/synology-headless-node.md) を正本とします。

| ファイル                    | 役割                                                                     |
| --------------------------- | ------------------------------------------------------------------------ |
| `Dockerfile`                | Node 24専用image。`core-dist` / `mcp-dist` を作りElectronを含めない      |
| `docker-compose.yml`        | Container Manager Project用。UID/GID・read_only・cap_drop等を設定        |
| `docker-compose.tunnel.yml` | Secure MCP Tunnelサイドカー（Phase 3、上書き用）                         |
| `.env.example`              | `TASKEN_UID` / `TASKEN_GID` / `TASKEN_ADMIN_GID` / `TASKEN_SYNC_DIR`     |
| `backup.sh`                 | 稼働中replicaの`/data`を停止中にsnapshotし、隔離read-only検証を行う      |
| `nas-install.sh`            | NAS上の配置入口（source展開・image load・.env/state・write-probe・起動） |
| `nas-read-check.mjs`        | 稼働中Coreへread-only MCP(stdio)で接続する読み取り確認                   |
| `DEPLOYED.md`               | 最後に観測した稼働状態（branch・versionとは別）                          |

守ること:

- replicaはread-only運用。MCPは `TASKEN_MCP_READ_ONLY=1` で起動する。
- SQLite/WALを同期フォルダ（SMB/NFS/OneDrive）へ置かない。`/data` はNASローカル。
- DesktopとNASで同じstateを同時に開かない（二重writerにしない）。
