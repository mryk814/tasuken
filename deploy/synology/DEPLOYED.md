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

### 2026-09-20 PC側からの再確認（#588 / N1の一部）

9月12日の記録を成功として流用しないため、PCから観測できる範囲を測り直した。**コンテナ側は未確認**（下記）。

- Tailscale: `synologyds723`（`100.109.102.122`）は `active`（direct `192.168.11.18:41641`）。共有 `\\synologyDS723\tasken` は `T:` に割当済みで到達できる。
- 共有の中身: `sync/`（`Activity` / `Inbox` / `devices` / `tasken-sync.json`）、`_deploy/`、`#recycle/`。
- replicaが読む差分の鮮度: ホスト端末 `14efbb12-...` の差分は `000000003184-...json`（2026-09-20 20:05）まで届いている。もう一方の端末 `9aab88aa-...` は 2026-09-12 10:13 で止まっている。
- 未確認（NAS側でしか分からない）: 配置済みimageとsourceの版、`tasken-headless` の稼働とhealth、replica SQLiteの `workspace_id` とcursor、read-onlyの強制、`backup.sh`の実行結果、`tasken-tunnel` の現在の状態。
- 確認方法: SSHは鍵認証が未設定のため、NAS上で次を実行して出力を記録する（読み取りのみ）。
  ```sh
  docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
  docker logs --tail 5 tasken-headless 2>&1 | tail -5
  sudo docker exec tasken-headless ls -l /data 2>/dev/null | head -5
  grep -E 'workspace_id|pending|cursor' /volume1/docker/tasken/deploy/synology/state/* 2>/dev/null | head -5
  sudo ls -l /volume1/docker/tasken/deploy/synology/state | head -10
  ```

### 2026-09-21 PC側からもう一度測ったこと（共有の中身）

SSHの鍵が無いためコンテナ側は依然として未確認。共有から読める範囲だけを追加で記録する。

| 見た場所                     | 観測                                                                                                                                | 何が分かる／分からない                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `T:\_deploy\`                | `tasken-headless-linux-amd64.tar`（170,156,032 bytes, 2026-09-12 10:52）、`tasken-source.tar`（17,233,920 bytes, 2026-09-12 10:59） | NASへ搬入したimageとsourceは**9月12日のまま**。以降の更新は搬入されていない |
| `T:\sync\devices\14efbb12-…` | 2026-09-20 20:05 更新                                                                                                               | ホスト端末の差分公開は09-20まで動いていた（**09-21以降の更新は未確認**）    |
| `T:\sync\Inbox\Notes`        | 2026-09-20 17:16 更新                                                                                                               | 共有への書き込みは届いている                                                |
| `T:\sync\devices\9aab88aa-…` | 2026-09-12 10:13 のまま                                                                                                             | もう一方の端末は停止したまま（DEPLOYED.mdの記載どおり）                     |

**コンテナが今も動いているかは、この共有からは分からない**（replicaのSQLiteは `tasken-data` volume の中）。
`docker ps` の3行だけでも記録できれば、N1の残りは埋まる。

### 2026-09-26 replicaの同期停止を特定して再配置（#588 N1 / N2）

9月12日の配置以降、**replicaが1件も差分を取り込んでいなかった**ことを実測して直した。

- 観測（rootで実行）: `tasken-headless` は `Up 2 weeks (healthy)` / `restarts=0`、`tasken-tunnel` も healthy。
  `docker logs` は起動時の `TASKEN_HEADLESS_CORE_READY` 1行のみ。
- 一方、replicaの `/data`（`deploy/synology/state`）は `research-desk.sqlite` / `-wal` / `tasken-core.json` が
  **すべて2026-09-12のまま**。`tasken-core.json` の `started_at` も `2026-09-12T01:53:13Z`。
- replica DBを読んだ結果（NAS上のコピーを読むだけで、外へは出していない）:

  | 項目                     | 値                                                                       |
  | ------------------------ | ------------------------------------------------------------------------ |
  | `shared_sync_last_at`    | 2026-09-12T01:09:54Z                                                     |
  | `shared_sync_last_error` | `Work Receiptはappend-onlyです。既存Receiptを取り込みで更新できません。` |
  | `sync_device_cursors`    | `14efbb12-…: 196`（2026-09-12T01:10:04Z から不動）                       |
  | `sync_conflicts`         | 0                                                                        |

- 原因: 受信差分 `devices/14efbb12-…/` は **1〜3280が連番で欠落なし**。同じWork Receipt
  `f352cb33-…` が2回公開されており（seq191 = version 1、seq **197** = version 2 の後継Revision）、
  `workspaceRepository.insertImported` のappend-onlyガードが**同一IDのReceiptを内容に関係なく例外**にしていた。
  `receiveChanges` の例外は `SharedFolderSyncService.start()` の `void this.syncNow().catch(() => {})` に飲まれ、
  ログにもhealthにも出ないため、**健康なまま2週間止まっているように見えていた**。
- 修正（branch `fix/588-sync-receipt-revision`）:
  - 同期取り込みでは、親Revisionが現在のheadと一致する後継Revisionを適用する。内容が実質同じ再公開は書き換えずheadだけ進める。
  - 競合解決で`incoming`を選んだReceiptも同じ扱いにする。
  - 定期同期の失敗を**内容が変わったときだけ1回**ログへ出す（`[tasken-sync] ...`）。
- 再配置: imageを再作成（`--provenance=false --sbom=false`）→ SMB共有 `_deploy` 経由で搬入 →
  `sudo bash /volume1/tasken/_deploy/nas-install.sh`。旧配備物は `.prev-2026-09-12.tar` として残置。
  - `core.autocrlf=true` のため `git archive` がCRLFを書き出し、`bash nas-install.sh` が `set: pipefail` で失敗。
    `git -c core.autocrlf=false -c core.eol=lf archive` で作り直して解消。`scp` は `Connection closed` で拒否される。
- 再配置後の実測:
  - Core: `started_at 2026-09-26T09:02:50Z` / `origin http://127.0.0.1:39555` / `pid 7` / capability 30（`task.command` なし = read-only）
  - `shared_sync_last_error` 空 / cursor `14efbb12-…: 3283` / `sync_conflicts` 0 / `shared_sync_last_at 2026-09-26T09:03:40Z`
  - Entity: task 148（09-12は19）、work_receipt 66、ai_proposal 130、note 23、change_event 886。
    taskの最新 `updated_at` は `2026-09-26T08:53Z`、work_receiptは `2026-09-26T08:31:09Z`（同日のQA journeyの報告まで）
  - read-only MCP（`nas-read-check.mjs` one-off）: `TOOL_COUNT 13` / `HAS_WRITE false` / `IS_ERROR false` /
    `ITEMS` に当日のQAタスク `f1f029dd-…` を含む（＝NAS単体で最新のContextを返せる）
    - 09-12の記録にある `TOOL_COUNT 29` は旧版の値。現行版のread-only公開ツールは13（書き込み8はゲートの後ろ）
  - `tasken-tunnel`: `Up (healthy)`、`tunnel_id tunnel_6aa4aa138f10819198458b82e82c079e` 据え置き、metadata取得成功
    - ChatGPT側の一覧にtunnelが出るかは未確認（OpenAI側の既知問題。09-12の保留理由が解消したかは画面での再確認が要る）
- 未確認: Desktop停止中の読み取り（N3）、`backup.sh` の実機実行、Desktop停止・NAS再起動・transport再接続の一連

### 2026-09-27 書き込みをproposalsで有効化（#588 N4 / N5）

read-onlyだった実機NASを、Proposal（Coreの受付範囲はテキストのFeed投稿・Note案・Task案・**Task作業報告**）だけを受け付ける配備へ切り替えた。正式データの採用とTask完了はDesktopの人の操作のまま。

- 配備物: 開発機（Docker Desktop）で`linux/amd64`の`tasken-headless:local`を作り直した。
  - image ID `sha256:72be677563b030f28fbc63435cb0b8cb38f538c3f5a3a906ad49800b2ae3b38d`、`docker save`したtarのsha256 `14fbfdfca630835719828b81c47f59abae49c0fcc17e212ae60a2330d401f2fa`。
  - sourceは`b779c067`から`git -c core.autocrlf=false -c core.eol=lf archive`で作成（sha256 `b17c01414721fd1e6fe93efae5c3ba960dae670b0b7e5c0ece8599d65871ebe4`）。`nas-install.sh`は同commitのもの（sha256 `1679c3dd91c90e00ca14f42b848829d80375be7eb4fe7736107672215c6afeb5`）。
  - SMB共有`_deploy`経由で搬入し、PC側とNAS側の`sha256sum`が3ファイルとも一致することを確認。旧配備物は`.prev-2026-09-26.tar`として残置。
  - 搬入後も追加commit（`f8bb53e1`、テストのみ）はNASへ送っていない。imageとsourceは`b779c067`で一致しており、テストは実行時に使わない。
- 実行: `sudo TASKEN_CORE_WRITE_MODE=proposals TASKEN_MCP_READ_ONLY=0 bash /volume1/tasken/_deploy/nas-install.sh`
- 実測（実行ログ）:
  - `WRITE_OK` → Core `TASKEN_HEADLESS_CORE_READY {"...","capability_count":31,"sync_directory":"/sync","write_mode":"proposals","pid":7}`。
  - `tasken-headless` Started 0.9s、`tasken-tunnel` Started 0.2s。tunnelは`tunnel metadata fetched`（name `Tasken MCP - Synology`、tunnel_id `tunnel_6aa4aa138f10819198458b82e82c079e`据え置き）の後に`Tasken MCP Bridge is running on stdio.`
  - 事前確認として、同じimageを一時volumeで起動し`--write-mode=proposals`がcapability 31（`propose_task_work`あり・`task.command`なし）、既定がcapability 28のread-onlyになることをPC側で確認している。
  - 同じimageでMCP bridgeのtool一覧も実測した。`TASKEN_MCP_READ_ONLY=0`で21 tools（read 13 + write 8）、既定で13 tools。write 8件のうちCoreが受け付けるのは`propose_feed_post`・`propose_note`・`append_work_receipt`・`report_task_done`・`report_task_blocked`の5件で、`propose_note_edit`と`answer_feed_question`は`WRITE_NOT_ALLOWED`、`start_task_work`は`CAPABILITY_UNAVAILABLE`。Task**案**を作るtoolはMCP bridgeに登録されていない。
  - 同じimage（ID `sha256:72be6775…`）を一時volumeで`--write-mode=proposals`で起動し、実際にwrite toolを呼んで確かめた（2026-09-27、NASではない隔離環境）。`propose_note`・`propose_feed_post`・`report_task_done`はProposal IDを返して`pending`で保存され、`propose_note_edit`・`answer_feed_question`は`WRITE_NOT_ALLOWED`、`start_task_work`は`CAPABILITY_UNAVAILABLE`（案内文は「この接続先は直接開始を公開していません」）。保存されたProposalは許可された3件だけで、拒否された3件は1件も作られていない（fail closed）。
- 実測（PC側からの読み取り）:
  - `deploy/synology/.env`: `TASKEN_CORE_WRITE_MODE=proposals`・`TASKEN_MCP_READ_ONLY=0`・`CONTROL_PLANE_TUNNEL_ID`を保持。`nas-install.sh`の再生成後も消えていない（2026-09-26までの版は書き込み設定を書かず、再配置で既定へ戻っていた）。
  - `state/tasken-core.json`: capability 31。`propose_content`・`propose_repository_task`・`propose_task_work`あり、`task.command`・`propose_agent_session`なし（＝proposals配備）。
  - replica DB（`/data`をコピーしてread-onlyで読む。外へは出していない）: `workspace_id 047c7258-…`（ホストと一致）、`shared_sync_last_error`空、`shared_sync_last_at 2026-09-26T20:36:03Z`、cursor `14efbb12-…: 3297`、`sync_conflicts` 0、`sync_outbox` 0。entity（`deleted_at IS NULL`）は task 99 / ai_proposal 131 / work_receipt 54 / note 10 / change_event 889、pending proposal 44（うち`task_work` 80件は累計）。
  - 同じworkspaceの`sync/devices/9aab88aa-…`は**空**。このdevice idはNAS replica自身のもので、read-only運用では公開する差分が無かったため。2026-09-20の記録にある「もう一方の端末」という解釈はこれに訂正する（過去の記録はそのまま残す）。
- 実測（NAS上、one-offコンテナ + `nas-read-check.mjs`、2026-09-27）:
  - `-e TASKEN_MCP_READ_ONLY=0`で`TOOL_COUNT 21`・`MCP_READ_ONLY false`・`HAS_WRITE true`、`WRITE_TOOLS`は8件すべて、`READ_TOOLS`は13件。`search_items`は`IS_ERROR false`で実Task IDを5件返した（`8fa3f995-…`ほか）。
  - 稼働中Coreと同じnetwork名前空間・同じ`tasken-headless:local`で実行しているため、tunnelのMCP bridgeが見せている範囲と一致する。`tasken-tunnel`の環境変数を`docker inspect`で読む確認は未実施だが、この tool一覧が実挙動として同じ境界を示している。
- 未確認（この時点）:
  - ChatGPT側のconnectorが新しいtool一覧を取得すること、実クライアントからのFeed投稿・Task作業報告の往復、Desktopでの採用。
    - 2026-09-27の利用者報告: Connectorを解除→再接続しても、ChatGPTが見ているtool一覧は**29 tools・read-only**のまま。29は2026-09-12時点のread-only面の数（本ファイルの09-12記録）で、現行は13（read-only）/21（write有効）。NAS側に29を返す経路が無いため、ChatGPT側のスキーマキャッシュか、別nodeへの接続を疑う。切り分けは新しいチャット→それでも同じならconnectorの削除と再追加、の順で行う。
  - 1つの`idempotency_key`をDesktopとNASの両方へ送らない運用は未変更。

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
