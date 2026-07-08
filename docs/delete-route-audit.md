# Entity deletion route audit

主要Entityの削除導線を、2026-06-26時点のWorkspace UIで監査した記録。

| Entity | 一覧から削除 | 詳細から削除 | 編集から削除 | Undo | 備考 |
|---|---|---|---|---|---|
| Theme / Project | Themes一覧の削除 | - | 編集Drawerの削除 | あり | 関連件数を確認してから論理削除 |
| Task | 詳細Drawerへ到達して削除 | あり | 編集Drawerの削除 | あり | 完了とは別に削除可能 |
| Waiting | 詳細Drawerへ到達して削除 | あり | 編集Drawerの削除 | あり | 受領/中止とは別に削除可能 |
| PlanNode / 実施事項 | Timeline行の削除 | あり | 編集Drawerの削除 | あり | Timeline削除は関連日程/依存を復元対象に含める |
| Schedule | 親Entity削除に追随 | - | - | 親EntityのUndoで復元 | 単独編集対象ではなく親Entityの予定として扱う |
| Note | Notes/詳細から削除 | あり | 編集Drawerの削除 | あり | コメントはNoteの一部として復元 |
| Resource / Link / チャット参照 | チャット参照棚の行削除 | あり | 編集Drawerの削除 | あり | 通常Resourceと同じdelete policy |
| CaptureEntry / Inbox項目 | Inbox行編集または付箋カード削除 | あり | 編集Drawerの削除 | あり | Micro MemoはInboxから分離 |
| KnowledgeNode | Knowledge詳細から削除 | あり | 編集Drawerの削除 | あり | 参照関係は既存delete policyに従う |
| KnowledgeEdge | 編集Drawerから削除 | - | 編集Drawerの削除 | あり | 関係編集画面の危険操作として表示 |
| Reference | 編集Drawerから削除 | - | 編集Drawerの削除 | あり | 汎用参照Entityとして論理削除 |
| TaskDependency / PlanDependency | Timeline依存線はDeleteで削除 | - | 編集Drawerの削除 | あり | PlanDependencyはTimeline操作でもUndo可能 |
| StatusUpdate | 編集Drawerから削除 | - | 編集Drawerの削除 | あり | 「現在地」記録の削除 |
| SourceRecord | 編集Drawerから削除 | - | 編集Drawerの削除 | あり | 外部入力元の論理削除 |
| FieldDefinition / FieldValue | 編集Drawerから削除 | - | 編集Drawerの削除 | あり | 追加項目の管理経路 |
| AI Proposal | 編集Drawerから削除 | Proposal Inboxで却下 | 編集Drawerの削除 | あり | 却下は状態変更、削除は実データ削除 |
| Artifact | 親詳細Drawerの成果物一覧から削除 | 同左（Artifact単独の詳細画面は持たない） | - | あり | 親（Task/Note/ChatRef/Theme）削除時はcascade論理削除・restoreで復元。ファイル実体は物理削除しない |

共通方針:

- 削除は完了、採用、受領、アーカイブなどの状態変更とは分ける。
- 既存Entityの編集Drawer下部にDanger Zoneを表示し、削除後はToastからUndoできる。
- 関連Entityの扱いはMain Processの既存delete policyに従う。
