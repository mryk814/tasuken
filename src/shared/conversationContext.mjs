import { markdownSignature } from "./canonicalMarkdown.mjs";
import { projectEntityForAi } from "./aiMetadata.mjs";

export const CONVERSATION_CONTEXT_SCHEMA = "tasken-conversation-context/v1";
export const CONVERSATION_CONTEXT_PUBLICATION_SCHEMA = "tasken-conversation-context-publication/v1";
export const CONVERSATION_CONTEXT_DIRECTORY = "AI Context/Conversations";
export const CONVERSATION_CONTEXT_SCOPES = ["full", "selected_turns"];

const ROLE_HEADING = /^(#{2,3})\s+(.+)$/;
const USER_ROLE = /^(?:you|user|human|ユーザー)(?:\s|$)/i;
const ASSISTANT_ROLE = /^(?:assistant|ai|chatgpt|gpt|claude|gemini|copilot|codex)(?:\s|$)/i;
const SYSTEM_ROLE = /^(?:system|システム)(?:\s|$)/i;
const TOOL_ROLE = /^(?:tool|function|ツール)(?:\s|$)/i;
const SECRET_LINE = /(?:api[_ -]?key|access[_ -]?token|client[_ -]?secret|password|authorization\s*:|bearer\s+[A-Za-z0-9._~+/-]{8,}|\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{8,})/i;
const LOCAL_PATH_LINE = /(?:\b[A-Za-z]:\\|\\\\[^\s\\]+\\|file:\/\/|\/(?:Users|home|private|var)\/[^\s]+)/i;
const MAX_SOURCE_CHARS = 512 * 1024;
const MAX_TURN_CHARS = 32 * 1024;
const MAX_CONTEXT_CHARS = 192 * 1024;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function yaml(value) {
  return JSON.stringify(value == null ? "" : String(value));
}

function safeRelativePath(value) {
  const normalized = text(value).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) return "";
  if (!normalized.startsWith(`${CONVERSATION_CONTEXT_DIRECTORY}/`)) return "";
  return normalized;
}

function safeFileStem(value) {
  const stem = text(value)
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|#%{}\[\]]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return stem || "conversation";
}

function shortId(value) {
  const normalized = text(value).replace(/[^A-Za-z0-9]/g, "");
  return (normalized || markdownSignature(text(value))).slice(0, 10).toLowerCase();
}

function inferRole(heading) {
  const cleaned = text(heading).replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "").trim();
  if (USER_ROLE.test(cleaned)) return { role: "user", displayName: cleaned || "User" };
  if (SYSTEM_ROLE.test(cleaned)) return { role: "system", displayName: cleaned || "System" };
  if (TOOL_ROLE.test(cleaned)) return { role: "tool", displayName: cleaned || "Tool" };
  if (ASSISTANT_ROLE.test(cleaned)) return { role: "assistant", displayName: cleaned || "Assistant" };
  return null;
}

export function parseConversationContextMessages(body) {
  const lines = String(body || "").slice(0, MAX_SOURCE_CHARS).replace(/\r\n?/g, "\n").split("\n");
  let roleLevel = null;
  let fenced = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = line.match(ROLE_HEADING);
    if (match && inferRole(match[2])) roleLevel = roleLevel == null ? match[1].length : Math.min(roleLevel, match[1].length);
  }
  if (roleLevel == null) return [];

  const messages = [];
  let current = null;
  let currentLines = [];
  fenced = false;
  const flush = () => {
    if (!current) return;
    const content = currentLines.join("\n").trim();
    if (content) messages.push({ ...current, index: messages.length, content });
    currentLines = [];
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const match = !fenced ? line.match(ROLE_HEADING) : null;
    const inferred = match && match[1].length === roleLevel ? inferRole(match[2]) : null;
    if (inferred) {
      flush();
      current = inferred;
    } else if (current) {
      currentLines.push(line);
    }
  }
  flush();
  return messages;
}

export function normalizeConversationContextPublication(value) {
  const input = record(value);
  if (input.schema !== CONVERSATION_CONTEXT_PUBLICATION_SCHEMA) return null;
  const scope = CONVERSATION_CONTEXT_SCOPES.includes(input.scope) ? input.scope : "full";
  const selected = Array.isArray(input.selected_message_indexes)
    ? [...new Set(input.selected_message_indexes.filter((entry) => Number.isInteger(entry) && entry >= 0))].sort((a, b) => a - b)
    : [];
  const relativePath = safeRelativePath(input.relative_path);
  if (!relativePath) return null;
  return {
    schema: CONVERSATION_CONTEXT_PUBLICATION_SCHEMA,
    status: ["publishing", "published", "publish_failed", "removing", "removal_failed", "removed"].includes(input.status)
      ? input.status
      : "publish_failed",
    scope,
    selected_message_indexes: selected,
    relative_path: relativePath,
    content_hash: text(input.content_hash) || null,
    source_revision: text(input.source_revision) || null,
    published_at: text(input.published_at) || null,
    updated_at: text(input.updated_at) || null,
    removed_at: text(input.removed_at) || null,
    operation_id: text(input.operation_id) || null,
    last_error: text(input.last_error) || null,
  };
}

export function conversationContextRelativePath(resource, publication = null) {
  const existing = normalizeConversationContextPublication(publication);
  if (existing?.relative_path) return existing.relative_path;
  return `${CONVERSATION_CONTEXT_DIRECTORY}/${safeFileStem(resource?.title)}-${shortId(resource?.id)}.md`;
}

function redactMessage(message) {
  const reasons = [];
  const lines = message.content.split("\n").map((line) => {
    if (SECRET_LINE.test(line)) {
      reasons.push({ kind: "secret_candidate", message_index: message.index, role: message.role });
      return "[除外: 秘密情報の可能性がある行]";
    }
    if (LOCAL_PATH_LINE.test(line)) {
      reasons.push({ kind: "local_path", message_index: message.index, role: message.role });
      return "[除外: ローカルパスを含む行]";
    }
    return line;
  });
  let content = lines.join("\n").trim();
  if (content.length > MAX_TURN_CHARS) {
    content = `${content.slice(0, MAX_TURN_CHARS)}\n\n[以降を文字数上限により除外]`;
    reasons.push({ kind: "turn_truncated", message_index: message.index, role: message.role });
  }
  return { message: { ...message, content }, reasons };
}

function safeSourceUrl(value) {
  const raw = text(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!new Set(["https:", "http:"]).has(url.protocol) || url.username || url.password) return "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function renderConversationContext({ resource, theme, header, scope, selected, exclusions, publishedAt }) {
  const sourceUrl = safeSourceUrl(resource.url || resource.source_url);
  const provider = text(resource.link_type || resource.provider || resource.source_format || "unknown");
  const frontmatter = [
    "---",
    `schema: ${CONVERSATION_CONTEXT_SCHEMA}`,
    `conversation_id: ${yaml(resource.id)}`,
    `provider: ${yaml(provider)}`,
    `title: ${yaml(text(resource.title || "Conversation").slice(0, 200))}`,
    `source_url: ${yaml(sourceUrl)}`,
    `captured_at: ${yaml(resource.captured_at || "")}`,
    `published_at: ${yaml(publishedAt)}`,
    `freshness: ${yaml(header.freshness || "unknown")}`,
    `authority: ${yaml(header.authority || "imported")}`,
    `scope: ${scope}`,
    scope === "selected_turns" ? `selected_turns: [${selected.map((message) => message.index).join(", ")}]` : null,
    "---",
  ].filter(Boolean);
  const messages = selected.flatMap((message) => [
    `### ${message.role === "user" ? "User" : "Assistant"}`,
    "",
    message.content,
    "",
  ]);
  const related = [
    theme?.id ? `- Theme: \`${theme.id}\` ${text(theme.name || theme.title)}` : null,
    sourceUrl ? `- Source: ${sourceUrl}` : null,
  ].filter(Boolean);
  return `${[
    ...frontmatter,
    "",
    `# ${text(resource.title).slice(0, 200) || "Conversation"}`,
    "",
    "## Summary",
    "",
    text(header.summary) || "要約は未設定です。",
    "",
    "## Conversation",
    "",
    ...messages,
    "## Related",
    "",
    ...(related.length ? related : ["- なし"]),
    "",
    exclusions.length ? "## Exclusions" : null,
    exclusions.length ? "" : null,
    ...exclusions.map((entry) => `- turn ${entry.message_index + 1}: ${entry.kind}`),
  ].filter((entry) => entry !== null).join("\n")}\n`;
}

export function buildConversationContextPlan({
  resource,
  theme,
  workspaceDefault = null,
  scope,
  selectedMessageIndexes,
  publishedAt,
} = {}) {
  const entity = record(resource);
  if (!text(entity.id) || text(entity.resource_scope) !== "chat_ref") {
    throw new Error("AI Contextの対象は保存済みConversationだけです。");
  }
  const themeEntity = record(theme);
  if (!text(themeEntity.id) || ![entity.theme_id, entity.project_id].map(text).includes(text(themeEntity.id))) {
    throw new Error("ConversationのThemeが見つかりません。Themeを設定してから再試行してください。");
  }
  const publication = normalizeConversationContextPublication(entity.conversation_context_publication);
  const normalizedScope = CONVERSATION_CONTEXT_SCOPES.includes(scope) ? scope : publication?.scope || "full";
  const requestedIndexes = Array.isArray(selectedMessageIndexes)
    ? [...new Set(selectedMessageIndexes.filter((entry) => Number.isInteger(entry) && entry >= 0))].sort((a, b) => a - b)
    : publication?.selected_message_indexes || [];
  const projection = projectEntityForAi("resource", entity, { audience: "m365", theme: themeEntity, workspaceDefault });
  const allMessages = parseConversationContextMessages(entity.body_markdown);
  const roleExclusions = allMessages
    .filter((message) => !["user", "assistant"].includes(message.role))
    .map((message) => ({ kind: `${message.role}_turn`, message_index: message.index, role: message.role }));
  const publishable = allMessages.filter((message) => ["user", "assistant"].includes(message.role));
  const notSelected = normalizedScope === "selected_turns"
    ? publishable.filter((message) => !requestedIndexes.includes(message.index)).map((message) => ({ kind: "not_selected", message_index: message.index, role: message.role }))
    : [];
  const scoped = normalizedScope === "selected_turns"
    ? publishable.filter((message) => requestedIndexes.includes(message.index))
    : publishable;
  const redacted = scoped.map(redactMessage);
  const exclusions = [
    ...roleExclusions,
    ...notSelected,
    ...(String(entity.body_markdown || "").length > MAX_SOURCE_CHARS ? [{ kind: "source_truncated", message_index: -1, role: "source" }] : []),
    ...redacted.flatMap((entry) => entry.reasons),
  ];
  const selected = [];
  let remaining = MAX_CONTEXT_CHARS;
  for (const entry of redacted) {
    if (remaining <= 0) {
      exclusions.push({ kind: "total_truncated", message_index: entry.message.index, role: entry.message.role });
      continue;
    }
    if (entry.message.content.length > remaining) {
      selected.push({ ...entry.message, content: `${entry.message.content.slice(0, remaining)}\n\n[以降を全体上限により除外]` });
      exclusions.push({ kind: "total_truncated", message_index: entry.message.index, role: entry.message.role });
      remaining = 0;
    } else {
      selected.push(entry.message);
      remaining -= entry.message.content.length;
    }
  }
  const allowed = Boolean(projection.included && selected.length);
  const blockingReasons = [
    ...(!projection.included ? [projection.exclusion?.reason || "M365への公開が許可されていません。"] : []),
    ...(!selected.length ? [normalizedScope === "selected_turns" ? "公開する発言を選択してください。" : "公開できるUser/Assistant発言がありません。"] : []),
  ];
  const effectivePublishedAt = text(publishedAt) || publication?.published_at || new Date(0).toISOString();
  const relativePath = conversationContextRelativePath(entity, publication);
  const header = projection.header || {
    summary: text(entity.ai_summary), freshness: text(entity.ai_freshness) || "unknown", authority: text(entity.ai_authority) || "imported",
  };
  const content = renderConversationContext({ resource: entity, theme: themeEntity, header, scope: normalizedScope, selected, exclusions, publishedAt: effectivePublishedAt });
  const contentHash = markdownSignature(content);
  const sourceRevision = markdownSignature(JSON.stringify({
    conversation_id: entity.id,
    title: entity.title,
    body_markdown: entity.body_markdown,
    url: entity.url || entity.source_url,
    captured_at: entity.captured_at,
    provider: entity.link_type || entity.provider || entity.source_format,
    ai_summary: entity.ai_summary,
    ai_summary_authority: entity.ai_summary_authority,
    ai_freshness: entity.ai_freshness,
    ai_authority: entity.ai_authority,
    ai_visibility: entity.ai_visibility,
    theme_visibility: themeEntity.default_ai_visibility,
    workspace_visibility: workspaceDefault,
    scope: normalizedScope,
    selected: selected.map((message) => message.index),
  }));
  const wasPublished = publication?.status === "published";
  const dirty = Boolean(wasPublished && (publication.content_hash !== contentHash || publication.source_revision !== sourceRevision));
  return {
    schema: CONVERSATION_CONTEXT_SCHEMA,
    conversation_id: text(entity.id),
    theme_id: text(themeEntity.id),
    storage_root_id: `theme:${text(themeEntity.id)}`,
    relative_path: relativePath,
    scope: normalizedScope,
    selected_message_indexes: selected.map((message) => message.index),
    message_count: selected.length,
    source_message_count: allMessages.length,
    exclusion_reasons: exclusions,
    blocking_reasons: blockingReasons,
    warnings: [...new Set(exclusions.map((entry) => entry.kind))],
    allowed,
    publication_state: !publication || publication.status === "removed"
      ? "not_published"
      : !projection.included && wasPublished
        ? "published_but_blocked"
        : publication.status === "published" && dirty
          ? "dirty"
          : publication.status,
    dirty,
    content,
    content_hash: contentHash,
    source_revision: sourceRevision,
    published_at: effectivePublishedAt,
    source_url: safeSourceUrl(entity.url || entity.source_url),
    theme: { id: text(themeEntity.id), title: text(themeEntity.name || themeEntity.title) },
    summary: text(header.summary),
    freshness: text(header.freshness) || "unknown",
    authority: text(header.authority) || "imported",
    ai_visibility: Array.isArray(header.ai_visibility) ? header.ai_visibility : [],
  };
}

export function publicationForThemeAiPack(entity) {
  const publication = normalizeConversationContextPublication(entity?.conversation_context_publication);
  if (!publication || publication.status !== "published") return null;
  return {
    published: true,
    title: text(entity?.title),
    storage_root_id: `theme:${text(entity?.theme_id || entity?.project_id)}`,
    relative_path: publication.relative_path,
  };
}
