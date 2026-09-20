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

## 7. migration と rollback

- **DBスキーマ変更なし。** Entityの `properties_json` に任意fieldが増えるだけで、`entities` テーブルの列は変わらない。migrationは不要。
- **Export / Import・Snapshot形式の変更なし。** 既存のSnapshotはEntityを丸ごと運ぶため、新しい任意fieldもそのまま往復する。
- **削除と復元は既存の論理削除・復元経路をそのまま使う。** 作業単位IDはEntityの属性なので、復元で失われない。
- **旧版アプリ**は新しいMCP引数を送らない。その場合Taskに作業単位IDが付かないため `legacyAttemptTracking` として従来どおり動く。
- **rollback** は新しいfieldを書かないように戻すだけでよい。既に保存された値は誰も読まなくなり、既存のProposal/Receipt経路は影響を受けない。

## 8. 実装を置く境界

| 境界                                             | 責務                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| `src/shared/contracts/task/agentWork.ts`         | 表示状態、要対応item、操作ID、導出、並び順                            |
| `src/shared/contracts/task/taskWorkProposal.ts`  | 報告の入力契約（新fieldの受理と検証）                                 |
| `src/shared/applicationCommand.ts`               | `StartTaskWork.workAttemptId` と `ReplyToAgentRequest` の検証         |
| `src/main/services/applicationCommandService.ts` | Taskの現在参照の更新、Receiptへの引き継ぎ、質問の有効性確認、人の返答 |
| `src/main/repositories/domain.mjs`               | 保存時の形式検証（UUID・範囲・`receipt_kind`）                        |
| `src/main/mcp/server.mjs`                        | agent向けの入力schema                                                 |
| Desktop UI / Android                             | read modelを表示するだけ。**独自の状態導出を増やさない**              |

## 9. 検証

```powershell
rtk node scripts/run-electron-node.mjs --test tests/agent-work-state.test.mjs
rtk node scripts/run-electron-node.mjs --test tests/agent-work-attempt.test.mjs
rtk node scripts/run-electron-node.mjs --test tests/agent-reply.test.mjs
rtk node scripts/run-electron-node.mjs --test tests/task-work-receipts.test.mjs tests/task-work-history.test.mjs
rtk node scripts/run-electron-node.mjs --test tests/mcp-task-context.test.mjs
rtk node scripts/run-electron-node.mjs --test tests/ai-collaboration-e2e.test.mjs
rtk npm run typecheck
rtk npm run build:mcp
```

共有fixtureは `tests/fixtures/agentWorkScenarios.mjs`。Desktopのread modelテストと、後続のAndroid golden fixture（#601 / #602）が同じ意味の入力を参照する。

## 10. この単位で確認していないこと

| 未確認                  | 内容                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 回答のUI                | `ReplyToAgentRequest` を呼ぶ画面はまだ無い（#599のAgent Deskで接続する）                                                             |
| 回答のMCP越しの受け渡し | `get_task_context` が返すことは確認したが、実stdio MCPのE2E往復（質問→回答→再取得）は `tests/ai-collaboration-e2e.test.mjs` へ未追加 |
| 再割当のUI操作          | 委任解除と新しい作業単位の作成を利用者が実行する導線は未実装（#598 / #602）                                                          |
| 表示                    | `AgentWorkReadModel` を描画する画面はまだ無い（#596 / #599）                                                                         |
| Android                 | Kotlin側のDTOとgolden fixtureは未接続（#601）。回答の送信経路も未実装                                                                |
| Export往復の実走        | Snapshot形式は変更していないため未検証。ただしEntity単位の往復は `tests/agent-work-attempt.test.mjs` で確認している                  |
