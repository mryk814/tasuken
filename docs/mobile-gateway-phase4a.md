# Mobile Gateway contract and runtime evidence

Issue #398のPhase 4Aでは、Mobile固有contractと純粋adapter/client境界を固定した。
Phase 4Bでは、localhost listener、Electron lifecycle、Tailscale Serve、device pairing、Android Keystore、Settings diagnosticsを同じ縦断経路へ接続した。

## 非交渉条件

1. Desktop SQLiteが唯一の正本であり、GatewayとclientはDB、repository、migrationをimportしない。
2. MobileのTask readは目的別projectionだけを返し、raw Task DTO、Workspace dump、local path、source locator、secretを返さない。
3. Mobile userのCreateTaskは`TaskCapabilityService`から既存Application Commandへ委譲する。actorは認証済み`clientDeviceId`から生成し、sourceはadapterが一度だけ`mobile`へ写像する。
4. `commandId`を既存Application Commandのdurable idempotency keyにする。Phase 4Aでは外向き`idempotencyKey`との一致を必須にし、adapter内memory mapを作らない。同じIDと異なるpayloadはCoreのstructured conflictを返す。
5. Mobile deviceとagentを同じprincipal/scopeにしない。Phase 4Aは`mobile_device`だけを受け入れ、agent write endpointを公開しない。agent writeは既存Proposal review経路を維持する。
6. Desktop loopback Coreのdiscovery file、origin、256-bit bearer tokenをMobile contract、response、client設定へ流用しない。Mobile clientはpairingで将来発行する別tokenとprivate HTTPS URLだけを受け取る。
7. API/schema version、Core capability、scope、unknown field、response byte/item上限を境界でfail closedにする。

## Phase 4A endpoints

| Method / path | Scope | Core委譲 | 公開内容 |
|---|---|---|---|
| `GET /v1/health` | 認証済み`mobile_device` | Core version/capability handshake | Mobile API metadataと端末scopeに応じた利用可能capability |
| `GET /v1/today?date=...&limit=...&requestId=...&apiVersion=1&schemaVersion=1` | `mobile:read` | `ListTodayTasks` query | Task ID、title、Theme ID、state、work state、updatedAtだけ |
| `POST /v1/commands` | `mobile:task-write` | `CreateTask` command | command statusと同じMobile Task summaryだけ |

Gateway adapterは認証を行わず、pairing/auth層が検証した`MobilePrincipal`だけを受け取る。
`GET` endpointはbodyを受け取らず、Todayの`date`、`limit`、`requestId`、contract versionはqueryだけからCore queryへ写像する。
pure clientはHTTPS、Mobile専用bearer、timeout、256 KiB response上限、version/capability handshakeを担当し、上限超過時はresponse streamを直ちにcancelする。

## Issue #398 ACチェックリスト

- [x] Gatewayはlocalhostにだけlistenする。
  `127.0.0.1:48177`へbindし、Windows実行中のdiagnosticsでもloopback originを確認した。
- [x] Tailscale Serve経由のprivate HTTPSでAndroidから到達できる。
  ServeのHTTPS portからlocalhost Gatewayへreverse proxyし、S23の`GET /v1/today`が200を返した。
- [x] Funnelを使用しない。
  `tailscale funnel status`はtailnet onlyを示し、public internet公開を示す表示がないことを確認した。
- [x] Read ModelとCommand APIがversioned contractを持つ — Mobile専用strict schemaとfixtureで固定する。
- [x] Task writeがApplicationCommandServiceを通る — Gatewayは注入されたTask capabilityだけを呼び、parity/replay testで固定する。
- [x] Android / agentを別scopeとして認証できる。
  Mobile tokenは`mobile:read`と`mobile:task-write`に固定し、agent principalはMobile endpointで拒否する。
- [x] QRまたはone-time codeでdevice pairingできる。
  Desktopが8桁、5分、1回限りのcodeを発行し、S23からpairしてper-device tokenをAndroid Keystoreへ保存した。
- [x] Desktopからdeviceをrevokeできる。
  Settingsのdevice一覧から失効でき、revoked tokenを即時拒否するruntime testを通した。
- [x] local path / secretsを返さない — allowlist projectionとleak testで固定する。
- [x] Desktop UIとMobile APIのcommand parity testがある — 同じTask capability fixtureのEntity/Event結果を比較する。
- [ ] tray / restart / sleep後の状態が分かる。
  SettingsはGateway状態、local port、paired device、latest requestを表示する。
  Electron再起動後にGateway ready、登録端末1台、S23のToday 200を確認した。
  PC sleepとwakeは未検証である。

## 実機検証

- Windows Android Studio JBRで`:app:testDebugUnitTest :app:assembleDebug`を実行し、44 taskが成功した。
- S23へ`adb install -r`で上書きし、cold launchは738 ms、fresh crash markerは0だった。
- S23の現在画面はpairing、Gateway error、loadingのいずれでもなかった。
- Desktop Gatewayは再起動後もreadyとなり、有効端末1台を復元して`/v1/today`へ200を返した。
- Windows-native production buildとLinux production buildを通した。
- 全自動testは1,267件成功、0件失敗、1件skipだった。
- Architecture auditは既存の期限付き3件だけがnew candidateで、blockingは0だった。

## 未検証の境界

- PC sleepとwake後のGateway復帰
- Wi-Fiとcellularの切替
- Tailscale grantsのdenyとallow
- Fold実機

PC sleepとwakeを確認するまで、Issue #398はcloseしない。
