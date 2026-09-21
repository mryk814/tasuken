# Agent work の実装契約（作業単位・質問・状態導出）

Issue #595 の成果物。`docs/agent-collaboration.md`（#594）が決めた用語と状態導出表を、実装できる形に固定する。

**Taskは一つ。AI作業はTaskへぶら下がる。** この文書はその境界を、既存データで足りる部分と足りない部分に分けて記録する。

- 用語・採用/不採用の判断: [agent-collaboration.md](./agent-collaboration.md)
- MCP利用者向けの手順: [external-ai-integration.md](./external-ai-integration.md)
- 往復のE2E契約: [ai-collaboration-e2e.md](./ai-collaboration-e2e.md)

---

## 1. Source of truth

| 概念                           | 正本                                                                         | 実装                                            |
| ------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------- |
| Task                           | `task` entity                                                                | `src/shared/contracts/task/model.ts`            |
| 起案者（人間の責任主体とは別） | `Task.requester`                                                             | 同上                                            |
| 委任先                         | `Task.intended_executor` ＋ `Task.executor_identity`                         | 同上                                            |
| **現在参照している作業単位**   | `Task.work_attempt_id`                                                       | 同上（任意・UUID）                              |
| TaskのAI作業状態               | `Task.work_state`                                                            | 既存8値。**増やさない**                         |
| 届いた報告（未採用）           | pendingな `ai_proposal`（`payload_type: "task_work"`）                       | `src/shared/contracts/task/taskWorkProposal.ts` |
| 採用した作業記録               | `work_receipt` entity（append-only）                                         | `src/main/repositories/domain.mjs`              |
| **報告が属する作業単位**       | `work_receipt.work_attempt_id`                                               | 採用時にProposalから引き継ぐ                    |
| **人間が回答すべき一回の質問** | `work_receipt.request_id`                                                    | `report_blocked` の `request_id`                |
| **作業単位内の報告順**         | `work_receipt.report_sequence`                                               | 任意の整数                                      |
| 人の返答                       | 人間actorの `work_receipt`（`runtime_metadata.report_kind = "human_reply"`） | #597 で接続する                                 |
| 表示状態・要対応               | **保存しない**。既存データからの導出                                         | `src/shared/contracts/task/agentWork.ts`        |
| 既読・見送り・再表示日時       | 利用者の表示上の選択                                                         | 製品接続時に `AttentionDisposition`（#596以降） |

`queued / working / blocked / review_ready / done` は**canonical enumにしない**。§3 の導出表が返す表示状態であり、保存しない。

## 2. 追加したfield

**すべて任意。既存データはそのまま読め、既存の書き込み経路は変更なしで動く。**

| 場所                                                                                  | field                                                | 型                                      | 意味                                           |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------- | ---------------------------------------------- |
| `task_work` Proposal（`start` / `append_receipt` / `report_done` / `report_blocked`） | `work_attempt_id`                                    | UUID?                                   | この報告が属する作業単位                       |
| 同上                                                                                  | `report_sequence`                                    | 0〜100000?                              | 作業単位内の順番                               |
| `report_blocked`                                                                      | `request_id`                                         | UUID?                                   | 人間が回答すべき一回の質問のID。再送で変えない |
| `work_receipt`                                                                        | `work_attempt_id` / `report_sequence` / `request_id` | 同上                                    | 採用時にProposalから引き継ぐ                   |
| `work_receipt`（人の返答）                                                            | `receipt_kind` / `reply_choice_id` / `reply_note`    | `"ai_report"` / `"human_reply"`（#597） | 省略時は従来のAI報告として読む                 |
| `Task`                                                                                | `work_attempt_id`                                    | UUID?                                   | 現在参照している作業単位                       |
| `StartTaskWork`（application command）                                                | `workAttemptId`                                      | UUID?                                   | 指定すると新しい作業単位を開始する             |
| MCP `tasken.start_task_work`                                                          | `work_attempt_id`                                    | UUID?                                   | 同上                                           |
| MCP `tasken.append_work_receipt` / `report_task_done` / `report_task_blocked`         | `work_attempt_id` / `report_sequence`                | 同上                                    | 報告の帰属と順番                               |
| MCP `tasken.report_task_blocked`                                                      | `request_id`                                         | UUID?                                   | 質問のID                                       |

### 生成と更新の責務

- **作業単位IDは依頼を始めた側が生成する。** 同じ委任の間は同じIDを全報告で使う。明示的にやり直す時だけ新しいUUIDにする。
- **再割当・明示的な再依頼は `StartTaskWork` に新しい `work_attempt_id` を渡す。** Taskの現在参照がその時点で切り替わる。
- **IDを省略した場合は従来どおり。** Taskが作業単位IDを持たなければ、すべての報告を current として扱う（`legacyAttemptTracking`）。
- Taskが作業単位IDを持つのに、報告がIDを持たない場合は **current 状態を確定する証拠にしない**。履歴とProposalとしては今までどおり読める。

## 3. 状態導出

`deriveAgentWorkState({ task, proposals, receipts, sourceAvailable? })` が `AgentWorkReadModel` を返す。
`Task.work_state` とは別物で、**この値を保存しない**。

| 条件                             | 表示状態                          | 要対応                      | Taskの完了 |
| -------------------------------- | --------------------------------- | --------------------------- | ---------- |
| 委任前                           | `not_delegated`                   | なし                        | 変更しない |
| 委任済み、開始未観測             | `start_waiting`                   | なし                        | 変更しない |
| 現在の作業単位の開始が保存済み   | `working`                         | なし                        | 変更しない |
| 未解決の入力要求が届いた         | `answer_waiting`                  | 質問1件                     | 変更しない |
| 未解決の選択・許可要求が届いた   | `decision_waiting`                | 判断1件                     | 変更しない |
| 返答の保存が成功、再開未観測     | `answered_resume_waiting`         | 対象の質問は除外            | 変更しない |
| 現在の作業単位の成果報告が届いた | `review_waiting`                  | 報告に紐づく判断1件         | 変更しない |
| 人が報告を採用、Task完了は未選択 | `accepted_continuing`             | 解決した判断を除外          | 変更しない |
| 人が採用とTask完了を明示         | `accepted_completed`              | 解決した判断を除外          | 完了       |
| 人が修正内容を保存               | `revision_requested`              | 対象レビューは解決          | 変更しない |
| 別作業単位からの遅い報告         | `past_attempt_report`（報告単位） | currentの判断を復活させない | 変更しない |
| sourceを取得できない             | `unknown_source`                  | 最後の確定状態を保持        | 変更しない |

### 質問は採用では消えない

`report_blocked` の質問は、報告を採用しても解決しない。**人が回答を保存するまで未解決として残る。**
`request_id` を持つ質問は、同じ `request_id` の人間返答Receiptが現れるまで `answer_waiting` / `decision_waiting` に留まる。
`request_id` を持たない旧い質問は、Taskの `work_state` が `blocked` でなくなった時点で表示から外す。

### 件数の数え方

- 要対応は**未解決の判断単位**で数える。同じTaskの独立した質問とレビューは2件。
- 同じ `request_id` の再送は、受信時刻が変わっても1件にまとめる。
- 同じTaskでも**作業単位が違えば別の報告**として並び、currentの判断には数えない。

### 順序

`agentWorkOrderKey` は `report_sequence` → 受信時刻 → 発信時刻 の順に強い根拠を使う。
**発信側の時計 (`reported_at`) だけで current を選ばない。**

## 4. 遷移例

### 4.1 基本の一往復

```text
StartTaskWork(workAttemptId=A)          → Task.work_attempt_id=A, work_state=in_progress
append_work_receipt(A, seq=1)           → 採用: receipt.work_attempt_id=A。表示は working
report_task_done(A, seq=2)              → pending。表示は review_waiting、要対応1件
利用者が採用（Taskは継続）               → work_state=accepted。表示は accepted_continuing
利用者が完了を明示                       → state=done, work_state=accepted。accepted_completed
```

### 4.2 質問と回答

```text
report_task_blocked(A, request_id=Q)    → work_state=blocked。表示は answer_waiting、要対応1件
利用者が報告を採用                       → Receiptに request_id=Q が入る。**質問はまだ未解決**
（同じ質問を再送）                       → 同じ request_id なので要対応は1件のまま
人が回答を保存（#597）                   → 表示は answered_resume_waiting、要対応から外れる
```

### 4.3 再割当と遅い報告

```text
StartTaskWork(workAttemptId=A, Codex)   → Task.work_attempt_id=A
（Aの進捗を採用）                        → receipt.work_attempt_id=A
StartTaskWork(workAttemptId=B, Claude)  → Task.work_attempt_id=B
report_task_done(A) が遅れて到着         → past_attempt_report。要対応は0件のまま
```

**Taskは一つ。** Aの報告も同じTask IDの履歴として残り、Bの current 状態を巻き戻さない。

### 4.4 順不同と再送

```text
append_work_receipt(A, seq=2) が先に到着 → 受信時刻では後だが seq=2
append_work_receipt(A, seq=1) が後で到着 → seq で並べるので current は seq=2 のまま
同じ idempotency_key の再送             → 保存済みReceiptを返し、Entityを増やさない
```

## 5. 旧データの読み取り

| 旧データ                                      | 扱い                                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `Task.work_attempt_id` なし                   | `legacyAttemptTracking = true`。すべての報告を current として扱い、遅着判定をしない |
| 報告に `work_attempt_id` なし（TaskはIDあり） | 履歴とProposalとしては読める。current の判断・要対応には数えない                    |
| 報告に `report_sequence` なし                 | 受信時刻 → 発信時刻の順で並べる                                                     |
| 質問に `request_id` なし                      | Taskの `work_state` が `blocked` の間だけ未解決として表示する                       |
| `executor_kind !== "ai_agent"` のReceipt      | 従来どおりAI作業の報告として扱わない                                                |

**古いクライアントのIDなし報告を、日時の近さだけで新しい作業単位へ紐付けない。**

## 6. 人の返答（#597）

人間の返答は**既存のWork Receiptを再利用**する。新しいEntityを増やさない。

| 要素         | 値                                                                        |
| ------------ | ------------------------------------------------------------------------- |
| 実行主体     | `executor_kind: "human"`、`executor_label: "自分"`                        |
| 種別         | `receipt_kind: "human_reply"`（Mainが書く。呼び出し側の自由JSONにしない） |
| 質問参照     | `request_id`（型付きのトップレベルfield）                                 |
| 作業単位     | `work_attempt_id`                                                         |
| 回答本文     | `summary`                                                                 |
| 選んだ選択肢 | `reply_choice_id`                                                         |
| 補足         | `reply_note`                                                              |

### Command

`ReplyToAgentRequest`（application command）。人間UIからのみ実行でき、MCPからは呼べない。

```text
taskId / requestId / body / choiceId? / note? / repliedAt?
```

### 保存時の規則

1. **Taskの状態を変えない。** 回答は判断の記録であり、再開の観測ではない。
   表示は「回答済み／再開待ち」で、`work_state` は `blocked` のまま。agentの再開報告で進む。
2. **質問が現在も有効かを保存時に確かめる。** 採用済みの停止報告Receiptか、未採用の停止報告Proposalに
   同じ `request_id` があり、現在の作業単位のものでなければ拒否する。
3. **同じ質問へ二度目は書けない。** 回答ReceiptのIDは `request_id` から決定的に導出する。
   同じ内容の再送は保存済みの記録を返し（`no_change`）、違う内容は競合として拒否する。
   他端末ですでに回答された質問への上書きを防ぐ。
4. **来歴は回答Receipt自身に残す。** TaskのChangeEventは作らず、`work_receipt` の `created` として記録する。

### agent側の取り戻し

MCPの `tasken.get_task_context` は `work_receipts` に `receipt_kind` / `request_id` /
`work_attempt_id` / `reply_choice_id` を返す。agentは自分が送った質問の `request_id` と
突き合わせて回答を取り戻せる。未回答かどうかは、同じ `request_id` を持つ `human_reply` が
あるかで判定できる。

## 7. Handoff（#598）

Task詳細の「AIへ任せる」から、**Taskの正本を変えずに**外部agentへ委任する。

### Taskへ記録するもの

| field                                     | 意味                            |
| ----------------------------------------- | ------------------------------- |
| `intended_executor` + `executor_identity` | 委任先（`ai_agent` と表示名）   |
| `handoff_expected_result`                 | 期待する成果（任意）            |
| `handoff_instruction`                     | 追加指示（任意）                |
| `handoff_context_ref`                     | 確認したContext Previewの参照版 |
| `handoff_requested_at`                    | 依頼を準備した時刻              |

**本文・完了条件・ownerは変えない。** 委任は依頼の記録であって、Taskの書き換えではない。

### Context Previewと依頼文は同じ参照を指す

`handoffContextRef(preview)` が、Previewに含まれる参照（`type:id`）と切り詰めの有無から
参照版を作る。**新しい記録ではなく毎回の導出**なので、関連資料が変われば値が変わる。

1. Previewを取得して参照版を控える。
2. 「AIへの依頼を準備」の直前にContextを取り直す。
3. 参照版が変わっていれば **`describeHandoffContextChange` の差分を出して再確認させ、保存しない。**
4. 一致したときだけTaskを保存し、同じ参照版を載せた依頼文をコピーする。

依頼文にも参照版を載せ、「異なるContextが返った場合は勝手に進めず知らせる」と伝える。

### 開始を偽装しない

- 準備は外部AIの自動起動ではない。画面に「依頼文を渡すと開始できます」と明示する。
- Taskの表示は、開始の報告を観測するまで **「開始待ち」**（`work_state: ready_for_agent`）。
- **agentがContextを取得したかは観測していない。** 取得済みとは表示しない。
- 委任の解除は「委任を解除」と表示し、外部プロセスの停止は保証しない。

## 8. Agent Desk（#599）

`ai-io` の面の先頭に、任せた仕事の進みと待ちを**4つの見出し**で一覧する。
4列Kanbanにはしない。対応待ちを先頭に置く。

```text
対応待ち 2
  測定温度が決まっていません。   Codex  粘度測定の条件を決める   [回答待ち]
  3条件の比較表を作成しました。  Codex  比較表の作成            [成果確認]
作業中 0
開始待ち 1
  粘度データの整理               外部AI  開始は未確認
最近の結果 0件
```

- 一覧は `buildAttentionQueue` と `deriveAgentWorkState` の**導出結果を表示するだけ**。
  画面側に状態の正本を持たない（選択と入力だけを持つ）。
- 「作業中」は稼働監視ではない。**経過時間だけで成功・停止・失敗へ変えない。** 報告が無ければ「報告はまだありません」。
- 「開始待ち」は **「開始は未確認」** と表示する。agentがContextを取得したかは観測していないので「取得済み」とは書かない。

### 確認詳細の読み順

成果確認は **「成果」「確認できたこと」「未確認事項」「Taskenへ反映する内容」** の順に読む。

| 操作名             | 保存される結果                                   | 既定                               |
| ------------------ | ------------------------------------------------ | ---------------------------------- |
| 報告を採用         | 報告を正式Receiptへ保存する。**Taskは継続**      | 主操作                             |
| 採用してTaskを完了 | 採用範囲を保存し、人が明示したTask完了を実行する | 「Taskも完了する」を選んだときだけ |
| 修正を依頼         | 修正内容を残し、対象の作業を差戻す。Taskは継続   | —                                  |
| この変更案を却下   | Proposalを不採用にする                           | —                                  |

「この変更案を却下」は種別で経路を分ける。Task workは `ApplyTaskWorkProposal`（`decision: "reject"`）、
中身のある変更案（Note / Knowledge / Sketch / Artifact）は同じ面のPreviewと同じ entry decision を添えて
`ApplyAiProposal`（`status: "rejected"`）へ渡す。**Taskに紐づかない変更案も Agent Desk から決着でき**、
却下で正式データは作らない。修正を依頼（差戻し）とは別の操作である。

「Taskも完了する」は**最初から選ばれていない明示オプション**にする。
採用と完了は二つのCommandなので、前半だけ成功した場合は
「既に採用済みの場合は、Task完了だけを再試行できます」と示し、**全体を失敗扱いして報告を二重保存しない**。

### 回答

詳細の上半分に質問と選択肢、下に返答欄を置く。選択肢がある場合も自由記述を許す。
「回答を送る」で `ReplyToAgentRequest` を呼び、保存後は要対応から外れて「回答済み／再開待ち」になる。
**Taskの状態は変えない**（§6）。

### Android向けの面（#601）

Desktopと同じ導出を、Android用のread modelとして渡す。**Android側で状態を再導出しない。**

| 経路                     | scope                 | 内容                                                                                   |
| ------------------------ | --------------------- | -------------------------------------------------------------------------------------- |
| `GET /v1/attention`      | `mobile:read`         | `buildAttentionQueue` の結果と件数（要対応・作業中・開始待ち）。上限超過は `truncated` |
| `POST /v1/agent-replies` | `mobile:human-review` | 質問IDへの短い返答。Taskは変えず、回答Receiptだけを増やす                              |

- 件数は**判断単位**で数える。同じTaskの独立した判断は2件、Taskに紐づかないProposalも1件。
- 回答には `taskVersion`（競合検出）と `requestId`（回答対象）が必要。
  版が古い場合と回答済みの場合は `entity_conflict`（409）を返し、**成功として返さない**。
- 応答を失った再送は、同じ `commandId` なら同じ結果、別 `commandId` でも同じ内容なら `no_change` を返し、回答を増やさない。
- 回答Receiptの `provenance.reported_via` は呼び出し元のsource（`mobile` / `main_ui` など）を記録し、Desktopからの回答と取り違えない。
- mobile向けの射影は `src/main/gateway/mobile/attentionProjection.ts`、Core側の読み出しは `taskenCoreRuntime.ts` の `readAttention` / `replyToAgentRequest`。

#### Androidの画面（#601）

「AI」面の先頭に **対応待ち** を置き、その下に作業中・開始待ちの件数を出す。

- 見出しの数はDesktopから受け取った値をそのまま表示する。Android側で数え直さない。
- **まだ取得できていない間は「対応待ち 0」と書かない。** 未取得と0件を区別して示す。
- 回答は行ごとの「回答する」から開き、下部の入力欄と「回答を送る」で送る。
  送信中・保存済み・競合・未接続を区別し、**失敗しても入力を消さない**。
- 回答後はDesktopが返した `displayState` をそのまま文言へ写す。「回答済み」を画面側で作らない。
- 「開始待ち」は **「開始は未確認」** と添える。agentがContextを取得したかは観測していない。
- 選択肢（`choiceId`）は要対応itemに含まれないため、Androidからの回答は自由記述のみ（`choiceId` は送らない）。

**Foldの展開幅（#601）**: 一覧と詳細を並べ、回答は詳細ペインで書く。

- 展開幅（`taskenPaneScaffoldDirective` が2ペインを許す幅）では、行の「回答する」が詳細ペインを開く。
  1列のときは従来どおり行の直下に回答欄を置く（同じ意味のまま置き場所だけを変える）。
- 詳細ペインは **上部に見出しと状態、中央に質問、下部に回答欄と主操作** を置く（`AttentionDetailPane`）。
  「一覧へ戻る」は1列のときだけ出す。折り畳んだ幅では詳細ペインが全画面になり、戻ると一覧の
  スクロール位置と選択が残る。
- 書いた回答は `TodayPaneState.attentionReplyBody` に置き、ペインを移動しても消さない。
  **正式に保存できたとき（`Applied`）だけ**選択と入力を閉じる。競合・拒否・未接続では残す。
- Desktopが返した一覧から消えた判断は詳細に残さない（選択と入力を閉じる）。

**新着の知らせ（#601）**: 既定はアプリ内表示。OS通知は利用者が有効にしたときだけ出す。

- 通知の候補は **質問・判断依頼・成果確認の新規発生だけ**（`AttentionNotificationStore.isNotificationCandidate`）。
  変更案（`proposal_pending`）と不明な種別は候補にしない。
- **同じ判断の再送では再通知しない。** 一度知らせた判断IDを記録し、いま一覧にある判断で記録を置き換える
  （消えた判断が再び現れたときは新規発生として扱う）。
- アプリ内では要対応の見出しに「新しい対応待ち N件」を出し、押すとその判断へ移動する。行の本文全体は写さない。
- OS通知は1件にまとめ、件数と最初の見出しだけを示す。タップすると `tasken://attention/<判断ID>` を開き、
  AI面のその判断へ移動する（`MobileEntryRequest.Attention`）。既に解決済みの判断だった場合は
  「この判断はもう要対応にありません。」と伝える。
- 設定はAI面の「要対応の新着を通知」（既定はオフ）。有効にする時点でOSの通知権限を一度だけ求める。

実装は `MobileAttentionDto.kt`（契約と射影）、`MobileLocalStore.kt`（`attention_cache` / `attention_state` / `pending_agent_reply`、DB v26）、`MobileGatewayRepository.kt`（取得と回答の再送）、`AttentionNotificationStore.kt`（設定と通知済みの記録）、`MobileAttentionNotifications.kt`（OS通知とdeep link）、`MainActivity.kt`（一覧・詳細ペイン・新着の表示と回答欄）、`TodayViewModel`（`attention` / `attentionNewArrivals` / `agentReplyState`）。

検証は JVM の `MobileAgentReplyContractTest` / `MobileAttentionGoldenTest` / `AttentionNotificationStoreTest` /
`MobileEntryRequestTest`（deep link）と、エミュレータの `AgentDeskAttentionUiTest`
（展開幅の詳細ペイン・新着の表示と移動・競合時の入力保持・オフライン・未取得と0件の区別）。
Foldの目視は `output/android-attention/fold-attention-detail.png`（2076×2152の展開幅）。

## 9. migration と rollback

- **DBスキーマ変更なし。** Entityの `properties_json` に任意fieldが増えるだけで、`entities` テーブルの列は変わらない。migrationは不要。
- **Export / Import・Snapshot形式の変更なし。** 既存のSnapshotはEntityを丸ごと運ぶため、新しい任意fieldもそのまま往復する。
- **削除と復元は既存の論理削除・復元経路をそのまま使う。** 作業単位IDはEntityの属性なので、復元で失われない。
- **旧版アプリ**は新しいMCP引数を送らない。その場合Taskに作業単位IDが付かないため `legacyAttemptTracking` として従来どおり動く。
- **rollback** は新しいfieldを書かないように戻すだけでよい。既に保存された値は誰も読まなくなり、既存のProposal/Receipt経路は影響を受けない。

### Android側のストレージ（#601）

- Desktopの正本データに変更はない。AndroidのキャッシュDBだけが **v25 → v26** へ上がる（`attention_cache` / `attention_state` / `pending_agent_reply` を追加）。
- 既存のTask・Outbox・Pending Human Review・通知配送はmigrationで保持する（`MobileLocalDatabaseMigrationTest` と `MobilePhotoUpgradeTest` で確認）。
- 要対応はキャッシュであり、正本は常にDesktop。**アプリを再インストールしても失うのは表示だけ**で、回答は `pending_agent_reply` に残る。

## 10. 実装を置く境界

| 境界                                                    | 責務                                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| `src/shared/contracts/task/agentWork.ts`                | 表示状態、要対応item、操作ID、導出、並び順                              |
| `src/shared/contracts/task/attentionQueue.ts`           | 未解決判断の集約、件数、重複排除、並び（#596 / #601）                   |
| `src/shared/contracts/task/handoff.ts`                  | Handoffの委任先、Context参照版、差分の説明（#598）                      |
| `src/renderer/.../components/AgentDeskPanel.tsx`        | 4見出しの一覧と確認詳細。表示とCommand接続だけを持つ（#599）            |
| `src/shared/contracts/task/taskWorkProposal.ts`         | 報告の入力契約（新fieldの受理と検証）                                   |
| `src/shared/applicationCommand.ts`                      | `StartTaskWork.workAttemptId` と `ReplyToAgentRequest` の検証           |
| `src/main/services/applicationCommandService.ts`        | Taskの現在参照の更新、Receiptへの引き継ぎ、質問の有効性確認、人の返答   |
| `src/main/repositories/domain.mjs`                      | 保存時の形式検証（UUID・範囲・`receipt_kind`）                          |
| `src/main/mcp/server.mjs`                               | agent向けの入力schema                                                   |
| `src/main/gateway/mobile/attentionProjection.ts`        | 要対応のmobile向け射影（上限・truncated・件数）（#601）                 |
| `src/main/composition/taskenCoreRuntime.ts`             | 要対応の読み出しと回答の受理（`readAttention` / `replyToAgentRequest`） |
| Android `MobileAttentionDto.kt` / `MobileLocalStore.kt` | 要対応の契約・キャッシュ・回答の保留（#601）                            |
| Android `MainActivity.kt` / `TodayViewModel`            | 要対応の一覧と回答欄。表示と入力だけを持つ（#601）                      |
| Desktop UI / Android                                    | read modelを表示するだけ。**独自の状態導出を増やさない**                |

### 要対応queue（#596）

`buildAttentionQueue` が、未解決の判断を一つのcontractへ集約する。
**新しいInbox Entityではない。** 各itemは元のsourceへlocator（`sourceType` / `sourceId` / `sourceVersion`）を持つ。

| 写像元                                                                | kind               |
| --------------------------------------------------------------------- | ------------------ |
| `blocked` / `input_required`（`report_blocked` + `needed_input`）     | `answer_request`   |
| `decision_required`（`report_blocked`）                               | `decision_request` |
| `review_ready`（pending `report_done`）                               | `review_report`    |
| `proposal_pending`（Task work以外のpending Proposal。Taskなしも含む） | `proposal_pending` |

- **Task workの判断は `deriveAgentWorkState` の結果をそのまま使う。** 二重実装しない。
- 同じreportから生じたreviewとProposalは**1件**。同じ質問の再送も増殖しない。
- 接続hookのAgent Session観測（`tasken-session-hook:*`）は判断待ちではないため数えない。
- 解決済み（`accepted` / `rejected`）と削除済みのsourceは自然に消える。**staleなsourceを成功扱いにしない。**
- Sidebarのbadgeは `countAttention` の値、つまり**未処理のhuman attentionの数**を表す。
  同じTaskの独立した判断は2件として数える。

## 11. 検証

```powershell
rtk node scripts/run-electron-node.mjs --test tests/agent-work-state.test.mjs
rtk node scripts/run-electron-node.mjs --test tests/agent-work-attempt.test.mjs
rtk node scripts/run-electron-node.mjs --test tests/agent-reply.test.mjs
rtk node scripts/run-electron-node.mjs --test tests/attention-queue.test.mjs
rtk node scripts/run-electron-node.mjs --test tests/task-handoff.test.mjs
rtk node scripts/run-electron-node.mjs --test tests/agent-desk.test.mjs
rtk node scripts/run-electron-node.mjs --test tests/mobile-attention-golden.test.mjs tests/mobile-agent-attention.test.mjs
rtk npm run build && rtk npm run audit:handoff && rtk npm run audit:agent-desk
rtk node scripts/run-electron-node.mjs --test tests/task-work-receipts.test.mjs tests/task-work-history.test.mjs
rtk node scripts/run-electron-node.mjs --test tests/mcp-task-context.test.mjs
rtk node scripts/run-electron-node.mjs --test tests/ai-collaboration-e2e.test.mjs
rtk node scripts/run-electron-node.mjs --test tests/agent-roundtrip-acceptance.test.mjs
rtk npm run typecheck
rtk npm run build:mcp
```

共有fixtureは `tests/fixtures/agentWorkScenarios.mjs`。Desktopのread modelテストと、後続のAndroid golden fixture（#601 / #602）が同じ意味の入力を参照する。

### 受け入れシナリオの証跡（#602 / 単位K）

計画書の受け入れシナリオ（`docs/issue-design-plan-2026-09-20.md`）のうち、#602の14場面を
どのテストが実測しているかを対応させる。記載したテストは `tests/` と
`android-app/app/src/{test,androidTest}` に実在し、`npm run ci` の対象に入っている。

| 場面             | 証跡（実測）                                                                                                                                                                                                                                                                                                                            | 残っている境界                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 基本の一往復     | `tests/agent-roundtrip-acceptance.test.mjs`（実SQLite＋実stdio MCP＋実mobile gateway。採用では`state==="todo"`のまま、明示完了で`done`）                                                                                                                                                                                                | 実クライアント（Codex等）からの接続                                                  |
| 報告だけ採用     | `tests/task-work-receipts.test.mjs`、`tests/agent-work-state.test.mjs`（`accepted_continuing`）、`tests/agent-desk.test.mjs`（文言）、`npm run audit:agent-desk`（実画面で採用→Taskは継続）                                                                                                                                             | —                                                                                    |
| 採用して完了     | `tests/task-work-receipts.test.mjs`（採用→古い版での完了は競合→完了だけ再試行。Receiptは1件のまま）、`npm run audit:agent-desk`（「Taskも完了する」→実画面で完了し、保存状態も確認）                                                                                                                                                    | —                                                                                    |
| 差戻し           | `tests/task-work-receipts.test.mjs`（**採用前の報告も差戻せる**。理由が残り、Proposalは差戻しとして決着）、`tests/mobile-gateway-phase4a.test.mjs`（Androidの経路）、`tests/mcp-task-context.test.mjs`（理由をagentが取得）、`tests/agent-work-state.test.mjs`、`npm run audit:agent-desk`（実画面）、Android `WorkReceiptDetailUiTest` | —                                                                                    |
| 再割当           | `tests/agent-work-state.test.mjs`（遅い報告は`past_attempt_report`）、`tests/agent-work-attempt.test.mjs`（`ReassignTaskWork`で新しい作業単位になり、確認待ちは先に採用か差戻し）、`tests/agent-reply.test.mjs`、`npm run audit:handoff`（実画面）                                                                                      | 実行中に解除した相手のagent側の扱い                                                  |
| 再送             | `tests/mcp-task-context.test.mjs`、`tests/agent-reply.test.mjs`（`no_change`）、`tests/mobile-gateway-agent-delegation.test.mjs`                                                                                                                                                                                                        | 4経路を1本のテストでは通していない                                                   |
| 順不同           | `tests/agent-work-state.test.mjs`（`report_sequence`が到着順と発信時刻より優先。progressは要対応の行を作らない）                                                                                                                                                                                                                        | 端末差が出る値は無い（順序は共有の`agentWorkOrderKey`が決める）                      |
| 質問とprogress   | `tests/agent-work-state.test.mjs`、`tests/attention-queue.test.mjs`（progress後も回答待ちが残る）                                                                                                                                                                                                                                       | —                                                                                    |
| 複数の判断       | `tests/attention-queue.test.mjs`（質問とNote変更案の合計2件。Task紐づきでも別の判断として残り、片方の処理で他方が残る）、`tests/agent-work-state.test.mjs`                                                                                                                                                                              | MCPの書き込み経路が`notes`へ`task_id`を運ばない（読み出しは`request.task_id`に対応） |
| 同じ報告の重複   | `tests/attention-queue.test.mjs`（reviewとProposalは1件、解決で消える）                                                                                                                                                                                                                                                                 | —                                                                                    |
| TaskなしProposal | `tests/attention-queue.test.mjs`、`tests/mobile-attention-golden.test.mjs`、`tests/ai-integration-ia.test.mjs`、`npm run audit:agent-desk`（実画面で対応待ち→preview→却下）、Android `MobileAttentionGoldenTest`                                                                                                                        | —                                                                                    |
| offline返信      | Android `AgentDeskAttentionUiTest`、`MobileAttentionRepositoryTest`（未送信の保持と成功後の消去）                                                                                                                                                                                                                                       | 画面を閉じた後の下書き復元                                                           |
| offline承認      | Android `WorkReceiptDetailUiTest`、`MobileHumanReviewRepositoryTest`                                                                                                                                                                                                                                                                    | —                                                                                    |
| 端末間競合       | `tests/agent-roundtrip-acceptance.test.mjs`（409 `entity_conflict`、遅い回答は記録を作らない）、Android `AgentDeskAttentionUiTest`                                                                                                                                                                                                      | —                                                                                    |

## 12. この単位で確認していないこと

一往復の受け入れ証跡は `tests/agent-roundtrip-acceptance.test.mjs`（#602 / 単位K）。
Task作成 → Handoff → MCP開始 → 質問 → Android回答 → MCP再取得 → 成果報告 → 採用 → 明示完了を、
実SQLite・実stdio MCP・実mobile gatewayで同じTask IDのまま通す。
14場面ごとの証跡と残った境界は §11「受け入れシナリオの証跡」の表にまとめてある。

| 未確認                  | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 回答のUI                | Agent DeskとAndroidのAI面から回答できる。**Task詳細からの回答導線は未接続**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 回答のMCP越しの受け渡し | 実stdio MCP → Desktop Core → Android回答 → MCP再取得までを通した（`tests/agent-roundtrip-acceptance.test.mjs`）。**実クライアント（Codex等）からの接続は未検証**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 再割当のUI操作          | 委任の解除と「新しい作業単位で任せ直す」はTask詳細から行える（`ReassignTaskWork`。#602。`npm run audit:handoff` で実画面、`tests/agent-work-attempt.test.mjs` で境界）。**実行中に解除した相手のagent側の扱いは未検証**                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 表示                    | Agent DeskはTask詳細と同じ詳細コンポーネントをまだ共有していない（#600で統合する）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| HandoffのCancel         | 委任の解除はTaskを `not_delegated` へ戻すだけ。実行中に解除した場合のagent側の扱いは未検証                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Android                 | Gatewayの `/v1/attention` / `/v1/agent-replies`、Core側の読み出し、AndroidのRoomキャッシュ（`attention_cache` / `attention_state` / `pending_agent_reply`）と回答の再送まで実装済み（#601。`tests/mobile-agent-attention.test.mjs` / `MobileAttentionRepositoryTest` / `MobileAgentReplyContractTest`）。要対応の一覧・回答欄、Foldの詳細ペイン、新着の知らせ（アプリ内表示と任意のOS通知・deep link）は `AgentDeskAttentionUiTest` / `AttentionNotificationStoreTest` / `MobileEntryRequestTest` で確認済み（展開幅の目視は `output/android-attention/fold-attention-detail.png`）。**Android実機（SM-F966Q）での目視と、通知の実配信（Desktopから新規判断が届いたときの実端末表示）は未検証** |
| Export往復の実走        | Snapshot形式は変更していないため未検証。ただしEntity単位の往復は `tests/agent-work-attempt.test.mjs` で確認している                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
