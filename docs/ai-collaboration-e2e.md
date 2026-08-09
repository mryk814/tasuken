# AI collaboration E2E contract

Issue #364 の統合証跡は `tests/ai-collaboration-e2e.test.mjs` を正本とする。
テストは production credential や network provider を使わず、temp SQLite と actual stdio MCP server、provider/model 名だけが異なる二つの fake provider で同じシナリオを実行する。

## Fixed sequence

1. pre-#277/#278 形式の Theme / Task / Note を SQLite へ bootstrap し、Task に human requester、AI executor、RepositoryContext を割り当てる。
2. actual stdio MCP の `tasken.get_task_context` で Task、assignment、安全な repository locator、関連 Note を取得する。
3. `tasken.start_task_work` を再送し、Inbox 上の idempotency と Main の `ApplyTaskWorkProposal` 採用を確認する。
4. `tasken.append_work_receipt` 採用後も `in_progress` を維持する。
5. 一つ目の `tasken.report_task_done` を Main で reject し、Task と Receipt が変わらないことを確認する。
6. 二つ目の done proposal 採用途中へ failure を注入し、Task / Work Receipt / ChangeEvent / Proposal status が同じ SQLite transaction で rollback することを確認する。
7. 同じ proposal を正常採用し、`needs_human_review` になった後も AI の Task 直接変更・完了を拒否する。
8. human `AcceptTaskWork` 後だけ `CompleteTask` を許可する。
9. DB と stdio MCP を再起動し、Proposal、Receipt、ChangeEvent、RepositoryContext、`work_receipt -> task / created_for` backlink を再取得する。
10. provider A/B の Task、repository locator、MCP context、Proposal、Receipt schema が一致し、差分が Receipt の `runtime_metadata.provider/model` だけであることを比較する。

## Atomic Main boundary

Task Work Proposal の accept/reject は renderer が Work Receipt を組み立てず、`ApplyTaskWorkProposal` へ `proposalId` と decision だけを渡す。
Main は canonical Proposal を再読込し、expected version を検証して typed Start / Append / Done / Blocked command と Proposal status を一つの repository transaction へ保存する。
失敗した command は receipt marker を残さず、同一 envelope の再送は保存済み receipt を返して Entity や ChangeEvent を増やさない。

## Validation

```powershell
node --test tests/ai-collaboration-e2e.test.mjs tests/mcp-task-context.test.mjs tests/task-work-receipts.test.mjs tests/application-command.test.mjs
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run audit:consistency
git diff --check
```
