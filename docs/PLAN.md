# Research Desk 実装ロードマップ

`docs/SPEC.md` 12章以降を、既存データを維持しながら段階導入する。

## 実装済み

- Electron IPC + SQLiteを正本とするWorkspace保存層
- 共通Entity validation、正規化、連番DB migration基盤
- 複数Entityを原子的に保存するtransaction IPC
- Entity参照整合性検証と、削除・Undo時の参照退避・復元
- 旧 `localStorage` データの初回移行
- UUID、論理削除、端末ID、source、version、schema migration
- Theme、Item、Note、Link、Personの統一CRUD
- task、waiting、phase、milestoneのItem統合
- ToDoサマリー、Quick Add、完了履歴、一括状態・Theme変更
- Split Gantt、階層表示、縮尺切替、今日線、バー移動・リサイズ
- 日程未確定、仮予定、確定予定、粗い日程表現
- Plan Revisionと任意の変更理由
- Workspace Snapshot ZIP v2のExport、論理削除情報、Plan Revision、差分プレビュー、競合選択、Import
- Saved View、Milestone Map、Theme Status Update、SourceRecord
- Custom Field定義・値、ItemRelation、ItemDependency、LogEntry
- AI Importプレビュー（Item / Note / Link）、範囲指定付きAI向けMarkdown / YAML / JSON Export
- イナズマ線（計画進捗と実進捗の差分）
- RelationのItem / Note / Link / SourceRecord対象選択
- CSV / TSV貼り付けプレビュー、一括日程シフト
- Itemのlevel（計画＝大きな線 / タスク＝細かい仕事）による粒度分離。kindから導出する後方互換（DB無改修・JSONブロブ保存）
- Timelineのテーマ別レーン化。既定は計画レベル（期間・マイルストーン）のみ表示し、「タスクを表示」トグルでタスクを親の下に従属表示
- サイドバーの横断（テーマ非依存）/ テーマ別（コンテキスト切替）/ ツールの3区分IA
- electron-viteによるMain / Preload / Renderer統合ビルド
- `src/main` / `src/preload` / `src/renderer` / `src/shared`へのアプリ構造移行
- TypeScript strictのshared契約、Main、Preload、Store、Renderer entry
- `window.api`を正本とするtyped IPCと入力検証
- Workspace Repository、Snapshot/OS Service、IPC登録の責任分割
- ZustandによるWorkspace正式データとUI状態の分離
- Tailwind CSS v4とdesign tokenの接続、Tabler Icons導入
- electron-builderによるNSIS installer + portable同時生成
- KnowledgeNode / KnowledgeRelation / AiProposalのWorkspace Entity追加
- Knowledge一覧、Noteからの手動構造化、Knowledge Relation作成
- AI Context ExportのKnowledge-aware Markdown section
- AI ImportプレビューのKnowledgeNode / KnowledgeRelation対応
- Knowledge Health Checkの簡易一覧
- Read-only MCP Server（search/list/context/health/export tools）

## 継続改善

1. [`desktop-app-standard.md`](./desktop-app-standard.md)を個人用Electronアプリの既定作法とする。
2. 互換維持のためfeature単位に残したJSXは、機能変更時にpage/component単位でTypeScript化する。
3. Critical Path、Workload / Capacity、グラフビューは実データで必要性を確認して設計する。
4. Spreadsheet Modeの列マッピング保存や行単位エラー修正は、日常運用で必要性を確認して追加する。

## 次期方針: Knowledge Model + AI/MCP連携

Taskenを「思考・知識・作業文脈をAIと共有できる個人用Thinking Graph」に拡張する。
詳細方針は[`knowledge-mcp-policy.md`](./knowledge-mcp-policy.md)を正本とする。

優先順は以下とする。

1. AI Knowledge Extractionのpreview drawerを追加し、Note本文からKnowledge候補を作る。
2. MCP writeは直接Entityを作らず、`ai_proposal`としてpreview inboxに入れる。
3. VS Code / Copilot / Cursor連携はMCP経由の薄い統合に限定する。

## 検証

- `npm run typecheck`
- `npm run build`
- `npm run smoke:desktop`
- `npm run smoke:model`
- `npm run package`

データ移行、保存、再起動後の復元、Snapshot Importはすべて失敗時に既存データを残す。
