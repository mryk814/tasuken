import { normalizeReferenceAssertion } from "../../../../../shared/relationAssertion.mjs";
import type { RepositoryContext } from "../../../../../shared/repositoryContext.mjs";

import type {
  AgentSession,
  ChangeEvent,
  Project,
  Reference,
  Task,
  WorkReceipt,
  WorkspaceDomain,
} from "./types";
import type { SaveOperation } from "../types";

export interface AgentWorkProjectionRow {
  session: AgentSession;
  sessionHasContent: boolean;
  sessionIdentity: string;
  topic: string;
  result: string | null;
  requestCount: number;
  responseCount: number;
  date: string;
  themes: Project[];
  repositories: RepositoryContext[];
  tasks: Task[];
  receipts: WorkReceipt[];
  activities: ChangeEvent[];
  presentation: "attention" | "content" | "record";
  unresolved: boolean;
  assignmentIncomplete: boolean;
}

export interface AgentWorkProjectionOptions {
  date?: string;
  themeId?: string;
  repositoryContextId?: string;
  includeUnresolved?: boolean;
  carryoverOnly?: boolean;
  limit?: number;
}

export interface AgentSessionAssignmentInput {
  themeId: string;
  repositoryContextId?: string | null;
  existingThemeIds?: Iterable<string>;
  existingRepositoryContextIds?: Iterable<string>;
  recordedAt?: string;
  idFactory?: () => string;
}

export interface AgentWorkProjectionGroup {
  key: string;
  themeLabel: string;
  repositoryLabel: string;
  rows: AgentWorkProjectionRow[];
}

function localDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function referencesForSession(references: Reference[], sessionId: string) {
  return references.flatMap((reference) => {
    try {
      const normalized = normalizeReferenceAssertion(
        reference as unknown as Record<string, unknown>,
        { legacyRead: true },
      ) as unknown as {
        subject: { type: string; id: string };
        object: { type: string; id: string };
        status: string;
      };
      if (normalized.status === "superseded") return [];
      if (normalized.subject.type === "agent_session" && normalized.subject.id === sessionId) {
        return [normalized.object];
      }
      if (normalized.object.type === "agent_session" && normalized.object.id === sessionId) {
        return [normalized.subject];
      }
      return [];
    } catch {
      return [];
    }
  });
}

function byIds<T extends { id: string }>(records: T[], ids: Set<string>): T[] {
  return records.filter((record) => ids.has(record.id));
}

function sessionTimestamp(session: AgentSession): string {
  return session.ended_at || session.started_at;
}

function compactSessionId(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

const SESSION_HOOK_SOURCE_APP_PREFIX = "tasken-session-hook:";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function proposalPayload(proposal: Record<string, unknown>): Record<string, unknown> | null {
  const raw = proposal.payload;
  if (typeof raw === "string") {
    try {
      return record(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  return record(raw);
}

export function agentSessionHookSourceApps(
  proposals: WorkspaceDomain["ai_proposals"],
): Map<string, string> {
  const sourceApps = new Map<string, string>();
  for (const proposal of proposals) {
    if (proposal.status !== "accepted" && proposal.status !== "pending") {
      continue;
    }
    if (proposal.payload_type !== "agent_sessions") continue;
    const sourceApp = typeof proposal.source_app === "string" ? proposal.source_app : "";
    if (!sourceApp.startsWith(SESSION_HOOK_SOURCE_APP_PREFIX)) continue;
    const payload = proposalPayload(proposal);
    const entries = Array.isArray(payload?.agent_sessions) ? payload.agent_sessions : [];
    for (const entry of entries) {
      const sessionId = record(record(entry)?.session)?.id;
      if (typeof sessionId === "string" && sessionId) sourceApps.set(sessionId, sourceApp);
    }
  }
  return sourceApps;
}

export function agentSessionHasContent(session: AgentSession, sourceApp?: string | null): boolean {
  if (session.status === "active") return true;
  return !(
    sourceApp?.startsWith(SESSION_HOOK_SOURCE_APP_PREFIX) &&
    (session.response_checkpoints?.length || 0) === 0
  );
}

function presentationForSession({
  sessionHasContent,
  unresolved,
}: Pick<
  AgentWorkProjectionRow,
  "sessionHasContent" | "unresolved"
>): AgentWorkProjectionRow["presentation"] {
  if (unresolved) return "attention";
  return sessionHasContent ? "content" : "record";
}

function presentationOrder(value: AgentWorkProjectionRow["presentation"]): number {
  return value === "attention" ? 0 : value === "content" ? 1 : 2;
}

function prioritizeRows(rows: AgentWorkProjectionRow[]): AgentWorkProjectionRow[] {
  return [...rows].sort((left, right) => {
    const presentationComparison =
      presentationOrder(left.presentation) - presentationOrder(right.presentation);
    return (
      presentationComparison ||
      sessionTimestamp(right.session).localeCompare(sessionTimestamp(left.session))
    );
  });
}

export function buildAgentWorkProjection(
  domain: WorkspaceDomain,
  options: AgentWorkProjectionOptions = {},
): AgentWorkProjectionRow[] {
  const workingCopies = new Map(domain.working_copies.map((copy) => [copy.id, copy]));
  const taskById = new Map(domain.tasks.map((task) => [task.id, task]));
  const hookSourceApps = agentSessionHookSourceApps(domain.ai_proposals);
  const limit = options.limit ?? 20;

  const rows = domain.agent_sessions
    .map((session) => {
      const related = referencesForSession(domain.references, session.id);
      const themeIds = new Set(
        related.filter((ref) => ref.type === "project").map((ref) => ref.id),
      );
      const taskIds = new Set(related.filter((ref) => ref.type === "task").map((ref) => ref.id));
      const repositoryIds = new Set(
        related.filter((ref) => ref.type === "repository_context").map((ref) => ref.id),
      );
      for (const ref of related.filter((entry) => entry.type === "working_copy")) {
        const copy = workingCopies.get(ref.id);
        if (copy) repositoryIds.add(copy.repository_context_id);
      }
      for (const taskId of taskIds) {
        const projectId = taskById.get(taskId)?.project_id;
        if (projectId) themeIds.add(projectId);
      }

      const receipts = domain.work_receipts.filter(
        (receipt) =>
          related.some((ref) => ref.type === "work_receipt" && ref.id === receipt.id) ||
          (session.source_session_id && receipt.source_session === session.source_session_id),
      );
      const activities = domain.change_events.filter(
        (event) =>
          event.origin?.session_id === session.id ||
          Boolean(
            session.source_session_id && event.origin?.session_id === session.source_session_id,
          ),
      );
      const remaining = session.outcome?.remaining_work || [];
      const themes = byIds(domain.projects, themeIds);
      const repositories = byIds(domain.repository_contexts, repositoryIds);
      const tasks = byIds(domain.tasks, taskIds);
      const topic =
        tasks.length > 0 ? `${tasks[0].title} — ${session.intent.summary}` : session.intent.summary;
      const unresolved = session.status === "blocked" || remaining.length > 0;
      const sessionHasContent = agentSessionHasContent(session, hookSourceApps.get(session.id));
      const row = {
        session,
        sessionHasContent,
        sessionIdentity: compactSessionId(session.source_session_id || session.id),
        topic,
        result: session.outcome?.summary || null,
        requestCount: session.request_events?.length || 0,
        responseCount: session.response_checkpoints?.length || 0,
        date: localDate(sessionTimestamp(session)),
        themes,
        repositories,
        tasks,
        receipts,
        activities,
        unresolved,
        assignmentIncomplete: themes.length === 0 || repositories.length === 0,
      } satisfies Omit<AgentWorkProjectionRow, "presentation">;
      return {
        ...row,
        presentation: presentationForSession(row),
      } satisfies AgentWorkProjectionRow;
    })
    .filter((row) => !options.themeId || row.themes.some((theme) => theme.id === options.themeId))
    .filter(
      (row) =>
        !options.repositoryContextId ||
        row.repositories.some((repo) => repo.id === options.repositoryContextId),
    );

  if (!options.date) return prioritizeRows(rows).slice(0, limit);

  if (options.carryoverOnly) {
    return prioritizeRows(rows.filter((row) => row.date !== options.date && row.unresolved)).slice(
      0,
      limit,
    );
  }

  const current = rows.filter((row) => row.date === options.date);
  if (!options.includeUnresolved) return prioritizeRows(current).slice(0, limit);

  const handoffs = rows.filter((row) => row.date !== options.date && row.unresolved);
  return prioritizeRows([...current, ...handoffs]).slice(0, limit);
}

export function buildAgentSessionAssignmentOperations(
  sessionId: string,
  input: AgentSessionAssignmentInput,
): SaveOperation[] {
  const themeId = input.themeId.trim();
  const repositoryContextId = input.repositoryContextId?.trim() || "";
  if (!sessionId || !themeId) return [];

  const existingThemeIds = new Set(input.existingThemeIds || []);
  const existingRepositoryContextIds = new Set(input.existingRepositoryContextIds || []);
  const targets = [
    ...(existingThemeIds.has(themeId) ? [] : [{ type: "project" as const, id: themeId }]),
    ...(repositoryContextId && !existingRepositoryContextIds.has(repositoryContextId)
      ? [{ type: "repository_context" as const, id: repositoryContextId }]
      : []),
  ];
  const recordedAt = input.recordedAt || new Date().toISOString();
  const idFactory = input.idFactory || (() => crypto.randomUUID());

  return targets.map((target) => {
    const id = idFactory();
    return {
      action: "save",
      type: "reference",
      entity: {
        id,
        assertion_id: id,
        subject: { type: "agent_session", id: sessionId },
        predicate: "worked_on",
        object: target,
        layer: "operational",
        status: "asserted",
        origin: "user",
        evidence_refs: [],
        confidence: null,
        metadata: {},
        recorded_at: recordedAt,
        superseded_by_assertion_id: null,
        source_type: "agent_session",
        source_id: sessionId,
        target_type: target.type,
        target_id: target.id,
        relation_type: "worked_on",
      },
    } satisfies SaveOperation;
  });
}

export function groupAgentWorkProjection(
  rows: AgentWorkProjectionRow[],
): AgentWorkProjectionGroup[] {
  const groups = new Map<string, AgentWorkProjectionGroup>();
  for (const row of rows) {
    const themes = [...row.themes].sort((left, right) => left.name.localeCompare(right.name, "ja"));
    const repositories = [...row.repositories].sort((left, right) =>
      String(left.label || left.repository_slug || "Repository").localeCompare(
        String(right.label || right.repository_slug || "Repository"),
        "ja",
      ),
    );
    const themeKey = themes.length ? themes.map((theme) => theme.id).join(":") : "unassigned";
    const repositoryKey = repositories.length
      ? repositories.map((repository) => repository.id).join(":")
      : "unassigned";
    const key = `${themeKey}|${repositoryKey}`;
    const current = groups.get(key) || {
      key,
      themeLabel: themes.length ? themes.map((theme) => theme.name).join(" / ") : "Theme未割当",
      repositoryLabel: repositories.length
        ? repositories
            .map((repository) =>
              String(repository.label || repository.repository_slug || "Repository"),
            )
            .join(" · ")
        : "Repository未割当",
      rows: [],
    };
    current.rows.push(row);
    groups.set(key, current);
  }
  return [...groups.values()].sort((left, right) => {
    const leftUnassigned = left.themeLabel === "Theme未割当";
    const rightUnassigned = right.themeLabel === "Theme未割当";
    if (leftUnassigned !== rightUnassigned) return leftUnassigned ? 1 : -1;
    const themeComparison = left.themeLabel.localeCompare(right.themeLabel, "ja");
    return themeComparison || left.repositoryLabel.localeCompare(right.repositoryLabel, "ja");
  });
}
