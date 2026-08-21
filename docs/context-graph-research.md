# Context / Provenance Graph Research（Issue #332）

更新日: 2026-08-09

## 結論

TaskenのGraphは、全データを別のKnowledgeNodeへ変換する機能でも、巨大なCanvasでもない。
正本SQLiteにある明示的な関係と履歴を、AI Contextと人間の確認に使える「根拠付きの限定経路」として投影する。

Knowledge UIはこのprojectionの所有者ではない。Knowledge画面は既存データのResearch / Diagnostic表示に限定し、Context GraphとAI ContextはKnowledgeを手動整理しなくても独立して成立する。

今回の実証では、既存Workspace collectionをread-onlyで走査する純粋なprojection/queryを追加した。
正本のINSERT/UPDATE、schema migration、backfillは行わない。
MCPには `tasken.get_context_subgraph` をread-onlyで追加し、既存の#294 AI公開範囲判定を通過したEntityだけを、最大2 hop・件数・edge数・token概算で返す。
Suggested relationは既定で除外し、含めても `status: "suggested"` のままなので事実へ昇格しない。

### 実装した範囲

- `src/shared/contextGraph.mjs`: 既存collectionから再構築可能なGraph projection、neighbors/provenance/context query、selection explanation。
- `src/main/core/services/agentContextQueryService.ts`: 注入repositoryからprojectionを呼び、MCPはTasken Core経由で利用する。
- `src/main/mcp/server.mjs`: `tasken.get_context_subgraph` read-only MCP tool。
- `tests/context-graph.test.mjs`: fixtureでConversation→Note→Artifact、Capture→Task、Decision→Evidence、Change Event、cycle/duplicate/limit/suggestedを検証。

### Conversation Lineageへの投影（#283）

- `src/shared/conversationLineage.mjs`: 共通Context GraphからConversation/Entityの上流・下流を最大2段階で取得し、派生と単なる参照を分離する局所read model。
- `src/renderer/src/features/workspace/components/LineagePanel.tsx`: Chat Ref / Task / Note / Artifactで同じlist/tree/path表示を使う。自由配置Canvas、pan、zoom、node位置編集は持たない。
- Conversation詳細の「Taskを作る」「Noteを作る」は、作成Entityと`derived_from` Referenceを同じ保存単位で確定する。Noteは`document:save`の正本Markdown経路を使い、対象Noteをsourceとする`derived_from` Referenceだけを型付きcompanionとして同一DB transactionへ含める。file成功・DB失敗時はcompanionもcanonical recovery receiptから復旧し、保存成功時は`note`と`reference`をrendererへ変更通知する。続きConversationは`parent_resource_id`、Artifactは既存`source_type/source_id`と`origin_note_id`を正本にする。
- 表示は「直接 / 2段階」で切り替え、上流・下流の各区分を24件までとする。cycleはvisited setで停止し、上限超過を画面へ明示する。
- `lineageContextSelection()` はMCPの`tasken.get_context_subgraph`と同じbounded/path/reasonの考え方で、assertedなlineage predicateだけを選べる。MCPの実装・公開範囲policyは#279側を正本とし、Conversation本文はこの投影へ複製しない。

## 1. Architecture契約

### 1.1 Graphの目的

目的は次の2つに限定する。

1. **Context**: いまのEntityを理解するために、直接関係するTheme、Task、Note、Conversation/ChatRef、Artifact、Evidence、Dependencyをboundedに取得する。
2. **Provenance**: その内容がどこから来たか、どの変更・source・exportを経たかを、sourceと理由付きで辿る。

検索・類似度・自由連想の代替ではない。
AIの初期取得は明示的なrelation/provenanceを優先し、semantic候補は別枠にする。

### 1.2 4層分離

| 層 | 責務 | 今回の扱い |
|---|---|---|
| Graph data model | typed Entity、assertion、predicate、layer、origin、evidence、visibility等 | 既存fieldを壊さず、projectionのedge契約として定義 |
| Traversal | 1–2 hop、direction、cycle/duplicate防止、limit/token budget、reason/path | `contextGraph.mjs` の純粋関数 |
| Storage / engine | SQLite正本、必要なら再構築可能なderived sidecar | SQLite正本。Graph DBは導入しない |
| Human / AI presentation | list/tree/path、MCP JSON、Context Preview | Canvasを主役にしない。今回MCP最小prototypeのみ接続 |

### 1.3 Assertion契約

将来のrelation assertionは以下を最低契約とする。

```json
{
  "id": "stable assertion id",
  "subject": { "type": "note", "id": "note-1" },
  "object": { "type": "artifact", "id": "artifact-1" },
  "predicate": "generated_from",
  "layer": "provenance",
  "origin": "application_command|import|user|legacy|ai",
  "status": "asserted|suggested|rejected|superseded",
  "confidence": "high|medium|low|null",
  "evidence_refs": ["change-event-or-source-id"],
  "valid_from": "ISO-8601|null",
  "valid_to": "ISO-8601|null",
  "recorded_at": "ISO-8601",
  "visibility": "policy result",
  "authority": "user_confirmed|imported|ai_generated|inferred|unknown",
  "freshness": "current|stale|superseded|unknown"
}
```

現在の `reference` / `knowledge_edge` にはこの全項目がない。
したがって、今回のprojectionは保存済みの明示pointerを `asserted` として扱うが、欠けているorigin/evidence/freshnessを推測で補わない。
`knowledge_edge`の将来のAI候補は `suggested` の別経路でしか返さない。

### 1.4 3つのrelation layer

- **operational**: Theme所属、親子、triage、schedule owner、dependency、ユーザーが保存したreference。
- **provenance**: source_record、entity_source、Artifact source/origin、ChatRefのcontinued_as、Change Event。
- **semantic**: Knowledge edgeなど意味的な関係。明示保存済みのedgeと、AIが提案した候補を同じ事実として扱わない。

保存・導出・提案の境界は次の通り。

| 区分 | 例 | 正本性 |
|---|---|---|
| persistent asserted | 既存Entity field、reference、dependency、source_record、change_event | SQLite正本。ユーザー操作/commandで作る |
| derived | Themeからの近傍、path、Activityへの投影、同一edgeのdedupe | query時に再計算。削除/再構築可能 |
| suggested | semantic similarity、AIのsupport/relation候補 | proposal/inbox相当。明示採用まで事実にしない |

visibility / authority / freshnessはrelationとNode本文の両方で評価する。
MCPは既存 `projectEntityForAi` / `summarizeAiExclusions` と同じ公開先ポリシーを通し、除外理由を漏らさない。

## 2. 現行Relation / Source監査表

監査対象は、現在の正本・projection・入口を実装のfieldまで追った14系統。
「強度」はGraphで初期候補にする優先度であり、truthの意味を追加するものではない。

| Relation / source | source schema / direction | 強度 / 作成入口 | 欠損・危険 | backfill可否 | 正本（具体的file / field） |
|---|---|---|---|---|---|
| Theme所属 | `task/note/resource/capture_entry/plan_node/sketch -> theme`。canonicalは`project_id`、legacyは`theme_id` | strong operational。各作成/編集drawer、Today、Notes、Inbox | legacy/canonical混在。`capture_entrys` collection名とdomain型`capture_entries`の境界がある | read projectionは可。自動書換えは不可 | `src/shared/entityRegistry.mjs`の`themeField/legacyThemeFields`; `domain-model/types.ts`; `workspaceRepository.mjs`の`validateReferences` |
| Task親子 | `task -> task`、`parent_task_id` | strong operational。Todo/Todayのform/persistence | 参照切れ・循環は保存時拒否。旧item projectionとのID対応に注意 | 欠損報告・read projectionのみ可 | `domain-model/types.ts`; `persistence.ts`; `repositoryGraphPolicy.mjs`; `workspaceRepository.mjs` |
| PlanNode親子 | `plan_node -> plan_node`、`parent_plan_node_id` | strong operational。Timeline form/persistence | 参照切れ・循環。legacy timeline projectionで別ID表示がある | read projection可 | `TimelinePage.tsx`; `timelineProjection.ts`; `repositoryGraphPolicy.mjs` |
| Task→Plan / Waiting→Task | `task.plan_node_id`; `waiting.task_id` | strong operational。Task/Waiting保存・triage | domain invariantはendpoint存在を検証するが履歴/根拠は別 | read projection可 | `domain-model/types.ts`; `invariants.ts`; `workspaceRepository.mjs` |
| Capture triage | `capture_entry -> {triaged_to_type,triaged_to_id}` | strong operational。Inboxのtriage command | direct save/旧経路でChange Eventが必ずしもない | pointerはbackfill可、履歴は推測不可 | `InboxPage.tsx`; `persistence.ts` `buildTriageCaptureEntryOperations`; `workspaceRepository.mjs` |
| Schedule | owner `task/waiting/plan_node -> schedule`、`owner_type/owner_id` | strong operational/temporal。Today/Timeline/Waiting | 時間の意味は`date_kind/confidence/granularity`に分かれる。日付だけでActivityを推定しない | owner pointerのprojection可 | `domain-model/types.ts`; `timelineProjection.ts`; `selectors.ts`; `workspaceRepository.mjs` |
| Task dependency | `task -> task`、`task_id/depends_on_task_id` | strong operational。Task form/duplicate/command | cycle禁止。dependency typeの意味をpath理由に残す必要あり | endpointが存在するものだけprojection可 | `domain-model/types.ts`; `repositoryGraphPolicy.mjs`; `invariants.ts` |
| Plan dependency | `plan_node -> plan_node`、`plan_node_id/depends_on_plan_node_id` | strong operational。Timeline | cycle禁止。Task dependencyと混ぜない | endpointが存在するものだけprojection可 | `domain-model/types.ts`; `repositoryGraphPolicy.mjs`; `timelineProjection.ts` |
| Generic Reference | `source_type/source_id -> target_type/target_id`、`relation_type`は`related_to/derived_from/mentions/blocks/supports` | strong operational。drawer/form、AI import preview | origin/status/visibility/freshnessがない。旧保存経路の作成履歴が薄い | explicit pointerはprojection可。意味やconfidenceの補完不可 | `domain-model/types.ts`; `domain.mjs`; `workspaceRepository.mjs` |
| Knowledge edge | `knowledge_node -> knowledge_node`、`source_node_id/target_node_id/relation_type` | semantic。Knowledge UI、AI import preview | status/origin/evidenceがschemaにない。directional cycleは拒否、weak relationは別扱い | read audit/backfill候補の列挙のみ。新正本へ変換不可 | `domain-model/types.ts`; `repositoryGraphPolicy.mjs`; `knowledgeLinks.ts`; `knowledgeHealth.mjs` |
| Artifact provenance | `artifact -> source`、`source_type/source_id`、補助`origin_note_id` | strong provenance。Note export、Capture/ChatRef/Task artifact | `chat_ref`等の意味ラベルと実体typeのmappingが必要。削除時policyはsource別 | `chat_ref→resource`, `task→task`, `note→note`, `report→note`, `theme→theme`, `capture_entry→capture_entry`, `ai_proposal→ai_proposal`だけを支持。未知labelはedgeにしない | `src/main/repositories/domain.mjs` `artifactSourceEntityTypes`; `src/shared/artifactLinks.mjs`; `noteExportArtifacts.ts`; `repositoryDeletePolicy.mjs` |
| Source record / entity source | Entity→`source_record`、`entity_source.entity_type/entity_id/source_record_id`。Registry上のsource record必須表示fieldは`source_title` | strong provenance/import。Conversation import、source binding | source recordの本文・provider情報とEntity本文を混ぜない。locatorはAI metadata側 | pointerは可。source本文の再生成は不可 | `entityRegistry.mjs`; `workspaceRepository.mjs`; `ConversationImportDialog.tsx`; `aiMetadata.mjs` `ai_source_refs` |
| ChatRef lineage | `resource -> resource`、`parent_resource_id`。ChatRef判定はscope/provider/status | provenance。ChatRefs UIのcontinued chat | resourceはConversation本体ではなく参照/ログ入口。Notesへ重複移動しない | parent pointerのprojection可 | `domain-model/types.ts`; `chatRefs.ts`; `ChatRefsPage.tsx` |
| Change Event / Activity | `change_event -> entity`、`entity_type/entity_id/changed_at/before_json/after_json` | strong provenance/temporal。persistence builders、Activity export | Notes/Quick Capture/Today miniのdirect saveで全て自動生成されるわけではない | eventがない過去操作を推測で作らない | `persistence.ts`; `activityLog.ts`; `WorkspaceApp.tsx`; `#315` / `#336` |

### 監査上の重要な欠損

1. Relationの保管場所は既存Entity field、専用collection、Change Eventの三つに分散している。
2. `reference`と`knowledge_edge`は、方向とendpointはあるが、assertionのorigin/evidence/authority/freshness/statusが不足する。
3. Change Eventは保存builderの一部には接続済みだが、direct save経路の全てを覆っていない。これは#315→#336→#337の責務であり、本Researchで過去履歴を捏造しない。
4. 旧MCPはkeyword search/list/AI Pack中心でexplicit relation traversalがなかった。現在のCore subgraph queryはAI公開判定前に本文を返さず、relation/pathを返す最小追加である。

## 3. Bounded projection / query prototype

### 3.1 入力と正本

`projectContextGraph(workspace)`はEntity Registryのcollectionを読むだけで、入力を変更しない。
SQLite rowの`entities(entity_type,id,data_json,...)`は引き続き正本であり、Graphは毎回再構築できるderived read modelである。
sidecarを将来追加する場合も、row version/schema versionから再生成できるキャッシュに限定する。

新しい`RawRecord`正本、KnowledgeNodeへの一括変換、Neo4j/GraphRAG依存、migration実行は行わない。
Entity type/idは常に `{type,id}`で返す。文字列IDだけを混ぜない。

### 3.2 取得規則

- default `max_hops=2`（MCP入力も最大2）。
- default `max_nodes=24` / `max_edges=48` / `token_budget=2400`。各値に上限を置く（`max_edges=0`はpure queryではseedのみを許可、token budgetはprotocol overheadを除くpayload概算で最低16）。
- visited nodeとedge keyでcycle/duplicateを止める。
- Edge選択は `asserted`/`accepted`、operational/provenance、predicate/target IDの順で安定化。
- statusはfail-closed。空欄の既存relationだけをlegacy assertedとして扱い、`rejected`/`superseded`/`unknown`/未知statusは`status_raw`を保ったままqueryから除外する。
- `suggested`はdefault false。trueでもstatusを保持し、`suggested_is_fact=false`をJSONに含める。
- 各edgeに`reason`と`path`を付ける。direct relationとbounded pathを区別する。
- `paths.from/to`もopaqueな文字列キーではなく `{type,id}`を返し、edge endpointと同じtyped identityで整合させる。
- token budgetをJSON概算（文字数/4）で計算し、超過時はedge/nodeを末尾から切り詰め、`truncated`と`exclusions`を返す。
- edge admission後にnodeを追加し、上限・token切詰め後はseedから保持pathを再到達判定する。したがって孤立node、endpointのないedge、存在しないpath edge IDを返さない。
- 本文はgraph projectionに含めない。本文取得は既存AI公開範囲・Context Previewの同一policyを通る次段とする。
- seed自身にも同じAI公開範囲を適用する。seedがlocal-onlyならneighborを一件も返さず、hidden neighborもpathから除外する。
- `evidence_refs`は専用recordのstable IDまたは`{type,id}`だけを受け、`description`本文をevidence IDへ昇格させない。

`traceProvenance`の方向はedgeの向きに対して明示する。
`upstream`はsubject→object（Artifact→source、Entity→source_record）、`downstream`はobject→subject（source→Artifact）で、既定は両方向である。
返すpathは常に保存edgeの向きを保持するため、両方向を同じ「sourceから来た」と再解釈しない。

### 3.3 MCP bounded subgraph JSON案

最小prototype `tasken.get_context_subgraph` の形は次の通り。

```json
{
  "seed": { "type": "artifact", "id": "artifact-1" },
  "nodes": [
    { "type": "note", "id": "note-1", "title": "Graph decision note", "updated_at": "..." }
  ],
  "edges": [
    {
      "id": "[\"artifact\",\"artifact-1\",\"derived_from\",\"note\",\"note-1\"]",
      "source": { "type": "artifact", "id": "artifact-1" },
      "target": { "type": "note", "id": "note-1" },
      "predicate": "derived_from",
      "layer": "provenance",
      "status": "asserted",
      "origin": "artifact.source",
      "reason": "direct_relation",
      "path": ["[\"artifact\",\"artifact-1\",\"derived_from\",\"note\",\"note-1\"]"]
    }
  ],
  "paths": [],
  "limits": { "max_hops": 2, "max_nodes": 24, "max_edges": 48, "token_budget": 2400 },
  "estimated_tokens": 220,
  "truncated": false,
  "exclusions": [],
  "policy": { "asserted_first": true, "suggested_included": false, "suggested_is_fact": false },
  "ai_audience": "coding_agent",
  "read_only": true
}
```

候補4操作のうち、今回実装・評価した最小単位は`get_context_subgraph`である。
`get_entity_neighbors`は`max_hops=1`のprojection wrapper、`trace_provenance`と`explain_context_selection`はshared pure APIとして接続可能な形にした。
MCP toolを増やす場合もこの同じprojectionを呼び、別の検索結果・別の公開policyを作らない。

## 4. Fixture evaluation

`tests/context-graph.test.mjs`のpure fixtureには以下を用意した。

- Conversation/ChatRef `resource:chat-1` → explicit `reference` → `note:note-1` → `artifact:artifact-1`、さらに`source_record`。
- `capture_entry:capture-1` → `task:task-1`。
- `knowledge_node:decision-1` → `knowledge_node:evidence-1`（supports）、Decisionのsource Note。
- `change_event:event-note-1` → changed Note、`changed_at`によるActivity時間入口。
- disconnected resource/note、cycle-shaped Task parent、Suggested Knowledge edge。

### 4.1 質問別の比較

Baselineは「keyword/vectorなしの現行Theme-scoped list/context」とした。
これはrelationを辿らずThemeに属する全候補を返すため、対象を含むことはあるがunrelatedを抑えられない。
Explicitはseedから最大2 hopのasserted relationを辿った結果である。

| 質問 | 期待する根拠 | baseline recall / unrelated | explicit recall / unrelated | token概算の観測 |
|---|---|---:|---:|---:|
| ConversationからDecision NoteとArtifactの根拠を辿る | resource, note, artifact, source_record | 1/4 / 6 | 4/4 / 0 | bounded JSON 約220–400 |
| Captureの次のTaskを知る | capture, task | 1/2 / 5 | 2/2 / 0 | 約160–260 |
| Decisionが何をEvidenceにしているか | decision, evidence, source note | 2/3 / 4 | 3/3 / 0 | 約180–320 |
| Activityの時間入口から変更対象とsourceを辿る | change_event, note, source_record, artifact | 1/4 / 5 | 4/4 / 0 | 約220–420 |

数値はfixtureの固定集合（seedを含む対象集合）に対する評価であり、実Workspace全体の品質を意味しない。
現行keyword/vector検索を実装したという意味でもない。
確認できたことは、explicit traversalが「なぜ含めたか」「どのsourceへ戻れるか」を維持しながら、disconnectedなunrelatedを0件にできること、Suggested edgeを既定で事実化しないことである。

### 4.2 実行した安全性評価

- input workspaceはdeep-equalで不変。
- node key `{type,id}`の重複は0件。
- edge keyの重複は0件。
- parent cycle fixtureでもvisited/limitで停止。
- `max_hops=2`、node/edge上限、token budget超過時の`truncated`を確認。
- Suggested edgeは`include_suggested`なしでは結果に出ず、ありでも`status=suggested`と`policy.suggested_is_fact=false`を保持。
- MCP boundaryはread-only contextの既存DB open/query-onlyを使用し、write operationを追加していない。

## 5. Graph DB / GraphRAG / Canvasの判断

現時点では導入しない。

- 既存関係はSQLiteの同一row内pointerと専用collectionでboundedに辿れる。
- まず#335 Entity Registry、#336 Application Command、#337 contract testでtype・relation・eventの欠損を減らす方が、外部Graph DBより情報品質に効く。
- Graph DB導入の条件は「SQLite projectionの再構築時間、1–2 hopのquery latency、relation数、同時書込み、path queryの失敗」を実データで測り、SQLiteの上限が再現可能に確認された場合だけとする。
- GraphRAGはsemantic retrievalの改善策であって、asserted provenanceの代替ではない。採用する場合もsuggestion layerとして、source/evidence/path付きでContext Previewに出す。
- UIはlist/tree/path/breadcrumb/laneを主とする。巨大CanvasをGraphの完成条件にしない。

## 6. 関連Issueへの反映案（実際のコメント更新は親レビュー後）

### #280 Relation / Provenance

今回の監査表を正本とし、既存field/専用collectionを壊さずにrelation store/queryのbounded read contractを持つ。
`reference` / dependency / knowledge edgeのassertion不足（origin/evidence/visibility/freshness/status）を実装条件へ追加し、cycle/endpoint/missing-sourceをData Healthで報告する。

### #283 Conversation lineage

ChatRefは`resource`のtyped Entityとして保持し、`parent_resource_id`とArtifact/source/referenceをprovenance pathへ投影する。
Conversation本文をNoteへ重複保存せず、Conversation→Note→Artifactのsource戻りをContext queryで返す。

### #297 Local Graph viewer

Issueは#332へ吸収済み。Canvasを作らず、今回のJSONをlist/tree/path表示へ投影するdiagnostic prototypeに限定する。
viewerはrelation契約・bounded query・#294公開policyが揃った後に作る。

### #315 Activity Event Index

Activityは全Graphの複製ではなく、`change_event`を時間で引くentry pointとする。
`entity_type/entity_id`でcanonical sourceへ戻り、Notes/Quick Capture/Today miniのdirect saveを#336 command transactionでevent化する。
過去に欠けるeventを推測backfillしない。

### #319 Knowledge UI

既存Knowledge/Knowledge edgeは保持し、Decision→Evidence→sourceのbounded pathを提供する。
Wiki linkやunlinked mentionはsemantic candidateとしてasserted relationと分離し、KnowledgeNodeへの一括変換やNotesの正本化は行わない。

## 7. 次の実装順と未完了

1. #335 Entity Registryのcollection/type契約を全relation入口で使う（今回のprojectionは既にread側で使用）。
2. #336 Application Commandで保存EntityとChange Eventを同一transactionに揃える。
3. #337でreference/dependency/source/eventのcontract test、missing relation、cycle、visibility/freshnessを継続監査する。
4. #280でbounded relation queryを正式なdomain/API契約へ昇格し、#296 Context PreviewとMCPで同じselection/policyを呼ぶ。
5. 実データでlatency/token/recallを測ってから、必要ならsidecarやsemantic suggestionを検討する。

このPRはResearch完了条件のbounded prototypeとfixture評価までを扱う。
Relationの新規保存schema、過去データのmigration/backfill、Graph DB、Canvas、AI自動採用は残る実装Issueである。
