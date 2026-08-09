export const AI_CONTEXT_PREVIEW_SCHEMA = "tasken-ai-context-preview/v1";

const MAX_INCLUDED = 500;
const MAX_RELATIONS = 500;
const MAX_EXCLUDED = 500;
const MAX_WARNINGS = 200;
const MAX_FILES = 50;
const MAX_TEXT = 4_000;
const MAX_TITLE = 1_000;

const BODY_MODES = new Set(["full", "excerpt", "summary", "metadata_only", "reference_only", "unknown"]);
const AI_AUDIENCES = new Set(["m365", "coding_agent", "external_ai"]);
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

function boolean(value) {
  return typeof value === "boolean" ? value : null;
}

function audience(value) {
  const result = nonEmpty(value, 64);
  return result && AI_AUDIENCES.has(result) ? result : null;
}

function ref(value, fallbackType = null) {
  const source = object(value);
  const type = nonEmpty(source.type || source.kind || fallbackType, 200);
  const id = nonEmpty(source.id, 500);
  return type && id ? { type, id } : null;
}

function compareRef(left, right) {
  return `${left?.type || ""}\u0000${left?.id || ""}`.localeCompare(`${right?.type || ""}\u0000${right?.id || ""}`);
}

function uniqueStrings(value, maximum = 200) {
  return [...new Set(array(value).slice(0, maximum).map((entry) => nonEmpty(entry, 2_000)).filter(Boolean))].sort();
}

function normalizeVisibility(value) {
  if (Array.isArray(value)) return uniqueStrings(value, 10).filter((entry) => AI_AUDIENCES.has(entry));
  const candidate = nonEmpty(value, 200);
  if (!candidate) return [];
  return [...new Set(candidate.split(",").map((entry) => entry.trim()).filter((entry) => AI_AUDIENCES.has(entry)))].sort();
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
    if (["string", "number", "boolean"].includes(typeof value)) argumentsValue[key] = typeof value === "string" ? string(value, 1_000) : value;
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
    visibility: normalizeVisibility(header.ai_visibility ?? header.visibility ?? record.ai_visibility),
    freshness: nonEmpty(header.freshness ?? record.ai_freshness, 100),
    authority: nonEmpty(header.authority ?? record.ai_authority, 100),
    sourceRefs: normalizeSourceRefs(header.source_refs ?? record.ai_source_refs ?? record.source_refs),
  };
}

function normalizePath(value) {
  return array(value).slice(0, 100).map((entry) => {
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
  }).filter((entry) => Object.keys(entry).length);
}

function normalizeEvidenceRefs(value) {
  const entries = array(value).slice(0, 200).map((entry) => {
    if (typeof entry === "string") {
      const legacy = nonEmpty(entry, 2_000);
      return legacy ? { key: `legacy:${legacy}`, value: legacy } : null;
    }
    const typed = ref(entry);
    return typed ? { key: `typed:${JSON.stringify([typed.type, typed.id])}`, value: typed } : null;
  }).filter(Boolean);
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
    visibility: ai.visibility,
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
    return { kind: "aggregate", ref: null, edge: null, entityType: null, reason: string(value, 1_000), count: 1 };
  }
  const source = object(value);
  const entityRef = ref(source.ref || source.entity || source);
  const sourceRef = ref(source.source);
  const targetRef = ref(source.target);
  const edge = sourceRef && targetRef ? {
    id: nonEmpty(source.edge_id || source.edgeId, 1_000),
    source: sourceRef,
    target: targetRef,
    predicate: nonEmpty(source.predicate, 300),
  } : null;
  const count = number(source.count) ?? 1;
  const kind = edge ? "edge" : entityRef ? "entity" : "aggregate";
  const reason = nonEmpty(source.reason || source.code, 1_000);
  if (!reason && !entityRef && !edge) return null;
  return {
    kind,
    ref: entityRef,
    edge,
    entityType: nonEmpty(source.entity_type || source.entityType || (kind === "aggregate" ? source.type : null), 200),
    reason,
    count,
  };
}

function normalizeWarnings(value) {
  return array(value).slice(0, MAX_WARNINGS).map((entry) => {
    if (typeof entry === "string") return { code: null, kind: null, ref: null, message: string(entry, 1_000), reason: null };
    const source = object(entry);
    return {
      code: nonEmpty(source.code, 200),
      kind: nonEmpty(source.kind, 200),
      ref: ref(source.ref || source),
      message: nonEmpty(source.message, 1_000),
      reason: nonEmpty(source.reason, 1_000),
    };
  }).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function normalizeFiles(plan) {
  const previewByName = new Map(array(object(plan.preview).files).map((entry) => [String(object(entry).name), object(entry)]));
  const manifestByName = new Map(array(object(plan.manifest).files).map((entry) => [String(object(entry).name), object(entry)]));
  const names = new Set([
    ...array(plan.files).map((entry) => nonEmpty(object(entry).name, 1_000)),
    ...previewByName.keys(),
    ...manifestByName.keys(),
  ].filter(Boolean));
  return [...names].sort().slice(0, MAX_FILES).map((name) => {
    const file = object(array(plan.files).find((entry) => object(entry).name === name));
    const preview = object(previewByName.get(name));
    const manifest = object(manifestByName.get(name));
    return {
      name,
      includedCount: number(preview.includedCount) ?? array(file.includedEntityIds).length,
      characterCount: number(preview.characterCount) ?? (typeof file.content === "string" ? file.content.length : null),
      contentHash: nonEmpty(file.content_hash || manifest.contentHash, 500),
      content: typeof file.content === "string" ? {
        mode: "full",
        text: file.content.slice(0, MAX_TEXT),
        truncated: file.content.length > MAX_TEXT,
        sourceField: "content",
      } : null,
      untypedIncludedIds: uniqueStrings(file.includedEntityIds || manifest.includedEntityIds, MAX_INCLUDED),
    };
  });
}

function safeDetails(value, depth = 0) {
  if (depth > 4) return null;
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return string(value, MAX_TEXT);
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => safeDetails(entry, depth + 1));
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
  audience: audienceValue,
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
  const normalizedRelations = relations.filter(Boolean).sort((left, right) => `${left.id || ""}\u0000${left.source.type}:${left.source.id}\u0000${left.predicate || ""}\u0000${left.target.type}:${left.target.id}`.localeCompare(`${right.id || ""}\u0000${right.source.type}:${right.source.id}\u0000${right.predicate || ""}\u0000${right.target.type}:${right.target.id}`)).slice(0, MAX_RELATIONS);
  const normalizedExcluded = excluded.filter(Boolean).sort((left, right) => `${left.kind}\u0000${left.ref?.type || left.entityType || ""}\u0000${left.ref?.id || ""}\u0000${left.reason || ""}`.localeCompare(`${right.kind}\u0000${right.ref?.type || right.entityType || ""}\u0000${right.ref?.id || ""}\u0000${right.reason || ""}`)).slice(0, MAX_EXCLUDED);
  if (normalizedIncluded.some((entry) => entry.content?.truncated)) adapterReasons.push("adapter_max_content_text");
  if (files.some((file) => file.content?.truncated)) adapterReasons.push("adapter_max_file_content");
  const producerTruncated = Boolean(truncation.truncated);
  const producerReasons = uniqueStrings(truncation.reasons, 200);
  return {
    schema: AI_CONTEXT_PREVIEW_SCHEMA,
    audience: audience(audienceValue),
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

function responseExclusions(response) {
  return aggregateExclusions([
    ...array(response.exclusions),
    ...array(response.excluded_reasons),
  ]);
}

function graphPathForNode(response, nodeRef, edgeById) {
  const path = array(response.paths)
    .filter((candidate) => {
      const target = ref(object(candidate).to);
      return target?.type === nodeRef.type && target?.id === nodeRef.id;
    })
    .sort((left, right) => (number(object(left).hops) ?? Number.MAX_SAFE_INTEGER) - (number(object(right).hops) ?? Number.MAX_SAFE_INTEGER)
      || array(object(left).edge_ids).join("\u0000").localeCompare(array(object(right).edge_ids).join("\u0000")))[0];
  const edgeIds = array(object(path).edge_ids);
  return edgeIds.map((edgeId) => edgeById.get(String(edgeId))).filter(Boolean).map((edge) => ({
    edgeId: edge.id,
    source: edge.source,
    target: edge.target,
    predicate: edge.predicate,
    layer: edge.layer,
    status: edge.status,
    origin: edge.origin,
  }));
}

export function previewThemeM365(themeAiPackPlan) {
  const plan = object(themeAiPackPlan);
  const preview = object(plan.preview);
  const manifest = object(plan.manifest);
  const excluded = aggregateExclusions(plan.excluded_reasons || manifest.excludedReasons || preview.excludedReasons);
  const files = normalizeFiles(plan);
  return makePreview({
    audience: plan.audience || manifest.audience,
    scopeKind: "theme",
    seed: { type: "theme", id: plan.theme_id || manifest.themeId },
    capabilities: {
      entityDetails: "aggregate_only",
      exclusionDetails: excluded.length ? "aggregate_only" : "unavailable",
      relationDetails: "unavailable",
      aiMetadata: "unavailable",
      sourceLocators: "unavailable",
    },
    excluded,
    files,
    warnings: normalizeWarnings(preview.warnings),
    limits: {},
    truncation: {
      truncated: boolean(plan.truncated) === true,
      reasons: array(plan.truncation_reasons),
      details: object(plan.truncation),
    },
    estimatedCharacters: preview.totalCharacterCount,
    estimatedTokens: plan.estimated_tokens,
    includedCount: preview.includedCount ?? array(plan.included_entity_ids).length,
    excludedCount: preview.excludedCount ?? plan.excluded_count,
    untypedIncludedIds: plan.included_entity_ids || manifest.includedEntityIds,
  });
}

export function previewTaskCoding(taskContextResponse) {
  const response = object(taskContextResponse);
  const included = [];
  let sourceOrder = 0;
  const add = (record, type, includedReason = null) => {
    const entity = includedEntity(record, type, { includedReason, sourceOrder: sourceOrder++ });
    if (entity) included.push(entity);
  };
  add(response.task, "task", "seed");
  add(response.theme, "theme", "task_theme");
  for (const record of array(response.repository_contexts)) add(record, "repository_context", "task_repository_context");
  const related = object(response.related);
  for (const record of array(related.notes)) add(record, "note");
  for (const record of array(related.conversations)) add(record, "conversation");
  for (const record of array(related.resources)) add(record, "resource");
  for (const record of array(related.artifacts)) add(record, "artifact");
  for (const record of array(related.activity)) add(record, "change_event", record.included_because || "recent_activity");
  for (const record of array(related.work_receipts)) add(record, "work_receipt", "task_work_receipt");
  const excluded = responseExclusions(response);
  const warnings = normalizeWarnings(response.warnings);
  const truncationDetails = object(response.truncation);
  const truncationReasons = [
    ...Object.values(truncationDetails).map((entry) => nonEmpty(object(entry).reason, 500)).filter(Boolean),
    ...warnings.map((warning) => warning.code).filter((code) => code?.includes("truncat")),
  ];
  return makePreview({
    audience: response.ai_audience,
    scopeKind: "task",
    seed: response.task ? { type: "task", id: object(response.task).id } : null,
    capabilities: {
      entityDetails: "full",
      exclusionDetails: excluded.length ? "aggregate_only" : "unavailable",
      relationDetails: included.some((entry) => entry.relationPath.length) ? "partial" : "unavailable",
      aiMetadata: included.some((entry) => entry.visibility.length || entry.freshness || entry.authority) ? "partial" : "unavailable",
      sourceLocators: included.some((entry) => entry.sourceLocator) ? "partial" : "unavailable",
    },
    included,
    excluded,
    warnings,
    limits: response.limits,
    truncation: { truncated: Boolean(response.truncated), reasons: truncationReasons, details: truncationDetails },
    estimatedCharacters: response.estimated_characters ?? serializedLength(response),
    estimatedTokens: response.estimated_tokens,
    excludedCount: response.excluded_count,
  });
}

function themeKnowledge(response) {
  const knowledge = object(response.knowledge);
  return {
    nodes: array(knowledge.knowledge_nodes || response.knowledge_nodes),
    edges: array(knowledge.knowledge_edges || response.knowledge_edges),
  };
}

export function previewThemeCoding(themeContextResponse) {
  const response = object(themeContextResponse);
  const included = [];
  let sourceOrder = 0;
  const addMany = (records, type, reason) => {
    for (const record of array(records)) {
      const entity = includedEntity(record, type, { includedReason: reason, sourceOrder: sourceOrder++ });
      if (entity) included.push(entity);
    }
  };
  addMany(response.themes, "theme", "seed");
  addMany(response.repository_contexts, "repository_context", "theme_repository_context");
  addMany(response.open_items, "item", "open_item");
  addMany(response.recent_notes, "note", "recent_note");
  const knowledge = themeKnowledge(response);
  addMany(knowledge.nodes, "knowledge_node", "theme_knowledge");
  const relations = knowledge.edges.map((edge) => relationEntry({
    ...object(edge),
    source: object(edge).source || { type: "knowledge_node", id: object(edge).source_node_id },
    target: object(edge).target || { type: "knowledge_node", id: object(edge).target_node_id },
    predicate: object(edge).predicate || object(edge).relation_type,
  })).filter(Boolean);
  const excluded = responseExclusions(response);
  const themes = array(response.themes);
  const seed = themes.length === 1 ? { type: "theme", id: object(themes[0]).id } : null;
  return makePreview({
    audience: response.ai_audience,
    scopeKind: "theme",
    seed,
    capabilities: {
      entityDetails: "full",
      exclusionDetails: excluded.length ? "aggregate_only" : "unavailable",
      relationDetails: relations.length ? "partial" : "unavailable",
      aiMetadata: included.some((entry) => entry.visibility.length || entry.freshness || entry.authority) ? "partial" : "unavailable",
      sourceLocators: included.some((entry) => entry.sourceLocator) ? "partial" : "unavailable",
    },
    included,
    relations,
    excluded,
    warnings: normalizeWarnings(response.warnings),
    limits: response.limits,
    truncation: {
      truncated: Boolean(response.truncated),
      reasons: array(response.truncation_reasons),
      details: object(response.truncation),
    },
    estimatedCharacters: response.estimated_characters ?? serializedLength(response),
    estimatedTokens: response.estimated_tokens,
    excludedCount: response.excluded_count,
  });
}

export function previewContextSubgraph(contextGraphResponse) {
  const response = object(contextGraphResponse);
  const relations = array(response.edges).map(relationEntry).filter(Boolean);
  const edgeById = new Map(relations.filter((edge) => edge.id).map((edge) => [edge.id, edge]));
  const seed = ref(response.seed);
  const included = array(response.nodes).map((node, sourceOrder) => {
    const nodeRef = ref(node);
    if (!nodeRef) return null;
    const relationPath = seed && compareRef(seed, nodeRef) === 0 ? [] : graphPathForNode(response, nodeRef, edgeById);
    const finalEdge = relationPath.at(-1);
    const rawFinalEdge = finalEdge?.edgeId ? object(array(response.edges).find((edge) => object(edge).id === finalEdge.edgeId)) : {};
    return includedEntity(node, nodeRef.type, {
      includedReason: seed && compareRef(seed, nodeRef) === 0 ? "seed" : rawFinalEdge.reason,
      relationPath,
      sourceOrder,
    });
  }).filter(Boolean);
  const excluded = aggregateExclusions(response.exclusions);
  return makePreview({
    audience: response.ai_audience,
    scopeKind: "context_subgraph",
    seed,
    capabilities: {
      entityDetails: "full",
      exclusionDetails: excluded.length ? "aggregate_only" : "unavailable",
      relationDetails: relations.length ? "full" : "unavailable",
      aiMetadata: included.some((entry) => entry.visibility.length || entry.freshness || entry.authority) ? "partial" : "unavailable",
      sourceLocators: included.some((entry) => entry.sourceLocator) ? "partial" : "unavailable",
    },
    included,
    relations,
    excluded,
    warnings: normalizeWarnings(response.warnings),
    limits: response.limits,
    truncation: {
      truncated: Boolean(response.truncated),
      reasons: array(response.exclusions),
      details: {},
    },
    estimatedCharacters: response.estimated_characters ?? serializedLength(response),
    estimatedTokens: response.estimated_tokens,
    excludedCount: response.excluded_count,
  });
}
