/**
 * Activity is a structured event index, not a collection of display strings.
 *
 * The legacy change_event columns are deliberately kept as a compatibility
 * projection.  New code should use the fields in this module and should never
 * parse a human-readable summary to recover identity.
 */

export const ACTIVITY_EVENT_SCHEMA_VERSION = 1;

export const ACTIVITY_EVENT_KINDS = Object.freeze([
  "task_created",
  "task_updated",
  "task_checklist_checked",
  "task_checklist_unchecked",
  "task_completed",
  "task_reopened",
  "task_work_recorded",
  "task_ai_reported",
  "task_ai_accepted",
  "task_ai_returned",
  "waiting_received",
  "waiting_updated",
  "plan_node_created",
  "plan_node_updated",
  "note_created",
  "note_updated",
  "report_created",
  "report_updated",
  "prompt_created",
  "prompt_updated",
  "resource_added",
  "resource_updated",
  "artifact_added",
  "artifact_updated",
  "knowledge_created",
  "knowledge_updated",
  "sketch_created",
  "sketch_updated",
  "reference_created",
  "reference_updated",
  "capture_formalized",
  "entity_deleted",
  "entity_updated",
  "schedule_updated",
  "status_updated",
]);

const eventKindSet = new Set(ACTIVITY_EVENT_KINDS);
const legacyChangeTypes = new Set([
  "created",
  "updated",
  "completed",
  "rescheduled",
  "triaged",
  "deleted",
]);
const systemFields = new Set([
  "id",
  "created_at",
  "updated_at",
  "deleted_at",
  "device_id",
  "source",
  "version",
  "before_json",
  "after_json",
  "receipt_json",
  "change_type",
  "changed_at",
]);

function text(value) {
  return value == null ? "" : String(value).trim();
}

function jsonValue(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `activity-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function iso(value, fallback = new Date().toISOString()) {
  const raw = text(value);
  if (!raw) return fallback;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function stableJson(value) {
  if (value == null) return "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isObject(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function shortHash(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function parseEntity(value) {
  const parsed = jsonValue(value);
  return isObject(parsed) ? parsed : null;
}

function entityTypeOf(value) {
  const raw = text(value).toLowerCase();
  return raw === "project" ? "project" : raw;
}

function entityRef(type, id, revision) {
  const normalizedType = entityTypeOf(type);
  const normalizedId = text(id);
  if (!normalizedType || !normalizedId) return null;
  const ref = { type: normalizedType, id: normalizedId };
  if (revision != null && Number.isFinite(Number(revision))) ref.revision = Number(revision);
  return ref;
}

export function themeRefFromEntity(entity) {
  const id = text(entity?.project_id || entity?.theme_id);
  return id ? { kind: "theme", id } : { kind: "none", id: null };
}

function normalizeThemeRef(value, entity) {
  if (isObject(value) && (value.kind === "theme" || value.kind === "none")) {
    return { kind: value.kind, id: value.kind === "theme" ? text(value.id) || null : null };
  }
  if (text(value)) return { kind: "theme", id: text(value) };
  return themeRefFromEntity(entity);
}

function safeRelativePath(value) {
  const raw = text(value).replaceAll("\\", "/");
  if (!raw || raw.startsWith("/") || /^[A-Za-z]:\//.test(raw) || raw.startsWith("//")) return "";
  if (raw.split("/").includes("..")) return "";
  return raw.replace(/^\.\//, "");
}

function safeWebUrl(value) {
  const raw = text(value);
  return /^https?:\/\//i.test(raw) ? raw : "";
}

export function normalizeCanonicalRef(value, fallback = {}) {
  if (!isObject(value)) return null;
  const kind = text(value.kind) || text(fallback.kind) || "canonical_markdown";
  const storageRootId = text(value.storage_root_id || value.root_id || fallback.storage_root_id);
  const locator = text(value.locator);
  const relativePath = safeRelativePath(
    value.relative_path || value.path || (storageRootId ? locator : "") || fallback.relative_path,
  );
  const webUrl = safeWebUrl(
    value.web_url || value.url || (!storageRootId ? locator : "") || fallback.web_url,
  );
  if (!storageRootId && !relativePath && !webUrl) return null;
  const ref = { kind };
  if (storageRootId) ref.storage_root_id = storageRootId;
  if (relativePath) ref.relative_path = relativePath;
  if (webUrl) ref.web_url = webUrl;
  const entityId = text(value.entity_id);
  if (entityId) ref.entity_id = entityId;
  return ref;
}

function canonicalRefsFromEntity(entity, event = {}) {
  const candidates = [];
  if (Array.isArray(event.canonical_refs)) candidates.push(...event.canonical_refs);
  if (event.canonical_ref) candidates.push(event.canonical_ref);
  if (Array.isArray(entity?.canonical_refs)) candidates.push(...entity.canonical_refs);
  if (entity?.canonical_ref) candidates.push(entity.canonical_ref);
  const properties = jsonValue(entity?.properties_json);
  if (isObject(properties)) {
    if (properties.canonical_ref) candidates.push(properties.canonical_ref);
    if (Array.isArray(properties.canonical_refs)) candidates.push(...properties.canonical_refs);
  }
  return [
    ...new Map(
      candidates
        .map((value) => normalizeCanonicalRef(value, { entity_id: entity?.id }))
        .filter(Boolean)
        .map((value) => [JSON.stringify(value), value]),
    ).values(),
  ];
}

function normalizeTypedRef(value) {
  if (!isObject(value)) return null;
  const ref = entityRef(
    value.type || value.entity_type,
    value.id || value.entity_id,
    value.revision,
  );
  if (!ref) return null;
  if (text(value.relation || value.predicate))
    ref.relation = text(value.relation || value.predicate);
  if (text(value.role)) ref.role = text(value.role);
  return ref;
}

function sourceRefsFromEntity(entity, event = {}) {
  const candidates = [];
  if (Array.isArray(event.source_refs)) candidates.push(...event.source_refs);
  if (Array.isArray(entity?.source_refs)) candidates.push(...entity.source_refs);
  if (Array.isArray(entity?.ai_source_refs)) candidates.push(...entity.ai_source_refs);
  if (entity?.source_record_id)
    candidates.push({ type: "source_record", id: entity.source_record_id });
  if (entity?.source_type && entity?.source_id)
    candidates.push({ type: entity.source_type, id: entity.source_id });
  return [
    ...new Map(
      candidates
        .map((value) => {
          if (
            isObject(value) &&
            (value.locator || value.kind === "url" || value.kind === "canonical_document")
          ) {
            const canonical = normalizeCanonicalRef(value, {});
            if (canonical) return [JSON.stringify(canonical), canonical];
          }
          const ref = normalizeTypedRef(value);
          return ref ? [JSON.stringify(ref), ref] : ["", null];
        })
        .filter(([key, value]) => key && value),
    ).values(),
  ];
}

function relationRefsFromEntity(entity, event = {}) {
  const candidates = Array.isArray(event.relation_refs) ? event.relation_refs : [];
  if (Array.isArray(entity?.relation_refs)) candidates.push(...entity.relation_refs);
  return [
    ...new Map(
      candidates
        .map((value) => normalizeTypedRef(value))
        .filter(Boolean)
        .map((value) => [JSON.stringify(value), value]),
    ).values(),
  ];
}

export function changedFields(beforeValue, afterValue) {
  const before = parseEntity(beforeValue) || {};
  const after = parseEntity(afterValue) || {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter((key) => !systemFields.has(key) && stableJson(before[key]) !== stableJson(after[key]))
    .sort();
}

function checklistToggleDirection(before, after) {
  const previousItems = Array.isArray(before?.checklist_items) ? before.checklist_items : null;
  const nextItems = Array.isArray(after?.checklist_items) ? after.checklist_items : null;
  if (!previousItems || !nextItems) return null;
  const previousDoneById = new Map();
  for (const item of previousItems) {
    if (!isObject(item) || !text(item.id)) continue;
    previousDoneById.set(text(item.id), Boolean(item.done));
  }
  let checked = 0;
  let unchecked = 0;
  for (const item of nextItems) {
    if (!isObject(item) || !text(item.id) || !previousDoneById.has(text(item.id))) continue;
    const previousDone = previousDoneById.get(text(item.id));
    const nextDone = Boolean(item.done);
    if (previousDone === nextDone) continue;
    if (nextDone) checked += 1;
    else unchecked += 1;
  }
  if (checked === 1 && unchecked === 0) return "checked";
  if (unchecked === 1 && checked === 0) return "unchecked";
  return null;
}

export function activityEventKind({
  entityType,
  changeType,
  commandName,
  before,
  after,
  eventKind,
} = {}) {
  if (eventKind && eventKindSet.has(eventKind)) return eventKind;
  const type = entityTypeOf(entityType);
  const command = text(commandName);
  const previous = parseEntity(before);
  const next = parseEntity(after);
  if (changeType === "deleted") return "entity_deleted";
  if (type === "task") {
    if (
      command === "CompleteTask" ||
      changeType === "completed" ||
      (previous?.state !== "done" && next?.state === "done")
    )
      return "task_completed";
    if (
      command === "ReopenTask" ||
      (previous?.state === "done" && next?.state && next.state !== "done")
    )
      return "task_reopened";
    const checklistChange = checklistToggleDirection(previous, next);
    if (checklistChange === "checked") return "task_checklist_checked";
    if (checklistChange === "unchecked") return "task_checklist_unchecked";
    return previous ? "task_updated" : "task_created";
  }
  if (type === "note") {
    const noteType = text(next?.note_type || previous?.note_type);
    const prefix = noteType === "report" ? "report" : noteType === "prompt" ? "prompt" : "note";
    return `${prefix}_${previous ? "updated" : "created"}`;
  }
  if (type === "resource")
    return changeType === "created" || !previous ? "resource_added" : "resource_updated";
  if (type === "artifact") return previous ? "artifact_updated" : "artifact_added";
  if (type === "waiting")
    return changeType === "completed" || next?.state === "received"
      ? "waiting_received"
      : "waiting_updated";
  if (type === "plan_node") return previous ? "plan_node_updated" : "plan_node_created";
  if (type === "knowledge_node") return previous ? "knowledge_updated" : "knowledge_created";
  if (type === "sketch") return previous ? "sketch_updated" : "sketch_created";
  if (type === "reference") return previous ? "reference_updated" : "reference_created";
  if (type === "schedule") return "schedule_updated";
  if (type === "status_update") return "status_updated";
  if (changeType === "created") return "entity_updated";
  return "entity_updated";
}

function defaultSummary(kind, entity, entityRefValue) {
  const title =
    text(entity?.title || entity?.name) ||
    `${entityRefValue?.type || "Entity"} ${entityRefValue?.id || ""}`.trim();
  if (kind === "task_work_recorded") return `Task work recorded: ${title}`;
  if (kind === "task_ai_reported") return `AI reported work: ${title}`;
  if (kind === "task_ai_accepted") return `AI work accepted: ${title}`;
  if (kind === "task_ai_returned") return `AI work returned: ${title}`;
  return `${kind}: ${title}`;
}

function normalizeOrigin(value, source, metadata) {
  if (isObject(value)) {
    return {
      kind: text(value.kind) || text(source) || "manual",
      ...(text(value.command_id) ? { command_id: text(value.command_id) } : {}),
      ...(text(value.command_name) ? { command_name: text(value.command_name) } : {}),
      ...(text(value.session_id) ? { session_id: text(value.session_id) } : {}),
    };
  }
  return {
    kind: text(value) || text(source) || "manual",
    ...(text(metadata?.command_id) ? { command_id: text(metadata.command_id) } : {}),
  };
}

function normalizeActor(value, legacy = {}) {
  const actor = isObject(value) ? value : {};
  return {
    kind: text(actor.kind || legacy.actor_kind) || "user",
    ...(text(actor.id || legacy.actor_id) ? { id: text(actor.id || legacy.actor_id) } : {}),
  };
}

function normalizeMetadata(value, event, origin) {
  const metadata = isObject(value) ? clone(value) : {};
  metadata.schema_version = ACTIVITY_EVENT_SCHEMA_VERSION;
  if (text(origin.session_id) && !text(metadata.session_id))
    metadata.session_id = text(origin.session_id);
  if (text(origin.command_id) && !text(metadata.command_id))
    metadata.command_id = text(origin.command_id);
  if (text(event.dedupe_key) && !text(metadata.dedupe_key))
    metadata.dedupe_key = text(event.dedupe_key);
  return metadata;
}

/** Build the canonical event and retain legacy columns for old readers. */
export function buildActivityEvent(input = {}) {
  const before = parseEntity(input.before_json ?? input.before);
  const after = parseEntity(input.after_json ?? input.after) || {};
  const type = entityTypeOf(input.entity_type || input.entityType || input.entity_ref?.type);
  const id = text(input.entity_id || input.entityId || input.entity_ref?.id || after.id);
  const ref = entityRef(type, id, input.entity_ref?.revision ?? after.version);
  if (!ref) throw new Error("Activity EventのEntity参照が不正です。");
  const kind = activityEventKind({
    entityType: type,
    changeType: input.change_type || input.changeType,
    commandName: input.command_name || input.commandName,
    before,
    after,
    eventKind: input.event_kind || input.eventKind,
  });
  const completedAt = input.completed_at || input.completedAt || after.completed_at;
  const occurredAt =
    (kind === "task_completed" && completedAt) ||
    input.occurred_at ||
    input.occurredAt ||
    input.changed_at ||
    input.changedAt ||
    after.updated_at;
  const source = text(input.source || input.origin?.kind) || "manual";
  const metadata = normalizeMetadata(input.metadata, input, input.origin || {});
  if (!text(metadata.dedupe_key)) {
    const session = text(metadata.session_id || input.origin?.session_id || input.command_id) || "";
    metadata.dedupe_key = session
      ? [type, id, kind, session].join(":")
      : [type, id, kind, "", shortHash(stableJson(after))].join(":");
  }
  const event = {
    id: text(input.id) || uuid(),
    occurred_at: iso(occurredAt),
    event_kind: kind,
    entity_ref: ref,
    theme_ref: normalizeThemeRef(input.theme_ref, after),
    actor: normalizeActor(input.actor, input),
    origin: normalizeOrigin(input.origin, source, metadata),
    summary: text(input.summary) || defaultSummary(kind, after, ref),
    changed_fields: Array.isArray(input.changed_fields)
      ? [...new Set(input.changed_fields.map(text).filter(Boolean))].sort()
      : changedFields(before, after),
    canonical_refs: canonicalRefsFromEntity(after, input),
    source_refs: sourceRefsFromEntity(after, input),
    relation_refs: relationRefsFromEntity(after, input),
    work_receipt_ref: normalizeTypedRef(
      input.work_receipt_ref ||
        after.work_receipt_ref ||
        (after.work_receipt_id ? { type: "work_receipt", id: after.work_receipt_id } : null),
    ),
    metadata,
    // Compatibility projection for v1 readers and snapshots.
    entity_type: type,
    entity_id: id,
    changed_at: iso(input.changed_at || input.changedAt || occurredAt),
    change_type:
      text(input.change_type || input.changeType) ||
      (kind.endsWith("_created") || kind.endsWith("_added")
        ? "created"
        : kind === "task_completed"
          ? "completed"
          : kind === "schedule_updated"
            ? "rescheduled"
            : kind === "entity_deleted"
              ? "deleted"
              : "updated"),
    reason: input.reason ?? null,
    before_json:
      input.before_json !== undefined
        ? input.before_json
        : input.before !== undefined
          ? input.before
          : before || null,
    after_json:
      input.after_json !== undefined
        ? input.after_json
        : input.after !== undefined
          ? input.after
          : Object.keys(after).length
            ? after
            : null,
    source,
  };
  if (text(input.command_id)) event.command_id = text(input.command_id);
  if (text(input.command_name)) event.command_name = text(input.command_name);
  if (text(input.command_fingerprint)) event.command_fingerprint = text(input.command_fingerprint);
  if (text(input.command_source)) event.command_source = text(input.command_source);
  if (text(input.actor_kind)) event.actor_kind = text(input.actor_kind);
  if (text(input.actor_id)) event.actor_id = text(input.actor_id);
  if (text(input.receipt_json)) event.receipt_json = input.receipt_json;
  return event;
}

/** Idempotent legacy migration. Existing fields are not deleted or rewritten. */
export function migrateChangeEvent(event, { entity = null } = {}) {
  if (!isObject(event)) throw new Error("Change Eventが不正です。");
  if (
    Number(event.metadata?.schema_version) >= ACTIVITY_EVENT_SCHEMA_VERSION &&
    event.event_kind &&
    event.entity_ref
  ) {
    return clone(event);
  }
  const migrated = buildActivityEvent({
    ...event,
    after: parseEntity(event.after_json) || entity || {},
    before: parseEntity(event.before_json),
    metadata: {
      ...(isObject(event.metadata) ? event.metadata : {}),
      migrated_from: "legacy_change_event",
      // A legacy row has no session contract. Keep each historical row
      // addressable instead of accidentally collapsing the whole history.
      dedupe_key: text(event.metadata?.dedupe_key) || `legacy:${text(event.id)}`,
    },
    occurred_at: event.occurred_at || event.occurredAt || event.changed_at,
    event_kind: event.event_kind,
    entity_ref: event.entity_ref,
  });
  return { ...event, ...migrated, id: text(event.id) || migrated.id };
}

export function normalizeActivityEvent(event, context = {}) {
  return migrateChangeEvent(event, context);
}

export function isStructuredActivityEvent(value) {
  return Boolean(
    isObject(value) &&
    value.entity_ref?.type &&
    value.entity_ref?.id &&
    eventKindSet.has(value.event_kind) &&
    value.occurred_at &&
    value.metadata?.schema_version,
  );
}

export function activityEventDedupeKey(event) {
  const metadata = isObject(event?.metadata) ? event.metadata : {};
  if (text(metadata.dedupe_key)) return text(metadata.dedupe_key);
  const ref = event?.entity_ref || {};
  const origin = event?.origin || {};
  return `${text(ref.type)}:${text(ref.id)}:${text(event?.event_kind)}:${text(metadata.session_id || origin.session_id || event?.command_id)}`;
}

export function resolveCanonicalRef(ref, roots = {}) {
  const normalized = normalizeCanonicalRef(ref);
  if (!normalized) return { status: "broken", ref: null, path: null };
  if (!normalized.storage_root_id || !normalized.relative_path) {
    return {
      status: normalized.web_url ? "ok" : "broken",
      ref: normalized,
      path: normalized.web_url || null,
    };
  }
  const root =
    roots instanceof Map
      ? roots.get(normalized.storage_root_id)
      : roots[normalized.storage_root_id];
  if (!root) {
    return normalized.web_url
      ? { status: "ok", local_status: "broken", ref: normalized, path: normalized.web_url }
      : { status: "broken", ref: normalized, path: null };
  }
  if (typeof root === "object") {
    if (root.status === "broken") {
      return normalized.web_url
        ? { status: "ok", local_status: "broken", ref: normalized, path: normalized.web_url }
        : { status: "broken", ref: normalized, path: null };
    }
    if (root.status === "ok" && !root.path) {
      return normalized.web_url
        ? { status: "ok", local_status: "broken", ref: normalized, path: normalized.web_url }
        : { status: "ok", ref: normalized, path: null };
    }
  }
  const rootPath = typeof root === "string" ? root : root.path;
  if (!rootPath) {
    return normalized.web_url
      ? { status: "ok", local_status: "broken", ref: normalized, path: normalized.web_url }
      : { status: "broken", ref: normalized, path: null };
  }
  return {
    status: "ok",
    ref: normalized,
    path: `${String(rootPath).replace(/[\\/]$/, "")}/${normalized.relative_path}`,
  };
}
