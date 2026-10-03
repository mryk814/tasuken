# Taskボード・AI作成・由来表示の再現手順

この文書は単独公開候補の記録。3候補を合流した現在の手順と互換性は [統合候補](tasken-unified-integration.md) を参照。

公開baseは `a98f9955fb88140ac4b944ac9dfbdada3acb18b9`。
delivery branchは `codex/komori-20261003-board-ai-icons`。
既存Taskの一覧／状態別ボード、課題のやり取り、明示的なAI Task/Note新規作成、PC/Androidの由来アイコンをまとめた候補。

## PCのclean checkoutから試す

Windows、Node.js 24、npm、PowerShell 7を使う。検証環境はNode.js 24.4.1 / npm 11.4.2。
依存はコミット済み `package-lock.json` のintegrity付き解決に固定する。`npm install`でlockfileを再解決しない。
以下は任意の作業ディレクトリで実行する。`rtk`がない環境では接頭辞だけを外せる。

```powershell
rtk git clone --branch codex/komori-20261003-board-ai-icons --single-branch https://github.com/mryk814/tasuken.git tasken-board-preview
Set-Location tasken-board-preview
rtk npm ci
rtk npm run build
rtk node scripts/run-electron-node.mjs scripts/task-handoff-audit.mjs --task-board --integrated
pwsh -NoProfile -File scripts/preview-task-board.ps1
```

merge前の全品質ゲートは `rtk npm run ci`。Electron ABI rebuild、lint、typecheck、全test、strict consistency、architecture gate、script inventory、build、実Desktop smoke、実live MCP Proposal smokeを順番に実行し、最初の失敗で止まる。重複していたunit-contract/behavior集約実行だけを外し、全test fileの列挙とconcurrency=1は保持する。focused scriptsも残す。

上の一式は新しいcheckoutを最初に試すための手順。同一ソース・依存・OSで成功済みの検証は再利用し、文書更新や引継ぎだけを理由に全CIやfixture生成を繰り返さない。ソース／統合接点／実行環境が変わった場合は、その境界に必要な検証を選ぶ。

Desktop smokeは仮想マイクを使用する。制限された実行サンドボックスではWindows音声APIが拒否される場合があるため、その場合はOS権限を変更せず、通常ユーザーの開発端末で同じコマンドを実行する。

監査は新規Temp profileと架空のTask/Note、Temp内共有folderを生成する。結果・画像は `output/task-board-audit` に保存される。
preview launcherは、その監査で作成した一時profileにだけ接続する。ExecutionPolicyの変更やBypass指定は行わない。
ToDo → 未完了 → ボード →「AI作成から同じ課題で一周」を開く。Notesには「AI作成の統合確認メモ」がある。
作成元アイコンの説明、依頼・質問・返答・報告・別端末からの追記を確認できる。
ウィンドウを閉じるとpreviewはトレイに残る。同じlauncherで再表示できる。通常版も起動中なら、架空のTask名で区別する。

ソースを変えずに再度previewを開く場合は、最後のlauncherだけでよい。Temp profileを削除した場合は監査から再生成する。
アプリを単に `npm start` で開く手順は実ユーザープロファイルにつながるため、この試用には使わない。

## Androidを再生成する

Android SDKとJDK 17以上を用意し、`ANDROID_HOME`またはgitignoredの`android-app/local.properties`でSDKを指定する。
Gradle wrapper、checksum、Android/Kotlin pluginとライブラリの版はリポジトリ内の指定を使う。

```powershell
rtk .\android-app\gradlew.bat -p android-app --no-daemon testDebugUnitTest assembleDebug assembleDebugAndroidTest
```

署名鍵を必要としないdebug成果物を生成する。実機へのinstallや公開は含まない。
新Gatewayと新Androidを併用すると、Task/関連NoteのAI由来がoptional応答からRoomへ保存される。
旧クライアント／旧Gatewayとの互換性とRoom 26→27の移行は [ai-origin-indicator.md](ai-origin-indicator.md) を参照。

## 検証する契約

- Task状態、AI作成の未確認、AI報告の要対応を別に扱う。「報告を採用」ではTaskは継続し、採用済みの「Taskを完了」は別の人間操作。
- 依頼→質問→返答→報告→修正依頼→採用→正式完了は既存Task/Feed/Proposal/WorkReceiptを使う。別Task DBや重複chatを追加しない。
- ボードの状態変更はドラッグを必要とせず、keyboard/selectで操作できる。空列、競合時の入力保持、再open、繰返し完了、2端末同期と再起動を監査する。
- 実Electronは1400/820/420幅、Androidはphone/Fold幅で由来アイコン・説明・未確認点を確認する。PCの既読操作はTask状態を変えない。

## 並行候補との統合境界

開始専用capabilityと#629のログ可視化は含めていない。
開始専用候補との共通ファイルは `applicationCommandService.ts`。本候補は `returnTaskWork` の現attemptの成果報告に対する修正依頼、別候補は開始専用経路を変更する。
#629とは同ファイル、`mobileGatewayAdapter.ts`、`src/shared/contracts/mobile/schema.ts` とAndroid `MainActivity.kt` / `MobileTodayDto.kt` / `TodayModel.kt` / `MobileGatewayRepository.kt` が接点になる。optionalなagentSessionsとaiOriginの応答互換性、ログと課題会話の役割を合成後に確認する。

このbranchはsource・固定依存・再生成手順の受け渡し用。通常Desktop/NAS更新、client grant、hook導入、main merge、release、実機配布は別の作業。
workflowはPR、main更新、tagまたは手動実行が条件で、このdelivery branchへの通常pushだけでは品質workflowやreleaseを起動しない。

具体的な検証結果は [task-board-validation.md](task-board-validation.md) に記録する。
