# Tasken のAI協働 contract（Agent Desk / Feed の基盤）

Issue #594 の成果物。Agent Desk（#593 Epic、#595–#602）と Feed（#604）を実装する前に、**新しく作るもの / 再利用するもの / 作らないもの**を固定する。

本書は実装Issueではない。後続Issueが二重正本・重複surfaceを作らないための設計上の正本であり、UI実装・schema migration・MCP tool追加・agent runtime実装は含まない。

調査対象は `main@acc65ab1`、アプリ版 `0.1.65`。外部事例の確認日は 2026-09-20。

関連: [Product Atlas](./product-atlas.md)（製品像）／[AI collaboration E2E contract](./ai-collaboration-e2e.md)（検証の正本）／[外部AI連携](./external-ai-integration.md)（利用者向け手順）／[用語辞書](./glossary.md)／[設計計画](./issue-design-plan-2026-09-20.md)（実装順序）／[6製品の画面比較](./research/feed-six-product-comparison.md)（§2の証拠）。

---

## 1. 現行の canonical / projection map

### 1.1 canonical entity と field

「Taskは一つ、AI作業はTaskへぶら下がる」の実装上の根拠。

| 概念                   | 正本                                                             | 実装                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Task                   | `Task`                                                           | `src/shared/contracts/task/model.ts`                                                                                                      |
| 起案者                 | `Task.requester`                                                 | `"self" \| "human" \| "ai_agent" \| "external" \| "unknown"`                                                                              |
| 委任先                 | `Task.intended_executor` / `Task.executor_identity`              | `"self" \| "human" \| "ai_agent" \| "unassigned"` ＋ 自由文字列200                                                                        |
| TaskのAI作業状態       | `Task.work_state`                                                | `"not_delegated" \| "ready_for_agent" \| "in_progress" \| "reported_done" \| "needs_human_review" \| "accepted" \| "blocked" \| "failed"` |
| 作業の開始・報告時刻   | `Task.work_started_at` / `work_reported_at` / `work_review_note` | 直近値のみ。履歴はReceipt側                                                                                                               |
| AIの成果・進捗報告     | `work_receipt` entity（append-only）                             | `src/shared/entityRegistry.mjs`、`src/main/repositories/domain.mjs`                                                                       |
| 書き込み候補           | `ai_proposal` entity                                             | `status: "pending" \| "accepted" \| "rejected" \| "partially_accepted" \| "quarantined"`、`received_at`                                   |
| 外部AIとの一続きの作業 | `AgentSession`                                                   | `docs/agent-session-provenance.md`                                                                                                        |
| いつ何が起きたか       | `change_event` / Activity                                        | —                                                                                                                                         |

`Task.work_state` は canonical だが粒度が粗い。**画面が出す「回答待ち」「成果確認待ち」等はこの enum ではなく projection とする**（§6.3）。

### 1.2 既存 projection

| projection                                              | 実装                                                | 何を返すか                                                                                                                                           |
| ------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `taskWorkInboxGroups(proposals)`                        | `src/shared/contracts/task/taskWorkProposal.ts`     | Task単位またはProposal単位のgroup。`actionable = pending.length > 0`                                                                                 |
| `taskWorkPeriods(tasks, proposals, receipts)`           | 同上                                                | `executor_kind === "ai_agent"` のReceiptから作る作業期間。`status: active \| completed \| blocked`、`review_status: pending \| accepted \| recorded` |
| `taskWorkReportsCoveredBy(done, proposals)`             | 同上                                                | `report_done` が畳み込む先行報告                                                                                                                     |
| `compareLatestWorkReceipts` / `selectLatestWorkReceipt` | `src/shared/contracts/task/workReceiptSelection.ts` | `reportedAt` desc → `version` desc → `id` asc                                                                                                        |
| Agent Session projection                                | `src/renderer/.../agentSessionProjection.ts`        | `presentation: "attention" \| "content" \| "record"`                                                                                                 |
| Today selector                                          | `src/shared/todayTasks.mjs`                         | bucket `today \| overdue \| due \| ongoing \| execution_window`                                                                                      |

projection の利用箇所は、nav badge（`shell.tsx`）、AI Inbox（`AiProposalPanel.tsx`）、Activity（`ActivityLogPanel.tsx`）、Debrief（`taskenDebrief.ts`）、MCP（`agentWorkspaceQueryService.ts`）。**要対応を返す共通 read model はまだ無い。**

### 1.3 route / surface

`src/renderer/src/pages/routes.ts` の `ROUTE_DEFINITIONS` が名称・アイコン・ナビゲーションの正本。

| 表示名   | route ID   | 実体                                             | 現在の位置づけ            |
| -------- | ---------- | ------------------------------------------------ | ------------------------- |
| Today    | `today`    | `TodayPage.tsx`                                  | Core daily                |
| ToDo     | `todo`     | `TodoPage.tsx`（alias `todo-done`）              | Core daily                |
| Waiting  | `waiting`  | `WaitingPage.tsx`                                | Sidebar非表示、Todayから  |
| Inbox    | `inbox`    | `InboxPage.tsx`（alias `micro-memos`）           | Core daily                |
| AI Inbox | `ai-io`    | `ImportExportPage.tsx`（alias `proposal-inbox`） | Supporting / Experimental |
| Timeline | `timeline` | `TimelinePage.tsx`                               | Supporting                |
| Debrief  | `debrief`  | `DebriefPage.tsx`                                | Supporting                |
| Settings | `settings` | `SettingsPage.tsx`                               | Tool                      |

注意すべき現行の事実：

- 表示名はすでに `AI Inbox`。`AI IO` は過去の呼称（`docs/responsive-layout.md` に残る）。
- `proposal-inbox` は alias であり独立routeではない。**架空の `/ai-inbox` を移行元として実装しない。**
- **experimental / hidden / feature-flag の機構は存在しない。** `RouteDefinition` の gate は `availability: "always" | "requires-active-theme"` だけで、`routeAvailability()` に呼び出し元も無い。
- `activity` というrouteは**存在しない**。Activityは `ActivityLogPanel` であり独立画面ではない。
- `ai-io` への通知ナビゲーションは無い。到着はstoreへpushされ、routeは変わらない。

---

## 2. 外部事例比較

「taskをtimeline化する系譜」「work activityをfeed化する系譜」「inboxをdecision queue化する系譜」の3系統を、同じ軸で並べる。

### 2.1 比較軸

```text
item anatomy / actor representation / information density / action count
open-detail behavior / reply behavior / snooze-dismiss behavior
ranking-ordering / read-unread-acknowledged / mobile gesture / end-of-feed behavior
```

### 2.2 比較表

証拠の強さを明示する。`V` = 本調査で取得した一次資料が画面を説明している、`S` = 二次資料またはベンダーの販売文言、`?` = 未確認（推測で埋めていない）。

**公式スクリーンショットは開けなかったため、どの項目も実画像からは確認していない。** 出所URL・製品ごとの詳細・残った未確認項目は [feed-six-product-comparison.md](./research/feed-six-product-comparison.md) に残す。

| 軸                   | X mobile                                                      | Ambra                                             | Linear Pulse                                              | Asana Inbox                                                                  | Wrike Activity (mobile)                        | Universal Inbox                                            |
| -------------------- | ------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------- |
| item anatomy         | ?                                                             | Task本文＋本文内`@mention`＋`#tag`（順序不明）`S` | 更新全文。field順は未記載 `V`                             | 実行者＋更新＋新着comment数bubble＋未読dot `V`                               | 変更種別（変更前status併記）＋実行者＋日時 `V` | Source → Type → Title → Indicators → Timestamp `V`         |
| actor representation | ?                                                             | 本文内の`@mention` `S`                            | ?                                                         | 通知内に実行者名。avatarは未記載 `V`                                         | 更新内に実行者名 `V`                           | 「Indicators」field内の名前 `V`                            |
| information density  | ?                                                             | ?                                                 | 低い。全文表示で行ではない `V`                            | 展開/圧縮の切替、thread圧縮 `V`                                              | ?                                              | 狭い左paneに1行5 field `V`                                 |
| 常時表示の操作数     | ?                                                             | ?                                                 | mobileは2（comment / emoji reaction）`V`                  | hoverで3（follow-up task / 未読に戻す / archive）`V`                         | 判明分はreplyの1 `V`                           | 3（delete / snooze / unsubscribe）＋key経由のtask操作3 `V` |
| open / detail        | 本文tapでpost詳細へpush `V`                                   | 本文をその場で編集 `S`                            | その場で読む。Inboxは専用viewへpush `V`                   | **右のtask詳細paneを常設** `V`                                               | 対象Taskへpush `V`                             | **右preview pane** ＋その場でthread展開 `V`                |
| 一覧を離れずにreply  | ?                                                             | ?                                                 | 可（updateへcomment）`V`                                  | 可（inboxからreply・sticker）`V`                                             | 可（新着messageへreply）`V`                    | **不可**。`Enter`でsource toolを開く `V`                   |
| snooze / dismiss     | snoozeなし。bookmarkは保存。「Happening now」は非表示化可 `V` | ?                                                 | Pulseには記載なし（Inboxにはsnooze＋delete）`V`           | **archiveのみ**。snoozeなし。一覧末尾にArchive all `V`                       | なし。**左swipeで除外** `V`                    | **snooze**＋delete＋unsubscribe（各key）`V`                |
| ranking / ordering   | For you / Following、両方説明あり `V`                         | chronological（新しい順）`S`                      | **For me / Popular / Recent**、各々説明 `V`               | Newest First / **Relevance** を選択可 `V`                                    | ?                                              | ?                                                          |
| read / acknowledged  | ?                                                             | ?                                                 | sidebar badge（"only when badged"）。item単位は未記載 `V` | 全モデルあり（blue dot・sidebarのorange dot・未読のみfilter・未読に戻す）`V` | **開くと全件既読**。行単位の未読は無い `V`     | ?                                                          |
| mobile gesture       | カスタムswipe（like/reply）`S`                                | drag&dropで優先度 `S`                             | ?                                                         | 左swipe → More sheet（3操作、非破壊）`V`                                     | 左swipe＝除外（破壊的）`V`                     | 記載なし（keyboard中心）`V`                                |
| end of feed          | ?                                                             | ?                                                 | ?                                                         | 「caught up」なし。**一覧末尾がArchive allボタン** `V`                       | ?                                              | ?                                                          |

証拠の分布に偏りがある。**画面を実際に説明している現行の一次資料があるのは Wrike Activity と Universal Inbox だけ。** Asana はWaybackの2023–2024年版、Linear Pulse はrankingとreplyは明確だが行の構造とdismissは未記載、X は公式helpがtimelineを部分的にしか説明せず、**Ambra は画面を説明する資料が取得できずアプリの最終更新も2022年7月**のため、参考の重みを持たせない。

この表から得た設計上の含意：

1. **ack-on-open（Wrike）はper-row未読（Asana）より実装が軽い。** どちらも出荷されている。Taskenは「開いた」を既読の意味に使わず、§6.3のとおり操作の種類で分ける。
2. **Asana と Universal Inbox は独立に「常設の右pane」を選んでいる。** inline展開ではなく、一覧を消さないため。Taskenの右詳細1スロットと一致する。
3. **本当のsnoozeを持つのは Universal Inbox だけ。** Asanaはarchive、Wrikeはswipeで代用している。Taskenの「後で見る」は差別化要素であり、既存の模倣ではない。
4. **6製品のどれも「すべて確認済み」という終端状態を明記していない。** Asanaが最も近く、一覧末尾を操作（Archive all）にしている。Taskenの「今確認する更新は以上です」は未検証の設計判断である。
5. **破壊的なswipeを唯一持つのは Wrike。** Taskenの「すべて可視buttonかメニューで実行できる」方針を維持する根拠になる。

Tasken が採らない差分：

- `Popular`（人気順）は採らない。attentionの基準は人間側に置く（`Needs You` → 「対応待ち」）。
- 閲覧で既読にはしない。「開いた」「回答した」「採用した」を別の意味として扱う。
- 除外（dismiss）は未解決件数を減らさない。「後で見る」は先送りであり解決ではない。
- swipeの即時destructive actionは置かない。すべて可視buttonかメニューから実行できるようにする。
- 終わりのあるFeedにする。無限スクロールを前提にしない。

### 2.3 借りる点 / 借りない点

`V`/`S` の別は §2.2 と同じ。**X の行構造と密度、Ambra の画面は一次資料で確認できていない**ため、この2件は「借りる」と決めた設計意図であり、確認済みの事実ではない。

| 出所            | 借りる点                                                                                                  | Taskenへの翻訳                                     | 借りない点                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| X timeline      | 1 item = 小さい情報単位、本文近傍のactor・時刻、行区切り中心の密度、開いて深掘り（いずれも設計意図）      | Feedの行構造と読み幅                               | 推薦順位、反応数、人物の人格化、無限スクロール                              |
| Ambra           | 入力欄の軽さ、task本文近傍のmetadata（`S`。timeline自体の画面は未確認）                                   | 行内metadata、軽いCapture                          | `@`/`#` をcanonical modelにすること、chronological timelineを正本にすること |
| Linear Pulse    | `For me` というpersonal relevance lens、`Recent` との分離、開いた時にrankingを説明する `V`                | 「今見る」と「最近の更新」の分離                   | `Popular`（人気順）                                                         |
| Asana Inbox     | InboxとMy Tasksの分離、密度の切替、行から直接action、**常設の右詳細pane** `V`                             | FeedとTodayの責務分離、右詳細1スロット             | Inbox専用のTask DB、行単位の未読モデル                                      |
| Wrike Activity  | 一覧を管理せず更新を読んで反応する体験、その場でreply `V`                                                 | 携帯時の短い返答                                   | swipeの即時destructive action、ack-on-open                                  |
| Universal Inbox | snooze / convert / link / complete を一つのqueueで行う、feed itemとcanonical Taskの分離、keyboard処理 `V` | 「後で見る」「Taskを開く」、FeedItemとTaskのID分離 | 一覧から返信できない構造（`Enter`で外部toolへ出る）                         |

---

## 3. Tasken が採用する pattern

1. **Taskは一つ。AI作業はTaskへぶら下がる。** 委任・再委任・再実行でTask IDを変えない。
2. **Feedはprojectionであり正本ではない。** 既存のTask / Receipt / Proposal / Schedule / Activityから導出し、独立したTask DB・本文・永続entityを先に作らない。
3. **判断は一つの単位で数える。** 同じTaskの独立した質問と変更案は2件、同じ報告から生じたreview-readyとProposalは1件。
4. **人間の返答と AIの報告を区別する。** 同じ記録の器を使っても、種別を型で分ける。
5. **AIの完了報告だけでTaskを完了しない。** 採用と完了は別Command、別操作。
6. **判断の操作は文言ではなく型付きaction IDで選ぶ。** 画面から届いた要旨やラベルで対象を更新しない。
7. **終わりのあるFeed。** 「今確認する更新は以上です」で閉じる。滞在時間を最適化しない。
8. **一つの判断に一つの詳細。** FeedとAgent Deskは同じ要対応項目と同じ詳細コンポーネントを開く。

## 4. 採用しない pattern と理由

| 採用しない                                                    | 理由                                                                                                                    |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `AgentRun` テーブルの新設                                     | 既存のTask / Receipt / Proposal / Sessionから大半を導出できる。本当に不足する識別子だけを#595でversioned contractへ足す |
| `queued / working / review_ready / done` の canonical enum 化 | 既存 `work_state` と二重の正本になる。表示状態はprojectionに留める                                                      |
| `Needs You` をUI名称にすること                                | 内部語。表示は「対応待ち」。日本語UIで英語のattention語を混ぜない                                                       |
| 架空のactor人格（「過去の自分」等）の大量生成                 | 出所の混同を招く。`自分の記録`＋記録日で足りる                                                                          |
| 「仕事が止まっている」等の推測の断定表示                      | 「3日間更新がない」は観測事実だが、停滞は推測。AI提案にはラベルと根拠を付ける                                           |
| AIの自己申告による優先順位・Task priorityの変更               | rankingは説明可能に保つ。人が設定した期限を優先する                                                                     |
| 汎用チャットへの `Discuss` 接続                               | 範囲の定まらない対話面を増やさない。既存の外部AI依頼導線か限定Proposal作成まで動かないボタンを置かない                  |
| 実行中の相手の安易な再割当                                    | 現行コードが作業中・確認中の再割当を拒否している。この制約を維持する                                                    |
| `Review` / `Done` を全行に常時表示                            | 日付操作の誤解を先に減らす。Task行の詳細から既存完了Commandへ到達できればよい                                           |
| Feed専用の永続entity・rankingモデル                           | #604の非ゴール。projectionで表現できるか先に確認する                                                                    |

---

## 5. 用語

### 5.1 決定した用語

| 語                          | 種別                   | 意味                                                                                                               | 実装上の対応                                         |
| --------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| **Agent Desk**              | 表示名（採用）         | 任せた仕事がどこまで進み、何を待っているかを確認する画面。見出しは「対応待ち」「作業中」「開始待ち」「最近の結果」 | route ID は初回 `ai-io` を保持する（§6.4）           |
| **Feed**                    | 表示名（experimental） | 前回から何が変わり、今どこに反応するかを読む任意入口。既定画面にはしない                                           | 新規route。起動時の既定routeを変更しない             |
| **Today**                   | 表示名（既存）         | 今日、自分が何を実行するかを選ぶ場所                                                                               | route `today` を変更しない                           |
| **Task**                    | canonical              | 仕事の唯一の正本。ownerは常に利用者                                                                                | `Task` entity                                        |
| **起案者 / Requester**      | canonical              | Taskを起案した主体。人間の責任主体とは同一視しない                                                                 | `Task.requester`                                     |
| **委任先 / Delegate**       | canonical              | 現在このTaskの作業を任せている相手                                                                                 | `Task.intended_executor` ＋ `Task.executor_identity` |
| **実行者 / Executor**       | canonical              | 実際に作業し報告した相手                                                                                           | `work_receipt.executor_kind` / `executor_label`      |
| **作業単位 / work attempt** | 新規（#595で固定）     | Taskへの**一回の委任**を識別する単位。再委任・明示的な再依頼で更新する                                             | 新規ID。§6.2                                         |
| **質問 / request**          | 新規（#597で固定）     | agentから人間へ届いた、一回の回答または判断の要求。再送でIDを変えない                                              | 新規ID。§6.2                                         |
| **要対応 / attention**      | projection             | 未解決の質問・レビュー・Proposalから導出した判断待ち。正本のentityではない                                         | 共通read model。§6.3                                 |
| **対応待ち**                | 表示名                 | 要対応のうち、人間の操作が必要なもの                                                                               | —                                                    |
| **成果確認**                | 表示名                 | agentの報告を人が確認する状態                                                                                      | `work_state: needs_human_review` 相当のprojection    |
| **受入れ / 採用**           | 操作名                 | 報告を正式Receiptとして保存すること。Taskは完了しない                                                              | `AcceptTaskWork`（`complete_task: false`）           |
| **採用してTaskを完了**      | 操作名                 | 採用範囲を保存し、人が明示したTask完了を実行する                                                                   | `AcceptTaskWork`（`complete_task: true`）            |
| **委任を解除**              | 操作名                 | 実行中の相手への委任を終えること。外部プロセスの停止は保証しない                                                   | #602で明示Command化                                  |
| **後で見る**                | 操作名                 | この質問や報告の再表示日時を選ぶ。Taskの日程は変えない                                                             | `AttentionDisposition`（§6.2）                       |
| **扱う日を変更**            | 操作名                 | Taskの `today_date` を変える。締切（Scheduleの終了日）は変えない                                                   | `today_date` のみ更新                                |
| **締切を変更**              | 操作名                 | Scheduleの終了日を変える                                                                                           | `Schedule.end_date`                                  |
| **自分**                    | 表示上の主体           | 単一利用者workspaceの前提。多人数owner管理を増やさない                                                             | 新fieldを作らない                                    |
| **AI Ready**                | 既存                   | `intended_executor=ai_agent` かつ `work_state=ready_for_agent`。事前許可                                           | 変更しない                                           |
| **Agent Session**           | 既存                   | 外部AI clientと利用者が一続きに行った作業のprovenance。作業単位とは別概念                                          | `AgentSession` entity                                |

**「作業単位」と「Agent Session」は別物。** 一つのSessionが複数Taskを扱いうるし、一つのTaskに複数の作業単位が生じうる。両者を同じIDで扱わない。

### 5.2 使わない語

| 使わない語                      | 代わりに                          | 理由                                                                         |
| ------------------------------- | --------------------------------- | ---------------------------------------------------------------------------- |
| Needs You                       | 対応待ち                          | 内部語を通常画面へ出さない                                                   |
| Agent Run                       | 作業単位（work attempt）          | Taskenが外部プロセスを監視・制御していると誤解させる                         |
| review_ready / queued / working | 成果確認待ち / 開始待ち / 作業中  | 内部enumを表示名にしない                                                     |
| Assignee                        | 委任先 / 任せる相手               | `intended_executor` と重複する別概念を作らない                               |
| Owner（利用者以外）             | 起案者 / 委任先                   | 多人数owner管理を持ち込まない                                                |
| 最近完了                        | 最近の結果                        | Taskを完了しなかった受入れも含むため                                         |
| 停滞している（断定）            | 「3日間更新がない」＋AI提案ラベル | 推測を事実として表示しない                                                   |
| AI IO                           | Agent Desk                        | 過去の呼称。route ID `ai-io` は内部識別子としてのみ残す                      |
| AI Inbox（今後の新規UI）        | Agent Desk                        | 同じ画面へ複数名を付けない。既存の採用済みProposal・履歴はAgent Desk内へ移す |

---

## 6. 後続Issueが依存する contract summary

### 6.1 既存データから導出できるもの

| 概念                 | 導出元                                          | 扱い                               |
| -------------------- | ----------------------------------------------- | ---------------------------------- |
| 現在の実行担当       | `intended_executor` ＋ `executor_identity`      | provider名・model名と分離する      |
| 届いた報告という事実 | pendingな `task_work` Proposal                  | 正式採用とは別                     |
| 採用した作業記録     | `WorkReceipt`                                   | 成果・検証・来歴の保存先           |
| 作業期間             | `work_receipt` ＋ Proposal                      | `taskWorkPeriods` を拡張せず再利用 |
| 重複排除             | `idempotency_key`（内容digestで競合検出）       | 既存の仕組みを維持                 |
| 発信時刻と受信時刻   | `reported_at`（agent）／`received_at`（server） | 既に別々に保存されている           |
| session来歴          | `source_session`                                | 既存                               |
| 委任済み・開始未観測 | 委任の保存 ＋ Receipt無し                       | 表示状態として導出                 |

### 6.2 canonical 追加が必要なもの

既存modelでは表現できないと確認したものだけ。#595 / #597 で versioned contract へ加える。**新しいテーブルは初手にしない。**

| 追加                                  | 何のため                                          | 無いと何が壊れるか                                                           |
| ------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------- |
| 作業単位ID                            | Taskへの一回の委任を識別する                      | 同じsession内の再依頼と、旧作業からの遅着報告を区別できない                  |
| 質問ID                                | 一回の回答または判断を識別する                    | 再送・他端末の回答で、どの質問への回答か確定できない                         |
| 報告順序                              | 作業単位内の順番                                  | 発信側の時計だけでcurrent stateを選ぶことになる                              |
| 人間の返答の型付き記録                | 回答本文・選択肢ID・作業単位IDをappend-onlyに残す | 自由記述の `work_review_note` と `runtime_metadata` のJSONが実質の正本になる |
| 操作の冪等キー（回答・採用・Handoff） | 再送で同じ結果を返す                              | 応答喪失時の再送が二重保存になる                                             |
| `AttentionDisposition`                | 既読・見送り・再表示日時の保存                    | DesktopとAndroidで保留を共有できない（fixtureではメモリ内のみ）              |

`AttentionDisposition` は**製品接続時のみ**。source参照と再表示日時だけを持ち、Feed本文や要対応状態を複製しない。**「後で見る」を `Task.today_date` へ保存しない。**

Taskの `version` は通常編集でも変わるため、作業単位IDの代用品にしない。ID無しの旧報告は履歴とProposalで読めるようにし、再割当後のcurrent状態を確定する証拠には使わない。

### 6.3 状態の導出表

以下は **read model** であり、この名前をTaskの新enumとして保存しない。

| 条件                             | 表示                   | 要対応                      | Taskの完了 |
| -------------------------------- | ---------------------- | --------------------------- | ---------- |
| 委任済み、開始未観測             | 開始待ち               | なし                        | 変更しない |
| 現在の作業単位の開始が保存済み   | 作業中                 | なし                        | 変更しない |
| 未解決の入力要求が届いた         | 回答待ち               | 質問1件                     | 変更しない |
| 未解決の選択・許可要求が届いた   | 判断待ち               | 判断1件                     | 変更しない |
| 返答の保存が成功、再開未観測     | 回答済み／再開待ち     | 対象の質問は除外            | 変更しない |
| 現在の作業単位の成果報告が届いた | 成果確認待ち           | 報告に紐づく判断1件         | 変更しない |
| 人が報告を採用、Task完了は未選択 | 受入れ済み／Taskは継続 | 解決した判断を除外          | 変更しない |
| 人が採用とTask完了を明示         | 受入れ済み／Task完了   | 解決した判断を除外          | 完了       |
| 人が修正内容を保存               | 修正依頼済み／再開待ち | 対象レビューは解決          | 変更しない |
| 別作業単位からの遅い報告         | 過去の作業報告         | currentの判断を復活させない | 変更しない |
| sourceを取得できない             | 更新を確認できません   | 最後の確定状態を保持        | 変更しない |

`working` は稼働監視ではない。**経過時間だけで成功・停止・失敗へ自動変更しない。**

### 6.4 責務の境界

| 境界                              | 責務                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| shared contract                   | 要対応の種類、source locator、操作可能条件、回答と作業単位のschema                                      |
| MainのTask/Proposal application層 | 状態の導出、source version照合、冪等処理、回答、採用と差戻し                                            |
| Repository                        | 現在参照と履歴を同一transactionへ保存。必要なmigrationとExport対応                                      |
| MCP                               | 既存append/report toolを中心に不足分だけ型付き拡張。許可範囲（start_task_work以外はProposalのみ）を維持 |
| Desktop storeとUI                 | read modelを表示し、型で指定されたCommandへ接続。日本語文言から挙動を判定しない                         |
| Mobile Gateway                    | Desktopと同じ意味のJSON read modelを返す                                                                |
| Android                           | DTOとキャッシュを表示。独自の状態導出を増やさず、共有golden fixtureで意味を合わせる                     |

KotlinからTypeScriptを直接参照する前提にしない。状態導出はMainに置き、Androidはその結果をキャッシュする。

**route IDの扱い（#600）**: Agent Desk は初回 `ai-io` のroute IDと表示・内容を段階的に統合する。`agent-desk` という新IDが必要になった場合のみ、`ai-io` と `proposal-inbox` のalias、選択Proposal ID、保存タブ、通知からの遷移を**同じ変更で**移す。要対応件数のbadgeはAgent Deskへ集約し、Feedと二重に付けない。

---

## 7. 未確認・未検証の一覧

#594 の受け入れ基準のうち、実画面の確認を要する部分は未達。**現時点の設計を実画面調査済みとして扱わない。**

| 未確認               | 内容                                                                                                                                                                                                          | 確認方法                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 外部6系統の実画面    | §2.2 は取得できた一次資料の記述に基づく。**公式スクリーンショットは開けず、行の構造・操作数・返信・保留・既読・終端表示を実画像で確認していない**                                                             | 各製品へログインして横並び確認し、§2.2 を実測で埋める                                           |
| 証拠の薄い2製品      | X の公式helpはtimelineを部分的にしか説明しない。Ambra は画面を説明する資料が取得できず、App Storeの最終更新も2022年7月                                                                                        | X は実機、Ambra は導入して確認する。どちらも結論の根拠にしない                                  |
| 各製品の未確認項目   | X の行構造・操作集合・未読・終端、Linear Pulse の行field・actor・dismiss・swipe、Asana の現行UI（2023–2024のWaybackで代替）、Wrike の行構造・操作数・順序・終端、Universal Inbox の順序・未読・mobile版の有無 | 詳細は [feed-six-product-comparison.md](./research/feed-six-product-comparison.md) の未確認list |
| 全6製品の視覚密度    | 1画面に何行入るかは、スクリーンショットを開けなかったため確認できていない                                                                                                                                     | 実機またはログイン後の画面で確認する                                                            |
| 視覚文法の固定       | 「Tasken固有のvisual grammarを1枚に固定してからfixture 5種を実装する」（#604コメント）は未実施                                                                                                                | #604前半（C単位）の冒頭で行う                                                                   |
| AgentBridge の同一性 | Issue本文のAgentBridgeはURL未指定で、同名製品が複数ある                                                                                                                                                       | URLを固定してから比較対象に加える                                                               |
| Android の実機挙動   | `AiInboxSection` の分類はコードで確認したが、S23 / Foldの実画面は未確認                                                                                                                                       | #601 の受け入れ時                                                                               |
| NAS の現在の稼働     | 2026-09-12の記録は現時点の成功として流用しない                                                                                                                                                                | #588 の N1                                                                                      |
| 利用計測基盤         | #453はClosedだが本文は未実装。#453の完成を前提にしない                                                                                                                                                        | Feedの実験は手動の観察記録で開始する                                                            |

また、`AgentSession` の `presentation: "attention"` は**Agent Session用**であり、Task work の要対応ではない。両者を同じ「要対応」として合算しない。

---

## 8. #594 受け入れ基準の対応

| 基準                                                            | 対応                                                                 |
| --------------------------------------------------------------- | -------------------------------------------------------------------- |
| 既存のAI協働Entity / projection / routeを一覧化できる           | §1                                                                   |
| 外部事例を同じ比較軸で整理できる                                | §2（実画面は§7で未確認と明記）                                       |
| 「Taskは一つ、AI作業はTaskへぶら下がる」を既存modelと照合できる | §1.1、§3-1                                                           |
| 新しいcanonical Entityが要る箇所と導出できる箇所を分けられる    | §6.1 / §6.2                                                          |
| ownerとdelegateの意味を決められる                               | §5.1                                                                 |
| Needs Youのsource候補を列挙できる                               | §6.3（未解決の質問・判断・成果報告・Proposal）                       |
| AI IO / AI Inbox / Agent Deskの重複解消方針がある               | §5.2、§6.4                                                           |
| 後続Issueの用語が互いに矛盾しない                               | §5、[用語辞書](./glossary.md)                                        |
| Product Atlas / docsへ結果を残す                                | 本書＋[Product Atlas](./product-atlas.md)＋[用語辞書](./glossary.md) |

「特に決めること」への回答：

| 問い                                                                                        | 決定                                                                                                |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `Agent Desk` を正式名称にするか                                                             | **する。** 表示名は `Agent Desk`、内部route IDは初回 `ai-io` を保持                                 |
| `Agent Run / Session / Delegation` のどれをUI/domain用語にするか                            | **`作業単位（work attempt）`。** `Agent Session` は既存の別概念として維持し、`Agent Run` は使わない |
| `Owner / Assignee / Requester / Delegate / Executor` の意味                                 | §5.1。Ownerは新概念を作らず「自分」、Assigneeは使わない                                             |
| `Needs You` をUI名称にするか                                                                | **しない。** 表示は「対応待ち」                                                                     |
| queued / working / blocked / review-ready / doneをcanonical stateにするかprojectionにするか | **projection。** 既存 `work_state` を維持し、新enumを保存しない                                     |
| AI IO / AI Inbox / Agent Deskの最終責務                                                     | **Agent Deskへ一本化。** `AI Inbox` の表示名と `ai-io` route IDは統合時に同時に扱う                 |
