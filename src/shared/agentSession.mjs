const workingCopyStatuses = new Set([true, false]);
const sessionStatuses = new Set(["active", "completed", "blocked", "abandoned"]);
const clientKinds = new Set(["codex", "claude_code", "cursor", "github_copilot", "other"]);

const commonFields = [
  "id",
  "created_at",
  "updated_at",
  "deleted_at",
  "device_id",
  "version",
  "source",
];
const workingCopyFields = new Set([
  ...commonFields,
  "repository_context_id",
  "device_id",
  "storage_root_id",
  "worktree_identity",
  "branch_hint",
  "active",
  "last_seen_at",
]);
const agentSessionFields = new Set([
  ...commonFields,
  "started_at",
  "ended_at",
  "status",
  "client_kind",
  "client_label",
  "agent_label",
  "provider_label",
  "model_label",
  "source_session_id",
  "request_events",
  "response_checkpoints",
  "intent",
  "outcome",
]);

function text(value, maxLength = 1000) {
  const normalized = value == null ? "" : String(value).trim();
  if (normalized.length > maxLength) throw new Error(`値は${maxLength}文字以内にしてください。`);
  return normalized;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isoTimestamp(value, field, required = false) {
  const normalized = text(value, 100);
  if (!normalized) {
    if (required) throw new Error(`${field}を入力してください。`);
    return null;
  }
  if (Number.isNaN(Date.parse(normalized))) throw new Error(`${field}が不正です。`);
  return normalized;
}

function stringList(value, field) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 100)
    throw new Error(`${field}は100件以内の配列にしてください。`);
  return value.map((entry) => {
    const normalized = text(entry, 1000);
    if (!normalized) throw new Error(`${field}に空の項目は指定できません。`);
    return normalized;
  });
}

function checkpointList(value, field, maxLength) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 200)
    throw new Error(`${field}は200件以内の配列にしてください。`);
  return value.map((entry) => {
    if (!isRecord(entry)) throw new Error(`${field}の項目はobjectで指定してください。`);
    const observedAt = isoTimestamp(entry.observed_at, `${field}.observed_at`, true);
    const checkpointText = text(entry.text, maxLength);
    if (!checkpointText) throw new Error(`${field}.textを入力してください。`);
    return { observed_at: observedAt, text: checkpointText };
  });
}

function select(input, allowedFields) {
  return Object.fromEntries(Object.entries(input).filter(([key]) => allowedFields.has(key)));
}

function rejectPathLikeIdentity(value, field) {
  const candidate = text(value, 300);
  if (!candidate) throw new Error(`${field}を入力してください。`);
  if (
    /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(candidate) ||
    candidate.includes("\\") ||
    candidate.includes("/")
  ) {
    throw new Error(`${field}にはabsolute/local pathではなくopaque IDを指定してください。`);
  }
  return candidate;
}

export function normalizeWorkingCopy(input = {}) {
  if (!isRecord(input)) throw new Error("WorkingCopyはobjectで指定してください。");
  const normalized = select(input, workingCopyFields);
  normalized.repository_context_id = text(input.repository_context_id, 200);
  normalized.device_id = rejectPathLikeIdentity(input.device_id, "working_copy.device_id");
  normalized.storage_root_id = rejectPathLikeIdentity(
    input.storage_root_id,
    "working_copy.storage_root_id",
  );
  normalized.worktree_identity = text(input.worktree_identity, 300) || null;
  normalized.branch_hint = text(input.branch_hint, 300) || null;
  normalized.active = input.active !== false;
  normalized.last_seen_at = isoTimestamp(input.last_seen_at, "working_copy.last_seen_at");
  if (!normalized.repository_context_id)
    throw new Error("working_copy.repository_context_idを入力してください。");
  if (!workingCopyStatuses.has(normalized.active))
    throw new Error("working_copy.activeが不正です。");
  return normalized;
}

function normalizeIntent(value) {
  if (!isRecord(value)) throw new Error("agent_session.intentはobjectで指定してください。");
  const summary = text(value.summary, 4000);
  if (!summary) throw new Error("agent_session.intent.summaryを入力してください。");
  return {
    summary,
    requested_outcome: text(value.requested_outcome, 4000) || null,
    boundary: text(value.boundary, 4000) || null,
  };
}

function normalizeOutcome(value) {
  if (value == null) return null;
  if (!isRecord(value)) throw new Error("agent_session.outcomeはobjectで指定してください。");
  const summary = text(value.summary, 8000);
  if (!summary) throw new Error("agent_session.outcome.summaryを入力してください。");
  return {
    summary,
    decisions: stringList(value.decisions, "agent_session.outcome.decisions"),
    changed_items: stringList(value.changed_items, "agent_session.outcome.changed_items"),
    verification: stringList(value.verification, "agent_session.outcome.verification"),
    remaining_work: stringList(value.remaining_work, "agent_session.outcome.remaining_work"),
    next_suggested_action: text(value.next_suggested_action, 4000) || null,
  };
}

export function normalizeAgentSession(input = {}) {
  if (!isRecord(input)) throw new Error("AgentSessionはobjectで指定してください。");
  const normalized = select(input, agentSessionFields);
  normalized.started_at = isoTimestamp(input.started_at, "agent_session.started_at", true);
  normalized.ended_at = isoTimestamp(input.ended_at, "agent_session.ended_at");
  normalized.status = text(input.status, 50) || "active";
  normalized.client_kind = text(input.client_kind, 50);
  normalized.client_label = text(input.client_label, 200) || null;
  normalized.agent_label = text(input.agent_label, 200) || null;
  normalized.provider_label = text(input.provider_label, 200) || null;
  normalized.model_label = text(input.model_label, 200) || null;
  normalized.source_session_id = text(input.source_session_id, 500) || null;
  normalized.request_events = checkpointList(
    input.request_events,
    "agent_session.request_events",
    4000,
  );
  normalized.response_checkpoints = checkpointList(
    input.response_checkpoints,
    "agent_session.response_checkpoints",
    8000,
  );
  normalized.intent = normalizeIntent(input.intent);
  normalized.outcome = normalizeOutcome(input.outcome);
  if (!sessionStatuses.has(normalized.status)) throw new Error("agent_session.statusが不正です。");
  if (!clientKinds.has(normalized.client_kind))
    throw new Error("agent_session.client_kindが不正です。");
  if (normalized.ended_at && normalized.ended_at < normalized.started_at) {
    throw new Error("agent_session.ended_atはstarted_at以降にしてください。");
  }
  if (normalized.status === "active" && normalized.ended_at)
    throw new Error("active sessionにended_atは指定できません。");
  if (normalized.status !== "active" && !normalized.ended_at)
    throw new Error("終了したsessionにはended_atが必要です。");
  if (normalized.status === "completed" && !normalized.outcome)
    throw new Error("completed sessionにはoutcomeが必要です。");
  return normalized;
}

export function publicWorkingCopy(input) {
  const normalized = normalizeWorkingCopy(input);
  return {
    id: normalized.id,
    repository_context_id: normalized.repository_context_id,
    device_id: normalized.device_id,
    storage_root_id: normalized.storage_root_id,
    worktree_identity: normalized.worktree_identity,
    branch_hint: normalized.branch_hint,
    active: normalized.active,
    last_seen_at: normalized.last_seen_at,
  };
}

export function publicAgentSession(input) {
  const normalized = normalizeAgentSession(input);
  return {
    id: normalized.id,
    started_at: normalized.started_at,
    ended_at: normalized.ended_at,
    status: normalized.status,
    client_kind: normalized.client_kind,
    client_label: normalized.client_label,
    agent_label: normalized.agent_label,
    provider_label: normalized.provider_label,
    model_label: normalized.model_label,
    source_session_id: normalized.source_session_id,
    intent: normalized.intent,
    outcome: normalized.outcome,
  };
}

export const AGENT_SESSION_STATUSES = Object.freeze([...sessionStatuses]);
export const AGENT_CLIENT_KINDS = Object.freeze([...clientKinds]);
