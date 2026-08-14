import { useCallback, useEffect, useState } from "react";
import {
  IconCalendar,
  IconCalendarCheck,
  IconCalendarPlus,
  IconCheck,
  IconChevronRight,
  IconClipboard,
  IconClock,
  IconNotebook,
  IconPlus,
  IconRefresh,
} from "@tabler/icons-react";

import type { CalendarConnectionStatus, CalendarEvent, CalendarEventsResult } from "../../../../../shared/calendar";
import { canonicalThemeId, PERSONAL_DEFAULT_THEME_ID, THEME_NONE_VALUE } from "../../../../../shared/themeRef.mjs";
import { workspaceApi } from "../../../services/workspaceApi";
import { todayIso } from "../../../utils/dataFormat.js";
import { playCompleteSound } from "../../../utils/sounds";
import type { PageProps } from "../types";
import { themeColor } from "../lib/domain";
import { addDays, formatDate } from "../lib/format";
import { buildActivityLog, collectActivityLogEntries } from "../lib/activityLog";
import { buildDailyPlanningCandidates, type DailyPlanningRow } from "../lib/dailyPlanning";
import { findReminderSettingsView, normalizeReminderSettings } from "../lib/reminders";
import { taskShelfStatus } from "../lib/taskShelves";
import { Button, EmptyState, PageHeader, ThemePickerSelect } from "../components/common";
import { InlineAddPanel } from "../components/InlineAddPanel";
import { ToolbarMenu } from "../components/ToolbarMenu";
import { ChecklistProgressBadge } from "../components/taskChecklist";
import {
  CAPTURE_ENTRY_STATE_LABELS,
  PLAN_NODE_STATE_LABELS,
  PLAN_NODE_TYPE_LABELS,
  TASK_STATE_LABELS,
  WAITING_STATE_LABELS,
} from "../domain-model/labels";
import { buildExecutionWindowTaskView, buildOngoingPeriodTaskView, buildTodayView } from "../domain-model/selectors";
import {
  buildSaveTaskOperations,
  buildSaveWaitingOperations,
  buildSavePlanNodeOperations,
  buildSaveScheduleOperations,
} from "../domain-model/persistence";
import { buildCompleteTaskOperations, repeatRuleLabel } from "../domain-model/taskRecurrence";
import type { CaptureEntry, PlanNode, Schedule, Task, Waiting, WorkspaceDomain } from "../domain-model/types";
import type { ExecutionWindowTaskRow, OngoingPeriodTaskRow, TodayEntry } from "../domain-model/viewModels";

type DomainRow =
  | { type: "task"; task: Task; schedule?: Schedule }
  | { type: "waiting"; waiting: Waiting; schedule?: Schedule }
  | { type: "milestone"; planNode: PlanNode; schedule?: Schedule }
  | { type: "capture"; captureEntry: CaptureEntry };

type TodayRow = {
  id: string;
  title: string;
  projectId?: string | null;
  date?: string;
  kindLabel: string;
  status: string;
  statusLabel: string;
  priority?: "normal" | "high";
  waitingFor?: string | null;
  v2?: DomainRow;
};

type StructuredActivityEvent = {
  id?: string;
  occurred_at?: string;
  local_time?: string;
  event_kind?: string;
  entity_title?: string;
  summary?: string;
  entity_ref?: { type?: string; id?: string };
  theme_ref?: { kind?: "theme" | "none"; id?: string | null };
  canonical_refs?: Array<Record<string, unknown>>;
};

const ACTIVITY_EVENT_KIND_LABELS: Record<string, string> = {
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

function activityEventKindLabel(kind: string): string {
  return ACTIVITY_EVENT_KIND_LABELS[kind] || "活動";
}

function activityRecordTitle(entity: unknown): string {
  if (!entity || typeof entity !== "object") return "";
  const record = entity as Record<string, unknown>;
  return String(record.title || record.name || "").trim();
}

function activityEventTitle(event: StructuredActivityEvent, ref: { id?: string }, entity: unknown): string {
  const currentTitle = activityRecordTitle(entity);
  if (currentTitle) return currentTitle;
  const summary = String(event.summary || "").trim().replace(/^[a-z_]+:\s*/i, "");
  if (summary && (!ref.id || !summary.includes(ref.id))) return summary;
  return "履歴の項目";
}

function scheduleDate(schedule?: Schedule): string {
  return String(schedule?.end_date || schedule?.start_date || "");
}

/** 今日期限 / 期限切れ。完了系には付けない。 */
function dateUrgency(date: string | undefined | null, today: string, inactive = false): "overdue" | "due-today" | null {
  if (inactive || !date) return null;
  if (date < today) return "overdue";
  if (date === today) return "due-today";
  return null;
}

function scheduleTouchesRange(schedule: Schedule | undefined, start: string, end: string): boolean {
  const date = scheduleDate(schedule);
  return Boolean(date && date >= start && date <= end);
}

function scheduleRangeLabel(schedule: Schedule): string {
  return `${formatDate(schedule.start_date)}-${formatDate(schedule.end_date)}`;
}

function isActiveTask(task: Task): boolean {
  return task.state !== "done" && task.state !== "cancelled";
}

function isActivePlanNode(planNode: PlanNode): boolean {
  return planNode.state !== "done" && planNode.state !== "cancelled";
}

function schedulesByOwner(domain: WorkspaceDomain): Map<string, Schedule> {
  return new Map(domain.schedules.map((schedule) => [`${schedule.owner_type}:${schedule.owner_id}`, schedule]));
}

function rowDate(row: TodayRow): string {
  return String(row.date || "9999-12-31");
}

function compareRows(a: TodayRow, b: TodayRow): number {
  return rowDate(a).localeCompare(rowDate(b)) || a.title.localeCompare(b.title, "ja");
}

function taskToRow(task: Task, schedule: Schedule | undefined): TodayRow {
  return {
    id: task.id,
    title: task.title,
    projectId: task.project_id,
    date: scheduleDate(schedule),
    kindLabel: "タスク",
    status: task.state,
    statusLabel: TASK_STATE_LABELS[task.state],
    priority: task.priority,
    v2: { type: "task", task, schedule },
  };
}

function waitingToRow(waiting: Waiting, schedule: Schedule | undefined): TodayRow {
  return {
    id: waiting.id,
    title: waiting.title,
    projectId: waiting.project_id,
    date: scheduleDate(schedule),
    kindLabel: "待ち",
    status: waiting.state,
    statusLabel: WAITING_STATE_LABELS[waiting.state],
    waitingFor: waiting.waiting_for,
    v2: { type: "waiting", waiting, schedule },
  };
}

function planNodeToRow(planNode: PlanNode, schedule: Schedule | undefined): TodayRow {
  return {
    id: planNode.id,
    title: planNode.title,
    projectId: planNode.project_id,
    date: scheduleDate(schedule),
    kindLabel: PLAN_NODE_TYPE_LABELS[planNode.type],
    status: planNode.state,
    statusLabel: planNode.type === "milestone" ? "マイルストーン" : PLAN_NODE_STATE_LABELS[planNode.state],
    v2: { type: "milestone", planNode, schedule },
  };
}

function captureToRow(captureEntry: CaptureEntry): TodayRow {
  return {
    id: captureEntry.id,
    title: captureEntry.title || captureEntry.text,
    date: captureEntry.captured_at,
    kindLabel: "Capture",
    status: captureEntry.state,
    statusLabel: CAPTURE_ENTRY_STATE_LABELS[captureEntry.state],
    v2: { type: "capture", captureEntry },
  };
}

function todayEntryToRow(entry: TodayEntry): TodayRow {
  if (entry.type === "task") return taskToRow(entry.task, entry.schedule);
  if (entry.type === "waiting") return waitingToRow(entry.waiting, entry.schedule);
  if (entry.type === "milestone") return planNodeToRow(entry.planNode, entry.schedule);
  return captureToRow(entry.captureEntry);
}

function canComplete(row: TodayRow): boolean {
  return row.v2?.type === "task" || row.v2?.type === "waiting" || row.v2?.type === "milestone";
}

function canToggleToday(row: TodayRow): boolean {
  return row.v2 != null && row.v2.type !== "capture";
}

function hasSchedule(row: TodayRow): boolean {
  return row.v2 != null && row.v2.type !== "capture" && row.v2.schedule != null;
}

function reminderTimeLabel(value: unknown, today: string): string {
  const raw = String(value || "");
  if (!raw) return "";
  const date = raw.slice(0, 10);
  const time = raw.includes("T") ? raw.slice(11, 16) : "";
  if (!time) return "";
  return date && date !== today ? `${formatDate(date)} ${time}` : time;
}

function reminderMeta(row: TodayRow, today: string): string {
  return row.v2?.type === "task" ? reminderTimeLabel(row.v2.task.reminder_at, today) : "";
}

function TodayRows({
  rows,
  themes,
  empty,
  today,
  onToggleComplete,
  onToggleToday,
  onPostpone,
  onOpenDetail,
  onAdd,
  /** 今日専用リストでは due-today を付けない（全部今日なのでうるさくなる） */
  markDueToday = true,
}: {
  rows: TodayRow[];
  themes: PageProps["themes"];
  empty: string;
  today: string;
  onToggleComplete: (row: TodayRow) => void;
  onToggleToday: (row: TodayRow) => void;
  onPostpone: (row: TodayRow, days: number) => void;
  onOpenDetail: (row: TodayRow) => void;
  onAdd?: () => void;
  markDueToday?: boolean;
}) {
  if (!rows.length) return <EmptyState title={empty} action={onAdd ? "タスクを追加" : undefined} onAction={onAdd} />;
  return (
    <div className="today-task-list">
      {rows.map((row) => {
        const themeIndex = themes.findIndex((entry) => entry.id === row.projectId);
        const theme = themeIndex >= 0 ? themes[themeIndex] : undefined;
        const chipColor = theme ? `var(--color-${themeColor(theme, themeIndex)})` : "var(--color-border-strong)";
        const isToday = row.v2?.type === "task"
          ? row.v2.task.today_date === today
          : row.date?.slice(0, 10) === today;
        const done = row.status === "done" || row.status === "cancelled" || row.status === "received";
        const rawUrgency = dateUrgency(row.date, today, done);
        const urgency = rawUrgency === "due-today" && !markDueToday ? null : rawUrgency;
        const reminder = reminderMeta(row, today);
        return (
          <div
            className={`today-task-row is-clickable-row${urgency ? ` is-${urgency}` : ""}`}
            key={row.id}
            style={{ "--chip-color": chipColor } as React.CSSProperties}
            onClick={() => onOpenDetail(row)}
          >
            <span className="todo-theme-bar" />
            <button
              className={`todo-check-circle ${done ? "is-done" : ""}`}
              aria-label={`${row.title}を完了`}
              onClick={(event) => { event.stopPropagation(); onToggleComplete(row); }}
              disabled={!canComplete(row)}
            >
              {done && <IconCheck size={13} stroke={2.4} />}
            </button>
            <div className="row-title-wrap">
              <button
                className={`today-plan-button ${isToday ? "is-active" : ""}`}
                onClick={(event) => { event.stopPropagation(); onToggleToday(row); }}
                aria-label={isToday ? "今日の予定から外す" : "今日の予定に追加"}
                title={isToday ? "今日の予定から外す" : "今日の予定に追加"}
                disabled={!canToggleToday(row)}
              >
                {isToday ? <IconCalendarCheck size={16} /> : <IconCalendarPlus size={16} />}
              </button>
              <button className="today-task-title" onClick={(event) => { event.stopPropagation(); onOpenDetail(row); }}>
                <strong>{row.title}</strong>
                <span>
                  {theme?.name || "個人業務"} / {row.kindLabel}
                  {row.v2?.type === "task" && <ChecklistProgressBadge items={row.v2.task.checklist_items} />}
                </span>
                {row.v2?.type === "task" && row.v2.task.repeat_rule && <small>{repeatRuleLabel(row.v2.task.repeat_rule)}</small>}
                {reminder && <small className="row-reminder-meta"><IconClock size={13} />{reminder}</small>}
              </button>
            </div>
            <time className={urgency || undefined} dateTime={row.date || undefined}>{formatDate(row.date)}</time>
            <span className="today-postpone-actions">
              {hasSchedule(row) && (
                <button className="postpone-button" onClick={(event) => { event.stopPropagation(); onPostpone(row, 1); }} title="+1日" aria-label={`${row.title}を1日延期`}>+1d</button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function compareWaitingRows(a: TodayRow, b: TodayRow, today: string): number {
  const aDate = a.date || "";
  const bDate = b.date || "";
  const aOverdue = aDate && aDate < today ? 0 : 1;
  const bOverdue = bDate && bDate < today ? 0 : 1;
  if (aOverdue !== bOverdue) return aOverdue - bOverdue;
  const aHasDate = aDate ? 0 : 1;
  const bHasDate = bDate ? 0 : 1;
  if (aHasDate !== bHasDate) return aHasDate - bHasDate;
  return aDate.localeCompare(bDate) || a.title.localeCompare(b.title, "ja");
}

function WaitingListRows({
  rows,
  themes,
  today,
  onOpenDetail,
  empty,
}: {
  rows: TodayRow[];
  themes: PageProps["themes"];
  today: string;
  onOpenDetail: (row: TodayRow) => void;
  empty: string;
}) {
  if (!rows.length) return <EmptyState title={empty} />;
  return (
    <div className="today-waiting-list">
      {rows.map((row) => {
        const themeIndex = themes.findIndex((entry) => entry.id === row.projectId);
        const theme = themeIndex >= 0 ? themes[themeIndex] : undefined;
        const chipColor = theme ? `var(--color-${themeColor(theme, themeIndex)})` : "var(--color-border-strong)";
        const due = row.date || "";
        const urgency = dateUrgency(due, today);
        return (
          <button
            key={row.id}
            type="button"
            className={`today-waiting-row${urgency ? ` is-${urgency}` : ""}`}
            style={{ "--chip-color": chipColor } as React.CSSProperties}
            onClick={() => onOpenDetail(row)}
          >
            <span className="today-waiting-theme-bar" aria-hidden="true" />
            <span className="today-waiting-main">
              <strong>{row.title}</strong>
              <span>{row.waitingFor || theme?.name || "相手未設定"}</span>
            </span>
            <time className={urgency || undefined} dateTime={due || undefined}>
              {due ? formatDate(due) : "期限なし"}
            </time>
          </button>
        );
      })}
    </div>
  );
}

function themeChipStyle(themes: PageProps["themes"], projectId?: string | null) {
  const themeIndex = themes.findIndex((entry) => entry.id === projectId);
  const theme = themeIndex >= 0 ? themes[themeIndex] : undefined;
  const chipColor = theme ? `var(--color-${themeColor(theme, themeIndex)})` : "var(--color-border-strong)";
  return { theme, style: { "--chip-color": chipColor } as React.CSSProperties };
}

/**
 * 期間内に一度やるTask（#309）。
 * 期間に入っただけでは「今日やること」へ出さず、ここから拾う。
 * 一回の完了でTask全体が終わるので、通常のcheckboxをそのまま使う。
 */
function ExecutionWindowTaskRows({
  rows,
  themes,
  onOpenDetail,
  onComplete,
  onMoveToday,
}: {
  rows: ExecutionWindowTaskRow[];
  themes: PageProps["themes"];
  onOpenDetail: (row: ExecutionWindowTaskRow) => void;
  onComplete: (row: ExecutionWindowTaskRow) => void;
  onMoveToday: (row: ExecutionWindowTaskRow) => void;
}) {
  if (!rows.length) return <EmptyState title="期間内に対応するタスクはありません" />;
  return (
    <div className="today-task-list">
      {rows.map((row) => {
        const { theme, style } = themeChipStyle(themes, row.task.project_id);
        const remaining = row.daysRemaining > 0
          ? `あと${row.daysRemaining}日`
          : row.daysRemaining === 0
            ? "今日まで"
            : `${Math.abs(row.daysRemaining)}日超過`;
        return (
          <div
            className={`today-task-row execution-window-row is-clickable-row urgency-${row.urgency}`}
            key={row.task.id}
            style={style}
            onClick={() => onOpenDetail(row)}
          >
            <span className="todo-theme-bar" />
            <button
              className="todo-check-circle"
              aria-label={`${row.task.title}を完了`}
              onClick={(event) => { event.stopPropagation(); onComplete(row); }}
            />
            <button className="today-task-title" onClick={(event) => { event.stopPropagation(); onOpenDetail(row); }}>
              <strong>{row.task.title}</strong>
              <span>{theme?.name || "個人業務"} / {remaining}</span>
            </button>
            <time>{scheduleRangeLabel(row.schedule)}</time>
            <span className="today-postpone-actions">
              <button
                className="postpone-button period-action-button"
                onClick={(event) => { event.stopPropagation(); onMoveToday(row); }}
                title="今日やることへ追加"
                aria-label={`${row.task.title}を今日やることへ追加`}
              >
                <IconCalendarPlus size={14} />
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 継続中Task（#309）。
 * 今日の実施記録と、継続そのものの完了を分ける。完了操作は他のTaskと同じcheckboxを使う。
 */
function OngoingPeriodTaskRows({
  rows,
  themes,
  onOpenDetail,
  onRecordToday,
  onPlanToday,
  onFinishPeriod,
}: {
  rows: OngoingPeriodTaskRow[];
  themes: PageProps["themes"];
  onOpenDetail: (row: OngoingPeriodTaskRow) => void;
  onRecordToday: (row: OngoingPeriodTaskRow) => void;
  onPlanToday: (row: OngoingPeriodTaskRow) => void;
  onFinishPeriod: (row: OngoingPeriodTaskRow) => void;
}) {
  if (!rows.length) return <EmptyState title="継続中のタスクはありません" />;
  return (
    <div className="today-task-list">
      {rows.map((row) => {
        const { theme, style } = themeChipStyle(themes, row.task.project_id);
        return (
          <div
            className={`today-task-row period-task-row is-clickable-row ${row.pastEnd ? "is-past-end" : ""}`}
            key={row.task.id}
            style={style}
            onClick={() => onOpenDetail(row)}
          >
            <span className="todo-theme-bar" />
            <button
              className="todo-check-circle"
              aria-label={`${row.task.title}を完了`}
              onClick={(event) => { event.stopPropagation(); onFinishPeriod(row); }}
            />
            <span className="period-progress-badge">{row.dayIndex}/{row.totalDays}</span>
            <button className="today-task-title" onClick={(event) => { event.stopPropagation(); onOpenDetail(row); }}>
              <strong>{row.task.title}</strong>
              <span>
                {theme?.name || "個人業務"} / {row.pastEnd ? "継続予定期間が終了しました" : `${row.dayIndex}日目 / 終了まであと${row.daysRemaining}日`}
              </span>
            </button>
            <time>{scheduleRangeLabel(row.schedule)}</time>
            {/* 終了日が来ただけでは自動完了しない。完了・延長・そのまま継続を選べるようにする。 */}
            <span className="period-row-actions" onClick={(event) => event.stopPropagation()}>
              <Button variant="secondary" compact onClick={() => onRecordToday(row)}>今日取り組んだ</Button>
              <button
                className="postpone-button period-action-button"
                onClick={() => onPlanToday(row)}
                title="今日やることへ追加"
                aria-label={`${row.task.title}を今日やることへ追加`}
              >
                <IconCalendarPlus size={14} />
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function CandidateTaskRows({
  rows,
  themes,
  onOpenDetail,
  onMoveToday,
  today,
}: {
  rows: DailyPlanningRow[];
  themes: PageProps["themes"];
  onOpenDetail: (row: DailyPlanningRow) => void;
  onMoveToday: (row: DailyPlanningRow) => void;
  today: string;
}) {
  if (!rows.length) return <EmptyState title="この候補はありません" />;
  return (
    <div className="shelf-task-list">
      {rows.map((row) => {
        const themeIndex = themes.findIndex((entry) => entry.id === row.task.project_id);
        const theme = themeIndex >= 0 ? themes[themeIndex] : undefined;
        const chipColor = theme ? `var(--color-${themeColor(theme, themeIndex)})` : "var(--color-border-strong)";
        const status = taskShelfStatus(row, today);
        return (
          <div key={row.task.id} className={`shelf-task-row ${status ? `is-${status}` : ""}`} style={{ "--chip-color": chipColor } as React.CSSProperties}>
            <span className="shelf-theme-bar" />
            <button className="shelf-task-title" onClick={() => onOpenDetail(row)}>
              <strong>{row.task.title}</strong>
              <span>{theme?.name || "個人業務"} / {formatDate(row.schedule?.end_date || row.schedule?.start_date) || "予定なし"}</span>
            </button>
            <Button variant="secondary" compact onClick={() => onMoveToday(row)}>今日へ</Button>
          </div>
        );
      })}
    </div>
  );
}

function formatEventTime(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function isEventPast(endTime: string, isAllDay: boolean): boolean {
  if (isAllDay) return false;
  return new Date(endTime).getTime() < Date.now();
}

function findNextEvent(events: CalendarEvent[]): string | null {
  const now = Date.now();
  for (const event of events) {
    if (event.isAllDay) continue;
    if (new Date(event.startTime).getTime() >= now) return event.id;
    if (new Date(event.endTime).getTime() > now) return event.id;
  }
  return null;
}

function safeMeetingUrlFor(event: CalendarEvent): string {
  if (event.sensitivity !== "normal" || !event.meetingUrl) return "";
  try {
    const url = new URL(event.meetingUrl);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function CalendarEventMeta({ event }: { event: CalendarEvent }) {
  const calendarName = event.calendarName.trim();
  const location = event.sensitivity === "normal" ? event.location.trim() : "";
  const meetingUrl = safeMeetingUrlFor(event);
  if (!calendarName && !location && !meetingUrl) return null;

  return (
    <span className="today-calendar-location">
      {calendarName && <span>{calendarName}</span>}
      {location && <span>{calendarName ? ` · ${location}` : location}</span>}
      {meetingUrl && (
        <a
          href={meetingUrl}
          target="_blank"
          rel="noreferrer"
        >
          {calendarName || location ? " · 会議を開く" : "会議を開く"}
        </a>
      )}
    </span>
  );
}

function TodayCalendarSection() {
  const [calendarStatus, setCalendarStatus] = useState<CalendarConnectionStatus | null>(null);
  const [calendarResult, setCalendarResult] = useState<CalendarEventsResult | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const today = todayIso();

  const fetchEvents = useCallback(async () => {
    setCalendarLoading(true);
    try {
      const result = await workspaceApi.calendarEvents(today);
      setCalendarResult(result);
    } catch (error) {
      setCalendarResult({
        provider: "microsoft",
        events: [],
        fetchedAt: "",
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        stale: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setCalendarLoading(false);
    }
  }, [today]);

  useEffect(() => {
    workspaceApi.calendarStatus()
      .then((status) => {
        setCalendarStatus(status);
        if (status.connected) fetchEvents();
      })
      .catch(() => setCalendarStatus(buildDisconnectedCalendarStatus()));
  }, [fetchEvents]);

  // 未接続時はTodayの主導線へ混ぜず、Settingsの連携設定だけを入口にする。
  if (!calendarStatus || !calendarStatus.connected) return null;

  const events = calendarResult?.events || [];
  const allDayEvents = events.filter((e) => e.isAllDay);
  const timedEvents = events.filter((e) => !e.isAllDay);
  const nextEventId = findNextEvent(timedEvents);
  const hasError = calendarResult?.error && !calendarResult.stale;
  const titleFor = (event: CalendarEvent) => event.sensitivity === "normal" ? event.title : "予定あり";

  return (
    <section className="panel today-calendar-section">
      <div className="section-heading">
        <h2><IconCalendar size={16} /> 今日の予定</h2>
        <div className="inline-actions">
          {calendarResult?.fetchedAt && (
            <span className="today-calendar-meta">
              {calendarResult.stale && "前回取得分 "}
              {new Date(calendarResult.fetchedAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}更新
            </span>
          )}
          <Button
            variant="secondary"
            compact
            onClick={fetchEvents}
            disabled={calendarLoading}
            aria-label="カレンダーを更新"
          >
            <IconRefresh size={14} /> {calendarLoading ? "取得中" : "更新"}
          </Button>
        </div>
      </div>
      {calendarResult?.stale && calendarResult.error && (
        <p className="form-warning">取得に失敗しました。前回の予定を表示しています。{calendarResult.error}</p>
      )}
      {hasError ? (
        <div className="today-calendar-error">
          <p>{calendarResult!.error}</p>
          <Button variant="secondary" compact onClick={fetchEvents}>再試行</Button>
        </div>
      ) : calendarLoading && !calendarResult ? (
        <p className="today-calendar-loading">予定を取得中…</p>
      ) : events.length === 0 ? (
        <EmptyState title="今日の予定はありません" />
      ) : (
        <div className="today-calendar-list">
          {allDayEvents.map((event) => (
            <div key={event.id} className="today-calendar-event is-allday">
              <span className="today-calendar-time today-calendar-allday">終日</span>
              <span className="today-calendar-title">{titleFor(event)}</span>
              <CalendarEventMeta event={event} />
            </div>
          ))}
          {timedEvents.map((event) => (
            <div
              key={event.id}
              className={`today-calendar-event${isEventPast(event.endTime, false) ? " is-past" : ""}${event.id === nextEventId ? " is-next" : ""}`}
            >
              <span className="today-calendar-time">
                {formatEventTime(event.startTime)}–{formatEventTime(event.endTime)}
              </span>
              <span className="today-calendar-title">{titleFor(event)}</span>
              <CalendarEventMeta event={event} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function buildDisconnectedCalendarStatus(): CalendarConnectionStatus {
  return { provider: null, accountName: "", connected: false, lastFetchedAt: "" };
}

export function TodayPage({ data, domain: v2, themes, openDrawer, navigate, openDailyScratchpad, saveEntities, setToast }: PageProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addTheme, setAddTheme] = useState(PERSONAL_DEFAULT_THEME_ID);
  const [activityDate, setActivityDate] = useState(todayIso());
  const [activityDirectory, setActivityDirectory] = useState("");
  const [activityAutoExportTime, setActivityAutoExportTime] = useState("");
  const [activityFilePath, setActivityFilePath] = useState("");
  const [activityThemeFilter, setActivityThemeFilter] = useState("all");
  const [activityTypeFilter, setActivityTypeFilter] = useState("");
  const [activityRootStatus, setActivityRootStatus] = useState(data.canonical_root_status || {});
  const [activityExpanded, setActivityExpanded] = useState(true);
  const [exportingActivity, setExportingActivity] = useState(false);
  const today = todayIso();
  const soon = addDays(today, 14);
  const schedules = schedulesByOwner(v2);
  const todayRows = buildTodayView(v2, today).map((entry) => todayEntryToRow(entry));
  const periodRows = buildOngoingPeriodTaskView(v2, today);
  const executionWindowRows = buildExecutionWindowTaskView(v2, today);
  const dailyTaskRows: DailyPlanningRow[] = v2.tasks.map((task) => ({ task, schedule: schedules.get(`task:${task.id}`) }));
  const dailyCandidates = buildDailyPlanningCandidates(dailyTaskRows, today);
  const taskRows = v2.tasks.map((task) => taskToRow(task, schedules.get(`task:${task.id}`)));
  const waitingRows = v2.waitings.map((waiting) => waitingToRow(waiting, schedules.get(`waiting:${waiting.id}`)));
  const planNodeRows = v2.plan_nodes.map((planNode) => planNodeToRow(planNode, schedules.get(`plan_node:${planNode.id}`)));
  const overdue = [
    ...taskRows.filter((row) => row.status !== "done" && row.status !== "cancelled" && row.date && row.date < today),
    ...waitingRows.filter((row) => row.status === "waiting" && row.date && row.date < today),
    ...planNodeRows.filter((row) => row.status !== "done" && row.status !== "cancelled" && row.date && row.date < today),
  ].sort(compareRows);
  const milestones = v2.plan_nodes
    .filter((planNode) => planNode.type === "milestone" && isActivePlanNode(planNode) && scheduleTouchesRange(schedules.get(`plan_node:${planNode.id}`), today, soon))
    .map((planNode) => planNodeToRow(planNode, schedules.get(`plan_node:${planNode.id}`)))
    .sort(compareRows);
  const openWaitings = v2.waitings
    .filter((waiting) => waiting.state === "waiting")
    .map((waiting) => waitingToRow(waiting, schedules.get(`waiting:${waiting.id}`)))
    .sort((a, b) => compareWaitingRows(a, b, today));

  useEffect(() => {
    let canceled = false;
    void workspaceApi.getActivityCanonicalRootStatus()
      .then((status) => {
        if (!canceled) setActivityRootStatus(status);
      })
      .catch((error) => {
        if (!canceled) setToast(`Activityの保存先状態を読み込めませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
      });
    return () => { canceled = true; };
  }, [setToast]);
  useEffect(() => {
    setActivityRootStatus(data.canonical_root_status || {});
  }, [data.canonical_root_status]);
  const overdueWaitingCount = openWaitings.filter((row) => row.date && row.date < today).length;
  useEffect(() => {
    Promise.all([
      workspaceApi.getPreference("activityLogDirectory"),
      workspaceApi.getPreference("activityLogAutoExportTime"),
    ])
      .then(([directory, savedTime]) => {
        if (typeof directory === "string") setActivityDirectory(directory);
        if (typeof savedTime === "string" && savedTime) {
          setActivityAutoExportTime(savedTime);
          return;
        }
        const legacyTime = normalizeReminderSettings(findReminderSettingsView(data.views || [])).activity_log_time;
        if (legacyTime) {
          setActivityAutoExportTime(legacyTime);
          workspaceApi.setPreference("activityLogAutoExportTime", legacyTime).catch(() => {});
        }
      })
      .catch(() => {});
  }, [data.views]);

  async function handleToggleComplete(row: TodayRow) {
    if (row.v2?.type === "task") {
      const nextState = row.v2.task.state === "done" ? "todo" : "done";
      if (nextState === "done") playCompleteSound();
      const nextMessage = nextState === "done" && row.v2.task.repeat_rule ? "完了しました。次のタスクを作成しました。" : nextState === "done" ? "完了しました。" : "未完了に戻しました。";
      await saveEntities(buildCompleteTaskOperations(row.v2.task, row.v2.schedule), nextMessage, "today_window");
      return;
    }
    if (row.v2?.type === "waiting") {
      const nextState = row.v2.waiting.state === "received" ? "waiting" : "received";
      const next: Waiting = { ...row.v2.waiting, state: nextState };
      if (nextState === "received") playCompleteSound();
      await saveEntities(buildSaveWaitingOperations(next), nextState === "received" ? "受領しました。" : "待ちに戻しました。");
      return;
    }
    if (row.v2?.type === "milestone") {
      const nextState = row.v2.planNode.state === "done" ? "planned" : "done";
      const next: PlanNode = { ...row.v2.planNode, state: nextState };
      if (nextState === "done") playCompleteSound();
      await saveEntities(buildSavePlanNodeOperations(next), nextState === "done" ? "完了しました。" : "未完了に戻しました。");
      return;
    }
  }

  const focusItem: TodayRow | null =
    overdue[0] ||
    todayRows.find((row) => row.priority === "high") ||
    todayRows[0] ||
    null;

  async function handlePostpone(row: TodayRow, days: number) {
    if (!row.v2 || row.v2.type === "capture") return;
    const schedule = row.v2.schedule;
    if (!schedule) return;
    const next: Schedule = {
      ...schedule,
      start_date: schedule.start_date ? addDays(schedule.start_date, days) || null : null,
      end_date: schedule.end_date ? addDays(schedule.end_date, days) || null : null,
    };
    await saveEntities(buildSaveScheduleOperations(next), `${days}日延期しました。`);
  }

  async function handleToggleToday(row: TodayRow) {
    if (row.v2 && row.v2.type !== "capture") {
      if (row.v2.type === "task") {
        const isToday = row.v2.task.today_date === today;
        await saveEntities(
          buildSaveTaskOperations({ ...row.v2.task, today_date: isToday ? null : today }),
          isToday ? "今日の予定から外しました。" : "今日の予定に追加しました。",
        );
        return;
      }
      const schedule = row.v2.schedule;
      const ownerType: Schedule["owner_type"] = row.v2.type === "waiting" ? "waiting" : "plan_node";
      const ownerId = row.v2.type === "waiting" ? row.v2.waiting.id : row.v2.planNode.id;
      const isToday = schedule?.start_date === today || schedule?.end_date === today;

      if (!schedule) {
        const newSchedule: Schedule = {
          id: crypto.randomUUID(),
          owner_type: ownerType,
          owner_id: ownerId,
          end_date: today,
          date_kind: "deadline",
          confidence: "fixed",
          granularity: "day",
        };
        await saveEntities(buildSaveScheduleOperations(newSchedule), "今日の予定に追加しました。");
      } else if (isToday) {
        const next: Schedule = {
          ...schedule,
          start_date: schedule.start_date === today ? null : schedule.start_date,
          end_date: schedule.end_date === today ? null : schedule.end_date,
        };
        await saveEntities(buildSaveScheduleOperations(next), "今日の予定から外しました。");
      } else {
        await saveEntities(buildSaveScheduleOperations({ ...schedule, end_date: today }), "今日の予定に追加しました。");
      }
      return;
    }
  }

  async function handleCreateTodayTask(row: OngoingPeriodTaskRow) {
    const taskId = crypto.randomUUID();
    const task: Task = {
      id: taskId,
      project_id: row.task.project_id || null,
      plan_node_id: row.task.plan_node_id || null,
      parent_task_id: row.task.id,
      title: `${row.task.title}：${formatDate(today)}`,
      state: "todo",
      priority: row.task.priority,
      created_at: new Date().toISOString(),
    };
    const schedule: Schedule = {
      id: crypto.randomUUID(),
      owner_type: "task",
      owner_id: taskId,
      end_date: today,
      date_kind: "deadline",
      confidence: "fixed",
      granularity: "day",
    };
    await saveEntities([...buildSaveTaskOperations(task), ...buildSaveScheduleOperations(schedule)], "今日の作業を作成しました。", "today_window");
  }

  /**
   * 継続Taskの「今日取り組んだ」（#309）。
   * 親Taskは継続中のまま、その日の実施だけを完了済みの子Taskとして残す。
   * 実施記録のある日だけActivityへ出したいので、親Taskを毎日複製しない。
   */
  async function handleRecordOngoingWork(row: OngoingPeriodTaskRow) {
    const taskId = crypto.randomUUID();
    const now = new Date().toISOString();
    const task: Task = {
      id: taskId,
      project_id: row.task.project_id || null,
      plan_node_id: row.task.plan_node_id || null,
      parent_task_id: row.task.id,
      title: `${row.task.title}：${formatDate(today)}`,
      state: "done",
      priority: row.task.priority,
      completed_at: now,
      created_at: now,
    };
    const schedule: Schedule = {
      id: crypto.randomUUID(),
      owner_type: "task",
      owner_id: taskId,
      start_date: today,
      end_date: today,
      date_kind: "point",
      confidence: "fixed",
      granularity: "day",
    };
    playCompleteSound();
    await saveEntities(
      [...buildSaveTaskOperations(task), ...buildSaveScheduleOperations(schedule)],
      "今日の実施を記録しました。継続は終了していません。",
      "today_window",
    );
  }

  /** 継続そのものを終える操作。今日の実施記録とは別に扱う（#309）。 */
  async function handleFinishOngoingPeriod(row: OngoingPeriodTaskRow) {
    if (row.task.state !== "done") playCompleteSound();
    await saveEntities(buildCompleteTaskOperations(row.task, row.schedule), "継続を終了しました。", "today_window");
  }

  async function handleCompleteExecutionWindow(row: ExecutionWindowTaskRow) {
    if (row.task.state !== "done") playCompleteSound();
    const message = row.task.repeat_rule ? "完了しました。次のタスクを作成しました。" : "完了しました。";
    await saveEntities(buildCompleteTaskOperations(row.task, row.schedule), message, "today_window");
  }

  /** 期間内に一度やるTaskを、今日やることへ明示的に持ち上げる（#309）。 */
  async function handleMoveExecutionWindowToday(row: ExecutionWindowTaskRow) {
    await saveEntities(
      buildSaveTaskOperations({ ...row.task, today_date: today }),
      "今日やることへ移しました。",
    );
  }

  function handleOpenExecutionWindowTask(row: ExecutionWindowTaskRow) {
    openDrawer({ type: "task", mode: "edit", entity: { ...row.task, _schedule: row.schedule } as Record<string, unknown> });
  }

  function handleOpenDetail(row: TodayRow) {
    if (row.v2) {
      if (row.v2.type === "task") {
        openDrawer({ type: "task", mode: "edit", entity: { ...row.v2.task, _schedule: row.v2.schedule } as Record<string, unknown> });
        return;
      }
      if (row.v2.type === "waiting") {
        openDrawer({ type: "waiting", mode: "edit", entity: { ...row.v2.waiting, _schedule: row.v2.schedule } as Record<string, unknown> });
        return;
      }
      if (row.v2.type === "milestone") {
        openDrawer({ type: "plan_node", mode: "edit", entity: { ...row.v2.planNode, _schedule: row.v2.schedule } as Record<string, unknown> });
        return;
      }
      if (row.v2.type === "capture") {
        openDrawer({ type: "capture_entry", mode: "edit", entity: row.v2.captureEntry as unknown as Record<string, unknown> });
        return;
      }
    }
  }

  function handleOpenPeriodTask(row: OngoingPeriodTaskRow) {
    openDrawer({ type: "task", mode: "edit", entity: { ...row.task, _schedule: row.schedule } as Record<string, unknown> });
  }

  async function openTodayTasksWindow() {
    const opened = await workspaceApi.showTodayMiniWindow();
    setToast(opened ? "今日やることを開きました。" : "今日やることを開けませんでした。", opened ? "success" : "danger");
  }

  function handleOpenCandidateTask(row: DailyPlanningRow) {
    openDrawer({ type: "task", mode: "edit", entity: { ...row.task, _schedule: row.schedule } as Record<string, unknown> });
  }

  async function handleMoveCandidateTaskToday(row: DailyPlanningRow) {
    const task: Task = { ...row.task, planning_shelf: null, today_date: today };
    await saveEntities(buildSaveTaskOperations(task), "今日やることへ移しました。", "today_window");
  }

  async function addTask() {
    const title = addTitle.trim();
    if (!title) { setToast("タイトルを入力してください。"); return; }
    const taskId = crypto.randomUUID();
    const task: Task = {
      id: taskId,
      project_id: canonicalThemeId(addTheme, { defaultPersonal: true }),
      title,
      state: "todo",
      priority: "normal",
      today_date: today,
      created_at: new Date().toISOString(),
    };
    const schedule: Schedule = {
      id: crypto.randomUUID(),
      owner_type: "task",
      owner_id: taskId,
      end_date: today,
      date_kind: "deadline",
      confidence: "fixed",
      granularity: "day",
    };
    await saveEntities([...buildSaveTaskOperations(task), ...buildSaveScheduleOperations(schedule)], "今日のタスクを追加しました。", "today_window");
    setAddTitle("");
  }

  const todayMarkdown = [
    "# Today",
    "",
    "## 今日やること",
    ...(todayRows.length ? todayRows.map((row) => `- [ ] ${row.title} (${themes.find((theme) => theme.id === row.projectId)?.name || "個人業務"})`) : ["- なし"]),
    "",
    "## 期限切れ",
    ...(overdue.length ? overdue.map((row) => `- ${row.date || "予定なし"} ${row.title}`) : ["- なし"]),
    "",
    "## 進行中の期間タスク",
    ...(periodRows.length ? periodRows.map((row) => `- ${scheduleRangeLabel(row.schedule)} ${row.task.title} (${row.dayIndex}/${row.totalDays}日目、終了まであと${row.daysRemaining}日)`) : ["- なし"]),
    "",
    "## Waiting",
    ...(openWaitings.length ? openWaitings.map((row) => `- ${row.date || "予定なし"} ${row.title}${row.waitingFor ? ` / ${row.waitingFor}` : ""}`) : ["- なし"]),
  ].join("\n");

  function buildCurrentActivityLog(date: string): string {
    return buildActivityLog({
      date,
      domain: v2,
      statusUpdates: data.status_updates || [],
      themes,
      changeEvents: v2.change_events as unknown as Array<Record<string, unknown>>,
      references: v2.references as unknown as Array<Record<string, unknown>>,
      artifacts: data.artifacts as unknown as Array<Record<string, unknown>>,
      roots: activityRootStatus,
      timezone: "Asia/Tokyo",
    });
  }

  const activityEntries = collectActivityLogEntries({
    date: activityDate,
    domain: v2,
    statusUpdates: data.status_updates || [],
    themes,
    changeEvents: v2.change_events as unknown as Array<Record<string, unknown>>,
    references: v2.references as unknown as Array<Record<string, unknown>>,
    artifacts: data.artifacts as unknown as Array<Record<string, unknown>>,
    roots: activityRootStatus,
    timezone: "Asia/Tokyo",
  });
  const activityGroups = [
    { label: "完了", rows: activityEntries.completedTasks.map((entry) => entry.title) },
    { label: "受領", rows: activityEntries.receivedWaitings.map((entry) => entry.title) },
    { label: "Notes", rows: activityEntries.notes.map((entry) => entry.title) },
    { label: "資料", rows: activityEntries.resources.map((entry) => entry.title) },
    { label: "Knowledge", rows: activityEntries.knowledge.map((entry) => entry.title) },
    { label: "現在地", rows: activityEntries.updates.map((entry) => entry.summary || entry.next_actions || entry.risks || "更新") },
    { label: "Capture", rows: activityEntries.captures.map((entry) => entry.title || entry.text) },
  ].filter((group) => group.rows.length > 0);
  const structuredActivityEvents = (activityEntries.events as StructuredActivityEvent[])
    .filter((event) => event.event_kind !== "schedule_updated");
  const activityEventKinds = [...new Set(structuredActivityEvents.map((event) => String(event.event_kind || ""))).values()]
    .filter(Boolean)
    .sort();
  const visibleActivityEvents = structuredActivityEvents.filter((event) => (
    (activityThemeFilter === "all"
      || (activityThemeFilter === THEME_NONE_VALUE ? event.theme_ref?.kind === "none" : event.theme_ref?.id === activityThemeFilter))
    && (!activityTypeFilter || event.event_kind === activityTypeFilter)
  ));
  const activityCount = structuredActivityEvents.length
    ? visibleActivityEvents.length
    : activityGroups.reduce((sum, group) => sum + group.rows.length, 0);

  async function chooseActivityDirectory() {
    try {
      const result = await workspaceApi.chooseDirectory("Activity Logの自動出力先を選択");
      if (result.canceled || !result.path) return;
      setActivityDirectory(result.path);
      await workspaceApi.setPreference("activityLogDirectory", result.path);
      setToast("Activity Logの出力先を設定しました。", "success");
    } catch (error) {
      setToast(`出力先を設定できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    }
  }

  async function updateActivityAutoExportTime(value: string) {
    setActivityAutoExportTime(value);
    try {
      await workspaceApi.setPreference("activityLogAutoExportTime", value);
      setToast(value ? `Activity Logを毎日${value}に自動出力します。` : "Activity Logの自動出力を停止しました。", "success");
    } catch (error) {
      setToast(`自動出力時刻を保存できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    }
  }

  async function exportActivityLog(chooseDirectory: boolean) {
    setExportingActivity(true);
    try {
      const result = await workspaceApi.exportMarkdownFile({
        title: `Tasken Activity Log ${activityDate}`,
        fileName: `tasken-activity-${activityDate}.md`,
        content: buildCurrentActivityLog(activityDate),
        directory: activityDirectory || null,
        chooseDirectory,
      });
      if (result.canceled) {
        setToast("Activity Log出力をキャンセルしました。");
        return;
      }
      if (result.directory) {
        setActivityDirectory(result.directory);
        workspaceApi.setPreference("activityLogDirectory", result.directory).catch(() => {});
      }
      if (result.filePath) setActivityFilePath(result.filePath);
      setToast(`Activity Logを出力しました。${result.filePath || ""}`);
    } catch (error) {
      setToast(`Activity Logを出力できませんでした。${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setExportingActivity(false);
    }
  }

  const rowHandlers = {
    onToggleComplete: handleToggleComplete,
    onToggleToday: handleToggleToday,
    onPostpone: handlePostpone,
    onOpenDetail: handleOpenDetail,
  };

  return (
    <div className="page today-page">
      {/*
        Todayは今日のTaskを確認・追加・完了する面（#316）。
        primary actionは一つにし、コピーやActivityへの移動はmenuへ畳む。
      */}
      <PageHeader route="today">
        <Button variant="secondary" onClick={() => openDailyScratchpad(today)}>
          <IconNotebook size={16} /> 今日のScratchpad
        </Button>
        <Button variant="secondary" onClick={openTodayTasksWindow}>
          <IconCalendarCheck size={16} /> 今日やること
        </Button>
        <ToolbarMenu
          label="その他"
          title="Todayのその他の操作"
          items={[
            {
              id: "copy-today",
              label: "Todayの内容をコピー",
              onSelect: () => void workspaceApi.copyText(todayMarkdown).then(() => setToast("Todayの内容をコピーしました。")),
            },
            {
              id: "goto-activity",
              label: "Activityへ移動",
              hint: "今日実際に完了・更新したことの記録",
              onSelect: () => document.getElementById("daily-activity")?.scrollIntoView({ behavior: "smooth", block: "start" }),
            },
          ]}
        />
        <Button variant="primary" onClick={() => setShowAdd((v) => !v)} aria-expanded={showAdd}>
          <IconPlus size={16} /> 今日のTaskを追加
        </Button>
      </PageHeader>

      {showAdd && (
        <InlineAddPanel
          heading="今日のタスクを追加"
          title={addTitle}
          titlePlaceholder="タスク名"
          theme={addTheme}
          themes={themes}
          onTitleChange={setAddTitle}
          onThemeChange={setAddTheme}
          onSubmit={addTask}
        />
      )}

      {focusItem && (
        <section
          className={`today-focus-hero panel${focusItem.date && focusItem.date < today ? " is-overdue" : ""}`}
          onClick={() => handleOpenDetail(focusItem)}
        >
          <div className="focus-hero-content">
            <span className="focus-hero-label"><IconClock size={14} /> {focusItem.date && focusItem.date < today ? "期限切れ" : "次にやること"}</span>
            <strong className="focus-hero-title">{focusItem.title}</strong>
            <span className="focus-hero-meta">{themes.find((t) => t.id === focusItem.projectId)?.name || "個人業務"} / {focusItem.kindLabel}{focusItem.date ? ` / ${formatDate(focusItem.date)}` : ""}</span>
          </div>
          <div className="focus-hero-actions">
            <Button variant="secondary" compact onClick={(e) => { e.stopPropagation(); handleToggleComplete(focusItem); }}>{canComplete(focusItem) ? "完了" : "開く"}</Button>
            {hasSchedule(focusItem) && <Button variant="secondary" compact onClick={(e) => { e.stopPropagation(); handlePostpone(focusItem, 1); }}>+1日</Button>}
            <IconChevronRight size={18} className="focus-hero-arrow" />
          </div>
        </section>
      )}

      <section className="panel today-focus-panel">
        <div className="section-heading">
          <h2>今日やること</h2>
          <button className="text-button compact" onClick={() => navigate("todo")}>ToDoへ</button>
        </div>
        <TodayRows rows={todayRows} themes={themes} empty="今日のタスクはありません" today={today} {...rowHandlers} onAdd={() => setShowAdd(true)} markDueToday={false} />
      </section>

      <section className="panel task-shelf-panel">
        <div className="section-heading">
          <h2>今日の候補棚</h2>
          <button className="text-button compact" onClick={() => navigate("todo")}>ToDoへ</button>
        </div>
        <div className="task-shelf-board">
          <section className="task-shelf-lane">
            <div className="shelf-lane-heading"><h3>期限切れ</h3><span>{dailyCandidates.overdue.length}件</span></div>
            <CandidateTaskRows rows={dailyCandidates.overdue.slice(0, 4)} themes={themes} today={today} onOpenDetail={handleOpenCandidateTask} onMoveToday={handleMoveCandidateTaskToday} />
          </section>
          <section className="task-shelf-lane">
            <div className="shelf-lane-heading"><h3>今週</h3><span>{dailyCandidates.thisWeek.length}件</span></div>
            <CandidateTaskRows rows={dailyCandidates.thisWeek.slice(0, 4)} themes={themes} today={today} onOpenDetail={handleOpenCandidateTask} onMoveToday={handleMoveCandidateTaskToday} />
          </section>
          <section className="task-shelf-lane">
            <div className="shelf-lane-heading"><h3>いつか</h3><span>{dailyCandidates.someday.length}件</span></div>
            <CandidateTaskRows rows={dailyCandidates.someday.slice(0, 4)} themes={themes} today={today} onOpenDetail={handleOpenCandidateTask} onMoveToday={handleMoveCandidateTaskToday} />
          </section>
        </div>
      </section>

      {/* 接続済みの場合だけ、今日やることの補助情報として候補棚の下に置く。 */}
      <TodayCalendarSection />

      {/* 日付範囲の意味で扱いを分ける（#309）。期間に入っただけで毎日督促しない。 */}
      <section className="panel today-focus-panel">
        <div className="section-heading">
          <h2>期間内に対応</h2>
          <button className="text-button compact" onClick={() => navigate("todo")}>ToDoへ</button>
        </div>
        <ExecutionWindowTaskRows
          rows={executionWindowRows}
          themes={themes}
          onOpenDetail={handleOpenExecutionWindowTask}
          onComplete={handleCompleteExecutionWindow}
          onMoveToday={handleMoveExecutionWindowToday}
        />
      </section>

      <section className="panel today-focus-panel">
        <div className="section-heading">
          <h2>継続中</h2>
          <button className="text-button compact" onClick={() => navigate("todo")}>ToDoへ</button>
        </div>
        <OngoingPeriodTaskRows
          rows={periodRows}
          themes={themes}
          onOpenDetail={handleOpenPeriodTask}
          onRecordToday={handleRecordOngoingWork}
          onPlanToday={handleCreateTodayTask}
          onFinishPeriod={handleFinishOngoingPeriod}
        />
      </section>

      <div className="today-lower-grid">
        <div className="today-lower-stack">
          <section className="panel">
            <div className="section-heading"><h2>近いマイルストーン</h2><button className="text-button compact" onClick={() => navigate("timeline")}>Timelineへ</button></div>
            <TodayRows rows={milestones.slice(0, 8)} themes={themes} empty="近いマイルストーンはありません" today={today} {...rowHandlers} />
          </section>
          <section className="panel today-waiting-panel">
            <div className="section-heading">
              <h2>
                待ち
                {overdueWaitingCount > 0 && (
                  <span className="today-waiting-overdue-count" title="期限切れの待ち">{overdueWaitingCount}</span>
                )}
              </h2>
              <Button
                variant="primary"
                compact
                onClick={() => openDrawer({ type: "waiting", mode: "edit", entity: {} })}
              >
                追加
              </Button>
            </div>
            <WaitingListRows
              rows={openWaitings.slice(0, 8)}
              themes={themes}
              today={today}
              empty="待ちはありません"
              onOpenDetail={handleOpenDetail}
            />
          </section>
        </div>

        <section id="daily-activity" className="panel activity-log-strip">
        <div className="section-heading">
          <h2>Activity <span className="activity-count">{activityCount}</span></h2>
          <div className="inline-actions">
            {activityExpanded && (
              <>
                <input type="date" value={activityDate} onChange={(event) => setActivityDate(event.target.value)} aria-label="Activity対象日" />
                {structuredActivityEvents.length > 0 && (
                  <>
                    <ThemePickerSelect
                      themes={themes}
                      value={activityThemeFilter}
                      onChange={setActivityThemeFilter}
                      allowAll
                      allowNone
                      allLabel="すべてのTheme"
                      ariaLabel="Activity Theme filter"
                    />
                    <select value={activityTypeFilter} onChange={(event) => setActivityTypeFilter(event.target.value)} aria-label="Activity event type filter">
                      <option value="">すべての種類</option>
                      {activityEventKinds.map((kind) => <option key={kind} value={kind}>{activityEventKindLabel(kind)}</option>)}
                    </select>
                  </>
                )}
                <Button variant="secondary" compact onClick={() => workspaceApi.copyText(buildCurrentActivityLog(activityDate)).then(() => setToast("Activity Logをコピーしました。", "success"))}>コピー</Button>
                <Button variant="secondary" compact onClick={() => exportActivityLog(!activityDirectory)} disabled={exportingActivity}>出力</Button>
              </>
            )}
            <Button variant="secondary" compact onClick={() => setActivityExpanded((expanded) => !expanded)} aria-expanded={activityExpanded}>
              {activityExpanded ? "閉じる" : "開く"}
            </Button>
          </div>
        </div>
        {activityExpanded && (structuredActivityEvents.length ? (
          visibleActivityEvents.length ? (
            <ul className="activity-event-list" aria-label="Activity events">
              {visibleActivityEvents.slice(0, 30).map((event) => {
                const ref = event.entity_ref || {};
                const records = ref.type === "task" ? v2.tasks
                  : ref.type === "waiting" ? v2.waitings
                    : ref.type === "note" ? v2.notes
                      : ref.type === "resource" ? v2.resources
                        : ref.type === "plan_node" ? v2.plan_nodes
                          : ref.type === "capture_entry" ? v2.capture_entries
                            : ref.type === "sketch" ? v2.sketches : [];
                const entity = records.find((record) => record.id === ref.id);
                const entityOpenable = Boolean(entity);
                const title = activityEventTitle(event, ref, entity);
                return (
                  <li key={String(event.id)} className="activity-event-row">
                    <time dateTime={String(event.occurred_at)}>{String(event.local_time || "--:--")}</time>
                    <span className="activity-event-main">
                      <span className="activity-event-kind">{activityEventKindLabel(String(event.event_kind || ""))}</span>
                      {entityOpenable ? (
                        <button
                          type="button"
                          className="text-button activity-event-title"
                          onClick={() => {
                            openDrawer({ type: ref.type as "task" | "waiting" | "note" | "resource" | "plan_node" | "capture_entry" | "sketch", mode: "view", entity: entity as unknown as Record<string, unknown> });
                          }}
                        >
                          {title}
                        </button>
                      ) : (
                        <span className="activity-event-title" title="現在のEntityがないため、履歴のみ表示しています。">{title}</span>
                      )}
                      {!entityOpenable && <span className="activity-event-state">履歴のみ</span>}
                    </span>
                  </li>
                );
              })}
              {visibleActivityEvents.length > 30 && <li className="activity-more">ほか{visibleActivityEvents.length - 30}件</li>}
            </ul>
          ) : <EmptyState title="条件に一致するActivityはありません" />
        ) : activityGroups.length ? (
          <div className="activity-summary-grid">
            {activityGroups.map((group) => (
              <section className="activity-summary-group" key={group.label}>
                <div className="shelf-lane-heading"><h3>{group.label}</h3><span>{group.rows.length}件</span></div>
                <ul>
                  {group.rows.slice(0, 3).map((row, index) => <li key={`${group.label}-${index}`}>{row}</li>)}
                  {group.rows.length > 3 && <li className="activity-more">ほか{group.rows.length - 3}件</li>}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <EmptyState title="タスクの完了やNoteの更新が自動でここにまとまります" />
        ))}
        {activityExpanded && <div className="activity-auto-export">
          <label>
            <span>毎日自動出力</span>
            <input
              type="time"
              value={activityAutoExportTime}
              onChange={(event) => void updateActivityAutoExportTime(event.target.value)}
              disabled={!activityDirectory}
              aria-label="Activity Log自動出力時刻"
            />
          </label>
          <span className="activity-output-path">
            {activityFilePath ? `最新の手動出力: ${activityFilePath}` : activityDirectory ? `出力先: ${activityDirectory}` : "先に自動出力先を選択してください。"}
          </span>
          <Button variant="secondary" compact disabled={exportingActivity} onClick={() => void chooseActivityDirectory()}>
            出力先を選択
          </Button>
          <small>アプリ停止中の未出力分は、次回起動時に日ごとに補完します。</small>
        </div>}
        </section>
      </div>
    </div>
  );
}
