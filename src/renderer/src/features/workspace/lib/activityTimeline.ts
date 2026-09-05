export type ActivityDisplayKind = "ai_work" | "outcome" | "record" | "organize";

type ActivityThemeSource = {
  theme_ref?: { kind?: unknown; id?: unknown };
  relation_refs?: Array<{ type?: unknown; id?: unknown }>;
};

type ActivityTimelineItem = {
  id: string;
  start_at: string;
  end_at?: string | null;
};

type ActivityTimelineOptions = {
  minimumMinutes?: number;
  pixelsPerHour?: number;
  maxPixels?: number;
};

type ActivitySessionIntervalSource = {
  started_at?: unknown;
  ended_at?: unknown;
};

export type ActivitySessionInterval = {
  start_at: string;
  end_at: string;
};

export type ActivitySessionLogEntry = {
  time_label: string;
  client_label: string;
  theme_names: string[];
  intent: string;
  outcome?: string;
  repository_names?: string[];
  remaining_work?: string[];
};

type ActivitySessionProjectionRow = {
  session: {
    id: string;
    source_session_id?: string | null;
    started_at: string;
    ended_at?: string | null;
    client_kind: string;
    client_label?: string | null;
    intent: { summary: string };
    outcome?: { summary: string; remaining_work: string[] } | null;
  };
  themes: Array<{ id: string }>;
  repositories: Array<{ label: string }>;
};

export type ActivitySessionEvent = ActivityThemeSource & {
  event_kind?: string;
  entity_ref?: { type?: string };
  entity_type?: string;
  origin?: { session_id?: string };
};

export type DailyAgentSessionContext<
  TEvent extends ActivitySessionEvent = ActivitySessionEvent,
  TRow extends ActivitySessionProjectionRow = ActivitySessionProjectionRow,
> = {
  sessionRow: TRow;
  interval: ActivitySessionInterval;
  events: TEvent[];
  themeIds: string[];
};

const outcomeEventKinds = new Set([
  "task_completed",
  "task_work_recorded",
  "task_ai_reported",
  "task_ai_accepted",
  "task_ai_returned",
  "waiting_received",
]);

const recordEventKinds = new Set([
  "note_created",
  "note_updated",
  "report_created",
  "report_updated",
  "prompt_created",
  "prompt_updated",
  "resource_added",
  "resource_updated",
  "artifact_added",
  "artifact_updated",
  "knowledge_created",
  "knowledge_updated",
  "sketch_created",
  "sketch_updated",
  "capture_formalized",
  "status_updated",
]);

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

export function activityDisplayKind({
  eventKind,
  entityType,
}: {
  eventKind?: unknown;
  entityType?: unknown;
} = {}): ActivityDisplayKind {
  const entity = text(entityType);
  if (entity === "agent_session") return "ai_work";
  const kind = text(eventKind);
  if (kind === "task_ai_work") return "ai_work";
  if (outcomeEventKinds.has(kind)) return "outcome";
  if (recordEventKinds.has(kind)) return "record";
  return "organize";
}

export function activitySessionInterval(
  session: ActivitySessionIntervalSource,
  date: string,
  nowAt: string = new Date().toISOString(),
): ActivitySessionInterval | null {
  const dayStart = Date.parse(`${date}T00:00:00+09:00`);
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  const sessionStart = Date.parse(text(session.started_at));
  const explicitEnd = Date.parse(text(session.ended_at));
  const currentEnd = Date.parse(text(nowAt));
  const sessionEnd = Number.isFinite(explicitEnd)
    ? explicitEnd
    : Number.isFinite(currentEnd)
      ? Math.max(currentEnd, sessionStart + 1)
      : sessionStart + 1;
  if (
    !Number.isFinite(dayStart) ||
    !Number.isFinite(sessionStart) ||
    sessionStart >= dayEnd ||
    sessionEnd <= dayStart
  ) {
    return null;
  }
  return {
    start_at: new Date(Math.max(sessionStart, dayStart)).toISOString(),
    end_at: new Date(Math.min(sessionEnd, dayEnd)).toISOString(),
  };
}

export function buildDailyAgentSessionContexts<
  TEvent extends ActivitySessionEvent,
  TRow extends ActivitySessionProjectionRow,
>(rows: TRow[], date: string, events: TEvent[]): DailyAgentSessionContext<TEvent, TRow>[] {
  const sessions = rows.flatMap((sessionRow) => {
    const interval = activitySessionInterval(sessionRow.session, date);
    return interval ? [{ sessionRow, interval }] : [];
  });
  const sessionByOriginId = new Map<string, (typeof sessions)[number]>();
  for (const context of sessions) {
    sessionByOriginId.set(context.sessionRow.session.id, context);
    if (context.sessionRow.session.source_session_id) {
      sessionByOriginId.set(context.sessionRow.session.source_session_id, context);
    }
  }
  const eventsBySessionId = new Map<string, TEvent[]>();
  for (const event of events) {
    const context = sessionByOriginId.get(event.origin?.session_id || "");
    if (!context) continue;
    const sessionId = context.sessionRow.session.id;
    eventsBySessionId.set(sessionId, [...(eventsBySessionId.get(sessionId) || []), event]);
  }
  return sessions.map(({ sessionRow, interval }) => {
    const relatedEvents = eventsBySessionId.get(sessionRow.session.id) || [];
    const themeIds = [
      ...new Set([
        ...sessionRow.themes.map((theme) => theme.id),
        ...relatedEvents.flatMap((event) => activityThemeIds(event)),
      ]),
    ];
    return { sessionRow, interval, events: relatedEvents, themeIds };
  });
}

const AGENT_CLIENT_LABELS: Record<string, string> = {
  codex: "Codex",
  claude_code: "Claude Code",
  cursor: "Cursor",
  github_copilot: "GitHub Copilot",
  other: "AI連携",
};

export function agentSessionClientLabel(session: ActivitySessionProjectionRow["session"]): string {
  return session.client_label || AGENT_CLIENT_LABELS[session.client_kind] || "AI連携";
}

function activityLocalTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--:--";
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(parsed);
}

export function activitySessionTimeLabel(
  context: Pick<DailyAgentSessionContext, "sessionRow" | "interval">,
): string {
  return context.sessionRow.session.ended_at
    ? `${activityLocalTime(context.interval.start_at)}–${activityLocalTime(context.interval.end_at)}`
    : `${activityLocalTime(context.interval.start_at)}–進行中`;
}

export function projectActivitySessionLogEntries(
  contexts: DailyAgentSessionContext[],
  themes: Array<{ id: string; name: string }>,
): ActivitySessionLogEntry[] {
  return contexts.map((context) => ({
    time_label: activitySessionTimeLabel(context),
    client_label: agentSessionClientLabel(context.sessionRow.session),
    theme_names: context.themeIds.map(
      (themeId) => themes.find((theme) => theme.id === themeId)?.name || "Theme不明",
    ),
    intent: context.sessionRow.session.intent.summary,
    outcome: context.sessionRow.session.outcome?.summary || undefined,
    repository_names: context.sessionRow.repositories.map((repository) => repository.label),
    remaining_work: context.sessionRow.session.outcome?.remaining_work || [],
  }));
}

export function activityThemeIds(event: ActivityThemeSource = {}): string[] {
  const ids: string[] = [];
  if (event.theme_ref?.kind === "theme" && text(event.theme_ref.id)) {
    ids.push(text(event.theme_ref.id));
  }
  for (const ref of Array.isArray(event.relation_refs) ? event.relation_refs : []) {
    if ((ref?.type === "project" || ref?.type === "theme") && text(ref.id)) {
      ids.push(text(ref.id));
    }
  }
  return [...new Set(ids)];
}

export function reviewableActivityEvents<
  T extends {
    event_kind?: string;
    entity_ref?: { type?: string };
    entity_type?: string;
  },
>(events: T[]): T[] {
  return events.filter(
    (event) =>
      event.event_kind !== "schedule_updated" &&
      event.entity_ref?.type !== "agent_session" &&
      event.entity_type !== "agent_session",
  );
}

export function activityGapSize(
  previousEndAt: unknown,
  nextStartAt: unknown,
  { minimumMinutes = 20, pixelsPerHour = 18, maxPixels = 90 }: ActivityTimelineOptions = {},
): number {
  const previous = Date.parse(text(previousEndAt));
  const next = Date.parse(text(nextStartAt));
  if (!Number.isFinite(previous) || !Number.isFinite(next) || next <= previous) return 0;
  const minutes = Math.floor((next - previous) / 60_000);
  if (minutes < minimumMinutes) return 0;
  return Math.min(maxPixels, Math.max(1, Math.round((minutes / 60) * pixelsPerHour)));
}

export function buildActivityTimeline<T extends ActivityTimelineItem>(
  items: T[],
  options: ActivityTimelineOptions = {},
): Array<T & { gap_size: number }> {
  const sorted = [...items]
    .filter((item) => text(item?.id) && Number.isFinite(Date.parse(text(item?.start_at))))
    .sort((left, right) => {
      const byTime = Date.parse(text(left.start_at)) - Date.parse(text(right.start_at));
      return byTime || text(left.id).localeCompare(text(right.id));
    });

  let previousEndAt = "";
  return sorted.map((item) => {
    const gapSize = previousEndAt ? activityGapSize(previousEndAt, item.start_at, options) : 0;
    const endAt =
      Number.isFinite(Date.parse(text(item.end_at))) &&
      Date.parse(text(item.end_at)) >= Date.parse(text(item.start_at))
        ? text(item.end_at)
        : text(item.start_at);
    if (!previousEndAt || Date.parse(endAt) > Date.parse(previousEndAt)) previousEndAt = endAt;
    return { ...item, gap_size: gapSize };
  });
}
