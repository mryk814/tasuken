# Synology headless node セットアップ（#588 Phase 2）

Synology上でElectronなしのTasken Coreを常時稼働させ、既存の共有フォルダ同期へ**read-only replica**として参加させる手順です。
Desktopが停止していても、NASのローカルSQLiteが最新の同期差分を持ち、MCP（read-only）からContextを読める状態を目指します。

実装済みなのはheadless Coreとreplica参加（`docs/headless-core.md`）までです。MCP transport / Secure MCP Tunnelの常時稼働と、write有効化はPhase 3/4で未検証です。

```text
[データ端末 Tasken]
   │ 共有フォルダへ差分公開（OneDrive / 社内共有 / Synology Drive）
   ▼
[/volume1/tasken-sync]  ← NAS上の同期フォルダ（差分ファイルのみ。SQLiteは置かない）
   │
   ▼
[tasken-headless コンテナ]  tasken-data volume に自分のSQLite
   │  Docker exec 経由
   └─ node mcp-dist/server.mjs  (TASKEN_MCP_READ_ONLY=1)
          ▲
          外部AI（Phase 3でtransport接続）
```

## 前提

- DSM 7.2以降 + Container Manager
- NASへSSHできる（この手順はTailscale経由のSSH/scpを前提。`ssh <user>@synologyDS723`）
- CPUアーキテクチャを確認する。x86_64（Intel/AMD）またはaarch64（ARM64）を推奨。32-bit ARM（armv7）は非推奨。
  ```bash
  uname -m
  ```
- データ端末（Desktop）側で「設定 → 端末間同期」を設定し、共有フォルダへ差分が公開済みであること。NASは空のnodeとして参加するため、**最初にデータ端末で設定**します。

## 共有フォルダの置き場所

同期フォルダは「データ端末とNASが同じものを見る」フォルダです。次のどちらかです。

- **直接SMB（推奨・最小構成）**: NASの共有フォルダを作り、PCからSMBで開く。
  - NAS側: 共有フォルダ `Tasken` を作り、その下に `sync`（例 `/volume1/Tasken/sync`）。
  - PC側: `\\synologyDS723\Tasken\sync` をTaskenの「端末間同期」で選ぶ（`T:` などドライブ割り当てを推奨）。
  - クラウド同期を挟まないため遅延や途中欠けが少ない。
- **OneDrive + Cloud Sync**: PCはOneDriveフォルダ、NASはCloud Syncで同じフォルダを `/volume1/...` に落とす。既にOneDrive運用がある場合はこちら。

いずれも**SQLite / WAL / userDataを同期フォルダへ置かない**。共有するのは `tasken-sync.json`・`devices/{deviceId}/` の差分と添付だけです。SQLiteはNASローカルの `deploy/synology/state`（ホストbind、コンテナの`/data`）に置きます。

## 手順

### 1. フォルダを用意

- NAS側: 共有フォルダ `Tasken` に `sync` を作る（例 `/volume1/Tasken/sync`）。空のままでよい（データ端末が公開した差分が入る）。
- `deploy/synology/state` は初回に作る（コンテナの`/data`）。ホストbindなのでNASローカルに置かれ、同期フォルダとは別。

### 2. イメージとソースを転送する

開発機（Docker Desktop）でlinux/amd64を作り、NASへ渡す。NAS上ではbuildしない。PowerShellでバイナリをパイプすると壊れるため、`docker save -o` と `git archive -o` で直接ファイルへ書く。

SMBで共有フォルダを割り当てている場合（最小構成。例: `T:` = `\\synologyDS723\tasken`）:

```powershell
# 開発機（リポジトリroot）
docker build --platform linux/amd64 -f deploy/synology/Dockerfile -t tasken-headless:local .
New-Item -ItemType Directory -Force T:\_deploy | Out-Null
docker save -o T:\_deploy\tasken-headless-linux-amd64.tar tasken-headless:local
git archive -o T:\_deploy\tasken-source.tar HEAD
Copy-Item deploy/synology/nas-install.sh T:\_deploy\nas-install.sh
```

SSH/scpを使う場合（Tailscale経由）:

```bash
docker save -o tasken-headless-linux-amd64.tar tasken-headless:local
git archive -o tasken-source.tar HEAD
ssh <user>@synologyDS723 "sudo mkdir -p /volume1/tasken/_deploy"
scp -O tasken-headless-linux-amd64.tar tasken-source.tar deploy/synology/nas-install.sh <user>@synologyDS723:/volume1/tasken/_deploy/
```

`docker-compose` はContainer Manager同梱の `/var/packages/ContainerManager/target/usr/bin/docker-compose` を使う。

### 3. NAS上で配置して起動

`nas-install.sh` が source展開・image load・`.env`作成・`state`と`sync`のchown・write-probe・`compose up` をまとめて行う。NAS上で:

```bash
sudo bash /volume1/tasken/_deploy/nas-install.sh
```

- UID/GIDは同期フォルダの所有者から自動で取る。パスが違う場合は環境変数で上書きする:
  `sudo DEPLOY_SRC=/volume1/... SYNC_DIR=/volume1/... PROJECT_DIR=/volume1/... bash nas-install.sh`
- 途中の `WRITE_OK` と、最後の `TASKEN_HEADLESS_CORE_READY ... "sync_directory":"/sync"` を確認する。
- Container Managerの「プロジェクト」で読み込む場合は、composeの`build:`を削除して`image: tasken-headless:local`だけにし、`.env`を配置する（`TASKEN_UID`/`TASKEN_GID`/`TASKEN_SYNC_DIR`）。

### 4. 動作確認

- healthcheck: `sudo docker inspect --format '{{.State.Health.Status}}' tasken-headless`
- replicaがホストと同じWorkspaceを採用しているか（workspace_idがデータ端末と一致する）:
  ```bash
  sudo docker exec tasken-headless node -e "const D=require('better-sqlite3');const db=new D('/data/research-desk.sqlite',{readonly:true});console.log(db.prepare(\"select value from workspace_meta where key='workspace_id'\").get().value)"
  ```
- データ端末側でTaskを追加し、10秒pollの後にNASが受信していることをMCP読み取りで確認する（下記）。

### 5. MCPをread-onlyで使う

Coreは`127.0.0.1`のloopbackにだけ待ち受け、discovery fileはowner-only（mode 0600、uid一致）です。そのため**MCP bridgeはCoreと同じコンテナ・同じuidで起動**します。別コンテナや別ユーザーからは接続できません（`DISCOVERY_OWNER_MISMATCH`）。

```bash
sudo docker exec -i -e TASKEN_MCP_READ_ONLY=1 tasken-headless node mcp-dist/server.mjs
```

- `TASKEN_MCP_READ_ONLY=1` でwrite tools（`start_task_work`・`report_task_done`・`propose_*`等）は公開されません（読み取りtoolsのみ）。replicaからcanonical stateを書き換えないための必須設定です。
- 外部AIへつなぐSecure MCP Tunnel等のクライアントは、NASホスト側でこの`docker exec`をstdio起動する形にします。transportの設定と常時稼働はPhase 3で、このリポジトリでは未検証です。

## コンテナ設定（堅牢化）

`deploy/synology/docker-compose.yml` は次の前提で組んでいます。

- `user: "${TASKEN_UID:-1000}:${TASKEN_GID:-1000}"`。`deploy/synology/.env`（`.env.example` を参照）でNASの所有者に合わせる。Coreが書く `state`（`/data`）と同期フォルダ（`/sync`）はこのUID/GIDが読み書きできること。
- `group_add: ["${TASKEN_ADMIN_GID:-101}"]`。Synologyの共有フォルダは`synoacl`（NFSv4 ACL）で`administrators`に許可しており、コンテナにgid 101を付けないと共有フォルダがmode 0000扱いになりEACCESになる。`nas-install.sh`が`administrators`のgidを自動検出して`.env`へ書く。
- composeプロジェクト名は`name: tasken`。同じNASの別アプリ（例: nemoriumの`synology`プロジェクト）と`down`や`--remove-orphans`が干渉しないよう分離している。**`--remove-orphans`は使わない。**
- `read_only: true`、`cap_drop: ALL`、`security_opt: no-new-privileges`、`init: true`。書き込みは `./state`・`TASKEN_SYNC_DIR` のbindと `/tmp` のtmpfsだけ。
- `/data` は `./state` のホストbind（NASローカル）。`/sync` は `${TASKEN_SYNC_DIR}`（例 `/volume1/Tasken/sync`）。
- `restart: unless-stopped`、`stop_grace_period: 20s`（SIGTERMでCoreがdiscoveryを削除して終了する時間）。
- ログは `json-file` を10MB×3でローテーション。
- ImageのHEALTHCHECKがdiscoveryと `/health` を確認する。

`deploy/synology/` の各ファイル:

| ファイル             | 役割                                                                 |
| -------------------- | -------------------------------------------------------------------- |
| `Dockerfile`         | core-dist / mcp-dist を作るNode専用image                             |
| `docker-compose.yml` | Container Manager Project用のservice定義                             |
| `.env.example`       | `TASKEN_UID` / `TASKEN_GID` / `TASKEN_ADMIN_GID` / `TASKEN_SYNC_DIR` |
| `backup.sh`          | 稼働中replicaのsnapshotと隔離検証（後述）                            |
| `nas-install.sh`     | NAS上の配置入口（source展開・load・.env/state・probe・起動）         |
| `DEPLOYED.md`        | 最後に観測した稼働状態（branch・versionとは別）                      |

## 更新と復旧

NemoriumのHome Node運用（`deploy/synology/backup.sh` / `NAS_UPDATE_RECOVERY.md`）に倣い、更新は「snapshot → 候補image → 交換 → 照合」の順で行います。

1. 変更に直接関係する最小テストをWindows側で通し、**固定commit**からイメージを作る。`:local` の可変tagだけで判断しない。
   ```bash
   docker buildx build --platform linux/amd64 -f deploy/synology/Dockerfile \
     -t tasken-headless:<commit7> --load .
   docker save tasken-headless:<commit7> | gzip > tasken-headless-<commit7>.tar.gz
   ```
2. NAS上で稼働中replicaのsnapshotを取る（`backup.sh`）。停止中の `/data` をarchive化し、checksum・展開・隔離したread-only SQLite整合性を検証して、同じコンテナを再起動する。
   ```bash
   sudo bash deploy/synology/backup.sh
   ```
   - `backup/VERIFIED` が出て、元コンテナがhealthyに戻ったことを確認してから次へ進む。
   - これはreplicaの復旧用。正本のwriter権限を移すものではない（別nodeとして同時起動しない）。
3. 同じCompose project・同じ絶対配置を維持し、`image:` だけ新候補へ向けて `docker compose up -d`。`state` と `TASKEN_SYNC_DIR` は初期化しない。
4. healthだけでなく、データ端末側で追加したTaskがMCP読み取りに出ること、`workspaceId`がホストと一致することを確認する。
5. `DEPLOYED.md` に固定commit・image・snapshot結果・確認範囲を追記する。

失敗・中断時の原則:

- **候補の起動を試みた後は自動rollbackしない。** 変更後stateとsnapshotを保持し、実際に動いているimageと到達段階を診断する。
- Composeの終了コードが非zeroでも「stateを書いていない」証拠にはしない。プロセス・container ID/image/status・mount・lockを読み取りで観測してから再実行する。
- ログから長いJSONを受け渡さない（log driverが16KB付近で分割しうる）。構造化データは専用ファイルへ保存する。
- `restart: unless-stopped` の再起動ループは、`SYNC_FOLDER_NOT_READY` など解消可能な原因を直してから止める。

## 二重writerにしない

- replicaは**read-only運用**。MCPは `TASKEN_MCP_READ_ONLY=1` で起動し、write toolsを公開しない。
- DesktopとNASで**同じuserData/stateを同時に開かない**。stateは各nodeのローカルに置き、SQLite/WALをSMB/NFSや同期フォルダへ置かない。
- 同じuserDataでCoreが稼働中なら `CORE_ALREADY_RUNNING` で拒否される。durableなwriter authorityはPhase 4のwrite有効化と合わせて設計する。

## 運用

- **バックアップ**: `backup.sh` のsnapshotに加え、`tasken-data` volumeをHyper Backup / Snapshotで保護する。同期フォルダはbackupとして扱わない。
- **NAS停止時**: PC / Androidのローカル利用はそのまま継続する（設計条件）。NAS上のMCPだけが利用不可になる。
- **起動順**: 先にデータ端末で同期を設定する。NASを先に起動すると `SYNC_FOLDER_NOT_READY` で失敗し、共有設定後に再起動で復帰する（`restart: unless-stopped`）。
- **差分の未着**: OneDrive等の同期途中は `… を待っています` エラーで次回pollに再試行する。解消しない場合はデータ端末側の「差分を再公開」を使う（`docs/shared-folder-sync.md`）。

## トラブルシューティング

| 症状                                    | 原因と対処                                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `SYNC_FOLDER_NOT_READY`                 | 共有フォルダが未初期化。先にデータ端末で同期を設定する                                                                      |
| `CORE_ALREADY_RUNNING`                  | 同じuserDataで別Coreが稼働中。既存コンテナ/プロセスを止める                                                                 |
| `DISCOVERY_OWNER_MISMATCH`              | MCP bridgeが別uid/別コンテナ。同じコンテナで`docker exec`する                                                               |
| `NODE_MODULE_VERSION` 不一致            | `better-sqlite3`が別runtime向け。イメージを再buildする（`npm rebuild better-sqlite3`）                                      |
| 権限エラー（EACCES/EPERM）              | `/volume1/tasken/sync` の所有者・権限を確認                                                                                 |
| 共有フォルダだけEACCES（mode 0000表示） | Synologyの`synoacl`（NFSv4 ACL）。`group_add`のgid（DSM標準は101=administrators）を合わせる。`nas-install.sh`が自動検出する |

## 検証

### 2026-09-12 実機NAS（DS723+ / DSM 7.2 / amd64）

開発機のDocker Desktopで`linux/amd64`を作り、SMB共有フォルダ経由で搬入して配置した。詳細な観測値は[deploy/synology/DEPLOYED.md](../../deploy/synology/DEPLOYED.md)。

- `nas-install.sh`で`WRITE_OK` → `TASKEN_HEADLESS_CORE_READY ... "capability_count":31,"sync_directory":"/sync"`、health `healthy`。
- replica SQLite: `workspace_id`がPC側と一致、`tasks=19`、pending差分0、ホスト端末のcursorが196まで進行。
- read-only MCP（one-offコンテナ + `nas-read-check.mjs`）: `TOOL_COUNT 29`、write tools非公開、`search_items`が実Task IDを返却。
- 実機固有の修正: 共有フォルダの`synoacl`によりコンテナ内でmode 0000/EACCES → composeの`group_add: [101]`（`TASKEN_ADMIN_GID`）で解消。

### 2026-09-12 Linux amd64コンテナ（Docker Desktop）

- `docker build -f deploy/synology/Dockerfile -t tasken-headless:local .` が成功（Node 24.20 / Debian bookworm）。
- ホスト役のseed（build stage, uid 1000）が共有volumeへ差分公開 → replicaコンテナ（runtime, uid 1000）が `TASKEN_HEADLESS_CORE_READY ... "sync_directory":"/sync"` で起動。
- healthcheckが `healthy`、replicaのSQLiteはホストと同一 `workspace_id`、Taskを受信、pending差分0。
- `docker exec`（`TASKEN_MCP_READ_ONLY=1`）で `tool_count 29`・write tools非公開、`search_items` で同期Taskを読み取り。
- 堅牢化compose相当（`--user 1000:1000 --init --read-only --security-opt no-new-privileges --cap-drop ALL --tmpfs /tmp`）でも上記が成立。
- snapshot手順の要素検証: `bash -n deploy/synology/backup.sh`、`/data`のtar化、隔離したread-only SQLite `integrity_check` と `workspace_id` 検査、稼働コンテナの `docker stop --time 20` → `docker start` → health `healthy`。
- Capture / Task画像のreplica読み取り（`get_capture_image`・`get_task_image`、`sha256`照合、改ざん時not_found）は `tests/tasken-headless-core.test.mjs` で確認。

`.dockerignore` の漏れでbuild contextが400MBを超えていた（`output/` が15.9GB）。contextが大きい場合は除外を確認する。

## 未検証・既知の制約

- arm64 / armv7のNASは未検証（実機確認はamd64のDS723+）。
- Synology Drive / Cloud Sync経由の同期（実機確認はSMB共有フォルダ直結）。
- Desktop停止状態でのNAS読み取り再確認、`backup.sh`のNAS上での一連実行（compose検出・排他lock・再起動を含む）は未実施。
- MCP transport / Secure MCP Tunnelの常時稼働、再接続、write有効化はPhase 3/4で、Core側のwrite capability gateは未実装（現状はMCP bridgeのread-only設定に依存）。
- bootstrap / compaction / revoke / schema upgradeのowner決定はPhase 2の残り。Note Markdown画像の扱いと、コンテナ上での画像MCP再実行は未検証。
- イメージbuild/runにはDocker daemonが必要。

## 参照

- [Headless Core](headless-core.md)
- [端末間同期](shared-folder-sync.md)
- [外部AI連携](external-ai-integration.md)
