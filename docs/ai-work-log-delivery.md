# AI作業ログ #629 のPC再生成・試用

この文書は単独公開候補の記録。3候補を合流した現在の手順と互換性は [統合候補](tasken-unified-integration.md) を参照。

受渡しbranchは `codex/komori-20261003-agent-activity`。実装baseは `a98f9955fb88140ac4b944ac9dfbdada3acb18b9`、元候補は `1e9a30eb7dc4bf8d672c00011c917707078c4a4b` に保全した。通常checkout、main、NASへ適用する手順は含めない。

## Windowsで再生成

Node.js 24とnpm、Gitを使用する。PC検証はNode 24.4.1、npm 11.4.2、Windows x64。`package-lock.json`でnpm依存を固定しており、Electronは37.10.3。`npm ci`のpostinstallが既存patchを適用し、この新しいclone内のSQLite native moduleをElectron向けに生成する。既存アプリのnode_modulesは利用・変更しない。

新しいフォルダへ取得する。アプリの既存設定がある通常checkoutでは実行しない。

```powershell
rtk proxy git clone --single-branch --branch codex/komori-20261003-agent-activity https://github.com/mryk814/tasuken.git tasken-agent-activity
Set-Location tasken-agent-activity
rtk npm ci --no-audit --no-fund
rtk npm run typecheck
rtk npm run build
rtk node scripts/run-electron-node.mjs --test tests/agent-work-log-import.test.mjs tests/agent-work-log-core-e2e.test.mjs tests/agent-session-contract.test.mjs tests/agent-session-hook-collector.test.mjs tests/agent-session-projection.test.mjs tests/tasken-debrief.test.mjs tests/mobile-gateway-phase4a.test.mjs tests/architecture-audit.test.mjs tests/application-command.test.mjs tests/mobile-gateway-runtime.test.mjs
rtk node scripts/agent-work-log-electron-smoke.mjs
rtk node scripts/run-agent-work-log-preview.mjs
```

`rtk`がないPCではコマンドの先頭の`rtk`とGitの`proxy`を省く。native SQLiteを使うテストはシステムNodeから直接実行せず、上記のElectron runnerを使う。

previewは毎回新しいTemp profileとDBを作り、そのプロセスにだけ保存先を渡す。通常profileを開かない。Debriefの取込から `fixtures/agent-work-logs/` の5件を本人が選び、本文確認後に採用できる。閉じれば試用を終了する。fixtureを自動収集するhookや個人履歴の走査は起動しない。

## 確認済みの範囲

元候補で型・build、関連100テスト、Android unit 196テスト、専用Pixel_8 emulatorでのCompose操作2テストが通った。PCと狭幅の実Electronで5fixtureのfile input→preview→採用→filter→再起動を確認した。狭幅は390px要求、Windows DPIによる実測391px。Enter/Escapeとfocus復帰、reduced motion、不正ファイルの回復可能エラーも確認した。Androidは実機確認ではない。

別のclean worktreeで`npm ci`から再生成し、型・build、Application Command/Mobile runtimeも含めた関連150テスト、5fixtureの実Electron smoke、script inventory auditが通った。新しいpreview/smokeコマンドは手動実行用で、CIの対象は変更していない。生成物、実DB、個人session、参照画像、画面画像、Library archiveをGitに含めない。版付きadapter、保存範囲、再開世代、未対応形式は[取込契約](ai-work-log-import.md)に記載する。

## Workflowと合流

この作業branchへの通常pushでは、Windows qualityはPRのみ、Android qualityはPR/manualのみ、Windows releaseはversion tag/manualのみ、Android signingはmainの指定path/manualのみなので、deploy/releaseは起動しない。今回PR・tag・manual workflowを作らないため、branch pushに自動CIは付かない。手元の検証結果を受渡しに使う。

task-7のBoard/AI作成/#628との接点はDebrief、Preload/IPC/API、Core composition、Mobile Today contract。task-4との重なりは `ApplicationCommandService` の `ApplyAiProposal` におけるcapture terminal許可とactive→terminal許可の2箇所で、`unknown`/`interrupted`を追加した部分。開始専用grantや他branchは取り込んでいない。mainへの統合時はこれらを別途照合する。
