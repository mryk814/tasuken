# Synology headless node セットアップ（#588 Phase 2）

Synology上でElectronなしのTasken Coreを常時稼働させ、既存の共有フォルダ同期へ**read-only replica**として参加させる手順です。
Desktopが停止していても、NASのローカルSQLiteが最新の同期差分を持ち、MCP（read-only）からContextを読める状態を目指します。

headless Coreとreplica参加（`docs/headless-core.md`）、Secure MCP Tunnelを利用できます。トンネルの常時稼働とwrite有効化（`proposals`配備）は2026-09-27、別クライアント向けのStreamable HTTP MCPは2026-10-22に実機NASへ配置しました。配置版・確認範囲・本人報告と独立観測の区別は[deploy/synology/DEPLOYED.md](../deploy/synology/DEPLOYED.md)を参照してください。Grok Bot本体とChatGPT実クライアントの再接続、NAS再起動後の復帰は未検証です。

```text
[データ端末 Tasken]
   │ 共有フォルダへ差分公開（OneDrive / 社内共有 / Synology Drive）
   ▼
[/volume1/tasken-sync]  ← NAS上の同期フォルダ（差分ファイルのみ。SQLiteは置かない）
   │
   ▼
[tasken-headless コンテナ]  tasken-data volume に自分のSQLite
   │  Docker exec 経由
   └─ node mcp-dist/server.mjs  (TASKEN_MCP_READ_ONLY=1。提案を受け付ける配備では0)
          ▲
          外部AI（Secure MCP Tunnel経由）
```

## 前提

- DSM 7.2以降 + Container Manager
- NASへSSHできる（この手順はTailscale経由のSSH/scpを前提。`ssh <user>@<nas-host>`）
- CPUアーキテクチャを確認する。x86_64（Intel/AMD）またはaarch64（ARM64）を推奨。32-bit ARM（armv7）は非推奨。
  ```bash
  uname -m
  ```
- データ端末（Desktop）側で「設定 → 端末間同期」を設定し、共有フォルダへ差分が公開済みであること。NASは空のnodeとして参加するため、**最初にデータ端末で設定**します。

## 共有フォルダの置き場所

同期フォルダは「データ端末とNASが同じものを見る」フォルダです。次のどちらかです。

- **直接SMB（推奨・最小構成）**: NASの共有フォルダを作り、PCからSMBで開く。
  - NAS側: 共有フォルダ `Tasken` を作り、その下に `sync`（例 `/volume1/Tasken/sync`）。
  - PC側: `\\<nas-host>\Tasken\sync` をTaskenの「端末間同期」で選ぶ（`T:` などドライブ割り当てを推奨）。
  - クラウド同期を挟まないため遅延や途中欠けが少ない。
- **OneDrive + Cloud Sync**: PCはOneDriveフォルダ、NASはCloud Syncで同じフォルダを `/volume1/...` に落とす。既にOneDrive運用がある場合はこちら。

いずれも**SQLite / WAL / userDataを同期フォルダへ置かない**。共有するのは `tasken-sync.json`・`devices/{deviceId}/` の差分と添付だけです。SQLiteはNASローカルの `deploy/synology/state`（ホストbind、コンテナの`/data`）に置きます。

## 手順

### 1. フォルダを用意

- NAS側: 共有フォルダ `Tasken` に `sync` を作る（例 `/volume1/Tasken/sync`）。空のままでよい（データ端末が公開した差分が入る）。
- `deploy/synology/state` は初回に作る（コンテナの`/data`）。ホストbindなのでNASローカルに置かれ、同期フォルダとは別。

### 2. イメージとソースを転送する

開発機（Docker Desktop）でlinux/amd64を作り、NASへ渡す。NAS上ではbuildしない。PowerShellでバイナリをパイプすると壊れるため、`docker save -o` と `git archive -o` で直接ファイルへ書く。

`core.autocrlf=true` の作業コピーでは `git archive` が**CRLFのまま**書き出し、NAS上の `bash nas-install.sh` が
`set: pipefail` で失敗する。ソースtarは改行をLFへ固定して作る（2026-09-26に実機で発生）。

SMBで共有フォルダを割り当てている場合（最小構成。例: `T:` = `\\<nas-host>\tasken`）:

```powershell
# 開発機（リポジトリroot）
docker build --platform linux/amd64 -f deploy/synology/Dockerfile -t tasken-headless:local .
New-Item -ItemType Directory -Force T:\_deploy | Out-Null
docker save -o T:\_deploy\tasken-headless-linux-amd64.tar tasken-headless:local
git -c core.autocrlf=false -c core.eol=lf archive --format=tar -o T:\_deploy\tasken-source.tar HEAD
# nas-install.sh もLFで渡す（作業コピーはCRLFのことがある）。tarから取り出すのが確実。
tar -xf T:\_deploy\tasken-source.tar -C $env:TEMP deploy/synology/nas-install.sh
Copy-Item "$env:TEMP\deploy\synology\nas-install.sh" T:\_deploy\nas-install.sh -Force
```

転送後は両側で `sha256sum` を突き合わせる（SMB経由の取りこぼしを検知する）。

SSH/scpを使う場合（Tailscale経由）:

```bash
docker save -o tasken-headless-linux-amd64.tar tasken-headless:local
git -c core.autocrlf=false -c core.eol=lf archive --format=tar -o tasken-source.tar HEAD
ssh <user>@<nas-host> "sudo mkdir -p /volume1/tasken/_deploy"
scp -O tasken-headless-linux-amd64.tar tasken-source.tar deploy/synology/nas-install.sh <user>@<nas-host>:/volume1/tasken/_deploy/
```

DSM側の設定によっては `scp` が `Connection closed` で拒否される（実機で発生。SSHのログイン自体は成功する）。
その場合はSMB共有経由でコピーする。

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

- `TASKEN_MCP_READ_ONLY=1` でwrite tools（`start_task_work`・`report_task_done`・`propose_*`等）は公開されません（読み取りtoolsのみ）。replicaからcanonical stateを書き換えないための既定です。提案だけを受け付ける場合は次の節の2設定を使います。
- 外部AIへつなぐSecure MCP Tunnel等のクライアントは、NASホスト側でこの`docker exec`をstdio起動する形にします。常時稼働させる構成は次のPhase 3を参照してください。

### 投稿・提案を受け付ける（`--write-mode=proposals`）

既定では読み取りだけです。`deploy/synology/.env`で`TASKEN_CORE_WRITE_MODE=proposals`にすると、CoreはテキストのFeed投稿・Note案・Task案・Task作業報告だけを提案として受け付けます。さらにtunnel側で`TASKEN_MCP_READ_ONLY=0`にすると、外部AIからこれらの提案を送れます（**両方の設定が必要**）。

- Core側が許可範囲を強制します。範囲外の種類（`note_edit`・`feed_reply`・画像付きNote・`repository_context`・直接開始など）は`WRITE_NOT_ALLOWED`で拒否されます。
- Task作業報告（`append_work_receipt`・`report_task_done`・`report_task_blocked`）はProposalなので、NASでも正式データはDesktopでの採用まで変わりません。開始（`start_task_work`）は直接書き込みのため公開しません。Desktopから開始するか、完了報告の採用時に開始も記録させてください。
- 作ったProposalは正式データではなく、DesktopのAgent Desk・Feedで人が確認して採用します。
- 1つの`idempotency_key`は1つのnodeだけへ送ってください。DesktopとNASの両方へ同じkeyを送ると競合になります。
- 画像付きProposalのstageはNASにはないため、画像付きNote案は受け付けられません。
- 設定は`nas-install.sh`の再実行でも保持されます。`.env`を直接編集したあとは、`docker-compose ... up -d`で`tasken-headless`と`tasken-tunnel`を作り直してください。

#### MCP client（ChatGPT等）から見える範囲

`TASKEN_MCP_READ_ONLY=0`のbridgeは、起動時にCoreのcapabilityを読み、この配備で使える書き込みtoolだけを一覧に出します。`proposals`配備で一覧に出るwrite toolsは次の5つです。

| tool                         | Coreの判定                            |
| ---------------------------- | ------------------------------------- |
| `tasken.propose_feed_post`   | 受け付ける（`feed_post`）             |
| `tasken.propose_note`        | 受け付ける（画像なしの`note_create`） |
| `tasken.append_work_receipt` | 受け付ける（`propose_task_work`）     |
| `tasken.report_task_done`    | 受け付ける（同上）                    |
| `tasken.report_task_blocked` | 受け付ける（同上）                    |

`propose_note_edit`（`kind_not_allowed:note_edit`）・`answer_feed_question`（`kind_not_allowed:feed_reply`）・`start_task_work`（`missing_capability:task.command`）は一覧に出ません。AIは`tasken.get_capabilities`で、使えないtoolとその理由を一度に確認できます。一覧から外すのは案内のためで、Core自身の`WRITE_NOT_ALLOWED`による拒否が引き続き最終の境界です（画像付きNote案は`propose_note`が一覧に残るため、Coreが拒否します）。bridgeの起動時にCoreへ接続できなかった場合は全toolを登録し、呼び出し時にCoreが拒否します。

Task**案**を作るtoolは現行のMCP bridgeには登録されていません（`propose_repository_task` capabilityはCore側にあります）。ChatGPTへTaskを作らせたい場合は、Feed投稿かNote案として送り、DesktopでTaskへ昇格させてください。

現在の見え方は次のコマンドで実測できます（toolを列挙して`search_items`を1回読むだけで、書き込みはしません）。

```bash
sudo docker run --rm --network container:tasken-headless --user 1026:100 \
  -e TASKEN_MCP_READ_ONLY=0 \
  -v /volume1/docker/tasken/deploy/synology/nas-read-check.mjs:/check/nas-read-check.mjs:ro \
  -v /volume1/docker/tasken/deploy/synology/state:/data:ro \
  --entrypoint node tasken-headless:local /check/nas-read-check.mjs
```

- 期待値（`proposals`配備）: `TOOL_COUNT 21`（read 16 + write 5）・`HAS_WRITE true`。`-e TASKEN_MCP_READ_ONLY=0`を外すと`TOOL_COUNT 16`・`HAS_WRITE false`。Coreが`read-only`配備なら、`TASKEN_MCP_READ_ONLY=0`でも使える書き込みtoolがないため`TOOL_COUNT 16`です。
- `tasken-headless:local`の代わりに固定tagのimageを使うと、配置版を明示できます。

## Phase 3: Secure MCP Tunnelで外部AIへ公開

NASのCoreはloopbackのみなので、ChatGPT/Codex等へはOpenAI Secure MCP Tunnelの`tunnel-client`をNAS側で常駐させ、**outbound HTTPSだけ**で接続します（inboundポートは開けません）。実装は`deploy/synology/docker-compose.tunnel.yml`のサイドカーで、Coreとネットワーク名前空間を共有し、`node /app/mcp-dist/server.mjs`をstdio子プロセスとして起動します（`TASKEN_MCP_READ_ONLY`は既定`1`）。Tasken domain側へtransport固有logicは持ち込みません。

準備:

1. PlatformのTunnels managementで`tunnel_id`を取得（`tunnel_`＋32桁hex）。
2. PlatformのRuntime API keysでruntime keyを作成（**admin keyは使わない**）。
3. NASで`.env`とsecretを用意し、tunnel serviceを起動する。

```bash
cd /volume1/docker/tasken/deploy/synology
# .env の CONTROL_PLANE_TUNNEL_ID=tunnel_... を設定（未使用時は空のまま）
umask 077; printf '%s' 'sk-...' | sudo tee secrets/control_plane_api_key >/dev/null
UID_=$(sed -n 's/^TASKEN_UID=//p' .env); GID_=$(sed -n 's/^TASKEN_GID=//p' .env)
sudo chown -R "$UID_:$GID_" secrets
sudo chmod 600 secrets/control_plane_api_key
sudo /var/packages/ContainerManager/target/usr/bin/docker-compose \
  --env-file .env -f docker-compose.yml -f docker-compose.tunnel.yml up -d --no-build
```

`docker compose`のsecretはbindされるだけで所有者は変わらないため、**secretの所有者をコンテナ実行uid（`TASKEN_UID`）に合わせる**必要があります。合っていないと`read control-plane api key file /run/secrets/control_plane_api_key: permission denied`で再起動を繰り返します。

`nas-install.sh`は、`CONTROL_PLANE_TUNNEL_ID`と`secrets/control_plane_api_key`が揃っていればtunnelも自動起動します。keyは`.env`・ログ・チャットへ出さず、`secrets/control_plane_api_key`（git管理外、chmod 600）だけに置きます。読み取りは`--control-plane.api-key=file:/run/secrets/control_plane_api_key`で行います。

4. 確認:

```bash
sudo docker inspect --format '{{.State.Health.Status}}' tasken-tunnel
sudo docker logs --tail=30 tasken-tunnel
```

5. ChatGPT: `https://chatgpt.com/#settings/Connectors` で **Connection: Tunnel** を選び、このtunnelを選択（または`tunnel_id`を貼る）。daemonがhealthyな間だけ選択できます。

補足:

- tunnel-clientのimageは`--build-arg TUNNEL_CLIENT_IMAGE=ghcr.io/openai/tunnel-client:vX.Y.Z`で固定できます（既定`latest`。本番は固定を推奨）。
- 2026-09-12時点の実機観測: NAS側のdaemonは`healthy`・metadata取得済みだが、**ChatGPT Plus + Personal workspaceでは`Connection: Tunnel`の一覧にtunnelが出ない**（OpenAI側の既知問題。`tunnel_principal_association_unverified`）。Business/Enterprise workspaceかOpenAI側の修正待ち。経緯は[deploy/synology/DEPLOYED.md](../deploy/synology/DEPLOYED.md)。
- その後、利用者からChatGPTから接続できたとの報告があり、現在の利用状況として扱う（2026-09-27時点）。上の09-12観測は履歴として残す。
- 未検証: ChatGPT実クライアントからの書き込み往復（読み取りは利用中）、transport切断・再接続、NAS再起動後の自動復帰。

## Tailnet内のStreamable HTTP MCP（#673）

ChatGPT以外のMCPクライアントは、`mcp-dist/http-server.mjs`の`/mcp`へStreamable HTTPで接続できます。
既存stdio bridgeと同じCoreを使うため、Secure MCP Tunnelを動かしたまま追加できます。
HTTP MCPの既定は読み取り専用です。`/health`は起動確認だけを返し、Core情報やデータを返しません。
Streamable HTTPはセッションを持たないPOSTとJSON応答を使います。SSE常時接続やブラウザからの接続を前提とせず、Originヘッダー付き要求は拒否します。
要求本文はstdioと同じ35MiBを上限とし、超過はJSON解析前に413で拒否します。

### 事前確認と承認範囲

この節は配備手順であり、稼働確認ではありません。現在の観測は[DEPLOYED.md](../deploy/synology/DEPLOYED.md)を参照します。
固定commitのimageを用意し、前述のsnapshot・checksum・復旧点の確認を終えてから適用します。
Windowsからシェルスクリプトを搬入する場合は、搬入コピーをBOMなしUTF-8・LFにし、NAS上でもCRが混入していないことを確認します。`bash -n`だけでは`set -euo pipefail`のCRLFによる起動失敗を検出できません。
`nas-install.sh`はHTTP overlayを自動選択しません。既存配備の更新に初期配置手順をそのまま再実行しないでください。

1. NASで実際のCompose project・使用ファイル・image・UID/GID・mount・Coreとtunnelのhealthを確認し、設定とsecretを非公開に保全する。
2. `tailscale serve status`と`tailscale funnel status`を確認し、既存route、使用HTTPSポート、Funnel設定を記録する。NASの`18181`の待受所有者も確認し、競合時は停止・置換せず別の空きポートを選ぶ。
3. 対象はTasken HTTP MCP、backendはNASの`127.0.0.1:18181`、公開候補は空いているHTTPSポート（例`8444`）の`/mcp`、範囲は許可されたtailnet端末、`--bg`でNAS上に継続設定することを具体的に示し、適用承認を得る。既存kokokanaの443 routeは保持し、Funnel・firewall・ACLをこの手順で変更しない。

HTTP overlayは`tasken-headless`を`network_mode: host`へ変更し、HTTP/tunnelはその名前空間を共有します。
Core・HTTP・tunnel管理用endpointはいずれも既存のloopback待受を維持します。
Dockerの`ports: 127.0.0.1:...`ではコンテナ内部の`127.0.0.1`へ届かないため、ポート転送や`0.0.0.0` bindでは代替しません。
初回はCoreと併用中のtunnelを再作成する変更になります。host networkへの切替も上記の承認対象です。

### クライアント別Bearer token

NASの`deploy/synology/secrets/mcp_http_clients`へ次の形のJSONを保存します。値は例示用で、実tokenは共有しません。

```json
{
  "grokbot": {
    "token": "<32 byte random base64url token (43 characters)>",
    "readOnly": true
  }
}
```

- tokenはクライアントごとに32byteの暗号学的乱数からbase64urlで生成し、クライアント側のsecret管理へ安全な経路で渡す。JSONはgit管理外とし、コンテナ実行UID所有、mode 600にする。ログ・チャット・`.env`・Exportに値を出さない。
- これはHTTP bridge専用のtokenであり、Core discoveryの全権token、既存Core読み取り専用クライアントtokenとは別。`grokbot`という表示名は到達端末の検証を代替しない。
- `readOnly`省略時はtrue。`TASKEN_MCP_READ_ONLY=1`なら`readOnly:false`でも書き込みを許可しない。
- 書き込みを明示的に許す場合だけ、Coreの`proposals`または`create-only`、`TASKEN_MCP_READ_ONLY=0`、該当クライアントの`readOnly:false`を揃える。汎用編集・削除・完了・直接開始はHTTP側へ公開しない。
- Coreが直接開始も許可するprofile、`full`や不明なprofileの場合、HTTPの書き込み接続は503で拒否する。読み取り専用接続は利用できるため、既存tunnelの開始権限を保つ配備ではHTTP側を読み取り専用にする。
- tokenの追加・ローテーション・取り消しはsecretを更新して`mcp-http`を再作成する。再作成まで古い設定が有効なため、取り消し時も再作成の成功を確認する。

### 起動・Serve route追加

NASの配備ディレクトリで、既存の`.env`を保持したまま`TASKEN_MCP_HTTP_PORT=18181`を設定します。
通常はCore・HTTP・併用中のtunnelを同じ検証済みimageへ揃えます。稼働中のCoreとtunnelのimageを保持してHTTPだけを追加する場合は、変更前に候補HTTPを現行Coreと同じnetwork namespace・同じUID・`/data:ro`で隔離起動し、`initialize`・`tools/list`・`get_capabilities`と読み取りを確認します。各serviceのimageを固定し、既存Coreのwrite mode・開始権限・mount・envは変更しません。
既存tunnelが書き込みを受け付けていても、新しいHTTPを読み取り専用にする場合はHTTP serviceの`TASKEN_MCP_READ_ONLY`だけを`1`へ固定します。共有`.env`の変更で既存tunnelの権限を変えないでください。
以下はトンネルを併用する例です。HTTPだけなら`-f docker-compose.tunnel.yml`を外します。

```bash
sudo /var/packages/ContainerManager/target/usr/bin/docker-compose \
  --env-file .env -f docker-compose.yml -f docker-compose.tunnel.yml \
  -f docker-compose.http.yml up -d --no-build --force-recreate
```

Core・HTTP・tunnelのhealth、実際のnetwork modeとmount、NASホストの`127.0.0.1:18181`からの応答を確認します。
`/health`の成功だけではCore接続やMCP動作の確認になりません。
NASホストでMCP認証と読み取りを確認後、承認された未使用のHTTPSポートだけにServe routeを追加します。
次の`8444`は選定例です。現在のrouteと合意したポートに置き換えます。

```bash
sudo tailscale serve --bg --https=8444 http://127.0.0.1:18181
tailscale serve status
tailscale funnel status
```

[Tailscale Serveの公式手順](https://tailscale.com/docs/reference/tailscale-cli/serve)に従い、実際の表示からURLを採ります。
接続先は`https://<NASのtailnet名>:<合意したHTTPSポート>/mcp`、ヘッダーは`Authorization: Bearer <そのクライアントのtoken>`です。
PC側localhostへのforwardではなく、Serveを実行するNASホストのlocalhostへ到達することを確認します。
Serveはtailnet内向けです。Funnelは有効にせず、既存のFunnel設定でこのポートが公開されている場合は設定追加を止めて確認します。

### 受け入れ・トンネルからの切替

NASとGrok Botなどの別端末が同じtailnetへ接続し、アクセス許可がある状態で、別端末から以下を確認します。

1. 認証なし・不正tokenで`POST /mcp`が401になる。
2. 正しいtokenを指定したStreamable HTTP MCPクライアントで`initialize`、`tools/list`、`tasken.get_capabilities`が成功する。
3. 読み取り専用クライアントにwrite toolsが出ず、`get_capabilities`も読み取り専用を示す。権限を許可した場合もCoreとクライアント設定の範囲を越えない。
4. NASの待受がloopbackだけであること、対象ポートがServeにだけ設定されFunnelにないことを確認する。さらにtailnetを切った別ネットワークの端末から対象URLへ届かないことを確認する。設定の読取だけでtailnet外の到達拒否を実測済みとしない。
5. 併用中のChatGPTトンネルのhealthと読み取りを確認する。固定commit/image・token値を含めないクライアント名・到達元・応答結果・未検証範囲を`DEPLOYED.md`へ記録する。

HTTPを確認後、トンネル停止を承認された場合は同じComposeファイル構成で`tunnel-client`だけを`stop`します。
以降の起動はbase+HTTPだけを指定し、`nas-install.sh`が既存tunnel設定から自動起動する点にも注意します。
再開する場合はbase+tunnel+HTTPで`tunnel-client`を起動します。secretや既存設定を削除せず、`down`・`--remove-orphans`・Serve全体の`reset`は使いません。

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

| ファイル                    | 役割                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `Dockerfile`                | core-dist / mcp-dist を作るNode専用image                                                           |
| `docker-compose.yml`        | Container Manager Project用のservice定義                                                           |
| `docker-compose.tunnel.yml` | Secure MCP Tunnelサイドカー（Phase 3、上書き用）                                                   |
| `.env.example`              | UID/GID・同期フォルダ・`TASKEN_CORE_WRITE_MODE`・`TASKEN_MCP_READ_ONLY`・`CONTROL_PLANE_TUNNEL_ID` |
| `backup.sh`                 | 稼働中replicaのsnapshotと隔離検証（後述）                                                          |
| `nas-install.sh`            | NAS上の配置入口（source展開・load・.env/state・probe・起動）                                       |
| `DEPLOYED.md`               | 最後に観測した稼働状態（branch・versionとは別）                                                    |

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

- replicaは**read-only運用が既定**。MCPは `TASKEN_MCP_READ_ONLY=1` で起動し、write toolsを公開しない。書き込みを許す配備でも、Core側の`--write-mode=proposals`と合わせてProposal（Feed投稿・Note案・Task案・Task作業報告）だけを許可し、正式データはDesktopでの採用まで変えない。
- DesktopとNASで**同じuserData/stateを同時に開かない**。stateは各nodeのローカルに置き、SQLite/WALをSMB/NFSや同期フォルダへ置かない。
- 同じuserDataでCoreが稼働中なら `CORE_ALREADY_RUNNING` で拒否される。durableなwriter authorityはPhase 4のwrite有効化と合わせて設計する。

## 運用

- **バックアップ**: `backup.sh` のsnapshotに加え、`tasken-data` volumeをHyper Backup / Snapshotで保護する。同期フォルダはbackupとして扱わない。
- **NAS停止時**: PC / Androidのローカル利用はそのまま継続する（設計条件）。NAS上のMCPだけが利用不可になる。
- **起動順**: 先にデータ端末で同期を設定する。NASを先に起動すると `SYNC_FOLDER_NOT_READY` で失敗し、共有設定後に再起動で復帰する（`restart: unless-stopped`）。
- **差分の未着**: OneDrive等の同期途中は `… を待っています` エラーで次回pollに再試行する。解消しない場合はデータ端末側の「差分を再公開」を使う（`docs/shared-folder-sync.md`）。

## トラブルシューティング

| 症状                                                               | 原因と対処                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SYNC_FOLDER_NOT_READY`                                            | 共有フォルダが未初期化。先にデータ端末で同期を設定する                                                                                                                                                                                                                                                                                                                                        |
| `CORE_ALREADY_RUNNING`                                             | 同じuserDataで別Coreが稼働中。既存コンテナ/プロセスを止める                                                                                                                                                                                                                                                                                                                                   |
| `DISCOVERY_OWNER_MISMATCH`                                         | MCP bridgeが別uid/別コンテナ。同じコンテナで`docker exec`する                                                                                                                                                                                                                                                                                                                                 |
| `NODE_MODULE_VERSION` 不一致                                       | `better-sqlite3`が別runtime向け。イメージを再buildする（`npm rebuild better-sqlite3`）                                                                                                                                                                                                                                                                                                        |
| 権限エラー（EACCES/EPERM）                                         | `/volume1/tasken/sync` の所有者・権限を確認                                                                                                                                                                                                                                                                                                                                                   |
| 共有フォルダだけEACCES（mode 0000表示）                            | Synologyの`synoacl`（NFSv4 ACL）。`group_add`のgid（DSM標準は101=administrators）を合わせる。`nas-install.sh`が自動検出する                                                                                                                                                                                                                                                                   |
| tunnelの`read control-plane api key ... permission denied`         | secretの所有者を`TASKEN_UID`に合わせる（`chown -R "$UID_:$GID_" secrets`）                                                                                                                                                                                                                                                                                                                    |
| ChatGPTにwrite toolsが出ない（read-onlyのまま）                    | tunnel側の`TASKEN_MCP_READ_ONLY=0`とCore側の`--write-mode=proposals`の両方を確認する。NAS側は「投稿・提案を受け付ける」節の`nas-read-check.mjs`で実測できる                                                                                                                                                                                                                                   |
| ChatGPTのtool一覧が古い／新しいwrite toolsが出ない                 | Settings → Connectorsでこのアプリを開き**Refresh**を押す。OpenAIの仕様ではサーバー更新は自動反映されず、増えたactionは**既定で無効**なので、一覧に出たwrite toolsを有効にする。既存チャットは更新前の一覧のままなので**新しいチャット**で試す。改善しなければconnectorを削除して再追加する。現行のNASが返すのはread-only 16 / `proposals`配備でwrite有効 21 toolsで、`29`は2026-09-26以前の数 |
| ChatGPTから投稿したがDesktopに出ない                               | `T:\sync\devices\<replicaのdevice id>\` に差分が増えているか、Desktopの端末間同期が有効かを確認する（下の「往復の確認」）                                                                                                                                                                                                                                                                     |
| tunnelが昇っているか疑わしい                                       | `sudo docker exec tasken-tunnel node -e "fetch('http://127.0.0.1:18080/readyz').then(r=>console.log('readyz',r.status)).catch(e=>console.log('ERR',e.message))"`。admin UIは同じnetnsの`http://127.0.0.1:18080/ui`                                                                                                                                                                            |
| 作業報告の採用が「Taskのcanonical Theme IDがありません」で失敗する | 対象TaskがcanonicalなTheme（`project_id`）を持っていない。古いTaskにこの状態が残る場合がある。TaskenでそのTaskを開いて保存し直すと`project_id`が付く（提案自体は受理済みなので、直せば採用できる）。この拒否はMCP経由に限らず既存の挙動                                                                                                                                                       |

### 往復の確認（PC側から見る）

書き込みが公開されたかは、replica自身のdeviceフォルダで確認できます。device idは`deploy/synology/state`の`workspace_meta.device_id`です。

```powershell
# T: = \\<nas-host>\tasken のとき
Get-ChildItem T:\sync\devices\<replicaのdevice id> -Force |
  Sort-Object Name | Select-Object -Last 3 | Select-Object LastWriteTime,Length,Name
```

- 差分は`ai_proposal`のEntity 1件ごとに1ファイル（`<seq>-<changeId>.json`）。`payload_type`が`feed_posts`・`notes`・`task_work`のいずれかになる。
- Desktop側はこの差分を通常の同期で取り込み、Feedの「対応待ち」へ出す。採用すると正式データ（Note・Task・Work Receipt）になる。
- 差分が増えていなければ、Coreが受理していない（エラーは応答の`error.code`を見る）か、replicaのpollが止まっている。`shared_sync_last_error`を確認する。

## 検証

### 2026-09-12 実機NAS（DS723+ / DSM 7.2 / amd64）

開発機のDocker Desktopで`linux/amd64`を作り、SMB共有フォルダ経由で搬入して配置した。詳細な観測値は[deploy/synology/DEPLOYED.md](../deploy/synology/DEPLOYED.md)。

- `nas-install.sh`で`WRITE_OK` → `TASKEN_HEADLESS_CORE_READY ... "capability_count":31,"sync_directory":"/sync"`、health `healthy`。
- replica SQLite: `workspace_id`がPC側と一致、`tasks=19`、pending差分0、ホスト端末のcursorが196まで進行。
- read-only MCP（one-offコンテナ + `nas-read-check.mjs`）: `TOOL_COUNT 29`、write tools非公開、`search_items`が実Task IDを返却。**PCのTasken終了後も同じ結果**（Desktop停止中でもNAS単体で読み取り可能）。
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
- `backup.sh`のComposeによる稼働コンテナの自動検出は未確認。2026-10-22の実機確認では`TASKEN_CONTAINER`を明示し、snapshot・排他lock・隔離SQLite検証・元Core再起動まで通した。
- MCP transport / Secure MCP Tunnelの再接続と、ChatGPT実クライアントからの投稿・作業報告の往復。常時稼働と`proposals`配備（`TASKEN_CORE_WRITE_MODE=proposals` + `TASKEN_MCP_READ_ONLY=0`）は2026-09-27に実機へ配置し、Core capability 31と`write_mode":"proposals"`まで確認済み（[DEPLOYED.md](../deploy/synology/DEPLOYED.md)）。
- bootstrap / compaction / revoke / schema upgradeのowner決定はPhase 2の残り。Note Markdown画像の扱いと、コンテナ上での画像MCP再実行は未検証。
- イメージbuild/runにはDocker daemonが必要。

## 参照

- [Headless Core](headless-core.md)
- [端末間同期](shared-folder-sync.md)
- [外部AI連携](external-ai-integration.md)
