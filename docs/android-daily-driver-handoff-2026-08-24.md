# Android daily-driver MVP 引き継ぎ

更新: 2026-08-24 19:50 JST  
対象: #400 / #401 / #402 / #477  
基準main: `46e7ae999548b21fb93eed6517cd3ad86e4500fd`

## 目標

現在の主目標は、Android版Taskenを外出中の日常操作に使える状態へ仕上げることである。

具体的には、スマートフォンだけでTaskの確認・作成・編集・完了、Task/Captureの即時入力、offline中の操作、Desktop復帰後の重複なし収束を行えることを目指す。

Fold対応とAI連携は別製品として増やすのではなく、同じTask・Capture・Application Commandを使うAndroid surfaceとして完成させる。

現時点は「基礎機能を作る段階」をほぼ終え、「常用構成の連続journeyで信用できることを証明する段階」にある。

## 現在の結論

- AndroidのTask管理、offline cache/outbox、Quick Add、Share Target、短い音声入力、Widget、canonical Capture、signed APK、compact/expanded UIはmainへ統合済みである。
- #399は実装Issueとして閉じている。
- #400と#401はIssueのチェック欄更新が実装実態に追いついていないためopenだが、残りの中心は新規基礎機能ではなく#477の実機acceptanceである。
- #402はread-only AI Inbox、Work Receipt閲覧、Proposal accept/rejectまで実装済みで、human work reviewとdelegate/Context Previewは未実装である。
- 最優先の未完journeyは、Fold7で保持中のoffline pending commandをcanonical Desktopへ戻し、pending 1→0とexactly-once収束を証明することである。
- このjourneyは、別セッションのDesktop processが常用portとdirty worktreeを使用中のため、現時点では安全に再開できない。

## mainへ統合済みの主要変更

| 到達点                         | PR   | main上の結果                                                                |
| ------------------------------ | ---- | --------------------------------------------------------------------------- |
| Android daily-driver候補の統合 | #475 | Task、Schedule、checklist、voice、Theme、Undo、Widget、AI Inboxの候補を統合 |
| canonical Capture              | #483 | Quick Add / Share TargetをCreateCaptureへ接続し、Task cacheへ偽装しない     |
| permanent signing              | #485 | user-owned keyとsigning lineageによるdata-preserving update install         |
| Fold Quick Add初回修正         | #486 | expanded時に主要操作を見失わないsheet layout                                |
| DeleteTask retry               | #487 | versioned receiptとdeleted eventを保存し、Undo retryをidempotent化          |
| offline auth/cache             | #488 | transient 401でtoken/cacheを破棄せず、再接続中もRoom cacheを表示            |
| Quick Add下端inset             | #490 | safe drawing / IME下端をscroll末尾で扱い、gesture barより上に保存操作を保つ |

最新mergeはPR #490、merge commitは`46e7ae9`である。

Windows qualityとAndroid qualityはPR #490で成功している。

## 目標に対する現在地

| 領域                                                              | 実装                            | 実機・E2E証拠                                                          | 判定                                          |
| ----------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------- |
| Today / Task一覧 / 検索 / filter / detail                         | mainへ統合済み                  | S23、Fold7、emulatorで描画済み                                         | 実装済み、continuityの一部が未証明            |
| Create / title / Theme / Schedule / checklist / complete / reopen | mainへ統合済み                  | 個別操作は実機・自動testあり                                           | daily-driver連続journeyは未完                 |
| Room cache / outbox / cursor sync                                 | #399として実装済み              | Fold7 reboot後にcacheとpending 1を保持                                 | canonical復帰後のpending 1→0が未証明          |
| Quick Add / App Shortcut / Widget / Share Target / voice          | mainへ統合済み                  | 実発話Task、Share Target Capture、Undoをcanonical DBで照合済み         | URL share、連続入力、process-death境界が残る  |
| Task / Capture provenance                                         | mainへ統合済み                  | android_speech / share_targetのallowlist metadataを確認                | raw本文・音声をmetadataへ複製していない       |
| signed release / update install                                   | #485で実装済み                  | Fold7 / S23でRoom・Keystore dataを保持した`adb install -r`を確認       | pass                                          |
| Fold compact / expanded                                           | #486 / #490で実装済み           | Fold7 compact→expandedでQuick Addを維持し、IME中も保存操作へscroll可能 | Task選択等のcontinuityと物理hinge感触は未証明 |
| AI Inbox / Work Receipt / Proposal                                | read/review surfaceまで実装済み | live Work Receipt / Proposalの最終E2Eは未完                            | 部分達成                                      |
| Hermes delegate / Context Preview / notification                  | 未実装                          | 証拠なし                                                               | #479                                          |
| Work Receipt Accept / Return / blocked返信                        | 未実装                          | 証拠なし                                                               | #478                                          |

## 実機・build証拠

### Galaxy Z Fold7

- 端末: `SM-F966Q`
- Android 16 / API 36 / security patch 2026-06-05
- app versionCode 3
- firstInstallTime: `2026-08-23 04:55:43`
- ceDataInode: `178442`
- PR #490のsigned APKを`adb install -r`し、firstInstallTimeとceDataInodeが変わらないことを確認した。
- compact 1080×2520とexpanded 1968×2184の両方でQuick Addを描画した。
- compactで開いたQuick Addをunfold後も維持した。
- expandedではTask/Capture、Theme、音声、追加して次へ、追加するがgesture barより上に表示された。
- IME表示中も一回のscrollで保存操作へ到達できた。
- Gateway認証喪失中でも、再起動後に`Issue477_OfflineReboot_Fold7_20260824`と送信待ち1件をRoomから再表示した。

### Galaxy S23

- 端末: `SC-51D`
- Android 16 / API 36 / security patch 2026-04-05
- app versionCode 3
- firstInstallTime: `2026-08-22 01:02:15`
- ceDataInode: `1548223`
- #488時点のsigned APKをdata-preserving update install済みである。
- Share Target text→canonical Capture→versioned DeleteCaptureの一往復をDBで照合済みである。

### Pixel Fold emulator

- 専用API35 Pixel Fold AVD、2208×1840でPR #490の実描画を確認した。
- 保存操作がgesture barより上にあることを確認後、専用AVDは削除した。
- 共有`emulator-5554`ではinstrumentationの署名不一致後、UTP cleanupによってcanonical packageが削除された。
- `emulator-5554`へsigned APKは再インストールしたが、以前のemulator dataが保持されたとは主張しない。
- `emulator-5554`は別セッションも使用しているため、次の担当者はinstrumentation対象にしない。

### 現在のsigned APK

- build対象: PR #490 head `aea9000`と同じapp treeを持つmain `46e7ae9`
- SHA-256: `7006f19b4c1c0180447136f5ad4efcad8c87913b76ea300f21dc6d6459abb9a9`
- APK Signature Scheme v2 / v3 / v3.1を`apksigner`で確認した。
- API 33+ signer SHA-256: `19d4f3f0239fae121d97bbcf362207aed6e1c41ebd98077043cf2f40e5a0b1c4`
- key、password、lineageはrepositoryへ保存していない。

## #477で次に閉じるべきjourney

### 1. offline pending 1→0のcanonical収束

Fold7には`Issue477_OfflineReboot_Fold7_20260824`が送信待ち1件として残っている。

次の順序で確認する。

1. 別セッションが使用中のDesktop processとdirty worktreeの所有者が作業を完了するまで待つ。
2. Windows canonical runtimeをmain `46e7ae9`で起動する。
3. Gatewayが`127.0.0.1:48177`だけへlistenし、既存Tailscale Serveがprivate HTTPSを転送することを確認する。
4. Fold7を既知のcanonical Gatewayへ安全にre-pairする。
5. Androidの送信待ちが1→0になることを確認する。
6. canonical DBでTask、Activity event、command receiptが各1回だけ生成されたことを確認する。
7. 同じcommandのretryで二重生成されないことを確認する。
8. QA Taskをversioned DeleteTaskでcleanupし、Delete receiptも再送安全であることを確認する。
9. 期待値と実結果を#477へcommentする。

### 2. 入力journeyの残り

- Share Targetから実URL文字列をCaptureへ保存する。
- TaskとCaptureの双方で「追加して次へ」を通す。
- TaskとCaptureの双方で未送信Undoと適用済みUndoを通す。
- process kill / OS reboot後もdraft、pending、Undo対象を失わないことを確認する。

### 3. Fold / One UI continuity

- selected Task
- Tasks filter / search
- list scroll位置
- rotation
- background / restore
- dialog / sheetの安全な復元またはdismiss
- One UI launcher上のWidget Small / Medium / Large / Wide
- hinge上に主要controlが重ならないことの物理確認

Quick Addのcompact→expanded continuityはpassしたが、上記を代替する証拠ではない。

Galaxy Z Fold7の物理hingeの触感や長時間利用時の快適さも、スクリーンショットでは証明できないため未検証境界として残す。

### 4. Gateway運用とconflict

- device revoke→API拒否→cache表示→re-pair
- Tasken tray restart
- Windows restart
- PC sleep / wake
- Tailscale reconnect
- live title / Theme / Schedule conflict
- silent overwriteをせずserver/local選択で解決

### 5. AI review

- live Work Receiptを開き、offline cacheで再表示する。
- live Task Work Proposalをaccept / rejectする。
- stale Proposal / stale Task / offline時に危険な操作を無効化する。
- agent tokenではapproveできず、mobile review scopeだけが許可されることを確認する。

このacceptanceを終える前に#478 / #479へ主戦場を移さない。

## 現在のblocking state

常用port `127.0.0.1:48177`はPID 38600のElectronが使用している。

processの実体は次である。

```text
C:\Users\ootan\.codex\worktrees\214e\tasuken\node_modules\electron\dist\electron.exe .
```

このworktreeは`codex/481-482`で、mainに対してahead 2 / behind 8、25 pathsが未コミットまたは未追跡である。

PRは作成されていない。

これは別セッションの作業であり、PID停止、stash、reset、rebase、checkout、cleanupを行ってはならない。

このprocessがportを解放する前にcanonical Desktopを起動したり、Tailscale Serveの転送先を変更したりすると、別セッションと#477の証拠を同時に壊す可能性がある。

## Git / worktreeの現在値

- Windows canonical source: `C:\Users\ootan\AppData\Local\TaskenDevRuntime\source`
- Windows branch: clean `main`
- Windows main: `tasken-github/main`と一致
- WSL source: `/home/ootan/src/tasuken`
- WSL branch: clean `main`
- WSL main: `origin/main`と一致
- #489用worktreeとbranchはmerge後に削除済み
- disposable Issue #489 AVDは削除済み
- 別セッションの`214e` worktreeは保護対象

## 再開時のread-only確認

最初に次だけを確認し、dirty stateを巻き戻さない。

```powershell
rtk git status --short --branch
rtk gh issue view 477 --comments
rtk adb devices -l
rtk powershell.exe -NoProfile -Command "Get-NetTCPConnection -LocalPort 48177 -State Listen -ErrorAction SilentlyContinue"
```

WSL mainは次で確認する。

```powershell
rtk wsl.exe --cd /home/ootan/src/tasuken -e bash -lc '/home/ootan/.local/bin/rtk git status --short --branch'
```

`214e`のPID、port、dirty pathsが残っている間は、read-only監査だけに留める。

## 次のマイルストーン

次の大きな完了点は「Android Tasken MVP完成」である。

その判定には、機能がmainにあることだけでなく、#477のoffline recovery、入力、Fold continuity、Gateway運用を常用構成で再現可能に通す必要がある。

#477を閉じた後に#400 / #401のacceptanceを実証結果へ合わせて更新し、close可否を判断する。

その後に#478、#479の順でAI human reviewとHermes delegateへ進む。

remote relay / managed syncの採否やDesktop大規模architecture整理は、Android daily-driverのdogfood結果を得るまで主戦場に戻さない。
