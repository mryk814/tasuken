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
import { projectActivityJson, projectActivityMarkdown, queryActivityEvents } from "../../shared/activityProjection.mjs";
import { buildActivityRootRegistry, publicActivityRootStatus } from "../../shared/activityRootRegistry.mjs";
import {
  findTasksForRepository,
  findThemesForRepository,
  publicRepositoryContext,
  resolveRepositoryContext,
  resolveTaskRepositoryContexts,
  resolveThemeRepositoryContexts,
} from "../../shared/repositoryContext.mjs";
import {
  boundedList,
  normalizeTaskContextInclude,
  publicArtifactMetadata,
  publicAssignmentForContext,
  publicConversationSummary,
  publicNoteSummary,
  publicReceiptForContext,
  publicResourceSummary,
  publicTaskForContext,
  publicThemeForContext,
  relationForNode,
  safeExternalUrl,
  taskContextLimits,
  TaskContextTextBudget,
  workspaceIdentityProvided,
} from "./taskContext.mjs";

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

function repositoryCurrentFromArgs(args = {}) {
  return {
    repository_id: args.repository_id || args.repositoryId || args.repository_context_id,
    provider: args.provider,
    remote_url: args.remote_url,
    remote_urls: args.remote_urls,
    repository_slug: args.repository_slug || args.repositorySlug,
    git_root: args.git_root || args.gitRoot,
    cwd: args.cwd || args.working_directory,
    workspace_folder: args.workspace_folder || args.workspaceFolder,
  };
}

function repositoryCurrentFromWorkspace(workspace = {}) {
  return repositoryCurrentFromArgs({
    ...workspace,
    remote_urls: workspace.remote_urls || workspace.remotes,
    workspace_folder: workspace.workspace_folder || workspace.workspaceFolder || workspace.cwd,
  });
}

function structuredReadError(code, message, details = {}) {
  return { error: { code, message, ...details }, read_only: true };
}

function publicRepositoryMatch(match) {
  return {
    ...match,
    selected: publicRepositoryContext(match.selected),
    candidates: (match.candidates || []).map((candidate) => ({
      ...candidate,
      context: publicRepositoryContext(candidate.context),
    })),
  };
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
    workspace.canonical_root_status = this.canonicalRootStatus();
    return workspace;
  }

  canonicalRootStatus() {
    if (this.workspace?.canonical_root_status) return this.workspace.canonical_root_status;
    let artifactDirectory = "";
    if (this.db) {
      artifactDirectory = this.db.prepare("SELECT value FROM workspace_meta WHERE key = 'artifact_directory'").get()?.value || "";
    }
    const registry = buildActivityRootRegistry({
      artifactDirectory,
      themes: this.list("theme", true),
    });
    return publicActivityRootStatus(registry, (root) => fs.existsSync(root));
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

  toolListAgentReadyTasks(args = {}) {
    const limit = clampLimit(args.limit);
    const candidates = this.list("task", Boolean(args.include_archived))
      .filter((task) => task.intended_executor === "ai_agent")
      .filter((task) => (task.work_state || "ready_for_agent") === "ready_for_agent")
      .filter((task) => task.state !== "done" && task.state !== "cancelled")
      .filter((task) => !args.theme_id || task.project_id === args.theme_id);
    const filtered = this.filterForAi("task", candidates);
    return {
      tasks: filtered.records.slice(0, limit),
      limit,
      ai_audience: this.audience,
      read_only: true,
      ...summarizeAiExclusions(filtered.exclusions),
    };
  }

  toolGetTaskAssignment(args = {}) {
    const taskId = text(args.task_id || args.id);
    const task = this.list("task", Boolean(args.include_archived)).find((candidate) => candidate.id === taskId);
    if (!task) return { task: null, receipts: [], task_id: taskId, read_only: true, ai_audience: this.audience };
    const filtered = this.filterForAi("task", [task]);
    if (!filtered.records.length) {
      return { task: null, receipts: [], task_id: taskId, read_only: true, ai_audience: this.audience, ...summarizeAiExclusions(filtered.exclusions) };
    }
    const receipts = this.list("work_receipt", Boolean(args.include_archived))
      .filter((receipt) => receipt.task_id === taskId)
      .slice(0, clampLimit(args.limit, 50));
    const theme = this.themeById(task.project_id || task.theme_id);
    const repositoryResolution = resolveTaskRepositoryContexts({
      task,
      theme,
      contexts: this.visibleRepositoryContexts(Boolean(args.include_archived)),
    });
    return {
      task: filtered.records[0],
      receipts,
      repository_contexts: repositoryResolution.contexts.map(publicRepositoryContext),
      repository_context_resolution: {
        mode: repositoryResolution.mode,
        context_ids: repositoryResolution.contextIds,
        missing_context_ids: repositoryResolution.missingContextIds,
        missing_context_reasons: repositoryResolution.missingContextReasons,
        subdirectory: repositoryResolution.subdirectory,
        branch_hint: repositoryResolution.branchHint,
      },
      task_id: taskId,
      read_only: true,
      ai_audience: this.audience,
      ...summarizeAiExclusions(filtered.exclusions),
    };
  }

  toolGetTaskContext(args = {}) {
    const taskId = text(args.task_id || args.taskId || args.id).trim();
    const include = normalizeTaskContextInclude(args.include);
    const includeSet = new Set(include);
    const limits = taskContextLimits(args);
    const budget = new TaskContextTextBudget(limits.maxTextLength);
    const includeArchived = Boolean(args.include_archived);
    const task = this.list("task", includeArchived).find((candidate) => String(candidate.id) === taskId);
    if (!task) {
      return {
        ...structuredReadError("not_found", "Taskが見つかりません。Task IDを確認してください。", { task_id: taskId }),
        ai_audience: this.audience,
      };
    }
    if (!task.id || !task.title || !task.state) {
      return {
        ...structuredReadError("unsupported_schema", "Taskの保存形式をこのMCP Bridgeで解釈できません。Taskenを更新してください。", { task_id: taskId }),
        ai_audience: this.audience,
      };
    }
    const filteredTask = this.filterForAi("task", [task]);
    if (!filteredTask.records.length) {
      return {
        ...structuredReadError("not_found", "Taskが見つかりません。Task IDまたはAI公開範囲を確認してください。", { task_id: taskId }),
        ai_audience: this.audience,
        ...summarizeAiExclusions(filteredTask.exclusions),
      };
    }

    const warnings = [];
    const truncation = {};
    const themeId = task.project_id || task.theme_id || null;
    const themeCandidate = themeId ? this.themeById(themeId) : null;
    const filteredTheme = themeCandidate ? this.filterForAi("theme", [themeCandidate]).records[0] || null : null;
    if (themeCandidate && !filteredTheme) warnings.push({ code: "theme_not_visible", message: "TaskのThemeはAI公開範囲外のため含めていません。" });
    // Task依頼とassignmentを最優先でbudgetへ確保し、その後に関連情報を詰める。
    const taskOutput = publicTaskForContext(filteredTask.records[0], budget);
    const assignmentOutput = publicAssignmentForContext(task, budget);
    const themeOutput = includeSet.has("theme") ? publicThemeForContext(filteredTheme, budget) : null;

    const repositoryResolution = resolveTaskRepositoryContexts({
      task,
      theme: themeCandidate,
      contexts: this.visibleRepositoryContexts(includeArchived),
    });
    const taskRepositoryContexts = repositoryResolution.contexts;
    let repositoryMatch = {
      status: "unknown",
      reason_code: "workspace_not_provided",
      reason: "現在のcoding workspace情報が指定されていません。",
      selected: null,
      candidates: [],
    };
    if (workspaceIdentityProvided(args.workspace)) {
      const match = resolveRepositoryContext({
        current: repositoryCurrentFromWorkspace(args.workspace),
        contexts: taskRepositoryContexts,
      });
      repositoryMatch = publicRepositoryMatch(match);
      if (match.status === "unknown" && taskRepositoryContexts.length) {
        repositoryMatch.status = "mismatch";
        repositoryMatch.reason_code = "task_repository_mismatch";
        repositoryMatch.reason = "現在のcoding workspaceはTaskのRepositoryContextと一致しません。作業対象を確認してください。";
        warnings.push({ code: "repository_mismatch", message: repositoryMatch.reason });
      } else if (match.status === "ambiguous") {
        warnings.push({ code: "repository_ambiguous", message: match.reason });
      }
    }

    const related = {
      notes: [],
      conversations: [],
      artifacts: [],
      resources: [],
      activity: [],
      work_receipts: [],
    };
    const graphTypes = new Set(["task", "note", "resource", "artifact"]);
    const visibleRecords = new Map();
    const allowed = new Set();
    for (const entityType of graphTypes) {
      const filtered = this.filterForAi(entityType, this.list(entityType, includeArchived));
      visibleRecords.set(entityType, filtered.records);
      for (const record of filtered.records) allowed.add(JSON.stringify([entityType, record.id]));
    }
    const graph = projectContextGraph(this.loadWorkspace(includeArchived));
    const subgraph = getContextSubgraph(graph, { type: "task", id: taskId }, {
      maxHops: 2,
      // 出力はentity種別ごとに別々にbounded化する。graph側を同じ件数へ
      // 絞ると、先に並んだNoteだけで枠を使い切りArtifact等が欠落する。
      maxNodes: Math.min(100, limits.maxItemsPerType * 8 + 8),
      maxEdges: Math.min(200, limits.maxItemsPerType * 16 + 16),
      tokenBudget: 12_000,
      includeSuggested: false,
      nodeFilter: (node) => allowed.has(JSON.stringify([node.ref.type, node.ref.id])),
      // Themeだけが共通というEntityをTask文脈へ一括で混ぜない。
      edgeFilter: (edge) => edge.predicate !== "belongs_to_theme",
    });
    if (subgraph.truncated) {
      warnings.push({ code: "relation_graph_truncated", message: "関連情報のbounded traversalが上限に達しました。locatorから必要な本文を追加取得してください。" });
    }
    const relatedIds = new Map();
    for (const node of subgraph.nodes) {
      if (node.type === "task" && node.id === taskId) continue;
      const ids = relatedIds.get(node.type) || new Set();
      ids.add(String(node.id));
      relatedIds.set(node.type, ids);
    }
    const relation = (type, id) => relationForNode(subgraph, type, String(id));

    if (includeSet.has("notes")) {
      const records = sortUpdated((visibleRecords.get("note") || []).filter((note) => relatedIds.get("note")?.has(String(note.id))));
      const bounded = boundedList(records, limits.maxItemsPerType);
      related.notes = bounded.selected.map((note) => publicNoteSummary(note, budget, relation("note", note.id)));
      if (bounded.truncation) truncation.notes = bounded.truncation;
    }
    const resources = sortUpdated((visibleRecords.get("resource") || []).filter((resource) => relatedIds.get("resource")?.has(String(resource.id))));
    if (includeSet.has("conversations")) {
      const bounded = boundedList(resources.filter((resource) => resource.resource_scope === "chat_ref"), limits.maxItemsPerType);
      related.conversations = bounded.selected.map((resource) => publicConversationSummary(resource, budget, relation("resource", resource.id)));
      if (bounded.truncation) truncation.conversations = bounded.truncation;
    }
    if (includeSet.has("resources")) {
      const bounded = boundedList(resources.filter((resource) => resource.resource_scope !== "chat_ref"), limits.maxItemsPerType);
      related.resources = bounded.selected.map((resource) => publicResourceSummary(resource, budget, relation("resource", resource.id)));
      if (bounded.truncation) truncation.resources = bounded.truncation;
    }
    if (includeSet.has("artifacts")) {
      const records = sortUpdated((visibleRecords.get("artifact") || []).filter((artifact) => relatedIds.get("artifact")?.has(String(artifact.id))));
      const bounded = boundedList(records, limits.maxItemsPerType);
      related.artifacts = bounded.selected.map((artifact) => publicArtifactMetadata(artifact, budget, relation("artifact", artifact.id)));
      if (bounded.truncation) truncation.artifacts = bounded.truncation;
    }
    if (includeSet.has("work_receipts")) {
      const records = this.list("work_receipt", includeArchived).filter((receipt) => receipt.task_id === taskId);
      const bounded = boundedList(records, limits.maxItemsPerType);
      related.work_receipts = bounded.selected.map((receipt) => publicReceiptForContext(receipt, budget));
      if (bounded.truncation) truncation.work_receipts = bounded.truncation;
    }
    if (includeSet.has("activity")) {
      const activity = this.toolGetActivity({ entity_type: "task", entity_id: taskId, limit: 100, include_archived: includeArchived, format: "json" });
      const records = [...(activity.events || [])].sort((left, right) => String(right.occurred_at).localeCompare(String(left.occurred_at)) || String(right.id).localeCompare(String(left.id)));
      const bounded = boundedList(records, limits.maxItemsPerType);
      related.activity = bounded.selected.map((event) => ({
        id: event.id,
        occurred_at: event.occurred_at,
        event_kind: event.event_kind,
        summary: budget.take(event.summary, 1_000),
        actor: event.actor,
        origin: event.origin,
        work_receipt_ref: event.work_receipt_ref || null,
        included_because: "recent_activity",
      }));
      if (bounded.truncation) truncation.activity = bounded.truncation;
    }
    if (budget.truncated) {
      truncation.text = { reason: "max_text_length", limit: budget.limit, used: budget.used };
      warnings.push({ code: "text_truncated", message: "context本文が文字数上限に達しました。stable locatorから必要な本文だけ取得してください。" });
    }

    return {
      task: taskOutput,
      assignment: assignmentOutput,
      theme: themeOutput,
      repository_contexts: includeSet.has("repository") ? taskRepositoryContexts.map(publicRepositoryContext) : [],
      repository_resolution: includeSet.has("repository") ? {
        mode: repositoryResolution.mode,
        context_ids: repositoryResolution.contextIds,
        missing_context_ids: repositoryResolution.missingContextIds,
        missing_context_reasons: repositoryResolution.missingContextReasons,
        subdirectory: repositoryResolution.subdirectory,
        branch_hint: repositoryResolution.branchHint,
      } : null,
      workspace_match: includeSet.has("repository") ? repositoryMatch : null,
      related,
      include,
      limits: { max_items_per_type: limits.maxItemsPerType, max_text_length: limits.maxTextLength },
      truncation,
      warnings,
      truncated: Boolean(subgraph.truncated || budget.truncated || Object.keys(truncation).length),
      read_only: true,
      ai_audience: this.audience,
      ...summarizeAiExclusions(filteredTask.exclusions),
    };
  }

  toolGetNote(args = {}) {
    const noteId = text(args.note_id || args.id).trim();
    const note = this.list("note", Boolean(args.include_archived)).find((candidate) => String(candidate.id) === noteId);
    const filtered = note ? this.filterForAi("note", [note]) : { records: [], exclusions: [] };
    if (!filtered.records.length) return { ...structuredReadError("not_found", "Noteが見つかりません。IDまたはAI公開範囲を確認してください。", { note_id: noteId }), ai_audience: this.audience };
    const maxTextLength = taskContextLimits(args).maxTextLength;
    const body = text(note.body_markdown);
    const budget = new TaskContextTextBudget(maxTextLength);
    return {
      note: {
        id: note.id,
        title: note.title,
        note_type: note.note_type || "note",
        project_id: note.project_id || note.theme_id || null,
        body_markdown: budget.take(body),
        version: Number(note.version || 0),
        created_at: note.created_at || null,
        updated_at: note.updated_at || null,
      },
      truncated: body.length > maxTextLength,
      limits: { max_text_length: maxTextLength },
      read_only: true,
      ai_audience: this.audience,
    };
  }

  toolGetConversation(args = {}) {
    const conversationId = text(args.conversation_id || args.id).trim();
    const resource = this.list("resource", Boolean(args.include_archived)).find((candidate) => String(candidate.id) === conversationId && candidate.resource_scope === "chat_ref");
    const filtered = resource ? this.filterForAi("resource", [resource]) : { records: [], exclusions: [] };
    if (!filtered.records.length) return { ...structuredReadError("not_found", "Conversationが見つかりません。IDまたはAI公開範囲を確認してください。", { conversation_id: conversationId }), ai_audience: this.audience };
    const maxTextLength = taskContextLimits(args).maxTextLength;
    const body = text(resource.body_markdown);
    const budget = new TaskContextTextBudget(maxTextLength);
    return {
      conversation: {
        id: resource.id,
        title: resource.title,
        description: truncate(resource.description, 2_000),
        source_url: safeExternalUrl(resource.url),
        body_markdown: budget.take(body),
        message_count: resource.message_count || null,
        source_format: resource.source_format || null,
        version: Number(resource.version || 0),
        created_at: resource.created_at || null,
        updated_at: resource.updated_at || null,
      },
      truncated: body.length > maxTextLength,
      limits: { max_text_length: maxTextLength },
      read_only: true,
      ai_audience: this.audience,
    };
  }

  toolGetArtifactMetadata(args = {}) {
    const artifactId = text(args.artifact_id || args.id).trim();
    const artifact = this.list("artifact", Boolean(args.include_archived)).find((candidate) => String(candidate.id) === artifactId);
    const filtered = artifact ? this.filterForAi("artifact", [artifact]) : { records: [], exclusions: [] };
    if (!filtered.records.length) return { ...structuredReadError("not_found", "Artifactが見つかりません。IDまたはAI公開範囲を確認してください。", { artifact_id: artifactId }), ai_audience: this.audience };
    const budget = new TaskContextTextBudget(taskContextLimits(args).maxTextLength);
    return {
      artifact: publicArtifactMetadata(filtered.records[0], budget),
      external_file_content_included: false,
      read_only: true,
      ai_audience: this.audience,
    };
  }

  toolGetActivityEntries(args = {}) {
    const taskId = text(args.task_id || args.id).trim();
    const task = this.list("task", Boolean(args.include_archived)).find((candidate) => String(candidate.id) === taskId);
    const filtered = task ? this.filterForAi("task", [task]) : { records: [], exclusions: [] };
    if (!filtered.records.length) return { ...structuredReadError("not_found", "Taskが見つかりません。IDまたはAI公開範囲を確認してください。", { task_id: taskId }), ai_audience: this.audience };
    const limit = clampLimit(args.limit, 50);
    const activity = this.toolGetActivity({ entity_type: "task", entity_id: taskId, limit: 100, include_archived: Boolean(args.include_archived), format: "json" });
    const events = [...(activity.events || [])].sort((left, right) => String(right.occurred_at).localeCompare(String(left.occurred_at)) || String(right.id).localeCompare(String(left.id)));
    return {
      task_id: taskId,
      events: events.slice(0, limit),
      limit,
      truncated: events.length > limit,
      read_only: true,
      ai_audience: this.audience,
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

  repositoryContexts(includeArchived = false) {
    const contexts = this.list("repository_context", includeArchived);
    return includeArchived ? contexts : contexts.filter((context) => context.active !== false);
  }

  visibleRepositoryContextIds(includeArchived = false) {
    const allContexts = this.repositoryContexts(true);
    const visibleIds = new Set();
    const visibleThemes = this.filterForAi("theme", this.list("theme", includeArchived)).records;
    for (const theme of visibleThemes) {
      for (const id of Array.isArray(theme.repository_context_ids) ? theme.repository_context_ids : []) {
        visibleIds.add(String(id));
      }
    }
    const visibleTasks = this.filterForAi("task", this.list("task", includeArchived)).records;
    for (const task of visibleTasks) {
      const theme = this.themeById(task.project_id || task.theme_id);
      const resolution = resolveTaskRepositoryContexts({ task, theme, contexts: allContexts });
      for (const id of resolution.contextIds) visibleIds.add(String(id));
    }
    return visibleIds;
  }

  visibleRepositoryContexts(includeArchived = false) {
    const visibleIds = this.visibleRepositoryContextIds(includeArchived);
    return this.repositoryContexts(includeArchived).filter((context) => visibleIds.has(String(context.id)));
  }

  toolResolveRepositoryContext(args = {}) {
    const contexts = this.visibleRepositoryContexts(Boolean(args.include_archived));
    const match = resolveRepositoryContext({
      current: repositoryCurrentFromArgs(args),
      contexts,
    });
    return { ...publicRepositoryMatch(match), read_only: true, ai_audience: this.audience, visible_context_count: contexts.length };
  }

  toolFindThemesForRepository(args = {}) {
    const themes = this.filterForAi("theme", this.list("theme", Boolean(args.include_archived))).records;
    const contexts = this.visibleRepositoryContexts(Boolean(args.include_archived));
    const result = findThemesForRepository({ current: repositoryCurrentFromArgs(args), contexts, themes });
    const matchedContextIds = new Set(result.matched_context_ids || []);
    return {
      ...publicRepositoryMatch(result),
      themes: result.themes,
      repository_contexts: contexts
        .filter((context) => matchedContextIds.has(String(context.id)))
        .map(publicRepositoryContext),
      read_only: true,
      ai_audience: this.audience,
    };
  }

  toolFindTasksForRepository(args = {}) {
    const filteredTasks = this.filterForAi("task", this.list("task", Boolean(args.include_archived)));
    const result = findTasksForRepository({
      current: repositoryCurrentFromArgs(args),
      contexts: this.visibleRepositoryContexts(Boolean(args.include_archived)),
      themes: this.list("theme", Boolean(args.include_archived)),
      tasks: filteredTasks.records,
    });
    return {
      ...publicRepositoryMatch(result),
      tasks: result.tasks,
      read_only: true,
      ai_audience: this.audience,
      ...summarizeAiExclusions(filteredTasks.exclusions),
    };
  }

  toolGetRepositoryContext(args = {}) {
    const id = text(args.repository_context_id || args.id);
    const contexts = this.visibleRepositoryContexts(Boolean(args.include_archived));
    const context = contexts.find((candidate) => String(candidate.id) === id);
    if (!context) {
      return {
        repository_context: null,
        repository_context_id: id,
        excluded_reasons: ["repository_context_not_visible"],
        read_only: true,
        ai_audience: this.audience,
      };
    }
    const themes = this.filterForAi("theme", this.list("theme", Boolean(args.include_archived)))
      .records
      .filter((theme) => (theme.repository_context_ids || []).map(String).includes(id));
    const tasks = this.filterForAi("task", this.list("task", Boolean(args.include_archived))).records
      .filter((task) => {
        const theme = this.themeById(task.project_id || task.theme_id);
        return resolveTaskRepositoryContexts({ task, theme, contexts }).contextIds.includes(id);
      });
    return {
      repository_context: publicRepositoryContext(context),
      themes,
      tasks,
      repository_context_id: id,
      read_only: true,
      ai_audience: this.audience,
    };
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
    const contextRecords = this.visibleRepositoryContexts(false);
    const repositoryContextsById = new Map();
    const themeRepositoryContexts = themes.map((theme) => {
      const resolution = resolveThemeRepositoryContexts(theme, contextRecords);
      resolution.contexts.forEach((context) => repositoryContextsById.set(String(context.id), publicRepositoryContext(context)));
      return {
        theme_id: theme.id,
        ...resolution,
        contexts: resolution.contexts.map(publicRepositoryContext),
      };
    });
    return {
      themes,
      repository_contexts: [...repositoryContextsById.values()],
      theme_repository_contexts: themeRepositoryContexts,
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

  /** ActivityはMarkdown/JSON/MCPで同じstructured queryを投影するread-only入口。 */
  toolGetActivity(args = {}) {
    if (args.audience && args.audience !== this.audience) {
      return this.withAudience(args.audience, () => this.toolGetActivity({ ...args, audience: null }));
    }
    const workspace = this.loadWorkspace(Boolean(args.include_archived));
    const entityId = text(args.entity_id || args.entityId);
    const sourceEvents = this.list("change_event", Boolean(args.include_archived))
      .filter((event) => !entityId || String(event.entity_ref?.id || event.entity_id || "") === entityId);
    const result = queryActivityEvents({
      events: sourceEvents,
      workspace,
      themes: this.list("theme", Boolean(args.include_archived)),
      references: this.list("reference", Boolean(args.include_archived)),
      date: args.date || "",
      from: args.from || "",
      to: args.to || "",
      theme_id: args.theme_id || "",
      entity_type: args.entity_type || "",
      event_kinds: Array.isArray(args.event_kinds) ? args.event_kinds : [],
      timezone: args.timezone || "Asia/Tokyo",
      audience: this.audience,
      workspaceDefault: this.workspaceVisibilityDefault(),
      roots: workspace.canonical_root_status,
      limit: args.limit,
    });
    const format = args.format === "markdown" ? "markdown" : "json";
    return {
      ...projectActivityJson(result),
      activity: format === "markdown" ? projectActivityMarkdown(result) : projectActivityJson(result),
      format,
      ai_audience: this.audience,
      read_only: true,
    };
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
    const contextRecords = this.visibleRepositoryContexts(false);
    const repositoryContextsById = new Map();
    const themeRepositoryContexts = themes.map((theme) => {
      const resolution = resolveThemeRepositoryContexts(theme, contextRecords);
      resolution.contexts.forEach((context) => repositoryContextsById.set(String(context.id), publicRepositoryContext(context)));
      return {
        theme_id: theme.id,
        context_ids: resolution.contextIds,
        missing_context_ids: resolution.missingContextIds,
        missing_context_reasons: resolution.missingContextReasons,
      };
    });
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
    const activity = this.toolGetActivity({
      date: scope === "recent" ? args.date : "",
      theme_id: themeId,
      timezone: args.timezone || "Asia/Tokyo",
      format: "json",
      limit: maxItems,
      include_archived: false,
      audience: null,
    });
    const pack = {
      generated_at: new Date().toISOString(),
      scope,
      ai_audience: this.audience,
      themes,
      repository_contexts: [...repositoryContextsById.values()],
      theme_repository_contexts: themeRepositoryContexts,
      items,
      notes,
      resources: mergedResources,
      knowledge_nodes: knowledge.knowledge_nodes,
      knowledge_edges: knowledge.knowledge_edges,
      activity: activity.events,
      activity_meta: {
        schema_version: activity.schema_version,
        timezone: activity.timezone,
        excluded_count: activity.excluded_count,
        excluded_reasons: activity.excluded_reasons,
      },
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
    "## Activity",
    ...(pack.activity?.length ? pack.activity.map((event) => `- ${event.local_date} ${event.local_time} / ${event.event_kind}: ${event.entity_title} (${event.entity_ref.type}:${event.entity_ref.id})`) : ["- なし"]),
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
