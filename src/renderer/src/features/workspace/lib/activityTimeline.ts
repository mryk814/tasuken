import { focusSessionProperties, isFocusSession } from "../../../../../shared/focusSession.mjs";

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
  "focus_session",
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

type FocusActivityEvent = ActivitySessionEvent & {
  id?: string;
  occurred_at?: string;
  summary?: string;
  entity_ref?: { type?: string; id?: string };
  metadata?: Record<string, unknown>;
  theme_ref?: { kind?: "theme" | "none"; id?: string | null };
  relation_refs?: Array<{ type?: string; id?: string }>;
  origin?: { kind?: string; session_id?: string; command_id?: string; command_name?: string };
};

/** Keep canonical events intact; one focus note owns its displayed work period. */
export function groupFocusSessionActivity<T extends FocusActivityEvent>(
  events: T[],
  notes: Array<Record<string, unknown>>,
  changes: Array<Record<string, unknown>>,
  date: string,
  nowAt?: string,
): Array<T | FocusActivityEvent> {
  const sessions = notes.filter(isFocusSession);
  const sessionById = new Map(sessions.map((note) => [text(note.id), note]));
  const sessionByEndCommand = new Map<string, string>();
  const ownerByEvent = new Map<string, string>();
  const record = (value: unknown): Record<string, unknown> => {
    if (typeof value === "string") {
      try {
        return record(JSON.parse(value));
      } catch {
        return {};
      }
    }
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  };
  for (const change of changes) {
    const ref = record(change.entity_ref);
    const type = text(ref.type || change.entity_type);
    const id = text(ref.id || change.entity_id);
    const after = record(change.after_json);
    const completedSession =
      change.reason === "focus_session_completed_task" && type === "task"
        ? sessions.find((note) => {
            const properties = focusSessionProperties(note);
            return (
              properties.task_id === id &&
              properties.ended_at &&
              properties.ended_at === after.completed_at
            );
          })
        : undefined;
    const sessionId =
      type === "note" && sessionById.has(id)
        ? id
        : type === "reference" &&
            after.source_type === "note" &&
            sessionById.has(text(after.source_id))
          ? text(after.source_id)
          : completedSession
            ? text(completedSession.id)
            : "";
    if (!sessionId) continue;
    ownerByEvent.set(text(change.id), sessionId);
    if (type === "note") {
      const origin = record(change.origin);
      if (origin.command_name === "EndFocusSession" && text(origin.command_id)) {
        sessionByEndCommand.set(text(origin.command_id), sessionId);
      }
    }
  }
  const visible: FocusActivityEvent[] = sessions.flatMap((session): FocusActivityEvent[] => {
    const properties = focusSessionProperties(session);
    const interval = activitySessionInterval(
      {
        started_at: properties.started_at,
        ended_at: properties.ended_at,
      },
      date,
      nowAt,
    );
    if (!interval) return [];
    const active = properties.session_state === "active";
    return [
      {
        id: `focus:${text(session.id)}`,
        occurred_at: interval.start_at,
        event_kind: "focus_session",
        entity_ref: { type: "note", id: text(session.id) },
        theme_ref: session.project_id
          ? { kind: "theme", id: text(session.project_id) }
          : { kind: "none" },
        summary: text(properties.summary) || (active ? "フォーカス中" : "フォーカスを終了"),
        origin: { kind: "manual" },
        metadata: {
          end_at: interval.end_at,
          focus_task_id: text(properties.task_id),
          session_state: properties.session_state,
        },
      },
    ];
  });
  const visibleIds = new Set(visible.map((event) => text(event.entity_ref?.id)));
  return [
    ...events.filter((event) => {
      const owner =
        ownerByEvent.get(text(event.id)) ||
        sessionByEndCommand.get(event.origin?.command_id || "") ||
        (event.entity_ref?.type === "note" && sessionById.has(text(event.entity_ref.id))
          ? text(event.entity_ref.id)
          : "");
      return !visibleIds.has(owner || "");
    }),
    ...visible,
  ];
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
