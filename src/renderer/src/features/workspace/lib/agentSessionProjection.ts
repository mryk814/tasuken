import { normalizeReferenceAssertion } from "../../../../../shared/relationAssertion.mjs";
import type { RepositoryContext } from "../../../../../shared/repositoryContext.mjs";

import type {
  AgentSession,
  ChangeEvent,
  Project,
  Reference,
  Task,
  WorkReceipt,
  WorkingCopy,
  WorkspaceDomain,
} from "../domain-model/types";

export interface AgentWorkProjectionRow {
  session: AgentSession;
  date: string;
  themes: Project[];
  repositories: RepositoryContext[];
  tasks: Task[];
  receipts: WorkReceipt[];
  activities: ChangeEvent[];
  unresolved: boolean;
}

export interface AgentWorkProjectionOptions {
  date?: string;
  themeId?: string;
  repositoryContextId?: string;
  includeUnresolved?: boolean;
  limit?: number;
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

export function buildAgentWorkProjection(
  domain: WorkspaceDomain,
  options: AgentWorkProjectionOptions = {},
): AgentWorkProjectionRow[] {
  const workingCopies = new Map(domain.working_copies.map((copy) => [copy.id, copy]));
  const taskById = new Map(domain.tasks.map((task) => [task.id, task]));
  const limit = options.limit ?? 20;

  const rows = domain.agent_sessions
    .map((session) => {
      const related = referencesForSession(domain.references, session.id);
      const themeIds = new Set(related.filter((ref) => ref.type === "project").map((ref) => ref.id));
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

      const receipts = domain.work_receipts.filter((receipt) => (
        related.some((ref) => ref.type === "work_receipt" && ref.id === receipt.id)
        || (session.source_session_id && receipt.source_session === session.source_session_id)
      ));
      const activities = domain.change_events.filter((event) => (
        event.origin?.session_id === session.id
        || Boolean(session.source_session_id && event.origin?.session_id === session.source_session_id)
      ));
      const remaining = session.outcome?.remaining_work || [];
      return {
        session,
        date: localDate(sessionTimestamp(session)),
        themes: byIds(domain.projects, themeIds),
        repositories: byIds(domain.repository_contexts, repositoryIds),
        tasks: byIds(domain.tasks, taskIds),
        receipts,
        activities,
        unresolved: session.status === "blocked" || remaining.length > 0,
      } satisfies AgentWorkProjectionRow;
    })
    .filter((row) => !options.themeId || row.themes.some((theme) => theme.id === options.themeId))
    .filter((row) => !options.repositoryContextId || row.repositories.some((repo) => repo.id === options.repositoryContextId))
    .sort((left, right) => sessionTimestamp(right.session).localeCompare(sessionTimestamp(left.session)));

  if (!options.date) return rows.slice(0, limit);

  const current = rows.filter((row) => row.date === options.date);
  if (!options.includeUnresolved) return current.slice(0, limit);

  const handoffs = rows.filter((row) => row.date !== options.date && row.unresolved);
  const handoffLimit = current.length > 0
    ? Math.min(3, handoffs.length, Math.max(0, limit - 1))
    : Math.min(handoffs.length, limit);
  return [...current.slice(0, limit - handoffLimit), ...handoffs.slice(0, handoffLimit)]
    .sort((left, right) => sessionTimestamp(right.session).localeCompare(sessionTimestamp(left.session)));
}
