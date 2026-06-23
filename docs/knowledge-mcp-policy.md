# Tasken Knowledge Model + AI/MCP連携 実装方針

TaskenはElectron + React + SQLiteのローカルデスクトップアプリとして、テーマ、タスク、メモ、リンク、タイムライン、AI Import / Exportを扱う。今後は単なるタスク管理やメモ管理ではなく、思考・知識・作業文脈をAIと共有できる個人用Thinking Graphへ拡張する。

この文書はKnowledge Model、AI Context Export、MCP連携、安全なwrite提案の実装方針を固定する。実装時は既存のWorkspace Repository、Snapshot、AI Import / Export、typed IPCの境界に合わせて段階導入する。

## 基本方針

TaskenにGitHub Copilot serviceを直接埋め込むことは優先しない。TaskenをAIが参照できる「思考と作業の文脈DB」にする。

優先順は以下とする。

1. Knowledge Data Modelを追加する
2. AI Context ExportをKnowledge-awareにする
3. Read-only MCP Serverを追加する
4. Safe Write Proposalを追加する
5. VS Code / Copilot / Cursor連携はMCP経由で行う

現時点では以下をやらない。

- GitHub Copilotの非公式APIに直接接続する
- AIにSQLiteを直接書かせる
- いきなり万能ナレッジグラフを作る
- 入力時にユーザーへ細かい分類を強制する
- Knowledge Canvas / Whiteboardのような大規模UIを最初から作る
- person / people entityを復活させる
- local_file / folder linkを復活させる

## UX原則

入力時は自由に書けることを優先する。構造化は「書く前」ではなく「書いた後」に行う。

NoteとKnowledgeの責務は以下で固定する。

- Note: 作業中の記録・素材置き場。会話ログ、雑な気づき、未整理の文章、実験メモをそのまま残す。
- Knowledge: 後から判断に使う構造化された知見。出典を持つ問い、主張、根拠、決定として残す。

10秒判定は「あとで読み返す文章ならNote、あとで判断に使う部品ならKnowledge」とする。迷った場合はNoteに入れ、あとから必要なものだけKnowledgeへ昇格する。

新規に増やすKnowledgeNodeは原則として以下の4種類に絞る。

1. `question`: 未解決の問い
2. `claim`: 現時点の仮説・主張
3. `evidence`: Claimを支える根拠
4. `decision`: 採用した判断

既存互換のため`source`と`insight`は読み取り・編集可能なまま残すが、通常の新規作成導線では主役にしない。Knowledgeはゼロから綺麗に書くものではなく、Note / Resource / Task / Waiting / Plan Nodeから昇格し、sourceを持つ判断材料として扱う。

```text
1. ユーザーが雑に書く
2. AIが問い・主張・根拠・決定・タスク候補を抽出
3. ユーザーが採用 / 修正 / 無視
4. Theme / Item / Note / Link / KnowledgeNodeに接続
5. あとからKnowledge Map / Health Check / MCP Contextで使う
```

入力時に「これはClaimかEvidenceか」を強制しない。まずNoteとして保存し、あとから構造化候補を出す。

## Knowledge Data Model

`KnowledgeNode`はNoteの置き換えではない。Noteは自由入力の素材、KnowledgeNodeはあとから使えるように抽出された構造化知識として扱う。最初は`source_note_id`で、どのメモから生まれたかを追跡する。

```ts
type KnowledgeNodeType =
  | "source"
  | "evidence"
  | "claim"
  | "question"
  | "decision"
  | "insight";

type KnowledgeNode = {
  id: string;
  type: "knowledge_node";
  node_type: KnowledgeNodeType;
  title: string;
  body?: string;
  theme_id?: string | null;
  source_note_id?: string | null;
  source_link_id?: string | null;
  source_item_id?: string | null;
  confidence?: "low" | "medium" | "high";
  status?: "active" | "resolved" | "deprecated" | "rejected";
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
};
```

`KnowledgeRelation`は単なる関連ではなく関係の意味を持つ。AIが整理、矛盾検出、要約に使える粒度にする。

```ts
type KnowledgeRelationType =
  | "supports"
  | "contradicts"
  | "explains"
  | "causes"
  | "example_of"
  | "generalizes"
  | "depends_on"
  | "derived_from"
  | "answers"
  | "raises"
  | "similar_to"
  | "leads_to";

type KnowledgeRelation = {
  id: string;
  type: "knowledge_relation";
  source_node_id: string;
  target_node_id: string;
  relation_type: KnowledgeRelationType;
  description?: string;
  confidence?: "low" | "medium" | "high";
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
};
```

検証ルールは以下とする。

- `source_node_id`と`target_node_id`は存在するKnowledgeNodeを参照する
- 自己参照は禁止する
- `depends_on`、`causes`、`leads_to`は循環検出を行う
- `similar_to`は循環検出不要とする
- archived nodeへの新規relation作成は警告または禁止とする

## AI Knowledge Extraction

最初の対象はNoteのみとする。AIはDBへ直接保存せず、候補を返すだけにする。

```ts
type AiKnowledgeExtractionInput = {
  note_id: string;
  title?: string;
  body: string;
  theme_id?: string | null;
};

type AiKnowledgeExtractionPayload = {
  nodes: Array<{
    node_type: KnowledgeNodeType;
    title: string;
    body?: string;
    confidence?: "low" | "medium" | "high";
  }>;
  relations?: Array<{
    source_temp_id: string;
    target_temp_id: string;
    relation_type: KnowledgeRelationType;
    description?: string;
    confidence?: "low" | "medium" | "high";
  }>;
};
```

Note詳細またはAI Import画面に「このメモを構造化」ボタン、抽出候補一覧、nodeごとの採用 / 修正 / 無視、relationごとの採用 / 無視、保存前previewを追加する。

受け入れ条件は以下とする。

- Note本文を失わずに構造化候補を作れる
- AIの出力は保存前に必ずpreviewされる
- 採用されたKnowledgeNodeは`source_note_id`を持つ
- 採用されなかった候補はDBに保存されない

## Knowledge-aware AI Context Export

MCPや外部AIに渡す文脈を、単なるタスク一覧ではなく「考えの構造」として渡す。

```ts
type AiContextScope =
  | "active_theme"
  | "selected_theme"
  | "recent"
  | "open_items"
  | "knowledge";
```

ExportにはTheme、Open Items、Recent Notes、Recent Status Updates、Links、KnowledgeNode、KnowledgeRelation、unresolved Questions、active Claims、Decisions、Evidence、Plan Health、Knowledge Healthを含める。

Markdown出力は以下の構成を基本とする。

```markdown
# Tasken Context

## Theme

## Current Open Items

## Recent Notes

## Questions

## Claims

## Evidence

## Decisions

## Risks / Contradictions

## Suggested Next Actions
```

JSON出力は以下の形を基本とする。

```ts
type AiContextPack = {
  generated_at: string;
  scope: AiContextScope;
  themes: Theme[];
  items: Item[];
  notes: Note[];
  links: Link[];
  knowledge_nodes: KnowledgeNode[];
  knowledge_relations: KnowledgeRelation[];
  health: {
    overdue_items: Item[];
    unresolved_questions: KnowledgeNode[];
    claims_without_evidence: KnowledgeNode[];
    contradicted_claims: KnowledgeNode[];
    stale_decisions: KnowledgeNode[];
  };
};
```

## Knowledge Health Check

Knowledge Healthでは以下を検出する。

- 根拠のないClaim
- answerがないQuestion
- contradictedされているClaim
- 古いDecision
- sourceがないEvidence
- relationがない孤立KnowledgeNode
- open Itemに紐づいていないDecision
- QuestionからTaskに繋がっていないもの

最初は簡易一覧でよい。種別、対象node、問題内容、推奨アクション、対象を開くボタンを表示する。

受け入れ条件は以下とする。

- Theme単位でKnowledge Healthを見られる
- 問題のあるnode / note / itemに遷移できる
- AI Context Exportにhealth情報が含まれる

## MCP Server

Taskenを外部AIから参照できるようにする。最初はread-onlyのMCP Serverを作る。Tasken本体と同じプロセスに無理に入れなくてよく、別プロセス / CLI / localhost serverのいずれかでよい。

Phase 1のread-only toolsは以下とする。

```ts
tools:
  - tasken.search_items
  - tasken.list_open_items
  - tasken.get_theme_context
  - tasken.get_recent_notes
  - tasken.search_knowledge
  - tasken.get_knowledge_context
  - tasken.get_plan_health
  - tasken.get_knowledge_health
  - tasken.export_ai_context
```

tool仕様例は以下とする。

```ts
type SearchKnowledgeArgs = {
  query: string;
  theme_id?: string;
  node_types?: KnowledgeNodeType[];
  limit?: number;
};

type GetKnowledgeContextArgs = {
  theme_id?: string;
  include_relations?: boolean;
  include_sources?: boolean;
  limit?: number;
};

type ExportAiContextArgs = {
  scope: "active_theme" | "selected_theme" | "recent" | "open_items" | "knowledge";
  theme_id?: string;
  max_items?: number;
  max_notes?: number;
  max_knowledge_nodes?: number;
  format?: "markdown" | "json";
};
```

Read-only MCPは以下を守る。

- DBに書き込まない
- 件数上限を必ず設ける
- 文字数上限を必ず設ける
- archivedデータを含めるかは明示オプションにする
- raw note bodyを返す場合は`include_raw_body`のような明示フラグを必要にする

## MCP Safe Write Proposal

MCP経由のwriteは直接保存しない。Tasken側のpreview inboxに「提案」として送る。

Phase 2 toolsは以下とする。

```ts
tools:
  - tasken.propose_items
  - tasken.propose_notes
  - tasken.propose_links
  - tasken.propose_knowledge_nodes
  - tasken.propose_status_update
```

```ts
type AiProposal = {
  id: string;
  source: "mcp" | "ai_import" | "manual";
  source_app?: string;
  payload_type:
    | "items"
    | "notes"
    | "links"
    | "knowledge_nodes"
    | "status_update";
  payload: unknown;
  status: "pending" | "accepted" | "rejected" | "partially_accepted";
  created_at: string;
  updated_at: string;
};
```

保存ルールは以下とする。

- MCP toolはProposalを作るだけ
- 実Entity作成はユーザーがTasken UIで確認後に行う
- preview画面でcreate / merge / ignoreを選ぶ
- issuesがある候補はdefault ignoreとする
- 採用結果はsource_record / import_batchに残す

write系toolには`create_*`ではなく`propose_*`を使う。

## AI Import統合

既存のAI Importは`items`、`notes`、`links`を維持し、KnowledgeNodeは別セクションとして追加する。

```ts
type AiImportPayload = {
  items?: AiImportItem[];
  notes?: AiImportNote[];
  links?: AiImportLink[];
  knowledge_nodes?: AiImportKnowledgeNode[];
  knowledge_relations?: AiImportKnowledgeRelation[];
};
```

最初の実装では`knowledge_relations`はoptionalとし、UI上で慎重に確認する。

検証ルールは以下とする。

- 不正な`node_type`は拒否する
- 不正な`relation_type`は拒否する
- 存在しないthemeは自動作成しない
- 存在しない`source_note_id`は無視または警告にする
- relationの参照先が存在しない場合は保存しない
- confidenceはenumに限定する
- body / titleの最大長を設ける

## UI実装方針

最初に追加するUIは以下とする。

1. Note詳細に「構造化」ボタン
2. Knowledge候補preview drawer
3. Knowledge一覧
4. Knowledge Health Check
5. AI Context ExportのKnowledge対応
6. MCP設定画面

Knowledge一覧は高度なグラフビュー不要とし、node_type、title、theme、confidence、status、source note、related countを表示する。フィルタはTheme、node_type、status、confidence、sourceあり/なしを用意する。

## DB実装方針

既存のentity storeパターンに合わせ、以下を追加する。

- `knowledge_node`
- `knowledge_relation`
- `ai_proposal`

既存Snapshot / Import / Exportに追加する。ただしMCP write proposalは直接Entityに変換せず、まず`ai_proposal`として保存する。

## 実装優先順

### Phase 1: Knowledge土台

- KnowledgeNode型追加
- KnowledgeRelation型追加
- 保存 / 読み込み / Snapshot対応
- Knowledge一覧
- Noteから手動でKnowledgeNode作成

### Phase 2: AI抽出

- NoteからKnowledge候補抽出
- preview UI
- 採用 / 無視
- `source_note_id`の記録
- Knowledge Health Check

### Phase 3: AI Context Export強化

- KnowledgeNode / Relationをcontextに含める
- unresolved question / claim without evidenceを出す
- Markdown / JSON export対応

### Phase 4: Read-only MCP

- MCP Server追加
- `search_items`
- `list_open_items`
- `get_theme_context`
- `search_knowledge`
- `get_knowledge_context`
- `export_ai_context`

### Phase 5: Safe Write Proposal

- `ai_proposal` entity追加
- `propose_items`
- `propose_notes`
- `propose_knowledge_nodes`
- Tasken側preview inbox
- accept / reject / partial accept

### Phase 6: VS Code / Copilot連携

- MCP経由で利用する
- 必要ならVS Code拡張を薄く作る
- Copilot専用の非公式bridgeは優先しない

## テスト方針

最低限、以下を追加する。

- KnowledgeNodeの保存 / 読み込み
- KnowledgeRelationの保存 / 読み込み
- 自己参照relation拒否
- 循環relation拒否
- archived nodeへのrelation挙動
- 不正`node_type`拒否
- 不正`relation_type`拒否
- title必須
- `source_note_id`保持
- previewでignoreした候補は保存されない
- AI Context ExportにKnowledgeNodeとunresolved questionsが含まれる
- claims without evidenceが検出される
- 最大件数・最大文字数が効く
- read-only MCP toolがDBを書き換えない
- raw bodyは明示指定なしでは返さない
- `propose_*`はEntityではなく`ai_proposal`を作る

## 判断基準

迷ったら以下を優先する。

1. 書く流れを邪魔しない
2. AIが安全に読める
3. AIが直接壊せない
4. あとから構造を俯瞰できる
5. メモ・タスク・決定がつながる
6. グラフ表示より、意味のある関係を優先する
