# Tasken

研究開発職向けのテーマ・タスク・長期スケジュール・メモ管理アプリ。Desktop は Electron + TypeScript + React で、利用者の正本データを SQLite に保存する。Android 版は `android-app/`。起動とセットアップは [README](README.md) と [開発環境](docs/development-environment.md)、コマンドの正本は `package.json`。

## 構造とデータ

- 実行経路は `React → Zustand → window.api → Preload → IPC → Service → Repository → SQLite/OS`。Renderer から DB・Node.js・OS へ直接アクセスしない。
- 保存形式と Import/Export 形式を変えるときは、移行と復旧も用意する。秘密情報をログと Export に含めない。
- AI の書き込みは Proposal が既定で、本人がプレビューして採用するまで正式なデータにならない。例外は本人が明示的に有効にした経路だけで、個人業務への Task/Note の新規作成（AI 由来・未確認として記録する）と、本人が AI Ready にした個人 Task の作業開始。これらの例外で既存データの編集・削除・完了・委任の権限を広げない。
- UI は [design-guide](design-standard/design-guide.md) に従い、見た目の値は [tokens.css](design-standard/tokens.css) / [tokens.json](design-standard/tokens.json) を正本にする。エラーのときも入力を消さない。
- 判断の拠りどころ：Electron・IPC・ウィンドウ・配布は [desktop-app-standard](docs/desktop-app-standard.md)、機能境界・保存・schema・Import/Export・削除と復元・ログは [engineering-contracts](docs/engineering-contracts.md)、MCP・外部 AI 連携は [ai-collaboration-e2e](docs/ai-collaboration-e2e.md) と README の MCP の節、呼び方は [glossary](docs/glossary.md)、アプリの性格は [app-charter](docs/app-charter.md)。

## 実データと検証

- 通常起動は本人の実プロファイル（`%APPDATA%\tasken`）につながる。画面を確かめるときは `TASKEN_DEV_USER_DATA_DIR` に検証用の場所を指定して `npm run dev` で起動する。smoke の runner は一時 userData を自分で用意する。
- `workspace:materials-demo*` は `--apply-local` を含み、本人のローカル DB に書き込む（`workspace:materials-demo` は既存の DB を退避してデモデータに置き換える）。検証では実行しない。
- `audit:responsive` と `audit:materials-demo` は userData を指定せずに Electron を起動するので、実プロファイルを開く。
- テストは Electron の Node で動かす：`node scripts/run-electron-node.mjs --test tests/<対象>.test.mjs`（全体は `npm test`）。型は `npm run typecheck`、ビルドは `npm run build`。
- 保存→再起動→再表示は `npm run smoke:model` と `npm run smoke:desktop` で確かめる。`smoke:desktop:focused` は build を省くので、ソースを変えたら build し直してから使う。古い成果物での成功は今回の検証に数えない。
- merge 前の品質ゲートは `npm run ci`。
- Windows 固有の機能（tray、global shortcut、clipboard、画面録画、ファイルダイアログ）と配布物は、[開発環境](docs/development-environment.md) の Windows runtime clone と GitHub Actions で確かめる。
- Electron の画面は既存の smoke runner と同じく Playwright の `_electron` で操作する。そのためにブラウザ用のテスト基盤を新しく作らない。

## 先に聞くこと

- design-standard 自体の変更。CSS-in-JS、別の UI フレームワーク、新しいサーバーや DB の導入。
- GitHub Actions の workflow の追加。
