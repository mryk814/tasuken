# Tasken

研究開発職向けの、テーマ・タスク・長期スケジュール・メモ管理デスクトップアプリです。
データは端末内のElectronユーザープロファイルにあるSQLiteへ保存されます。
任意でOneDriveまたは社内共有フォルダを使った端末間差分同期を有効にできます。外部サーバーは必須ではありません。

## 起動

```powershell
npm install
npm run dev
```

`npm run dev`はelectron-viteでMain / Preload / Rendererを起動し、Renderer HMRを有効にします。
ブラウザ単体での起動と`localStorage`保存には対応していません。
Taskenは同じユーザーデータを使う二重起動を防ぎます。インストール版はウィンドウを閉じても
トレイに常駐するため、`npm run dev`の前にトレイメニューからTaskenを終了してください。

## ビルド

```powershell
npm run typecheck
npm run build
```

Electron内の入力・保存・再読み込みを自動確認:

```powershell
npm run smoke:desktop
```

データ検証、transaction、Snapshot往復を自動確認:

```powershell
npm run smoke:model
```

Read-only MCP Serverを起動:

```powershell
npm --silent run mcp
```

`npm --silent run mcp`はElectron runtimeをNode互換モードでstdio MCP Serverとして起動します。
MCPクライアント設定では、stdoutにnpmのログを混ぜないため`--silent`を付けてください。
通常はElectronの`userData`配下にある`research-desk.sqlite`を読みます。
別DBを使う場合は`TASKEN_DB_PATH`を指定してください。

```powershell
$env:TASKEN_DB_PATH="C:\path\to\research-desk.sqlite"
npm run mcp
```

MCPの検索・文脈取得toolは読み取り専用です。Note本文の全文は`include_raw_body: true`を明示した場合だけ返します。Task / Note / Knowledge / Sketch / Artifactのwrite toolはSQLiteへ直接書かず、TaskenのPending Proposalへ送ります。

Windowsインストーラーとportable版を作成:

```powershell
npm run package
```

生成先:

- `release/Tasken-Setup-0.1.0-x64.exe`
- `release/Tasken-Portable-0.1.0-x64.exe`

GitHub Release用の検証とpackageをまとめて実行:

```powershell
npm run release:check
```

配布版は`vX.Y.Z`タグをpushするとGitHub Actionsで作成されます。
詳しい手順は [`release.md`](./docs/release.md) を参照してください。

インストール版とportable版はいずれもElectronの`userData`配下に
`research-desk.sqlite`を保存します。端末間移行やバックアップにはSettingsの
Workspace Snapshotを使用してください。

複数端末で継続利用する場合は、主端末のSettingsで「端末間同期」の共有フォルダを設定し、
空のTaskenを起動した別端末で同じフォルダを選びます。
SQLiteファイルそのものは共有せず、端末別の変更差分だけを交換します。
詳細は [`docs/shared-folder-sync.md`](./docs/shared-folder-sync.md) を参照してください。

## 主な画面

- 今日: テーマの現在地、近いマイルストーン、次のタスク、最近のメモ
- ToDo: 未完了、Inbox、期限超過、日程未確定の整理
- Timeline: テーマ横断の長期ガントとマイルストーン一覧
- Themes / Notes（URL・コメントを含む）/ Waiting
- AI Import / Export: JSON / YAMLの取り込み、Note内OpenAI編集、Proposal差分確認、JSON / YAML / Markdownの書き出し
- Workspace Snapshot: ZIPによるバックアップ、差分プレビュー、競合選択付きImport
- Theme Status / Plan Revision / 情報源管理 / Settings
- Knowledge / MCP: 思考・根拠・問い・決定をAIが安全に参照するKnowledge一覧、read-only context、Preview必須のSafe Write Proposal

## 使い始める流れ

1. `Themes` で担当テーマを作り、`今日` でテーマの現在地を記録します。
2. 思いついた内容は左下の `クイック記録` から Inbox に入れます。
3. `ToDo` の Inbox フィルターで内容を具体化し、期限・Theme・状態を整えます。Excel等の表は `表から追加` でプレビューしてから取り込めます。
4. `Timeline` で長期予定を調整します。バー移動・リサイズ、依存線、計画進捗と実進捗の差分を示すイナズマ線を利用できます。
5. 会議・実験・AI壁打ちは `Notes`、成果物は `Links`、外部待ちは `Waiting` に残します。
6. 週次レビューやAIへの相談時は `AI Import / Export` で範囲と形式を選んでコピーします。
7. 定期的に `Settings` から Workspace Snapshot を書き出してバックアップします。

詳細な実装状況は [`PLAN.md`](./docs/PLAN.md) を参照してください。
Knowledge ModelとAI/MCP連携の次期方針は [`knowledge-mcp-policy.md`](./docs/knowledge-mcp-policy.md) を参照してください。
AIへ渡す概要・鮮度・根拠・公開範囲の共通契約は [`ai-metadata-contract.md`](./docs/ai-metadata-contract.md) を参照してください。
