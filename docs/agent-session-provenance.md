# Agent session provenance

Issue #498 の Phase 0 で確定した、repository・作業環境・AI session の境界である。
この文書は raw client log の保存形式ではなく、Tasken が所有する canonical data の意味を定める。

## Concrete referent map

| 実在する対象                                                       | Tasken の概念            | 同一性                                                                               | 含めないもの                                       |
| ------------------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------- |
| GitHub / GitLab / Azure DevOps / local git 上の一つの論理 codebase | `RepositoryContext`      | provider-neutral な canonical remote identity、または端末内だけで使う local identity | clone、worktree、AI client、session                |
| ある端末に存在する一つの clone または worktree                     | `WorkingCopy`            | Tasken が発行する opaque UUID                                                        | absolute path を cross-tool identity にすること    |
| coding agent と利用者が一続きに行った一回の作業                    | `AgentSession`           | Tasken が発行する UUID。client 側 ID は provenance に限る                            | raw transcript、hidden reasoning、Task の完了判定  |
| Session 開始時に利用者が求めたこと                                 | `AgentSession.intent`    | session 作成時の記録                                                                 | 終了時に AI が後付けした要約                       |
| Session 終了時に実際に分かったこと・残ったこと                     | `AgentSession.outcome`   | session 終了時の構造化 handoff                                                       | 開始時 intent の上書き                             |
| Task work の結果と人間の確認対象                                   | `WorkReceipt`            | 既存の append-only receipt                                                           | session metadata の代替、AI 報告だけでの Task 完了 |
| 保存・更新・関連付け等の細粒度な事実                               | `ChangeEvent` / Activity | 既存 event identity と origin                                                        | session summary や日報本文                         |
| commit、branch、PR/MR、pipeline、file 等の証拠                     | external reference       | provider-neutral kind と安全な locator                                               | provider API の raw response、credential           |
| その日の記録の読みやすい集約                                       | NIPPO projection         | Session / Receipt / Activity / reference から都度生成                                | 新しい一次正本                                     |

## Naming decision

`WorkingCopy` を採用する。

- 既存の `Workspace` はアプリ全体の保存 aggregate を指すため、同名にしない。
- `ExecutionContext` は一回の process/run に見え、端末上に継続して存在する clone/worktree の referent とずれる。
- `WorkingCopy` は Git provider や OS に依存せず、同じ repository の複数 clone/worktree を区別する責務に限定できる。

## Canonical contracts

### WorkingCopy

`WorkingCopy` は一つの `RepositoryContext` に属するローカル作業場所の登録である。

```text
id
repository_context_id
device_id
storage_root_id
worktree_identity?
branch_hint?
active
last_seen_at?
created_at / updated_at / deleted_at / version / source
```

`storage_root_id` はローカル resolver が実パスへ変換する opaque identity とする。
absolute path は `WorkingCopy` の canonical record、Snapshot、MCP/public projectionへ保存・公開しない。

### AgentSession

`AgentSession` は client/provider 非依存の一回の作業単位である。

```text
id
started_at
ended_at?
status: active | completed | blocked | abandoned
client_kind: codex | claude_code | cursor | github_copilot | other
client_label?
agent_label?
provider_label?
model_label?
source_session_id?
intent: { summary, requested_outcome?, boundary? }
outcome?: {
  summary,
  decisions[],
  changed_items[],
  verification[],
  remaining_work[],
  next_suggested_action?
}
created_at / updated_at / deleted_at / version / source
```

Session と Theme / Task / RepositoryContext / WorkingCopy / WorkReceipt / ChangeEvent / external evidence の対応は多対多である。
Task 未割当、複数 Task、複数 repository を許容する。関連は既存 `Reference` contractを拡張して表す。

## Existing concepts reused

- `RepositoryContext`: logical repository identity、remote正規化、Theme/Task inheritance、current repository resolveを再利用する。
- `Reference`: Session と domain entity の多対多 relationを表す。
- `WorkReceipt`: Task work の outcome・verification・remaining work と人間確認を再利用する。
- `ChangeEvent` / Activity: Session中に起きた細粒度 fact と `origin.session_id` を再利用する。
- external reference: commit / PR / MR 等の証拠表現を再利用する。
- AI proposal: coding agent からの start/finish/handoff write は既存の確認境界を越えず、proposalとして受ける。

## Non-negotiable compatibility conditions

1. 既存 `RepositoryContext` の canonical identity、Theme の複数 repository、Task の `inherit / extend / override` は変更しない。
2. WorkReceipt は append-only の人間確認対象であり、AI報告だけで Task を完了させない。
3. 既存 Workspace / Snapshot / Import / Export は旧データを読み続け、追加 migration は append-only・idempotent にする。
4. absolute local path、credential、provider API raw response、raw transcript、hidden reasoningをMCP/public projectionへ出さない。
5. client adapter は canonical `AgentSession` inputへ変換するだけにし、新client追加でdomain schemaを変更しない。
6. NIPPOは Session / Receipt / Activity / referenceから再生成するprojectionとし、日報用の二重正本を作らない。

## Vertical-slice boundary

最初のsliceは `WorkingCopy` と `AgentSession` の canonical contract、保存、relation、public sanitizerを通す。
その後、Codexを一つ目のadapterとして start/finish proposal、直前handoff query、Today/Theme/Repository projectionを順に接続する。
すべてのclient自動収集とWork/Private profile分離はこのsliceの対象外である。

## Phase 3 MCP contract

Phase 3 では次の3 toolを公開する。

- `tasken.get_agent_session_context`: current repositoryを既存のcredential-free resolverで解決し、公開可能なRepositoryContext、Theme、Task、WorkingCopy、同じclient種別の関連Session、直前のterminal handoffを返すread-only query。
- `tasken.start_agent_session`: caller、source app/session、開始時刻、client metadata、intent、関連IDを厳格に検証し、`agent_sessions` AI Proposalを作る。
- `tasken.finish_agent_session`: active SessionのID・version・source sessionを照合し、terminal statusと構造化outcomeを`agent_sessions` AI Proposalとして作る。

start/finishはofficial `AgentSession` や `Reference` を直接更新しない。
利用者がAI Inboxで内容を確認し、`ApplyAiProposal` を実行した時だけcanonical dataへ反映する。
start時のintentとclient metadataはfinish時に変更できず、finishはoutcomeだけを追加する。
同じidempotency keyと同じrequestは、Proposal受理後や人間の採用後もduplicateとして同じsession/proposal identityを返す。
同じkeyへ異なるrequestを送った場合はconflictとする。

handoff queryはraw transcriptやlocal pathを返さない。
current repositoryまたはそのWorkingCopyへ`Reference`されたSessionだけを対象にし、現在のsource session自身を除いた最新のterminal outcomeを`previous_handoff`として返す。
