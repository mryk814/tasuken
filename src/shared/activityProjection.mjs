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
import { createActivityHistoryResolver } from "./activityHistory.mjs";
import { activityBoundaryMatches, paginateActivity } from "./activityPagination.mjs";
import {
  isCaptureInput,
  isRecallPlanChange,
  recallCaptureInputs,
  recallEvidence,
} from "./activityRecall.mjs";

const DEFAULT_TIMEZONE = "Asia/Tokyo";
const MAX_EVENTS = 500;
const DEFAULT_ACTIVITY_KINDS = new Set([
  "task_completed",
  "task_reopened",
  "task_checklist_checked",
  "task_checklist_unchecked",
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
  "work_log",
  "schema_version",
  "dedupe_key",
  "session_id",
  "command_id",
  "command_name",
  "command_source",
  "time_basis",
  "operation_issued_at",
  "accepted_at",
  "clock_status",
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
  ["work_log", ["schema", "performed_date", "date_precision", "entered_at", "assertion"]],
  [
    "provenance",
    [
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
    ],
  ],
  ["repository_context", ["repository_context_id", "provider", "repository_slug", "branch"]],
  [
    "note_ai_command_marker",
    [
      "schema",
      "commandId",
      "commandFingerprint",
      "noteId",
      "proposalId",
      "noteVersion",
      "proposalVersion",
    ],
  ],
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
    return Object.fromEntries(
      objectFields.flatMap((field) => {
        if (!Object.hasOwn(value, field)) return [];
        const safe = publicPrimitive(value[field]);
        return safe === undefined ? [] : [[field, safe]];
      }),
    );
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
  if (!source || source.startsWith("/") || /^[A-Za-z]:\//.test(source) || source.startsWith("//"))
    return null;
  if (source.split("/").some((segment) => segment === "..") || /[\x00-\x1f\x7f]/.test(source))
    return null;
  if (
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(source) ||
    safeReceiptText(source) !== source ||
    REDACTED_MARKER.test(source)
  )
    return null;
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

export function localDate(value, timezone) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || DEFAULT_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(
      parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
    );
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return timezone && timezone !== DEFAULT_TIMEZONE
      ? localDate(value, DEFAULT_TIMEZONE)
      : date.toISOString().slice(0, 10);
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
    return timezone && timezone !== DEFAULT_TIMEZONE
      ? localTime(value, DEFAULT_TIMEZONE)
      : date.toISOString().slice(11, 16);
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
  const records = themes.length
    ? themes
    : [...collection(workspace, "themes"), ...collection(workspace, "projects")];
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
    if (artifact.source_type === ref.type && String(artifact.source_id) === String(ref.id))
      add("artifact", artifact.id, "generated");
    if (artifact.origin_note_id === ref.id && ref.type === "note")
      add("artifact", artifact.id, "exported");
  }
  return [
    ...new Map(
      result
        .map(publicTypedRef)
        .filter(Boolean)
        .map((value) => [JSON.stringify(value), value]),
    ).values(),
  ].sort((a, b) =>
    `${a.relation || ""}:${a.type}:${a.id}`.localeCompare(`${b.relation || ""}:${b.type}:${b.id}`),
  );
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
    ...(storageRootId && relativePath
      ? { storage_root_id: storageRootId, relative_path: relativePath }
      : {}),
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
  return (Array.isArray(refs) ? refs : [])
    .map((ref) => {
      if (ref?.type || ref?.id) return publicTypedRef(ref);
      return publicCanonicalBase(ref);
    })
    .filter(Boolean);
}

function deduplicate(events) {
  const byKey = new Map();
  for (const event of events) {
    const dedupeKey = activityEventDedupeKey(event);
    const previous = byKey.get(dedupeKey);
    if (!previous || String(event.occurred_at).localeCompare(String(previous.occurred_at)) > 0)
      byKey.set(dedupeKey, event);
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
  if (
    event.event_kind === "note_updated" ||
    event.event_kind === "report_updated" ||
    event.event_kind === "prompt_updated"
  ) {
    return (event.changed_fields || []).some((field) => !["updated_at", "version"].includes(field));
  }
  // A Task being created or having only its title edited is useful in the
  // database history, but is noise in the default Activity index. Completion,
  // reopen, checklist toggles, work, and explicit AI transitions have fixed kinds.
  if (event.event_kind === "task_updated") return false;
  return true;
}

function projectOne(event, context) {
  const {
    entityMap,
    entityRefsById,
    themesById,
    workspaceDefault,
    audience,
    workspace,
    roots,
    profile,
  } = context;
  const currentEntity = entityMap.get(key(event.entity_ref.type, event.entity_ref.id));
  const historical = profile === "recall" ? event.recall_history : null;
  const themeId =
    event.theme_ref?.kind === "theme"
      ? event.theme_ref.id
      : text(currentEntity?.project_id || currentEntity?.theme_id);
  const currentThemeFor = (entity) =>
    themesById.get(text(entity?.project_id || entity?.theme_id)) || null;
  const allowedReference = (ref) => {
    // Published M365 files cannot rely on the local reader resolving visibility.
    if (!audience || (audience !== "m365" && profile !== "recall")) return true;
    // Canonical kind describes a location, not an Entity type. Resolve an
    // attached ID only when it names exactly one current Entity.
    const typed = ref?.entity_id
      ? entityRefsById.get(text(ref.entity_id))
      : ref?.type && ref?.id
        ? ref
        : null;
    if (!typed) return !ref?.entity_id;
    const target = entityMap.get(key(typed.type, typed.id));
    if (target?.deleted_at) return false;
    if (target && typed.type === "work_receipt") {
      const task = entityMap.get(key("task", target.task_id));
      if (!task || !allowedReference({ type: "task", id: task.id })) return false;
      if (!Array.isArray(target.ai_visibility)) return true;
    }
    return Boolean(
      target &&
      projectEntityForAi(typed.type, target, {
        audience,
        theme: currentThemeFor(target),
        workspaceDefault,
      }).included,
    );
  };
  if (profile === "recall" && (!currentEntity || currentEntity.deleted_at))
    return {
      excluded: {
        type: event.entity_ref.type,
        reason: currentEntity ? "entity_deleted" : "entity_missing",
        count: 1,
      },
    };
  if (audience) {
    // #294 policy is evaluated at projection time. Event history does not
    // freeze a past visibility decision.
    if (!currentEntity)
      return { excluded: { type: event.entity_ref.type, reason: "entity_missing", count: 1 } };
    const policy = projectEntityForAi(
      event.entity_ref.type,
      currentEntity || { id: event.entity_ref.id, title: event.summary },
      {
        audience,
        theme: currentThemeFor(currentEntity),
        workspaceDefault,
      },
    );
    if (!policy.included) return { excluded: policy.exclusion };
    if (historical) {
      for (const [id, reason] of [
        [historical.theme_ref.id, "historical_theme_not_visible"],
        [historical.history.current_theme_ref.id, "current_theme_not_visible"],
      ]) {
        if (!id) continue;
        const theme = themesById.get(id);
        if (
          !theme ||
          theme.deleted_at ||
          !projectEntityForAi("theme", theme, {
            audience,
            theme,
            workspaceDefault,
          }).included
        )
          return { excluded: { type: "theme", reason, count: 1 } };
      }
    }
  }
  const eventId = publicIdentifier(event.id);
  const entityRef = publicTypedRef(event.entity_ref);
  const eventKind = publicIdentifier(event.event_kind);
  if (!eventId || !entityRef || !eventKind) {
    return { excluded: { type: "activity", reason: "unsafe_public_ref", count: 1 } };
  }
  const title = historical?.entity_title || entityTitle(currentEntity, event.entity_ref);
  if (
    profile === "recall" &&
    audience &&
    event.entity_ref.type === "schedule" &&
    (!currentEntity?.owner_type ||
      !currentEntity?.owner_id ||
      !allowedReference({ type: currentEntity.owner_type, id: currentEntity.owner_id }))
  )
    return { excluded: { type: "schedule", reason: "owner_not_visible", count: 1 } };
  const themeIdForPublic = publicIdentifier(historical ? historical.theme_ref.id : themeId);
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
    canonical_refs: publicCanonicalRefs(
      (event.canonical_refs || []).filter(allowedReference),
      roots,
    ),
    source_refs: publicSourceRefs(event.source_refs).filter(allowedReference),
    relation_refs: relationRefsFor(
      event,
      profile === "recall" && audience
        ? {
            ...workspace,
            references: collection(workspace, "references").filter((reference) =>
              allowedReference({ type: "reference", id: reference.id }),
            ),
          }
        : workspace,
    ).filter(allowedReference),
    work_receipt_ref: allowedReference(event.work_receipt_ref)
      ? publicTypedRef(event.work_receipt_ref)
      : null,
    metadata: publicMetadata(event.metadata),
  };
  if (currentEntity?.deleted_at) projected.metadata.entity_status = "deleted";
  if (!currentEntity) projected.metadata.entity_status = "missing";
  if (profile === "recall") {
    projected.recall = recallEvidence(event, currentEntity);
    if (historical)
      projected.recall.history = {
        ...historical.history,
        theme_title: historical.history.theme_title
          ? publicText(historical.history.theme_title)
          : null,
        current_entity_title: historical.history.current_entity_title
          ? publicText(historical.history.current_entity_title)
          : null,
        current_theme_ref:
          historical.history.current_theme_ref.id &&
          publicIdentifier(historical.history.current_theme_ref.id)
            ? { kind: "theme", id: publicIdentifier(historical.history.current_theme_ref.id) }
            : { kind: "none", id: null },
        current_theme_title: historical.history.current_theme_title
          ? publicText(historical.history.current_theme_title)
          : null,
      };
    // Recall is an index, not a raw-body export. Bound long Capture input here.
    if (isCaptureInput(event))
      projected.summary = publicText(currentEntity?.text || event.summary).slice(0, 2_000);
  }
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
  entity_id = "",
  eventKinds = [],
  event_kinds = [],
  timezone = DEFAULT_TIMEZONE,
  audience = null,
  workspaceDefault = undefined,
  roots = {},
  limit = MAX_EVENTS,
  sort_direction = "asc",
  include_match_metadata = false,
  profile = "default",
  cursor = null,
} = {}) {
  const sourceWorkspace = {
    ...workspace,
    references: references.length ? references : workspace.references,
  };
  const entityMap = allEntities(sourceWorkspace, entities);
  if (profile === "recall") {
    for (const capture of collection(sourceWorkspace, "capture_entries"))
      if (capture?.id) entityMap.set(key("capture_entry", capture.id), capture);
  }
  const entityRefsById = new Map();
  if (audience && (audience === "m365" || profile === "recall")) {
    for (const [entityKey, entity] of entityMap) {
      const id = text(entity.id);
      entityRefsById.set(
        id,
        entityRefsById.has(id) ? null : { type: entityKey.slice(0, entityKey.indexOf(":")), id },
      );
    }
  }
  const themesById = themeMap(themes, sourceWorkspace);
  const resolveHistory =
    profile === "recall"
      ? createActivityHistoryResolver(sourceWorkspace.change_events || events)
      : null;
  const effectiveTimezone = normalizeTimezone(timezone);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error("Activity date requires a calendar date");
  // Validate even an empty snapshot; a malformed period is never an empty success.
  for (const boundary of [date, from, to]) activityBoundaryMatches("", boundary, "from", "");
  const period = {
    date: date || null,
    from: from || null,
    to: to || null,
    timezone: effectiveTimezone,
    boundaries: "inclusive",
  };
  const kinds = new Set(
    [...(eventKinds.length ? eventKinds : event_kinds)].map(text).filter(Boolean),
  );
  const normalizedEvents = events
    .map((event) => {
      const entity =
        entityMap.get(
          key(
            event?.entity_ref?.type || event?.entity_type,
            event?.entity_ref?.id || event?.entity_id,
          ),
        ) || null;
      return {
        ...migrateChangeEvent(event, { entity }),
        ...(resolveHistory ? { recall_history: resolveHistory(event, entity, themesById) } : {}),
      };
    })
    .map((event) => {
      if (profile !== "recall" || !isCaptureInput(event)) return event;
      const capture = entityMap.get(key("capture_entry", event.entity_ref.id));
      return {
        ...event,
        ...(Number.isFinite(Date.parse(capture?.captured_at))
          ? { occurred_at: new Date(capture.captured_at).toISOString() }
          : {}),
        metadata: { ...event.metadata, dedupe_key: `capture-input:${event.entity_ref.id}` },
      };
    });
  const recallInputs =
    profile === "recall"
      ? recallCaptureInputs(
          normalizedEvents,
          [...entityMap.entries()]
            .filter(([id]) => id.startsWith("capture_entry:"))
            .map(([, record]) => record),
        )
      : [];
  const scopedEvents = deduplicate(
    [...normalizedEvents, ...recallInputs]
      .map((event) =>
        resolveHistory && !event.recall_history
          ? {
              ...event,
              recall_history: resolveHistory(
                event,
                entityMap.get(key(event.entity_ref.type, event.entity_ref.id)),
                themesById,
              ),
            }
          : event,
      )
      .filter((event) => {
        // An explicit kind selection replaces profile defaults, never policy.
        if (kinds.size) return kinds.has(event.event_kind);
        if (profile !== "recall") return eventAllowedByDefault(event);
        if (isCaptureInput(event))
          return entityMap.get(key("capture_entry", event.entity_ref.id))?.state === "untriaged";
        if (["task_updated", "plan_node_updated", "schedule_updated"].includes(event.event_kind))
          return isRecallPlanChange(event);
        return event.event_kind === "task_created" || eventAllowedByDefault(event);
      })
      .filter((event) => {
        const eventDate = localDate(event.occurred_at, effectiveTimezone);
        if (date && eventDate !== date) return false;
        if (!activityBoundaryMatches(event.occurred_at, from, "from", eventDate)) return false;
        if (!activityBoundaryMatches(event.occurred_at, to, "to", eventDate)) return false;
        if (themeId || theme_id) {
          const selected = themeId || theme_id;
          if (
            (profile === "recall" ? event.recall_history?.theme_ref.id : event.theme_ref?.id) !==
            selected
          )
            return false;
        }
        if (entityType || entity_type) {
          const selected = entityType || entity_type;
          if (event.entity_ref?.type !== selected) return false;
        }
        if (entity_id && event.entity_ref?.id !== entity_id) return false;
        if (kinds.size && !kinds.has(event.event_kind)) return false;
        return true;
      }),
  );
  const projected = [];
  const exclusions = [];
  const direction = sort_direction === "desc" ? -1 : 1;
  for (const event of scopedEvents.sort(
    (a, b) =>
      direction *
      (Date.parse(a.occurred_at) - Date.parse(b.occurred_at) ||
        String(a.id).localeCompare(String(b.id))),
  )) {
    const result = projectOne(event, {
      entityMap,
      entityRefsById,
      themesById,
      workspaceDefault,
      audience,
      workspace: sourceWorkspace,
      roots,
      profile,
    });
    if (result.excluded) exclusions.push(result.excluded);
    else if (result.event)
      projected.push({
        ...result.event,
        local_date: localDate(event.occurred_at, effectiveTimezone),
        local_time: localTime(event.occurred_at, effectiveTimezone),
      });
  }
  const max = Math.max(1, Math.min(MAX_EVENTS, Math.floor(Number(limit) || MAX_EVENTS)));
  const excludedReasons = summarizeAiExclusions(exclusions).excluded_reasons;
  const page = paginateActivity(projected, {
    criteria: {
      period,
      theme: themeId || theme_id,
      entity: entityType || entity_type,
      entity_id,
      kinds: [...kinds].sort(),
      profile,
      audience,
      direction,
      limit: max,
    },
    exclusions: excludedReasons,
    limit: max,
    cursor,
    period,
  });
  return {
    schema_version: ACTIVITY_EVENT_SCHEMA_VERSION,
    timezone: effectiveTimezone,
    date: date || null,
    ...page,
    excluded_count: exclusions.length,
    excluded_reasons: excludedReasons,
    ...(include_match_metadata ? { matched_count: page.page.matched_visible_count } : {}),
  };
}

function entityLink(ref) {
  return `tasken://${encodeURIComponent(ref.type)}/${encodeURIComponent(ref.id)}`;
}

function canonicalLink(ref) {
  if (ref.web_url) return `[${ref.relative_path || "Canonical"}](${ref.web_url})`;
  if (ref.storage_root_id && ref.relative_path)
    return `\`${ref.storage_root_id}:${ref.relative_path}\``;
  return "(broken canonical ref)";
}

export function projectActivityMarkdown(result, { title = "Activity", date = result?.date } = {}) {
  const events = result?.events || [];
  const lines = [
    `# ${title}${date ? ` ${date}` : ""}`,
    "",
    `> timezone: ${result?.timezone || DEFAULT_TIMEZONE}`,
    `> truncated: ${Boolean(result?.truncated)}`,
    ...(result?.page
      ? [
          `> period: date=${result.page.period.date || "any"}; from=${result.page.period.from || "unbounded"}; to=${result.page.period.to || "unbounded"}; boundaries=${result.page.period.boundaries}`,
          `> status: ${result.page.status}; offset: ${result.page.offset ?? "unknown"}; returned: ${result.page.returned_count}; limit: ${result.page.limit}; matched_visible: ${result.page.matched_visible_count ?? "unknown"}`,
          `> next_cursor: ${result.page.next_cursor || "none"}`,
          `> revision: ${result.page.revision}; generated_at: ${result.page.generated_at}`,
        ]
      : []),
    "",
    "## Events",
  ];
  if (!events.length) lines.push("- なし");
  for (const event of events) {
    lines.push(
      "",
      `### ${event.local_time || "--:--"} · ${event.event_kind}`,
      `- Entity: ${event.entity_title} \`${event.entity_ref.type}:${event.entity_ref.id}\` ([open](${entityLink(event.entity_ref)}))`,
      `- Theme: ${event.theme_ref?.kind === "theme" ? event.theme_ref.id : "none"}`,
      `- Changed: ${event.changed_fields.length ? event.changed_fields.join(", ") : "—"}`,
      `- Canonical: ${event.canonical_refs.length ? event.canonical_refs.map(canonicalLink).join(", ") : "—"}`,
      `- Source: ${event.source_refs.length ? event.source_refs.map((ref) => (ref.type && ref.id ? `${ref.type}:${ref.id}` : ref.locator || "ref")).join(", ") : "—"}`,
      `- Relations: ${event.relation_refs.length ? event.relation_refs.map((ref) => `${ref.relation || "related_to"} ${ref.type}:${ref.id}`).join(", ") : "—"}`,
      `- Summary: ${event.summary}`,
      ...(event.recall
        ? [
            `- Recall: ${event.recall.stage}; authority: ${event.recall.authority || "unknown"} (${event.recall.authority_origin})`,
          ]
        : []),
      ...(event.recall?.history
        ? [
            `- Historical labels: entity ${event.recall.history.entity_title_source}; theme ${event.recall.history.theme_title || "unknown"} (${event.recall.history.theme_title_source}); affiliation ${event.recall.history.theme_ref_source}`,
            `- Current: ${event.recall.history.current_entity_title || "unknown"}; theme ${event.recall.history.current_theme_title || "none"}`,
          ]
        : []),
    );
  }
  if (result?.excluded_count)
    lines.push(
      "",
      `## Excluded by policy`,
      `- ${result.excluded_count} event(s)`,
      ...(result.excluded_reasons || []).map(
        (entry) => `- ${entry.type}: ${entry.reason} (${entry.count})`,
      ),
    );
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
