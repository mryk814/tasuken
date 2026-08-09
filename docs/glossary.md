# tasuken 用語辞書（Glossary）

ユーザーの短い指示を正しい画面・エンティティに対応づけるための辞書。会話で画面や要素が曖昧なとき、まずここで解釈してから作業する。ユーザーの呼び方は揺れる（下表「別称」）ので、コード上の名称と突き合わせること。エンティティ追加・改名時はこのファイルも同じ変更で更新する。

## 画面（ページ）

画面名・用途説明・アイコン・ナビゲーション・利用可能条件の正本は `src/renderer/src/pages/routes.ts` の `ROUTE_DEFINITIONS`。Sidebar・ページ見出し・Command Paletteはすべてここを参照するので、画面名を変えるときはこの表と `ROUTE_DEFINITIONS` を同じ変更で直す。用途説明は見出しへ混ぜず `description`（infoから開く）に置く。

| 画面 | ファイル | ユーザーの別称・文脈 |
|---|---|---|
| Today | `TodayPage.tsx` | 「今日」。今日やるタスク＋当日の予定。日付範囲を持つTaskは意味ごとに「期間内に対応」「継続中」へ分けて出す（#309） |
| ToDo | `TodoPage.tsx` | タスク一覧。Themeカラーの識別性の話題が出る場所 |
| Inbox | `InboxPage.tsx` | 「Inbox」「インボックス」「Inbox整理」（旧見出し）。クイック記録の行き先。ここで種類とThemeを付けて各所へ接続する |
| Timeline | `TimelinePage.tsx` | 「ガントチャート」「ガント」。左表＝実施事項/計画、右＝タイムライン描画 |
| Themes / Theme詳細 | `ThemesPage.tsx` / `ThemePage.tsx` | 「テーマ」。研究テーマ単位。識別子（社内で一意の記号）を別途持つ |
| Notes | `NotesPage.tsx` | 「ノート」「メモ」。表示種別は Note / Resource / Report / Prompt の4つ。初期種別と作成日・更新日の並び順はNotes画面の設定として保存する。Markdown編集・プレビュー・Markdown出力 / PDF固定表示の話題はここ。Resource は外部URL＋見ながら書くメモ（body_markdown）。見出し番号（`heading_numbers` + `heading_number_levels`、旧 `heading_number_start` は互換読み込み、既定はh2〜h4）はNote文書ごと。ONなら編集/Preview/PDFに番号、Markdownファイル出力には含めない。軽量 Callout は `> [!INSIGHT]`（表示名「MEMO」、オレンジ系、Edit/Preview/PDF）。見出しインデックスは文書中央右の線だけのフロートをホバーすると一覧 |
| Sketch | `SketchLibraryPage.tsx` / `SketchPage.tsx` | 「手書き」「キャンバス」「GoodNotesみたいなやつ」。SidebarのKnowledge配下に独立した棚と専用編集面を持つ。編集可能なペン軌跡・図形・文字・画像を正本として持ち、Note / Markdown / PNG / SVG / AI向けコピーへ派生させる |
| Knowledge | `KnowledgePage.tsx` | 「ナレッジ」。既存Knowledge / Relationの閲覧・棚卸し・Data Health確認を行うExperimental / Diagnostic画面。通常のKnowledge作成導線は持たず、Context Graph / Backlink / Provenance / Data Healthは共有projectionとして独立する |
| Chat Refs | `ChatRefsPage.tsx` | 「チャットリンク」「チャット履歴」「チャット参照」（旧見出し）。Sidebarとページ見出しはどちらも Chat Refs。外部AIチャットのURL整理。詳細の「この会話から生まれたもの」でTask / Note / Artifact / 続きConversationを最大2段階辿り、Task / Noteを作ると`derived_from`を自動記録する |
| Artifacts | `ArtifactsPage.tsx` | 「Artifact」「添付ファイル」。UI表記は英語 Artifacts / Artifact を追加。AI/調査でできたExcel・画像・PDF・Markdown等の実ファイル一覧。追加はChat/Task/Note/Theme詳細から。NoteのMarkdown/PDF書き出しはChat Refを主な出所、元Noteを追跡情報として持てる。Artifact一覧の「来歴」から元Note / Conversationまで逆向きに辿れる |
| Waiting | `WaitingPage.tsx` | 「待ち」。依頼して返答待ちのもの。Sidebar には出さず、Today の待ちリスト（近いマイルストーン横）から確認。詳細編集はドロワー |
| AI Inbox | `ImportExportPage.tsx` | 「AI Import」「AI連携」（旧称）。外部AIから届いたProposalを検証→プレビュー→採用する安全な取り込み導線 |
| Note AI | `NoteAiDialog.tsx` / `AiProposalPanel.tsx` | Noteの「AI編集」「選択範囲をAIで編集」。OpenAIの返答を直接保存せずPending Proposalへ入れ、差分hunkを選んで採用する |
| AI Proposal | `AiProposalPanel.tsx` / `McpProposalInboxService` | 内蔵LLM・MCP・手動Importから届く安全な書き込み候補。Note / Knowledge / Sketch / Artifactの正式保存前にPreviewする |

## エンティティと状態

ラベル正本: `src/renderer/src/features/workspace/domain-model/labels.ts`

| エンティティ | ユーザーの呼び方 | 状態値 |
|---|---|---|
| Theme (Project) | テーマ | 構想 / 進行中 / 保留 / 終了。`system_kind: personal_default` の「個人業務」は常設の既定Themeで、削除・アーカイブできず一覧の先頭に固定される（#282）。判定は表示名ではなく `shared/personalTheme.mjs` の `isPersonalDefaultTheme` で行う。`project_id` 未設定は `resolveThemeId` でこのThemeへ解決し、既存データは書き換えない |
| CaptureEntry | クイック記録、Inboxのやつ。文字・Markdown・URL・ファイル・画像・手書きを分類せず受け取る正本 | 未整理 / 整理済み / アーカイブ |
| Task | タスク | 未着手 / 進行中 / 待ち / 確認待ち / 完了 / 中止 |
| Waiting | 待ち | 待ち / 受領 / 中止 |
| Schedule | 予定。Task / Waiting / PlanNode へ日付を付ける | `date_kind`: point / deadline / range / unknown。範囲（開始日 < 終了日）は `range_semantics` で意味を分ける（#309）。判定の正本は `domain-model/scheduleSemantics.ts` の `getScheduleKind` |
| PlanNode | **「実施事項」= 親を持たない計画ノード（旧称「大項目」）**、「計画」「計画ノード」= その内訳 | 計画中 / 進行中 / 完了 / 中止。type: フェーズ / マイルストーン / 成果物 |
| Note | ノート、メモ。旧 memo/artifact/learning 等も Note 種別に畳む | note_type: note / report / prompt（旧値は表示上 Note または Prompt） |
| Sketch | 手書き、下書き、図解。Noteに埋めた画像そのものではなく編集可能な元データ | `document.schema_version: 1`。複数ページと stroke / highlighter / shape / arrow / text / image を保持 |
| Resource | 外部URL・参照資料。Notes 内の Resource フィルタ。Chat参照とは別 | body_markdown でリンク横メモ可 |
| KnowledgeNode / KnowledgeEdge | ナレッジ、つながり | — |
| Reference / ChatRef | チャットリンク、リンク | — |
| Artifact | 添付ファイル、成果物（旧称） | —。source_type: Chat参照 / タスク / メモ / 報告 / Theme。`storage_mode`: `managed`（コピー）/ `linked`（URL・パス参照）。Note書き出しをChat Refへ紐づける場合は `source_type=chat_ref` と `source_id` を主な出所、`origin_note_id` を元Noteとして保持し、どちらからも同じArtifactへ辿る。Theme 保存ルート配下は `Artifacts/` / `Notes/`（Markdown既定）/ `Exports/`（PDF候補）。未設定 Theme は `Themes/{code\|id}/…`、Theme なしは `Inbox/`（#146）。方針正本は `docs/artifact-redesign.md` |

## 頻出の UI 部品・機能語

| 語 | 意味 |
|---|---|
| ドロワー | 右側の詳細兼編集パネル。「行クリック→詳細→編集」の既定導線。自動保存が期待される |
| クイック記録 | Ctrl+Shift+N（Inbox行き）。Ctrl+Enterで記録して閉じ、Ctrl+Shift+Enterで連続記録。Themeは任意 |
| 整理済み | InboxでTask / Note / Markdown / Resource / Artifactへ整理した履歴とアーカイブ。整理先を再び開ける |
| 選択範囲から切り出す | NotesのEditで選んだMarkdownを、元本文を変更せずTaskまたはNoteとして作成する。作成先から元Note・見出し・引用を辿れる |
| Command Palette | `Ctrl+Shift+K`またはタイトルバーから開く共通操作入口。コマンドとTask / Note / Theme / Resource / Artifactを横断検索する |
| Context Pack | Theme内で明示選択したTask / Note / Resource / Artifactと依頼文を、AIへ渡すMarkdown Snapshotとしてコピー・保存する |
| Draft Workspace | AI原稿をSource Draft、通常Note本文をWorking Draftとして保持し、Source / Edit / Diff / 軽量Snapshotを切り替えるNotes内の作業面 |
| Daily Scratchpad | 日付ごとに一枚だけ作る分類前の作業メモ。TodayまたはCommand Paletteから開き、通常Noteとして自動保存する。Activity Logへ全文を自動転記しない |
| Focus Session | Taskを中心に関連Note / Artifact / Resource、作業中Scratchpad、経過時間を一面へ集める単一active session。終了時にTask状態・Note化・次Task・Activity要約を整理する |
| Ink Capture | Inbox上部の「手書きで記録」。CaptureEntryを入口の履歴として残し、同時に新しいSketchを開く |
| 期間内に一度 | 日付範囲の意味のひとつ（`range_semantics: once_within_window`）。「8/10〜8/15の間に住民票を取る」のように、期間内のどこかで一回やれば終わるTask。開始日は着手してよい日、終了日は遅くとも終える日。期間中は毎日「今日やること」へ出さず、Todayの「期間内に対応」から拾う |
| 期間中継続 | 日付範囲のもうひとつの意味（`range_semantics: ongoing`）。「8月中は問い合わせ対応を続ける」のように、期間中ずっとactiveなTask。今日の実施記録（今日取り組んだ）とTask全体の完了（継続を終了）を分ける。終了日が来ただけでは自動完了せず、完了 / 期間を延長 / そのまま継続を選べる |
| 期間未分類 | #309より前に作った、意味を決めていない日付範囲Task。黙って分類せず、#95の表示規則（終了日当日に今日やることへ出す）をそのまま保つ。編集画面で意味を選ぶと分類される |
| イナズマ線 | Timelineの進捗折れ線。状態（未着手/進行中/完了）から到達度を導いて描く |
| テーマチップス | Themeカラー付きの小さなタグ表示。ユーザー評価が高く、他所への展開候補 |
| マイルストーンレーン | Themeヘッダー直下の節目専用行。タスク行にダイヤを散らさない |
| 左表 | Timelineの左側テーブル（実施事項/計画の一覧）。「Timeline上」と言われたら右の描画側 |

## 注意（過去に誤読が起きた点）

- 「Timeline左表」と「Timeline上（の計画ノード）」は別物。位置を明示されないときは直前の話題から判断し、1行で解釈を添える。
- 「実施事項」という語は Theme ではなく PlanNode の親レベルを指す。
- 「期限」というデータは廃止済み（予定終了と同義になった）。復活させない。
- 削除と状態変更（完了・アーカイブ）は別操作。確認ダイアログよりundoトースト。
