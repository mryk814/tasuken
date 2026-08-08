import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_AI_VISIBILITY,
  normalizeAiVisibility,
  projectEntityForAi,
  summarizeAiExclusions,
} from "../../shared/aiMetadata.mjs";
import { buildKnowledgeHealth, groupKnowledgeHealthIssues } from "../../shared/knowledgeHealth.mjs";
import { collectionKeyForEntityType, entityTypes } from "../../shared/entityRegistry.mjs";
import { contextGraphMcpShape, getContextSubgraph, projectContextGraph } from "../../shared/contextGraph.mjs";

const DEFAULT_LIMIT = 20;
/** MCPは同一端末のCoding Agent向け経路。M365・外部AIは明示許可が要る（#294）。 */
const DEFAULT_AUDIENCE = "coding_agent";
/** mergedItemsのkindから、公開範囲を判定する実体の種別へ戻す。 */
const ITEM_KIND_ENTITY_TYPES = {
  task: "task",
  waiting: "waiting",
  milestone: "plan_node",
  period: "plan_node",
};
/** AI共通metadataは投影後も判定に使うため、legacy item形へ持ち回る。 */
const AI_METADATA_KEYS = [
  "ai_summary",
  "ai_summary_authority",
  "ai_freshness",
  "ai_authority",
  "ai_visibility",
  "ai_last_verified_at",
  "ai_superseded_by",
  "ai_source_refs",
];

function pickAiMetadata(entity) {
  const picked = {};
  for (const key of AI_METADATA_KEYS) {
    if (entity[key] !== undefined) picked[key] = entity[key];
  }
  return picked;
}
const MAX_LIMIT = 100;
const DEFAULT_TEXT_LIMIT = 1200;
const MAX_TEXT_LIMIT = 8000;
const OPEN_ITEM_STATUSES = new Set(["todo", "doing", "waiting", "review", "inbox"]);
const ENTITY_TYPES = entityTypes;

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
    this.audience = options.audience || DEFAULT_AUDIENCE;
    this.aiVisibilityDefault = normalizeAiVisibility(options.aiVisibilityDefault) || null;
    if (!this.workspace) {
      this.db = new Database(dbPath, { readonly: true, fileMustExist: true });
      this.db.pragma("query_only = ON");
    }
  }

  close() {
    this.db?.close();
  }

  /** Entity・Themeが未設定のときに使うworkspace既定（#294）。 */
  workspaceVisibilityDefault() {
    if (this.aiVisibilityDefault) return this.aiVisibilityDefault;
    if (!this.db) {
      this.aiVisibilityDefault = [...DEFAULT_AI_VISIBILITY];
      return this.aiVisibilityDefault;
    }
    const row = this.db.prepare("SELECT value FROM workspace_meta WHERE key = 'ai_visibility_default'").get();
    try {
      this.aiVisibilityDefault = row ? (normalizeAiVisibility(JSON.parse(row.value)) || []) : [...DEFAULT_AI_VISIBILITY];
    } catch {
      this.aiVisibilityDefault = [...DEFAULT_AI_VISIBILITY];
    }
    return this.aiVisibilityDefault;
  }

  themeById(themeId) {
    if (!themeId) return null;
    if (!this.themeCache) {
      this.themeCache = new Map(this.list("theme", true).map((theme) => [theme.id, theme]));
    }
    return this.themeCache.get(themeId) || null;
  }

  /**
   * AI公開範囲で絞り込み、通ったrecordにだけ共通headerを付ける。
   * 通らなかったrecordは本文・headerとも返さず、件数と理由だけを返す。
   */
  filterForAi(type, records) {
    const included = [];
    const exclusions = [];
    for (const record of records) {
      const entityType = type === "item" ? (ITEM_KIND_ENTITY_TYPES[record.kind] || "item") : type;
      const themeId = record.theme_id || record.project_id || null;
      // Theme自身は自分のdefault_ai_visibilityを継承元にする。
      const theme = type === "theme" ? record : this.themeById(themeId);
      const result = projectEntityForAi(entityType, record, {
        audience: this.audience,
        theme,
        workspaceDefault: this.workspaceVisibilityDefault(),
      });
      if (!result.included) {
        exclusions.push(result.exclusion);
        continue;
      }
      included.push({ ...record, ai: result.header });
    }
    return { records: included, exclusions };
  }

  list(type, includeArchived = false) {
    if (this.workspace) {
      const records = this.workspace[collectionKeyForEntityType(type)] || [];
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
    for (const type of ENTITY_TYPES) workspace[collectionKeyForEntityType(type)] = this.list(type, includeArchived);
    return workspace;
  }

  mergedItems(includeArchived = false) {
    const legacyItems = this.list("item", includeArchived);
    const tasks = this.list("task", includeArchived);
    const waitings = this.list("waiting", includeArchived);
    const planNodes = this.list("plan_node", includeArchived);
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
        source: t.source,
        ...pickAiMetadata(t),
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
        source: w.source,
        ...pickAiMetadata(w),
      });
    }
    for (const p of planNodes) {
      if (p.legacy_item_id) v2Ids.add(p.legacy_item_id);
      const s = scheduleMap.get(`plan_node:${p.id}`);
      projected.push({
        id: p.legacy_item_id || p.id,
        title: p.title,
        kind: p.type === "milestone" ? "milestone" : "period",
        status: p.state === "done" ? "done" : p.state === "cancelled" ? "cancelled" : "todo",
        priority: "normal",
        theme_id: p.project_id || null,
        description: p.description || "",
        planned_start: s?.start_date || null,
        planned_end: s?.end_date || null,
        due_date: null,
        source_record_id: p.source_record_id,
        created_at: p.created_at,
        updated_at: p.updated_at,
        deleted_at: p.deleted_at,
        source: p.source,
        ...pickAiMetadata(p),
      });
    }
    const deduped = legacyItems.filter((item) => !v2Ids.has(item.id));
    return sortUpdated([...deduped, ...projected]);
  }

  toolSearchItems(args = {}) {
    const limit = clampLimit(args.limit);
    // 公開範囲の判定を件数制限より先に行う。除外分でlimitを消費させない。
    const filtered = this.filterForAi("item", this.mergedItems(Boolean(args.include_archived))
      .filter((item) => matchQuery(item, ["title", "description", "next_action", "waiting_for"], args.query))
      .filter((item) => !args.theme_id || item.theme_id === args.theme_id));
    return {
      items: filtered.records.slice(0, limit),
      limit,
      ai_audience: this.audience,
      ...summarizeAiExclusions(filtered.exclusions),
    };
  }

  toolListOpenItems(args = {}) {
    const limit = clampLimit(args.limit);
    const filtered = this.filterForAi("item", this.mergedItems(Boolean(args.include_archived))
      .filter(isOpenItem)
      .filter((item) => !args.theme_id || item.theme_id === args.theme_id)
      .sort((a, b) => (itemDate(a) || "9999-12-31").localeCompare(itemDate(b) || "9999-12-31")));
    return {
      items: filtered.records.slice(0, limit),
      limit,
      ai_audience: this.audience,
      ...summarizeAiExclusions(filtered.exclusions),
    };
  }

  toolGetRecentNotes(args = {}) {
    const limit = clampLimit(args.limit);
    const textLimit = clampTextLimit(args.max_chars);
    const filtered = this.filterForAi("note", this.list("note", Boolean(args.include_archived))
      .filter((note) => !args.theme_id || note.theme_id === args.theme_id));
    const notes = filtered.records
      .slice(0, limit)
      .map((note) => withoutRawBody(note, Boolean(args.include_raw_body), textLimit));
    return {
      notes,
      limit,
      include_raw_body: Boolean(args.include_raw_body),
      ai_audience: this.audience,
      ...summarizeAiExclusions(filtered.exclusions),
    };
  }

  toolSearchKnowledge(args = {}) {
    const limit = clampLimit(args.limit);
    const nodeTypes = Array.isArray(args.node_types) ? new Set(args.node_types) : null;
    const filtered = this.filterForAi("knowledge_node", this.list("knowledge_node", Boolean(args.include_archived))
      .filter((node) => matchQuery(node, ["title", "body", "node_type"], args.query))
      .filter((node) => !args.theme_id || node.theme_id === args.theme_id)
      .filter((node) => !nodeTypes || nodeTypes.has(node.node_type)));
    const nodes = filtered.records
      .slice(0, limit)
      .map((node) => ({ ...node, body: truncate(node.body, clampTextLimit(args.max_chars)) }));
    return {
      knowledge_nodes: nodes,
      limit,
      ai_audience: this.audience,
      ...summarizeAiExclusions(filtered.exclusions),
    };
  }

  toolGetKnowledgeContext(args = {}) {
    const limit = clampLimit(args.limit, 50);
    const textLimit = clampTextLimit(args.max_chars);
    const filteredNodes = this.filterForAi("knowledge_node", this.list("knowledge_node", Boolean(args.include_archived))
      .filter((node) => !args.theme_id || node.theme_id === args.theme_id));
    const nodes = filteredNodes.records
      .slice(0, limit)
      .map((node) => ({ ...node, body: truncate(node.body, textLimit) }));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const relations = Boolean(args.include_relations ?? true)
      ? this.list("knowledge_edge", Boolean(args.include_archived))
        .filter((relation) => nodeIds.has(relation.source_node_id) || nodeIds.has(relation.target_node_id))
      : [];
    const sourceExclusions = [];
    const sources = Boolean(args.include_sources)
      ? (() => {
        const legacyLinks = this.list("link");
        const resources = this.list("resource");
        const filteredNotes = this.filterForAi("note", this.list("note").filter((note) => nodes.some((node) => node.source_note_id === note.id || (node.source_type === "note" && node.source_id === note.id))));
        sourceExclusions.push(...filteredNotes.exclusions);
        const matchedNotes = filteredNotes.records.map((note) => withoutRawBody(note, Boolean(args.include_raw_body), textLimit));
        const matchedLegacyLinks = legacyLinks.filter((link) => nodes.some((node) => node.source_link_id === link.id));
        const matchedResources = resources.filter((r) => nodes.some((node) => (node.source_type === "resource" && node.source_id === r.id)));
        const resourceIds = new Set(matchedResources.map((r) => r.id));
        const filteredResources = this.filterForAi("resource", [...matchedResources, ...matchedLegacyLinks.filter((l) => !resourceIds.has(l.id))]);
        sourceExclusions.push(...filteredResources.exclusions);
        const filteredItems = this.filterForAi("item", this.mergedItems().filter((item) => nodes.some((node) => node.source_item_id === item.id || (node.source_type === "task" && node.source_id === item.id) || (node.source_type === "waiting" && node.source_id === item.id) || (node.source_type === "plan_node" && node.source_id === item.id))));
        sourceExclusions.push(...filteredItems.exclusions);
        return { notes: matchedNotes, resources: filteredResources.records, items: filteredItems.records };
      })()
      : undefined;
    return {
      knowledge_nodes: nodes,
      knowledge_edges: relations,
      sources,
      limit,
      ai_audience: this.audience,
      ...summarizeAiExclusions([...filteredNodes.exclusions, ...sourceExclusions]),
    };
  }

  buildPlanHealth(themeId = "") {
    const today = new Date().toISOString().slice(0, 10);
    // healthもタイトルを返すため、一覧と同じ公開範囲判定を通す（#294）。
    const tasks = this.filterForAi("task", this.list("task").filter((t) => !themeId || t.project_id === themeId)).records;
    const waitings = this.filterForAi("waiting", this.list("waiting").filter((w) => !themeId || w.project_id === themeId)).records;
    const planNodes = this.filterForAi("plan_node", this.list("plan_node").filter((p) => !themeId || p.project_id === themeId)).records;
    const schedules = this.list("schedule");
    const scheduleMap = new Map();
    for (const s of schedules) scheduleMap.set(`${s.owner_type}:${s.owner_id}`, s);
    const endDate = (ownerType, ownerId) => {
      const s = scheduleMap.get(`${ownerType}:${ownerId}`);
      return s?.end_date || s?.start_date || "";
    };
    const openTasks = tasks.filter((t) => t.state !== "done" && t.state !== "cancelled");
    const openWaitings = waitings.filter((w) => w.state === "waiting");
    const openPlanNodes = planNodes.filter((p) => p.state !== "done" && p.state !== "cancelled");
    const overdue = [
      ...openTasks.filter((t) => { const d = endDate("task", t.id); return d && d < today; }).map((t) => ({ id: t.id, title: t.title, kind: "task", date: endDate("task", t.id), theme_id: t.project_id })),
      ...openWaitings.filter((w) => { const d = endDate("waiting", w.id); return d && d < today; }).map((w) => ({ id: w.id, title: w.title, kind: "waiting", date: endDate("waiting", w.id), theme_id: w.project_id })),
      ...openPlanNodes.filter((p) => { const d = endDate("plan_node", p.id); return d && d < today; }).map((p) => ({ id: p.id, title: p.title, kind: p.type, date: endDate("plan_node", p.id), theme_id: p.project_id })),
    ];
    const unscheduled = [
      ...openTasks.filter((t) => !scheduleMap.has(`task:${t.id}`)).map((t) => ({ id: t.id, title: t.title, kind: "task", theme_id: t.project_id })),
      ...openPlanNodes.filter((p) => !scheduleMap.has(`plan_node:${p.id}`)).map((p) => ({ id: p.id, title: p.title, kind: p.type, theme_id: p.project_id })),
    ];
    return {
      open_tasks: openTasks.length,
      open_waitings: openWaitings.length,
      open_plan_nodes: openPlanNodes.length,
      open_count: openTasks.length + openWaitings.length + openPlanNodes.length,
      overdue_items: overdue,
      waiting_items: openWaitings.map((w) => ({ id: w.id, title: w.title, waiting_for: w.waiting_for, date: endDate("waiting", w.id), theme_id: w.project_id })),
      unscheduled_items: unscheduled,
    };
  }

  buildKnowledgeHealth(themeId = "") {
    const nodes = this.filterForAi("knowledge_node", this.list("knowledge_node").filter((node) => !themeId || node.theme_id === themeId)).records;
    const relations = this.list("knowledge_edge");
    const entities = [
      ...this.filterForAi("task", this.list("task")).records,
      ...this.filterForAi("waiting", this.list("waiting")).records,
      ...this.filterForAi("plan_node", this.list("plan_node")).records,
      ...this.filterForAi("item", this.list("item")).records,
    ];
    return groupKnowledgeHealthIssues(buildKnowledgeHealth(nodes, relations, entities));
  }

  toolGetThemeContext(args = {}) {
    const limit = clampLimit(args.limit, 50);
    const textLimit = clampTextLimit(args.max_chars);
    const filteredThemes = this.filterForAi("theme", this.list("theme").filter((theme) => !args.theme_id || theme.id === args.theme_id));
    const themes = filteredThemes.records.slice(0, limit);
    const themeIds = new Set(themes.map((theme) => theme.id));
    const filteredItems = this.filterForAi("item", this.mergedItems().filter((item) => themeIds.has(item.theme_id) && isOpenItem(item)));
    const filteredNotes = this.filterForAi("note", this.list("note").filter((note) => themeIds.has(note.theme_id)));
    const knowledge = this.toolGetKnowledgeContext({ theme_id: args.theme_id, limit, max_chars: textLimit, include_relations: true });
    return {
      themes,
      open_items: filteredItems.records.slice(0, limit),
      recent_notes: filteredNotes.records.slice(0, limit).map((note) => withoutRawBody(note, Boolean(args.include_raw_body), textLimit)),
      knowledge,
      health: {
        plan: this.buildPlanHealth(args.theme_id),
        knowledge: this.buildKnowledgeHealth(args.theme_id),
      },
      ai_audience: this.audience,
      ...summarizeAiExclusions([
        ...filteredThemes.exclusions,
        ...filteredItems.exclusions,
        ...filteredNotes.exclusions,
      ]),
    };
  }

  toolGetPlanHealth(args = {}) {
    return this.buildPlanHealth(args.theme_id || "");
  }

  toolGetKnowledgeHealth(args = {}) {
    return this.buildKnowledgeHealth(args.theme_id || "");
  }

  /**
   * 正本SQLiteを変更せず、既存collectionから再構築できるbounded relation projection。
   * 本文は返さず、AI公開範囲は既存#294ポリシーで先に絞る。
   */
  toolGetContextSubgraph(args = {}) {
    const type = text(args.entity_type || args.type);
    const id = text(args.entity_id || args.id);
    const graph = projectContextGraph(this.loadWorkspace(Boolean(args.include_archived)));
    const allowed = new Set();
    for (const entityType of ENTITY_TYPES) {
      const records = this.filterForAi(entityType, this.list(entityType, Boolean(args.include_archived))).records;
      for (const record of records) allowed.add(JSON.stringify([entityType, record.id]));
    }
    const seedAllowed = allowed.has(JSON.stringify([type, id]));
    if (!seedAllowed) {
      return {
        seed: { type, id },
        nodes: [],
        edges: [],
        paths: [],
        limits: { max_hops: Math.min(2, Number(args.max_hops) || 2), max_nodes: Number(args.max_nodes) || 24, max_edges: Number(args.max_edges) || 48, token_budget: Number(args.token_budget) || 2400 },
        estimated_tokens: 0,
        truncated: false,
        exclusions: ["seed_not_allowed"],
        ai_audience: this.audience,
        read_only: true,
      };
    }
    const result = getContextSubgraph(graph, { type, id }, {
      maxHops: args.max_hops,
      maxNodes: args.max_nodes,
      maxEdges: args.max_edges,
      tokenBudget: args.token_budget,
      includeSuggested: Boolean(args.include_suggested),
      nodeFilter: (node) => allowed.has(JSON.stringify([node.ref.type, node.ref.id])),
    });
    return {
      ...contextGraphMcpShape(result),
      ai_audience: this.audience,
      read_only: true,
    };
  }

  /** OneDrive AI Pack等はm365で、Coding Agentはcoding_agentで同じ関数を呼ぶ（#294 / #295）。 */
  withAudience(audience, run) {
    if (!audience || audience === this.audience) return run();
    const previous = this.audience;
    this.audience = audience;
    try {
      return run();
    } finally {
      this.audience = previous;
    }
  }

  toolExportAiContext(args = {}) {
    if (args.audience && args.audience !== this.audience) {
      return this.withAudience(args.audience, () => this.toolExportAiContext({ ...args, audience: null }));
    }
    const format = args.format === "json" ? "json" : "markdown";
    const scope = args.scope || "recent";
    const maxItems = clampLimit(args.max_items, 40);
    const maxNotes = clampLimit(args.max_notes, 20);
    const maxKnowledgeNodes = clampLimit(args.max_knowledge_nodes, 50);
    const textLimit = clampTextLimit(args.max_chars);
    const themeId = args.theme_id || "";
    const filteredThemes = this.filterForAi("theme", this.list("theme").filter((theme) => !themeId || theme.id === themeId));
    const themes = filteredThemes.records;
    const themeIds = new Set(themes.map((theme) => theme.id));
    const allItems = this.mergedItems().filter((item) => !themeId || item.theme_id === themeId);
    const filteredItems = this.filterForAi("item", scope === "open_items" ? allItems.filter(isOpenItem) : allItems);
    const items = filteredItems.records.slice(0, maxItems);
    const filteredNotes = this.filterForAi("note", this.list("note").filter((note) => !themeId || themeIds.has(note.theme_id)));
    const notes = filteredNotes.records
      .slice(0, maxNotes)
      .map((note) => withoutRawBody(note, Boolean(args.include_raw_body), textLimit));
    const legacyLinks = this.list("link").filter((link) => !themeId || themeIds.has(link.theme_id));
    const resources = this.list("resource").filter((r) => !themeId || themeIds.has(r.project_id));
    const resourceIds = new Set(resources.map((r) => r.id));
    const filteredResources = this.filterForAi("resource", [...resources, ...legacyLinks.filter((l) => !resourceIds.has(l.id))]);
    const mergedResources = filteredResources.records.slice(0, maxItems);
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
      ai_audience: this.audience,
      themes,
      items,
      notes,
      resources: mergedResources,
      knowledge_nodes: knowledge.knowledge_nodes,
      knowledge_edges: knowledge.knowledge_edges,
      health: {
        ...this.buildPlanHealth(themeId),
        ...this.buildKnowledgeHealth(themeId),
      },
      ...summarizeAiExclusions([
        ...filteredThemes.exclusions,
        ...filteredItems.exclusions,
        ...filteredNotes.exclusions,
        ...filteredResources.exclusions,
      ]),
    };
    if (format === "json") return pack;
    return renderContextMarkdown(pack);
  }
}

/** 鮮度・根拠を本文の横へ短く添える。stale / supersededやAI生成を黙って混ぜない（#294）。 */
function aiMark(record) {
  const header = record?.ai;
  if (!header) return "";
  const marks = [];
  if (header.freshness === "stale") marks.push("要再確認");
  if (header.freshness === "superseded") marks.push("置き換え済み");
  if (header.freshness === "unknown") marks.push("鮮度不明");
  if (header.authority === "ai_generated") marks.push("AI生成");
  if (header.authority === "inferred") marks.push("推定");
  if (header.authority === "imported") marks.push("取り込み");
  if (header.authority === "user_confirmed") marks.push("確認済み");
  return marks.length ? ` [${marks.join(" / ")}]` : "";
}

function exclusionLines(pack) {
  if (!pack.excluded_count) return ["- 除外なし"];
  return pack.excluded_reasons.map((entry) => `- ${entry.type}: ${entry.reason}（${entry.count}件）`);
}

function renderContextMarkdown(pack) {
  const lines = [
    "# Tasken Context",
    "",
    `> 公開先: ${pack.ai_audience} / 除外: ${pack.excluded_count || 0}件`,
    "",
    "## Theme",
    ...(pack.themes.length ? pack.themes.map((theme) => `- ${theme.name}: ${theme.description || ""}${aiMark(theme)}`) : ["- なし"]),
    "",
    "## Current Open Items",
    ...(pack.items.length ? pack.items.map((item) => `- ${itemDate(item) || "予定なし"} / ${item.status || "todo"}: ${item.title}${aiMark(item)}`) : ["- なし"]),
    "",
    "## Recent Notes",
    ...(pack.notes.length ? pack.notes.map((note) => `- ${note.title}: ${note.body_excerpt || ""}${aiMark(note)}`) : ["- なし"]),
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
    "",
    "## AI公開範囲で除外した情報",
    ...exclusionLines(pack),
  ];
  return lines.join("\n");
}

function nodeLines(nodes, nodeType) {
  const scoped = nodes.filter((node) => node.node_type === nodeType);
  return scoped.length ? scoped.map((node) => `- ${node.title}${node.body ? `: ${node.body}` : ""}${aiMark(node)}`) : ["- なし"];
}
