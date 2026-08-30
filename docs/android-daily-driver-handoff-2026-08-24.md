# Android daily-driver MVP 引き継ぎ

- 更新: 2026-08-31 JST
- 対象: #398 / #402 / #477 / #397
- 実装基準main: `152ee29c`

2026-08-31の更新では、GitHubのIssueとPR、および上記commitのコードだけを照合した。
テスト、実機操作、稼働Gatewayの確認、Discord送信は行っていない。
下記の2026-08-24の証拠は、その時点の端末とAPKに対する履歴であり、現在の常用構成の検証結果ではない。

## 目標

現在の主目標は、Android版Taskenを外出中の日常操作に使える状態へ仕上げることである。

具体的には、スマートフォンだけでTaskの確認・作成・編集・完了、Task/Captureの即時入力、offline中の操作、Desktop復帰後の重複なし収束を行えることを目指す。

Fold対応とAI連携は別製品として増やすのではなく、同じTask・Capture・Application Commandを使うAndroid surfaceとして完成させる。

現時点は「基礎機能を作る段階」をほぼ終え、「常用構成の連続journeyで信用できることを証明する段階」にある。

## 現在の結論

- AndroidのTask管理、offline cache/outbox、入力、Widget、canonical Capture、署名付きAPK、adaptive UIはmainへ統合済みで、#399 / #400 / #401はclosedである。
- [PR #508](https://github.com/mryk814/tasuken/pull/508)でWork ReceiptのAccept / Returnとblocked返信を統合し、#478はclosedである。
- [PR #509](https://github.com/mryk814/tasuken/pull/509)でContext Preview、agent-ready委任、安全な共有、AI状態の通知を統合し、#479はclosedである。
- #398 / #402 / #477 / #397はopenである。
  #402と#397のIssue本文には統合前の未実装記載が残るため、実装状況は上記PRとコードを根拠にする。
- 次は[Issue #477](https://github.com/mryk814/tasuken/issues/477)の受入れを、Galaxy S23とFold emulatorで確認する。
  Galaxy Z Fold7は実利用端末として扱い、事前検証や物理hingeの感触を完了条件にしない。

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
| 入力のprocess death復元        | #493 | DraftとUndo対象を保存し、再起動後も入力を継続する                          |
| Work Receiptの人間レビュー     | #508 | Accept / Returnとblocked返信をcanonical commandへ接続する                 |
| AIへの委任                     | #509 | Context Preview、agent-ready、安全な共有、通知を接続する                  |

PR #508のmerge commitは`fb108504`、PR #509は`68edac1c`であり、実装基準mainは両方を含む。

PRに記録された検証結果は各PR時点の証拠として参照し、この文書更新で再実行した結果とは扱わない。

## 目標に対する現在地

| 領域                                                              | 現実装                          | 過去の証拠                                                             | 次回の確認                                    |
| ----------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------- |
| Today / Task一覧 / 検索 / filter / detail                         | mainへ統合済み                  | S23、Fold7、emulatorで描画済み                                         | 今回の構成で状態の継続を確認                  |
| Create / title / Theme / Schedule / checklist / complete / reopen | mainへ統合済み                  | 個別操作の実機検証と自動testあり                                       | 常用構成での連続journey                       |
| Room cache / outbox / cursor sync                                 | #399として実装済み              | 8/24にFold7のpending 1→0とcanonical exactly-once収束を確認               | 常用構成での復帰                              |
| Quick Add / App Shortcut / Widget / Share Target / voice          | main（#493）                    | 実URL、Task/Capture継続入力、未送信/適用済みUndo、process death/reboot | #477に残るS23実発話とWidget表示               |
| Task / Capture provenance                                         | mainへ統合済み                  | android_speech / share_targetのallowlist metadataを確認                | S23入力の修正結果とcanonical provenance      |
| signed release / update install                                   | #485で実装済み                  | 8/24にFold7 / S23のRoomとKeystore dataを保持したupdate installを確認   | 今回選ぶAPKで保持を確認                        |
| Fold compact / expanded                                           | #400として実装済み              | Fold7 compact→expandedでQuick Addを維持し、IME中も保存操作へscroll可能 | Fold emulatorで選択、入力、scrollの継続を確認 |
| AI Inbox / Work Receipt / Proposal                                | read/review surfaceを実装済み   | Gateway契約とAndroid cacheのテストあり                                | live Gatewayを通す一連のreview                |
| Hermes delegate / Context Preview / notification                  | #509で統合済み                  | PRに契約、Android、実機検証の記録あり                                  | S23で委任から通知まで確認                     |
| Work Receipt Accept / Return / blocked返信                        | #508で統合済み                  | PRに契約、Android、実機検証の記録あり                                  | S23でcanonical結果と再送を確認                |

pending 1→0の履歴は[2026-08-24のIssueコメント](https://github.com/mryk814/tasuken/issues/477#issuecomment-5395294972)を参照する。
現在の端末、稼働Gateway、APKでの再検証は未実施である。

## 2026-08-24の実機とbuild証拠

当時の実装基準mainは、PR #493 merge `b2d02a41f667fe14beaae2adadfbb55b70246fc0`である。
PR #493ではWindows quality、Android quality、永久署名workflowが成功した。

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

## 2026-08-24に完了した入力journey

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

## 次回の受入れ手順

以下は未実施の手順である。
実機操作、APKのupdate install、実データ変更、端末のrevoke、runtimeの停止や再起動、PCのsleep、Tailscale設定変更は、対象と影響を示して許可を得てから行う。
外部への送信やIssue更新は、その操作の直前に別途承認を得る。
今回の文書更新は、これらを実行する許可を含まない。

受入れではS23をcompact画面と端末固有動作の対象、Fold emulatorをadaptive layoutの対象とする。
使用するAPKとGatewayのcommitを固定し、[release signing手順](./android-release-signing.md)に沿って署名、APK hash、update前後のデータ保持を記録する。
debug APKの初回ART遅延とrelease APKの起動時間は分けて記録する。

### 1. 入力とadaptive UI

1. Fold emulatorでTaskを選び、filter、search、list scroll位置、Quick Addの未保存入力を保持したままcompactとexpandedを往復する。
2. rotationとbackground / restoreを行い、選択と入力を保持し、dialog / sheetが安全に復元またはdismissされることを確認する。
3. list-detailへの切替、hinge付近の操作要素、IME表示時の保存操作を確認し、各状態のスクリーンショットを残す。
4. S23のOne UI launcherでWidgetのSmall / Medium / Large / Wideを確認し、表示とtap targetを記録する。
5. S23で実発話からfinal textを得て修正し、Task保存後のcanonical Task、Activity、provenanceを照合する。

### 2. Gateway運用とconflict

1. 対象runtimeを特定し、loopback bind、Tailscale Serveのprivate HTTPS、Funnel未使用を確認する。
2. 許可されたテスト端末のrevokeからAPI拒否、再pairingまで通し、既存cacheとpending commandの扱いを記録する。
3. Taskenのtray常駐、Tasken再起動、Windows再起動、PC sleep / wake、Tailscale再接続を一つずつ行い、Gateway状態とS23の復帰結果を残す。
4. Gateway停止中のTask操作をqueueし、復帰後のpending 1→0、canonical entity、event、receiptの件数を照合する。
5. title / Theme / Scheduleの競合でserver/localの意図を保持し、選択後の結果を確認する。

再pairing時は、[公開scope定義](../src/shared/contracts/mobile/protocol.mjs)の6権限と端末へ実際に付与された権限を照合する。
`mobile:read`、`mobile:context-read`、`mobile:task-write`、`mobile:capture-write`、`mobile:proposal-review`、`mobile:human-review`を区別し、旧tokenの権限不足を暗黙に補わない。
通信障害時の未検証401と、接続先serverが一致する正式なunauthorized応答の扱いは、[Android repository](../android-app/app/src/main/java/jp/personal/tasken/companion/MobileGatewayRepository.kt)に従って確認する。

### 3. AI review

1. S23でContext Previewを確認してTaskをHermesへ委任し、canonical Taskのexecutorとagent-ready状態を照合する。
2. 共有内容にstable Task locatorがあり、資格情報、ローカルパス、非公開Contextがないことを確認する。
   Discord送信は送信先と内容を示して承認を得た場合だけ行い、送信しなければ未検証として残す。
3. Hermesが既存MCPでlocatorからContextを取得し、Work ReceiptまたはProposalを返した後、Androidで通知と詳細を確認する。
4. Work Receiptをoffline cacheでも再表示し、onlineで最新ReceiptのAccept / Returnとblocked返信をそれぞれ確認する。
   Proposalのaccept / rejectは別の操作として確認する。
5. stale Task、stale Receipt、stale Proposal、offline、失効端末、権限不足で許可されない操作が実行されないことを確認する。
   Proposal判断は`mobile:proposal-review`、人間のAccept / Returnは`mobile:human-review`を必要とし、agent tokenではどちらも判断できない。
6. 応答喪失後の同一command再送でTaskとReceiptのidentityが変わらず、canonical結果が一度だけ適用されることを照合する。

### focused testsと証拠の記録

CLIの事前検証候補は次の既存テストに限定する。
これらのテストを通しても、常用Gateway、Androidの実画面、One UI launcher、Discord送信を確認したことにはならない。

| 対象 | 既存テスト |
| --- | --- |
| pairing、失効、loopback | [mobile-gateway-runtime.test.mjs](../tests/mobile-gateway-runtime.test.mjs) |
| Proposalと人間レビューの契約、再送、権限 | [mobile-gateway-phase4a.test.mjs](../tests/mobile-gateway-phase4a.test.mjs) |
| Context Preview、委任、locator | [mobile-gateway-agent-delegation.test.mjs](../tests/mobile-gateway-agent-delegation.test.mjs) |
| 実stdio MCPとcanonical人間完了 | [ai-collaboration-e2e.test.mjs](../tests/ai-collaboration-e2e.test.mjs) |

既存の実stdio MCPテストは、人間AcceptをApplication Commandへ直接渡す。
Mobile Gateway経由のreviewやAndroid操作は、上記手順で別に確認する。
端末側は既存の`MobileHumanReviewRepositoryTest`、`MobileTaskDelegationRepositoryTest`、`MobileTaskNotificationIsolationTest`、`WorkReceiptDetailUiTest`を、使用許可のある対象で実行する。

各手順の実施後は、次の欄を埋める。
過去のpassを今回の実結果欄へコピーしない。

| 記録欄 | 記録する内容 |
| --- | --- |
| 構成 | 実施日時、端末、OS、app commit、APK versionとhash、Gateway commit |
| 操作と期待値 | 手順番号、入力、期待する表示とcanonical結果 |
| 実結果 | pass / fail / 未実施、画面やlogの証拠への参照 |
| 正本との照合 | Task / Receipt / Proposal / commandのID、version、eventとreceiptの件数 |
| 後始末 | 許可されたQAデータ、token、proxy、emulator設定の処置と残件 |
| 未検証 | 実行できなかった境界と再開条件 |

token、pairing code、秘密値、実データ本文は証拠へ含めない。
QAデータの後始末も許可された対象だけに限定し、残したものは理由と再開手順を記録する。

## 2026-08-24のruntime観測

以下は2026-08-24 23:13 JSTの観測記録であり、2026-08-31の稼働状態を示さない。

常用port `127.0.0.1:48177`は、23:13 JSTの最新観測ではWindows canonical runtimeのElectronだけがlistenしている。PIDは再起動で変わるため、再開時はportと実行パスを改めて確認する。

canonical sourceは`C:\Users\ootan\AppData\Local\TaskenDevRuntime\source`、clean main、user-dataは`C:\Users\ootan\AppData\Local\TaskenDevRuntime\user-data`である。

以前の保護対象だった`214e` worktreeはcleanな`codex/481-482`、head `6e7390a1`となり、常用portを使用していない。所有権不明のためcleanupは行わない。

## 2026-08-24のGitとworktree観測

- Windows canonical source: `C:\Users\ootan\AppData\Local\TaskenDevRuntime\source`
- Windows canonical branch: clean `main`、`tasken-github/main`と一致
- 共有checkout `C:\Users\ootan\projects\tasuken`はmainがremoteよりbehindで、`.agents/`、`.tmp-smoke/`、`artifacts/`が未追跡。所有権不明のため触らない。
- PR #493用worktreeとlocal / remote branchはmerge後に削除済み
- `214e` worktreeはcleanだが所有権不明のため保護対象

## 再開時のread-only確認

Windowsの対象checkoutを明示し、最初に次だけを確認する。
dirty stateを巻き戻さず、WSLや別worktreeへ対象を広げない。

```powershell
rtk where.exe rtk
rtk --version
rtk git status --short --branch
rtk git stash list
rtk git rev-parse HEAD
rtk gh issue view 477 --comments
```

端末と稼働runtimeの確認は、今回の対象と操作許可を確定してから行う。
所有権不明のworktreeやuntracked pathsは、cleanに見えても明示的な引渡しなしに削除しない。

## 次のマイルストーン

次の大きな完了点は「Android Tasken MVP完成」である。

その判定には、#477の残る手順をS23とFold emulatorの常用構成で通し、現在のAPKとGatewayに対する証拠を残す必要がある。
#400 / #401 / #478 / #479はclosedであり、機能を作り直す段階ではない。
受入れ結果を基に#398 / #402 / #477 / #397のclose可否を再判定する。

remote relay / managed syncを扱う#427は保留のままとし、Desktop依存が日常利用の実害になった時点で評価を再開する。
