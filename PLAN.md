# Research Desk 実装ロードマップ

`docs/SPEC.md` 12章以降を、既存データを維持しながら段階導入する。

## 実装済み

- Electron IPC + SQLiteを正本とするWorkspace保存層
- 旧 `localStorage` データの初回移行
- UUID、論理削除、端末ID、source、version、schema migration
- Theme、Item、Note、Link、Personの統一CRUD
- task、waiting、phase、milestoneのItem統合
- ToDoサマリー、Quick Add、完了履歴、一括状態・Theme変更
- Split Gantt、階層表示、縮尺切替、今日線、バー移動・リサイズ
- 日程未確定、仮予定、確定予定、粗い日程表現
- Plan Revisionと任意の変更理由
- Workspace Snapshot ZIPのExport、差分プレビュー、競合選択、Import
- Saved View、Milestone Map、Theme Status Update、SourceRecord
- Custom Field定義・値、ItemRelation、ItemDependency、LogEntry
- AI Importプレビュー（Item / Note / Link）、範囲指定付きAI向けMarkdown / YAML / JSON Export
- イナズマ線（計画進捗と実進捗の差分）
- RelationのItem / Note / Link / SourceRecord対象選択
- CSV / TSV貼り付けプレビュー、一括日程シフト

## 継続改善

1. Critical Path、Workload / Capacity、グラフビューは実データで必要性を確認して設計する。
2. Spreadsheet Modeの列マッピング保存や行単位エラー修正は、日常運用で必要性を確認して追加する。

## 検証

- `npm run build`
- `npm run smoke:desktop`
- `npm run package`

データ移行、保存、再起動後の復元、Snapshot Importはすべて失敗時に既存データを残す。
