import { projectEntityForAi, summarizeAiExclusions } from "../../../shared/aiMetadata.mjs";
import { collectionKeyForEntityType, entityTypes } from "../../../shared/entityRegistry.mjs";
import { contextGraphMcpShape, getContextSubgraph, projectContextGraph } from "../../../shared/contextGraph.mjs";
import { projectActivityJson, queryActivityEvents } from "../../../shared/activityProjection.mjs";
import {
  publicRepositoryContext,
  resolveRepositoryContext,
  resolveTaskRepositoryContexts,
} from "../../../shared/repositoryContext.mjs";
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
  taskContextLimits,
  TaskContextTextBudget,
  workspaceIdentityProvided,
} from "../../../shared/taskContext.mjs";
import {
  buildContextSelection,
  contextSelectionEntry,
  contextSelectionExclusions,
} from "../../../shared/contextSelection.mjs";
import type { GetTaskContextRequest, GetTaskContextResponse } from "../../../shared/contracts/task/public.ts";
import type { EntityType } from "../../../shared/types/workspace.ts";
import type { TaskContextReadPort, TaskContextRecord, TaskContextWorkspace } from "../ports/taskContextReadPort.ts";

const AUDIENCE = "coding_agent";
const LEGACY_ITEM_ENTITY_TYPES: Record<string, string> = {
  task: "task",
  waiting: "waiting",
  milestone: "plan_node",
  period: "plan_node",
};

function text(value: unknown) {
  return value == null ? "" : String(value);
}

function sortUpdated(records: TaskContextRecord[]) {
  return [...records].sort((a, b) => text(b.updated_at).localeCompare(text(a.updated_at)));
}

function entityKey(type: unknown, id: unknown) {
  return JSON.stringify([text(type), text(id)]);
}

function structuredReadError(code: string, message: string, details: Record<string, unknown>) {
  return { error: { code, message, ...details }, read_only: true as const };
}

function repositoryCurrentFromWorkspace(workspace: Record<string, any> = {}) {
  return {
    repository_id: workspace.repository_id || workspace.repositoryId || workspace.repository_context_id,
    provider: workspace.provider,
    remote_url: workspace.remote_url,
    remote_urls: workspace.remote_urls || workspace.remotes,
    repository_slug: workspace.repository_slug || workspace.repositorySlug,
    git_root: workspace.git_root || workspace.gitRoot,
    cwd: workspace.cwd || workspace.working_directory,
    workspace_folder: workspace.workspace_folder || workspace.workspaceFolder || workspace.cwd,
  };
}

function publicRepositoryMatch(match: Record<string, any>) {
  return {
    ...match,
    selected: publicRepositoryContext(match.selected),
    candidates: (match.candidates || []).map((candidate: Record<string, any>) => ({
      ...candidate,
      context: publicRepositoryContext(candidate.context),
    })),
  };
}

export class TaskContextQueryService {
  constructor(private readonly port: TaskContextReadPort) {}

  execute(args: GetTaskContextRequest): GetTaskContextResponse {
    const includeArchived = Boolean(args.include_archived);
    const workspace = this.port.loadTaskContextWorkspace(includeArchived);
    const visibilityThemes = this.port.loadTaskContextVisibilityThemes();
    const workspaceDefault = this.port.workspaceAiVisibilityDefault();
    const records = (type: string) => sortUpdated([
      ...((workspace[collectionKeyForEntityType(type as EntityType)] || []) as TaskContextRecord[]),
    ]);
    const themesById = new Map(visibilityThemes.map((theme) => [String(theme.id), theme]));
    const themeById = (themeId: unknown) => themeId ? themesById.get(String(themeId)) || null : null;
    const filterForAi = (type: string, candidates: TaskContextRecord[]) => {
      const included: TaskContextRecord[] = [];
      const exclusions: Record<string, any>[] = [];
      for (const record of candidates) {
        const entityType = type === "item" ? (LEGACY_ITEM_ENTITY_TYPES[record.kind] || "item") : type;
        const theme = type === "theme" ? record : themeById(record.theme_id || record.project_id);
        const result = projectEntityForAi(entityType as EntityType, record, {
          audience: AUDIENCE,
          theme,
          workspaceDefault,
        });
        if (!result.included && result.exclusion) exclusions.push(result.exclusion);
        else included.push({ ...record, ai: result.header });
      }
      return { records: included, exclusions };
    };
    const repositoryContexts = () => records("repository_context")
      .filter((context) => includeArchived || context.active !== false);
    const visibleRepositoryContexts = () => {
      const allContexts = records("repository_context");
      const visibleIds = new Set<string>();
      const visibleThemes = filterForAi("theme", records("theme")).records;
      for (const theme of visibleThemes) {
        for (const id of Array.isArray(theme.repository_context_ids) ? theme.repository_context_ids : []) visibleIds.add(String(id));
      }
      const visibleTasks = filterForAi("task", records("task")).records;
      for (const task of visibleTasks) {
        const resolution = resolveTaskRepositoryContexts({ task, theme: themeById(task.project_id || task.theme_id), contexts: allContexts }) as any;
        for (const id of resolution.contextIds) visibleIds.add(String(id));
      }
      return repositoryContexts().filter((context) => visibleIds.has(String(context.id)));
    };

    const taskId = text(args.task_id).trim();
    const include = normalizeTaskContextInclude(args.include);
    const includeSet = new Set(include);
    const limits = taskContextLimits(args);
    const budget = new TaskContextTextBudget(limits.maxTextLength);
    const task = records("task").find((candidate) => String(candidate.id) === taskId);
    if (!task) return { ...structuredReadError("not_found", "Taskが見つかりません。Task IDを確認してください。", { task_id: taskId }), ai_audience: AUDIENCE };
    if (!task.id || !task.title || !task.state) {
      return { ...structuredReadError("unsupported_schema", "Taskの保存形式をこのMCP Bridgeで解釈できません。Taskenを更新してください。", { task_id: taskId }), ai_audience: AUDIENCE };
    }
    const filteredTask = filterForAi("task", [task]);
    if (!filteredTask.records.length) {
      return {
        ...structuredReadError("not_found", "Taskが見つかりません。Task IDまたはAI公開範囲を確認してください。", { task_id: taskId }),
        ai_audience: AUDIENCE,
        ...summarizeAiExclusions(filteredTask.exclusions as any),
      };
    }

    const warnings: Record<string, unknown>[] = [];
    const truncation: Record<string, any> = {};
    const themeCandidate = themeById(task.project_id || task.theme_id);
    const filteredThemeResult = themeCandidate ? filterForAi("theme", [themeCandidate]) : { records: [], exclusions: [] };
    const filteredTheme = filteredThemeResult.records[0] || null;
    if (themeCandidate && !filteredTheme) warnings.push({ code: "theme_not_visible", message: "TaskのThemeはAI公開範囲外のため含めていません。" });
    const taskOutput = publicTaskForContext(filteredTask.records[0], budget);
    const assignmentOutput = publicAssignmentForContext(task, budget);
    const themeOutput = includeSet.has("theme") ? publicThemeForContext(filteredTheme, budget) : null;

    const repositoryResolution = resolveTaskRepositoryContexts({ task, theme: themeCandidate, contexts: visibleRepositoryContexts() }) as any;
    const taskRepositoryContexts = repositoryResolution.contexts;
    let repositoryMatch: Record<string, any> = {
      status: "unknown",
      reason_code: "workspace_not_provided",
      reason: "現在のcoding workspace情報が指定されていません。",
      selected: null,
      candidates: [],
    };
    if (workspaceIdentityProvided(args.workspace)) {
      const match = resolveRepositoryContext({ current: repositoryCurrentFromWorkspace(args.workspace), contexts: taskRepositoryContexts } as any) as any;
      repositoryMatch = publicRepositoryMatch(match);
      if (match.status === "unknown" && taskRepositoryContexts.length) {
        repositoryMatch.status = "mismatch";
        repositoryMatch.reason_code = "task_repository_mismatch";
        repositoryMatch.reason = "現在のcoding workspaceはTaskのRepositoryContextと一致しません。作業対象を確認してください。";
        warnings.push({ code: "repository_mismatch", message: repositoryMatch.reason });
      } else if (match.status === "ambiguous") warnings.push({ code: "repository_ambiguous", message: match.reason });
    }

    const related: Record<string, any[]> = { notes: [], conversations: [], artifacts: [], resources: [], activity: [], work_receipts: [] };
    const selectionExclusions: Record<string, any>[] = includeSet.has("theme")
      ? filteredThemeResult.exclusions.map((entry) => ({ ref: { type: entry.type, id: entry.id }, reason: entry.reason, count: 1 }))
      : [];
    const recordOmitted = (type: string, bounded: Record<string, any>) => {
      for (const record of bounded.omitted || []) {
        if (record?.id) selectionExclusions.push({ ref: { type, id: String(record.id) }, reason: "max_items_per_type", count: 1 });
      }
    };
    const access = { allowed: new Set<string>(), records: new Map<string, TaskContextRecord>(), exclusions: new Map<string, Record<string, any>>() };
    for (const entityType of entityTypes) {
      const filtered = filterForAi(entityType, records(entityType));
      for (const record of filtered.records) {
        const key = entityKey(entityType, record.id);
        access.allowed.add(key);
        access.records.set(key, record);
      }
      for (const exclusion of filtered.exclusions) {
        if (exclusion?.type && exclusion?.id) access.exclusions.set(entityKey(exclusion.type, exclusion.id), {
          ref: { type: String(exclusion.type), id: String(exclusion.id) }, reason: String(exclusion.reason || "ai_visibility_policy"), count: 1,
        });
      }
    }
    const graph = projectContextGraph(workspace);
    const subgraph = getContextSubgraph(graph, { type: "task", id: taskId }, {
      maxHops: 2,
      maxNodes: Math.min(100, limits.maxItemsPerType * 8 + 8),
      maxEdges: Math.min(200, limits.maxItemsPerType * 16 + 16),
      tokenBudget: 12_000,
      includeSuggested: false,
      nodeFilter: (node: Record<string, any>) => access.allowed.has(entityKey(node.ref.type, node.ref.id)),
      nodeExclusion: (node: Record<string, any>) => access.exclusions.get(entityKey(node.ref.type, node.ref.id)),
      edgeFilter: (edge: Record<string, any>) => edge.predicate !== "belongs_to_theme",
    });
    if (subgraph.truncated) warnings.push({ code: "relation_graph_truncated", message: "関連情報のbounded traversalが上限に達しました。locatorから必要な本文を追加取得してください。" });
    const relationGraph = contextGraphMcpShape(subgraph);
    selectionExclusions.push(...relationGraph.excluded_nodes);
    const relatedIds = new Map<string, Set<string>>();
    for (const node of subgraph.nodes) {
      if (node.type === "task" && node.id === taskId) continue;
      const ids = relatedIds.get(node.type) || new Set<string>();
      ids.add(String(node.id));
      relatedIds.set(node.type, ids);
    }
    const relation = (type: string, id: unknown) => relationForNode(subgraph, type, String(id));

    const projectBounded = (key: string, type: string, candidates: TaskContextRecord[], project: (record: TaskContextRecord) => unknown) => {
      const bounded = boundedList(candidates, limits.maxItemsPerType);
      related[key] = bounded.selected.map(project);
      recordOmitted(type, bounded);
      if (bounded.truncation) truncation[key] = bounded.truncation;
    };
    if (includeSet.has("notes")) projectBounded("notes", "note", sortUpdated(records("note").filter((record) => access.records.has(entityKey("note", record.id)) && relatedIds.get("note")?.has(String(record.id)))), (record) => publicNoteSummary(access.records.get(entityKey("note", record.id)), budget, relation("note", record.id)));
    const visibleResources = sortUpdated(records("resource").map((record) => access.records.get(entityKey("resource", record.id))).filter((record): record is TaskContextRecord => Boolean(record)));
    if (includeSet.has("conversations")) projectBounded("conversations", "resource", visibleResources.filter((record) => record.resource_scope === "chat_ref" && relatedIds.get("resource")?.has(String(record.id))), (record) => publicConversationSummary(record, budget, relation("resource", record.id)));
    if (includeSet.has("resources")) projectBounded("resources", "resource", visibleResources.filter((record) => record.resource_scope !== "chat_ref" && relatedIds.get("resource")?.has(String(record.id))), (record) => publicResourceSummary(record, budget, relation("resource", record.id)));
    if (includeSet.has("artifacts")) projectBounded("artifacts", "artifact", sortUpdated(records("artifact").map((record) => access.records.get(entityKey("artifact", record.id))).filter((record): record is TaskContextRecord => Boolean(record && relatedIds.get("artifact")?.has(String(record.id))))), (record) => (publicArtifactMetadata as any)(record, budget, relation("artifact", record.id)));
    if (includeSet.has("work_receipts")) projectBounded("work_receipts", "work_receipt", records("work_receipt").filter((receipt) => receipt.task_id === taskId), (receipt) => publicReceiptForContext(receipt, budget));
    if (includeSet.has("activity")) {
      const sourceEvents = records("change_event").filter((event) => String(event.entity_ref?.id || event.entity_id || "") === taskId);
      const activity = projectActivityJson(queryActivityEvents({
        events: sourceEvents,
        workspace,
        themes: records("theme"),
        references: records("reference"),
        entity_type: "task",
        timezone: "Asia/Tokyo",
        audience: AUDIENCE,
        workspaceDefault,
        roots: workspace.canonical_root_status as any,
        limit: 100,
      }));
      const activityRecords = [...(activity.events || [])].sort((left, right) => String(right.occurred_at).localeCompare(String(left.occurred_at)) || String(right.id).localeCompare(String(left.id)));
      projectBounded("activity", "change_event", activityRecords, (event) => ({
        id: event.id,
        occurred_at: event.occurred_at,
        event_kind: event.event_kind,
        summary: budget.take(event.summary, 1_000),
        actor: event.actor,
        origin: event.origin,
        work_receipt_ref: event.work_receipt_ref || null,
        included_because: "recent_activity",
      }));
    }
    if (budget.truncated) {
      truncation.text = { reason: "max_text_length", limit: budget.limit, used: budget.used };
      warnings.push({ code: "text_truncated", message: "context本文が文字数上限に達しました。stable locatorから必要な本文だけ取得してください。" });
    }

    const publicRepositoryContexts = includeSet.has("repository") ? taskRepositoryContexts.map(publicRepositoryContext) : [];
    const selectionIncluded = [
      contextSelectionEntry("task", taskOutput, { reason: "seed" }),
      ...(themeOutput ? [contextSelectionEntry("theme", themeOutput, { reason: "task_theme" })] : []),
      ...publicRepositoryContexts.map((record: Record<string, any>) => contextSelectionEntry("repository_context", record, { reason: "task_repository_context" })),
      ...related.notes.map((record) => contextSelectionEntry("note", record)),
      ...related.conversations.map((record) => contextSelectionEntry("resource", record)),
      ...related.resources.map((record) => contextSelectionEntry("resource", record)),
      ...related.artifacts.map((record) => contextSelectionEntry("artifact", record)),
      ...related.activity.map((record) => contextSelectionEntry("change_event", record, { reason: "recent_activity" })),
      ...related.work_receipts.map((record) => contextSelectionEntry("work_receipt", record, { reason: "task_work_receipt" })),
    ];
    const includedKeys = new Set(selectionIncluded.filter(Boolean).map((entry: Record<string, any>) => entityKey(entry.ref.type, entry.ref.id)));
    for (const node of relationGraph.nodes) {
      if (!includedKeys.has(entityKey(node.type, node.id))) selectionExclusions.push({ ref: { type: node.type, id: String(node.id) }, reason: "include_not_requested", count: 1 });
    }
    const retainedEdges = relationGraph.edges.filter((edge: Record<string, any>) => includedKeys.has(entityKey(edge.source.type, edge.source.id)) && includedKeys.has(entityKey(edge.target.type, edge.target.id)));
    const retainedEdgeIds = new Set(retainedEdges.map((edge: Record<string, any>) => String(edge.id)));
    const contextGraph = {
      ...relationGraph,
      nodes: relationGraph.nodes.filter((node: Record<string, any>) => includedKeys.has(entityKey(node.type, node.id))),
      edges: retainedEdges,
      paths: relationGraph.paths.filter((path: Record<string, any>) => includedKeys.has(entityKey(path.from.type, path.from.id))
        && includedKeys.has(entityKey(path.to.type, path.to.id))
        && path.edge_ids.every((edgeId: unknown) => retainedEdgeIds.has(String(edgeId)))),
    };
    if (contextGraph.policy === undefined) delete contextGraph.policy;
    contextGraph.estimated_tokens = Math.ceil(JSON.stringify({ nodes: contextGraph.nodes, edges: contextGraph.edges, paths: contextGraph.paths, diagnostics: contextGraph.diagnostics, excluded_nodes: contextGraph.excluded_nodes }).length / 4);
    const normalizedExclusions = contextSelectionExclusions(selectionExclusions);
    const contextSelection = (buildContextSelection as any)({
      seed: { type: "task", id: taskId },
      included: selectionIncluded,
      excluded: normalizedExclusions,
      relations: contextGraph.edges,
      limits: { max_items_per_type: limits.maxItemsPerType, max_text_length: limits.maxTextLength, graph: contextGraph.limits },
      truncated: Boolean(contextGraph.truncated || budget.truncated || Object.keys(truncation).length),
      truncation,
      estimatedCharacters: budget.used,
      estimatedTokens: Math.ceil(budget.used / 4) + Number(contextGraph.estimated_tokens || 0),
      policy: contextGraph.policy,
    });
    const exclusionSummary = summarizeAiExclusions(normalizedExclusions.map((entry: Record<string, any>) => ({ type: entry.ref.type, id: entry.ref.id, reason: entry.reason })));
    return {
      task: taskOutput,
      assignment: assignmentOutput,
      theme: themeOutput,
      repository_contexts: publicRepositoryContexts,
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
      context_graph: contextGraph,
      context_selection: contextSelection,
      include,
      limits: { max_items_per_type: limits.maxItemsPerType, max_text_length: limits.maxTextLength },
      truncation,
      warnings,
      truncated: Boolean(subgraph.truncated || budget.truncated || Object.keys(truncation).length),
      read_only: true,
      ai_audience: AUDIENCE,
      ...exclusionSummary,
    };
  }
}
