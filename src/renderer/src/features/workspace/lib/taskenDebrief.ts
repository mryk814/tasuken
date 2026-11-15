import type { BaseRecord } from "../types";
import { taskWorkPeriods } from "../../../../../shared/contracts/task/public.ts";
import {
  agentWorkCardFromSession,
  agentWorkCardHasContent,
  agentWorkCardHeadline,
  listAgentWorkCards,
  type AgentWorkCard,
} from "../../../../../shared/agentWorkCard.ts";
import type { AgentSession, WorkspaceDomain } from "../domain-model/types";
import {
  agentSessionHasContent,
  agentSessionHookSourceApps,
} from "../domain-model/agentSessionProjection.ts";

export const TASKEN_DEBRIEF_SCHEMA_VERSION = 1;

export type DebriefEvidenceStrength = "observed" | "agent_reported" | "inferred";

export interface DebriefSessionEvidence {
  id: string;
  sessionId: string;
  sourceSessionId: string;
  clientKind: string;
  startedAt: string;
  endedAt: string | null;
  status: string;
  intent: string;
  outcome: string;
  /** 変えた物の名前。 */
  changed: string[];
  verification: string[];
  remainingWork: string[];
  strength: DebriefEvidenceStrength;
  hasContent: boolean;
  taskId?: string;
  reviewStatus?: string;
  proposal?: BaseRecord;
}

export interface TaskenDebriefRecord {
  schema_version: 1;
  kind: "daily" | "weekly";
  period_start: string;
  period_end: string;
  source_session_ids: string[];
  evidence_corrections: string[];
  decision: string;
  adaptive_question?: string | null;
  adaptive_answer?: string | null;
  next_return: {
    trigger: string;
    first_action: string;
    resume_state: "planned" | "not_planned";
  };
  completed_at: string;
  duration_seconds?: number | null;
  weekly_reflection?: {
    repeated_pattern: string;
    stalled_return: string;
    delegation_boundary: string;
  } | null;
}

interface DebriefNote {
  id: string;
  note_type?: string | null;
  deleted_at?: string | null;
  properties_json?: Record<string, unknown>;
}

export function dailyReportDate(note: DebriefNote): string | null {
  if (note.deleted_at || note.note_type !== "report") return null;
  const report = record(note.properties_json?.daily_report);
  return typeof report?.date === "string" ? report.date : null;
}

export function buildDailyReportRequest(date: string): string {
  return [
    `${date} の日報をTasken MCPでまとめてください。`,
    `tasken.get_activityにdate: "${date}"を指定して、この日のActivityを確認してください。AIの作業は、その応答のagent_work（要約・変えた物・確かめたこと・残り）にあります。daily-reportコマンドの当日ではなく、ここで指定した日付を使ってください。Repositoryで絞らず、収集済みの一日の作業全体を扱い、raw logは再収集しないでください。`,
    "取得したContextのwriting_guidanceに沿って、作業ごとの成果・記録された判断・未解決事項をまとめてください。回答や人間の判断を推測で埋めず、採用後に人間がNotesのMarkdownへ追記する問いとして残してください。",
    `草稿はtasken.propose_noteのnote_type: "report", report_date: "${date}"で提案してください。Theme未指定は個人業務です。正式保存はAgent Deskでの確認・採用に委ねてください。`,
  ].join("\n\n");
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function localDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** AI の作業のカード → 日誌の根拠。新しい記録も古い会話も、同じ読み方を通る（#751）。 */
function evidenceFromCard(
  card: AgentWorkCard,
  options: { proposal?: BaseRecord; hasContent?: boolean } = {},
): DebriefSessionEvidence {
  return {
    id: options.proposal ? `proposal:${options.proposal.id}` : `session:${card.id}`,
    sessionId: card.id,
    sourceSessionId: card.source_session_id || card.id,
    clientKind: card.client_kind,
    startedAt: card.started_at || card.ended_at,
    endedAt: card.running ? null : card.ended_at,
    status: card.running ? "active" : card.status,
    intent: card.intent || agentWorkCardHeadline(card),
    outcome: card.summary || (card.running ? "作業中です。" : "結果の記録なし"),
    changed: card.changed,
    verification: card.verified,
    remainingWork: card.remaining,
    strength: "agent_reported",
    hasContent: options.hasContent ?? agentWorkCardHasContent(card),
    proposal: options.proposal,
  };
}

function proposalPayload(proposal: BaseRecord): Record<string, unknown> | null {
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

function sessionsFromProposal(proposal: BaseRecord): AgentSession[] {
  if (proposal.payload_type !== "agent_sessions" || proposal.status !== "pending") return [];
  const payload = proposalPayload(proposal);
  const entries = Array.isArray(payload?.agent_sessions) ? payload.agent_sessions : [];
  return entries.flatMap((entry) => {
    const session = record(record(entry)?.session);
    return session ? [session as unknown as AgentSession] : [];
  });
}

/**
 * 外部AI clientの接続hookが送ったAgent Sessionの観測。
 * 判断待ちではないため要対応に数えない（#596）。規則の正本はshared contract側に置く。
 */
import { isPassiveAgentSessionProposal } from "../../../../../shared/contracts/task/public.ts";
export { isPassiveAgentSessionProposal };
export function buildDailyDebriefEvidence(
  domain: WorkspaceDomain,
  date: string,
): DebriefSessionEvidence[] {
  const hookSourceApps = agentSessionHookSourceApps(domain.ai_proposals);
  const sessionById = new Map((domain.agent_sessions || []).map((entry) => [entry.id, entry]));
  const onDate = (card: AgentWorkCard) => localDate(card.started_at || card.ended_at) === date;
  const canonical = listAgentWorkCards({
    records: domain.agent_work_records,
    sessions: domain.agent_sessions,
    references: domain.references,
    working_copies: domain.working_copies,
  })
    .filter(onDate)
    .map((card) => {
      const session = card.origin === "session" ? sessionById.get(card.id) : undefined;
      return evidenceFromCard(card, {
        hasContent: session
          ? agentSessionHasContent(session, hookSourceApps.get(session.id))
          : undefined,
      });
    });
  const canonicalSessionIds = new Set(canonical.map((entry) => entry.sessionId));
  const pending = domain.ai_proposals.flatMap((proposal) => {
    const base = proposal as BaseRecord;
    if (!isPassiveAgentSessionProposal(base)) return [];
    return sessionsFromProposal(base).flatMap((session) => {
      const card = agentWorkCardFromSession(session);
      if (!card || !onDate(card) || canonicalSessionIds.has(card.id)) return [];
      return [
        evidenceFromCard(card, {
          proposal: base,
          hasContent: agentSessionHasContent(session, hookSourceApps.get(session.id)),
        }),
      ];
    });
  });
  const taskWork: DebriefSessionEvidence[] = taskWorkPeriods(
    domain.tasks as unknown as BaseRecord[],
    domain.ai_proposals,
    domain.work_receipts as unknown as BaseRecord[],
  )
    .filter(
      (work) =>
        localDate(work.started_at) <= date &&
        localDate(
          new Date(
            Math.max(
              Date.parse(work.started_at),
              Date.parse(work.ended_at || new Date().toISOString()) - 1,
            ),
          ).toISOString(),
        ) >= date,
    )
    .map((work) => ({
      id: work.id,
      sessionId: "",
      sourceSessionId: work.source_session || "",
      taskId: work.task_id,
      clientKind: work.executor_label,
      startedAt: work.started_at,
      endedAt: work.ended_at,
      status: work.status,
      reviewStatus: work.review_status,
      intent: work.title,
      outcome: work.summary,
      changed: [],
      verification: work.verification,
      remainingWork: work.remaining_work,
      strength: "agent_reported",
      hasContent: Boolean(
        work.summary || work.verification.length > 0 || work.remaining_work.length > 0,
      ),
      proposal:
        work.review_status === "pending"
          ? domain.ai_proposals.find((proposal) => proposal.id === work.proposal_id)
          : undefined,
    }));
  const seenSessionIds = new Set<string>();
  const sessionEvidence = [...canonical, ...pending]
    .sort(
      (left, right) =>
        Number(right.hasContent) - Number(left.hasContent) ||
        left.startedAt.localeCompare(right.startedAt),
    )
    .filter((entry) => {
      const key = entry.sessionId;
      if (seenSessionIds.has(key)) return false;
      seenSessionIds.add(key);
      return true;
    });
  return [...sessionEvidence, ...taskWork].sort((left, right) =>
    left.startedAt.localeCompare(right.startedAt),
  );
}

export function readTaskenDebrief(note: DebriefNote | undefined): TaskenDebriefRecord | null {
  const value = record(note?.properties_json?.tasken_debrief);
  if (!value || value.schema_version !== TASKEN_DEBRIEF_SCHEMA_VERSION) return null;
  const nextReturn = record(value.next_return);
  if (!nextReturn) return null;
  const weeklyReflection = record(value.weekly_reflection);
  return {
    schema_version: 1,
    kind: value.kind === "weekly" ? "weekly" : "daily",
    period_start: stringValue(value.period_start),
    period_end: stringValue(value.period_end),
    source_session_ids: stringList(value.source_session_ids),
    evidence_corrections: stringList(value.evidence_corrections),
    decision: stringValue(value.decision),
    adaptive_question: stringValue(value.adaptive_question) || null,
    adaptive_answer: stringValue(value.adaptive_answer) || null,
    next_return: {
      trigger: stringValue(nextReturn.trigger),
      first_action: stringValue(nextReturn.first_action),
      resume_state: nextReturn.resume_state === "not_planned" ? "not_planned" : "planned",
    },
    completed_at: stringValue(value.completed_at),
    duration_seconds: typeof value.duration_seconds === "number" ? value.duration_seconds : null,
    weekly_reflection: weeklyReflection
      ? {
          repeated_pattern: stringValue(weeklyReflection.repeated_pattern),
          stalled_return: stringValue(weeklyReflection.stalled_return),
          delegation_boundary: stringValue(weeklyReflection.delegation_boundary),
        }
      : null,
  };
}

export function findDailyDebriefNote<T extends DebriefNote>(
  notes: T[],
  date: string,
): T | undefined {
  return notes.find((note) => dailyReportDate(note) === date);
}
