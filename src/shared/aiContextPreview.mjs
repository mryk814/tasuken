export const AI_CONTEXT_PREVIEW_SCHEMA = "tasken-ai-context-preview/v1";

const MAX_INCLUDED = 500;
const MAX_RELATIONS = 500;
const MAX_EXCLUDED = 500;
const MAX_WARNINGS = 200;
const MAX_TEXT = 4_000;
const MAX_TITLE = 1_000;

const BODY_MODES = new Set([
  "full",
  "excerpt",
  "summary",
  "metadata_only",
  "reference_only",
  "unknown",
]);
const CAPABILITY_LEVELS = new Set(["full", "partial", "aggregate_only", "unavailable"]);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function string(value, maximum = MAX_TEXT) {
  if (value == null) return null;
  const result = String(value);
  return result.length <= maximum ? result : result.slice(0, maximum);
}

function nonEmpty(value, maximum = MAX_TEXT) {
  const result = string(value, maximum)?.trim() || "";
  return result || null;
}

function number(value) {
  if (value == null || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

function ref(value, fallbackType = null) {
  const source = object(value);
  const type = nonEmpty(source.type || source.kind || fallbackType, 200);
  const id = nonEmpty(source.id, 500);
  return type && id ? { type, id } : null;
}

function compareRef(left, right) {
  return `${left?.type || ""}\u0000${left?.id || ""}`.localeCompare(
    `${right?.type || ""}\u0000${right?.id || ""}`,
  );
}

function uniqueStrings(value, maximum = 200) {
  return [
    ...new Set(
      array(value)
        .slice(0, maximum)
        .map((entry) => nonEmpty(entry, 2_000))
        .filter(Boolean),
    ),
  ].sort();
}

function normalizeSourceRefs(value) {
  return array(value)
    .slice(0, 200)
    .map((entry) => {
      if (typeof entry === "string") return { locator: string(entry, 2_000) };
      const source = object(entry);
      const result = {
        kind: nonEmpty(source.kind, 100),
        locator: nonEmpty(source.locator || source.ref, 2_000),
        title: nonEmpty(source.title, 500),
        storageRootId: nonEmpty(source.storage_root_id || source.storageRootId, 500),
        relativePath: nonEmpty(source.relative_path || source.relativePath, 2_000),
        capturedAt: nonEmpty(source.captured_at || source.capturedAt, 100),
        lastCheckedAt: nonEmpty(source.last_checked_at || source.lastCheckedAt, 100),
      };
      return Object.fromEntries(Object.entries(result).filter(([, item]) => item != null));
    })
    .filter((entry) => Object.keys(entry).length)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function normalizeLocator(value) {
  const source = object(value);
  const tool = nonEmpty(source.tool, 300);
  const url = nonEmpty(source.url, 2_000);
  const storageRootId = nonEmpty(source.storage_root_id || source.storageRootId, 500);
  const relativePath = nonEmpty(source.relative_path || source.relativePath, 2_000);
  const rawArguments = object(source.arguments);
  const argumentsValue = {};
  for (const key of Object.keys(rawArguments).sort().slice(0, 20)) {
    const value = rawArguments[key];
    if (["string", "number", "boolean"].includes(typeof value))
      argumentsValue[key] = typeof value === "string" ? string(value, 1_000) : value;
  }
  if (!tool && !url && !storageRootId && !relativePath) return null;
  return {
    ...(tool ? { tool } : {}),
    ...(Object.keys(argumentsValue).length ? { arguments: argumentsValue } : {}),
    ...(url ? { url } : {}),
    ...(storageRootId ? { storageRootId } : {}),
    ...(relativePath ? { relativePath } : {}),
  };
}

function contentFrom(record) {
  const candidates = [
    ["body_markdown", "full"],
    ["body", "full"],
    ["excerpt", "excerpt"],
    ["body_excerpt", "excerpt"],
    ["summary", "summary"],
    ["ai_summary", "summary"],
    ["description", "summary"],
  ];
  for (const [field, mode] of candidates) {
    if (typeof record[field] !== "string") continue;
    const value = record[field];
    return {
      mode,
      text: value.slice(0, MAX_TEXT),
      truncated: value.length > MAX_TEXT,
      sourceField: field,
    };
  }
  return null;
}

function bodyMode(record, content) {
  if (content) return content.mode;
  const explicit = nonEmpty(record.body_mode || record.bodyMode, 100);
  if (explicit && BODY_MODES.has(explicit)) return explicit;
  if (record.publication || record.reference_only) return "reference_only";
  return "metadata_only";
}

function aiFields(record) {
  const header = object(record.ai);
  return {
    freshness: nonEmpty(header.freshness ?? record.ai_freshness, 100),
    authority: nonEmpty(header.authority ?? record.ai_authority, 100),
    sourceRefs: normalizeSourceRefs(
      header.source_refs ?? record.ai_source_refs ?? record.source_refs,
    ),
  };
}

function normalizePath(value) {
  return array(value)
    .slice(0, 100)
    .map((entry) => {
      if (typeof entry === "string") return { edgeId: string(entry, 1_000) };
      const source = object(entry);
      const result = {
        edgeId: nonEmpty(source.edge_id || source.edgeId || source.id, 1_000),
        source: ref(source.source || source.from),
        target: ref(source.target || source.to),
        predicate: nonEmpty(source.predicate, 300),
        layer: nonEmpty(source.layer, 100),
        status: nonEmpty(source.status, 100),
        origin: nonEmpty(source.origin, 300),
      };
      return Object.fromEntries(Object.entries(result).filter(([, item]) => item != null));
    })
    .filter((entry) => Object.keys(entry).length);
}

function normalizeEvidenceRefs(value) {
  const entries = array(value)
    .slice(0, 200)
    .map((entry) => {
      if (typeof entry === "string") {
        const legacy = nonEmpty(entry, 2_000);
        return legacy ? { key: `legacy:${legacy}`, value: legacy } : null;
      }
      const typed = ref(entry);
      return typed
        ? { key: `typed:${JSON.stringify([typed.type, typed.id])}`, value: typed }
        : null;
    })
    .filter(Boolean);
  return [...new Map(entries.map((entry) => [entry.key, entry])).values()]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((entry) => entry.value);
}

function includedEntity(recordValue, type, options = {}) {
  const record = object(recordValue);
  const entityRef = ref(record, type);
  if (!entityRef) return null;
  const ai = aiFields(record);
  const relation = object(options.relation);
  const content = contentFrom(record);
  return {
    ref: entityRef,
    title: nonEmpty(record.title || record.name || record.label || record.entity_title, MAX_TITLE),
    bodyMode: bodyMode(record, content),
    content,
    freshness: ai.freshness,
    authority: ai.authority,
    includedReason: nonEmpty(options.includedReason ?? record.included_because, 1_000),
    relationPath: normalizePath(options.relationPath ?? record.relation_path),
    sourceRefs: ai.sourceRefs,
    sourceLocator: normalizeLocator(options.sourceLocator ?? record.locator),
    sourceOrder: number(options.sourceOrder) ?? 0,
  };
}

function relationEntry(value) {
  const source = object(value);
  const sourceRef = ref(source.source || source.from);
  const targetRef = ref(source.target || source.to);
  if (!sourceRef || !targetRef) return null;
  return {
    id: nonEmpty(source.id, 1_000),
    source: sourceRef,
    target: targetRef,
    predicate: nonEmpty(source.predicate || source.relation_type || source.relation, 300),
    layer: nonEmpty(source.layer, 100),
    status: nonEmpty(source.status, 100),
    origin: nonEmpty(source.origin, 300),
    evidenceRefs: normalizeEvidenceRefs(source.evidence_refs || source.evidenceRefs),
    reason: nonEmpty(source.reason, 1_000),
    path: normalizePath(source.path),
  };
}

function normalizeExcluded(value) {
  if (typeof value === "string") {
    return {
      kind: "aggregate",
      ref: null,
      edge: null,
      entityType: null,
      reason: string(value, 1_000),
      count: 1,
    };
  }
  const source = object(value);
  const entityRef = ref(source.ref || source.entity || source);
  const sourceRef = ref(source.source);
  const targetRef = ref(source.target);
  const edge =
    sourceRef && targetRef
      ? {
          id: nonEmpty(source.edge_id || source.edgeId, 1_000),
          source: sourceRef,
          target: targetRef,
          predicate: nonEmpty(source.predicate, 300),
        }
      : null;
  const count = number(source.count) ?? 1;
  const kind = edge ? "edge" : entityRef ? "entity" : "aggregate";
  const reason = nonEmpty(source.reason || source.code, 1_000);
  if (!reason && !entityRef && !edge) return null;
  return {
    kind,
    ref: entityRef,
    edge,
    entityType: nonEmpty(
      source.entity_type || source.entityType || (kind === "aggregate" ? source.type : null),
      200,
    ),
    reason,
    count,
  };
}

function normalizeWarnings(value) {
  return array(value)
    .slice(0, MAX_WARNINGS)
    .map((entry) => {
      if (typeof entry === "string")
        return { code: null, kind: null, ref: null, message: string(entry, 1_000), reason: null };
      const source = object(entry);
      return {
        code: nonEmpty(source.code, 200),
        kind: nonEmpty(source.kind, 200),
        ref: ref(source.ref || source),
        message: nonEmpty(source.message, 1_000),
        reason: nonEmpty(source.reason, 1_000),
      };
    })
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function safeDetails(value, depth = 0) {
  if (depth > 4) return null;
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return string(value, MAX_TEXT);
  if (Array.isArray(value))
    return value.slice(0, 200).map((entry) => safeDetails(entry, depth + 1));
  if (typeof value !== "object") return null;
  const result = {};
  for (const key of Object.keys(value).sort().slice(0, 100)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) continue;
    result[key] = safeDetails(value[key], depth + 1);
  }
  return result;
}

function serializedLength(value) {
  try {
    return JSON.stringify(value).length;
  } catch {
    return null;
  }
}

function capability(value, fallback = "unavailable") {
  return CAPABILITY_LEVELS.has(value) ? value : fallback;
}

function makePreview({
  scopeKind,
  seed,
  capabilities,
  included = [],
  relations = [],
  excluded = [],
  files = [],
  warnings = [],
  limits = {},
  truncation = {},
  estimatedCharacters = null,
  estimatedTokens = null,
  includedCount = null,
  excludedCount = null,
  untypedIncludedIds = [],
}) {
  const sourceIncludedCount = included.length;
  const sourceRelationCount = relations.length;
  const sourceExcludedCount = excluded.length;
  const adapterReasons = [];
  if (sourceIncludedCount > MAX_INCLUDED) adapterReasons.push("adapter_max_included");
  if (sourceRelationCount > MAX_RELATIONS) adapterReasons.push("adapter_max_relations");
  if (sourceExcludedCount > MAX_EXCLUDED) adapterReasons.push("adapter_max_excluded");
  const normalizedIncluded = included
    .filter(Boolean)
    .sort((left, right) => compareRef(left.ref, right.ref))
    .slice(0, MAX_INCLUDED)
    .map((entry, sourceOrder) => ({ ...entry, sourceOrder }));
  const normalizedRelations = relations
    .filter(Boolean)
    .sort((left, right) =>
      `${left.id || ""}\u0000${left.source.type}:${left.source.id}\u0000${left.predicate || ""}\u0000${left.target.type}:${left.target.id}`.localeCompare(
        `${right.id || ""}\u0000${right.source.type}:${right.source.id}\u0000${right.predicate || ""}\u0000${right.target.type}:${right.target.id}`,
      ),
    )
    .slice(0, MAX_RELATIONS);
  const normalizedExcluded = excluded
    .filter(Boolean)
    .sort((left, right) =>
      `${left.kind}\u0000${left.ref?.type || left.entityType || ""}\u0000${left.ref?.id || ""}\u0000${left.reason || ""}`.localeCompare(
        `${right.kind}\u0000${right.ref?.type || right.entityType || ""}\u0000${right.ref?.id || ""}\u0000${right.reason || ""}`,
      ),
    )
    .slice(0, MAX_EXCLUDED);
  if (normalizedIncluded.some((entry) => entry.content?.truncated))
    adapterReasons.push("adapter_max_content_text");
  if (files.some((file) => file.content?.truncated))
    adapterReasons.push("adapter_max_file_content");
  const producerTruncated = Boolean(truncation.truncated);
  const producerReasons = uniqueStrings(truncation.reasons, 200);
  return {
    schema: AI_CONTEXT_PREVIEW_SCHEMA,
    readOnly: true,
    scope: { kind: scopeKind, seed: ref(seed) },
    capabilities: {
      entityDetails: capability(capabilities?.entityDetails),
      exclusionDetails: capability(capabilities?.exclusionDetails),
      relationDetails: capability(capabilities?.relationDetails),
      aiMetadata: capability(capabilities?.aiMetadata),
      sourceLocators: capability(capabilities?.sourceLocators),
    },
    included: normalizedIncluded,
    relations: normalizedRelations,
    excluded: normalizedExcluded,
    files,
    warnings,
    limits: safeDetails(limits),
    truncation: {
      truncated: producerTruncated || adapterReasons.length > 0,
      reasons: [...new Set([...producerReasons, ...adapterReasons])].sort(),
      details: safeDetails(truncation.details || {}),
    },
    estimates: {
      characters: number(estimatedCharacters),
      tokens: number(estimatedTokens),
    },
    counts: {
      included: number(includedCount) ?? sourceIncludedCount,
      representedIncluded: normalizedIncluded.length,
      relations: sourceRelationCount,
      representedRelations: normalizedRelations.length,
      excluded: number(excludedCount) ?? sourceExcludedCount,
      representedExcluded: normalizedExcluded.length,
    },
    untypedIncludedIds: uniqueStrings(untypedIncludedIds, MAX_INCLUDED),
  };
}

function aggregateExclusions(input) {
  return array(input).map(normalizeExcluded).filter(Boolean);
}

function producerSelection(response) {
  const selection = object(object(response).context_selection);
  return selection.schema === "tasken-context-selection/v1" ? selection : null;
}

function selectionIncluded(response, fallback) {
  const selection = producerSelection(response);
  if (!selection) return fallback;
  const fallbackByRef = new Map(
    fallback.map((entry) => [`${entry.ref.type}\u0000${entry.ref.id}`, entry]),
  );
  return array(selection.included)
    .map((entryValue, sourceOrder) => {
      const entry = object(entryValue);
      const entityRef = ref(entry.ref);
      if (!entityRef) return null;
      const existing = fallbackByRef.get(`${entityRef.type}\u0000${entityRef.id}`);
      const record = {
        type: entityRef.type,
        id: entityRef.id,
        title: entry.title ?? existing?.title,
        ai: entry.ai,
      };
      const projected = includedEntity(record, entityRef.type, {
        includedReason: entry.reason,
        relationPath: entry.relation_path,
        sourceLocator: entry.locator,
        sourceOrder,
      });
      return projected && existing
        ? {
            ...projected,
            title: projected.title ?? existing.title,
            bodyMode: existing.bodyMode,
            content: existing.content,
            freshness: projected.freshness ?? existing.freshness,
            authority: projected.authority ?? existing.authority,
            sourceRefs: projected.sourceRefs.length ? projected.sourceRefs : existing.sourceRefs,
            sourceLocator: projected.sourceLocator ?? existing.sourceLocator,
          }
        : projected;
    })
    .filter(Boolean);
}

function responseExclusions(response) {
  const selection = producerSelection(response);
  if (selection) return aggregateExclusions(selection.excluded);
  return aggregateExclusions([...array(response.exclusions), ...array(response.excluded_reasons)]);
}

export function previewTaskCoding(taskContextResponse) {
  const response = object(taskContextResponse);
  const fallbackIncluded = [];
  let sourceOrder = 0;
  const add = (record, type, includedReason = null) => {
    const entity = includedEntity(record, type, { includedReason, sourceOrder: sourceOrder++ });
    if (entity) fallbackIncluded.push(entity);
  };
  add(response.task, "task", "seed");
  add(response.theme, "theme", "task_theme");
  for (const record of array(response.repository_contexts))
    add(record, "repository_context", "task_repository_context");
  const related = object(response.related);
  for (const record of array(related.notes)) add(record, "note");
  for (const record of array(related.conversations)) add(record, "resource");
  for (const record of array(related.resources)) add(record, "resource");
  for (const record of array(related.artifacts)) add(record, "artifact");
  for (const record of array(related.activity))
    add(record, "change_event", record.included_because || "recent_activity");
  for (const record of array(related.work_receipts))
    add(record, "work_receipt", "task_work_receipt");
  const included = selectionIncluded(response, fallbackIncluded);
  const selection = producerSelection(response);
  const relations = array(selection?.relations).map(relationEntry).filter(Boolean);
  const excluded = responseExclusions(response);
  const warnings = normalizeWarnings(response.warnings);
  const truncationDetails = object(response.truncation);
  const truncationReasons = [
    ...Object.values(truncationDetails)
      .map((entry) => nonEmpty(object(entry).reason, 500))
      .filter(Boolean),
    ...warnings.map((warning) => warning.code).filter((code) => code?.includes("truncat")),
  ];
  return makePreview({
    scopeKind: "task",
    seed: response.task ? { type: "task", id: object(response.task).id } : null,
    capabilities: {
      entityDetails: "full",
      exclusionDetails: excluded.length ? (selection ? "full" : "aggregate_only") : "unavailable",
      relationDetails: relations.length
        ? "full"
        : included.some((entry) => entry.relationPath.length)
          ? "partial"
          : "unavailable",
      aiMetadata: included.some((entry) => entry.freshness || entry.authority)
        ? selection
          ? "full"
          : "partial"
        : "unavailable",
      sourceLocators: included.some((entry) => entry.sourceLocator) ? "partial" : "unavailable",
    },
    included,
    relations,
    excluded,
    warnings,
    limits: selection?.limits || response.limits,
    truncation: {
      truncated: Boolean(selection?.truncated ?? response.truncated),
      reasons: [...truncationReasons, ...array(object(selection?.truncation).reasons)],
      details: selection?.truncation || truncationDetails,
    },
    estimatedCharacters:
      selection?.estimated_characters ??
      response.estimated_characters ??
      serializedLength(response),
    estimatedTokens: selection?.estimated_tokens ?? response.estimated_tokens,
    excludedCount: response.excluded_count,
  });
}
