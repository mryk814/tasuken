import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_TEXT_LIMIT = 1200;
const MAX_TEXT_LIMIT = 8000;
const OPEN_ITEM_STATUSES = new Set(["todo", "doing", "waiting", "review", "inbox"]);
const ENTITY_TYPES = [
  "theme",
  "item",
  "note",
  "link",
  "status_update",
  "knowledge_node",
  "knowledge_relation",
  "task",
  "waiting",
  "plan_node",
  "schedule",
  "capture_entry",
];

function collectionKey(type) {
  return `${type}s`;
}

function parseRow(row) {
  return {
    ...JSON.parse(row.data_json),
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    device_id: row.device_id,
    source: row.source,
    version: row.version,
  };
}

function clampLimit(value, fallback = DEFAULT_LIMIT) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.floor(number), MAX_LIMIT);
}

function clampTextLimit(value, fallback = DEFAULT_TEXT_LIMIT) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.floor(number), MAX_TEXT_LIMIT);
}

function text(value) {
  return value == null ? "" : String(value);
}

function truncate(value, limit) {
  const raw = text(value);
  return raw.length <= limit ? raw : `${raw.slice(0, limit)}...`;
}

function withoutRawBody(note, includeRawBody, textLimit) {
  if (includeRawBody) return { ...note, body_markdown: truncate(note.body_markdown, textLimit) };
  const body = text(note.body_markdown);
  const { body_markdown: _body, ...rest } = note;
  return { ...rest, body_excerpt: truncate(body, Math.min(textLimit, 360)) };
}

function itemDate(item) {
  return item.planned_end || item.planned_start || item.due_date || "";
}

function isOpenItem(item) {
  return OPEN_ITEM_STATUSES.has(item.status || "todo") && !item.deleted_at;
}

function sortUpdated(records) {
  return [...records].sort((a, b) => text(b.updated_at).localeCompare(text(a.updated_at)));
}

function matchQuery(record, fields, query) {
  const normalized = text(query).toLowerCase();
  if (!normalized) return true;
  return fields.some((field) => text(record[field]).toLowerCase().includes(normalized));
}

export function defaultTaskenDbPath(env = process.env) {
  if (env.TASKEN_DB_PATH) return path.resolve(env.TASKEN_DB_PATH);
  const appData = env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  const candidates = [
    path.join(appData, "Tasken", "research-desk.sqlite"),
    path.join(appData, "Research Desk", "research-desk.sqlite"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

export class ReadOnlyTaskenContext {
  constructor(dbPath = defaultTaskenDbPath(), options = {}) {
    this.workspace = options.workspace || null;
    this.dbPath = dbPath;
    this.db = null;
    if (!this.workspace) {
      this.db = new Database(dbPath, { readonly: true, fileMustExist: true });
      this.db.pragma("query_only = ON");
    }
  }

  close() {
    this.db?.close();
  }

  list(type, includeArchived = false) {
    if (this.workspace) {
      const records = this.workspace[collectionKey(type)] || [];
      return sortUpdated(includeArchived ? records : records.filter((record) => !record.deleted_at));
    }
    const deletedClause = includeArchived ? "" : "AND deleted_at IS NULL";
    return this.db.prepare(`
      SELECT * FROM entities
      WHERE entity_type = ? ${deletedClause}
      ORDER BY updated_at DESC
    `).all(type).map(parseRow);
  }

  loadWorkspace(includeArchived = false) {
    const workspace = {};
    for (const type of ENTITY_TYPES) workspace[collectionKey(type)] = this.list(type, includeArchived);
    return workspace;
  }

  mergedItems(includeArchived = false) {
    const legacyItems = this.list("item", includeArchived);
    const tasks = this.list("task", includeArchived);
    const waitings = this.list("waiting", includeArchived);
    const schedules = this.list("schedule", includeArchived);
    const scheduleMap = new Map();
    for (const s of schedules) scheduleMap.set(`${s.owner_type}:${s.owner_id}`, s);
    const v2Ids = new Set();
    const projected = [];
    for (const t of tasks) {
      if (t.legacy_item_id) v2Ids.add(t.legacy_item_id);
      const s = scheduleMap.get(`task:${t.id}`);
      projected.push({
        id: t.legacy_item_id || t.id,
        title: t.title,
        kind: "task",
        status: t.state || "todo",
        priority: t.priority || "normal",
        theme_id: t.project_id || null,
        description: t.description || "",
        planned_start: s?.start_date || null,
        planned_end: s?.end_date || null,
        due_date: null,
        source_record_id: t.source_record_id,
        created_at: t.created_at,
        updated_at: t.updated_at,
        deleted_at: t.deleted_at,
      });
    }
    for (const w of waitings) {
      if (w.legacy_item_id) v2Ids.add(w.legacy_item_id);
      const s = scheduleMap.get(`waiting:${w.id}`);
      projected.push({
        id: w.legacy_item_id || w.id,
        title: w.title,
        kind: "waiting",
        status: w.state === "received" ? "done" : w.state === "cancelled" ? "cancelled" : "waiting",
        priority: "normal",
        theme_id: w.project_id || null,
        description: w.description || "",
        waiting_for: w.waiting_for || "",
        next_action: w.next_action || "",
        planned_start: s?.start_date || null,
        planned_end: s?.end_date || null,
        due_date: null,
        source_record_id: w.source_record_id,
        created_at: w.created_at,
        updated_at: w.updated_at,
        deleted_at: w.deleted_at,
      });
    }
    const deduped = legacyItems.filter((item) => !v2Ids.has(item.id));
    return sortUpdated([...deduped, ...projected]);
  }

  toolSearchItems(args = {}) {
    const limit = clampLimit(args.limit);
    const records = this.mergedItems(Boolean(args.include_archived))
      .filter((item) => matchQuery(item, ["title", "description", "next_action", "waiting_for"], args.query))
      .filter((item) => !args.theme_id || item.theme_id === args.theme_id)
      .slice(0, limit);
    return { items: records, limit };
  }

  toolListOpenItems(args = {}) {
    const limit = clampLimit(args.limit);
    const items = this.mergedItems(Boolean(args.include_archived))
      .filter(isOpenItem)
      .filter((item) => !args.theme_id || item.theme_id === args.theme_id)
      .sort((a, b) => (itemDate(a) || "9999-12-31").localeCompare(itemDate(b) || "9999-12-31"))
      .slice(0, limit);
    return { items, limit };
  }

  toolGetRecentNotes(args = {}) {
    const limit = clampLimit(args.limit);
    const textLimit = clampTextLimit(args.max_chars);
    const notes = this.list("note", Boolean(args.include_archived))
      .filter((note) => !args.theme_id || note.theme_id === args.theme_id)
      .slice(0, limit)
      .map((note) => withoutRawBody(note, Boolean(args.include_raw_body), textLimit));
    return { notes, limit, include_raw_body: Boolean(args.include_raw_body) };
  }

  toolSearchKnowledge(args = {}) {
    const limit = clampLimit(args.limit);
    const nodeTypes = Array.isArray(args.node_types) ? new Set(args.node_types) : null;
    const nodes = this.list("knowledge_node", Boolean(args.include_archived))
      .filter((node) => matchQuery(node, ["title", "body", "node_type"], args.query))
      .filter((node) => !args.theme_id || node.theme_id === args.theme_id)
      .filter((node) => !nodeTypes || nodeTypes.has(node.node_type))
      .slice(0, limit)
      .map((node) => ({ ...node, body: truncate(node.body, clampTextLimit(args.max_chars)) }));
    return { knowledge_nodes: nodes, limit };
  }

  toolGetKnowledgeContext(args = {}) {
    const limit = clampLimit(args.limit, 50);
    const textLimit = clampTextLimit(args.max_chars);
    const nodes = this.list("knowledge_node", Boolean(args.include_archived))
      .filter((node) => !args.theme_id || node.theme_id === args.theme_id)
      .slice(0, limit)
      .map((node) => ({ ...node, body: truncate(node.body, textLimit) }));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const relations = Boolean(args.include_relations ?? true)
      ? this.list("knowledge_relation", Boolean(args.include_archived))
        .filter((relation) => nodeIds.has(relation.source_node_id) || nodeIds.has(relation.target_node_id))
      : [];
    const sources = Boolean(args.include_sources)
      ? {
        notes: this.list("note").filter((note) => nodes.some((node) => node.source_note_id === note.id)).map((note) => withoutRawBody(note, Boolean(args.include_raw_body), textLimit)),
        links: this.list("link").filter((link) => nodes.some((node) => node.source_link_id === link.id)),
        items: this.mergedItems().filter((item) => nodes.some((node) => node.source_item_id === item.id)),
      }
      : undefined;
    return { knowledge_nodes: nodes, knowledge_relations: relations, sources, limit };
  }

  buildPlanHealth(themeId = "") {
    const today = new Date().toISOString().slice(0, 10);
    const items = this.mergedItems().filter((item) => !themeId || item.theme_id === themeId);
    const openItems = items.filter(isOpenItem);
    return {
      open_count: openItems.length,
      overdue_items: openItems.filter((item) => itemDate(item) && itemDate(item) < today),
      waiting_items: openItems.filter((item) => item.status === "waiting" || item.kind === "waiting"),
      unscheduled_items: openItems.filter((item) => !item.planned_start && !item.planned_end && !item.due_date),
    };
  }

  buildKnowledgeHealth(themeId = "") {
    const nodes = this.list("knowledge_node").filter((node) => !themeId || node.theme_id === themeId);
    const relations = this.list("knowledge_relation");
    const activeNodes = nodes.filter((node) => (node.status || "active") === "active");
    const evidenceIds = new Set(activeNodes.filter((node) => node.node_type === "evidence").map((node) => node.id));
    const hasRelation = (node, type) => relations.some((relation) =>
      (relation.source_node_id === node.id || relation.target_node_id === node.id)
      && (!type || relation.relation_type === type));
    const supportsEvidence = (claim) => relations.some((relation) =>
      relation.relation_type === "supports"
      && ((relation.source_node_id === claim.id && evidenceIds.has(relation.target_node_id))
        || (relation.target_node_id === claim.id && evidenceIds.has(relation.source_node_id))));
    return {
      unresolved_questions: activeNodes.filter((node) => node.node_type === "question" && !hasRelation(node, "answers")),
      claims_without_evidence: activeNodes.filter((node) => node.node_type === "claim" && !supportsEvidence(node)),
      contradicted_claims: activeNodes.filter((node) => node.node_type === "claim" && hasRelation(node, "contradicts")),
      evidence_without_source: activeNodes.filter((node) => node.node_type === "evidence" && !node.source_note_id && !node.source_link_id && !node.source_item_id),
      isolated_nodes: activeNodes.filter((node) => !hasRelation(node)),
    };
  }

  toolGetThemeContext(args = {}) {
    const limit = clampLimit(args.limit, 50);
    const textLimit = clampTextLimit(args.max_chars);
    const themes = this.list("theme").filter((theme) => !args.theme_id || theme.id === args.theme_id).slice(0, limit);
    const themeIds = new Set(themes.map((theme) => theme.id));
    return {
      themes,
      open_items: this.mergedItems().filter((item) => themeIds.has(item.theme_id) && isOpenItem(item)).slice(0, limit),
      recent_notes: this.list("note").filter((note) => themeIds.has(note.theme_id)).slice(0, limit).map((note) => withoutRawBody(note, Boolean(args.include_raw_body), textLimit)),
      knowledge: this.toolGetKnowledgeContext({ theme_id: args.theme_id, limit, max_chars: textLimit, include_relations: true }),
      health: {
        plan: this.buildPlanHealth(args.theme_id),
        knowledge: this.buildKnowledgeHealth(args.theme_id),
      },
    };
  }

  toolGetPlanHealth(args = {}) {
    return this.buildPlanHealth(args.theme_id || "");
  }

  toolGetKnowledgeHealth(args = {}) {
    return this.buildKnowledgeHealth(args.theme_id || "");
  }

  toolExportAiContext(args = {}) {
    const format = args.format === "json" ? "json" : "markdown";
    const scope = args.scope || "recent";
    const maxItems = clampLimit(args.max_items, 40);
    const maxNotes = clampLimit(args.max_notes, 20);
    const maxKnowledgeNodes = clampLimit(args.max_knowledge_nodes, 50);
    const textLimit = clampTextLimit(args.max_chars);
    const themeId = args.theme_id || "";
    const themes = this.list("theme").filter((theme) => !themeId || theme.id === themeId);
    const themeIds = new Set(themes.map((theme) => theme.id));
    const allItems = this.mergedItems().filter((item) => !themeId || item.theme_id === themeId);
    const items = (scope === "open_items" ? allItems.filter(isOpenItem) : allItems).slice(0, maxItems);
    const notes = this.list("note")
      .filter((note) => !themeId || themeIds.has(note.theme_id))
      .slice(0, maxNotes)
      .map((note) => withoutRawBody(note, Boolean(args.include_raw_body), textLimit));
    const links = this.list("link").filter((link) => !themeId || themeIds.has(link.theme_id)).slice(0, maxItems);
    const knowledge = this.toolGetKnowledgeContext({
      theme_id: themeId,
      limit: maxKnowledgeNodes,
      max_chars: textLimit,
      include_relations: true,
      include_sources: false,
    });
    const pack = {
      generated_at: new Date().toISOString(),
      scope,
      themes,
      items,
      notes,
      links,
      knowledge_nodes: knowledge.knowledge_nodes,
      knowledge_relations: knowledge.knowledge_relations,
      health: {
        ...this.buildPlanHealth(themeId),
        ...this.buildKnowledgeHealth(themeId),
      },
    };
    if (format === "json") return pack;
    return renderContextMarkdown(pack);
  }
}

function renderContextMarkdown(pack) {
  const lines = [
    "# Tasken Context",
    "",
    "## Theme",
    ...(pack.themes.length ? pack.themes.map((theme) => `- ${theme.name}: ${theme.description || ""}`) : ["- なし"]),
    "",
    "## Current Open Items",
    ...(pack.items.length ? pack.items.map((item) => `- ${itemDate(item) || "予定なし"} / ${item.status || "todo"}: ${item.title}`) : ["- なし"]),
    "",
    "## Recent Notes",
    ...(pack.notes.length ? pack.notes.map((note) => `- ${note.title}: ${note.body_excerpt || ""}`) : ["- なし"]),
    "",
    "## Questions",
    ...nodeLines(pack.knowledge_nodes, "question"),
    "",
    "## Claims",
    ...nodeLines(pack.knowledge_nodes, "claim"),
    "",
    "## Evidence",
    ...nodeLines(pack.knowledge_nodes, "evidence"),
    "",
    "## Decisions",
    ...nodeLines(pack.knowledge_nodes, "decision"),
    "",
    "## Risks / Contradictions",
    ...(pack.health.contradicted_claims.length ? pack.health.contradicted_claims.map((node) => `- ${node.title}`) : ["- なし"]),
    "",
    "## Suggested Next Actions",
    ...(pack.health.unresolved_questions.length ? pack.health.unresolved_questions.map((node) => `- Questionを処理: ${node.title}`) : ["- なし"]),
  ];
  return lines.join("\n");
}

function nodeLines(nodes, nodeType) {
  const scoped = nodes.filter((node) => node.node_type === nodeType);
  return scoped.length ? scoped.map((node) => `- ${node.title}${node.body ? `: ${node.body}` : ""}`) : ["- なし"];
}
