# Tasken

研究開発職向けのテーマ・タスク・長期スケジュール・メモ管理アプリ。Desktop は Electron + TypeScript + React で、利用者の正本データを SQLite に保存する。Android 版は `android-app/`。起動とセットアップは [README](README.md) と [開発環境](docs/development-environment.md)、コマンドの正本は `package.json`。

## 構造とデータ

- 実行経路は `React → Zustand → window.api → Preload → IPC → Service → Repository → SQLite/OS`。Renderer から DB・Node.js・OS へ直接アクセスしない。
- 保存形式と Import/Export 形式を変えるときは、移行と復旧も用意する。秘密情報をログと Export に含めない。
- AI の書き込みは Proposal が既定で、本人がプレビューして採用するまで正式なデータにならない。例外は、本人が AI Ready にした Task の作業開始（AI Ready が許可。Desktop は Theme を問わず、NAS は個人業務だけ）と、本人が設定「ローカルの AI に直接の書き込みを許す」を有効にした Desktop のローカル接続（stdio）での直接の書き込み。直接の書き込みは、Task/Note の新規作成と、本人の言葉を根拠にした既存 Task の編集・完了・再開・削除（tombstone）・委任、Note の編集、作業報告と Note の Proposal の採否（採否は本人の言葉が必ず要る）。actor と根拠（本人の言葉か AI の理由）と会話を記録し、取り消せるようにする。どれも Core が actor を固定する限定の入口だけを通し、汎用の Task 変更口は AI に出さない。中止・hard delete・Import/Export・設定は AI に出さない。NAS の HTTP は Proposal と、個人業務への新規作成（create-only）までを既定の上限にする。私用の Workspace の NAS では、配備とクライアントごとに明示したときだけ、既存 Task の直接変更と取り消しも受ける（取り消せない Note の編集と採否は Desktop だけ）。NAS にしか無い機能は作らない（仕事の Workspace は Desktop だけで使うため。tests/core-capability-parity.test.mjs）。AI の公開範囲の外の Task と Theme は、AI から直接変えられない（ただし全体の既定は端末ごとの設定で同期されず、NAS では既定のまま）。
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
