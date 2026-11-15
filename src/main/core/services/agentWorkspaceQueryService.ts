import {
  findThemesForRepository,
  findTasksForRepository,
  publicRepositoryContext,
  resolveRepositoryContext,
  resolveTaskRepositoryContexts,
} from "../../../shared/repositoryContext.mjs";
import { localDate } from "../../../shared/activityProjection.mjs";
import { buildAiEntityHeader } from "../../../shared/aiMetadata.mjs";
import {
  getAgentSessionContextRequestSchema,
  taskWorkPeriods,
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
  normalizeAgentClientKind,
  taskAgentState,
} from "../../../shared/contracts/task/public.ts";
import { publicWorkingCopy } from "../../../shared/agentSession.mjs";
import {
  agentWorkCardInterval,
  agentWorkCardUnresolved,
  listAgentWorkCards,
} from "../../../shared/agentWorkCard.ts";
import { AgentReadyTaskAiProjectionPolicy } from "../policies/agentReadyTaskAiProjectionPolicy.ts";
import type { AgentWorkspaceReadPort } from "../ports/agentWorkspaceReadPort.ts";
import {
  publicTaskForContext,
  publicThemeForContext,
  safeReceiptValue,
  TaskContextTextBudget,
} from "../../../shared/taskContext.mjs";

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
    // Archived Themes still define the repository context of an active Task.
    const allThemes = this.readPort.listThemes(true);
    const tasks = this.projection.project(this.readPort.listTasks(includeArchived));
    const projectedThemes: Record<string, any>[] = themes.map((theme) => ({
      ...theme,
      ai: buildAiEntityHeader("theme", theme),
    }));
    return { tasks, themes, allThemes, projectedThemes };
  }

  findThemesForRepository(input: RepositoryLookupRequest = {}): FindThemesForRepositoryResponse {
    const request = repositoryLookupRequestSchema.parse(input);
    const { projectedThemes } = this.projected(Boolean(request.include_archived));
    const contexts = this.repositoryContexts(Boolean(request.include_archived));
    const result = findThemesForRepository({
      current: currentFromRequest(request),
      contexts,
      themes: projectedThemes,
    });
    const matchedContextIds = new Set<string>(
      ((result.matched_context_ids || []) as unknown[]).map(String),
    );
    return findThemesForRepositoryResponseSchema.parse({
      ...publicMatch(result),
      themes: ((result.themes || []) as Record<string, any>[]).map(publicTheme),
      repository_contexts: contexts
        .filter((context) => matchedContextIds.has(String(context.id)))
        .map((context) => safeReceiptValue(publicRepositoryContext(context))),
      read_only: true,
    });
  }

  private repositoryContexts(includeArchived: boolean) {
    // 削除済みは include_archived でも返さない（旧版と同じ）。無効（active=false）は include_archived で返す。
    return this.readPort
      .listRepositoryContexts(includeArchived)
      .filter((context) => !context.deleted_at && (includeArchived || context.active !== false));
  }

  resolveRepositoryContext(input: RepositoryLookupRequest = {}): ResolveRepositoryContextResponse {
    const request = repositoryLookupRequestSchema.parse(input);
    const contexts = this.repositoryContexts(Boolean(request.include_archived));
    return resolveRepositoryContextResponseSchema.parse({
      ...publicMatch(resolveRepositoryContext({ current: currentFromRequest(request), contexts })),
      read_only: true,
      context_count: contexts.length,
    });
  }

  findTasksForRepository(input: RepositoryLookupRequest = {}): FindTasksForRepositoryResponse {
    const request = repositoryLookupRequestSchema.parse(input);
    const { tasks, themes } = this.projected(Boolean(request.include_archived));
    const result = findTasksForRepository({
      current: currentFromRequest(request),
      contexts: this.repositoryContexts(Boolean(request.include_archived)),
      themes,
      tasks: tasks.records,
    });
    return findTasksForRepositoryResponseSchema.parse({
      ...publicMatch(result),
      tasks: result.tasks,
      read_only: true,
    });
  }

  getRepositoryContext(input: GetRepositoryContextRequest): GetRepositoryContextResponse {
    const request = getRepositoryContextRequestSchema.parse(input);
    const id = request.repository_context_id;
    const includeArchived = Boolean(request.include_archived);
    const contexts = this.repositoryContexts(includeArchived);
    const context = contexts.find((candidate) => String(candidate.id) === id);
    if (!context) {
      return getRepositoryContextResponseSchema.parse({
        repository_context: null,
        repository_context_id: id,
        read_only: true,
      });
    }
    const { tasks, projectedThemes, allThemes } = this.projected(includeArchived);
    const themes = projectedThemes.filter((theme) =>
      (theme.repository_context_ids || []).map(String).includes(id),
    );
    const themesById = new Map(allThemes.map((theme) => [String(theme.id), theme]));
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
    const hasRepositoryLookup = [
      repositoryRequest.repository_context_id,
      repositoryRequest.repository_id,
      repositoryRequest.provider,
      repositoryRequest.remote_url,
      repositoryRequest.remote_urls,
      repositoryRequest.repository_slug,
      repositoryRequest.git_root,
      repositoryRequest.cwd,
      repositoryRequest.workspace_folder,
    ].some((value) => (Array.isArray(value) ? value.length > 0 : Boolean(value)));
    const globalDaily = Boolean(request.date) && !hasRepositoryLookup;
    const repositoryMatch = this.resolveRepositoryContext(repositoryRequest);
    const repositoryContextId = repositoryMatch.selected?.id || null;
    const repositoryDetail = repositoryContextId
      ? this.getRepositoryContext({ repository_context_id: repositoryContextId })
      : null;
    const workingCopies = repositoryContextId
      ? this.readPort
          .listWorkingCopies(false)
          .filter(
            (copy) => copy.repository_context_id === repositoryContextId && copy.active !== false,
          )
          .map((copy) => publicWorkingCopy(copy))
      : [];
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = new Date().toISOString();
    // 古い会話と新しい記録を、同じカードの形で読む（#751）。
    const work = listAgentWorkCards({
      records: this.readPort.listAgentWorkRecords(false),
      sessions: this.readPort.listAgentSessions(false),
      references: this.readPort.listReferences(false),
      working_copies: this.readPort.listWorkingCopies(false),
    })
      .filter(
        (card) =>
          globalDaily ||
          Boolean(repositoryContextId && card.repository_context_ids.includes(repositoryContextId)),
      )
      .filter((card) => {
        if (!request.date) return true;
        const interval = agentWorkCardInterval(card, now);
        return (
          localDate(interval.start_at, timezone) <= request.date &&
          localDate(
            new Date(
              Math.max(Date.parse(interval.start_at), Date.parse(interval.end_at) - 1),
            ).toISOString(),
            timezone,
          ) >= request.date
        );
      })
      .filter(
        (card) =>
          !request.client_kind ||
          normalizeAgentClientKind(card.client_kind) === request.client_kind,
      )
      // agent_label（古い会話だけが持っていた欄）では絞らない。カードには無く、AI の種類
      // （client_kind）で足りる。要求の欄は、今の呼び手のために受けるだけにしてある。
      .slice(0, request.limit ?? 20)
      .map((card) => safeReceiptValue(card) as typeof card);
    // 引き継ぎ: 自分の会話ではない、残りのある（か止まった）直前の 1 件。
    const previousHandoff =
      work.find(
        (card) =>
          card.source_session_id !== request.source_session &&
          !card.running &&
          agentWorkCardUnresolved(card),
      ) || null;
    const themes = repositoryDetail && "themes" in repositoryDetail ? repositoryDetail.themes : [];
    const tasks = repositoryDetail && "tasks" in repositoryDetail ? repositoryDetail.tasks : [];
    const visibleWorkTasks = this.readPort
      .listTasks(false)
      .filter((task) => globalDaily || tasks.some((related) => related.id === task.id));
    const taskWork = taskWorkPeriods(
      visibleWorkTasks,
      this.readPort.listAiProposals(false),
      this.readPort.listWorkReceipts(false),
    )
      .filter(
        (work) =>
          !request.date ||
          (localDate(work.started_at, timezone) <= request.date &&
            localDate(
              new Date(
                Math.max(
                  Date.parse(work.started_at),
                  Date.parse(work.ended_at || new Date().toISOString()) - 1,
                ),
              ).toISOString(),
              timezone,
            ) >= request.date),
      )
      .sort((a, b) => a.started_at.localeCompare(b.started_at))
      .slice(0, request.limit ?? 20);
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
      agent_work: work,
      task_work: safeReceiptValue(taskWork),
      previous_handoff: previousHandoff,
      read_only: true,
    });
  }

  getTaskAssignment(input: GetTaskAssignmentRequest): GetTaskAssignmentResponse {
    const request = getTaskAssignmentRequestSchema.parse(input);
    const includeArchived = Boolean(request.include_archived);
    const task = this.readPort
      .listTasks(includeArchived)
      .find((candidate) => candidate.id === request.task_id);
    if (!task)
      return getTaskAssignmentResponseSchema.parse({
        task: null,
        receipts: [],
        task_id: request.task_id,
        read_only: true,
      });
    const themes = this.readPort.listThemes(true);
    const filtered = this.projection.project([task]);
    const theme = themes.find(
      (candidate) => candidate.id === String(task.project_id || task.theme_id || ""),
    );
    const resolution = taskRepositoryResolution({
      task,
      theme,
      contexts: this.repositoryContexts(includeArchived),
    });
    const limit = request.limit ?? 50;
    return getTaskAssignmentResponseSchema.parse({
      task: filtered.records[0],
      agent_state: taskAgentState(task),
      receipts: this.readPort
        .listWorkReceipts(includeArchived)
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
    });
  }
}
