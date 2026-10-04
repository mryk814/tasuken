import type { AgentSession } from "../domain-model/types";
import { buildActivityTimelineLayout } from "./activityTimelineLayout.ts";

/** A span is observation evidence, never a measure of active work. */
export function agentSessionInterval(
  session: Pick<AgentSession, "started_at" | "ended_at" | "status" | "observation">,
  now: string,
) {
  const start = Date.parse(session.started_at);
  const observed = session.observation?.observed_until;
  const recordedEnd = session.ended_at;
  const valid = (value: string | null | undefined) =>
    !!value && Number.isFinite(Date.parse(value)) && Date.parse(value) >= start;
  if (
    valid(observed) &&
    (!valid(recordedEnd) || Date.parse(observed!) < Date.parse(recordedEnd!))
  ) {
    return { end: observed!, endLabel: "最終観測" };
  }
  if (valid(recordedEnd)) {
    return {
      end: recordedEnd!,
      endLabel:
        session.status === "completed" ? "終了" : session.observation ? "最終観測" : "記録末尾",
    };
  }
  if (!session.observation && session.status === "active" && valid(now)) {
    return { end: now, endLabel: "現在" };
  }
  return { end: session.started_at, endLabel: "終了未確認" };
}

export function buildAgentDayLayout<T extends { session: AgentSession }>(
  rows: T[],
  date: string,
  now: string,
  dayStart = Date.parse(`${date}T00:00:00+09:00`),
) {
  return buildActivityTimelineLayout(
    rows.map((row) => ({
      id: row.session.id,
      start_at: row.session.started_at,
      end_at: agentSessionInterval(row.session, now).end,
      row,
    })),
    { date, pixelsPerHour: 52, pointHeight: 44, dayStart },
  );
}

export function agentDateText(value: Date) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(value);
}
