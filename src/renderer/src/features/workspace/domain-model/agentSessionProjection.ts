import {
  agentWorkCardHasContent,
  agentWorkCardHeadline,
  agentWorkCardUnresolved,
  buildAgentSessionLinks,
  listAgentWorkCards,
  type AgentWorkCard,
} from "../../../../../shared/agentWorkCard.ts";
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
  /** 読む時の 1 つの形。新しい記録も、古い会話の読み替えも、ここから読む。 */
  card: AgentWorkCard;
  /** 古い会話のカードだけ: 元の会話（関連付けを足す時に使う）。新しい記録は書き換えないので null。 */
  session: AgentSession | null;
  /** カードの 1 行（要約の最初の一文）。 */
  headline: string;
  hasContent: boolean;
  date: string;
  themes: Project[];
  repositories: RepositoryContext[];
  tasks: Task[];
  receipts: WorkReceipt[];
  /** 記録が指しているが、今は無い（消えた）テーマ・リポジトリ・Task の数。 */
  missingLinkCount: number;
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

/** Main に問い合わせる、Sessionの来歴の origin.session_id（#755 束0b）。 */
export function agentSessionActivityIds(
  session: Pick<AgentSession, "id" | "source_session_id">,
): string[] {
  return [session.id, session.source_session_id].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
}

/**
 * Sessionの活動（origin.session_id が session.id か source_session_id に一致するEvent）。
 * 渡した並びのまま返す。来歴は Workspace に載らないので、画面は agentSessionActivityIds で
 * Main から読んだEventを渡す（#755 束0b）。
 */
export function agentSessionActivities<T extends Pick<ChangeEvent, "origin">>(
  events: T[],
  session: Pick<AgentSession, "id" | "source_session_id">,
): T[] {
  return events.filter(
    (event) =>
      event.origin?.session_id === session.id ||
      Boolean(session.source_session_id && event.origin?.session_id === session.source_session_id),
  );
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

function presentationFor({
  hasContent,
  unresolved,
}: Pick<
  AgentWorkProjectionRow,
  "hasContent" | "unresolved"
>): AgentWorkProjectionRow["presentation"] {
  if (unresolved) return "attention";
  return hasContent ? "content" : "record";
}

function presentationOrder(value: AgentWorkProjectionRow["presentation"]): number {
  return value === "attention" ? 0 : value === "content" ? 1 : 2;
}

function prioritizeRows(rows: AgentWorkProjectionRow[]): AgentWorkProjectionRow[] {
  return [...rows].sort((left, right) => {
    const presentationComparison =
      presentationOrder(left.presentation) - presentationOrder(right.presentation);
    return presentationComparison || right.card.ended_at.localeCompare(left.card.ended_at);
  });
}

/**
 * AI の作業を、画面の行にする。古い会話（agent_sessions）と新しい記録（agent_work_records）は
 * `listAgentWorkCards` の 1 つの読み替えを通り、ここから先は同じカードとして扱う（#751）。
 */
export function buildAgentWorkProjection(
  domain: WorkspaceDomain,
  options: AgentWorkProjectionOptions = {},
): AgentWorkProjectionRow[] {
  const hookSourceApps = agentSessionHookSourceApps(domain.ai_proposals);
  const limit = options.limit ?? 20;
  const sessionById = new Map(domain.agent_sessions.map((session) => [session.id, session]));
  const sessionLinks = buildAgentSessionLinks({ references: domain.references });
  const themeById = new Map(domain.projects.map((theme) => [theme.id, theme]));
  const repositoryById = new Map(domain.repository_contexts.map((repo) => [repo.id, repo]));
  const taskById = new Map(domain.tasks.map((task) => [task.id, task]));
  const present = <T>(ids: string[], records: Map<string, T>): T[] =>
    ids.flatMap((id) => {
      const found = records.get(id);
      return found ? [found] : [];
    });

  const rows = listAgentWorkCards({
    records: domain.agent_work_records || [],
    sessions: domain.agent_sessions,
    references: domain.references,
    working_copies: domain.working_copies,
    tasks: domain.tasks,
  })
    .map((card) => {
      const session = card.origin === "session" ? sessionById.get(card.id) || null : null;
      const themes = present(card.theme_ids, themeById);
      const repositories = present(card.repository_context_ids, repositoryById);
      const tasks = present(card.task_ids, taskById);
      const receiptIds = new Set(session ? sessionLinks.get(session.id)?.work_receipt_ids : []);
      const receipts = domain.work_receipts.filter(
        (receipt) =>
          receiptIds.has(receipt.id) ||
          (card.source_session_id && receipt.source_session === card.source_session_id),
      );
      const unresolved = agentWorkCardUnresolved(card);
      const hasContent = session
        ? agentSessionHasContent(session, hookSourceApps.get(session.id))
        : agentWorkCardHasContent(card);
      const row = {
        card,
        session,
        headline: agentWorkCardHeadline(card),
        hasContent,
        date: localDate(card.ended_at),
        themes,
        repositories,
        tasks,
        receipts,
        // 関わる記録が消えても、記録そのものは残る。読む側が「今は無い」と出す。
        missingLinkCount:
          card.theme_ids.length +
          card.repository_context_ids.length +
          card.task_ids.length -
          themes.length -
          repositories.length -
          tasks.length,
        unresolved,
        // 関連付けを後から足せるのは古い会話だけ（新しい記録は書き換えない）。
        assignmentIncomplete:
          Boolean(session) && (themes.length === 0 || repositories.length === 0),
      } satisfies Omit<AgentWorkProjectionRow, "presentation">;
      return { ...row, presentation: presentationFor(row) } satisfies AgentWorkProjectionRow;
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

export function buildAgentSessionTaskOperations(
  sessionId: string,
  taskId: string,
  references: Reference[],
  linked: boolean,
): Array<SaveOperation | { action: "remove"; type: "reference"; entity: Reference }> {
  if (!sessionId || !taskId) return [];
  const matches = references.filter((reference) => {
    try {
      const value = normalizeReferenceAssertion(reference as unknown as Record<string, unknown>, {
        legacyRead: true,
      }) as unknown as {
        subject: { type: string; id: string };
        object: { type: string; id: string };
        status: string;
      };
      const endpoints = [value.subject, value.object];
      return (
        value.status !== "superseded" &&
        endpoints.some((entry) => entry.type === "agent_session" && entry.id === sessionId) &&
        endpoints.some((entry) => entry.type === "task" && entry.id === taskId)
      );
    } catch {
      return false;
    }
  });
  if (!linked) {
    return matches.map((reference) => ({
      action: "remove",
      type: "reference",
      entity: reference,
    }));
  }
  if (matches.length) return [];
  const id = crypto.randomUUID();
  return [
    {
      action: "save",
      type: "reference",
      entity: {
        id,
        assertion_id: id,
        subject: { type: "agent_session", id: sessionId },
        predicate: "worked_on",
        object: { type: "task", id: taskId },
        layer: "operational",
        status: "asserted",
        origin: "user",
        recorded_at: new Date().toISOString(),
        evidence_refs: [],
        metadata: {},
        confidence: null,
        superseded_by_assertion_id: null,
      },
    },
  ];
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
