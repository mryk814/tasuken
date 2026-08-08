# 開発用Workspaceデータ

## 正本

開発中の具体例確認には、材料インフォマティクス研究者「佐伯 遥」が2026年6月から利用している想定のWorkspaceを使う。
主研究はTa置換LLZO固体電解質の組成・焼成条件探索、副研究は再生Al-Mg-Si合金の熱処理最適化である。

データは `%APPDATA%\\tasken\\research-desk.sqlite` に保存され、通常のTaskenと同じSQLite Repositoryを通して読み書きされる。
投入時には既存WorkspaceのSnapshotとSQLite本体を `%APPDATA%\\tasken\\development-data-backups` へ退避する。

## 再作成

```powershell
npm.cmd run workspace:materials-demo
```

実行すると、現在のローカルWorkspaceを退避してから、決定的なIDを持つデモWorkspaceへ完全に置き換える。
何度実行しても同じ人物・研究テーマ・Entity間の関係が再現される。

実データを触らず検証だけ行う場合は、任意の一時DBを指定する。

```powershell
$env:ELECTRON_RUN_AS_NODE = "1"
.\\node_modules\\.bin\\electron.cmd scripts/seed-materials-informatics-workspace.mjs --target "$env:TEMP\\tasken-mi-check.sqlite"
Remove-Item Env:ELECTRON_RUN_AS_NODE
```

## 見てほしい具体例

- Today: 当日、期限超過、期間内に一度、期間中継続、待ち、Focus Sessionの履歴
- ToDo: 全状態、優先度、チェックリスト、繰り返し、親子Task、保存済みビュー
- Timeline: 実施事項、Phase、Milestone、Deliverable、依存、baselineとactual
- Themes: 現在地、週報、研究Note、成果物、進行中と完了の混在
- Inbox: 未整理、整理済み、URL、Markdown、手書き起点
- Notes: Note / Resource / Report / Prompt、数式、表、Mermaid、Callout、Daily Scratchpad
- Knowledge: Question / Evidence / Claim / Decision / Insightと支持・反証・依存関係
- Chat Refs / Artifacts: 外部AIとの検討履歴、ローカルCSV/JSON/Markdown、URL参照
- Sketch: ベイズ最適化ループと焼結プロセスの手描き風図解
- AI Inbox: Pendingと採用済みProposal

画面確認用なので、すべてを成功状態に揃えない。
未整理・待ち・確認待ち・期限超過・リンク切れ・低信頼の仮説も意図的に残す。
