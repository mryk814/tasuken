import {
  findTasksForRepository,
  publicRepositoryContext,
  resolveRepositoryContext,
  resolveTaskRepositoryContexts,
} from "../../../shared/repositoryContext.mjs";
import { projectEntityForAi, summarizeAiExclusions } from "../../../shared/aiMetadata.mjs";
import {
  findTasksForRepositoryResponseSchema,
  getTaskAssignmentRequestSchema,
  getTaskAssignmentResponseSchema,
  repositoryLookupRequestSchema,
  resolveRepositoryContextResponseSchema,
  type FindTasksForRepositoryResponse,
  type GetTaskAssignmentRequest,
  type GetTaskAssignmentResponse,
  type RepositoryLookupRequest,
  type ResolveRepositoryContextResponse,
} from "../../../shared/contracts/task/public.ts";
import { AgentReadyTaskAiProjectionPolicy } from "../policies/agentReadyTaskAiProjectionPolicy.ts";
import type { AgentWorkspaceReadPort } from "../ports/agentWorkspaceReadPort.ts";

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

export class AgentWorkspaceQueryService {
  private readonly readPort: AgentWorkspaceReadPort;
  private readonly projection = new AgentReadyTaskAiProjectionPolicy();

  constructor(readPort: AgentWorkspaceReadPort) {
    this.readPort = readPort;
  }

  private projected(includeArchived: boolean) {
    const themes = this.readPort.listThemes(includeArchived);
    const tasks = this.projection.project(
      this.readPort.listTasks(includeArchived),
      themes,
      this.readPort.workspaceAiVisibilityDefault(),
    );
    const workspaceDefault = this.readPort.workspaceAiVisibilityDefault();
    const projectedThemes = themes.filter((theme) => projectEntityForAi("theme", theme, {
      audience: "coding_agent",
      theme,
      workspaceDefault,
    }).included);
    return { tasks, themes, projectedThemes };
  }

  private visibleRepositoryContexts(includeArchived: boolean) {
    const allContexts = this.readPort.listRepositoryContexts(true);
    const contexts = includeArchived
      ? this.readPort.listRepositoryContexts(true)
      : this.readPort.listRepositoryContexts(false).filter((context) => context.active !== false);
    const { tasks, projectedThemes, themes } = this.projected(includeArchived);
    const visibleIds = new Set<string>();
    for (const theme of projectedThemes) {
      for (const id of Array.isArray(theme.repository_context_ids) ? theme.repository_context_ids : []) {
        visibleIds.add(String(id));
      }
    }
    const themesById = new Map(themes.map((theme) => [theme.id, theme]));
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

  getTaskAssignment(input: GetTaskAssignmentRequest): GetTaskAssignmentResponse {
    const request = getTaskAssignmentRequestSchema.parse(input);
    const includeArchived = Boolean(request.include_archived);
    const task = this.readPort.listTasks(includeArchived).find((candidate) => candidate.id === request.task_id);
    if (!task) return getTaskAssignmentResponseSchema.parse({ task: null, receipts: [], task_id: request.task_id, read_only: true, ai_audience: "coding_agent" });
    const themes = this.readPort.listThemes(includeArchived);
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
