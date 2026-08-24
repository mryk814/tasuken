# Android daily-driver MVP 引き継ぎ

更新: 2026-08-24 23:13 JST  
対象: #400 / #401 / #402 / #477  
実装基準main: PR #493 merge `b2d02a41f667fe14beaae2adadfbb55b70246fc0`

## 目標

現在の主目標は、Android版Taskenを外出中の日常操作に使える状態へ仕上げることである。

具体的には、スマートフォンだけでTaskの確認・作成・編集・完了、Task/Captureの即時入力、offline中の操作、Desktop復帰後の重複なし収束を行えることを目指す。

Fold対応とAI連携は別製品として増やすのではなく、同じTask・Capture・Application Commandを使うAndroid surfaceとして完成させる。

現時点は「基礎機能を作る段階」をほぼ終え、「常用構成の連続journeyで信用できることを証明する段階」にある。

## 現在の結論

- AndroidのTask管理、offline cache/outbox、Quick Add、Share Target、短い音声入力、Widget、canonical Capture、signed APK、compact/expanded UIはmainへ統合済みである。process death / OS reboot後のDraft・Undo復元はPR #493で実装・実機検証済みである。
- #399は実装Issueとして閉じている。
- #401の最終入力acceptanceは完了し、PR #493のmain統合後に受け入れ基準を全件checkしてcloseした。
- #400はFold / One UI continuityの残りがあるためopenを維持する。
- #402はread-only AI Inbox、Work Receipt閲覧、Proposal accept/rejectまで実装済みで、human work reviewとdelegate/Context Previewは未実装である。
- offline pending 1→0とexactly-once収束、および入力のprocess death / OS reboot journeyは完了した。
- 次の優先journeyは、Fold / One UI continuity、Gateway reset・sleep/wake、AI Inbox live E2Eである。

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

Android機能の最新main mergeはPR #493、merge commitは`b2d02a41`である。

PR #493はWindows quality、Android quality、永久署名workflowが成功している。

## 目標に対する現在地

| 領域                                                              | 実装                            | 実機・E2E証拠                                                          | 判定                                          |
| ----------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------- |
| Today / Task一覧 / 検索 / filter / detail                         | mainへ統合済み                  | S23、Fold7、emulatorで描画済み                                         | 実装済み、continuityの一部が未証明            |
| Create / title / Theme / Schedule / checklist / complete / reopen | mainへ統合済み                  | 個別操作は実機・自動testあり                                           | daily-driver連続journeyは未完                 |
| Room cache / outbox / cursor sync                                 | #399として実装済み              | Fold7 reboot後にcacheとpending 1を保持                                 | canonical復帰後のpending 1→0が未証明          |
| Quick Add / App Shortcut / Widget / Share Target / voice          | main（#493）                    | 実URL、Task/Capture継続入力、未送信/適用済みUndo、process death/reboot | #401をclose                                   |
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

### PR #493のsigned APK

- build対象: PR #493 head `5aec275362afd0b8506cd5c7c57c4613b715cc8d`
- workflow: [Android release signing run 32732631112](https://github.com/mryk814/tasuken/actions/runs/32732631112)
- SHA-256: `afc8fbb68852c93b9b9339400155144f7a992c61bec73f575063656daf4c1929`
- APK Signature Scheme v2 / v3 / v3.1を`apksigner`で確認した。
- API 33+ signer SHA-256: `19d4f3f0239fae121d97bbcf362207aed6e1c41ebd98077043cf2f40e5a0b1c4`
- key、password、lineageはrepositoryへ保存していない。

## #477で完了した入力journey

PR #493の永久署名APKをGalaxy Z Fold7へ`adb install -r`した。versionCode 3、firstInstallTime `2026-08-23 04:55:43`、ceDataInode `178442`を保持した。

- main v3では、未確定Draftが`am force-stop`後に消えることを実機再現した。
- Taskで「追加して次へ」後に別Draftを入力し、force-stop後もDraft・sheet・pendingを復元した。
- 未送信TaskのUndo対象をforce-stop後に再提示し、pending `2→1`、canonical row 0件へ収束した。
- Share Targetから実URL `https://example.com/tasken-issue-477-url-20260824`をCaptureとして「追加して次へ」で保存した。
- 次の未確定Capture Draftを残してOS rebootし、Draft・Capture種別・sheet・pending 2・Capture Undo対象を復元した。
- reboot後はTailscaleアプリを開くと`tun0`が復旧し、canonical Gateway再開後にpending `2→0`へ収束した。
- canonical DBではCreateTask / CreateCaptureのentity・event・receiptが各1件だけ生成された。
- reboot後に復元したCapture Undoからversioned DeleteCaptureへ収束し、Captureはv2 tombstone、Delete event / receiptは各1件となった。
- QA Taskはversioned DeleteTaskでv2 tombstoneへcleanupし、同一envelope replayが同じreceiptを返すことを確認した。
- Captureの未送信Undoもforce-stop後の再提示からpending `1→0`、canonical row 0件へ収束した。
- 最終Fold7画面は「今日のTaskはありません」、pending 0である。

入力Draftはapp-private storageへversion付きで保存し、放置7日で失効する。Undo対象は24時間保持し、復元後と継続入力後はユーザーが実行またはdismissするまで提示する。

### 1. Fold / One UI continuity

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

### 2. Gateway運用とconflict

- device revoke→API拒否→cache表示→re-pair
- Tasken tray restart
- Windows restart
- PC sleep / wake
- Tailscale reconnect
- live title / Theme / Schedule conflict
- silent overwriteをせずserver/local選択で解決

### 3. AI review

- live Work Receiptを開き、offline cacheで再表示する。
- live Task Work Proposalをaccept / rejectする。
- stale Proposal / stale Task / offline時に危険な操作を無効化する。
- agent tokenではapproveできず、mobile review scopeだけが許可されることを確認する。

このacceptanceを終える前に#478 / #479へ主戦場を移さない。

## 現在のruntime state

常用port `127.0.0.1:48177`は、23:13 JSTの最新観測ではWindows canonical runtimeのElectronだけがlistenしている。PIDは再起動で変わるため、再開時はportと実行パスを改めて確認する。

canonical sourceは`C:\Users\ootan\AppData\Local\TaskenDevRuntime\source`、clean main、user-dataは`C:\Users\ootan\AppData\Local\TaskenDevRuntime\user-data`である。

以前の保護対象だった`214e` worktreeはcleanな`codex/481-482`、head `6e7390a1`となり、常用portを使用していない。所有権不明のためcleanupは行わない。

## Git / worktreeの現在値

- Windows canonical source: `C:\Users\ootan\AppData\Local\TaskenDevRuntime\source`
- Windows canonical branch: clean `main`、`tasken-github/main`と一致
- 共有checkout `C:\Users\ootan\projects\tasuken`はmainがremoteよりbehindで、`.agents/`、`.tmp-smoke/`、`artifacts/`が未追跡。所有権不明のため触らない。
- PR #493用worktreeとlocal / remote branchはmerge後に削除済み
- `214e` worktreeはcleanだが所有権不明のため保護対象

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

所有権不明のworktree・untracked pathsは、cleanに見えても明示的な引渡しなしに削除しない。

## 次のマイルストーン

次の大きな完了点は「Android Tasken MVP完成」である。

その判定には、機能がmainにあることだけでなく、#477のFold continuity、Gateway運用、AI Inbox live E2Eを常用構成で再現可能に通す必要がある。offline recoveryと入力journeyはpassした。

#401はcloseした。#400と#477は残る実機acceptanceを終えるまでopenを維持する。

その後に#478、#479の順でAI human reviewとHermes delegateへ進む。

remote relay / managed syncの採否やDesktop大規模architecture整理は、Android daily-driverのdogfood結果を得るまで主戦場に戻さない。
