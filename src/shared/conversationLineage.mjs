import { projectContextGraph } from "./contextGraph.mjs";

const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_MAX_ITEMS = 24;

export const conversationLineagePredicates = Object.freeze([
  "derived_from",
  "generated_from",
  "exported_from",
  "created_for",
  "continued_as",
  "attached_to",
  "captured_from",
  "based_on",
  "triaged_to",
]);

const lineagePredicates = new Set(conversationLineagePredicates);
const sourceToOutputPredicates = new Set(["triaged_to"]);
const predicateOrder = new Map([
  ["exported_from", 0],
  ["generated_from", 1],
  ["continued_as", 2],
  ["derived_from", 3],
  ["created_for", 4],
  ["attached_to", 5],
  ["captured_from", 6],
  ["based_on", 7],
  ["triaged_to", 8],
]);

function text(value) {
  return value == null ? "" : String(value).trim();
}

function keyOf(ref) {
  return JSON.stringify([text(ref?.type), text(ref?.id)]);
}

function edgeFact(edge) {
  return edge.status === "asserted" || edge.status === "accepted";
}

function edgeRecord(graph, edge) {
  for (const evidenceRef of edge.evidence_refs || []) {
    const record = graph.records.get(keyOf({ type: "reference", id: evidenceRef }));
    if (record) return record;
  }
  return null;
}

function edgeDetails(graph, edge, outputRef) {
  const relation = edgeRecord(graph, edge);
  const outputNode = graph.nodes.get(keyOf(outputRef));
  return {
    id: edge.id,
    source: { ...edge.source },
    target: { ...edge.target },
    predicate: edge.predicate,
    layer: edge.layer,
    origin: edge.origin,
    reason: text(relation?.note) || text(edge.origin) || edge.predicate,
    created_at: text(relation?.created_at || relation?.updated_at || outputNode?.created_at),
    evidence_refs: [...(edge.evidence_refs || [])],
  };
}

function lineageSteps(graph, currentKey, mode) {
  const steps = [];
  const append = (edge, nextRef, outputRef) => {
    if (!edgeFact(edge) || !lineagePredicates.has(edge.predicate)) return;
    const nextKey = keyOf(nextRef);
    const node = graph.nodes.get(nextKey);
    if (!node) return;
    steps.push({
      key: nextKey,
      node,
      relation: edgeDetails(graph, edge, outputRef),
    });
  };

  for (const edge of graph.outgoing.get(currentKey) || []) {
    const sourceToOutput = sourceToOutputPredicates.has(edge.predicate);
    if ((mode === "descendants" && sourceToOutput) || (mode === "ancestors" && !sourceToOutput)) {
      append(edge, edge.target, sourceToOutput ? edge.target : edge.source);
    }
  }
  for (const edge of graph.incoming.get(currentKey) || []) {
    const sourceToOutput = sourceToOutputPredicates.has(edge.predicate);
    if ((mode === "descendants" && !sourceToOutput) || (mode === "ancestors" && sourceToOutput)) {
      append(edge, edge.source, sourceToOutput ? edge.target : edge.source);
    }
  }
  return steps.sort((left, right) => {
    const predicateRank = (predicateOrder.get(left.relation.predicate) ?? 99) - (predicateOrder.get(right.relation.predicate) ?? 99);
    if (predicateRank) return predicateRank;
    return `${left.relation.created_at}:${left.node.ref.type}:${left.node.ref.id}`
      .localeCompare(`${right.relation.created_at}:${right.node.ref.type}:${right.node.ref.id}`);
  });
}

function traverse(graph, seed, mode, options) {
  const maxDepth = Math.min(2, Math.max(1, Number(options.maxDepth) || DEFAULT_MAX_DEPTH));
  const maxItems = Math.min(100, Math.max(1, Number(options.maxItems) || DEFAULT_MAX_ITEMS));
  const seedKey = keyOf(seed);
  const visited = new Set([seedKey]);
  const queue = [{ key: seedKey, depth: 0, path: [], trail: [] }];
  const items = [];
  let truncated = false;

  while (queue.length) {
    const current = queue.shift();
    if (current.depth >= maxDepth) continue;
    for (const step of lineageSteps(graph, current.key, mode)) {
      if (visited.has(step.key)) continue;
      if (items.length >= maxItems) {
        truncated = true;
        continue;
      }
      visited.add(step.key);
      const path = [...current.path, step.relation];
      const record = graph.records.get(step.key);
      const item = {
        ref: { ...step.node.ref },
        title: step.node.title,
        created_at: step.node.created_at,
        updated_at: step.node.updated_at,
        theme_id: step.node.theme_id || "",
        depth: current.depth + 1,
        relation: step.relation,
        path,
        trail: [...current.trail, {
          ref: { ...step.node.ref },
          title: step.node.title,
          relation: step.relation,
        }],
        is_conversation: step.node.ref.type === "resource" && record?.resource_scope === "chat_ref",
      };
      items.push(item);
      queue.push({ key: step.key, depth: item.depth, path, trail: item.trail });
    }
  }
  return { items, truncated };
}

function directReferences(graph, seed, maxItems) {
  const seedKey = keyOf(seed);
  const candidates = [];
  const append = (edge, nodeRef) => {
    if (!edgeFact(edge) || lineagePredicates.has(edge.predicate)) return;
    const node = graph.nodes.get(keyOf(nodeRef));
    if (!node) return;
    candidates.push({
      ref: { ...node.ref },
      title: node.title,
      relation: edgeDetails(graph, edge, edge.source),
    });
  };
  for (const edge of graph.outgoing.get(seedKey) || []) append(edge, edge.target);
  for (const edge of graph.incoming.get(seedKey) || []) append(edge, edge.source);
  candidates.sort((left, right) => (
    `${left.relation.predicate}:${left.ref.type}:${left.ref.id}`
      .localeCompare(`${right.relation.predicate}:${right.ref.type}:${right.ref.id}`)
  ));
  return {
    items: candidates.slice(0, maxItems),
    truncated: candidates.length > maxItems,
  };
}

function summaryCounts(items) {
  const counts = { task: 0, note: 0, artifact: 0, conversation: 0, other: 0 };
  for (const item of items.filter((entry) => entry.depth === 1)) {
    if (item.ref.type === "task") counts.task += 1;
    else if (item.ref.type === "note") counts.note += 1;
    else if (item.ref.type === "artifact") counts.artifact += 1;
    else if (item.is_conversation) counts.conversation += 1;
    else counts.other += 1;
  }
  return counts;
}

/**
 * Conversation/Entityの局所系譜を、共通Context Graph正本から再構築する。
 * 保存用の別graphは作らず、派生と単なるreferenceを別collectionで返す。
 */
export function buildEntityLineage(workspace, seed, options = {}) {
  const graph = projectContextGraph(workspace);
  const seedKey = keyOf(seed);
  const seedNode = graph.nodes.get(seedKey);
  const maxItems = Math.min(100, Math.max(1, Number(options.maxItems) || DEFAULT_MAX_ITEMS));
  if (!seedNode) {
    return {
      seed: { type: text(seed?.type), id: text(seed?.id) },
      seed_found: false,
      summary: { task: 0, note: 0, artifact: 0, conversation: 0, other: 0 },
      descendants: [],
      ancestors: [],
      references: [],
      truncated: false,
      limits: { max_depth: Math.min(2, Math.max(1, Number(options.maxDepth) || DEFAULT_MAX_DEPTH)), max_items: maxItems },
    };
  }
  const descendants = traverse(graph, seed, "descendants", options);
  const ancestors = traverse(graph, seed, "ancestors", options);
  const references = directReferences(graph, seed, Math.min(12, maxItems));
  return {
    seed: { ...seedNode.ref, title: seedNode.title },
    seed_found: true,
    summary: summaryCounts(descendants.items),
    descendants: descendants.items,
    ancestors: ancestors.items,
    references: references.items,
    truncated: descendants.truncated || ancestors.truncated || references.truncated,
    limits: { max_depth: Math.min(2, Math.max(1, Number(options.maxDepth) || DEFAULT_MAX_DEPTH)), max_items: maxItems },
  };
}

/** AI Contextと同じbounded/path/reason形で必要な系譜だけを選ぶためのpure projection。 */
export function lineageContextSelection(workspace, seed, options = {}) {
  const lineage = buildEntityLineage(workspace, seed, options);
  const items = [...lineage.ancestors, ...lineage.descendants];
  const nodes = new Map([[keyOf(lineage.seed), lineage.seed]]);
  const edges = new Map();
  const paths = [];
  for (const item of items) {
    nodes.set(keyOf(item.ref), { ...item.ref, title: item.title });
    for (const relation of item.path) edges.set(relation.id, relation);
    paths.push({ target: item.ref, direction: lineage.ancestors.includes(item) ? "upstream" : "downstream", edge_ids: item.path.map((edge) => edge.id), reason: item.relation.reason });
  }
  return {
    seed: lineage.seed,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    paths,
    truncated: lineage.truncated,
    limits: lineage.limits,
  };
}
