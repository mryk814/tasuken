const DEFAULT_TYPE_ORDER = ["question", "claim", "evidence", "decision", "source", "insight"];

function text(value) {
  return value == null ? "" : String(value).trim();
}

function originOf(node) {
  const source = text(node.source).toLowerCase();
  if (source === "imported" || source === "ai" || source === "ai_generated" || source === "migration" || source === "system") {
    return source === "ai_generated" ? "ai" : source;
  }
  if (text(node.source_type)) return text(node.source_type);
  if (node.source_note_id) return "note";
  if (node.source_link_id) return "resource";
  if (node.source_item_id) return "task";
  return source || "unknown";
}

function compareText(a, b) {
  return a.localeCompare(b, "ja");
}

/**
 * Build a read-only audit projection for the legacy Knowledge collections.
 * The input arrays are never changed and no migration or write is implied.
 */
export function buildKnowledgeInventory(nodes = [], relations = []) {
  const relationRefs = new Map();
  for (const relation of relations) {
    for (const id of [text(relation.source_node_id), text(relation.target_node_id)]) {
      if (id) relationRefs.set(id, (relationRefs.get(id) || 0) + 1);
    }
  }

  const groups = new Map();
  for (const node of nodes) {
    const type = text(node.node_type) || "insight";
    const group = groups.get(type) || {
      node_type: type,
      count: 0,
      updated_count: 0,
      latest_updated_at: null,
      relation_refs: 0,
      origins: new Map(),
    };
    const updatedAt = text(node.updated_at);
    const origin = originOf(node);
    group.count += 1;
    group.updated_count += Number(Boolean(updatedAt));
    if (updatedAt && (!group.latest_updated_at || updatedAt > group.latest_updated_at)) group.latest_updated_at = updatedAt;
    group.relation_refs += relationRefs.get(text(node.id)) || 0;
    group.origins.set(origin, (group.origins.get(origin) || 0) + 1);
    groups.set(type, group);
  }

  const types = [...groups.values()]
    .sort((a, b) => {
      const aIndex = DEFAULT_TYPE_ORDER.indexOf(a.node_type);
      const bIndex = DEFAULT_TYPE_ORDER.indexOf(b.node_type);
      if (aIndex >= 0 || bIndex >= 0) return (aIndex < 0 ? DEFAULT_TYPE_ORDER.length : aIndex) - (bIndex < 0 ? DEFAULT_TYPE_ORDER.length : bIndex);
      return compareText(a.node_type, b.node_type);
    })
    .map((group) => ({
      ...group,
      origins: [...group.origins.entries()]
        .sort(([a], [b]) => compareText(a, b))
        .map(([origin, count]) => ({ origin, count })),
    }));

  return {
    total_nodes: nodes.length,
    total_relations: relations.length,
    linked_nodes: nodes.filter((node) => (relationRefs.get(text(node.id)) || 0) > 0).length,
    types,
  };
}
