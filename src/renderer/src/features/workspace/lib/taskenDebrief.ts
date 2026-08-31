import type { BaseRecord } from "../types";
import type { AgentSession, WorkspaceDomain } from "../domain-model/types";
import { agentSessionHasContent, agentSessionHookSourceApps } from "./agentSessionProjection.ts";

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
  requests: Array<{ observedAt: string; text: string }>;
  responses: Array<{ observedAt: string; text: string }>;
  verification: string[];
  remainingWork: string[];
  strength: DebriefEvidenceStrength;
  hasContent: boolean;
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
    `tasken.get_debrief_contextにdate: "${date}", include_recent_debriefs: falseを指定して、この日の通常ActivityとAI Sessionを確認してください。daily-reportコマンドの当日ではなく、ここで指定した日付を使ってください。Repositoryで絞らず、収集済みの一日の作業全体を扱い、raw logは再収集しないでください。`,
    "取得したContextのwriting_guidanceに沿って、作業ごとの成果・記録された判断・未解決事項をまとめてください。回答や人間の判断を推測で埋めず、採用後に人間がNotesのMarkdownへ追記する問いとして残してください。",
    `草稿はtasken.propose_noteのnote_type: "report", report_date: "${date}"で提案してください。Theme未指定は個人業務です。正式保存はAI Inboxでの確認・採用に委ねてください。`,
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

function checkpoints(value: unknown): Array<{ observedAt: string; text: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const candidate = record(entry);
    if (!candidate) return [];
    const observedAt = stringValue(candidate.observed_at);
    const text = stringValue(candidate.text);
    return observedAt && text ? [{ observedAt, text }] : [];
  });
}

function evidenceFromSession(
  session: AgentSession,
  proposal?: BaseRecord,
  sourceApp?: string,
): DebriefSessionEvidence {
  return {
    id: proposal ? `proposal:${proposal.id}` : `session:${session.id}`,
    sessionId: session.id,
    sourceSessionId: session.source_session_id || session.id,
    clientKind: session.client_kind,
    startedAt: session.started_at,
    endedAt: session.ended_at || null,
    status: session.status,
    intent: session.intent.summary,
    outcome:
      session.outcome?.summary || (session.status === "active" ? "作業中です。" : "結果の記録なし"),
    requests: checkpoints(session.request_events),
    responses: checkpoints(session.response_checkpoints),
    verification: session.outcome?.verification || [],
    remainingWork: session.outcome?.remaining_work || [],
    strength: "agent_reported",
    hasContent: agentSessionHasContent(session, sourceApp),
    proposal,
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

export function isPassiveAgentSessionProposal(proposal: Record<string, unknown>): boolean {
  return (
    proposal.status === "pending" &&
    proposal.payload_type === "agent_sessions" &&
    stringValue(proposal.source_app).startsWith("tasken-session-hook:")
  );
}

export function buildDailyDebriefEvidence(
  domain: WorkspaceDomain,
  date: string,
): DebriefSessionEvidence[] {
  const hookSourceApps = agentSessionHookSourceApps(domain.ai_proposals);
  const canonical = domain.agent_sessions
    .filter((session) => localDate(session.started_at) === date)
    .map((session) => evidenceFromSession(session, undefined, hookSourceApps.get(session.id)));
  const canonicalSourceIds = new Set(canonical.map((entry) => entry.sourceSessionId));
  const pending = domain.ai_proposals.flatMap((proposal) => {
    const base = proposal as BaseRecord;
    if (!isPassiveAgentSessionProposal(base)) return [];
    return sessionsFromProposal(base)
      .filter((session) => localDate(session.started_at) === date)
      .filter((session) => !canonicalSourceIds.has(session.source_session_id || session.id))
      .map((session) => evidenceFromSession(session, base, hookSourceApps.get(session.id)));
  });
  return [...canonical, ...pending].sort((left, right) =>
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
