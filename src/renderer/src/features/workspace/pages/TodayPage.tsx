import { useEffect, useState } from "react";
import {
  IconCalendarCheck,
  IconCalendarPlus,
  IconCheck,
  IconChevronRight,
  IconClipboard,
  IconClock,
  IconPlus,
} from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import { todayIso } from "../../../utils/dataFormat.js";
import { playCompleteSound } from "../../../utils/sounds";
import type { PageProps, SaveOperation } from "../types";
import { themeColor } from "../lib/domain";
import { addDays, formatDate } from "../lib/format";
import { buildActivityLog } from "../lib/activityLog";
import { buildDailyPlanningCandidates, defaultDailyPlanSelection, type DailyPlanningCandidates, type DailyPlanningRow } from "../lib/dailyPlanning";
import { buildDailyLoopSummary, openTodayMini, type DailyLoopStep, type DailyLoopSummary } from "../lib/dailyLoop";
import { EmptyState, Metric, PageHeader } from "../components/common";
import { InlineAddPanel } from "../components/InlineAddPanel";
import { ChecklistProgressBadge } from "../components/taskChecklist";
import {
  CAPTURE_ENTRY_STATE_LABELS,
  PLAN_NODE_STATE_LABELS,
  PLAN_NODE_TYPE_LABELS,
  TASK_STATE_LABELS,
  WAITING_STATE_LABELS,
} from "../domain-model/labels";
import { buildOngoingPeriodTaskView, buildTodayView, compareCapturesNewestFirst } from "../domain-model/selectors";
import {
  buildSaveTaskOperations,
  buildSaveWaitingOperations,
  buildSavePlanNodeOperations,
  buildSaveScheduleOperations,
} from "../domain-model/persistence";
import { buildCompleteTaskOperations, repeatRuleLabel } from "../domain-model/taskRecurrence";
import type { CaptureEntry, PlanNode, Schedule, Task, Waiting, WorkspaceDomain } from "../domain-model/types";
import type { OngoingPeriodTaskRow, TodayEntry } from "../domain-model/viewModels";

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

function recordDate(value: unknown): string {
  return String(value || "").slice(0, 10);
}

function recordTimestamp(record: unknown): unknown {
  const row = record && typeof record === "object" ? record as Record<string, unknown> : {};
  return row.updated_at || row.created_at || row.captured_at || row.date;
}

function scheduleDate(schedule?: Schedule): string {
  return String(schedule?.end_date || schedule?.start_date || "");
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
}) {
  if (!rows.length) return <EmptyState title={empty} action={onAdd ? "タスクを追加" : undefined} onAction={onAdd} />;
  return (
    <div className="today-task-list">
      {rows.map((row) => {
        const themeIndex = themes.findIndex((entry) => entry.id === row.projectId);
        const theme = themeIndex >= 0 ? themes[themeIndex] : undefined;
        const chipColor = theme ? `var(--color-${themeColor(theme, themeIndex)})` : "var(--color-border-strong)";
        const isToday = row.date?.slice(0, 10) === today;
        const done = row.status === "done" || row.status === "cancelled" || row.status === "received";
        const reminder = reminderMeta(row, today);
        return (
          <div
            className="today-task-row is-clickable-row"
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
            <time>{formatDate(row.date)}</time>
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

function PeriodTaskRows({
  rows,
  themes,
  onOpenDetail,
  onCreateTodayTask,
}: {
  rows: OngoingPeriodTaskRow[];
  themes: PageProps["themes"];
  onOpenDetail: (row: OngoingPeriodTaskRow) => void;
  onCreateTodayTask: (row: OngoingPeriodTaskRow) => void;
}) {
  if (!rows.length) return <EmptyState title="期間中タスクはありません" />;
  return (
    <div className="today-task-list">
      {rows.map((row) => {
        const themeIndex = themes.findIndex((entry) => entry.id === row.task.project_id);
        const theme = themeIndex >= 0 ? themes[themeIndex] : undefined;
        const chipColor = theme ? `var(--color-${themeColor(theme, themeIndex)})` : "var(--color-border-strong)";
        return (
          <div
            className="today-task-row period-task-row is-clickable-row"
            key={row.task.id}
            style={{ "--chip-color": chipColor } as React.CSSProperties}
            onClick={() => onOpenDetail(row)}
          >
            <span className="todo-theme-bar" />
            <span className="period-progress-badge">{row.dayIndex}/{row.totalDays}</span>
            <button className="today-task-title" onClick={(event) => { event.stopPropagation(); onOpenDetail(row); }}>
              <strong>{row.task.title}</strong>
              <span>
                {theme?.name || "個人業務"} / 期間中 {row.dayIndex}日目 / 終了まであと{row.daysRemaining}日
              </span>
            </button>
            <time>{scheduleRangeLabel(row.schedule)}</time>
            <span className="today-postpone-actions">
              <button
                className="postpone-button period-action-button"
                onClick={(event) => { event.stopPropagation(); onCreateTodayTask(row); }}
                title="今日の作業を作成"
                aria-label={`${row.task.title}の今日の作業を作成`}
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
}: {
  rows: DailyPlanningRow[];
  themes: PageProps["themes"];
  onOpenDetail: (row: DailyPlanningRow) => void;
  onMoveToday: (row: DailyPlanningRow) => void;
}) {
  if (!rows.length) return <EmptyState title="この候補はありません" />;
  return (
    <div className="shelf-task-list">
      {rows.map((row) => {
        const theme = themes.find((entry) => entry.id === row.task.project_id);
        return (
          <div key={row.task.id} className="shelf-task-row">
            <button className="shelf-task-title" onClick={() => onOpenDetail(row)}>
              <strong>{row.task.title}</strong>
              <span>{theme?.name || "個人業務"} / {formatDate(row.schedule?.end_date || row.schedule?.start_date) || "予定なし"}</span>
            </button>
            <button className="secondary-button compact" onClick={() => onMoveToday(row)}>今日へ</button>
          </div>
        );
      })}
    </div>
  );
}

function DailyPlanSection({
  title,
  rows,
  themes,
  selectedIds,
  onToggle,
  onOpen,
}: {
  title: string;
  rows: DailyPlanningRow[];
  themes: PageProps["themes"];
  selectedIds: Set<string>;
  onToggle: (taskId: string) => void;
  onOpen: (row: DailyPlanningRow) => void;
}) {
  return (
    <section className="daily-plan-section">
      <div className="shelf-lane-heading"><h3>{title}</h3><span>{rows.length}件</span></div>
      {rows.length ? rows.slice(0, 8).map((row) => {
        const theme = themes.find((entry) => entry.id === row.task.project_id);
        return (
          <label key={row.task.id} className="daily-plan-row">
            <input type="checkbox" checked={selectedIds.has(row.task.id)} onChange={() => onToggle(row.task.id)} />
            <button type="button" onClick={() => onOpen(row)}>
              <strong>{row.task.title}</strong>
              <span>{theme?.name || "個人業務"} / {formatDate(row.schedule?.end_date || row.schedule?.start_date) || "予定なし"}</span>
            </button>
          </label>
        );
      }) : <EmptyState title="候補はありません" />}
    </section>
  );
}

function DailyPlanWizard({
  candidates,
  themes,
  selectedIds,
  note,
  onToggle,
  onNoteChange,
  onOpen,
  onCancel,
  onConfirm,
}: {
  candidates: DailyPlanningCandidates;
  themes: PageProps["themes"];
  selectedIds: Set<string>;
  note: string;
  onToggle: (taskId: string) => void;
  onNoteChange: (value: string) => void;
  onOpen: (row: DailyPlanningRow) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <section className="panel daily-plan-panel">
      <div className="section-heading"><h2>今日の計画</h2><span>{selectedIds.size}件選択中</span></div>
      <div className="daily-plan-grid">
        <DailyPlanSection title="期限切れ" rows={candidates.overdue} themes={themes} selectedIds={selectedIds} onToggle={onToggle} onOpen={onOpen} />
        <DailyPlanSection title="今週" rows={candidates.thisWeek} themes={themes} selectedIds={selectedIds} onToggle={onToggle} onOpen={onOpen} />
        <DailyPlanSection title="いつか" rows={candidates.someday} themes={themes} selectedIds={selectedIds} onToggle={onToggle} onOpen={onOpen} />
      </div>
      <label className="daily-plan-note">
        <span>今日の方針メモ</span>
        <textarea value={note} onChange={(event) => onNoteChange(event.target.value)} placeholder="今日の優先順位や気をつけること" />
      </label>
      <div className="form-actions">
        <button className="secondary-button" onClick={onCancel}>キャンセル</button>
        <button className="primary-button" onClick={onConfirm}>今日へ反映</button>
      </div>
    </section>
  );
}

function DailyLoopPanel({
  summary,
  onStep,
}: {
  summary: DailyLoopSummary;
  onStep: (step: DailyLoopStep) => void;
}) {
  return (
    <section className="panel daily-loop-panel">
      <div className="section-heading">
        <h2>日次ループ</h2>
        <span>{summary.steps.filter((step) => step.state === "active" || step.state === "attention").length}件進行中</span>
      </div>
      <div className="daily-loop-steps">
        {summary.steps.map((step) => (
          <button key={step.id} className={`daily-loop-step is-${step.state}`} onClick={() => onStep(step)}>
            <strong>{step.label}</strong>
            <span>{step.metric}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function TodayPage({ data, domain: v2, themes, openDrawer, navigate, saveEntities, setToast }: PageProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [showDailyPlan, setShowDailyPlan] = useState(false);
  const [dailyPlanNote, setDailyPlanNote] = useState("");
  const [dailyPlanSelection, setDailyPlanSelection] = useState<Set<string>>(new Set());
  const [addTitle, setAddTitle] = useState("");
  const [addTheme, setAddTheme] = useState("");
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [activityDate, setActivityDate] = useState(todayIso());
  const [activityDirectory, setActivityDirectory] = useState("");
  const [activityFilePath, setActivityFilePath] = useState("");
  const [exportingActivity, setExportingActivity] = useState(false);
  const today = todayIso();
  const soon = addDays(today, 14);
  const schedules = schedulesByOwner(v2);
  const todayRows = buildTodayView(v2, today).map((entry) => todayEntryToRow(entry));
  const periodRows = buildOngoingPeriodTaskView(v2, today);
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
  const inbox = v2.capture_entries
    .filter((entry) => entry.state === "untriaged" && entry.kind !== "micro_memo")
    .sort(compareCapturesNewestFirst)
    .map((entry) => captureToRow(entry));
  const noSchedule = taskRows
    .filter((row) => row.status !== "done" && row.status !== "cancelled" && !row.date)
    .sort((a, b) => Number(b.priority === "high") - Number(a.priority === "high") || a.title.localeCompare(b.title, "ja"));
  const milestones = v2.plan_nodes
    .filter((planNode) => planNode.type === "milestone" && isActivePlanNode(planNode) && scheduleTouchesRange(schedules.get(`plan_node:${planNode.id}`), today, soon))
    .map((planNode) => planNodeToRow(planNode, schedules.get(`plan_node:${planNode.id}`)))
    .sort(compareRows);
  const waitingSoon = v2.waitings
    .filter((waiting) => waiting.state === "waiting" && scheduleTouchesRange(schedules.get(`waiting:${waiting.id}`), "", soon))
    .map((waiting) => waitingToRow(waiting, schedules.get(`waiting:${waiting.id}`)))
    .sort(compareRows);
  const latestUpdates = [...(data.status_updates || [])]
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 5);
  const completedTodayCount = v2.tasks.filter((task) => task.state === "done" && recordDate(task.completed_at || task.updated_at) === today).length;
  const receivedTodayCount = v2.waitings.filter((waiting) => waiting.state === "received" && recordDate(waiting.updated_at) === today).length;
  const notesTodayCount = (data.notes || []).filter((note) => recordDate(recordTimestamp(note)) === today).length;
  const resourcesTodayCount = v2.resources.filter((resource) => recordDate(resource.captured_at || recordTimestamp(resource)) === today).length;
  const knowledgeTodayCount = v2.knowledge_nodes.filter((node) => recordDate(recordTimestamp(node)) === today).length;
  const capturesTodayCount = v2.capture_entries.filter((entry) => recordDate(entry.captured_at) === today).length;
  const statusUpdatesTodayCount = (data.status_updates || []).filter((entry) => recordDate(entry.date || entry.updated_at || entry.created_at) === today).length;
  const learningTodayCount = (data.notes || []).filter((note) => note.note_type === "learning" && recordDate(recordTimestamp(note)) === today).length;
  const activityLogItemCount = completedTodayCount + receivedTodayCount + notesTodayCount + resourcesTodayCount + knowledgeTodayCount + capturesTodayCount + statusUpdatesTodayCount;
  const weekStart = addDays(today, -6);
  const weeklyThemeIds = new Set<string>();
  v2.tasks.forEach((task) => {
    if (task.project_id && recordDate(task.completed_at || task.updated_at || task.created_at) >= weekStart) weeklyThemeIds.add(task.project_id);
  });
  (data.notes || []).forEach((note) => {
    if (note.theme_id && recordDate(recordTimestamp(note)) >= weekStart) weeklyThemeIds.add(String(note.theme_id));
  });
  v2.knowledge_nodes.forEach((node) => {
    if (node.project_id && recordDate(recordTimestamp(node)) >= weekStart) weeklyThemeIds.add(node.project_id);
  });
  (data.status_updates || []).forEach((entry) => {
    if (entry.theme_id && recordDate(entry.date || entry.updated_at || entry.created_at) >= weekStart) weeklyThemeIds.add(String(entry.theme_id));
  });
  const dailyLoopSummary = buildDailyLoopSummary({
    todayTaskCount: todayRows.length,
    timedTaskCount: 0,
    timeboxConflictCount: 0,
    reminderCount: 0,
    completedTodayCount,
    learningTodayCount,
    activityLogItemCount,
    weeklyThemeCount: weeklyThemeIds.size,
  });

  useEffect(() => {
    workspaceApi.getPreference("activityLogDirectory")
      .then((value) => {
        if (typeof value === "string") setActivityDirectory(value);
      })
      .catch(() => {});
  }, []);

  async function handleToggleComplete(row: TodayRow) {
    if (row.v2?.type === "task") {
      const nextState = row.v2.task.state === "done" ? "todo" : "done";
      if (nextState === "done") playCompleteSound();
      const nextMessage = nextState === "done" && row.v2.task.repeat_rule ? "完了しました。次のタスクを作成しました。" : nextState === "done" ? "完了しました。" : "未完了に戻しました。";
      await saveEntities(buildCompleteTaskOperations(row.v2.task, row.v2.schedule), nextMessage);
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
      const schedule = row.v2.schedule;
      const ownerType: Schedule["owner_type"] = row.v2.type === "task" ? "task" : row.v2.type === "waiting" ? "waiting" : "plan_node";
      const ownerId = row.v2.type === "task" ? row.v2.task.id : row.v2.type === "waiting" ? row.v2.waiting.id : row.v2.planNode.id;
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
      title: `${row.task.title}の今日の作業`,
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
    await saveEntities([...buildSaveTaskOperations(task), ...buildSaveScheduleOperations(schedule)], "今日の作業を作成しました。");
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

  function openDailyPlan() {
    setDailyPlanSelection(defaultDailyPlanSelection(dailyCandidates));
    setShowDailyPlan(true);
  }

  async function handleDailyLoopStep(step: DailyLoopStep) {
    if (step.id === "morning") {
      openDailyPlan();
      return;
    }
    if (step.id === "daytime") {
      await openTodayMini(workspaceApi, setToast);
      return;
    }
    if (step.id === "learning") {
      navigate("todo");
      return;
    }
    if (step.id === "evening") {
      setShowActivityLog(true);
      return;
    }
    navigate("themes");
  }

  function toggleDailyPlanTask(taskId: string) {
    setDailyPlanSelection((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  function handleOpenDailyPlanTask(row: DailyPlanningRow) {
    openDrawer({ type: "task", mode: "edit", entity: { ...row.task, _schedule: row.schedule } as Record<string, unknown> });
  }

  async function confirmDailyPlan() {
    const selectedRows = dailyTaskRows.filter((row) => dailyPlanSelection.has(row.task.id));
    const operations: SaveOperation[] = [];
    for (const row of selectedRows) {
      const isToday = row.schedule?.start_date === today || row.schedule?.end_date === today;
      if (isToday) continue;
      if (!row.schedule) {
        operations.push(...buildSaveScheduleOperations({
          id: crypto.randomUUID(),
          owner_type: "task",
          owner_id: row.task.id,
          end_date: today,
          date_kind: "deadline",
          confidence: "fixed",
          granularity: "day",
        }) as SaveOperation[]);
      } else {
        const keepsFutureDeadline = Boolean(row.schedule.end_date && row.schedule.end_date > today);
        operations.push(...buildSaveScheduleOperations({
          ...row.schedule,
          start_date: keepsFutureDeadline || (row.schedule.start_date && row.schedule.start_date > today) ? today : row.schedule.start_date,
          end_date: keepsFutureDeadline ? row.schedule.end_date : today,
          date_kind: keepsFutureDeadline || (row.schedule.start_date && row.schedule.start_date < today) ? "range" : "deadline",
        }) as SaveOperation[]);
      }
    }
    const note = dailyPlanNote.trim();
    if (note) {
      operations.push({
        action: "save",
        type: "status_update",
        entity: {
          id: crypto.randomUUID(),
          theme_id: null,
          date: today,
          status: "daily_plan",
          summary: note,
          created_at: new Date().toISOString(),
        },
      } as SaveOperation);
    }
    if (!operations.length) {
      setShowDailyPlan(false);
      setToast("今日の計画を閉じました。", "info");
      return;
    }
    await saveEntities(operations, "今日の計画を反映しました。");
    setDailyPlanNote("");
    setDailyPlanSelection(new Set());
    setShowDailyPlan(false);
  }

  function handleOpenCandidateTask(row: DailyPlanningRow) {
    openDrawer({ type: "task", mode: "edit", entity: { ...row.task, _schedule: row.schedule } as Record<string, unknown> });
  }

  async function handleMoveCandidateTaskToday(row: DailyPlanningRow) {
    const schedule = row.schedule;
    const keepsFutureDeadline = Boolean(schedule?.end_date && schedule.end_date > today);
    const nextSchedule: Schedule = schedule
      ? {
          ...schedule,
          start_date: keepsFutureDeadline || (schedule.start_date && schedule.start_date > today) ? today : schedule.start_date,
          end_date: keepsFutureDeadline ? schedule.end_date : today,
          date_kind: keepsFutureDeadline || (schedule.start_date && schedule.start_date < today) ? "range" : "deadline",
          confidence: schedule.confidence || "fixed",
          granularity: schedule.granularity || "day",
        }
      : {
          id: crypto.randomUUID(),
          owner_type: "task",
          owner_id: row.task.id,
          end_date: today,
          date_kind: "deadline",
          confidence: "fixed",
          granularity: "day",
        };
    await saveEntities(buildSaveScheduleOperations(nextSchedule), "今日やることへ移しました。");
  }

  async function addTask() {
    const title = addTitle.trim();
    if (!title) { setToast("タイトルを入力してください。"); return; }
    const taskId = crypto.randomUUID();
    const task: Task = {
      id: taskId,
      project_id: addTheme || null,
      title,
      state: "todo",
      priority: "normal",
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
    await saveEntities([...buildSaveTaskOperations(task), ...buildSaveScheduleOperations(schedule)], "今日のタスクを追加しました。");
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
    ...(waitingSoon.length ? waitingSoon.map((row) => `- ${row.date || "予定なし"} ${row.title}${row.waitingFor ? ` / ${row.waitingFor}` : ""}`) : ["- なし"]),
  ].join("\n");

  function buildCurrentActivityLog(date: string): string {
    return buildActivityLog({
      date,
      domain: v2,
      statusUpdates: data.status_updates || [],
      themes,
    });
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
      <PageHeader title="Today" subtitle="今日見るものを一か所に集めます。">
        <button className="secondary-button" onClick={() => workspaceApi.copyText(todayMarkdown).then(() => setToast("Todayの内容をコピーしました。"))}>
          <IconClipboard size={16} /> コピー
        </button>
        <button className="secondary-button" onClick={() => setShowActivityLog((value) => !value)}>
          <IconClipboard size={16} /> 活動ログ
        </button>
        <button className="secondary-button" onClick={openDailyPlan}>
          <IconCalendarPlus size={16} /> 今日の計画
        </button>
        <button className="primary-button" onClick={() => setShowAdd((v) => !v)}><IconPlus size={16} /> 今日のタスクを追加</button>
      </PageHeader>

      {showActivityLog && <section className="panel activity-log-strip">
        <div className="section-heading">
          <h2>Activity Log</h2>
          <div className="inline-actions">
            <input type="date" value={activityDate} onChange={(event) => setActivityDate(event.target.value)} aria-label="Activity Log対象日" />
            <button className="secondary-button compact" onClick={() => workspaceApi.copyText(buildCurrentActivityLog(activityDate)).then(() => setToast("Activity Logをコピーしました。"))}>コピー</button>
            <button className="secondary-button compact" onClick={() => exportActivityLog(!activityDirectory)} disabled={exportingActivity}>出力</button>
            <button className="secondary-button compact" disabled={exportingActivity} onClick={() => exportActivityLog(true)}>出力先を変更</button>
          </div>
        </div>
        <span>{activityFilePath ? `出力したファイル: ${activityFilePath}` : activityDirectory ? `出力先: ${activityDirectory}` : "出力先は初回出力時に選択します。"}</span>
      </section>}

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

      {showDailyPlan && (
        <DailyPlanWizard
          candidates={dailyCandidates}
          themes={themes}
          selectedIds={dailyPlanSelection}
          note={dailyPlanNote}
          onToggle={toggleDailyPlanTask}
          onNoteChange={setDailyPlanNote}
          onOpen={handleOpenDailyPlanTask}
          onCancel={() => setShowDailyPlan(false)}
          onConfirm={confirmDailyPlan}
        />
      )}

      <DailyLoopPanel summary={dailyLoopSummary} onStep={handleDailyLoopStep} />

      {focusItem && (
        <section className="today-focus-hero panel" onClick={() => handleOpenDetail(focusItem)}>
          <div className="focus-hero-content">
            <span className="focus-hero-label"><IconClock size={14} /> {focusItem.date && focusItem.date < today ? "期限切れ" : "次にやること"}</span>
            <strong className="focus-hero-title">{focusItem.title}</strong>
            <span className="focus-hero-meta">{themes.find((t) => t.id === focusItem.projectId)?.name || "個人業務"} / {focusItem.kindLabel}{focusItem.date ? ` / ${formatDate(focusItem.date)}` : ""}</span>
          </div>
          <div className="focus-hero-actions">
            <button className="secondary-button compact" onClick={(e) => { e.stopPropagation(); handleToggleComplete(focusItem); }}>{canComplete(focusItem) ? "完了" : "開く"}</button>
            {hasSchedule(focusItem) && <button className="secondary-button compact" onClick={(e) => { e.stopPropagation(); handlePostpone(focusItem, 1); }}>+1日</button>}
            <IconChevronRight size={18} className="focus-hero-arrow" />
          </div>
        </section>
      )}

      <div className="metric-grid today-metrics">
        <Metric label="今日" value={todayRows.length} tone="primary" />
        <Metric label="期限切れ" value={overdue.length} tone={overdue.length ? "danger" : ""} />
        <button className={`metric-card panel metric-button ${inbox.length ? "warning" : ""}`} onClick={() => navigate("inbox")}>
          <span>Inbox</span>
          <strong className="metric-value">{inbox.length}</strong>
        </button>
        <button className="metric-card panel metric-button" onClick={() => navigate("todo")}>
          <span>予定なし</span>
          <strong className="metric-value">{noSchedule.length}</strong>
        </button>
      </div>

      <section className="panel today-focus-panel">
        <div className="section-heading">
          <h2>今日やること</h2>
          <button className="text-button compact" onClick={() => navigate("todo")}>ToDoへ</button>
        </div>
        <TodayRows rows={todayRows} themes={themes} empty="今日のタスクはありません" today={today} {...rowHandlers} onAdd={() => setShowAdd(true)} />
      </section>

      <section className="panel task-shelf-panel">
        <div className="section-heading">
          <h2>今日の候補棚</h2>
          <button className="text-button compact" onClick={() => navigate("todo")}>ToDoへ</button>
        </div>
        <div className="task-shelf-board">
          <section className="task-shelf-lane">
            <div className="shelf-lane-heading"><h3>期限切れ</h3><span>{dailyCandidates.overdue.length}件</span></div>
            <CandidateTaskRows rows={dailyCandidates.overdue.slice(0, 4)} themes={themes} onOpenDetail={handleOpenCandidateTask} onMoveToday={handleMoveCandidateTaskToday} />
          </section>
          <section className="task-shelf-lane">
            <div className="shelf-lane-heading"><h3>今週</h3><span>{dailyCandidates.thisWeek.length}件</span></div>
            <CandidateTaskRows rows={dailyCandidates.thisWeek.slice(0, 4)} themes={themes} onOpenDetail={handleOpenCandidateTask} onMoveToday={handleMoveCandidateTaskToday} />
          </section>
          <section className="task-shelf-lane">
            <div className="shelf-lane-heading"><h3>いつか</h3><span>{dailyCandidates.someday.length}件</span></div>
            <CandidateTaskRows rows={dailyCandidates.someday.slice(0, 4)} themes={themes} onOpenDetail={handleOpenCandidateTask} onMoveToday={handleMoveCandidateTaskToday} />
          </section>
        </div>
      </section>

      <section className="panel today-focus-panel">
        <div className="section-heading">
          <h2>進行中の期間タスク</h2>
          <button className="text-button compact" onClick={() => navigate("todo")}>ToDoへ</button>
        </div>
        <PeriodTaskRows rows={periodRows} themes={themes} onOpenDetail={handleOpenPeriodTask} onCreateTodayTask={handleCreateTodayTask} />
      </section>

      <div className="today-grid">
        <section className="panel">
          <div className="section-heading"><h2>期限切れ</h2><span>{overdue.length}件</span></div>
          <TodayRows rows={overdue.slice(0, 8)} themes={themes} empty="期限切れはありません" today={today} {...rowHandlers} />
        </section>
        <section className="panel">
          <div className="section-heading"><h2>近いマイルストーン</h2><button className="text-button compact" onClick={() => navigate("timeline")}>Timelineへ</button></div>
          <TodayRows rows={milestones.slice(0, 8)} themes={themes} empty="近いマイルストーンはありません" today={today} {...rowHandlers} />
        </section>
      </div>

      <div className="today-grid">
        <section className="panel">
          <div className="section-heading"><h2>期限が近い待ち</h2><button className="text-button compact" onClick={() => navigate("waiting")}>Waitingへ</button></div>
          <TodayRows rows={waitingSoon.slice(0, 8)} themes={themes} empty="近い待ちはありません" today={today} {...rowHandlers} />
        </section>
        <section className="panel">
          <div className="section-heading"><h2>最近の現在地</h2><button className="text-button compact" onClick={() => openDrawer({ type: "status_update", mode: "edit", entity: { date: today } })}>記録する</button></div>
          <div className="today-update-list">
            {latestUpdates.length ? latestUpdates.map((entry) => (
              <button key={entry.id} className="wide-row" onClick={() => openDrawer({ type: "status_update", entity: entry })}>
                <strong>{themes.find((theme) => theme.id === entry.theme_id)?.name || "全体"}</strong>
                <span>{formatDate(entry.date)} / {entry.summary}</span>
              </button>
            )) : <EmptyState title="現在地がまだありません" action="記録する" onAction={() => openDrawer({ type: "status_update", mode: "edit", entity: { date: today } })} />}
          </div>
        </section>
      </div>
    </div>
  );
}
