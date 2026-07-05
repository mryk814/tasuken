# Tasken Input Flow Map

作成日: 2026-07-01

## 見方

このメモは画面の見た目監査ではなく、Taskenで「入力したものがどこへ入り、どこで整理され、どこで再利用されるか」を整理したもの。

確認した主な入口:

- `WorkspaceApp.tsx`: load/save/drawer/navigation の中枢
- `workspaceStore.ts` / `workspaceApi.ts` / `registerIpc.ts`: 正式保存経路
- `TodayPage.tsx`, `InboxPage.tsx`, `TodoPage.tsx`, `WaitingPage.tsx`, `TimelinePage.tsx`
- `NotesPage.tsx`, `PromptsPage.tsx`, `ChatRefsPage.tsx`, `KnowledgePage.tsx`
- `ImportExportPage.tsx`, `ProposalInboxPage.tsx`, `SettingsPage.tsx`
- `docs/application-architecture-blueprint.md`, `docs/PLAN.md`, `docs/knowledge-mcp-policy.md`, `docs/chat-reference-design.md`

## 全体の結論

Taskenの現在の導線は、かなり自然な三段構えになっている。

```text
粗く捕まえる
  -> Inbox / CaptureEntry
  -> Task / Waiting / Note / Resource / PlanNodeへ整理
  -> Today / Theme / Timeline / Notes / Knowledge / AI Exportで再利用
```

この骨格は「まず雑に残し、後から構造化する」というアプリの思想と合っている。

一方で、利用者の感覚として迷いやすいのは、入口が多いことそのものではなく、同じ実体が画面ごとに違う名前で見えていること。

- `capture_entry`: Quick Capture / Inbox / 付箋メモ / やったこと記録
- `note`: メモ / Markdown文書 / 報告書 / プロンプト / AI壁打ち素材
- `resource`: リソース / リンク / チャット参照
- `plan_node`: 実施事項 / 計画 / 期間ブロック / マイルストーン
- `ai_proposal`: Proposal Inbox / AI Import候補 / MCP write提案の受け皿

ここを「どの画面名にするか」ではなく、「何をしたいときの入口か」で揃えると、統一感はかなり出る。

## 保存経路

正式な保存経路は一つにまとまっている。

```text
React page / Drawer
  -> saveEntity / saveEntities
  -> Zustand workspaceStore
  -> renderer workspaceApi
  -> window.api
  -> Preload
  -> IPC registerIpc
  -> Workspace Repository / Workspace Service
  -> SQLite / Snapshot / Clipboard / OS
```

現時点でRendererがSQLiteやOSを直接触る経路はなく、正本はWorkspace EntityとしてSQLite側にある。

## 正本になる主なデータ

| 正本 | 何を表すか | 主な入口 | 主な再利用先 |
| --- | --- | --- | --- |
| `theme` / `project` | 研究テーマ・業務テーマ | Themes / Sidebar | 全画面の分類、Theme Home |
| `capture_entry` | 雑な記録・未整理メモ・付箋 | Quick Capture / Inbox / Micro Memo | Inbox整理、Activity Log |
| `task` + `schedule` | 今日やる作業・ToDo | Today / ToDo / Inbox整理 / AI Import | Today, ToDo, Theme Home, AI Export |
| `waiting` + `schedule` | 誰か・何か待ち | Waiting / Inbox整理 / AI Import | Today, Waiting, Theme Home, AI Export |
| `plan_node` + `schedule` | 期間計画・実施事項・マイルストーン | Timeline / Inbox or AI Import | Timeline, Todayの近いマイルストーン, Theme Home |
| `note` | 作業ログ・文書・報告書・プロンプト | Notes / Theme Home / Inbox整理 / AI Import | Notes, Prompts, Report, Knowledge化, AI Export |
| `resource` | URL・資料・外部AIチャット | ChatRefs / Notes / Inbox整理 / AI Import | Notes, ChatRefs, Context Pane, Knowledge化 |
| `status_update` | Themeの現在地 | Today / Theme Home / Context Pane | Today, Theme Home, AI Export |
| `knowledge_node` / `knowledge_edge` | 問い・主張・根拠・決定 | Knowledge / NotesからKnowledge化 / AI Import / Proposal | Knowledge, MCP, AI Export |
| `source_record` / `import_batch` | 取り込み元・出所 | AI Import | Provenance, Import履歴 |
| `ai_proposal` | AIからの保存前提案 | Proposal Inbox / 将来MCP write | Preview後に各Entityへ採用 |
| `reference` | Entity間の関係 | Inbox link整理 / Drawer | 関連表示、将来の文脈強化 |
| `change_event` / `plan_revision` | 履歴・変更理由 | save operations / Repository | Activity Log, 予定変更の追跡 |

## 入力別の流れ

### 1. 思いつきを雑に残す

入口:

- Quick Capture
- `Alt+N`
- Inboxの「記録を追加」
- Micro Memoの「追加」

保存先:

- 通常の雑記録: `capture_entry` with `state=untriaged`, `kind=inbox`
- 付箋: `capture_entry` with `kind=micro_memo`
- Quick Captureの今日タスク系: `task` + `schedule`

次に行く場所:

- `Inbox整理`: Task / Waiting / Note / Resource へ変換
- `Micro Memo`: そのまま短期メモとして残る
- `Activity Log`: 当日分のCaptureとして出力に含まれる

評価:

- 「まず雑に入れる」導線として合っている。
- ただし `capture_entry` が Inbox と付箋の両方を担るため、ユーザー向けには「未整理の記録」と「一時メモ」の違いを明確にした方がよい。

### 2. 今日やる作業を入れる

入口:

- Todayの「今日のタスクを追加」
- ToDoの「タスクを追加」
- Theme Homeの「タスクを追加」
- Inbox整理で出力先をTask
- Quick CaptureのToday Task系

保存先:

- `task`
- 日付があれば `schedule`

次に行く場所:

- Today
- ToDo
- Theme Home
- Activity Log
- AI Export

評価:

- 正本は一貫している。
- 入口ごとの意味は少し違う。Todayは「今日やる」、ToDoは「タスク全体」、Theme Homeは「このThemeのタスク」。この違いをUI上で補助すると迷いにくい。

### 3. 外部待ちを入れる

入口:

- Waitingの「待ちを追加」
- Inbox整理で出力先をWaiting
- AI Import

保存先:

- `waiting`
- 期限があれば `schedule`

次に行く場所:

- Todayの「期限が近い待ち」
- Waiting
- Theme Home
- Context Pane
- AI Export

評価:

- かなり筋がよい。`task.state=waiting` ではなく `waiting` として別正本にしているので、研究開発の「自分の作業ではないが止まっているもの」に合う。
- ToDo側にも `TaskState.waiting` が存在するので、ユーザー向けには「作業が待ち状態」と「外部待ち」の使い分けを固定した方がよい。

### 4. 長期計画・マイルストーンを入れる

入口:

- Timelineの「実施事項を追加」
- Timelineの「期間を追加」
- Gantt上のドラッグ作成
- `plan_node` Drawer
- AI Importの `kind=milestone` / `kind=period`

保存先:

- `plan_node`
- `schedule`
- 依存は `plan_dependency`

次に行く場所:

- Timeline
- Todayの「近いマイルストーン」
- Theme Homeの「近いマイルストーン」
- AI Export

評価:

- 研究テーマの長期線を表す場所として成立している。
- 「実施事項」「計画」「期間ブロック」「マイルストーン」が少し近すぎる。ユーザー語彙としては、`実施事項` を親、`計画` を期間、`マイルストーン` を点、に固定するとよい。
- `MilestonePage.tsx` は存在するが現在のルート/Sidebarから見えていない。不要なら撤去、必要なら `Timeline` のサブビューとして統合がよい。

### 5. メモ・文書・報告書を書く

入口:

- Notesの「メモを書く」
- Notesの「Markdown文書」
- Theme Homeの「報告書を追加」
- Inbox整理で出力先をMemo
- AI Importの `notes`

保存先:

- `note`
- Markdown文書/報告書/プロンプトは `note_type`, `content_format`, `properties_json` で区別

次に行く場所:

- Notes & Resources
- Theme Homeの最近のメモ/報告書
- Prompts
- AI Export
- Word出力
- Knowledge化

評価:

- 「素材置き場としてのNote」はアプリ思想と合っている。
- ただし Notes画面が `Note + Resource + 文書 + 報告書 + Prompt` の複合画面なので、見た目の統一よりも分類の言葉で迷いやすい。
- Promptsを独立画面にしたのはよいが、Notes側にもPromptフィルタがあるため、重複感は少しある。

### 6. 外部AIチャット・資料リンクを残す

入口:

- ChatRefsの「追加」
- Notesの「リソースを追加」
- Inboxの「チャットリンクを追加」
- Inbox整理で出力先をLink
- AI Importの `links`

保存先:

- `resource`
- チャット参照は `reference_status`, `chat_group`, `link_type`, `parent_resource_id` で表現

次に行く場所:

- ChatRefs
- Notes & Resources
- Context Pane
- Theme Homeの関連情報
- Knowledge化
- AI Export

評価:

- `resource` を正本にして、チャット参照はその特殊な見方にしたのは自然。
- ただしUI上は「リソース」「リンク」「チャット参照」が並ぶので、ユーザー語彙としては「資料・リンク」を上位語にして、その中に「チャット参照」を置く方がわかりやすい。

### 7. Themeの現在地を残す

入口:

- Todayの「最近の現在地 > 記録する」
- Theme Homeの「現在地を記録」
- Context Paneの「現在地 > 記録」

保存先:

- `status_update`

次に行く場所:

- Today
- Theme Home
- Context Pane
- Activity Log
- AI Export

評価:

- Taskenの価値である「現在地を失わない」に直結している。
- 現在地は独立画面ではなく、Today/Theme/Contextに露出しているのがよい。
- ただし「記録する」が各所にあり、どの粒度の現在地を書くべきかは少し曖昧。週次/報告前/リスク変化時など、運用語彙を固定するとよい。

### 8. 知識・判断材料へ昇格する

入口:

- Knowledgeの「問いを追加」
- Notesの「Knowledge化」
- Knowledge Healthの整理キュー
- AI Import / Proposal Inbox

保存先:

- `knowledge_node`
- `knowledge_edge`

次に行く場所:

- Knowledge Graph/List
- Knowledge Health
- MCP read-only context
- AI Export

評価:

- `Note: 自由な素材`, `Knowledge: 後から判断に使う部品` の分離は非常に良い。
- 入口で細かい分類を強制せず、あとからKnowledge化する設計も合っている。
- 追加するとしたら、KnowledgeからTask/Waitingへ落とす導線。問いや決定から「次アクション」を作れると閉じる。

### 9. 外部AIとの往復

入口:

- AI Import / Exportのコピー
- AI Import / ExportのJSON貼り付け
- Proposal InboxのPending追加

保存先:

- Import時は `source_record` + 対象Entity + `import_batch`
- Proposal時はまず `ai_proposal`; Preview/採用で対象Entityへ

次に行く場所:

- Task / Waiting / PlanNode / Note / Resource / Knowledge
- SourceRecord経由の出所確認

評価:

- `直接保存しない -> Preview -> 採用` という安全設計は良い。
- ただし `AI Import / Export` と `Proposal Inbox` の違いは、現状の画面名だけではわかりにくい。
- 整理すると、`AI Import / Export` はユーザーが手動で貼る「手動往復」、`Proposal Inbox` は外部/MCP由来の「受信箱」と位置付けるのが自然。

### 10. バックアップ・持ち出し

入口:

- SettingsのWorkspace Snapshot
- Notes/ImportExportのWord出力
- 各一覧のコピー
- Activity Log出力

保存先/出力先:

- Snapshot ZIP
- Markdown
- Word
- Clipboard

評価:

- ローカルファーストの復旧導線として必要なものはある。
- 「どの情報を外へ持ち出すか」はかなり揃っている。逆に、導線名は `コピー`, `出力`, `Export`, `Publish`, `Snapshot` が混じるので、目的別に見せるとさらによい。

## 統一感の評価

### 合っているところ

- 正本はWorkspace Entityに集約されていて、保存経路が一つ。
- 作業の流れが `Today -> Inbox -> Theme/Timeline/Notes -> AI/Knowledge` として成立している。
- 雑入力をInboxに置き、あとから整理する思想が一貫している。
- NoteとKnowledgeの責務分離が明確。
- ImportはPreviewを挟むため、失敗時に既存データを壊しにくい。
- コピー/Export/Word/Snapshotなど、アプリ外へ持ち出す導線が多い。

### ズレやすいところ

1. **同じ正本に複数の顔がある**
   - `note` がメモ、文書、報告書、プロンプトを兼ねる。
   - `resource` が資料、リンク、チャット参照を兼ねる。
   - `capture_entry` がInboxと付箋を兼ねる。

2. **追加ボタンが多いが、保存先の説明が弱い**
   - Today/ToDo/Theme Home/Drawerの「タスクを追加」は同じ `task` へ行くが、利用文脈が違う。
   - ユーザーとしては「いまここで作るべきか、Inboxに投げるべきか」を迷いやすい。

3. **AI導線が二系統ある**
   - `AI Import / Export`: 手動コピー/貼り付け往復。
   - `Proposal Inbox`: AI/MCP由来の提案受信箱。
   - 機能は違うが、どちらも「AIが作った候補をPreviewして採用」なので、関係性を明示した方がよい。

4. **内部EntityがDrawerには存在するがIA上の位置が薄い**
   - `source_record`, `reference`, `field_definition` などは実装上必要だが、通常ユーザーの作業入口としては主役ではない。
   - 詳細内の補助セクションとして扱い、ナビ上に独立させない方が自然。

5. **予定変更履歴の見え方が弱い**
   - `change_event` / `plan_revision` は保存系に存在するが、ユーザーが「なぜズレたか」を読み返す画面はまだ薄い。
   - Timeline上の変更理由、Theme Homeの最近の変更、Activity Logへつなげると価値が出る。

6. **未到達/旧導線らしきものが残る**
   - `MilestonePage.tsx` は現在の `routes.ts` / `WorkspaceApp.tsx` からは到達できない。
   - 使うならTimeline配下へ統合、使わないなら撤去候補。

## 推奨する概念整理

画面名より先に、ユーザーの頭の中では以下の4モードに分けると自然。

```text
1. 捕まえる
   Quick Capture / Inbox / 付箋

2. 整える
   Inbox整理 / ToDo / Waiting / Timeline / Theme

3. 残す
   Notes / Resources / Reports / ChatRefs

4. 判断材料にする
   Knowledge / Prompts / AI Import / Proposal Inbox / Export
```

現在のSidebarは近い構造になっているが、ラベルは少し調整余地がある。

現在:

```text
今日の運用: Today / ToDo / Waiting
横断: Inbox整理 / 付箋メモ / Timeline
知識整理: Knowledge / Notes / Prompts / チャット参照
テーマ別: すべてのテーマ / 各Theme
ツール: Proposal Inbox / AI Import / Export / Settings
```

提案:

```text
今日の運用
  Today / ToDo / Waiting

整理・計画
  Inbox整理 / Timeline / 付箋メモ

記録・資料
  Notes / チャット参照 / Prompts

判断材料
  Knowledge / Proposal Inbox / AI Import / Export

テーマ別
  すべてのテーマ / 各Theme

設定・バックアップ
  Settings
```

もしくは、今の構造を維持するなら、`横断` を `整理・計画`、`知識整理` を `記録・判断` に変えるだけでも意味が通りやすい。

## 不足していると感じる導線

優先度順。

1. **Inbox整理後の行き先をもっと見せる**
   - すでに最近整理したものを開く導線はある。
   - さらに「これはTaskになり、Today/ToDoに出ます」のような短い行き先表示があると安心感が増す。

2. **Note/ResourceからKnowledgeへ昇格した後の戻り道**
   - Knowledge化はある。
   - Knowledge detailから元Note/Resourceへ戻る、または元素材を明示する表示を強めたい。

3. **Knowledge/StatusからTaskへ落とす導線**
   - 問い、決定、根拠を見たあと、次アクションを作る操作があると閉じる。
   - `Knowledge -> task`、`status_update -> task` があると、判断から作業へ戻せる。

4. **予定変更の読み返し**
   - Timeline操作は強い。
   - 「何をいつずらしたか」「なぜずらしたか」をTheme HomeまたはTimeline右側で見られると、研究活動の現在地ツールとして強くなる。

5. **AI ImportとProposal Inboxの関係説明**
   - `AI Import / Export`: 自分が貼り付ける。
   - `Proposal Inbox`: 外から届いた提案を確認する。
   - この区別を画面内に一行で置くだけで迷いが減る。

6. **資料・リンク・チャット参照の上位語**
   - `Resource` 正本はよい。
   - UI上は「資料・リンク」を上位語にし、その特殊ビューとして「チャット参照棚」を置くと自然。

7. **到達不能な画面の整理**
   - `MilestonePage` の扱いを決める。
   - Timelineのサブビューにするか、未使用として削除する。

## 入口のおすすめルール

迷ったときの運用ルールをアプリ内文言やREADMEに置くなら、これがよい。

| 入力したいもの | 入口 | 理由 |
| --- | --- | --- |
| まだ分類できない思いつき | Quick Capture / Inbox | まず失わない |
| 今日やる具体作業 | Today | 今日の予定に即反映される |
| 締切や一覧で管理する作業 | ToDo | Task + Scheduleとして管理できる |
| 誰か/何か待ち | Waiting | 待ち相手と次アクションを持てる |
| 長期の実施事項・期間 | Timeline | PlanNode + Scheduleとして俯瞰できる |
| 研究メモ・会議メモ・作業ログ | Notes | 後から検索/Knowledge化できる |
| 外部AIチャットURL | チャット参照 | Resourceとして残り、Theme別に見返せる |
| 判断に使う問い・根拠・決定 | Knowledge | AI/MCPに渡せる構造になる |
| 外部AIが作った候補 | AI Import / Proposal Inbox | Previewして安全に採用できる |
| テーマの週次現在地 | Theme Home / Today | Status Updateとして履歴に残る |

## まとめ

現状のTaskenは、データの正本と作業ループはかなり整理されている。

一番大きい軸はこれ。

```text
Inboxで捕まえる
  -> Task / Waiting / Note / Resource / Planへ整理する
  -> ThemeとTodayで現在地を見る
  -> NotesとKnowledgeで再利用する
  -> AI Export / Snapshotで持ち出す
```

不足は新機能というより、概念の看板と戻り道。

- 「この入力はどこへ行くのか」
- 「整理後どこで見えるのか」
- 「素材から判断材料へ、判断材料から次アクションへ戻れるのか」

この3点を揃えると、導線はかなり自分の感覚に寄るはず。
