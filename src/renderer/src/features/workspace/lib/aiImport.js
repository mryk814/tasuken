const MAX_IMPORT_BYTES = 1024 * 1024;
const PAYLOAD_KEYS = new Set(["items", "notes", "links", "knowledge_nodes", "knowledge_edges"]);
const ITEM_KINDS = new Set(["task", "milestone", "period", "waiting", "reminder", "idea"]);
const ITEM_STATUSES = new Set(["todo", "doing", "waiting", "review", "done", "inbox"]);
const PRIORITIES = new Set(["normal", "high"]);
const NOTE_TYPES = new Set(["memo", "decision", "meeting", "experiment", "analysis", "ai_chat", "learning", "reflection"]);
const LINK_TYPES = new Set(["chatgpt", "copilot", "github", "paper", "notebook", "document", "other"]);
const ALLOWED_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);
const KNOWLEDGE_NODE_TYPES = new Set(["source", "evidence", "claim", "question", "decision", "insight"]);
const KNOWLEDGE_RELATION_TYPES = new Set(["supports", "contradicts", "explains", "causes", "example_of", "generalizes", "depends_on", "derived_from", "answers", "raises", "similar_to", "leads_to"]);
const CONFIDENCE = new Set(["low", "medium", "high"]);
const KNOWLEDGE_STATUSES = new Set(["active", "resolved", "deprecated", "rejected"]);
const IMPORT_ACTIONS = new Set(["create", "merge", "ignore"]);

export const AI_IMPORT_SCHEMA = `{
  "items": [
    {
      "action": "create | merge | ignore",
      "reason": "候補にした理由、merge/ignoreの根拠",
      "title": "string 必須",
      "theme": "既存Theme名または識別子。分からなければ空文字",
      "kind": "task | milestone | period | waiting | reminder | idea",
      "status": "todo | doing | waiting | review | done | inbox",
      "priority": "normal | high",
      "planned_start": "YYYY-MM-DD または null",
      "planned_end": "YYYY-MM-DD または null",
      "description": "string。根拠や不確実性もここに書く"
    }
  ],
  "notes": [
    {
      "action": "create | merge | ignore",
      "reason": "候補にした理由、merge/ignoreの根拠",
      "title": "string 必須",
      "theme": "既存Theme名または識別子。分からなければ空文字",
      "note_type": "memo | decision | meeting | experiment | analysis | ai_chat | learning | reflection",
      "body": "string 必須",
      "source_url": "https/http URL または空文字"
    }
  ],
  "links": [
    {
      "action": "create | merge | ignore",
      "reason": "候補にした理由、merge/ignoreの根拠",
      "title": "string 必須",
      "url": "https/http/mailto URL",
      "link_type": "chatgpt | copilot | github | paper | notebook | document | other",
      "theme": "既存Theme名または識別子。分からなければ空文字",
      "description": "string"
    }
  ],
  "knowledge_nodes": [
    {
      "action": "create | merge | ignore",
      "reason": "候補にした理由、merge/ignoreの根拠",
      "temp_id": "node-1",
      "node_type": "source | evidence | claim | question | decision | insight",
      "title": "string 必須",
      "body": "string",
      "theme": "既存Theme名または識別子。分からなければ空文字",
      "confidence": "low | medium | high",
      "status": "active | resolved | deprecated | rejected"
    }
  ],
  "knowledge_edges": [
    {
      "action": "create | merge | ignore",
      "reason": "候補にした理由、merge/ignoreの根拠",
      "source_temp_id": "node-1",
      "target_temp_id": "node-2",
      "relation_type": "supports | contradicts | explains | causes | example_of | generalizes | depends_on | derived_from | answers | raises | similar_to | leads_to",
      "description": "string"
    }
  ]
}`;

export function isAllowedImportUrl(value) {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(String(value)).protocol);
  } catch {
    return false;
  }
}

export function isIsoLocalDate(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function nullableDate(value, issues, field) {
  if (value == null || value === "") return null;
  const normalized = text(value);
  if (!isIsoLocalDate(normalized)) {
    issues.push(`${field}はYYYY-MM-DDまたはnullにしてください`);
    return null;
  }
  return normalized;
}

function enumValue(value, allowed, fallback, issues, field) {
  const normalized = text(value);
  if (!normalized) return fallback;
  if (!allowed.has(normalized)) {
    issues.push(`${field}が不正です`);
    return fallback;
  }
  return normalized;
}

function resolveTheme(themeValue, themes) {
  const normalized = text(themeValue);
  if (!normalized) return undefined;
  const lower = normalized.toLowerCase();
  return themes.find((theme) => {
    const code = text(theme.code);
    const name = text(theme.name);
    const id = text(theme.id);
    return [id, name, code, `[${code}] ${name}`, `${code} ${name}`, `${code}: ${name}`]
      .filter(Boolean)
      .some((value) => value.toLowerCase() === lower);
  });
}

function normalizeArray(payload, key) {
  const value = payload[key];
  if (value == null) return [];
  return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)) : [];
}

export function parseAiImportPayload(raw, themes, collections) {
  const size = new Blob([raw]).size;
  if (size > MAX_IMPORT_BYTES) throw new Error("Import本文が大きすぎます。1MB以下にしてください。");
  const payload = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("JSON objectを入力してください。");
  }

  const payloadIssues = Object.keys(payload)
    .filter((key) => !PAYLOAD_KEYS.has(key))
    .map((key) => `${key}はAI Import対象外のため無視します`);
  const candidates = [
    ...normalizeArray(payload, "items").map((entry) => normalizeItem(entry, themes, collections.items || [])),
    ...normalizeArray(payload, "notes").map((entry) => normalizeNote(entry, themes, collections.notes || [])),
    ...normalizeArray(payload, "links").map((entry) => normalizeLink(entry, themes, collections.links || [])),
    ...normalizeArray(payload, "knowledge_nodes").map((entry, index) => normalizeKnowledgeNode(entry, index, themes, collections.knowledge_nodes || [])),
  ];
  candidates.push(...normalizeArray(payload, "knowledge_edges").map((entry) =>
    normalizeKnowledgeEdge(entry, candidates, collections.knowledge_nodes || [], collections.knowledge_edges || [])));
  if (!candidates.length) throw new Error("items、notes、links、knowledge_nodes、knowledge_edgesのいずれかを含めてください。");
  return { candidates, payloadIssues };
}

function findDuplicate(collection, title) {
  const normalized = text(title).toLowerCase();
  if (!normalized) return undefined;
  return collection.find((entry) => text(entry.title).toLowerCase() === normalized);
}

function candidateBase(type, entry, themes, collection) {
  const issues = [];
  const title = text(entry.title);
  const theme = resolveTheme(entry.theme, themes);
  const duplicate = findDuplicate(collection, title);
  if (!title) issues.push("titleがありません");
  if (text(entry.theme) && !theme) issues.push("Themeを解決できません");
  if (duplicate && ["done", "archived"].includes(text(duplicate.status))) {
    issues.push("完了済みまたはarchivedの既存候補への更新です");
  }
  return { type, theme, duplicate, issues };
}

function normalizeItem(entry, themes, collection) {
  const base = candidateBase("item", entry, themes, collection);
  const normalized = {
    action: enumValue(entry.action, IMPORT_ACTIONS, "", base.issues, "action"),
    reason: text(entry.reason),
    title: text(entry.title),
    theme: text(entry.theme),
    kind: enumValue(entry.kind, ITEM_KINDS, "task", base.issues, "kind"),
    status: enumValue(entry.status, ITEM_STATUSES, "todo", base.issues, "status"),
    priority: enumValue(entry.priority, PRIORITIES, "normal", base.issues, "priority"),
    planned_start: nullableDate(entry.planned_start, base.issues, "planned_start"),
    planned_end: nullableDate(entry.planned_end, base.issues, "planned_end"),
    description: text(entry.description),
  };
  return finishCandidate(base, normalized);
}

function normalizeNote(entry, themes, collection) {
  const base = candidateBase("note", entry, themes, collection);
  const sourceUrl = text(entry.source_url);
  if (!text(entry.body)) base.issues.push("bodyがありません");
  if (sourceUrl && !isAllowedImportUrl(sourceUrl)) base.issues.push("source_urlはhttps、http、mailtoのみ使えます");
  const normalized = {
    action: enumValue(entry.action, IMPORT_ACTIONS, "", base.issues, "action"),
    reason: text(entry.reason),
    title: text(entry.title),
    theme: text(entry.theme),
    note_type: enumValue(entry.note_type, NOTE_TYPES, "memo", base.issues, "note_type"),
    body: text(entry.body),
    source_url: sourceUrl,
  };
  return finishCandidate(base, normalized);
}

function normalizeLink(entry, themes, collection) {
  const base = candidateBase("link", entry, themes, collection);
  const url = text(entry.url);
  if (!url) base.issues.push("urlがありません");
  else if (!isAllowedImportUrl(url)) base.issues.push("urlはhttps、http、mailtoのみ使えます");
  const normalized = {
    action: enumValue(entry.action, IMPORT_ACTIONS, "", base.issues, "action"),
    reason: text(entry.reason),
    title: text(entry.title),
    url,
    link_type: enumValue(entry.link_type, LINK_TYPES, "other", base.issues, "link_type"),
    theme: text(entry.theme),
    description: text(entry.description),
  };
  return finishCandidate(base, normalized);
}

function normalizeKnowledgeNode(entry, index, themes, collection) {
  const base = candidateBase("knowledge_node", entry, themes, collection);
  const normalized = {
    action: enumValue(entry.action, IMPORT_ACTIONS, "", base.issues, "action"),
    reason: text(entry.reason),
    temp_id: text(entry.temp_id) || `knowledge_node_${index + 1}`,
    node_type: enumValue(entry.node_type, KNOWLEDGE_NODE_TYPES, "insight", base.issues, "node_type"),
    title: text(entry.title),
    body: text(entry.body),
    theme: text(entry.theme),
    source_note_id: text(entry.source_note_id),
    source_link_id: text(entry.source_link_id),
    source_item_id: text(entry.source_item_id),
    confidence: enumValue(entry.confidence, CONFIDENCE, "medium", base.issues, "confidence"),
    status: enumValue(entry.status, KNOWLEDGE_STATUSES, "active", base.issues, "status"),
  };
  if (normalized.title.length > 200) base.issues.push("titleは200文字以内にしてください");
  if (normalized.body.length > 20000) base.issues.push("bodyは20000文字以内にしてください");
  return finishCandidate(base, normalized);
}

function normalizeKnowledgeEdge(entry, nodeCandidates, nodes, collection) {
  const issues = [];
  const relationType = enumValue(entry.relation_type, KNOWLEDGE_RELATION_TYPES, "supports", issues, "relation_type");
  const sourceTempId = text(entry.source_temp_id);
  const targetTempId = text(entry.target_temp_id);
  const sourceNodeId = text(entry.source_node_id);
  const targetNodeId = text(entry.target_node_id);
  const sourceKnown = Boolean(sourceNodeId && nodes.some((node) => node.id === sourceNodeId));
  const targetKnown = Boolean(targetNodeId && nodes.some((node) => node.id === targetNodeId));
  const sourceCandidate = sourceTempId && nodeCandidates.some((candidate) => candidate.type === "knowledge_node" && candidate.entry.temp_id === sourceTempId);
  const targetCandidate = targetTempId && nodeCandidates.some((candidate) => candidate.type === "knowledge_node" && candidate.entry.temp_id === targetTempId);
  if (!sourceKnown && !sourceCandidate) issues.push("source_temp_idまたはsource_node_idを解決できません");
  if (!targetKnown && !targetCandidate) issues.push("target_temp_idまたはtarget_node_idを解決できません");
  if ((sourceNodeId && sourceNodeId === targetNodeId) || (sourceTempId && sourceTempId === targetTempId)) {
    issues.push("edgeの自己参照はできません");
  }
  const normalized = {
    action: enumValue(entry.action, IMPORT_ACTIONS, "", issues, "action"),
    reason: text(entry.reason),
    source_temp_id: sourceTempId,
    target_temp_id: targetTempId,
    source_node_id: sourceNodeId,
    target_node_id: targetNodeId,
    relation_type: relationType,
    description: text(entry.description),
  };
  return finishCandidate({ type: "knowledge_edge", duplicate: findDuplicateEdge(collection, normalized), issues }, normalized);
}

function findDuplicateEdge(collection, entry) {
  return collection.find((edge) =>
    edge.source_node_id === entry.source_node_id
    && edge.target_node_id === entry.target_node_id
    && edge.relation_type === entry.relation_type);
}

function finishCandidate(base, entry) {
  const requestedAction = IMPORT_ACTIONS.has(entry.action) ? entry.action : "";
  const defaultAction = base.issues.length ? "ignore" : base.duplicate ? "merge" : "create";
  return {
    ...base,
    entry,
    action: base.issues.length && requestedAction !== "ignore" ? "ignore" : requestedAction || defaultAction,
    sourceRecordTitle: "貼り付けAI出力",
  };
}

export function assertImportCandidateSavable(candidate) {
  if (candidate.action === "ignore") return;
  if (candidate.issues?.length) {
    throw new Error(`確認事項が残っている候補は保存できません: ${candidate.issues.join(" / ")}`);
  }
  if (candidate.action === "merge" && !candidate.duplicate) {
    throw new Error("既存候補がないためmergeできません。");
  }
  if (!["create", "merge", "ignore"].includes(candidate.action)) {
    throw new Error("AI Importの取り込み操作が不正です。");
  }
}

export function buildAiImportPrompt(themeNames, aiContextMarkdown) {
  return `あなたは Tasken に取り込むための構造化データを作成します。
以下の作業文脈を読み、JSONだけを返してください。
説明文、Markdownコードブロック、コメントは禁止です。

出力形式:
${AI_IMPORT_SCHEMA}

ルール:
- JSONだけを返す
- 存在しないThemeは作らない
- Themeは既存Theme名または識別子を使う。Themeが不明なら空文字にする
- 日付が曖昧なら null
- 依存関係や親子関係は作らない
- Knowledge Edgeは同じ出力内のknowledge_nodesをtemp_idで参照する
- 完了済みへの更新は避ける
- 推測しすぎず、候補として安全に出す
- ユーザーがTasken上で確認してから保存する前提

既存Theme:
${themeNames || "なし"}

作業文脈:
${aiContextMarkdown || "なし"}`;
}

export function buildAiOrganizePrompt(appContext, importSchema = AI_IMPORT_SCHEMA) {
  return `あなたは、いま利用しているAIサービス側に蓄積された作業文脈を、Taskenへ持ち帰るための整理アシスタントです。
あなた自身が参照できる会話履歴、プロジェクト文脈、添付資料、接続済みツール、記憶、現在のスレッド内容を棚卸しし、TaskenにImportできる候補JSONだけを返してください。

重要:
- 下のTaskenコンテキストは、Tasken側に既にある情報と既存Theme名・識別子です
- 新しく持ち帰る内容は、あなたがTasken外で把握している文脈から選んでください
- Taskenコンテキストを単に要約し直すだけならignoreにしてください
- あなたが実際に参照できない外部情報は推測で作らないでください

目的:
- Tasken外に散らばっている会話、決定、未処理、参照リンク、論点をTaskenへ持ち帰る
- 新しいタスク、待ち、ナレッジ候補、メモ候補、リンク候補を提案する
- 既存データを直接変更せず、Import候補JSONだけを返す
- 不確かな内容は断定せず、description、body、reasonに根拠を書く

整理の観点:
- Taskenに既にありそうな内容はmerge候補にする
- すぐ動けるものだけtaskにする
- 相手の返答や外部作業待ちはwaitingにする
- 根拠つきの主張はknowledge claimまたはevidenceにする
- 根拠が薄いもの、不明点、確認したいことはquestionにする
- 生ログ、会話メモ、観察記録はnoteにする
- 参照URL、AIチャットURL、リポジトリ、ドキュメントはlinksにする
- 危ない断定はしない

作りすぎない制約:
- itemsは最大7件
- waitingは最大5件
- notesは最大5件
- knowledge_nodesは最大10件
- 重要度が低い、根拠が薄すぎる、既存候補とほぼ同じものはignoreにする

出力:
- 指定されたJSON schemaに厳密に従う
- create / merge / ignore の候補として返す
- 既存Themeに紐づく場合は theme 名または識別子を使う
- タスクは実行可能な粒度に分ける
- ナレッジは claim / question / evidence / decision を混ぜすぎず、根拠が薄いものは question にする
- JSONだけを返す。説明文、Markdownコードブロック、コメントは禁止

Tasken側の既存情報:
${appContext || "なし"}

出力schema:
${importSchema}`;
}
