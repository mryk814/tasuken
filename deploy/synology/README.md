# Synology headless node（Container Manager）

Issue #588 Phase 2 のTasken headless replica配置です。詳細な手順・運用・未検証事項は
[docs/synology-headless-node.md](../../docs/synology-headless-node.md) を正本とします。

| ファイル                    | 役割                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `Dockerfile`                | Node 24専用image。`core-dist` / `mcp-dist` を作りElectronを含めない                                         |
| `docker-compose.yml`        | Container Manager Project用。UID/GID・read_only・cap_drop等を設定                                           |
| `docker-compose.tunnel.yml` | Secure MCP Tunnelサイドカー（Phase 3、上書き用）                                                            |
| `docker-compose.http.yml`   | tailnet向けStreamable HTTP MCP。NASホストのloopbackだけに待ち受ける上書き用設定                             |
| `.env.example`              | UID/GID・同期フォルダ・`TASKEN_CORE_WRITE_MODE`・tunnel設定の見本                                           |
| `backup.sh`                 | 稼働中replicaの`/data`を停止中にsnapshotし、隔離read-only検証を行う                                         |
| `nas-install.sh`            | NAS上の配置入口（source展開・image load・.env/state・write-probe・起動）                                    |
| `nas-read-check.mjs`        | 稼働中CoreへMCP(stdio)で接続し、tool一覧と読み取りを確認する（`TASKEN_MCP_READ_ONLY=0`でwrite toolsも列挙） |
| `DEPLOYED.md`               | 最後に観測した稼働状態（branch・versionとは別）                                                             |

守ること:

- replicaはread-only運用が既定。`TASKEN_CORE_WRITE_MODE=proposals` と `TASKEN_MCP_READ_ONLY=0` の両方でProposal受付を許可する。本人用Task/Noteの新規作成も許可する場合だけ、新Core/bridgeを配置し`TASKEN_CORE_WRITE_MODE=create-only`を明示する。汎用編集・削除・完了・直接開始は公開しない（[詳細](../../docs/ai-item-creation.md)）。
- SQLite/WALを同期フォルダ（SMB/NFS/OneDrive）へ置かない。`/data` はNASローカル。
- DesktopとNASで同じstateを同時に開かない（二重writerにしない）。

## TailnetからMCPへ接続する（#673）

`docker-compose.http.yml`をbaseに重ねると、`node /app/mcp-dist/http-server.mjs`が
`http://127.0.0.1:18181/mcp`で受け付けます。HTTP MCPはクライアント別Bearer token必須で、
既定は読み取り専用です。認証なし・不正tokenは401になります。stdioのChatGPTトンネルと併用できます。

適用手順は[正本のHTTP節](../../docs/synology-headless-node.md#tailnet内のstreamable-http-mcp673)を使ってください。
初回適用にはCoreをhost networkへ移し、併用するtunnelも再作成する必要があります。
Tailscale Serveの新しい公開先・ポート・継続範囲について、具体的な承認を得てから適用します。
既存kokokana等のServe routeやコンテナを停止・上書きしません。Funnelは使いません。

Bearer設定はgit管理外の`secrets/mcp_http_clients`へ保存します（実行UID所有、chmod 600）。
これはCoreの読み取り専用tokenとは別のbridge認証です。tokenをCore discoveryからコピーしません。
`DEPLOYED.md`の未確認欄を確認し、実機配備・別端末からの接続の証拠が揃うまで配備済みと扱わないでください。
