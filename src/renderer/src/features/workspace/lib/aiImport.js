const MAX_IMPORT_BYTES = 1024 * 1024;
const PAYLOAD_KEYS = new Set(["items", "notes", "links"]);
const ITEM_KINDS = new Set(["task", "milestone", "period", "waiting", "reminder", "idea"]);
const ITEM_STATUSES = new Set(["todo", "doing", "waiting", "review", "done", "inbox"]);
const PRIORITIES = new Set(["normal", "high"]);
const NOTE_TYPES = new Set(["memo", "decision", "meeting", "experiment", "analysis", "ai_chat", "learning", "reflection"]);
const LINK_TYPES = new Set(["chatgpt", "copilot", "github", "paper", "notebook", "document", "other"]);
const ALLOWED_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);

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
  return themes.find((theme) => theme.id === normalized || theme.name === normalized);
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
  ];
  if (!candidates.length) throw new Error("items、notes、linksのいずれかを含めてください。");
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
    title: text(entry.title),
    url,
    link_type: enumValue(entry.link_type, LINK_TYPES, "other", base.issues, "link_type"),
    theme: text(entry.theme),
    description: text(entry.description),
  };
  return finishCandidate(base, normalized);
}

function finishCandidate(base, entry) {
  return {
    ...base,
    entry,
    action: base.issues.length ? "ignore" : base.duplicate ? "merge" : "create",
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
{
  "items": [
    {
      "title": "string 必須",
      "theme": "既存Theme名。分からなければ空文字",
      "kind": "task | milestone | period | waiting | reminder | idea",
      "status": "todo | doing | waiting | review | done | inbox",
      "priority": "normal | high",
      "planned_start": "YYYY-MM-DD または null",
      "planned_end": "YYYY-MM-DD または null",
      "description": "string"
    }
  ],
  "notes": [
    {
      "title": "string 必須",
      "theme": "既存Theme名。分からなければ空文字",
      "note_type": "memo | decision | meeting | experiment | analysis | ai_chat | learning | reflection",
      "body": "string 必須",
      "source_url": "https/http URL または空文字"
    }
  ],
  "links": [
    {
      "title": "string 必須",
      "url": "https/http/mailto URL",
      "link_type": "chatgpt | copilot | github | paper | notebook | document | other",
      "theme": "既存Theme名。分からなければ空文字",
      "description": "string"
    }
  ]
}

ルール:
- JSONだけを返す
- 存在しないThemeは作らない
- Themeが不明なら空文字にする
- 日付が曖昧なら null
- 依存関係や親子関係は作らない
- 完了済みへの更新は避ける
- 推測しすぎず、候補として安全に出す
- ユーザーがTasken上で確認してから保存する前提

既存Theme:
${themeNames || "なし"}

作業文脈:
${aiContextMarkdown || "なし"}`;
}
