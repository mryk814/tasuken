# Tasken

研究開発職向けの、テーマ・タスク・長期スケジュール・メモ管理デスクトップアプリです。
データは端末内のElectronユーザープロファイルにあるSQLiteへ保存されます。
任意でOneDriveまたは社内共有フォルダを使った端末間差分同期を有効にできます。外部サーバーは必須ではありません。

DesktopのQuick CaptureとAndroidの音声・テキスト入力からタイトル、Theme、日付、チェック項目を提案する任意のAI整理に対応します。
Desktopの「Settings → AI & Context → 入力のAI整理」でOpenAI / Azure OpenAI / Gemini / OpenCode Zen・Goを設定します。APIキーは端末内で暗号化して保存します。
設定方法と対応モデルの制約は[入力整理プロバイダー](docs/mobile-capture-organizer-providers.md)を参照してください。
整理案は入力した端末で確認・修正してから追加し、元の入力もTaskの本文へ保持します。

## 起動

```bash
npm ci
npm run doctor:desktop
npm run dev
```

`npm run dev`はdesktop doctorを通過した場合だけElectronを起動します。
WSLの日常UI確認は次を使います。

```bash
npm run dev:wsl
```

WSL（Ubuntu）でElectronのtest / smokeを実行する場合は、初回だけLinux共有ライブラリを入れます。

```bash
sudo apt-get update
sudo apt-get install -y libnspr4 libnss3 libasound2t64 xvfb
```

Ubuntu 22.04などで`libasound2t64`が見つからない場合は、代わりに`libasound2`を指定してください（`xvfb`はそのまま付けます）。

`npm run dev`はelectron-viteでMain / Preload / Rendererを起動し、Renderer HMRを有効にします。
ブラウザ単体での起動と`localStorage`保存には対応していません。
Taskenは同じユーザーデータを使う二重起動を防ぎます。インストール版はウィンドウを閉じても
トレイに常駐するため、`npm run dev`の前にトレイメニューからTaskenを終了してください。

コード正本、WSLg、Windows runtime clone、GitHub Actionsの分担は
[`docs/development-environment.md`](./docs/development-environment.md)を参照してください。
doctorがWSLgの0×0 monitorやNode/npmのOS混在を検出した場合、Electronプロセスを残さず停止します。

## ビルド

```bash
npm run typecheck
npm run build
```

WSLでの開発検証は、次の品質ゲートを使います。

```bash
npm ci
npm run ci
```

Electron内の入力・保存・再読み込みを自動確認（Electron依存導入済みのWSL / Windows）:

```bash
npm run smoke:desktop
```

データ検証、transaction、Snapshot往復を自動確認:

```bash
npm run smoke:model
```

狭幅・表示倍率ごとのレイアウト崩れを自動確認（本体の主要画面 / Note別ウィンドウ）:

```bash
npm run audit:responsive
```

```bash
npm run audit:note-window
```

MCP Serverをplain Nodeで起動（Tasken Desktopを先に起動してください）:

```bash
npm --silent run mcp
```

MCPクライアントを動かす環境には **Node.js 20以上**をインストールし、`node`を`PATH`から実行できるようにしてください。Tasken DesktopとTasken Coreが起動していることも必要です。Settingsが生成する接続設定はsystem Nodeの`node`コマンドを使い、Electronや同梱native moduleへfallbackしません。

`npm --silent run mcp`は`scripts/mcp-server.mjs`を通常のNodeで起動します。MCP bridgeはSQLiteを開かず、Desktop Mainが公開する認証済みloopback Tasken Coreへ接続します。Core停止時はDBへfallbackせず、tool resultに復旧可能な構造化errorを返します。MCPクライアント設定ではstdoutにnpmのログを混ぜないため`--silent`を付けてください。

Tasken Desktopを起動した状態で、Core discovery・health・API version・認証と、実stdio MCPの起動・ツール一覧・AI Ready読み取りを診断:

```bash
npm run doctor:mcp -- --json
```

Claude Code / Codex / GitHub Copilot CLIの登録方法、依頼文、着手から採用までの手順は [外部AI連携ガイド](./docs/external-ai-integration.md) を参照してください。診断対象をインストール済みMCPに合わせるには、設定画面でコピーしたserverパスを`--server`へ渡します。

MCPの検索・文脈取得toolは読み取り専用です。Noteの要約一覧で本文を含めるには`include_raw_body: true`を指定し、個別本文は`get_note`で取得します。作成・編集・結果報告はProposalとして届き、Taskenで採用するまで正式データは変わりません。例外は`start_task_work`で、人がAI ReadyにしたTaskの開始だけを直接記録します。

Coding Agentは`tasken.get_task_context`へTask IDと現在のworkspace情報を渡すと、Task / assignment / Theme / RepositoryContextと、関係理由付きのNote・Conversation・Artifact・Activity・Work Receipt概要をまとめて取得できます。件数と本文長には上限があり、全文が必要な場合だけレスポンス内のstable locatorから`tasken.get_note`、`tasken.get_conversation`、`tasken.get_artifact_metadata`、`tasken.get_activity_entries`を呼びます。Artifact toolはメタデータのみを返し、外部ファイル本文やローカルパスを読みません。

Themeには、人間が書く比較的安定した`Theme Charter`と、現在の方向・問いを持つ`Theme State`を保存できます。MCPでは目的別に`tasken.get_work_context`、`tasken.get_planning_context`、`tasken.get_debrief_context`、`tasken.get_learning_context`を使い分けます。`tasken://themes/{themeId}/intent` ResourceはThemeの意図だけを参照し、`daily-report` / `learning-column` Promptは利用者が明示起動する作業テンプレートです。正本と投影の境界は [`docs/tasken-context-architecture.md`](./docs/tasken-context-architecture.md) を参照してください。

人がAI ReadyにしたTaskを外部AIが選び、`get_task_context`で確認してから`start_task_work`で開始します。開始後の最新versionを使って`append_work_receipt`、`report_task_done`、`report_task_blocked`を送ります。報告はAI Inboxで採用し、Doneの採用はTask完了まで保存します。各Task writeには`expected_version`、`idempotency_key`、`caller`が必要です。同じ要求の再送ではkeyと内容を維持してください。RepositoryContext snapshotにはローカルパスやremote URLを保存しません。読み取り専用の運用では`TASKEN_MCP_READ_ONLY=1`を設定してください。

AI Readyは事前許可であり、自動実行の予約ではありません。外部AIを普段どおり開き、依頼文を貼り付けるかAI Readyの確認を頼みます。TaskenからCLIを直接起動する機能はありません。実stdioと一時DBを通す検証は [AI collaboration E2E](./docs/ai-collaboration-e2e.md) を参照してください。

Windowsインストーラーとportable版を作成:

```bash
npm run package
```

生成先:

- `release/Tasken-Setup-X.Y.Z-x64.exe`
- `release/Tasken-Portable-X.Y.Z-x64.exe`

GitHub Release用の検証とpackageをまとめて実行:

```bash
npm run release:check
```

詳しい手順は [`release.md`](./docs/release.md) を参照してください。

インストール版とportable版はいずれもElectronの`userData`配下に
`research-desk.sqlite`を保存します。通常起動時にはSettingsで指定した保存先へ
Workspace Snapshotを自動作成し、既定5世代をローテーション保持します。
保存先・有効/無効・世代数はSettingsの「詳細」で変更でき、同じ場所から今すぐ作成できます。
端末間移行や任意の時点を残す場合は、手動のWorkspace Snapshot書き出しを使用してください。

複数端末で継続利用する場合は、主端末のSettingsで「端末間同期」の共有フォルダを設定し、
空のTaskenを起動した別端末で同じフォルダを選びます。
SQLiteファイルそのものは共有せず、端末別の変更差分だけを交換します。
詳細は [`docs/shared-folder-sync.md`](./docs/shared-folder-sync.md) を参照してください。

## 主な画面

- 今日: テーマの現在地、近いマイルストーン、次のタスク、最近のメモ
- ToDo: 未完了、Inbox、期限超過、日程未確定の整理
- Timeline: テーマ横断の長期ガントとマイルストーン一覧
- Themes / Notes（URL・コメントを含む）/ Waiting
- Context / Agent連携: MCP・Context Preview / Pack、外部AgentからのProposal差分確認、JSON / YAML / Markdownの書き出し
- Workspace Snapshot: 復元検証付きの起動時自動世代バックアップ、手動ZIP書き出し、差分プレビュー、競合選択付きImport
- Theme Status / Plan Revision / 情報源管理 / Settings
- Knowledge / Context Graph / MCP: 既存Knowledge・Relationの診断、read-only context、Preview必須のSafe Write Proposal。Context GraphとAI ContextはKnowledge画面の手動整理に依存しない

## 使い始める流れ

1. `Themes` で担当テーマを作り、`今日` でテーマの現在地を記録します。
2. 思いついた内容は左下の `クイック記録` から Inbox に入れます。
3. `ToDo` の Inbox フィルターで内容を具体化し、期限・Theme・状態を整えます。Excel等の表は `表から追加` でプレビューしてから取り込めます。
4. `Timeline` で長期予定を調整します。バー移動・リサイズ、依存線、計画進捗と実進捗の差分を示すイナズマ線を利用できます。
5. 会議・実験・AI壁打ちは `Notes`、成果物は `Links`、外部待ちは `Waiting` に残します。
6. 週次レビューやAIへの相談時は `AI Import / Export` で範囲と形式を選んでコピーします。
7. `Settings` の「詳細」で自動バックアップの保存先と最新結果を確認します。節目では手動Snapshotも書き出します。

詳細な実装状況は [`PLAN.md`](./docs/PLAN.md) を参照してください。
Knowledge ModelとAI/MCP連携の次期方針は [`knowledge-mcp-policy.md`](./docs/knowledge-mcp-policy.md) を参照してください。
AIへ渡す概要・鮮度・根拠・公開範囲の共通契約は [`ai-metadata-contract.md`](./docs/ai-metadata-contract.md) を参照してください。
