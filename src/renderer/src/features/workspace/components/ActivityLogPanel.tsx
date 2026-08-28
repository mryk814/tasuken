import { useEffect, useRef, useState, type CSSProperties } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import { todayIso } from "../../../utils/dataFormat.js";
import { THEME_NONE_VALUE } from "../../../../../shared/themeRef.mjs";
import { buildActivityReviewLog, collectActivityLogEntries } from "../lib/activityLog";
import { resolveActivityLogDirectory } from "../lib/activityLogDirectory";
import {
  activitySessionTimeLabel,
  agentSessionClientLabel,
  activityDisplayKind,
  activityThemeIds,
  buildDailyAgentSessionContexts,
  projectActivitySessionLogEntries,
  reviewableActivityEvents,
} from "../lib/activityTimeline";
import {
  ACTIVITY_TIMELINE_DAY_HEIGHT,
  buildActivityTimelineLayout,
} from "../lib/activityTimelineLayout";
import {
  buildAgentWorkProjection,
  type AgentWorkProjectionRow,
} from "../lib/agentSessionProjection";
import { themeColor } from "../lib/domain";
import { findReminderSettingsView, normalizeReminderSettings } from "../lib/reminders";
import type { PageProps } from "../types";
import { Button, EmptyState, ThemePickerSelect } from "./common";

type StructuredActivityEvent = {
  id?: string;
  occurred_at?: string;
  local_time?: string;
  event_kind?: string;
  summary?: string;
  entity_ref?: { type?: string; id?: string };
  theme_ref?: { kind?: "theme" | "none"; id?: string | null };
  entity_type?: string;
  actor?: { kind?: string; id?: string };
  origin?: { kind?: string; command_id?: string; command_name?: string; session_id?: string };
  changed_fields?: string[];
  source_refs?: Array<Record<string, unknown>>;
  relation_refs?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
};

const EVENT_LABELS: Record<string, string> = {
  task_checklist_checked: "チェック済み",
  task_checklist_unchecked: "チェックを戻す",
  task_completed: "完了",
  task_reopened: "再開",
  task_work_recorded: "作業を記録",
  task_ai_reported: "作業報告",
  task_ai_accepted: "作業を受領",
  task_ai_returned: "作業を差し戻し",
  waiting_received: "待ちを受領",
  waiting_updated: "待ちを更新",
  plan_node_created: "計画を追加",
  plan_node_updated: "計画を更新",
  note_created: "Noteを作成",
  note_updated: "Noteを更新",
  report_created: "レポートを作成",
  report_updated: "レポートを更新",
  prompt_created: "依頼文を作成",
  prompt_updated: "依頼文を更新",
  resource_added: "資料を追加",
  resource_updated: "資料を更新",
  artifact_added: "成果物を追加",
  artifact_updated: "成果物を更新",
  knowledge_created: "Knowledgeを追加",
  knowledge_updated: "Knowledgeを更新",
  sketch_created: "Sketchを作成",
  sketch_updated: "Sketchを更新",
  reference_created: "関連付けを追加",
  reference_updated: "関連付けを更新",
  capture_formalized: "メモを整理",
  entity_deleted: "削除",
  status_updated: "現在地を更新",
};

function eventLabel(kind: string): string {
  return EVENT_LABELS[kind] || "活動";
}

function eventTitle(event: StructuredActivityEvent, ref: { id?: string }, entity: unknown): string {
  const record = entity && typeof entity === "object" ? (entity as Record<string, unknown>) : {};
  const current = String(record.title || record.name || "").trim();
  if (current) return current;
  const summary = String(event.summary || "")
    .trim()
    .replace(/^[a-z_]+:\s*/i, "");
  return summary && (!ref.id || !summary.includes(ref.id)) ? summary : "履歴の項目";
}

type ActivityTimelineItem =
  | {
      id: string;
      item_type: "event";
      start_at: string;
      end_at: string;
      display_kind: "outcome" | "record" | "organize" | "ai_work";
      theme_ids: string[];
      event: StructuredActivityEvent;
    }
  | {
      id: string;
      item_type: "session";
      start_at: string;
      end_at: string;
      display_kind: "outcome" | "record" | "organize" | "ai_work";
      theme_ids: string[];
      session_row: AgentWorkProjectionRow;
      session_events: StructuredActivityEvent[];
    };

const ACTIVITY_DISPLAY_LABELS = {
  outcome: "成果",
  record: "記録",
  organize: "整理",
  ai_work: "AI作業",
} as const;

const ORIGIN_LABELS: Record<string, string> = {
  renderer_save: "Tasken",
  application_command: "Tasken",
  manual: "Tasken",
  imported: "取込",
  quick_capture: "クイック記録",
  mcp: "AI連携",
  ai: "AI連携",
  agent: "AI連携",
  ai_agent: "AI連携",
};

const ACTOR_LABELS: Record<string, string> = {
  user: "本人",
  human: "本人",
  system: "システム",
  ai_agent: "AI",
  agent: "AI",
};

const ACTIVITY_FILTER_OPTIONS = [
  { value: "", label: "すべての種類" },
  { value: "outcome", label: "成果" },
  { value: "record", label: "記録" },
  { value: "organize", label: "整理" },
  { value: "ai_work", label: "AI作業" },
] as const;

function displayKindLabel(kind: ActivityTimelineItem["display_kind"]): string {
  return ACTIVITY_DISPLAY_LABELS[kind];
}

function originLabel(event: StructuredActivityEvent): string {
  const kind = event.origin?.kind;
  if (!kind) return "Tasken";
  return ORIGIN_LABELS[kind] || kind;
}

function actorLabel(event: StructuredActivityEvent): string | null {
  const kind = event.actor?.kind;
  if (!kind) return null;
  return ACTOR_LABELS[kind] || kind;
}

function localTime(value?: string, fallback = "--:--"): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(date);
}

function findActivityEntity(
  domain: PageProps["domain"],
  ref: StructuredActivityEvent["entity_ref"],
): Record<string, unknown> | null {
  const records =
    ref?.type === "task"
      ? domain.tasks
      : ref?.type === "waiting"
        ? domain.waitings
        : ref?.type === "note"
          ? domain.notes
          : ref?.type === "resource"
            ? domain.resources
            : ref?.type === "plan_node"
              ? domain.plan_nodes
              : ref?.type === "capture_entry"
                ? domain.capture_entries
                : ref?.type === "sketch"
                  ? domain.sketches
                  : [];
  return (
    (records.find((record) => record.id === ref?.id) as unknown as Record<string, unknown>) || null
  );
}

function isOpenableActivityEntity(
  type?: string,
): type is "task" | "waiting" | "note" | "resource" | "plan_node" | "capture_entry" | "sketch" {
  return ["task", "waiting", "note", "resource", "plan_node", "capture_entry", "sketch"].includes(
    type || "",
  );
}

function ActivityThemeChips({
  themeIds,
  themes,
}: {
  themeIds: string[];
  themes: PageProps["themes"];
}) {
  if (!themeIds.length) {
    return <span className="activity-timeline-theme-chip is-unassigned">Theme未設定</span>;
  }
  return (
    <span className="activity-timeline-theme-chips">
      {themeIds.map((themeId) => {
        const theme = themes.find((candidate) => candidate.id === themeId);
        const themeIndex = themes.findIndex((candidate) => candidate.id === themeId);
        const color = theme ? themeColor(theme, Math.max(themeIndex, 0)) : "";
        const label = theme?.name || "Theme不明";
        return (
          <span
            key={themeId}
            className={`activity-timeline-theme-chip${theme ? "" : " is-unassigned"}`}
            title={label}
            style={
              theme
                ? ({ "--activity-theme-color": `var(--color-${color})` } as CSSProperties)
                : undefined
            }
          >
            <span className="activity-timeline-theme-name">{label}</span>
          </span>
        );
      })}
    </span>
  );
}

export function ActivityLogPanel({
  data,
  domain,
  themes,
  openDrawer,
  setToast,
}: Pick<PageProps, "data" | "domain" | "themes" | "openDrawer" | "setToast">) {
  const [date, setDate] = useState(todayIso());
  const [directory, setDirectory] = useState("");
  const [autoExportTime, setAutoExportTime] = useState("");
  const [filePath, setFilePath] = useState("");
  const [themeFilter, setThemeFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("");
  const [rootStatus, setRootStatus] = useState(data.canonical_root_status || {});
  const [expanded, setExpanded] = useState(true);
  const [expandedTimelineItemId, setExpandedTimelineItemId] = useState("");
  const [exporting, setExporting] = useState(false);
  const activityCalendarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let canceled = false;
    void workspaceApi
      .getActivityCanonicalRootStatus()
      .then((status) => {
        if (!canceled) setRootStatus(status);
      })
      .catch((error) => {
        if (!canceled)
          setToast(
            `Activityの保存先状態を読み込めませんでした。${error instanceof Error ? error.message : String(error)}`,
            "danger",
          );
      });
    return () => {
      canceled = true;
    };
  }, [setToast]);

  useEffect(() => setRootStatus(data.canonical_root_status || {}), [data.canonical_root_status]);

  useEffect(() => {
    void Promise.all([
      workspaceApi.getPreference("activityLogDirectory"),
      workspaceApi.getPreference("artifactDirectory"),
      workspaceApi.getPreference("activityLogAutoExportTime"),
    ])
      .then(([savedDirectory, artifactDirectory, savedTime]) => {
        setDirectory(resolveActivityLogDirectory(savedDirectory, artifactDirectory));
        if (typeof savedTime === "string" && savedTime) return setAutoExportTime(savedTime);
        const legacyTime = normalizeReminderSettings(
          findReminderSettingsView(data.views || []),
        ).activity_log_time;
        if (legacyTime) {
          setAutoExportTime(legacyTime);
          void workspaceApi
            .setPreference("activityLogAutoExportTime", legacyTime)
            .catch(() => undefined);
        }
      })
      .catch(() => undefined);
  }, [data.views]);

  const input = {
    date,
    domain,
    statusUpdates: data.status_updates || [],
    themes,
    changeEvents: domain.change_events as unknown as Array<Record<string, unknown>>,
    references: domain.references as unknown as Array<Record<string, unknown>>,
    artifacts: data.artifacts as unknown as Array<Record<string, unknown>>,
    roots: rootStatus,
    timezone: "Asia/Tokyo",
  };
  const entries = collectActivityLogEntries(input);
  const groups = [
    { label: "完了", rows: entries.completedTasks.map((entry) => entry.title) },
    { label: "受領", rows: entries.receivedWaitings.map((entry) => entry.title) },
    { label: "Notes", rows: entries.notes.map((entry) => entry.title) },
    { label: "資料", rows: entries.resources.map((entry) => entry.title) },
    { label: "Knowledge", rows: entries.knowledge.map((entry) => entry.title) },
    {
      label: "現在地",
      rows: entries.updates.map(
        (entry) => entry.summary || entry.next_actions || entry.risks || "更新",
      ),
    },
    { label: "Capture", rows: entries.captures.map((entry) => entry.title || entry.text) },
  ].filter((group) => group.rows.length > 0);
  const allEvents = reviewableActivityEvents(entries.events as StructuredActivityEvent[]);
  const agentSessions = buildAgentWorkProjection(domain, {
    limit: Math.max(domain.agent_sessions.length, 1),
  });
  const sessionContexts = buildDailyAgentSessionContexts(agentSessions, date, allEvents);
  const sessionOriginIds = new Set(
    sessionContexts.flatMap(({ sessionRow }) =>
      [sessionRow.session.id, sessionRow.session.source_session_id].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  );
  const events = allEvents.filter((event) => !sessionOriginIds.has(event.origin?.session_id || ""));
  const visibleEvents = events.filter((event) => {
    const themeIds = activityThemeIds(event);
    const displayKind = activityDisplayKind({
      eventKind: event.event_kind,
      entityType: event.entity_ref?.type || event.entity_type,
    });
    return (
      (themeFilter === "all" ||
        (themeFilter === THEME_NONE_VALUE
          ? themeIds.length === 0
          : themeIds.includes(themeFilter))) &&
      (!typeFilter || displayKind === typeFilter)
    );
  });
  const visibleSessions = sessionContexts.filter(
    ({ events: relatedEvents, themeIds }) =>
      (themeFilter === "all" ||
        (themeFilter === THEME_NONE_VALUE
          ? themeIds.length === 0
          : themeIds.includes(themeFilter))) &&
      (!typeFilter ||
        typeFilter === "ai_work" ||
        relatedEvents.some(
          (event) =>
            activityDisplayKind({
              eventKind: event.event_kind,
              entityType: event.entity_ref?.type || event.entity_type,
            }) === typeFilter,
        )),
  );
  const sessionDisplayKind: ActivityTimelineItem["display_kind"] =
    typeFilter === "outcome" || typeFilter === "record" || typeFilter === "organize"
      ? typeFilter
      : "ai_work";
  const timelineItems: ActivityTimelineItem[] = [
    ...visibleEvents.map((event) => ({
      id: `event:${String(event.id)}`,
      item_type: "event" as const,
      start_at: String(event.occurred_at || ""),
      end_at: String(event.occurred_at || ""),
      display_kind: activityDisplayKind({
        eventKind: event.event_kind,
        entityType: event.entity_ref?.type || event.entity_type,
      }),
      theme_ids: activityThemeIds(event),
      event,
    })),
    ...visibleSessions.map(({ sessionRow, interval, events: relatedEvents, themeIds }) => ({
      id: `session:${sessionRow.session.id}`,
      item_type: "session" as const,
      start_at: interval.start_at,
      end_at: interval.end_at,
      display_kind: sessionDisplayKind,
      theme_ids: themeIds,
      session_row: sessionRow,
      session_events: relatedEvents,
    })),
  ];
  const timeline = buildActivityTimelineLayout(timelineItems, { date });
  const activityCalendarScrollKey = `${date}:${timeline
    .map((item) => `${item.id}:${item.top}`)
    .join("|")}`;
  const initialActivityTop = timeline[0]?.top;
  const expandedTimelineItem = timeline.find((item) => item.id === expandedTimelineItemId);
  const expandedEvent =
    expandedTimelineItem?.item_type === "event" ? expandedTimelineItem.event : null;
  const expandedRef = expandedEvent?.entity_ref || {};
  const expandedEntity = expandedEvent ? findActivityEntity(domain, expandedRef) : null;
  const expandedDrawerType = isOpenableActivityEntity(expandedRef.type) ? expandedRef.type : null;
  const expandedSessionRow =
    expandedTimelineItem?.item_type === "session" ? expandedTimelineItem.session_row : null;
  const expandedSession = expandedSessionRow?.session || null;
  const expandedRelatedSessionEvents =
    expandedTimelineItem?.item_type === "session" ? expandedTimelineItem.session_events : [];
  const expandedEventActor = expandedEvent ? actorLabel(expandedEvent) : null;
  const hasStructuredActivity = events.length > 0 || sessionContexts.length > 0;
  const count = hasStructuredActivity
    ? timeline.length
    : groups.reduce((sum, group) => sum + group.rows.length, 0);
  const activityLogContent = buildActivityReviewLog(
    input,
    projectActivitySessionLogEntries(sessionContexts, themes),
  );

  useEffect(() => {
    const calendar = activityCalendarRef.current;
    if (!expanded || !calendar) return;
    const nowParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());
    const hour = Number(nowParts.find((part) => part.type === "hour")?.value || 0);
    const minute = Number(nowParts.find((part) => part.type === "minute")?.value || 0);
    const fallbackTop = (hour * 60 + minute) * (36 / 60);
    calendar.scrollTop = Math.max(0, (initialActivityTop ?? fallbackTop) - 36);
  }, [activityCalendarScrollKey, expanded, initialActivityTop]);

  async function chooseDirectory() {
    try {
      const result = await workspaceApi.chooseDirectory("Activity Logの出力先を変更");
      if (result.canceled || !result.path) return;
      setDirectory(result.path);
      await workspaceApi.setPreference("activityLogDirectory", result.path);
      setToast("Activity Logの出力先を変更しました。", "success");
    } catch (error) {
      setToast(
        `出力先を設定できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    }
  }

  async function updateAutoExportTime(value: string) {
    setAutoExportTime(value);
    try {
      await workspaceApi.setPreference("activityLogAutoExportTime", value);
      setToast(
        value
          ? `Activity Logを毎日${value}に自動出力します。`
          : "Activity Logの自動出力を停止しました。",
        "success",
      );
    } catch (error) {
      setToast(
        `自動出力時刻を保存できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    }
  }

  async function exportLog(choose: boolean) {
    setExporting(true);
    try {
      const result = await workspaceApi.exportMarkdownFile({
        title: `Tasken Activity Log ${date}`,
        fileName: `tasken-activity-${date}.md`,
        content: activityLogContent,
        directory: directory || null,
        chooseDirectory: choose,
      });
      if (result.canceled) return setToast("Activity Log出力をキャンセルしました。");
      if (result.directory) {
        setDirectory(result.directory);
        if (choose)
          void workspaceApi
            .setPreference("activityLogDirectory", result.directory)
            .catch(() => undefined);
      }
      if (result.filePath) setFilePath(result.filePath);
      setToast(`Activity Logを出力しました。${result.filePath || ""}`, "success");
    } catch (error) {
      setToast(
        `Activity Logを出力できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <section id="daily-activity" className="panel activity-log-strip debrief-activity-panel">
      <div className="section-heading">
        <div>
          <h2>
            Activity <span className="activity-count">{count}</span>
          </h2>
          <p>1日の動きを時刻順に振り返ります。</p>
        </div>
        <div className="inline-actions">
          {expanded && (
            <>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                aria-label="Activity対象日"
              />
              {hasStructuredActivity && (
                <>
                  <ThemePickerSelect
                    themes={themes}
                    value={themeFilter}
                    onChange={setThemeFilter}
                    allowAll
                    allowNone
                    allLabel="すべてのTheme"
                    ariaLabel="Activity Theme filter"
                  />
                  <select
                    value={typeFilter}
                    onChange={(event) => setTypeFilter(event.target.value)}
                    aria-label="Activity event type filter"
                  >
                    {ACTIVITY_FILTER_OPTIONS.map((option) => (
                      <option key={option.value || "all"} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <Button
                variant="secondary"
                compact
                onClick={() =>
                  void workspaceApi
                    .copyText(activityLogContent)
                    .then(() => setToast("Activity Logをコピーしました。", "success"))
                }
              >
                コピー
              </Button>
              <Button
                variant="secondary"
                compact
                onClick={() => void exportLog(!directory)}
                disabled={exporting}
              >
                出力
              </Button>
            </>
          )}
          <Button
            variant="secondary"
            compact
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? "閉じる" : "開く"}
          </Button>
        </div>
      </div>
      {expanded &&
        (hasStructuredActivity ? (
          timeline.length ? (
            <>
              <div
                ref={activityCalendarRef}
                className="activity-calendar"
                aria-label="Activity の時刻カレンダー"
              >
                <div className="activity-calendar-day">
                  <div className="activity-calendar-gutter" aria-hidden="true">
                    {Array.from({ length: 25 }, (_, hour) => (
                      <span
                        key={hour}
                        className="activity-calendar-hour-label"
                        style={{ "--activity-hour-top": `${hour * 36}px` } as CSSProperties}
                      >
                        {String(hour).padStart(2, "0")}:00
                      </span>
                    ))}
                  </div>
                  <div
                    className="activity-calendar-canvas"
                    style={
                      {
                        "--activity-day-height": `${ACTIVITY_TIMELINE_DAY_HEIGHT}px`,
                      } as CSSProperties
                    }
                  >
                    {Array.from({ length: 25 }, (_, hour) => (
                      <span
                        key={`hour-${hour}`}
                        className="activity-calendar-hour-line"
                        aria-hidden="true"
                        style={{ "--activity-hour-top": `${hour * 36}px` } as CSSProperties}
                      />
                    ))}
                    {Array.from({ length: 24 }, (_, hour) => (
                      <span
                        key={`half-${hour}`}
                        className="activity-calendar-half-hour-line"
                        aria-hidden="true"
                        style={{ "--activity-hour-top": `${hour * 36 + 18}px` } as CSSProperties}
                      />
                    ))}
                    <ol className="activity-calendar-events" aria-label="Activity を時刻順に表示">
                      {timeline.map((row) => {
                        const event = row.item_type === "event" ? row.event : null;
                        const ref = event?.entity_ref || {};
                        const entity = event ? findActivityEntity(domain, ref) : null;
                        const sessionRow = row.item_type === "session" ? row.session_row : null;
                        const session = sessionRow?.session || null;
                        const eventActor = event ? actorLabel(event) : null;
                        const title = event
                          ? eventTitle(event, ref, entity)
                          : session?.intent.summary || session?.client_label || "AI セッション";
                        const timeLabel =
                          session && sessionRow
                            ? activitySessionTimeLabel({
                                sessionRow,
                                interval: { start_at: row.start_at, end_at: row.end_at },
                              })
                            : event?.local_time || localTime(row.start_at);
                        const laneGap = 4;
                        const laneCount = Math.max(1, row.lane_count);
                        const blockStyle = {
                          "--activity-event-top": `${row.top}px`,
                          "--activity-event-height": `${row.height}px`,
                          "--activity-event-left": `calc(${(row.lane * 100) / laneCount}% + ${(row.lane * laneGap) / laneCount}px)`,
                          "--activity-event-width": `calc(${100 / laneCount}% - ${((laneCount - 1) * laneGap) / laneCount}px)`,
                        } as CSSProperties;
                        const compact = row.height < 56;
                        const tiny = row.height < 40;
                        return (
                          <li
                            key={row.id}
                            className={`activity-calendar-event activity-timeline-row--${row.display_kind}${compact ? " is-compact" : ""}${tiny ? " is-tiny" : ""}`}
                            style={blockStyle}
                          >
                            <button
                              type="button"
                              className="activity-calendar-event-button"
                              onClick={() =>
                                setExpandedTimelineItemId((current) =>
                                  current === row.id ? "" : row.id,
                                )
                              }
                              aria-expanded={expandedTimelineItemId === row.id}
                              aria-controls={`activity-timeline-detail-${row.id}`}
                              aria-label={`${timeLabel}、${displayKindLabel(row.display_kind)}、${title}`}
                            >
                              <time
                                className="activity-calendar-event-time"
                                dateTime={row.start_at}
                              >
                                {timeLabel}
                              </time>
                              <span className="activity-calendar-event-title">{title}</span>
                              <span className="activity-calendar-event-meta">
                                <ActivityThemeChips themeIds={row.theme_ids} themes={themes} />
                                <span className="activity-event-kind activity-timeline-kind">
                                  {displayKindLabel(row.display_kind)}
                                </span>
                                {(session || eventActor) && (
                                  <span className="activity-timeline-actor-chip">
                                    {session ? "AI" : eventActor}
                                  </span>
                                )}
                                <span className="activity-timeline-origin-chip">
                                  {event
                                    ? originLabel(event)
                                    : session
                                      ? agentSessionClientLabel(session)
                                      : "AI 連携"}
                                </span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                </div>
              </div>
              {expandedTimelineItem && (
                <section
                  id={`activity-timeline-detail-${expandedTimelineItem.id}`}
                  className="activity-timeline-detail activity-calendar-detail"
                  aria-label="選択した Activity の詳細"
                >
                  <div className="activity-calendar-detail-heading">
                    <span className="activity-calendar-detail-time">
                      {expandedSession && expandedSessionRow
                        ? activitySessionTimeLabel({
                            sessionRow: expandedSessionRow,
                            interval: {
                              start_at: expandedTimelineItem.start_at,
                              end_at: expandedTimelineItem.end_at,
                            },
                          })
                        : expandedEvent?.local_time || localTime(expandedTimelineItem.start_at)}
                    </span>
                    <span className="activity-event-kind activity-timeline-kind">
                      {displayKindLabel(expandedTimelineItem.display_kind)}
                    </span>
                  </div>
                  {expandedSession ? (
                    <>
                      <dl className="activity-timeline-detail-grid">
                        <div>
                          <dt>意図</dt>
                          <dd>{expandedSession.intent.summary || "未記録"}</dd>
                        </div>
                        <div>
                          <dt>成果</dt>
                          <dd>{expandedSession.outcome?.summary || "未記録"}</dd>
                        </div>
                      </dl>
                      {expandedSessionRow && expandedSessionRow.repositories.length > 0 && (
                        <div className="activity-timeline-detail-section">
                          <span>リポジトリ</span>
                          <span>
                            {expandedSessionRow.repositories
                              .map((repository) => repository.label)
                              .join(" / ")}
                          </span>
                        </div>
                      )}
                      {expandedSessionRow && expandedSessionRow.tasks.length > 0 && (
                        <div className="activity-timeline-detail-section">
                          <span>関連タスク</span>
                          <span className="activity-timeline-detail-links">
                            {expandedSessionRow.tasks.slice(0, 3).map((task) => (
                              <Button
                                key={task.id}
                                variant="secondary"
                                compact
                                onClick={() =>
                                  openDrawer({
                                    type: "task",
                                    mode: "view",
                                    entity: task as unknown as Record<string, unknown>,
                                  })
                                }
                              >
                                {task.title}
                              </Button>
                            ))}
                          </span>
                        </div>
                      )}
                      {expandedRelatedSessionEvents.length > 0 && (
                        <div className="activity-timeline-detail-section">
                          <span>活動</span>
                          <ul>
                            {expandedRelatedSessionEvents.map((relatedEvent, index) => {
                              const relatedRef = relatedEvent.entity_ref || {};
                              const relatedEntity = findActivityEntity(domain, relatedRef);
                              return (
                                <li key={relatedEvent.id || `${expandedTimelineItem.id}:${index}`}>
                                  {eventLabel(String(relatedEvent.event_kind || ""))}：
                                  {eventTitle(relatedEvent, relatedRef, relatedEntity)}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                      {expandedSession.outcome?.remaining_work.length ? (
                        <div className="activity-timeline-detail-section">
                          <span>残作業</span>
                          <ul>
                            {expandedSession.outcome.remaining_work.slice(0, 3).map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </>
                  ) : expandedEvent ? (
                    <>
                      {expandedEvent.summary && (
                        <p className="activity-timeline-detail-summary">{expandedEvent.summary}</p>
                      )}
                      <dl className="activity-timeline-detail-grid">
                        <div>
                          <dt>記録種別</dt>
                          <dd>{eventLabel(String(expandedEvent.event_kind || ""))}</dd>
                        </div>
                        <div>
                          <dt>由来</dt>
                          <dd>{originLabel(expandedEvent)}</dd>
                        </div>
                        {expandedEventActor && (
                          <div>
                            <dt>記録者</dt>
                            <dd>{expandedEventActor}</dd>
                          </div>
                        )}
                      </dl>
                      {expandedEvent.changed_fields?.length ? (
                        <div className="activity-timeline-detail-section">
                          <span>更新項目</span>
                          <span>{expandedEvent.changed_fields.join(" / ")}</span>
                        </div>
                      ) : null}
                      {expandedEntity && expandedDrawerType ? (
                        <Button
                          variant="secondary"
                          compact
                          onClick={() =>
                            openDrawer({
                              type: expandedDrawerType,
                              mode: "view",
                              entity: expandedEntity,
                            })
                          }
                        >
                          {expandedRef.type === "task" ? "タスクを開く" : "関連項目を開く"}
                        </Button>
                      ) : (
                        <span className="activity-event-state">履歴のみ</span>
                      )}
                    </>
                  ) : null}
                </section>
              )}
            </>
          ) : (
            <EmptyState
              title="条件に一致するActivityはありません"
              action="絞り込みを解除"
              onAction={() => {
                setThemeFilter("all");
                setTypeFilter("");
              }}
            />
          )
        ) : groups.length ? (
          <div className="activity-summary-grid">
            {groups.map((group) => (
              <section className="activity-summary-group" key={group.label}>
                <div className="shelf-lane-heading">
                  <h3>{group.label}</h3>
                  <span>{group.rows.length}件</span>
                </div>
                <ul>
                  {group.rows.slice(0, 3).map((row, index) => (
                    <li key={`${group.label}-${index}`}>{row}</li>
                  ))}
                  {group.rows.length > 3 && (
                    <li className="activity-more">ほか{group.rows.length - 3}件</li>
                  )}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <EmptyState title="タスクの完了やNoteの更新が自動でここにまとまります" />
        ))}
      {expanded && (
        <div className="activity-auto-export">
          <label>
            <span>毎日自動出力</span>
            <input
              type="time"
              value={autoExportTime}
              onChange={(event) => void updateAutoExportTime(event.target.value)}
              disabled={!directory}
              aria-label="Activity Log自動出力時刻"
            />
          </label>
          <span className="activity-output-path">
            {filePath
              ? `最新の手動出力: ${filePath}`
              : directory
                ? `出力先: ${directory}`
                : "Rootを設定すると自動で出力先を作ります。"}
          </span>
          <Button
            variant="secondary"
            compact
            disabled={exporting}
            onClick={() => void chooseDirectory()}
          >
            出力先を変更
          </Button>
          <small>アプリ停止中の未出力分は、次回起動時に日ごとに補完します。</small>
        </div>
      )}
    </section>
  );
}
