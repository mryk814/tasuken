# tasuken 用語辞書（Glossary）

ユーザーの短い指示を正しい画面・エンティティに対応づけるための辞書。会話で画面や要素が曖昧なとき、まずここで解釈してから作業する。ユーザーの呼び方は揺れる（下表「別称」）ので、コード上の名称と突き合わせること。エンティティ追加・改名時はこのファイルも同じ変更で更新する。

## 画面（ページ）

| 画面 | ファイル | ユーザーの別称・文脈 |
|---|---|---|
| Today | `TodayPage.tsx` | 「今日」。今日やるタスク＋当日の予定。進行中の期間タスクとは区別される |
| ToDo | `TodoPage.tsx` | タスク一覧。Themeカラーの識別性の話題が出る場所 |
| Inbox整理 | `InboxPage.tsx` | 「Inbox」「インボックス」。クイック記録の行き先。ここで種類とThemeを付けて各所へ接続する |
| Timeline | `TimelinePage.tsx` | 「ガントチャート」「ガント」。左表＝実施事項/計画、右＝タイムライン描画 |
| Themes / Theme詳細 | `ThemesPage.tsx` / `ThemePage.tsx` | 「テーマ」。研究テーマ単位。識別子（社内で一意の記号）を別途持つ |
| Notes | `NotesPage.tsx` | 「ノート」「メモ」。表示種別は Note / Resource / Report / Prompt の4つ。Markdown編集・プレビュー・Document Publish（Markdown正本 / PDF固定表示）の話題はここ。Resource は外部URL＋見ながら書くメモ（body_markdown）。見出し番号（`heading_numbers` + 開始階層 `heading_number_start`、既定は h2から）は Note 文書ごと。ONなら編集/Preview/PDFに番号、Markdownファイル出力には含めない |
| Knowledge | `KnowledgePage.tsx` | 「ナレッジ」。グラフ表示あり。Note=素材置き場、Knowledge=構造化された知見、と責務を分ける |
| Chat Refs | `ChatRefsPage.tsx` | 「チャットリンク」「チャット履歴」。サイドバー表記は英語 Chat Refs。外部AIチャットのURL整理 |
| Artifacts | `ArtifactsPage.tsx` | 「Artifact」「添付ファイル」。UI表記は英語 Artifacts / Artifact を追加。AI/調査でできたExcel・画像・PDF・Markdown等の実ファイル一覧。追加はChat/Task/Note/Theme詳細から |
| Waiting | `WaitingPage.tsx` | 「待ち」。依頼して返答待ちのもの |
| Import/Export | `ImportExportPage.tsx` | 「AI Import」。検証→プレビュー→採用の取り込み導線 |

## エンティティと状態

ラベル正本: `src/renderer/src/features/workspace/domain-model/labels.ts`

| エンティティ | ユーザーの呼び方 | 状態値 |
|---|---|---|
| Theme (Project) | テーマ | 構想 / 進行中 / 保留 / 終了 |
| CaptureEntry | クイック記録、Inboxのやつ | 未整理 / 整理済み / アーカイブ |
| Task | タスク | 未着手 / 進行中 / 待ち / 確認待ち / 完了 / 中止 |
| Waiting | 待ち | 待ち / 受領 / 中止 |
| PlanNode | **「実施事項」= 親を持たない計画ノード（旧称「大項目」）**、「計画」「計画ノード」= その内訳 | 計画中 / 進行中 / 完了 / 中止。type: フェーズ / マイルストーン / 成果物 |
| Note | ノート、メモ。旧 memo/artifact/learning 等も Note 種別に畳む | note_type: note / report / prompt（旧値は表示上 Note または Prompt） |
| Resource | 外部URL・参照資料。Notes 内の Resource フィルタ。Chat参照とは別 | body_markdown でリンク横メモ可 |
| KnowledgeNode / KnowledgeEdge | ナレッジ、つながり | — |
| Reference / ChatRef | チャットリンク、リンク | — |
| Artifact | 添付ファイル、成果物（旧称） | —。source_type: Chat参照 / タスク / メモ / 報告 / Theme。ファイル実体はSettingsの「Artifact保存先」配下（年/月フォルダ）にコピー保存 |

## 頻出の UI 部品・機能語

| 語 | 意味 |
|---|---|
| ドロワー | 右側の詳細兼編集パネル。「行クリック→詳細→編集」の既定導線。自動保存が期待される |
| クイック記録 | Ctrl+Shift+N（Inbox行き）/ Alt+N。今日のタスク直行の別ショートカットの話題もある |
| イナズマ線 | Timelineの進捗折れ線。状態（未着手/進行中/完了）から到達度を導いて描く |
| テーマチップス | Themeカラー付きの小さなタグ表示。ユーザー評価が高く、他所への展開候補 |
| マイルストーンレーン | Themeヘッダー直下の節目専用行。タスク行にダイヤを散らさない |
| 左表 | Timelineの左側テーブル（実施事項/計画の一覧）。「Timeline上」と言われたら右の描画側 |

## 注意（過去に誤読が起きた点）

- 「Timeline左表」と「Timeline上（の計画ノード）」は別物。位置を明示されないときは直前の話題から判断し、1行で解釈を添える。
- 「実施事項」という語は Theme ではなく PlanNode の親レベルを指す。
- 「期限」というデータは廃止済み（予定終了と同義になった）。復活させない。
- 削除と状態変更（完了・アーカイブ）は別操作。確認ダイアログよりundoトースト。
