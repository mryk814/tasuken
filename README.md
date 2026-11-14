# Tasken

研究開発職向けの、テーマ・タスク・長期スケジュール・メモ管理デスクトップアプリです。
データは端末内のElectronユーザープロファイルにあるSQLiteへ保存されます。
任意でOneDriveまたは社内共有フォルダを使った端末間差分同期を有効にできます。外部サーバーは必須ではありません。

DesktopのQuick CaptureとAndroidの音声・テキスト入力からタイトル、Theme、日付、チェック項目を提案する任意のAI整理に対応します。
Desktopの「Settings → AI & Context → 入力のAI整理」で、既定の「ChatGPTの契約」（ChatGPT Plus / Proの利用枠。APIキー不要）に接続します。OpenAI API / Azure OpenAI / Gemini / OpenCode Zen・Goのキーを明示的に設定して使うこともでき、月間の送信上限を指定できます。接続情報とAPIキーは端末内で暗号化して保存します。実行方針は[内部AIの実行方針](docs/internal-ai-execution.md)を参照してください。
設定方法と対応モデルの制約は[入力整理プロバイダー](docs/mobile-capture-organizer-providers.md)を参照してください。
整理案は入力した端末で確認・修正してから追加し、元の入力もTaskの本文へ保持します。
Desktopの既存Taskでは、編集画面の「文章から日程を変更」から一件の日程変更案を確認・採用できます。AIへ送る項目の限定は`taskScheduleProposalRequestSchema`（`src/shared/taskScheduleProposal.ts`）と`tests/task-schedule-proposal.test.mjs`が固定しています。
WindowsはToday / ToDoのタスク追加にある「音声・AI整理から追加」から進み、入力欄で `Win + H` を使えます。アプリ内AIを使わず、外部AIへの依頼文をコピーして整理結果のJSONを貼り付ける経路も同じ画面にあります。
Androidは[PCなしのAI整理設定](docs/android-capture-requests.md)で同じサービスを選べます。端末専用キーを設定し、明示的に有効化するとAndroidから直接整理できます。

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

## 動作が重いときの記録

`TASKEN_PERF_DIAGNOSTICS=1` を付けて起動すると、Main / Rendererが200ms以上止まった時刻と長さを
`%APPDATA%\tasken\logs\main.log` に `performance` として残します。記録は固定の種類と数値だけで、
本文やタイトルは含みません。トレイからTaskenを終了してから、PowerShellで起動します。

```powershell
$env:TASKEN_PERF_DIAGNOSTICS = '1'
& "$env:LOCALAPPDATA\Programs\Tasken\Tasken.exe"
```

重いと感じた時刻と `main.log` の記録を突き合わせ、`source` がmainかrendererかで止まった側を切り分けます。

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

狭幅・表示倍率ごとのレイアウト崩れを自動確認（本体の主要画面）:

```bash
npm run audit:responsive
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

外部AIは最初に`tasken.get_capabilities`を呼ぶと、接続先がどの書き込みを受け付けるかと、使えないtoolの理由をまとめて確認できます。MCP serverは起動時に接続先を確認し、使えない書き込みtoolを一覧に出しません。

MCPの検索・文脈取得toolは読み取り専用です。Task・待ち・計画は`search_items`、Noteは`search_notes`で探します。Noteの要約一覧で本文を含めるには`include_raw_body: true`を指定し、個別本文は`get_note`で取得します。AIが着手してよいTaskかは、Taskに添える`agent_state.runnable`で判断します。作成・編集・結果報告はProposalとして届き、Taskenで採用するまで正式データは変わりません。例外は`start_task_work`（人がAI ReadyにしたTaskの開始）と、設定の「AI & Context → ローカルのAIに直接の書き込みを許す」を有効にしたときの`create_task`・`create_note`です。有効にすると、`change_task`で既存Taskの編集・完了・再開・削除・委任も、本人の言葉を根拠に直接行えます（`undo_change`で取り消せます）。`edit_note`でNoteの編集、`decide_proposal`で作業報告とNote案の採否も行えます（採否は本人の言葉が必ず要ります）。どちらもAIの操作として記録します。NASのHTTPでは、配備とクライアントごとに許したときだけ`change_task`・`undo_change`を使えます（`docs/synology-headless-node.md`）。Taskenが起動していないとき、配布版のMCPはTasken.exeの場所を案内します。

Coding Agentは`tasken.get_task_context`へTask IDと現在のworkspace情報を渡すと、Task / assignment / Theme / RepositoryContextと、関係理由付きのNote・Activity・Work Receipt概要をまとめて取得できます。件数と本文長には上限があり、Note全文が必要な場合だけレスポンス内のstable locatorから`tasken.get_note`で取得します。

Themeには、人間が書く比較的安定した`Theme Charter`と、現在の方向・問いを持つ`Theme State`を保存できます。MCPのテーマ背景は`tasken.get_theme_context`に一本化しています。`tasken://themes/{themeId}/intent` ResourceはThemeの意図だけを参照し、`daily-report` Promptは利用者が明示起動する作業テンプレートです。正本と投影の境界は [`docs/tasken-context-architecture.md`](./docs/tasken-context-architecture.md) を参照してください。

人がAI ReadyにしたTaskを外部AIが選び、`get_task_context`で確認してから`start_task_work`で開始します。開始後の最新versionを使って`report_work(status=progress)`、`report_work(status=done)`、`report_work(status=blocked)`を送ります。報告はFeedで採用し、完了報告の採用後もTaskの完了は利用者が明示します。AIは完了したチェック項目のIDを報告に添えられ、採用時に該当項目へ反映されます。Taskの完了後も追加報告を履歴へ残せます。各Task writeには`expected_version`、`idempotency_key`、`caller`が必要です。同じ要求の再送ではkeyと内容を維持してください。RepositoryContext snapshotにはローカルパスやremote URLを保存しません。読み取り専用の運用では`TASKEN_MCP_READ_ONLY=1`を設定してください。

入口ごとの計測（回数・時間・大きさ・失敗の種類。内容は残しません。1つの要求は1行で、名前は`POST /mcp:<道具名>`や`GET /health`の形。Tasken 自身の部品が使う全権 token の要求は数えません）は、PCでは`npm run stats -- --days=7`、NASでは MCP HTTP の`GET /api/stats?days=7`をclient tokenで呼んで読めます。

MCPを経由しないローカルの道具には、Coreの全権tokenではなくクライアント別の読み取り専用tokenを発行できます（[外部AI連携ガイド](./docs/external-ai-integration.md#読み取り専用のローカルクライアント)）。

AI Readyは事前許可であり、自動実行の予約ではありません。外部AIを普段どおり開き、依頼文を貼り付けるかAI Readyの確認を頼みます。TaskenからCLIを直接起動する機能はありません。実stdioと一時DBを通す検証は [AI collaboration E2E](./docs/ai-collaboration-e2e.md) を参照してください。

書き込みtoolに`dry_run: true`を付けると、保存せずに検証だけを行い、本送信した場合の結果と対象の版の食い違いを返します。受領IDを失った場合は`tasken.list_proposals`で自分の`source_session`などから探し直せます。

送ったProposalのその後は`tasken.get_proposal_status`へ受領IDを渡すと確認できます。未採用かどうか、採用でどのEntityができたかを返すため、同じ内容を再送する必要はありません。応答は接続中のnodeが持つ正本だけを表し、別端末への配送とそちらでの採否は確認しません。採用で新しく作られたEntityには、どのProposalから生まれたかを示す`accepted_from_proposal_id`が保存されます。

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
`research-desk.sqlite`を保存します。通常起動の30秒後には、Settingsで指定した保存先へ
このデータベースの写し（`tasken-auto-<日時>-<id>.sqlite`）を自動作成し、既定5世代をローテーション保持します。
写しは圧縮しないので、1世代がデータベースと同じ大きさ（2026-11時点で約490MB）になります。
保存先・有効/無効・世代数はSettingsの「詳細」で変更でき、同じ場所から今すぐ作成できます。
2026-11より前の版が作った`tasken-auto-*.zip`は世代に数えず、自動では消しません。
節目の状態を残すときは、「今すぐ作成」でできた写しを別の場所へコピーしておきます。
手動のWorkspace Snapshot（ZIP）は、今のデータ量では読み込みの上限（1ファイル10MB・全体50MB）を超えるため、戻す手段にしません。

### 自動バックアップから戻す

写しは同期の状態や設定まで含めた正本そのものなので、ファイルを差し替えて戻します。

1. Taskenを終了する（トレイに残っていればトレイのメニューから終了）。
2. `%APPDATA%\tasken`の`research-desk.sqlite`と、あれば`research-desk.sqlite-wal`・`research-desk.sqlite-shm`を、別のフォルダへ移す（消さない）。
3. 戻したい`Backups\tasken-auto-<日時>-<id>.sqlite`を、`%APPDATA%\tasken\research-desk.sqlite`という名前でコピーする。
4. Taskenを起動する。

- 2と3の間にTaskenを起動しない。空のデータベースが作られる（自動バックアップは空の作業台では作らないので、世代は消えない）。
- `-wal`を残したまま差し替えない。古いWALが写しに当てられて壊れる。
- 端末間同期を使っている場合、差し替えると同期の通し番号が写しの時点へ巻き戻り、それより後に共有フォルダへ出た差分と重なって、他の端末（NASのreplica）へ届かなくなることがある。写しの設定のまま起動直後に同期が始まる。差し替える前に、どう戻すかを決めておく。

複数端末で継続利用する場合は、主端末のSettingsで「端末間同期」の共有フォルダを設定し、
空のTaskenを起動した別端末で同じフォルダを選びます。
SQLiteファイルそのものは共有せず、端末別の変更差分だけを交換します。
詳細は [`docs/shared-folder-sync.md`](./docs/shared-folder-sync.md) を参照してください。

NASの開始専用権限は`task.start_work`です。本人の個人業務のAI Ready Taskだけを対象にし、`create-only`とは独立して有効化します。開始にはUUIDの`work_attempt_id`も必須です。同じ要求の再送はversionを含む内容を保持し、返却されたTaskが現在も同じ作業単位・実行者のin_progressであることを確認してください。設定・撤回と報告採用の境界は[開始専用権限](docs/ai-task-start.md)を参照してください。

## 主な画面

- 今日: テーマの現在地、近いマイルストーン、次のタスク、最近のメモ
- ToDo: 未完了、Inbox、期限超過、日程未確定の整理
- Timeline: テーマ横断の長期ガントとマイルストーン一覧
- Themes / Notes（URL・コメントを含む）/ Waiting
- Context / Agent連携: MCP・Context Preview / Pack、外部AgentからのProposal差分確認、JSON / YAML / Markdownの書き出し
- 自動バックアップ: 起動後に正本データベースの写しを作り、確かめてから世代を入れ替える
- Theme Status / Plan Revision / 情報源管理 / Settings
- Knowledge / Context Graph / MCP: 既存Knowledge・Relationの診断、read-only context、Preview必須のSafe Write Proposal。Context GraphとAI ContextはKnowledge画面の手動整理に依存しない

## 使い始める流れ

1. `Themes` で担当テーマを作り、`今日` でテーマの現在地を記録します。
2. 思いついた内容は左下の `クイック記録` から Inbox に入れます。
3. `ToDo` の Inbox フィルターで内容を具体化し、期限・Theme・状態を整えます。Excel等の表は `表から追加` でプレビューしてから取り込めます。
4. `Timeline` で長期予定を調整します。バー移動・リサイズ、依存線、計画進捗と実進捗の差分を示すイナズマ線を利用できます。
5. 会議・実験・AI壁打ちは `Notes`、成果物は `Links`、外部待ちは `Waiting` に残します。
6. 週次レビューやAIへの相談時は `AI Import / Export` で範囲と形式を選んでコピーします。
7. `Settings` の「詳細」で自動バックアップの保存先と最新結果を確認します。節目では「今すぐ作成」でできた写しを別の場所へコピーします。

開発時の作業・検証は [AGENTS.md](./AGENTS.md)、設計・保存の境界は [設計・データ契約](./docs/engineering-contracts.md)、未完了の作業は [GitHub Issues](https://github.com/mryk814/tasuken/issues) を参照してください。
Knowledge ModelとAI/MCP連携の次期方針は [`knowledge-mcp-policy.md`](./docs/knowledge-mcp-policy.md) を参照してください。
AIへ渡す概要・鮮度・根拠・出典の共通契約は [`ai-metadata-contract.md`](./docs/ai-metadata-contract.md) を参照してください。

接続ごとのツール選択と作業報告の移行方法は[MCPのツール選択と軽量化](docs/mcp-toolsets.md)を参照してください。汎用クライアントは`TASKEN_MCP_TOOLSETS=core`で6ツールに絞れます。
