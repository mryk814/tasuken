# AI collaboration E2E contract

Issue #364 の統合証跡は `tests/ai-collaboration-e2e.test.mjs` を正本とする。
テストは production credential や network provider を使わず、temp SQLite と actual stdio MCP server、provider/model 名だけが異なる二つの fake provider で同じシナリオを実行する。
加えて、明示的な `start_task_work` を使うシナリオも同じ採用・再起動経路で検証する。

## Fixed sequence

1. pre-#277/#278 形式の Theme / Task / Note を SQLite へ bootstrap し、Task に human requester、AI executor、RepositoryContext を割り当てる。
2. actual stdio MCP の `tasken.list_agent_ready_tasks` で候補を見つけ、`tasken.get_task_context` で Task、assignment、安全な repository locator、関連 Note を取得する。一覧・Context読取では永続データが変わらないことも確認する。
3. 開始方法を二つ検証する。明示開始では `tasken.start_task_work` がProposalを作らず `in_progress` を保存し、返却された `value.task.version` を後続Receiptの `expected_version` に使う。同じ開始リクエストの再送で書込が重複せず、AI Ready一覧から対象が外れることも確認する。開始省略ではAI Ready Taskへ直接 `tasken.append_work_receipt` を送り、採用時にstarted eventとReceiptが同じtransactionで保存されることを確認する。いずれもReceiptは人の採用まで正式保存されない。
4. 一つ目の `tasken.report_task_done` を Main で reject し、Task と Receipt が変わらないことを確認する。
5. 二つ目のdone proposal採用途中へfailureを注入し、Task / Work Receipt / ChangeEvent / Proposal statusが同じSQLite transactionでrollbackすることを確認する。
6. 同じproposalを正常採用し、その一回の人間判断でReceipt受入れとTask完了まで進み、AIのTask直接変更・完了は引き続き拒否されることを確認する。
7. 同じdecisionの再送が保存済みreceiptを返し、EntityやChangeEventを増やさないことを確認する。
8. DBとstdio MCPを再起動し、Proposal、Receipt、ChangeEvent、RepositoryContext、`work_receipt -> task / created_for` backlinkを再取得する。
9. provider A/BのTask、repository locator、MCP context、Proposal、Receipt schemaが一致し、差分がReceiptの`runtime_metadata.provider/model`だけであることを比較する。

## Atomic Main boundary

Task Work Proposal の accept/reject は renderer が Work Receipt を組み立てず、`ApplyTaskWorkProposal` へ `proposalId` と decision だけを渡す。
Main はcanonical Proposalを再読込し、expected versionを検証してtyped Start / Append / Done / Blocked commandとProposal statusを一つのrepository transactionへ保存する。
AI Ready TaskのAppend / Done / Blockedは開始Proposalを必須にせず、最初のReceipt採用時にstarted eventを補います。Doneの採用は同じ人間判断内でReceipt受入れとTask完了まで保存します。
失敗した command は receipt marker を残さず、同一 envelope の再送は保存済み receipt を返して Entity や ChangeEvent を増やさない。

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
