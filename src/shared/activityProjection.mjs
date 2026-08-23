import {
  ACTIVITY_EVENT_SCHEMA_VERSION,
  activityEventDedupeKey,
  migrateChangeEvent,
  normalizeCanonicalRef,
  resolveCanonicalRef,
  themeRefFromEntity,
} from "./activityEvent.mjs";
import { projectEntityForAi, summarizeAiExclusions } from "./aiMetadata.mjs";
import { safeExternalUrl, safeReceiptText } from "./taskContext.mjs";

const DEFAULT_TIMEZONE = "Asia/Tokyo";
const MAX_EVENTS = 500;
const DEFAULT_ACTIVITY_KINDS = new Set([
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
  "status_updated",
]);
const PUBLIC_METADATA_KEYS = new Set([
  "schema_version",
  "dedupe_key",
  "session_id",
  "command_id",
  "command_name",
  "command_source",
  "include_in_activity",
  "formalized",
  "activity_summary",
  "migrated_from",
  "entity_status",
  "work_action",
  "executor_kind",
  "executor_label",
  "provenance",
  "repository_context",
  "reported_via",
  "imported_by",
  "proposal_id",
  "caller",
  "source_session",
  "idempotency_key",
  "proposal_created_at",
  "media_kind",
  "artifact_id",
  "derived_from_artifact_id",
  "source_type",
  "source_id",
  "content_hash",
  "review_note",
  "note_ai_command_marker",
]);
const PUBLIC_METADATA_OBJECT_FIELDS = new Map([
  ["provenance", [
    "reported_via",
    "captured_at",
    "capture_method",
    "recognition_mode",
    "language",
    "confidence",
    "source_audio_available",
    "shared_mime_type",
    "proposal_id",
    "caller",
    "source_session",
    "idempotency_key",
    "proposal_created_at",
    "imported_by",
  ]],
  ["repository_context", ["repository_context_id", "provider", "repository_slug", "branch"]],
  ["note_ai_command_marker", ["schema", "commandId", "commandFingerprint", "noteId", "proposalId", "noteVersion", "proposalVersion"]],
]);
const REDACTED_MARKER = /\[redacted(?:-url|-local-path)?\]/i;
const ACTOR_FIELDS = ["kind", "id"];
const ORIGIN_FIELDS = ["kind", "command_id", "command_name", "session_id"];

function text(value) {
  return value == null ? "" : String(value).trim();
}

function publicText(value) {
  return safeReceiptText(value).trim();
}

function publicIdentifier(value) {
  const safe = publicText(value);
  return safe && !REDACTED_MARKER.test(safe) ? safe : null;
}

function publicPrimitive(value) {
  if (typeof value === "string") return safeReceiptText(value);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return undefined;
}

function publicMetadataValue(keyName, value) {
  const objectFields = PUBLIC_METADATA_OBJECT_FIELDS.get(keyName);
  if (objectFields) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return Object.fromEntries(objectFields.flatMap((field) => {
      if (!Object.hasOwn(value, field)) return [];
      const safe = publicPrimitive(value[field]);
      return safe === undefined ? [] : [[field, safe]];
    }));
  }
  if (Array.isArray(value)) {
    return value.map(publicPrimitive).filter((entry) => entry !== undefined);
  }
  return publicPrimitive(value);
}

function publicStringRecord(value, fields) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = {};
  for (const field of fields) {
    const safe = publicIdentifier(source[field]);
    if (safe) result[field] = safe;
  }
  return result;
}

function publicMetadata(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = {};
  for (const keyName of PUBLIC_METADATA_KEYS) {
    if (!Object.hasOwn(source, keyName)) continue;
    const safe = publicMetadataValue(keyName, source[keyName]);
    if (safe !== undefined) result[keyName] = safe;
  }
  return result;
}

function safeStorageRootId(value) {
  const source = text(value);
  if (!source || safeReceiptText(source) !== source || REDACTED_MARKER.test(source)) return null;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:$/.test(source)) return null;
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(source) ? source : null;
}

function safeRelativeLocator(value) {
  const source = text(value).replaceAll("\\", "/");
  if (!source || source.startsWith("/") || /^[A-Za-z]:\//.test(source) || source.startsWith("//")) return null;
  if (source.split("/").some((segment) => segment === "..") || /[\x00-\x1f\x7f]/.test(source)) return null;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(source) || safeReceiptText(source) !== source || REDACTED_MARKER.test(source)) return null;
  return source.replace(/^\.\//, "").slice(0, 2_000) || null;
}

function publicTypedRef(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const type = publicIdentifier(value.type);
  const id = publicIdentifier(value.id);
  if (!type || !id) return null;
  const relation = publicIdentifier(value.relation);
  const role = publicIdentifier(value.role);
  return {
    type,
    id,
    ...(Number.isFinite(value.revision) ? { revision: value.revision } : {}),
    ...(relation ? { relation } : {}),
    ...(role ? { role } : {}),
  };
}

function normalizeTimezone(value) {
  const candidate = text(value) || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function active(record) {
  return Boolean(record) && !record.deleted_at;
}

function collection(workspace, key) {
  return Array.isArray(workspace?.[key]) ? workspace[key] : [];
}

function key(type, id) {
  return `${type}:${id}`;
}

function entityTitle(entity, ref) {
  return text(entity?.title || entity?.name) || `${ref.type}:${ref.id}`;
}

function localDate(value, timezone) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || DEFAULT_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return timezone && timezone !== DEFAULT_TIMEZONE ? localDate(value, DEFAULT_TIMEZONE) : date.toISOString().slice(0, 10);
  }
}

function localTime(value, timezone) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone || DEFAULT_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return timezone && timezone !== DEFAULT_TIMEZONE ? localTime(value, DEFAULT_TIMEZONE) : date.toISOString().slice(11, 16);
  }
}

function allEntities(workspace = {}, entities = {}) {
  const map = new Map();
  for (const [type, records] of Object.entries(entities || {})) {
    for (const record of Array.isArray(records) ? records : []) {
      if (record?.id) map.set(key(type, record.id), record);
    }
  }
  for (const [type, records] of Object.entries(workspace || {})) {
    if (!Array.isArray(records)) continue;
    for (const record of records) {
      if (!record?.id) continue;
      const normalizedType = type.endsWith("s") ? type.slice(0, -1) : type;
      map.set(key(normalizedType, record.id), record);
    }
  }
  return map;
}

function themeMap(themes = [], workspace = {}) {
  const records = themes.length ? themes : [...collection(workspace, "themes"), ...collection(workspace, "projects")];
  return new Map(records.filter((theme) => theme?.id).map((theme) => [theme.id, theme]));
}

function relationRefsFor(event, workspace) {
  const ref = event.entity_ref;
  const result = [...(event.relation_refs || [])];
  const add = (type, id, relation) => {
    if (!type || !id || (type === ref.type && String(id) === String(ref.id))) return;
    result.push({ type, id: String(id), relation });
  };
  for (const relation of collection(workspace, "references")) {
    if (!active(relation)) continue;
    if (relation.source_type === ref.type && String(relation.source_id) === String(ref.id)) {
      add(relation.target_type, relation.target_id, relation.relation_type || "related_to");
    } else if (relation.target_type === ref.type && String(relation.target_id) === String(ref.id)) {
      add(relation.source_type, relation.source_id, relation.relation_type || "related_to");
    }
  }
  for (const artifact of collection(workspace, "artifacts")) {
    if (!active(artifact)) continue;
    if (artifact.source_type === ref.type && String(artifact.source_id) === String(ref.id)) add("artifact", artifact.id, "generated");
    if (artifact.origin_note_id === ref.id && ref.type === "note") add("artifact", artifact.id, "exported");
  }
  return [...new Map(result.map(publicTypedRef).filter(Boolean).map((value) => [JSON.stringify(value), value])).values()]
    .sort((a, b) => `${a.relation || ""}:${a.type}:${a.id}`.localeCompare(`${b.relation || ""}:${b.type}:${b.id}`));
}

function publicCanonicalBase(value) {
  const ref = normalizeCanonicalRef(value);
  if (!ref) return null;
  const kind = publicIdentifier(ref.kind);
  const storageRootId = safeStorageRootId(ref.storage_root_id);
  const relativePath = safeRelativeLocator(ref.relative_path);
  const webUrl = safeExternalUrl(ref.web_url);
  const entityId = publicIdentifier(ref.entity_id);
  if (!kind || (!webUrl && !(storageRootId && relativePath))) return null;
  return {
    kind,
    ...(storageRootId && relativePath ? { storage_root_id: storageRootId, relative_path: relativePath } : {}),
    ...(webUrl ? { web_url: webUrl } : {}),
    ...(entityId ? { entity_id: entityId } : {}),
  };
}

function publicCanonicalRefs(refs, roots) {
  return (Array.isArray(refs) ? refs : [])
    .map(publicCanonicalBase)
    .filter(Boolean)
    .map((safeRef) => {
      const resolved = resolveCanonicalRef(safeRef, roots);
      return {
        ...safeRef,
        status: resolved.status,
        ...(resolved.local_status ? { local_status: resolved.local_status } : {}),
      };
    })
    .filter(Boolean);
}

function publicSourceRefs(refs) {
  return (Array.isArray(refs) ? refs : []).map((ref) => {
    if (ref?.type || ref?.id) return publicTypedRef(ref);
    return publicCanonicalBase(ref);
  }).filter(Boolean);
}

function deduplicate(events) {
  const byKey = new Map();
  for (const event of events) {
    const dedupeKey = activityEventDedupeKey(event);
    const previous = byKey.get(dedupeKey);
    if (!previous || String(event.occurred_at).localeCompare(String(previous.occurred_at)) > 0) byKey.set(dedupeKey, event);
  }
  return [...byKey.values()];
}

function eventAllowedByDefault(event) {
  // 日程変更は内部状態の同期ログであり、振り返り用のActivityには含めない。
  if (event.event_kind === "schedule_updated") return false;
  if (event.metadata?.include_in_activity === false) return false;
  if (event.metadata?.include_in_activity === true) return true;
  if (!DEFAULT_ACTIVITY_KINDS.has(event.event_kind)) return false;
  if (event.entity_ref?.type === "capture_entry") return Boolean(event.metadata?.formalized);
  if (event.event_kind === "note_updated" || event.event_kind === "report_updated" || event.event_kind === "prompt_updated") {
    return (event.changed_fields || []).some((field) => !["updated_at", "version"].includes(field));
  }
  // A Task being created or having only its title edited is useful in the
  // database history, but is noise in the default Activity index. Completion,
  // reopen, work, and explicit AI transitions have their own fixed kinds.
  if (event.event_kind === "task_updated") return false;
  return true;
}

function projectOne(event, context) {
  const { entityMap, themesById, workspaceDefault, audience, workspace, roots } = context;
  const currentEntity = entityMap.get(key(event.entity_ref.type, event.entity_ref.id));
  const themeId = event.theme_ref?.kind === "theme" ? event.theme_ref.id : text(currentEntity?.project_id || currentEntity?.theme_id);
  const theme = themeId ? themesById.get(themeId) : null;
  if (audience) {
    // #294 policy is evaluated at projection time. Event history does not
    // freeze a past visibility decision.
    if (!currentEntity) return { excluded: { type: event.entity_ref.type, reason: "entity_missing", count: 1 } };
    const policy = projectEntityForAi(event.entity_ref.type, currentEntity || { id: event.entity_ref.id, title: event.summary }, {
      audience,
      theme,
      workspaceDefault,
    });
    if (!policy.included) return { excluded: policy.exclusion };
  }
  const eventId = publicIdentifier(event.id);
  const entityRef = publicTypedRef(event.entity_ref);
  const eventKind = publicIdentifier(event.event_kind);
  if (!eventId || !entityRef || !eventKind) {
    return { excluded: { type: "activity", reason: "unsafe_public_ref", count: 1 } };
  }
  const title = entityTitle(currentEntity, event.entity_ref);
  const themeIdForPublic = publicIdentifier(themeId);
  const projected = {
    id: eventId,
    occurred_at: publicText(event.occurred_at),
    event_kind: eventKind,
    entity_ref: entityRef,
    entity_title: publicText(title),
    theme_ref: themeIdForPublic
      ? { kind: "theme", id: themeIdForPublic }
      : { kind: "none", id: null },
    actor: publicStringRecord(event.actor, ACTOR_FIELDS),
    origin: publicStringRecord(event.origin, ORIGIN_FIELDS),
    summary: publicText(event.summary),
    changed_fields: [...(event.changed_fields || [])].map(publicIdentifier).filter(Boolean),
    canonical_refs: publicCanonicalRefs(event.canonical_refs, roots),
    source_refs: publicSourceRefs(event.source_refs),
    relation_refs: relationRefsFor(event, workspace),
    work_receipt_ref: publicTypedRef(event.work_receipt_ref),
    metadata: publicMetadata(event.metadata),
  };
  if (currentEntity?.deleted_at) projected.metadata.entity_status = "deleted";
  if (!currentEntity) projected.metadata.entity_status = "missing";
  return { event: projected };
}

/**
 * Query and project activity events. All output formats consume this result.
 */
export function queryActivityEvents({
  events = [],
  workspace = {},
  entities = {},
  themes = [],
  references = [],
  date = "",
  from = "",
  to = "",
  themeId = "",
  theme_id = "",
  entityType = "",
  entity_type = "",
  eventKinds = [],
  event_kinds = [],
  timezone = DEFAULT_TIMEZONE,
  audience = null,
  workspaceDefault = undefined,
  roots = {},
  limit = MAX_EVENTS,
  sort_direction = "asc",
  include_match_metadata = false,
} = {}) {
  const sourceWorkspace = { ...workspace, references: references.length ? references : workspace.references };
  const entityMap = allEntities(sourceWorkspace, entities);
  const themesById = themeMap(themes, sourceWorkspace);
  const effectiveTimezone = normalizeTimezone(timezone);
  const kinds = new Set([...(eventKinds.length ? eventKinds : event_kinds)].map(text).filter(Boolean));
  const scopedEvents = deduplicate(events.map((event) => migrateChangeEvent(event, {
    entity: entityMap.get(key(event?.entity_ref?.type || event?.entity_type, event?.entity_ref?.id || event?.entity_id)) || null,
  })).filter(eventAllowedByDefault).filter((event) => {
    const eventDate = localDate(event.occurred_at, effectiveTimezone);
    if (date && eventDate !== date) return false;
    if (from && event.occurred_at < from) return false;
    if (to && event.occurred_at > to) return false;
    if (themeId || theme_id) {
      const selected = themeId || theme_id;
      if (event.theme_ref?.id !== selected) return false;
    }
    if (entityType || entity_type) {
      const selected = entityType || entity_type;
      if (event.entity_ref?.type !== selected) return false;
    }
    if (kinds.size && !kinds.has(event.event_kind)) return false;
    return true;
  }));
  const projected = [];
  const exclusions = [];
  const direction = sort_direction === "desc" ? -1 : 1;
  for (const event of scopedEvents.sort((a, b) => direction * (
    String(a.occurred_at).localeCompare(String(b.occurred_at))
    || String(a.id).localeCompare(String(b.id))
  ))) {
    const result = projectOne(event, { entityMap, themesById, workspaceDefault, audience, workspace: sourceWorkspace, roots });
    if (result.excluded) exclusions.push(result.excluded);
    else if (result.event) projected.push({ ...result.event, local_date: localDate(event.occurred_at, effectiveTimezone), local_time: localTime(event.occurred_at, effectiveTimezone) });
  }
  const max = Math.max(0, Math.min(MAX_EVENTS, Number(limit) || MAX_EVENTS));
  return {
    schema_version: ACTIVITY_EVENT_SCHEMA_VERSION,
    timezone: effectiveTimezone,
    date: date || null,
    events: projected.slice(0, max),
    excluded_count: exclusions.length,
    excluded_reasons: summarizeAiExclusions(exclusions).excluded_reasons,
    truncated: projected.length > max,
    ...(include_match_metadata ? { matched_count: projected.length } : {}),
  };
}

function entityLink(ref) {
  return `tasken://${encodeURIComponent(ref.type)}/${encodeURIComponent(ref.id)}`;
}

function canonicalLink(ref) {
  if (ref.web_url) return `[${ref.relative_path || "Canonical"}](${ref.web_url})`;
  if (ref.storage_root_id && ref.relative_path) return `\`${ref.storage_root_id}:${ref.relative_path}\``;
  return "(broken canonical ref)";
}

export function projectActivityMarkdown(result, { title = "Activity", date = result?.date } = {}) {
  const events = result?.events || [];
  const lines = [`# ${title}${date ? ` ${date}` : ""}`, "", `> timezone: ${result?.timezone || DEFAULT_TIMEZONE}`, "", "## Events"];
  if (!events.length) lines.push("- なし");
  for (const event of events) {
    lines.push(
      "",
      `### ${event.local_time || "--:--"} · ${event.event_kind}`,
      `- Entity: ${event.entity_title} \`${event.entity_ref.type}:${event.entity_ref.id}\` ([open](${entityLink(event.entity_ref)}))`,
      `- Theme: ${event.theme_ref?.kind === "theme" ? event.theme_ref.id : "none"}`,
      `- Changed: ${event.changed_fields.length ? event.changed_fields.join(", ") : "—"}`,
      `- Canonical: ${event.canonical_refs.length ? event.canonical_refs.map(canonicalLink).join(", ") : "—"}`,
      `- Source: ${event.source_refs.length ? event.source_refs.map((ref) => ref.type && ref.id ? `${ref.type}:${ref.id}` : ref.locator || "ref").join(", ") : "—"}`,
      `- Relations: ${event.relation_refs.length ? event.relation_refs.map((ref) => `${ref.relation || "related_to"} ${ref.type}:${ref.id}`).join(", ") : "—"}`,
      `- Summary: ${event.summary}`,
    );
  }
  if (result?.excluded_count) lines.push("", `## Excluded by policy`, `- ${result.excluded_count} event(s)`);
  return lines.join("\n");
}

export function projectActivityJson(result) {
  return JSON.parse(JSON.stringify(result));
}

export function projectActivityMcp(result) {
  return {
    ...projectActivityJson(result),
    read_only: true,
    ai_audience: result?.ai_audience || undefined,
  };
}
