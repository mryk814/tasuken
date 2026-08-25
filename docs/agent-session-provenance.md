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

## Phase 5 projection

NIPPO表示は新しいdaily report entityを保存せず、`AgentSession`、`Reference`、`WorkReceipt`、`ChangeEvent`、external referenceから毎回導出する。

- Todayの`AI work`は当日のSessionをTheme・Repository横断で並べ、前日以前でもblockedまたはremaining workを持つSessionを引き継ぎとして残す。
- Theme詳細の`Recent AI work`は同じprojectionをThemeで絞り込む。
- 各SessionはIntent → Outcome → 残りを一続きに表示し、関連Task、Work Receipt、Activity、commit・PR/MR等のexternal referenceへ展開できる。
- WorkingCopyとのrelationは公開可能なRepositoryContextへ投影し、local pathを表示しない。

client固有のraw logはprojectionへ直接渡さない。
Codex、Claude Code、Cursor、GitHub CopilotはいずれもPhase 3の同じcanonical Agent Session contractへ正規化してから表示する。
この契約互換は複数client fixtureで検証するが、各clientのnative log自動収集はPhase 4の別adapter作業として残す。

## Phase 4 lifecycle collection

### Concrete referent map

| Source | Purpose | Concrete referent | Role | Order or relation | Label |
| --- | --- | --- | --- | --- | --- |
| client lifecycle hook | sessionの開始・入力・応答・終了を知らせる | client固有の一回のhook JSON | 一時的な観測event | 同じclient session IDで束ねる | hook event |
| Tasken userData内のJSON | Tasken停止中を含め、完結まで欠落させない | 一つのclient sessionについて集約中の端末内レコード | local-only retry state | start → first intent → latest response → end | session observation |
| AI Inboxの一件 | Intentとterminal Outcomeが揃ったSessionを人が確認する | 完結したcanonical AgentSession候補 | Proposal | session observationから一回だけ生成 | Agent Session record |

`session observation`は正式データではない。absolute pathをrepository解決に使う場合も端末内と認証済みloopback Coreに閉じ、ProposalへはopaqueなRepositoryContext / WorkingCopy IDだけを送る。

### Collection flow

```text
SessionStart ─┐
first prompt ─┼→ local session observation → SessionEnd → one Agent Session Proposal → AI Inbox
last response ┤                                   │
SessionEnd ───┘                                   └─ Core停止中は保持して再送
```

開始と終了を別Proposalにしないことで、開始Proposalの採用待ち中に終了hookが来てもOutcomeを失わない。
正式AgentSessionとReferenceは従来どおりAI Inboxで採用した時だけ保存する。

収集対象はcanonical metadataだけである。transcript fileは読まず、hidden reasoning、tool call列、client固有raw schemaを保存しない。
最初に観測したuser promptをIntentとして固定し、最後に観測したassistant responseをOutcome候補にする。後続promptでIntentを上書きしない。

### Client adapters

同梱`agent-session-hook.mjs`はstdinのclient固有JSONを次の共通eventへ変換する。

| client | lifecycle events | source session ID | Intent source | Outcome source | terminal boundary |
| --- | --- | --- | --- | --- | --- |
| Codex | `SessionStart` / `UserPromptSubmit` / `Stop` / `SessionEnd` | `session_id` | first `prompt` | latest `last_assistant_message` | `SessionEnd` |
| Claude Code | `SessionStart` / `UserPromptSubmit` / `Stop` / `SessionEnd` | `session_id` | first `prompt` | latest `last_assistant_message` | `SessionEnd` |
| Cursor | `sessionStart` / `beforeSubmitPrompt` / `afterAgentResponse` / `sessionEnd` | `conversation_id` / `session_id` | first `prompt` | latest response `text` | `sessionEnd` |
| GitHub Copilot | `sessionStart` / `userPromptSubmitted` / `agentStop` / `sessionEnd` | `sessionId` / `session_id` | `initialPrompt`またはfirst `prompt` | 利用可能なresponseのみ | `sessionEnd` |

各clientのhook仕様は変化しうるため、adapter fixtureで互換を固定する。公式仕様で得られないOutcomeをtranscript解析で補完せず、終了理由を明示した最小handoffを作る。

### Hook command

開発版:

```text
node scripts/agent-session-hook.mjs --client codex
node scripts/agent-session-hook.mjs --client claude_code
node scripts/agent-session-hook.mjs --client cursor
node scripts/agent-session-hook.mjs --client github_copilot
```

インストール版はTaskenの`resources/mcp/agent-session-hook.mjs`を同じ引数で起動する。
各clientでは上表の4 eventを同じcommandへ接続する。hookは必ずJSON objectをstdoutへ返し、Tasken未起動時の診断はstderrだけに出すためagent loopを妨げない。

未送信のterminal observationは次で再送できる。

```text
node agent-session-hook.mjs --flush
```

### Codex user hook installation

Codexのuser hookは既存の`~/.codex/hooks.json`を置換せず、Taskenが所有するcommand handlerだけを追加・更新する。

```text
npm run hooks:codex:install
npm run hooks:codex:status
npm run hooks:codex:uninstall
```

`install`はstandalone bundleを`~/.codex/hooks/tasken-agent-session-hook.mjs`へコピーし、`SessionStart` / `UserPromptSubmit` / `Stop` / `SessionEnd`を接続する。`SessionStart`では未送信terminal observationの再送も行う。再実行は冪等で、変更前の`hooks.json`はtimestamp付きbackupへ退避する。`uninstall`はTasken handlerとmanaged bundleだけを削除し、他のhookは維持する。

導入後は新しいCodex sessionで`/hooks`を開き、表示されたTasken hookのcommandとsourceを確認して信頼する。信頼されるまでCodexは非managed hookを通常実行しない。

明示的な紐づけが必要な場合だけ`TASKEN_AGENT_SESSION_THEME_IDS` / `TASKEN_AGENT_SESSION_TASK_IDS`へcomma区切りのIDを渡す。未指定時はrepositoryを一意に解決し、Theme / WorkingCopyも一意な場合だけ自動で関連付ける。Task候補は自動選択しない。
