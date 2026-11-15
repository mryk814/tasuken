# Agent session provenance

Issue #498 の Phase 0 で確定した、repository・作業環境・AI session の境界である。
この文書は raw client log の保存形式ではなく、Tasken が所有する canonical data の意味を定める。

> **今の形（#751）**: `AgentSession` はもう新しく作られない。AI の作業は、AI が書く 1 件（`tasken.report_work`）と、Desktop が登録済みの保存先のログから拾う 1 件（`agent_work_record`）に替わった。start/finish の Proposal、lifecycle hooks、ファイルを選ぶ取り込みは無い。受け口 `/v1/commands/propose-agent-session` は、古い hooks が送ってくる終わった会話を AI の作業 1 件に畳んで書き、「受信済み」と答える（会話も案も作らない）。この文書は、今ある古い会話（読むだけ）の意味を読むために残してあり、移行で会話を畳んだ後に消す。今の決まりは [engineering-contracts](engineering-contracts.md) の「AI作業ログの時間表示」と「AI のログからの拾い上げ」。

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
| その日のAI作業を確認するための事実集約                             | Evidence recap           | Session / Packet / Receipt / Activity / referenceから都度生成                        | 人間の判断・内省                                   |
| 一日の記録から日報草稿を作り、後から回答を追記する導線             | Tasken Debrief           | ActivityとSessionを確認し、Feedの「対応待ち」で採用したReport NoteをNotesで編集する  | AIによる人の回答・完了の捏造                       |

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
6. Evidence recapはSession / Packet / Receipt / Activity / referenceから再生成するprojectionとし、日報草稿とNotesで人が追記した回答を混ぜない。

## Vertical-slice boundary

最初のsliceは `WorkingCopy` と `AgentSession` の canonical contract、保存、relation、public sanitizerを通す。
その後、Codexを一つ目のadapterとして start/finish proposal、直前handoff query、Today/Theme/Repository projectionを順に接続する。
すべてのclient自動収集とWork/Private profile分離はこのsliceの対象外である。

## Phase 3 MCP contract

Phase 3 では次の3 toolを公開する。

- `tasken.get_agent_session_context`: current repositoryを既存のcredential-free resolverで解決し、公開可能なRepositoryContext、Theme、Task、WorkingCopy、同じclient種別のAI の作業（`agent_work`。古い会話も新しい記録も同じカードの形。#751）、残りのある直前の 1 件（`previous_handoff`）を返すread-only query。
- `tasken.start_agent_session`: caller、source app/session、開始時刻、client metadata、intent、関連IDを厳格に検証し、`agent_sessions` AI Proposalを作る。
- `tasken.finish_agent_session`: active SessionのID・version・source sessionを照合し、terminal statusと構造化outcomeを`agent_sessions` AI Proposalとして作る。

start/finishはofficial `AgentSession` や `Reference` を直接更新しない。
利用者がAgent Deskで内容を確認し、`ApplyAiProposal` を実行した時だけcanonical dataへ反映する。
start時のintentとclient metadataはfinish時に変更できず、finishはoutcomeだけを追加する。
同じidempotency keyと同じrequestは、Proposal受理後や人間の採用後もduplicateとして同じsession/proposal identityを返す。
同じkeyへ異なるrequestを送った場合はconflictとする。

handoff queryはraw transcriptやlocal pathを返さない。
current repositoryまたはそのWorkingCopyへ`Reference`されたSessionと、そのrepositoryのIDを持つ新しい記録を対象にし、現在のsource session自身を除いた、残りのある（か止まった）最新の 1 件を`previous_handoff`として返す。

## Phase 5 Tasken Debrief

Evidence recapは`AgentSession`、Session Packet、`Reference`、`WorkReceipt`、`ChangeEvent`、external referenceから毎回導出する。
日報はClaude CodeなどのMCP prompt「Tasken日報」（`daily-report`）から、当日Activityとrepository関連Sessionを使って草稿として提案する。

- Todayの`AI work`は当日のSessionをTheme・Repository横断で並べ、前日以前でもblockedまたはremaining workを持つSessionを引き継ぎとして残す。
- Theme詳細の`Recent AI work`は同じprojectionをThemeで絞り込む。
- 各SessionはIntent → Outcome → 残りを一続きに表示し、関連Task、Work Receipt、Activity、commit・PR/MR等のexternal referenceへ展開できる。
- `Tasken Debrief`はActivityを最上部に表示し、その下でAI作業をカードとして確認する。カードはhoverまたはfocusでIntent、Outcome、残り、記録された確認をpreviewする。
- AIは当日の根拠に沿う可変の問いと空の回答欄を含むReport草稿をproposalとして送る。人はFeedの「対応待ち」で採用した後、NotesのMarkdownを編集して回答する。
- `tasken.propose_note`はReport Proposalを作るだけで、採用前にNoteを保存せず、TaskやReferenceを作らない。採用後は`properties_json.daily_report.date`で対象日を識別する。
- WorkingCopyとのrelationは公開可能なRepositoryContextへ投影し、local pathを表示しない。

client固有のraw logはprojectionへ直接渡さず、Session Packetで不足または矛盾がある場合だけsafe source locatorから追加参照する。
Codex、Claude Code、Cursor、GitHub CopilotはいずれもPhase 3の同じcanonical Agent Session contractへ正規化してから表示する。
この契約互換は複数client fixtureで検証するが、各clientのnative log自動収集はPhase 4の別adapter作業として残す。

## Phase 4 lifecycle collection（切った）

client の lifecycle hooks で会話を集める仕組みは切った（#751）。hook の受け取り・再送・入れる手順は無い。前に hooks を入れた PC は、README の「古い hooks を外す」の手順で外す。外すまでの間、古い hook が送ってくる終わった会話は、Core が AI の作業 1 件に畳んで書いてから「受信済み」と答える（hook は手元の控えを消すので、捨てずに記録へ移す）。
