# Synology headless node（Container Manager）

Issue #588 Phase 2 のTasken headless replica配置です。詳細な手順・運用・未検証事項は
[docs/synology-headless-node.md](../../docs/synology-headless-node.md) を正本とします。

| ファイル                    | 役割                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `Dockerfile`                | Node 24専用image。`core-dist` / `mcp-dist` を作りElectronを含めない                                         |
| `docker-compose.yml`        | Container Manager Project用。UID/GID・read_only・cap_drop等を設定                                           |
| `docker-compose.tunnel.yml` | Secure MCP Tunnelサイドカー（Phase 3、上書き用）                                                            |
| `.env.example`              | UID/GID・同期フォルダ・`TASKEN_CORE_WRITE_MODE`・tunnel設定の見本                                           |
| `backup.sh`                 | 稼働中replicaの`/data`を停止中にsnapshotし、隔離read-only検証を行う                                         |
| `nas-install.sh`            | NAS上の配置入口（source展開・image load・.env/state・write-probe・起動）                                    |
| `nas-read-check.mjs`        | 稼働中CoreへMCP(stdio)で接続し、tool一覧と読み取りを確認する（`TASKEN_MCP_READ_ONLY=0`でwrite toolsも列挙） |
| `DEPLOYED.md`               | 最後に観測した稼働状態（branch・versionとは別）                                                             |

守ること:

- replicaはread-only運用が既定。書き込みを許す場合も `TASKEN_CORE_WRITE_MODE=proposals` と `TASKEN_MCP_READ_ONLY=0` の両方で、Proposal（Feed投稿・Note案・Task案・Task作業報告）だけを許可する。直接書き込みは公開しない。
- SQLite/WALを同期フォルダ（SMB/NFS/OneDrive）へ置かない。`/data` はNASローカル。
- DesktopとNASで同じstateを同時に開かない（二重writerにしない）。
