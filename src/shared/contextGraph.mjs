import { collectionKeyForEntityType, entityTypes } from "./entityRegistry.mjs";

const DEFAULT_MAX_HOPS = 2;
const DEFAULT_MAX_NODES = 24;
const DEFAULT_MAX_EDGES = 48;
const DEFAULT_TOKEN_BUDGET = 2400;
const SUGGESTED_STATUS = "suggested";
const ASSERTED_STATUS = "asserted";
const ACCEPTED_STATUS = "accepted";
const REJECTED_STATUS = "rejected";
const SUPERSEDED_STATUS = "superseded";
const UNKNOWN_STATUS = "unknown";

const LAYER_ORDER = new Map([
  ["operational", 0],
  ["provenance", 1],
  ["semantic", 2],
]);

// Exact mapping copied from artifactSourceEntityTypes in
// src/main/repositories/domain.mjs. Unsupported labels are intentionally not
// guessed into a graph edge.
const ARTIFACT_SOURCE_TYPES = new Map([
  ["chat_ref", "resource"],
  ["report", "note"],
  ["theme", "theme"],
  ["capture_entry", "capture_entry"],
  ["ai_proposal", "ai_proposal"],
  ["task", "task"],
  ["note", "note"],
]);

const LEGACY_THEME_TYPES = new Set([
  "item", "note", "link", "view", "status_update", "source_record", "entity_source",
  "field_definition", "field_value", "log_entry", "import_batch", "knowledge_node", "ai_proposal",
  "resource", "artifact",
]);

function text(value) {
  return value == null ? "" : String(value).trim();
}

function refKey(type, id) {
  return JSON.stringify([type, id]);
}

function ref(type, id) {
  return { type: text(type), id: text(id) };
}

function validRef(type, id) {
  return Boolean(text(type) && text(id));
}

function normalizeStatus(value) {
  const status = text(value).toLowerCase();
  if (!status) return ASSERTED_STATUS;
  if ([ASSERTED_STATUS, ACCEPTED_STATUS, SUGGESTED_STATUS, REJECTED_STATUS, SUPERSEDED_STATUS, UNKNOWN_STATUS].includes(status)) return status;
  return UNKNOWN_STATUS;
}

function titleOf(record, type, id) {
  return text(record.title) || text(record.name) || text(record.label) || `${type}:${id}`;
}

function collectionRecords(workspace, type) {
  const key = collectionKeyForEntityType(type);
  return Array.isArray(workspace?.[key]) ? workspace[key] : [];
}

function stableSourceRef(record) {
  const refs = Array.isArray(record.ai_source_refs) ? record.ai_source_refs : [];
  return refs
    .map((entry) => text(entry?.id || entry?.ref || entry?.relative_path))
    .filter(Boolean)
    .sort();
}

function nodeMetadata(record, type, id) {
  const metadata = {
    title: titleOf(record, type, id),
    updated_at: text(record.updated_at),
    created_at: text(record.created_at),
  };
  const themeId = text(record.project_id || record.theme_id);
  if (themeId) metadata.theme_id = themeId;
  if (record.source_record_id) metadata.source_record_id = text(record.source_record_id);
  const sourceRefs = stableSourceRef(record);
  if (sourceRefs.length) metadata.source_refs = sourceRefs;
  if (record.ai_authority) metadata.ai_authority = text(record.ai_authority);
  if (record.ai_visibility) metadata.ai_visibility = text(record.ai_visibility);
  if (record.ai_freshness) metadata.ai_freshness = text(record.ai_freshness);
  return metadata;
}

function compareEdges(a, b) {
  const factRank = (status) => status === ASSERTED_STATUS || status === ACCEPTED_STATUS ? 0 : status === SUGGESTED_STATUS ? 1 : 2;
  const statusCompare = factRank(a.status) - factRank(b.status);
  if (statusCompare) return statusCompare;
  const layerCompare = (LAYER_ORDER.get(a.layer) ?? 9) - (LAYER_ORDER.get(b.layer) ?? 9);
  if (layerCompare) return layerCompare;
  return `${a.predicate}:${a.target.type}:${a.target.id}`.localeCompare(`${b.predicate}:${b.target.type}:${b.target.id}`);
}

function edgeKey(edge) {
  return JSON.stringify([edge.source.type, edge.source.id, edge.predicate, edge.target.type, edge.target.id]);
}

function isActive(record) {
  return !record?.deleted_at;
}

function stableEvidenceRefs(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => {
    if (entry && typeof entry === "object") {
      const type = text(entry.type);
      const id = text(entry.id);
      return type && id ? `${type}:${id}` : "";
    }
    const candidate = text(entry);
    return candidate && !/\s/.test(candidate) && candidate.length <= 200 ? candidate : "";
  }).filter(Boolean))].sort();
}

/**
 * Existing SQLite rows/domain collections are projected into a rebuildable read model.
 * This function never mutates the input and never writes to SQLite.
 */
export function projectContextGraph(workspace, options = {}) {
  const nodes = new Map();
  const records = new Map();
  for (const type of entityTypes) {
    for (const record of collectionRecords(workspace, type)) {
      const id = text(record?.id);
      if (!id || !isActive(record)) continue;
      const key = refKey(type, id);
      nodes.set(key, { ref: ref(type, id), ...nodeMetadata(record, type, id) });
      records.set(key, record);
    }
  }

  const edges = new Map();
  const addEdge = ({ sourceType, sourceId, targetType, targetId, predicate, layer = "operational", status = ASSERTED_STATUS, origin = "explicit", evidenceRefs = [], validFrom = null, validTo = null }) => {
    if (!validRef(sourceType, sourceId) || !validRef(targetType, targetId)) return;
    const source = ref(sourceType, sourceId);
    const target = ref(targetType, targetId);
    if (!nodes.has(refKey(source.type, source.id)) || !nodes.has(refKey(target.type, target.id))) return;
    const rawStatus = text(status).toLowerCase();
    const normalizedStatus = normalizeStatus(status);
    const edge = {
      id: JSON.stringify([source.type, source.id, predicate, target.type, target.id]),
      source,
      target,
      predicate: text(predicate),
      layer,
      status: normalizedStatus,
      origin: text(origin) || "explicit",
      evidence_refs: stableEvidenceRefs(evidenceRefs),
    };
    if (rawStatus && normalizedStatus === UNKNOWN_STATUS && rawStatus !== UNKNOWN_STATUS) edge.status_raw = rawStatus;
    if (validFrom) edge.valid_from = text(validFrom);
    if (validTo) edge.valid_to = text(validTo);
    const key = edgeKey(edge);
    const previous = edges.get(key);
    if (!previous || compareEdges(edge, previous) < 0) edges.set(key, edge);
    else if (previous.evidence_refs.length < edge.evidence_refs.length) previous.evidence_refs = edge.evidence_refs;
  };

  const addFieldRef = (type, record, field, targetType, predicate, layer = "operational") => {
    const targetId = text(record[field]);
    if (targetId) addEdge({ sourceType: type, sourceId: record.id, targetType, targetId, predicate, layer });
  };

  for (const [key, record] of records) {
    const entity = nodes.get(key)?.ref;
    if (!entity) continue;
    const { type, id } = entity;
    const themeId = text(record.project_id || (LEGACY_THEME_TYPES.has(type) ? record.theme_id : ""));
    if (themeId) addEdge({ sourceType: type, sourceId: id, targetType: "theme", targetId: themeId, predicate: "belongs_to_theme" });
    if (record.source_record_id) addEdge({ sourceType: type, sourceId: id, targetType: "source_record", targetId: record.source_record_id, predicate: "captured_from", layer: "provenance", origin: "source_record_id" });
    if (type === "task") {
      addFieldRef(type, record, "parent_task_id", "task", "child_of");
      addFieldRef(type, record, "plan_node_id", "plan_node", "planned_under");
      if (record.repeat_parent_task_id) addFieldRef(type, record, "repeat_parent_task_id", "task", "repeats");
    }
    if (type === "plan_node") addFieldRef(type, record, "parent_plan_node_id", "plan_node", "child_of");
    if (type === "waiting") addFieldRef(type, record, "task_id", "task", "waiting_on");
    if (type === "capture_entry" && record.triaged_to_type && record.triaged_to_id) {
      addEdge({ sourceType: type, sourceId: id, targetType: record.triaged_to_type, targetId: record.triaged_to_id, predicate: "triaged_to", origin: "triage" });
    }
    if (type === "schedule" && record.owner_type && record.owner_id) {
      addEdge({ sourceType: record.owner_type, sourceId: record.owner_id, targetType: type, targetId: id, predicate: "scheduled_as", layer: "operational", origin: "schedule" });
    }
    if (type === "reference" && record.source_type && record.source_id && record.target_type && record.target_id) {
      addEdge({ sourceType: record.source_type, sourceId: record.source_id, targetType: record.target_type, targetId: record.target_id, predicate: record.relation_type || "related_to", layer: "operational", origin: "reference", evidenceRefs: [record.id] });
    }
    if (type === "task_dependency") {
      addEdge({ sourceType: "task", sourceId: record.task_id, targetType: "task", targetId: record.depends_on_task_id, predicate: "depends_on", origin: "task_dependency", evidenceRefs: [id] });
    }
    if (type === "plan_dependency") {
      addEdge({ sourceType: "plan_node", sourceId: record.plan_node_id, targetType: "plan_node", targetId: record.depends_on_plan_node_id, predicate: "depends_on", origin: "plan_dependency", evidenceRefs: [id] });
    }
    if (type === "knowledge_edge") {
      addEdge({ sourceType: "knowledge_node", sourceId: record.source_node_id, targetType: "knowledge_node", targetId: record.target_node_id, predicate: record.relation_type || "related_to", layer: "semantic", status: record.status, origin: record.origin || "legacy_knowledge_edge", evidenceRefs: record.evidence_refs });
    }
    if (type === "artifact") {
      const targetType = ARTIFACT_SOURCE_TYPES.get(text(record.source_type));
      if (targetType) addEdge({ sourceType: type, sourceId: id, targetType, targetId: record.source_id, predicate: "derived_from", layer: "provenance", origin: "artifact.source", evidenceRefs: record.origin_note_id ? [record.origin_note_id] : [] });
      if (record.origin_note_id) addEdge({ sourceType: type, sourceId: id, targetType: "note", targetId: record.origin_note_id, predicate: "exported_from", layer: "provenance", origin: "artifact.origin_note_id" });
    }
    if (type === "entity_source" && record.entity_type && record.entity_id && record.source_record_id) {
      addEdge({ sourceType: record.entity_type, sourceId: record.entity_id, targetType: "source_record", targetId: record.source_record_id, predicate: "captured_from", layer: "provenance", origin: "entity_source", evidenceRefs: [id] });
    }
    if (type === "change_event" && record.entity_type && record.entity_id) {
      addEdge({ sourceType: type, sourceId: id, targetType: record.entity_type, targetId: record.entity_id, predicate: "records_change_for", layer: "provenance", origin: record.source || "change_event", validFrom: record.changed_at });
    }
    if (type === "resource" && record.parent_resource_id) addFieldRef(type, record, "parent_resource_id", "resource", "continued_as", "provenance");
    if (type === "knowledge_node") {
      if (record.source_type && record.source_id) addEdge({ sourceType: type, sourceId: id, targetType: record.source_type, targetId: record.source_id, predicate: "based_on", layer: "provenance", origin: "knowledge_node.source" });
      for (const [field, targetType, predicate] of [["source_note_id", "note", "based_on"], ["source_link_id", "resource", "based_on"], ["source_item_id", "task", "based_on"]]) {
        if (record[field]) addEdge({ sourceType: type, sourceId: id, targetType, targetId: record[field], predicate, layer: "provenance", origin: `knowledge_node.${field}` });
      }
    }
  }

  const orderedEdges = [...edges.values()].sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)));
  const outgoing = new Map();
  const incoming = new Map();
  for (const edge of orderedEdges) {
    const out = outgoing.get(refKey(edge.source.type, edge.source.id)) || [];
    out.push(edge);
    outgoing.set(refKey(edge.source.type, edge.source.id), out);
    const incomingEdges = incoming.get(refKey(edge.target.type, edge.target.id)) || [];
    incomingEdges.push(edge);
    incoming.set(refKey(edge.target.type, edge.target.id), incomingEdges);
  }
  for (const list of outgoing.values()) list.sort(compareEdges);
  for (const list of incoming.values()) list.sort(compareEdges);
  return { nodes, records, edges: orderedEdges, outgoing, incoming, options: { ...options } };
}

function normalizeLimits(options = {}) {
  const positiveInt = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : fallback;
  const nonNegativeInt = (value, fallback) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.floor(Number(value)) : fallback;
  return {
    maxHops: Math.min(2, positiveInt(options.maxHops, DEFAULT_MAX_HOPS)),
    maxNodes: Math.min(100, positiveInt(options.maxNodes, DEFAULT_MAX_NODES)),
    maxEdges: Math.min(200, nonNegativeInt(options.maxEdges, DEFAULT_MAX_EDGES)),
    tokenBudget: Math.min(12000, Math.max(16, positiveInt(options.tokenBudget, DEFAULT_TOKEN_BUDGET))),
  };
}

function estimatedTokens(value) {
  // The seed and envelope are protocol overhead; budget the context payload
  // itself so a small budget can still return the typed seed node.
  return Math.ceil(JSON.stringify({ nodes: value.nodes, edges: value.edges, paths: value.paths }).length / 4);
}

function edgeAllowed(edge, options) {
  if (typeof options.edgeFilter === "function" && !options.edgeFilter(edge)) return false;
  if (edge.status === SUGGESTED_STATUS) return Boolean(options.includeSuggested);
  if (edge.status !== ASSERTED_STATUS && edge.status !== ACCEPTED_STATUS) return false;
  return true;
}

function nodeAllowed(node, options) {
  return typeof options.nodeFilter !== "function" || options.nodeFilter(node);
}

function nodeOutput(graph, key) {
  const node = graph.nodes.get(key);
  if (!node) return null;
  const { ref: _ref, ...metadata } = node;
  return { ...node.ref, ...metadata };
}

function edgeOutput(edge, reason, path) {
  return { ...edge, reason, path };
}

export function getEntityNeighbors(graph, seed, options = {}) {
  return getContextSubgraph(graph, seed, { ...options, maxHops: 1 });
}

export function traceProvenance(graph, seed, options = {}) {
  const provenance = new Set(["provenance"]);
  return getContextSubgraph(graph, seed, {
    ...options,
    edgeFilter: (edge) => provenance.has(edge.layer) && (!options.edgeFilter || options.edgeFilter(edge)),
    // Upstream follows subject -> object (Artifact -> source, Entity ->
    // source_record); downstream follows object -> subject. The default is
    // both because a Note may be both source and output of separate edges.
    direction: options.direction === "upstream" ? "outgoing" : options.direction === "downstream" ? "incoming" : "both",
  });
}

export function getContextSubgraph(graph, seed, options = {}) {
  const seedRef = ref(seed?.type, seed?.id);
  const seedKey = refKey(seedRef.type, seedRef.id);
  if (!graph?.nodes?.has(seedKey)) return { seed: seedRef, nodes: [], edges: [], paths: [], truncated: false, limits: normalizeLimits(options), estimated_tokens: 0, exclusions: ["seed_not_found"] };
  if (!nodeAllowed(graph.nodes.get(seedKey), options)) return { seed: seedRef, nodes: [], edges: [], paths: [], truncated: false, limits: normalizeLimits(options), estimated_tokens: 0, exclusions: ["seed_not_allowed"] };
  const limits = normalizeLimits(options);
  const direction = options.direction === "incoming" ? "incoming" : options.direction === "outgoing" ? "outgoing" : "both";
  const included = new Set([seedKey]);
  const queue = [{ key: seedKey, depth: 0, path: [] }];
  const selectedEdges = [];
  const selectedKeys = new Set();
  const paths = [];
  let truncated = false;
  const neighborEdges = (key) => {
    const edges = [];
    if (direction !== "incoming") for (const edge of graph.outgoing.get(key) || []) edges.push({ edge, next: refKey(edge.target.type, edge.target.id) });
    if (direction !== "outgoing") for (const edge of graph.incoming.get(key) || []) edges.push({ edge, next: refKey(edge.source.type, edge.source.id) });
    return edges.sort((a, b) => compareEdges(a.edge, b.edge));
  };
  while (queue.length) {
    const current = queue.shift();
    if (current.depth >= limits.maxHops) continue;
    for (const { edge, next } of neighborEdges(current.key)) {
      if (!edgeAllowed(edge, options)) continue;
      const nextNode = graph.nodes.get(next);
      if (!nextNode || !nodeAllowed(nextNode, options)) continue;
      const nextPath = [...current.path, edge.id];
      if (!selectedKeys.has(edge.id) && selectedEdges.length >= limits.maxEdges) { truncated = true; continue; }
      if (!included.has(next)) {
        if (included.size >= limits.maxNodes) { truncated = true; continue; }
        included.add(next);
        queue.push({ key: next, depth: current.depth + 1, path: nextPath });
      }
      if (!selectedKeys.has(edge.id)) {
        selectedKeys.add(edge.id);
        selectedEdges.push(edgeOutput(edge, current.depth === 0 ? "direct_relation" : "bounded_path", nextPath));
      }
      paths.push({ from: { ...graph.nodes.get(current.key).ref }, to: { ...nextNode.ref }, hops: current.depth + 1, edge_ids: nextPath });
    }
  }
  const nodes = [...included].map((key) => nodeOutput(graph, key)).filter(Boolean);
  const result = {
    seed: seedRef,
    nodes,
    edges: selectedEdges,
    paths,
    truncated,
    limits,
    policy: { asserted_first: true, suggested_included: Boolean(options.includeSuggested), suggested_is_fact: false },
    exclusions: [],
  };
  sanitizeResult(result);
  result.estimated_tokens = estimatedTokens(result);
  if (result.estimated_tokens > limits.tokenBudget) {
    result.truncated = true;
    while (result.estimated_tokens > limits.tokenBudget && result.edges.length) {
      result.edges.pop();
      sanitizeResult(result);
      result.estimated_tokens = estimatedTokens(result);
    }
    while (result.estimated_tokens > limits.tokenBudget && result.nodes.length > 1) {
      result.nodes.pop();
      sanitizeResult(result);
      result.estimated_tokens = estimatedTokens(result);
    }
    if (result.estimated_tokens > limits.tokenBudget) {
      result.nodes = result.nodes.map(({ type, id }) => ({ type, id }));
      sanitizeResult(result);
      result.estimated_tokens = estimatedTokens(result);
    }
    result.exclusions.push("token_budget");
    sanitizeResult(result);
  }
  return result;
}

function sanitizeResult(result) {
  const seedKey = refKey(result.seed.type, result.seed.id);
  const edgeIds = new Set(result.edges.map((edge) => edge.id));
  const reachable = new Set([seedKey]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const path of result.paths) {
      if (!path.edge_ids.every((edgeId) => edgeIds.has(edgeId))) continue;
      const fromKey = refKey(path.from.type, path.from.id);
      const toKey = refKey(path.to.type, path.to.id);
      if (reachable.has(fromKey) && !reachable.has(toKey)) {
        reachable.add(toKey);
        changed = true;
      }
    }
  }
  result.nodes = result.nodes.filter((node) => reachable.has(refKey(node.type, node.id)));
  const nodeKeys = new Set(result.nodes.map((node) => refKey(node.type, node.id)));
  result.edges = result.edges.filter((edge) => (
    nodeKeys.has(refKey(edge.source.type, edge.source.id))
      && nodeKeys.has(refKey(edge.target.type, edge.target.id))
      && edgeIds.has(edge.id)
  ));
  const retainedEdgeIds = new Set(result.edges.map((edge) => edge.id));
  result.paths = result.paths.filter((path) => (
    nodeKeys.has(refKey(path.from.type, path.from.id))
      && nodeKeys.has(refKey(path.to.type, path.to.id))
      && path.edge_ids.every((edgeId) => retainedEdgeIds.has(edgeId))
  ));
}

export function explainContextSelection(result) {
  return {
    seed: result.seed,
    included: result.nodes.map(({ type, id }) => ({ type, id })),
    reasons: result.edges.map((edge) => ({
      target: edge.target,
      predicate: edge.predicate,
      layer: edge.layer,
      status: edge.status,
      reason: edge.reason,
      path: edge.path,
    })),
    limits: result.limits,
    estimated_tokens: result.estimated_tokens,
    truncated: result.truncated,
    exclusions: result.exclusions,
  };
}

export function contextGraphMcpShape(result) {
  return {
    seed: result.seed,
    nodes: result.nodes.map(({ ref: _ref, ...node }) => node),
    edges: result.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      predicate: edge.predicate,
      layer: edge.layer,
      status: edge.status,
      ...(edge.status_raw ? { status_raw: edge.status_raw } : {}),
      origin: edge.origin,
      evidence_refs: edge.evidence_refs,
      reason: edge.reason,
      path: edge.path,
    })),
    paths: result.paths,
    limits: result.limits,
    estimated_tokens: result.estimated_tokens,
    truncated: result.truncated,
    exclusions: result.exclusions,
    policy: result.policy,
  };
}
