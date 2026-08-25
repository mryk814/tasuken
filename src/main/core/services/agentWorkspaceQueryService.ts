import {
  findThemesForRepository,
  findTasksForRepository,
  publicRepositoryContext,
  resolveRepositoryContext,
  resolveTaskRepositoryContexts,
} from "../../../shared/repositoryContext.mjs";
import { projectEntityForAi, summarizeAiExclusions } from "../../../shared/aiMetadata.mjs";
import {
  getAgentSessionContextRequestSchema,
  getAgentSessionContextResponseSchema,
  findThemesForRepositoryResponseSchema,
  findTasksForRepositoryResponseSchema,
  getRepositoryContextRequestSchema,
  getRepositoryContextResponseSchema,
  getTaskAssignmentRequestSchema,
  getTaskAssignmentResponseSchema,
  repositoryLookupRequestSchema,
  resolveRepositoryContextResponseSchema,
  type FindThemesForRepositoryResponse,
  type GetAgentSessionContextRequest,
  type GetAgentSessionContextResponse,
  type FindTasksForRepositoryResponse,
  type GetRepositoryContextRequest,
  type GetRepositoryContextResponse,
  type GetTaskAssignmentRequest,
  type GetTaskAssignmentResponse,
  type RepositoryLookupRequest,
  type ResolveRepositoryContextResponse,
} from "../../../shared/contracts/task/public.ts";
import { publicAgentSession, publicWorkingCopy } from "../../../shared/agentSession.mjs";
import { AgentReadyTaskAiProjectionPolicy } from "../policies/agentReadyTaskAiProjectionPolicy.ts";
import type { AgentWorkspaceReadPort } from "../ports/agentWorkspaceReadPort.ts";
import { publicTaskForContext, publicThemeForContext, safeReceiptValue, TaskContextTextBudget } from "../../../shared/taskContext.mjs";

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
  return safeReceiptValue({
    ...match,
    selected: publicRepositoryContext(match.selected),
    candidates: (match.candidates || []).map((candidate: Record<string, unknown>) => ({
      ...candidate,
      context: publicRepositoryContext(candidate.context as Record<string, unknown>),
    })),
  });
}

function publicTheme(theme: Record<string, any>) {
  return safeReceiptValue(publicThemeForContext(theme, new TaskContextTextBudget(50_000)));
}

function publicTask(task: Record<string, any>) {
  return safeReceiptValue(publicTaskForContext(task, new TaskContextTextBudget(50_000)));
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
        .map((context) => safeReceiptValue(publicRepositoryContext(context))),
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
      repository_context: safeReceiptValue(publicRepositoryContext(context)),
      themes: themes.map(publicTheme),
      tasks: matchingTasks.map(publicTask),
      repository_context_id: id,
      read_only: true,
      ai_audience: "coding_agent",
    });
  }

  getAgentSessionContext(input: GetAgentSessionContextRequest): GetAgentSessionContextResponse {
    const request = getAgentSessionContextRequestSchema.parse(input);
    const repositoryRequest = repositoryLookupRequestSchema.parse({
      repository_context_id: request.repository_context_id,
      repository_id: request.repository_id,
      provider: request.provider,
      remote_url: request.remote_url,
      remote_urls: request.remote_urls,
      repository_slug: request.repository_slug,
      git_root: request.git_root,
      cwd: request.cwd,
      workspace_folder: request.workspace_folder,
      include_archived: request.include_archived,
    });
    const repositoryMatch = this.resolveRepositoryContext(repositoryRequest);
    const repositoryContextId = repositoryMatch.selected?.id || null;
    const repositoryDetail = repositoryContextId
      ? this.getRepositoryContext({ repository_context_id: repositoryContextId })
      : null;
    const workingCopies = repositoryContextId
      ? this.readPort.listWorkingCopies(false)
        .filter((copy) => copy.repository_context_id === repositoryContextId && copy.active !== false)
        .map((copy) => publicWorkingCopy(copy))
      : [];
    const workingCopyIds = new Set(workingCopies.map((copy) => copy.id));
    const relatedSessionIds = new Set<string>();
    if (repositoryContextId) {
      for (const reference of this.readPort.listReferences(false)) {
        const sourceIsSession = reference.source_type === "agent_session";
        const targetIsSession = reference.target_type === "agent_session";
        const otherMatchesRepository = sourceIsSession
          ? (reference.target_type === "repository_context" && reference.target_id === repositoryContextId)
            || (reference.target_type === "working_copy" && workingCopyIds.has(String(reference.target_id)))
          : targetIsSession
            ? (reference.source_type === "repository_context" && reference.source_id === repositoryContextId)
              || (reference.source_type === "working_copy" && workingCopyIds.has(String(reference.source_id)))
            : false;
        if (sourceIsSession && otherMatchesRepository) relatedSessionIds.add(String(reference.source_id));
        if (targetIsSession && otherMatchesRepository) relatedSessionIds.add(String(reference.target_id));
      }
    }
    const sessions = this.readPort.listAgentSessions(false)
      .filter((session) => relatedSessionIds.has(session.id))
      .filter((session) => session.client_kind === request.client_kind)
      .filter((session) => !request.agent_label || session.agent_label === request.agent_label)
      .sort((left, right) => String(right.ended_at || right.started_at).localeCompare(String(left.ended_at || left.started_at)))
      .slice(0, request.limit ?? 20)
      .map((session) => publicAgentSession(session));
    const previousHandoff = sessions.find((session) => (
      session.source_session_id !== request.source_session
      && session.status !== "active"
      && session.outcome
    )) || null;
    const themes = repositoryDetail && "themes" in repositoryDetail ? repositoryDetail.themes : [];
    const tasks = repositoryDetail && "tasks" in repositoryDetail ? repositoryDetail.tasks : [];
    return getAgentSessionContextResponseSchema.parse({
      status: repositoryMatch.status,
      reason_code: repositoryMatch.reason_code,
      reason: repositoryMatch.reason,
      selected: repositoryMatch.selected,
      candidates: repositoryMatch.candidates,
      repository_context: repositoryMatch.selected,
      themes,
      tasks,
      working_copies: workingCopies,
      sessions,
      previous_handoff: previousHandoff,
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
