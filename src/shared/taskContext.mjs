import { publicThemeIntent } from "./themeRef.mjs";

const DEFAULT_INCLUDE = [
  "theme",
  "repository",
  "notes",
  "conversations",
  "artifacts",
  "resources",
  "activity",
  "work_receipts",
];
const INCLUDE_VALUES = new Set(DEFAULT_INCLUDE);
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/;

function text(value) {
  return value == null ? "" : String(value);
}

function finitePositiveInt(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), maximum);
}

export function taskContextLimits(args = {}) {
  return {
    maxItemsPerType: finitePositiveInt(args.max_items_per_type ?? args.maxItemsPerType, 10, 25),
    maxTextLength: finitePositiveInt(args.max_text_length ?? args.maxTextLength, 50_000, 100_000),
  };
}

export function normalizeTaskContextInclude(value) {
  if (!Array.isArray(value) || !value.length) return [...DEFAULT_INCLUDE];
  return [
    ...new Set(
      value.map((entry) => text(entry).trim()).filter((entry) => INCLUDE_VALUES.has(entry)),
    ),
  ];
}

export class TaskContextTextBudget {
  constructor(limit) {
    this.limit = finitePositiveInt(limit, 50_000, 100_000);
    this.used = 0;
    this.truncated = false;
  }

  take(value, perFieldLimit = this.limit) {
    const raw = text(value);
    const available = Math.max(0, Math.min(perFieldLimit, this.limit - this.used));
    if (raw.length <= available) {
      this.used += raw.length;
      return raw;
    }
    this.truncated = true;
    if (available <= 1) return "";
    const result = `${raw.slice(0, available - 1)}…`;
    this.used += result.length;
    return result;
  }
}

function commonFields(record) {
  return {
    id: text(record.id),
    version: Number(record.version || 0),
    created_at: record.created_at || null,
    updated_at: record.updated_at || null,
  };
}

export function publicTaskForContext(task, budget) {
  const takeSafe = (value, limit) => budget.take(safeReceiptText(value), limit);
  return withPublicAi(
    task,
    {
      ...commonFields(task),
      title: takeSafe(task.title, 500),
      description: takeSafe(task.description, 20_000),
      state: task.state || "todo",
      priority: task.priority || "normal",
      project_id: task.project_id || null,
      plan_node_id: task.plan_node_id || null,
      parent_task_id: task.parent_task_id || null,
      checklist_items: Array.isArray(task.checklist_items)
        ? task.checklist_items.slice(0, 100).map((entry) => ({
            id: text(entry?.id),
            title: takeSafe(entry?.title, 500),
            done: Boolean(entry?.done),
            sort_order: Number(entry?.sort_order || 0),
          }))
        : [],
    },
    budget,
  );
}

export function publicAssignmentForContext(task, budget) {
  const takeSafe = (value, limit) => budget.take(safeReceiptText(value), limit);
  return {
    requester: task.requester || "unknown",
    intended_executor: task.intended_executor || "self",
    executor_identity: takeSafe(task.executor_identity, 200) || null,
    work_state:
      task.work_state ||
      (task.intended_executor === "ai_agent" ? "ready_for_agent" : "not_delegated"),
    work_started_at: task.work_started_at || null,
    work_reported_at: task.work_reported_at || null,
    work_review_note: takeSafe(task.work_review_note, 2_000) || null,
  };
}

export function publicThemeForContext(theme, budget) {
  if (!theme) return null;
  const intent = publicThemeIntent(safeReceiptValue(theme), budget);
  const takeSafe = (value, limit) => budget.take(safeReceiptText(value), limit);
  return withPublicAi(
    theme,
    {
      ...commonFields(theme),
      name: takeSafe(theme.name, 500),
      code: takeSafe(theme.code, 120) || null,
      description: takeSafe(theme.description, 10_000),
      state: theme.state || null,
      charter: intent.charter,
      current_state: intent.state,
    },
    budget,
  );
}

export function safeExternalUrl(value) {
  const source = text(value).trim();
  if (!source) return null;
  try {
    const parsed = new URL(source);
    if (!new Set(["http:", "https:"]).has(parsed.protocol)) return null;
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function safeRelativePath(value) {
  const source = text(value).trim().replace(/\\/g, "/").slice(0, 2_000);
  if (!source || ABSOLUTE_PATH.test(source)) return null;
  const segments = source.split("/");
  if (segments.some((segment) => segment === "..") || /[\x00-\x1f\x7f]/.test(source)) return null;
  return source.replace(/^\.\//, "");
}

function safeStorageRootId(value) {
  const source = text(value).trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(source) ? source : null;
}

export function safeAiSourceRefs(value, budget = null) {
  const refs = [];
  for (const entryValue of Array.isArray(value) ? value.slice(0, 100) : []) {
    if (!entryValue || typeof entryValue !== "object" || Array.isArray(entryValue)) continue;
    const kind = text(entryValue.kind).trim();
    const title = safeReceiptText(entryValue.title).trim().slice(0, 500);
    const storageRootId = safeStorageRootId(entryValue.storage_root_id);
    const relativePath = safeRelativePath(entryValue.relative_path);
    const locatorSource = text(entryValue.locator).trim();
    const locator =
      kind === "url" ? safeExternalUrl(locatorSource) : safeRelativePath(locatorSource);
    if (storageRootId && relativePath) {
      refs.push({
        kind: kind || "canonical_document",
        ...(title ? { title } : {}),
        storage_root_id: storageRootId,
        relative_path: relativePath,
        locator: `${storageRootId}:${relativePath}`,
      });
    } else if (locator) {
      refs.push({ kind: kind || "external_system", ...(title ? { title } : {}), locator });
    }
  }
  const safe = [
    ...new Map(refs.map((entry) => [`${entry.kind}|${entry.locator}`, entry])).values(),
  ].sort((left, right) =>
    `${left.kind}|${left.locator}`.localeCompare(`${right.kind}|${right.locator}`),
  );
  if (!budget) return safe;
  return safe
    .map((entry) => {
      const locator = budget.take(entry.locator, 2_000);
      if (!locator) return null;
      const titleValue = entry.title ? budget.take(entry.title, 500) : "";
      const relativePathValue = entry.relative_path ? budget.take(entry.relative_path, 2_000) : "";
      return {
        kind: entry.kind,
        ...(titleValue ? { title: titleValue } : {}),
        ...(entry.storage_root_id ? { storage_root_id: entry.storage_root_id } : {}),
        ...(relativePathValue ? { relative_path: relativePathValue } : {}),
        locator,
      };
    })
    .filter(Boolean);
}

export function publicAiHeader(record, budget = null) {
  const header =
    record?.ai && typeof record.ai === "object" && !Array.isArray(record.ai) ? record.ai : null;
  if (!header) return null;
  const take = (value, limit) =>
    budget ? budget.take(safeReceiptText(value), limit) : safeReceiptText(value).slice(0, limit);
  const visibility = Array.isArray(header.ai_visibility)
    ? [
        ...new Set(
          header.ai_visibility.filter((entry) =>
            ["m365", "coding_agent", "external_ai"].includes(entry),
          ),
        ),
      ].sort()
    : [];
  const typedRef = (value) =>
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    text(value.type).trim() &&
    text(value.id).trim()
      ? { type: text(value.type).trim(), id: text(value.id).trim() }
      : null;
  return {
    id: text(header.id).trim(),
    type: text(header.type).trim(),
    title: take(header.title, 500),
    summary: take(header.summary, 4_000),
    summary_authority: header.summary_authority || null,
    summary_origin: header.summary_origin || "missing",
    freshness: header.freshness || "unknown",
    freshness_origin: header.freshness_origin || "unset",
    freshness_reason: take(header.freshness_reason, 1_000),
    authority: header.authority || null,
    authority_origin: header.authority_origin || "unset",
    authority_reason: take(header.authority_reason, 1_000),
    ai_visibility: visibility,
    ai_visibility_source: header.ai_visibility_source || null,
    ai_visibility_reason: take(header.ai_visibility_reason, 1_000),
    theme_id: header.theme_id || null,
    updated_at: header.updated_at || null,
    last_verified_at: header.last_verified_at || null,
    superseded_by: typedRef(header.superseded_by),
    source_refs: safeAiSourceRefs(header.source_refs, budget),
  };
}

function withPublicAi(record, output, budget) {
  const ai = publicAiHeader(record, budget);
  return ai ? { ...output, ai } : output;
}

export function detailLocator(type, id) {
  const toolByType = {
    note: "tasken.get_note",
    conversation: "tasken.get_conversation",
    artifact: "tasken.get_artifact_metadata",
    activity: "tasken.get_activity_entries",
  };
  const idFieldByType = {
    note: "note_id",
    conversation: "conversation_id",
    artifact: "artifact_id",
    activity: "task_id",
  };
  return { tool: toolByType[type], arguments: { [idFieldByType[type]]: id } };
}

export function publicNoteSummary(note, budget, relation) {
  const takeSafe = (value, limit) => budget.take(safeReceiptText(value), limit);
  return withPublicAi(
    note,
    {
      ...commonFields(note),
      title: takeSafe(note.title, 500),
      note_type: note.note_type || "note",
      excerpt: takeSafe(note.body_markdown, 600),
      included_because: relation.includedBecause,
      relation_path: relation.path,
      locator: detailLocator("note", note.id),
    },
    budget,
  );
}

export function publicConversationSummary(resource, budget, relation) {
  const takeSafe = (value, limit) => budget.take(safeReceiptText(value), limit);
  return withPublicAi(
    resource,
    {
      ...commonFields(resource),
      resource_scope: "chat_ref",
      kind: "conversation",
      title: takeSafe(resource.title, 500),
      description: takeSafe(resource.description, 600),
      excerpt: takeSafe(resource.body_markdown, 600),
      source_url: safeExternalUrl(resource.url),
      message_count: Number.isFinite(Number(resource.message_count))
        ? Number(resource.message_count)
        : null,
      included_because: relation.includedBecause,
      relation_path: relation.path,
      locator: detailLocator("conversation", resource.id),
    },
    budget,
  );
}

export function publicResourceSummary(resource, budget, relation) {
  const takeSafe = (value, limit) => budget.take(safeReceiptText(value), limit);
  return withPublicAi(
    resource,
    {
      ...commonFields(resource),
      title: takeSafe(resource.title, 500),
      description: takeSafe(resource.description, 600),
      source_url: safeExternalUrl(resource.url),
      included_because: relation.includedBecause,
      relation_path: relation.path,
    },
    budget,
  );
}

export function publicArtifactMetadata(artifact, budget, relation = null) {
  const takeSafe = (value, limit) => budget.take(safeReceiptText(value), limit);
  return withPublicAi(
    artifact,
    {
      ...commonFields(artifact),
      title: takeSafe(artifact.title, 500),
      filename: takeSafe(artifact.filename, 500),
      file_type: artifact.file_type || null,
      mime_type: artifact.mime_type || null,
      file_size: Number.isFinite(Number(artifact.file_size)) ? Number(artifact.file_size) : null,
      storage_mode: artifact.storage_mode || "managed",
      source_type: artifact.source_type || null,
      source_id: artifact.source_id || null,
      origin_note_id: artifact.origin_note_id || null,
      generated_by: artifact.generated_by || null,
      description: takeSafe(artifact.description, 600),
      ...(relation
        ? {
            included_because: relation.includedBecause,
            relation_path: relation.path,
            locator: detailLocator("artifact", artifact.id),
          }
        : {}),
    },
    budget,
  );
}

const HTTP_URL = /https?:\/\/[^\s<>\]})'"`]+/gi;
const DANGEROUS_URL = /\b(?:file|ftp|ftps|sftp|ssh|path):(?:\/\/)?[^\s<>\]})'"`]*/gi;
const WINDOWS_LOCAL_PATH = /(^|[^A-Za-z0-9])(?:[A-Za-z]:[\\/]|\\\\)[^\s,;)\]}> '"`]*/g;
const UNIX_LOCAL_PATH = /(^|[^A-Za-z0-9/:]|:(?!\/\/))\/(?!\/)[^\s,;)\]}> '"`]*/g;
const CREDENTIAL_LABEL =
  "(?:authorization(?:[_-]?token)?|client[_-]?secret|access[_-]?token|refresh[_-]?token|private[_-]?key|credentials?|cookie|password|passwd|pwd|token|secret|api[_-]?key)";
const KEY_VALUE_CREDENTIAL = new RegExp(
  `(^|[^A-Za-z0-9])(${CREDENTIAL_LABEL})\\s*[:=]\\s*(?:(?:Basic|Bearer)\\s+)?(?:"[^"\\r\\n]*"|'[^'\\r\\n]*'|[^\\s,;)\\]}>]+)`,
  "gi",
);
const STANDALONE_CREDENTIAL = /\b(Basic|Bearer)\s+[^\s,;)\]}>]+/gi;
const HIDDEN_REASONING_BLOCK =
  /<(?:analysis|thinking|reasoning)>[\s\S]*?<\/(?:analysis|thinking|reasoning)>|\[(?:analysis|thinking|reasoning)\][\s\S]*?\[\/(?:analysis|thinking|reasoning)\]/gi;
const HIDDEN_REASONING_LINE =
  /(^|\r?\n)\s*(?:chain[ -]of[ -]thought|hidden reasoning|internal reasoning)\s*:\s*[^\r\n]*/gi;
const PRIVATE_KEY_BLOCK =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/gi;
const HIGH_CONFIDENCE_TOKEN =
  /(?:\b(?:gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255}|glpat-[A-Za-z0-9_-]{20,255}|(?:AKIA|ASIA)[A-Z0-9]{16}|sk-(?:proj-)?[A-Za-z0-9_-]{20,255}|sk_(?:live|test)_[A-Za-z0-9]{16,255}|AIza[A-Za-z0-9_-]{35}|npm_[A-Za-z0-9]{20,255})\b|\bxox[baprs]-[A-Za-z0-9-]{20,255})/g;
const CREDENTIAL_FIELD_NAMES = new Set([
  "authorization",
  "authorizationtoken",
  "clientsecret",
  "accesstoken",
  "refreshtoken",
  "privatekey",
  "credential",
  "credentials",
  "cookie",
  "password",
  "passwd",
  "pwd",
  "token",
  "secret",
  "apikey",
]);

function credentialFieldName(value) {
  return CREDENTIAL_FIELD_NAMES.has(text(value).replace(/[_-]/g, "").toLowerCase());
}

/** Remove URL credentials, unsupported URL-like locators, local paths, and authentication material. */
export function safeReceiptText(value) {
  let result = text(value);
  result = result.replace(HIDDEN_REASONING_BLOCK, "[redacted-reasoning]");
  result = result.replace(HIDDEN_REASONING_LINE, "$1[redacted-reasoning]");
  result = result.replace(PRIVATE_KEY_BLOCK, "[redacted-private-key]");
  result = result.replace(HTTP_URL, (url) => safeExternalUrl(url) || "[redacted-url]");
  result = result.replace(DANGEROUS_URL, "[redacted-url]");
  result = result.replace(WINDOWS_LOCAL_PATH, "$1[redacted-local-path]");
  result = result.replace(UNIX_LOCAL_PATH, "$1[redacted-local-path]");
  result = result.replace(KEY_VALUE_CREDENTIAL, "$1$2=[redacted]");
  result = result.replace(STANDALONE_CREDENTIAL, "$1 [redacted]");
  result = result.replace(HIGH_CONFIDENCE_TOKEN, "[redacted-token]");
  return result;
}

/** Recursively sanitize JSON-like projections, including credential-named fields and object keys. */
export function safeReceiptValue(value) {
  if (typeof value === "string") return safeReceiptText(value);
  if (Array.isArray(value)) return value.map(safeReceiptValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([rawKey, entry]) => {
      const key = safeReceiptText(rawKey);
      return [key, credentialFieldName(rawKey) ? "[redacted]" : safeReceiptValue(entry)];
    }),
  );
}

export function publicReceiptForContext(receipt, budget) {
  const takeSafe = (value, limit) => budget.take(safeReceiptText(value), limit);
  const safeScalar = (value, limit = 500) => safeReceiptText(value).slice(0, limit);
  const safeUrl = (value) => {
    const url = safeExternalUrl(value);
    return url ? safeScalar(url, 2_000) : null;
  };
  const list = (value) =>
    Array.isArray(value)
      ? value
          .slice(0, 100)
          .map((entry) => takeSafe(entry, 1_000))
          .filter(Boolean)
      : [];
  const rawProvenance =
    receipt.provenance && typeof receipt.provenance === "object" ? receipt.provenance : {};
  const provenance = {};
  for (const field of [
    "reported_via",
    "proposal_id",
    "imported_by",
    "caller",
    "source_session",
    "idempotency_key",
    "proposal_created_at",
  ]) {
    const value = takeSafe(rawProvenance[field], 500);
    if (value) provenance[field] = value;
  }
  const rawRepositoryContext =
    receipt.repository_context && typeof receipt.repository_context === "object"
      ? receipt.repository_context
      : {};
  const repositoryContext = {};
  for (const field of [
    "repository_context_id",
    "repository_id",
    "provider",
    "repository_slug",
    "branch",
  ]) {
    const value = takeSafe(rawRepositoryContext[field], 500);
    if (value) repositoryContext[field] = value;
  }
  const rawRuntime =
    receipt.runtime_metadata && typeof receipt.runtime_metadata === "object"
      ? receipt.runtime_metadata
      : {};
  const runtimeMetadata = {};
  for (const field of ["provider", "model", "report_kind"]) {
    const value = takeSafe(rawRuntime[field], 500);
    if (value) runtimeMetadata[field] = value;
  }
  const common = commonFields(receipt);
  return {
    id: safeScalar(common.id),
    version: common.version,
    created_at: common.created_at ? safeScalar(common.created_at) : null,
    updated_at: common.updated_at ? safeScalar(common.updated_at) : null,
    task_id: safeScalar(receipt.task_id),
    executor_kind: safeScalar(receipt.executor_kind),
    executor_label: takeSafe(receipt.executor_label, 200),
    started_at: receipt.started_at ? safeScalar(receipt.started_at) : null,
    reported_at: receipt.reported_at ? safeScalar(receipt.reported_at) : null,
    summary: takeSafe(receipt.summary, 10_000),
    completed_items: list(receipt.completed_items),
    changed_or_created_items: list(receipt.changed_or_created_items),
    verification: list(receipt.verification),
    remaining_work: list(receipt.remaining_work),
    external_references: Array.isArray(receipt.external_references)
      ? receipt.external_references.slice(0, 100).map((entry) => ({
          kind: safeScalar(entry?.kind, 200) || "other",
          provider: safeScalar(entry?.provider, 200) || "unknown",
          display_label: takeSafe(entry?.display_label, 500),
          url: safeUrl(entry?.url),
          external_id: takeSafe(entry?.external_id, 200) || null,
        }))
      : [],
    source_session: takeSafe(receipt.source_session, 500) || null,
    provenance,
    ...(Object.keys(repositoryContext).length ? { repository_context: repositoryContext } : {}),
    ...(Object.keys(runtimeMetadata).length ? { runtime_metadata: runtimeMetadata } : {}),
  };
}

export function workspaceIdentityProvided(workspace) {
  if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) return false;
  return (
    [
      workspace.repository_id,
      workspace.repositoryId,
      workspace.cwd,
      workspace.git_root,
      workspace.gitRoot,
      workspace.remote_url,
      workspace.repository_slug,
      workspace.repositorySlug,
    ].some((value) => Boolean(text(value).trim())) ||
    (Array.isArray(workspace.remote_urls) &&
      workspace.remote_urls.some((value) => Boolean(text(value).trim()))) ||
    (Array.isArray(workspace.remotes) &&
      workspace.remotes.some((value) => Boolean(text(value).trim())))
  );
}

function relationReason(edges) {
  if (edges.some((edge) => edge.origin === "reference" || edge.origin === "task_dependency"))
    return "explicitly_linked";
  if (edges.some((edge) => edge.layer === "provenance")) return "provenance";
  return "asserted_relation";
}

export function relationForNode(subgraph, type, id) {
  const path = (subgraph.paths || [])
    .filter((candidate) => candidate.to?.type === type && candidate.to?.id === id)
    .sort(
      (left, right) => left.hops - right.hops || left.edge_ids.length - right.edge_ids.length,
    )[0];
  const edgeMap = new Map((subgraph.edges || []).map((edge) => [edge.id, edge]));
  const edges = (path?.edge_ids || []).map((edgeId) => edgeMap.get(edgeId)).filter(Boolean);
  return {
    includedBecause: relationReason(edges),
    path: edges.map((edge) => ({
      edge_id: edge.id,
      assertion_id: edge.assertion_id || null,
      from: edge.source,
      predicate: edge.predicate,
      to: edge.target,
      layer: edge.layer,
      status: edge.status,
      origin: edge.origin,
      evidence_refs: Array.isArray(edge.evidence_refs) ? edge.evidence_refs : [],
      reason: edge.reason || null,
    })),
  };
}

export function boundedList(records, limit) {
  const selected = records.slice(0, limit);
  const omitted = records.slice(limit);
  return {
    selected,
    omitted,
    truncation:
      records.length > limit
        ? {
            reason: "max_items_per_type",
            omitted_count: omitted.length,
            next_ids: omitted
              .slice(0, 10)
              .map((entry) => text(entry.id))
              .filter(Boolean),
          }
        : null,
  };
}
