import {
  findThemesForRepository,
  findTasksForRepository,
  publicRepositoryContext,
  resolveRepositoryContext,
  resolveTaskRepositoryContexts,
} from "../../../shared/repositoryContext.mjs";
import { projectEntityForAi, summarizeAiExclusions } from "../../../shared/aiMetadata.mjs";
import {
  findThemesForRepositoryResponseSchema,
  findTasksForRepositoryResponseSchema,
  getRepositoryContextRequestSchema,
  getRepositoryContextResponseSchema,
  getTaskAssignmentRequestSchema,
  getTaskAssignmentResponseSchema,
  repositoryLookupRequestSchema,
  resolveRepositoryContextResponseSchema,
  type FindThemesForRepositoryResponse,
  type FindTasksForRepositoryResponse,
  type GetRepositoryContextRequest,
  type GetRepositoryContextResponse,
  type GetTaskAssignmentRequest,
  type GetTaskAssignmentResponse,
  type RepositoryLookupRequest,
  type ResolveRepositoryContextResponse,
} from "../../../shared/contracts/task/public.ts";
import { AgentReadyTaskAiProjectionPolicy } from "../policies/agentReadyTaskAiProjectionPolicy.ts";
import type { AgentWorkspaceReadPort } from "../ports/agentWorkspaceReadPort.ts";
import { publicTaskForContext, publicThemeForContext, safeReceiptText, TaskContextTextBudget } from "../../../shared/taskContext.mjs";

interface TaskRepositoryResolution {
  mode: unknown;
  contextIds: string[];
  contexts: Record<string, unknown>[];
  missingContextIds: string[];
  missingContextReasons: Record<string, unknown>;
  subdirectory: unknown;
  branchHint: unknown;
}

function taskRepositoryResolution(options: Parameters<typeof resolveTaskRepositoryContexts>[0]) {
  return resolveTaskRepositoryContexts(options) as unknown as TaskRepositoryResolution;
}

function currentFromRequest(request: RepositoryLookupRequest) {
  return {
    repository_id: request.repository_id || request.repository_context_id,
    provider: request.provider,
    remote_url: request.remote_url,
    remote_urls: request.remote_urls,
    repository_slug: request.repository_slug,
    git_root: request.git_root,
    cwd: request.cwd,
    workspace_folder: request.workspace_folder,
  };
}

function publicMatch(match: Record<string, any>) {
  return {
    ...match,
    selected: publicRepositoryContext(match.selected),
    candidates: (match.candidates || []).map((candidate: Record<string, unknown>) => ({
      ...candidate,
      context: publicRepositoryContext(candidate.context as Record<string, unknown>),
    })),
  };
}

function sanitizeProjected(value: any): any {
  if (typeof value === "string") return safeReceiptText(value);
  if (Array.isArray(value)) return value.map(sanitizeProjected);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizeProjected(entry)]));
}

function publicTheme(theme: Record<string, any>) {
  return sanitizeProjected(publicThemeForContext(theme, new TaskContextTextBudget(50_000)));
}

function publicTask(task: Record<string, any>) {
  return sanitizeProjected(publicTaskForContext(task, new TaskContextTextBudget(50_000)));
}

export class AgentWorkspaceQueryService {
  private readonly readPort: AgentWorkspaceReadPort;
  private readonly projection = new AgentReadyTaskAiProjectionPolicy();

  constructor(readPort: AgentWorkspaceReadPort) {
    this.readPort = readPort;
  }

  private projected(includeArchived: boolean) {
    const themes = this.readPort.listThemes(includeArchived);
    const visibilityThemes = this.readPort.listThemes(true);
    const tasks = this.projection.project(
      this.readPort.listTasks(includeArchived),
      visibilityThemes,
      this.readPort.workspaceAiVisibilityDefault(),
    );
    const workspaceDefault = this.readPort.workspaceAiVisibilityDefault();
    const projectedThemes: Record<string, any>[] = themes.flatMap((theme) => {
      const projected = projectEntityForAi("theme", theme, {
        audience: "coding_agent",
        theme,
        workspaceDefault,
      });
      return projected.included ? [{ ...theme, ai: projected.header }] : [];
    });
    return { tasks, themes, visibilityThemes, projectedThemes };
  }

  findThemesForRepository(input: RepositoryLookupRequest = {}): FindThemesForRepositoryResponse {
    const request = repositoryLookupRequestSchema.parse(input);
    const { projectedThemes } = this.projected(Boolean(request.include_archived));
    const contexts = this.visibleRepositoryContexts(Boolean(request.include_archived));
    const result = findThemesForRepository({
      current: currentFromRequest(request),
      contexts,
      themes: projectedThemes,
    });
    const matchedContextIds = new Set<string>(((result.matched_context_ids || []) as unknown[]).map(String));
    return findThemesForRepositoryResponseSchema.parse({
      ...publicMatch(result),
      themes: ((result.themes || []) as Record<string, any>[]).map(publicTheme),
      repository_contexts: contexts
        .filter((context) => matchedContextIds.has(String(context.id)))
        .map(publicRepositoryContext),
      read_only: true,
      ai_audience: "coding_agent",
    });
  }

  private visibleRepositoryContexts(includeArchived: boolean) {
    const allContexts = this.readPort.listRepositoryContexts(true);
    const contexts = includeArchived
      ? this.readPort.listRepositoryContexts(true)
      : this.readPort.listRepositoryContexts(false).filter((context) => context.active !== false);
    const { tasks, projectedThemes, visibilityThemes } = this.projected(includeArchived);
    const visibleIds = new Set<string>();
    for (const theme of projectedThemes) {
      for (const id of Array.isArray(theme.repository_context_ids) ? theme.repository_context_ids : []) {
        visibleIds.add(String(id));
      }
    }
    const themesById = new Map(visibilityThemes.map((theme) => [theme.id, theme]));
    for (const task of tasks.records) {
      const theme = themesById.get(String(task.project_id || task.theme_id || ""));
      const resolution = taskRepositoryResolution({ task, theme, contexts: allContexts });
      for (const id of resolution.contextIds) visibleIds.add(String(id));
    }
    return contexts.filter((context) => visibleIds.has(String(context.id)));
  }

  resolveRepositoryContext(input: RepositoryLookupRequest = {}): ResolveRepositoryContextResponse {
    const request = repositoryLookupRequestSchema.parse(input);
    const contexts = this.visibleRepositoryContexts(Boolean(request.include_archived));
    return resolveRepositoryContextResponseSchema.parse({
      ...publicMatch(resolveRepositoryContext({ current: currentFromRequest(request), contexts })),
      read_only: true,
      ai_audience: "coding_agent",
      visible_context_count: contexts.length,
    });
  }

  findTasksForRepository(input: RepositoryLookupRequest = {}): FindTasksForRepositoryResponse {
    const request = repositoryLookupRequestSchema.parse(input);
    const { tasks, themes } = this.projected(Boolean(request.include_archived));
    const result = findTasksForRepository({
      current: currentFromRequest(request),
      contexts: this.visibleRepositoryContexts(Boolean(request.include_archived)),
      themes,
      tasks: tasks.records,
    });
    return findTasksForRepositoryResponseSchema.parse({
      ...publicMatch(result),
      tasks: result.tasks,
      read_only: true,
      ai_audience: "coding_agent",
      ...summarizeAiExclusions(tasks.exclusions),
    });
  }

  getRepositoryContext(input: GetRepositoryContextRequest): GetRepositoryContextResponse {
    const request = getRepositoryContextRequestSchema.parse(input);
    const id = request.repository_context_id;
    const includeArchived = Boolean(request.include_archived);
    const contexts = this.visibleRepositoryContexts(includeArchived);
    const context = contexts.find((candidate) => String(candidate.id) === id);
    if (!context) {
      return getRepositoryContextResponseSchema.parse({
        repository_context: null,
        repository_context_id: id,
        excluded_reasons: ["repository_context_not_visible"],
        read_only: true,
        ai_audience: "coding_agent",
      });
    }
    const { tasks, projectedThemes, visibilityThemes } = this.projected(includeArchived);
    const themes = projectedThemes.filter((theme) => (theme.repository_context_ids || []).map(String).includes(id));
    const themesById = new Map(visibilityThemes.map((theme) => [String(theme.id), theme]));
    const matchingTasks = tasks.records.filter((task) => {
      const theme = themesById.get(String(task.project_id || task.theme_id || ""));
      return taskRepositoryResolution({ task, theme, contexts }).contextIds.includes(id);
    });
    return getRepositoryContextResponseSchema.parse({
      repository_context: publicRepositoryContext(context),
      themes: themes.map(publicTheme),
      tasks: matchingTasks.map(publicTask),
      repository_context_id: id,
      read_only: true,
      ai_audience: "coding_agent",
    });
  }

  getTaskAssignment(input: GetTaskAssignmentRequest): GetTaskAssignmentResponse {
    const request = getTaskAssignmentRequestSchema.parse(input);
    const includeArchived = Boolean(request.include_archived);
    const task = this.readPort.listTasks(includeArchived).find((candidate) => candidate.id === request.task_id);
    if (!task) return getTaskAssignmentResponseSchema.parse({ task: null, receipts: [], task_id: request.task_id, read_only: true, ai_audience: "coding_agent" });
    const themes = this.readPort.listThemes(true);
    const filtered = this.projection.project([task], themes, this.readPort.workspaceAiVisibilityDefault());
    if (!filtered.records.length) {
      return getTaskAssignmentResponseSchema.parse({
        task: null,
        receipts: [],
        task_id: request.task_id,
        read_only: true,
        ai_audience: "coding_agent",
        ...summarizeAiExclusions(filtered.exclusions),
      });
    }
    const theme = themes.find((candidate) => candidate.id === String(task.project_id || task.theme_id || ""));
    const resolution = taskRepositoryResolution({
      task,
      theme,
      contexts: this.visibleRepositoryContexts(includeArchived),
    });
    const limit = request.limit ?? 50;
    return getTaskAssignmentResponseSchema.parse({
      task: filtered.records[0],
      receipts: this.readPort.listWorkReceipts(includeArchived)
        .filter((receipt) => receipt.task_id === request.task_id)
        .slice(0, limit),
      repository_contexts: resolution.contexts.map(publicRepositoryContext),
      repository_context_resolution: {
        mode: resolution.mode,
        context_ids: resolution.contextIds,
        missing_context_ids: resolution.missingContextIds,
        missing_context_reasons: resolution.missingContextReasons,
        subdirectory: resolution.subdirectory,
        branch_hint: resolution.branchHint,
      },
      task_id: request.task_id,
      read_only: true,
      ai_audience: "coding_agent",
      ...summarizeAiExclusions(filtered.exclusions),
    });
  }
}
