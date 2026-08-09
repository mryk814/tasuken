# Relation assertion contract

Relationは、Entity同士の接続そのものではなく「誰が、何を根拠に、その接続を主張したか」を保存するassertionとして扱う。SQLiteの`reference` Entityが正本で、Context Graphは正本と既存フィールドから再構築できるread modelである。

## Canonical Reference

新規writeは次のfieldを正本にする。

- `assertion_id`: assertionの安定ID。Referenceの`id`と一致させる。
- `subject: { type, id }` / `object: { type, id }`: titleではなくtyped identityで接続する。
- `predicate`: `links_to`をplain `mentions`と区別する。predicate一覧はEntity Registryを正本にする。
- `layer`: `operational` / `provenance` / `semantic`。
- `status`: `asserted` / `suggested` / `rejected` / `superseded`。
- `origin`: `user` / `system_action` / `import` / `ai_suggested` / `migration`。
- `evidence_refs`: typed `{ type, id }`の配列。IDにcolonが含まれても文字列連結で曖昧にしない。
- `confidence`: 0から1、または`null`。
- `metadata`: Internal Link移行用の`raw_alias`と`source_span: { start, end }`、Proposal採用証跡などを保持できる。
- `recorded_at`、`superseded_by_assertion_id`: 記録時点と履歴上の置換先。

既存consumerの移行中は`source_type/source_id/target_type/target_id/relation_type`をcanonical fieldから導くcompatibility aliasとして返す。既存SQLite rowは保存時に書き換えず、repository readまたはContext Graph projection時にcanonical viewへ正規化する。旧`context`などcanonical enum外のpredicateもread projectionだけは保持し、新規writeでは拒否する。

参加Entity typeはEntity Registryが正本である。Themeはcanonical `project`、Conversationは`resource`、Activityは`change_event`、AI Workの実行結果は`work_receipt`として表す。

## Status and Proposal boundary

- `asserted`だけを既定の事実探索へ含める。
- `suggested`は明示optionがある探索だけに含め、事実とは表示しない。
- `rejected`はProposal decision record側の状態であり、新規canonical Referenceとして保存しない。
- `superseded`は履歴としてReferenceに残すが、既定探索から除外する。
- `origin=ai_suggested`のassertionとsemantic assertionは、`metadata.accepted_from_proposal_id`を伴う人間採用後だけwriteできる。
- reject/dismissは既存assertion配列を変更しないpure decisionである。acceptだけが`status=asserted`の新しいReferenceを作る。

## Traversal and broken relations

Context Graphのedgeはendpoint tupleではなくassertion単位のIDを持つ。同じsubject/predicate/objectを主張する別assertionを統合しない。outboundとinboundのbounded traversalは同じ`assertion_id`を返す。

Endpointの論理削除でReferenceをcascade削除またはtitle再解決しない。欠落endpointを架空nodeとして補わず、通常の`nodes`/`edges`とは分離した`broken_relation` diagnosticを返す。diagnostic件数とtoken budgetもbounded queryの上限に含める。

Work Receiptは`work_receipt -> task`の`created_for` provenance assertionとして自動投影する。このedgeはReceipt IDから決定的に再構築できる。

## Legacy Internal Link migration

旧`[[title]]`は自動rewriteしない。exact title matchが1件だけなら`migration_candidate`、複数なら`ambiguous`、0件なら`unresolved`と分類する。候補提示後に採用された場合だけtyped `{ type, id }`を持つ`links_to` assertionを作る。raw titleとsource spanはmetadataに残し、同名Entityの追加・削除で無言再接続しない。

canonical syntaxは`[[type:percent-encoded-id|表示alias]]`（`typed-stable-link/v1`）とする。例は`[[task:task%3A42|調査タスク]]`。identityは常に`{ type, id }`であり、表示aliasやEntity titleの変更で接続先を変えない。parserはMarkdownのfenced code、inline code、backslashでescapeされたopening bracketsをRelationへ変換しない。

同じsourceから同じtargetへの複数リンクは出現ordinalでassertionを区別する。ordinalは`assertion_id`のidentityに使うが、`source_span`はevidence metadataに限定するため、本文前方への追記でRelation IDは変わらない。canonical Markdown writerは`reconcileStableLinkAssertions`のupsert/delete差分を同じ保存単位へ含める。これにより同一保存はidempotentとなり、削除・置換されたstable-link assertionだけを除去し、手動作成の`links_to`は変更しない。

Entity詳細のLink / BacklinkはReference正本からContext Graphのpublic bounded queryを通して読む。outbound、backlink、broken、legacy各statusはカテゴリ別に上限を持ち、一方向の大量edgeが他カテゴリを隠さない。resolvedだけをtyped遷移可能にし、broken / ambiguous / unresolved / migration candidateは確認表示に留める。
