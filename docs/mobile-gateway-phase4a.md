# Mobile Gateway Phase 4A contract

Issue #398の最初の縦断sliceとして、Android実装や外向きserverより先にMobile固有contractと純粋adapter/client境界を固定する。
このPhaseではlisten、Tailscale Serve、pairing、token保存、SQLite接続、Electron lifecycleを実装しない。

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
| `GET /v1/health` | `mobile:read` | Core version/capability handshake | Mobile API metadataと利用可能capability |
| `GET /v1/today?date=...&limit=...&requestId=...&apiVersion=1&schemaVersion=1` | `mobile:read` | `ListTodayTasks` query | Task ID、title、Theme ID、state、work state、updatedAtだけ |
| `POST /v1/commands` | `mobile:task-write` | `CreateTask` command | command statusと同じMobile Task summaryだけ |

Gateway adapterは認証を行わず、pairing/auth層が検証した`MobilePrincipal`だけを受け取る。
`GET` endpointはbodyを受け取らず、Todayの`date`、`limit`、`requestId`、contract versionはqueryだけからCore queryへ写像する。
pure clientはHTTPS、Mobile専用bearer、timeout、256 KiB response上限、version/capability handshakeを担当し、上限超過時はresponse streamを直ちにcancelする。

## Issue #398 ACチェックリスト

- [ ] Gatewayはlocalhostにだけlistenする — Phase 4Aはserverを持たず、Phase 4Bのlifecycleで検証する。
- [ ] Tailscale Serve経由のprivate HTTPSでAndroidから到達できる — Android実機/Tailscale sliceで検証する。
- [ ] Funnelを使用しない — Serve設定を追加するPhaseで構成と実機を検証する。
- [x] Read ModelとCommand APIがversioned contractを持つ — Mobile専用strict schemaとfixtureで固定する。
- [x] Task writeがApplicationCommandServiceを通る — Gatewayは注入されたTask capabilityだけを呼び、parity/replay testで固定する。
- [ ] Android / agentを別scopeとして認証できる — contractは分離済み。pairing/token検証とagent principalは未実装。
- [ ] QRまたはone-time codeでdevice pairingできる — Phase 4B以降。
- [ ] Desktopからdeviceをrevokeできる — Phase 4B以降。
- [x] local path / secretsを返さない — allowlist projectionとleak testで固定する。
- [x] Desktop UIとMobile APIのcommand parity testがある — 同じTask capability fixtureのEntity/Event結果を比較する。
- [ ] tray / restart / sleep後の状態が分かる — runtime wiringと実Windows smokeで検証する。

## Phase 4Aで意図的に未実装

- HTTP serverのbind、CORS、rate limit、request body stream上限
- Tailscale Serve / MagicDNS / grants / Funnel禁止設定
- one-time pairing、per-device token、Keystore、revoke
- Settings / Diagnostics UI
- Android Kotlin model生成、Room cache、outbox、sync cursor
- sleep / restart / network切替 / Fold実機検証

これらを未実装のままIssue #398はcloseしない。
