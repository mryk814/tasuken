# 開始専用MCP候補の再生成

この文書は単独公開候補の記録。3候補を合流した現在の手順と互換性は [統合候補](tasken-unified-integration.md) を参照。

対象branchは`codex/komori-20261003-ai-task-start`、公開baseは`a98f9955fb88140ac4b944ac9dfbdada3acb18b9`（v0.1.73）。
本人用Task/Note作成の前提実装と、独立opt-inの`task.start_work`を含む。
NAS個別配備スクリプト、資格情報、実データ、ログ、生成済み配布物、#628/#629は含まない。
package versionの`0.1.74-ai-create.1`は候補の識別子であり、正式releaseは作成しない。

## Windowsで取得・ビルド・テスト

Node.js 24とnpmを使う。検証環境はNode 24.4.1 / npm 11.4.2。
`package-lock.json`が直接・間接依存のversionとintegrityを固定する。`npm install`で更新せず`npm ci`で再現する。
主な固定値はElectron 37.10.3、better-sqlite3 12.11.1、MCP SDK 1.30.0、TypeScript 6.0.3、Vite 6.4.3。

再生成は必要な境界だけで行う。同一の実行コード・依存・OS・コマンドで成功した結果は再利用し、受渡しごとの全再生成を要求しない。
今回の受渡しでは検証済み候補との実行コード・lockfile・build入力の一致を確認し、型チェック、Desktop/Core/MCP build、関連118テストと設計監査18テストの成功を再利用した。
以下は新しいPCや依存環境、影響する変更がある場合の手順。

PowerShellで未使用の作業ディレクトリへ取得する。

```powershell
rtk git clone --single-branch --branch codex/komori-20261003-ai-task-start https://github.com/mryk814/tasuken.git TaskenAiStart
Set-Location TaskenAiStart
rtk git rev-parse HEAD
$env:HUSKY = '0'
rtk npm ci
rtk npm run typecheck
rtk npm run build
rtk npm run build:mcp
rtk npm run build:core:headless
rtk npm run test:ai-task-start
```

`HUSKY=0`は依存導入時のGit hook設定を抑止する。Agent Session hookの導入は不要。
依存導入のpostinstallが、このcheckout専用のElectron/native moduleを用意する。
ビルド出力は`out/`、`mcp-dist/`、`core-dist/`。ZIPや別checkoutのnode_modulesは不要。
テストは一時SQLite・一時共有フォルダ・実stdio MCPを使い、開始・重複防止・拒否・撤回・人の報告採用まで確認する。

## 隔離preview

上記ビルド後、本人用作成UIの自動previewを実行できる。

```powershell
rtk node scripts/ai-item-creation-ui-smoke.mjs
```

一時userDataでTaskenを起動し、架空Task/NoteのAI作成・未確認・既読表示を確認して終了する。
画像は`artifacts/ai-item-creation/`へ保存する。普段のuserDataや同期先を指定しない。
開始専用操作のpreviewは`test:ai-task-start`内のHeadless/Core/MCP E2Eが担う。

## 公開・有効化の境界

通常branchへのpushは現行workflowの起動対象外。Windows/Android品質確認はPR等、Windows releaseはversion tagまたは明示dispatchで起動する。
この受渡しではtag・PR・merge・workflow dispatchを実行しない。
本番の開始opt-in、NAS image/Compose、client側tool許可は別の承認対象とする。
本人の対象TaskをAI Readyにして会話で指定する操作と、報告採用・Task完了の人間操作は[開始専用権限](ai-task-start.md)を参照。
