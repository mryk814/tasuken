import type { CommandEnvelope } from "../../../../../shared/applicationCommand";
import type { BaseRecord } from "../types";
import type { AgentSession, WorkspaceDomain } from "../domain-model/types";

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
  properties_json?: Record<string, unknown>;
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
  const explicitLocalDate = /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(value)?.[1];
  if (explicitLocalDate) return explicitLocalDate;
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

function evidenceFromSession(session: AgentSession, proposal?: BaseRecord): DebriefSessionEvidence {
  return {
    id: proposal ? `proposal:${proposal.id}` : `session:${session.id}`,
    sessionId: session.id,
    sourceSessionId: session.source_session_id || session.id,
    clientKind: session.client_kind,
    startedAt: session.started_at,
    endedAt: session.ended_at || null,
    status: session.status,
    intent: session.intent.summary,
    outcome: session.outcome?.summary || "作業中です。",
    requests: checkpoints(session.request_events),
    responses: checkpoints(session.response_checkpoints),
    verification: session.outcome?.verification || [],
    remainingWork: session.outcome?.remaining_work || [],
    strength: "agent_reported",
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
  const canonical = domain.agent_sessions
    .filter((session) => localDate(session.started_at) === date)
    .map((session) => evidenceFromSession(session));
  const canonicalSourceIds = new Set(canonical.map((entry) => entry.sourceSessionId));
  const pending = domain.ai_proposals.flatMap((proposal) => {
    const base = proposal as BaseRecord;
    if (!isPassiveAgentSessionProposal(base)) return [];
    return sessionsFromProposal(base)
      .filter((session) => localDate(session.started_at) === date)
      .filter((session) => !canonicalSourceIds.has(session.source_session_id || session.id))
      .map((session) => evidenceFromSession(session, base));
  });
  return [...canonical, ...pending].sort((left, right) =>
    left.startedAt.localeCompare(right.startedAt),
  );
}

export function selectAdaptiveQuestion(evidence: DebriefSessionEvidence[]): string | null {
  if (evidence.some((entry) => entry.status === "blocked" || entry.remainingWork.length > 0)) {
    return "残っている最初の障害と、試せる代替策は何か？";
  }
  if (evidence.some((entry) => entry.status === "completed" && entry.verification.length === 0)) {
    return "何を確認できれば、自分の判断として完了と言える？";
  }
  if (evidence.some((entry) => entry.requests.length > 1)) {
    return "途中で方針を変えたとき、判断を変えた観測事実は何だった？";
  }
  return null;
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
  return notes.find((note) => {
    const debrief = readTaskenDebrief(note);
    return (
      debrief?.kind === "daily" && debrief.period_start === date && debrief.period_end === date
    );
  });
}

export function weeklyDebriefPeriod(date: string): { start: string; end: string } {
  const end = new Date(`${date}T12:00:00`);
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  return { start: localDate(start.toISOString()), end: date };
}

export function dailyDebriefsForPeriod<T extends DebriefNote>(
  notes: T[],
  start: string,
  end: string,
): Array<{ note: T; debrief: TaskenDebriefRecord }> {
  return notes
    .flatMap((note) => {
      const debrief = readTaskenDebrief(note);
      return debrief?.kind === "daily" && debrief.period_start >= start && debrief.period_end <= end
        ? [{ note, debrief }]
        : [];
    })
    .sort((left, right) => left.debrief.period_start.localeCompare(right.debrief.period_start));
}

export function findWeeklyDebriefNote<T extends DebriefNote>(
  notes: T[],
  start: string,
  end: string,
): T | undefined {
  return notes.find((note) => {
    const debrief = readTaskenDebrief(note);
    return (
      debrief?.kind === "weekly" && debrief.period_start === start && debrief.period_end === end
    );
  });
}

export function buildWeeklyDebriefMarkdown(
  daily: Array<{ debrief: TaskenDebriefRecord }>,
  debrief: TaskenDebriefRecord,
): string {
  const reflection = debrief.weekly_reflection;
  return [
    `# Tasken Debrief Weekly — ${debrief.period_start}–${debrief.period_end}`,
    "",
    "## Daily decisions",
    "",
    ...(daily.length
      ? daily.flatMap(({ debrief: entry }) => [`### ${entry.period_start}`, entry.decision, ""])
      : ["この期間のDaily Debriefはありません。", ""]),
    "## Repeated pattern",
    "",
    reflection?.repeated_pattern || "",
    "",
    "## Stalled return",
    "",
    reflection?.stalled_return || "",
    "",
    "## Delegation boundary",
    "",
    reflection?.delegation_boundary || "",
    "",
  ].join("\n");
}

export function buildTaskenDebriefMarkdown(
  date: string,
  evidence: DebriefSessionEvidence[],
  debrief: TaskenDebriefRecord,
): string {
  const evidenceLines = evidence.length
    ? evidence.flatMap((entry) => [
        `### ${entry.outcome}`,
        `- Intent: ${entry.intent}`,
        `- Client: ${entry.clientKind}`,
        `- Evidence: ${entry.strength}`,
        ...(entry.verification.length ? [`- Verification: ${entry.verification.join(" / ")}`] : []),
        ...(entry.remainingWork.length ? [`- Remaining: ${entry.remainingWork.join(" / ")}`] : []),
        "",
      ])
    : ["対象となるAI sessionはありません。", ""];
  return [
    `# Tasken Debrief — ${date}`,
    "",
    "## Evidence",
    "",
    ...evidenceLines,
    ...(debrief.evidence_corrections.length
      ? [
          "## Evidence corrections",
          "",
          ...debrief.evidence_corrections.map((entry) => `- ${entry}`),
          "",
        ]
      : []),
    "## My decision",
    "",
    debrief.decision,
    "",
    ...(debrief.adaptive_question
      ? [
          "## One question",
          "",
          `> ${debrief.adaptive_question}`,
          "",
          debrief.adaptive_answer || "",
          "",
        ]
      : []),
    "## Next return",
    "",
    debrief.next_return.resume_state === "not_planned"
      ? "今は再開しない。"
      : `- Trigger: ${debrief.next_return.trigger}\n- First action: ${debrief.next_return.first_action}`,
    "",
  ].join("\n");
}

export function buildAgentSessionAcceptanceCommand(proposal: BaseRecord): CommandEnvelope | null {
  const payload = proposalPayload(proposal);
  const entries = Array.isArray(payload?.agent_sessions) ? payload.agent_sessions : [];
  const candidates: Array<{ type: "agent_session" | "reference"; entity: BaseRecord }> = [];
  for (const entry of entries) {
    const candidate = record(entry);
    const session = record(candidate?.session);
    const references = Array.isArray(candidate?.references)
      ? candidate.references.map(record).filter(Boolean)
      : [];
    if (session && stringValue(session.id)) {
      candidates.push({ type: "agent_session", entity: session as BaseRecord });
    }
    for (const reference of references) {
      if (reference && stringValue(reference.id)) {
        candidates.push({ type: "reference", entity: reference as BaseRecord });
      }
    }
  }
  if (!candidates.length) return null;
  return {
    commandId: `${proposal.id}:debrief-accept:v${Number(proposal.version || 0)}`,
    name: "ApplyAiProposal",
    payload: {
      proposal: { ...proposal, status: "accepted" },
      candidates,
    },
    actor: { kind: "user" },
    source: "main_ui",
    expectedVersions: [
      { type: "ai_proposal", id: proposal.id, version: Number(proposal.version || 0) },
    ],
    issuedAt:
      stringValue(proposal.received_at || proposal.created_at || proposal.updated_at) ||
      new Date().toISOString(),
  };
}
