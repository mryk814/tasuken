const DEFAULT_INCLUDE = ["theme", "repository", "notes", "conversations", "artifacts", "resources", "activity", "work_receipts"];
const INCLUDE_VALUES = new Set(DEFAULT_INCLUDE);

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
  return [...new Set(value.map((entry) => text(entry).trim()).filter((entry) => INCLUDE_VALUES.has(entry)))];
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
  return {
    ...commonFields(task),
    title: budget.take(task.title, 500),
    description: budget.take(task.description, 20_000),
    state: task.state || "todo",
    priority: task.priority || "normal",
    project_id: task.project_id || null,
    plan_node_id: task.plan_node_id || null,
    parent_task_id: task.parent_task_id || null,
    checklist_items: Array.isArray(task.checklist_items)
      ? task.checklist_items.slice(0, 100).map((entry) => ({
        id: text(entry?.id),
        title: budget.take(entry?.title, 500),
        done: Boolean(entry?.done),
        sort_order: Number(entry?.sort_order || 0),
      }))
      : [],
  };
}

export function publicAssignmentForContext(task, budget) {
  return {
    requester: task.requester || "unknown",
    intended_executor: task.intended_executor || "self",
    executor_identity: budget.take(task.executor_identity, 200) || null,
    work_state: task.work_state || (task.intended_executor === "ai_agent" ? "ready_for_agent" : "not_delegated"),
    work_started_at: task.work_started_at || null,
    work_reported_at: task.work_reported_at || null,
    work_review_note: budget.take(task.work_review_note, 2_000) || null,
  };
}

export function publicThemeForContext(theme, budget) {
  if (!theme) return null;
  return {
    ...commonFields(theme),
    name: budget.take(theme.name, 500),
    code: budget.take(theme.code, 120) || null,
    description: budget.take(theme.description, 10_000),
    state: theme.state || null,
  };
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
  return {
    ...commonFields(note),
    title: budget.take(note.title, 500),
    note_type: note.note_type || "note",
    excerpt: budget.take(note.body_markdown, 600),
    included_because: relation.includedBecause,
    relation_path: relation.path,
    locator: detailLocator("note", note.id),
  };
}

export function publicConversationSummary(resource, budget, relation) {
  return {
    ...commonFields(resource),
    title: budget.take(resource.title, 500),
    description: budget.take(resource.description, 600),
    excerpt: budget.take(resource.body_markdown, 600),
    source_url: safeExternalUrl(resource.url),
    message_count: Number.isFinite(Number(resource.message_count)) ? Number(resource.message_count) : null,
    included_because: relation.includedBecause,
    relation_path: relation.path,
    locator: detailLocator("conversation", resource.id),
  };
}

export function publicResourceSummary(resource, budget, relation) {
  return {
    ...commonFields(resource),
    title: budget.take(resource.title, 500),
    description: budget.take(resource.description, 600),
    source_url: safeExternalUrl(resource.url),
    included_because: relation.includedBecause,
    relation_path: relation.path,
  };
}

export function publicArtifactMetadata(artifact, budget, relation = null) {
  return {
    ...commonFields(artifact),
    title: budget.take(artifact.title, 500),
    filename: budget.take(artifact.filename, 500),
    file_type: artifact.file_type || null,
    mime_type: artifact.mime_type || null,
    file_size: Number.isFinite(Number(artifact.file_size)) ? Number(artifact.file_size) : null,
    storage_mode: artifact.storage_mode || "managed",
    source_type: artifact.source_type || null,
    source_id: artifact.source_id || null,
    origin_note_id: artifact.origin_note_id || null,
    generated_by: artifact.generated_by || null,
    description: budget.take(artifact.description, 600),
    ...(relation ? {
      included_because: relation.includedBecause,
      relation_path: relation.path,
      locator: detailLocator("artifact", artifact.id),
    } : {}),
  };
}

export function publicReceiptForContext(receipt, budget) {
  const list = (value) => Array.isArray(value) ? value.slice(0, 100).map((entry) => budget.take(entry, 1_000)).filter(Boolean) : [];
  const rawProvenance = receipt.provenance && typeof receipt.provenance === "object" ? receipt.provenance : {};
  const provenance = {};
  for (const field of ["reported_via", "proposal_id", "imported_by", "caller", "source_session", "idempotency_key", "proposal_created_at"]) {
    const value = budget.take(rawProvenance[field], 500);
    if (value) provenance[field] = value;
  }
  const rawRepositoryContext = receipt.repository_context && typeof receipt.repository_context === "object" ? receipt.repository_context : {};
  const repositoryContext = {};
  for (const field of ["repository_context_id", "repository_id", "provider", "repository_slug", "branch"]) {
    const value = budget.take(rawRepositoryContext[field], 500);
    if (value) repositoryContext[field] = value;
  }
  const rawRuntime = receipt.runtime_metadata && typeof receipt.runtime_metadata === "object" ? receipt.runtime_metadata : {};
  const runtimeMetadata = {};
  for (const field of ["provider", "model", "report_kind"]) {
    const value = budget.take(rawRuntime[field], 500);
    if (value) runtimeMetadata[field] = value;
  }
  return {
    ...commonFields(receipt),
    task_id: receipt.task_id,
    executor_kind: receipt.executor_kind,
    executor_label: budget.take(receipt.executor_label, 200),
    started_at: receipt.started_at || null,
    reported_at: receipt.reported_at || null,
    summary: budget.take(receipt.summary, 10_000),
    completed_items: list(receipt.completed_items),
    changed_or_created_items: list(receipt.changed_or_created_items),
    verification: list(receipt.verification),
    remaining_work: list(receipt.remaining_work),
    external_references: Array.isArray(receipt.external_references)
      ? receipt.external_references.slice(0, 100).map((entry) => ({
        kind: text(entry?.kind) || "other",
        provider: text(entry?.provider) || "unknown",
        display_label: budget.take(entry?.display_label, 500),
        url: safeExternalUrl(entry?.url),
        external_id: budget.take(entry?.external_id, 200) || null,
      }))
      : [],
    source_session: receipt.source_session || null,
    provenance,
    ...(Object.keys(repositoryContext).length ? { repository_context: repositoryContext } : {}),
    ...(Object.keys(runtimeMetadata).length ? { runtime_metadata: runtimeMetadata } : {}),
  };
}

export function workspaceIdentityProvided(workspace) {
  if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) return false;
  return [
    workspace.repository_id, workspace.repositoryId, workspace.cwd,
    workspace.git_root, workspace.gitRoot, workspace.remote_url,
    workspace.repository_slug, workspace.repositorySlug,
  ].some((value) => Boolean(text(value).trim()))
    || (Array.isArray(workspace.remote_urls) && workspace.remote_urls.some((value) => Boolean(text(value).trim())))
    || (Array.isArray(workspace.remotes) && workspace.remotes.some((value) => Boolean(text(value).trim())));
}

function relationReason(edges) {
  if (edges.some((edge) => edge.origin === "reference" || edge.origin === "task_dependency")) return "explicitly_linked";
  if (edges.some((edge) => edge.layer === "provenance")) return "provenance";
  return "asserted_relation";
}

export function relationForNode(subgraph, type, id) {
  const path = (subgraph.paths || [])
    .filter((candidate) => candidate.to?.type === type && candidate.to?.id === id)
    .sort((left, right) => left.hops - right.hops || left.edge_ids.length - right.edge_ids.length)[0];
  const edgeMap = new Map((subgraph.edges || []).map((edge) => [edge.id, edge]));
  const edges = (path?.edge_ids || []).map((edgeId) => edgeMap.get(edgeId)).filter(Boolean);
  return {
    includedBecause: relationReason(edges),
    path: edges.map((edge) => ({
      from: edge.source,
      predicate: edge.predicate,
      to: edge.target,
      layer: edge.layer,
      origin: edge.origin,
    })),
  };
}

export function boundedList(records, limit) {
  const selected = records.slice(0, limit);
  return {
    selected,
    truncation: records.length > limit ? {
      reason: "max_items_per_type",
      omitted_count: records.length - limit,
      next_ids: records.slice(limit, limit + 10).map((entry) => text(entry.id)).filter(Boolean),
    } : null,
  };
}
