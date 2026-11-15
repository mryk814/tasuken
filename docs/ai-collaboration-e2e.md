# AI collaboration E2E contract

Issue #364 の統合証跡は `tests/ai-collaboration-e2e.test.mjs` を正本とする。
テストは production credential や network provider を使わず、temp SQLite と actual stdio MCP server、provider/model 名だけが異なる二つの fake provider で同じシナリオを実行する。
加えて、明示的な `start_task_work` を使うシナリオも同じ採用・再起動経路で検証する。

## Fixed sequence

1. pre-#277/#278 形式の Theme / Task / Note を SQLite へ bootstrap し、Task に human requester、AI executor、RepositoryContext を割り当てる。
2. actual stdio MCP の `tasken.list_agent_ready_tasks` で候補を見つけ、`tasken.get_task_context` で Task、assignment、安全な repository locator、関連 Note を取得する。一覧・Context読取では永続データが変わらないことも確認する。
3. 開始方法を二つ検証する。明示開始では `tasken.start_task_work` がProposalを作らず `in_progress` を保存し、返却された `value.task.version` を後続Receiptの `expected_version` に使う。同じ開始リクエストの再送で書込が重複せず、AI Ready一覧から対象が外れることも確認する。開始省略ではAI Ready Taskへ直接 `tasken.report_work(status=progress)` を送り、採用時にstarted eventとReceiptが同じtransactionで保存されることを確認する。いずれもReceiptは人の採用まで正式保存されない。
4. 一つ目の `tasken.report_work(status=done)` を Main で reject し、Task と Receipt が変わらないことを確認する。
5. 二つ目のdone proposal採用途中へfailureを注入し、Task / Work Receipt / ChangeEvent / Proposal statusが同じSQLite transactionでrollbackすることを確認する。
6. 同じproposalを正常採用し、Receiptを受け入れてもTaskは未完了のままであることを確認する。AIのTask直接変更・完了は引き続き拒否し、人が別途明示した完了だけを保存する。
7. 同じdecisionの再送が保存済みreceiptを返し、EntityやChangeEventを増やさないことを確認する。
8. DBとstdio MCPを再起動し、Proposal、Receipt、ChangeEvent、RepositoryContext、`work_receipt -> task / created_for` backlinkを再取得する。
9. provider A/BのTask、repository locator、MCP context、Proposal、Receipt schemaが一致し、差分がReceiptの`runtime_metadata.provider/model`だけであることを比較する。

## Atomic Main boundary

Task Work Proposal の accept/reject は renderer が Work Receipt を組み立てず、`ApplyTaskWorkProposal` へ `proposalId` と decision だけを渡す。
Main はcanonical Proposalを再読込し、expected versionを検証してtyped Start / Append / Done / Blocked commandとProposal statusを一つのrepository transactionへ保存する。
AI Ready TaskのAppend / Done / Blockedは開始Proposalを必須にせず、最初のReceipt採用時にstarted eventを補います。Doneの採用はReceiptを受け入れますがTaskを完了しません。Task完了は人の明示操作で行います。
採用済み・完了済み・中止済みTaskへの追加報告も受け入れ、元の本文・完了日時・work_stateを保持します。追記だけの報告は提出後のTask更新を許容し、判断時の最新versionを確認します。開始と`completed_checklist_item_ids`を含む報告は提出時versionも一致させ、該当IDだけをチェック済みにします。IDの削除・重複・不正値やversion競合時は全体を適用しません。
失敗した command は receipt marker を残さず、同一 envelope の再送は保存済み receipt を返して Entity や ChangeEvent を増やさない。

開始専用`task.start_work`を有効にしたHeadlessでは、本人の個人Taskを使う。UUIDの`work_attempt_id`を開始・報告で共通にし、同じキーの再送でversionも変更しない。再送のreadbackが別の作業単位、別executor、Ready・レビュー・削除済みなら継続着手しない。`tests/ai-task-start.test.mjs`が独立opt-in、拒否、再起動、再委任、同期、人の報告採用を検証する。通常のTask完了は引き続き人間操作とする。

## AI の作業（Task を伴わない report_work）

`tasken.report_work` を `task_id` なしで呼ぶと、Core の `/v1/commands/record-agent-work` が AI の作業を 1 件（種類 `agent_work_record`）だけ書く。案を通さず、Task・Note・Theme は変えず、来歴を作らず、同期の差分は 1 つ。書き手は Core が固定する（HTTP は認証した client 名）。同じ `idempotency_key` と、同じ client・`source_session` でもう記録した時間までの作業は、既にある 1 件を `duplicate` で返す。本人は消せて戻せ、AI は自分が書いた記録だけを `tasken.undo_change` に記録の ID を渡して取り消せる。Desktop の stdio と NAS の HTTP で同じに動くことと、2 台の同期・空の差分（`retired`）の受け方は `tests/agent-work-record.test.mjs` が確かめる。上の Fixed sequence は、`task_id` を付けた委任した Task の作業報告（案）の流れ。

AI が書かなかった会話は、本人が保存先を登録していれば、Desktop が静かになった後（最後の動きから 60 分）にログから 1 件として拾う（`basis = log_pickup`）。AI がもう書いた会話は拾わない。会話の ID が合えば確実。ID を書かなかった記録は、同じ AI・同じリポジトリで、終わりどうしが 10 分以内の時だけ同じ作業と見る。なので `source_session` には、分かる時だけ client の会話の ID を（分からなければ書かない。当て推量の値を書くと、ログの会話と結べず 2 件になる）、`cwd` には作業場所を渡す（Claude Code は shell の環境変数 `CLAUDE_CODE_SESSION_ID`。手引き `tasken://guide/work_report`）。決まりは [engineering-contracts](engineering-contracts.md) の「AI のログからの拾い上げ」、試験は同じ `tests/agent-work-record.test.mjs` と `tests/agent-log-sync.test.mjs`。

## Validation

```powershell
rtk node scripts/run-electron-node.mjs --test tests/ai-collaboration-e2e.test.mjs
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run audit:consistency
git diff --check
```

この検証はMCP client SDKから実stdio bridgeとCoreへ接続する。Claude Code／Codex本体のログイン・設定読込・モデル判断、Electron画面での人の操作を検証したものではない。
