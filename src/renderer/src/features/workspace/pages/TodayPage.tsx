import { useState } from "react";
import { IconCalendarPlus, IconClipboard, IconFlagFilled, IconPlus } from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import { todayIso } from "../../../utils/dataFormat.js";
import type { PageProps } from "../types";
import { addDays, formatDate } from "../lib/format";
import { EmptyState, Metric, PageHeader, StatusBadge } from "../components/common";
import {
  CAPTURE_ENTRY_STATE_LABELS,
  PLAN_NODE_STATE_LABELS,
  PLAN_NODE_TYPE_LABELS,
  TASK_STATE_LABELS,
  WAITING_STATE_LABELS,
} from "../domain-model/labels";
import { buildTodayView } from "../domain-model/selectors";
import {
  buildSaveTaskOperations,
  buildSaveWaitingOperations,
  buildSavePlanNodeOperations,
  buildSaveScheduleOperations,
} from "../domain-model/persistence";
import type { CaptureEntry, PlanNode, Schedule, Task, Waiting, WorkspaceDomain } from "../domain-model/types";
import type { TodayEntry } from "../domain-model/viewModels";

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

function scheduleDate(schedule?: Schedule): string {
  return String(schedule?.end_date || schedule?.start_date || "");
}

function scheduleTouchesRange(schedule: Schedule | undefined, start: string, end: string): boolean {
  const date = scheduleDate(schedule);
  return Boolean(date && date >= start && date <= end);
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

function TodayRows({
  rows,
  themes,
  empty,
  today,
  onToggleComplete,
  onToggleToday,
  onOpenDetail,
  onAdd,
}: {
  rows: TodayRow[];
  themes: PageProps["themes"];
  empty: string;
  today: string;
  onToggleComplete: (row: TodayRow) => void;
  onToggleToday: (row: TodayRow) => void;
  onOpenDetail: (row: TodayRow) => void;
  onAdd?: () => void;
}) {
  if (!rows.length) return <EmptyState title={empty} action={onAdd ? "タスクを追加" : undefined} onAction={onAdd} />;
  return (
    <div className="today-task-list">
      {rows.map((row) => {
        const theme = themes.find((entry) => entry.id === row.projectId);
        const isToday = row.date?.slice(0, 10) === today;
        return (
          <div className="today-task-row" key={row.id}>
            <button
              className="check-button"
              aria-label={`${row.title}を完了`}
              onClick={() => onToggleComplete(row)}
              disabled={!canComplete(row)}
            />
            <button className="today-task-title" onClick={() => onOpenDetail(row)}>
              <strong>{row.title}</strong>
              <span>{theme?.name || "個人業務"} / {row.kindLabel}</span>
            </button>
            {row.priority === "high" && <IconFlagFilled className="inline-icon accent" size={16} aria-label="優先" />}
            <StatusBadge value={row.status} label={row.statusLabel} />
            <time>{formatDate(row.date)}</time>
            <button
              className={`today-plan-button ${isToday ? "is-active" : ""}`}
              onClick={() => onToggleToday(row)}
              aria-label={isToday ? "今日の予定から外す" : "今日の予定に追加"}
              title={isToday ? "今日の予定から外す" : "今日の予定に追加"}
              disabled={!canToggleToday(row)}
            >
              <IconCalendarPlus size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function TodayPage({ data, domain: v2, themes, openDrawer, navigate, saveEntities, setToast }: PageProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addTheme, setAddTheme] = useState("");
  const today = todayIso();
  const soon = addDays(today, 14);
  const schedules = schedulesByOwner(v2);
  const todayRows = buildTodayView(v2, today).map((entry) => todayEntryToRow(entry));
  const taskRows = v2.tasks.map((task) => taskToRow(task, schedules.get(`task:${task.id}`)));
  const waitingRows = v2.waitings.map((waiting) => waitingToRow(waiting, schedules.get(`waiting:${waiting.id}`)));
  const planNodeRows = v2.plan_nodes.map((planNode) => planNodeToRow(planNode, schedules.get(`plan_node:${planNode.id}`)));
  const overdue = [
    ...taskRows.filter((row) => row.status !== "done" && row.status !== "cancelled" && row.date && row.date < today),
    ...waitingRows.filter((row) => row.status === "waiting" && row.date && row.date < today),
    ...planNodeRows.filter((row) => row.status !== "done" && row.status !== "cancelled" && row.date && row.date < today),
  ].sort(compareRows);
  const inbox = v2.capture_entries
    .filter((entry) => entry.state === "untriaged")
    .map((entry) => captureToRow(entry))
    .sort(compareRows);
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

  async function handleToggleComplete(row: TodayRow) {
    if (row.v2?.type === "task") {
      const nextState = row.v2.task.state === "done" ? "todo" : "done";
      const next: Task = { ...row.v2.task, state: nextState, completed_at: nextState === "done" ? new Date().toISOString() : null };
      await saveEntities(buildSaveTaskOperations(next), nextState === "done" ? "完了しました。" : "未完了に戻しました。");
      return;
    }
    if (row.v2?.type === "waiting") {
      const nextState = row.v2.waiting.state === "received" ? "waiting" : "received";
      const next: Waiting = { ...row.v2.waiting, state: nextState };
      await saveEntities(buildSaveWaitingOperations(next), nextState === "received" ? "受領しました。" : "待ちに戻しました。");
      return;
    }
    if (row.v2?.type === "milestone") {
      const nextState = row.v2.planNode.state === "done" ? "planned" : "done";
      const next: PlanNode = { ...row.v2.planNode, state: nextState };
      await saveEntities(buildSavePlanNodeOperations(next), nextState === "done" ? "完了しました。" : "未完了に戻しました。");
      return;
    }
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

  function handleOpenDetail(row: TodayRow) {
    if (row.v2) {
      if (row.v2.type === "task") {
        openDrawer({ type: "task", entity: { ...row.v2.task, _schedule: row.v2.schedule } as Record<string, unknown> });
        return;
      }
      if (row.v2.type === "waiting") {
        openDrawer({ type: "waiting", entity: { ...row.v2.waiting, _schedule: row.v2.schedule } as Record<string, unknown> });
        return;
      }
      if (row.v2.type === "milestone") {
        openDrawer({ type: "plan_node", entity: { ...row.v2.planNode, _schedule: row.v2.schedule } as Record<string, unknown> });
        return;
      }
      if (row.v2.type === "capture") {
        openDrawer({ type: "capture_entry", entity: row.v2.captureEntry as Record<string, unknown> });
        return;
      }
    }
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
    "## Waiting",
    ...(waitingSoon.length ? waitingSoon.map((row) => `- ${row.date || "予定なし"} ${row.title}${row.waitingFor ? ` / ${row.waitingFor}` : ""}`) : ["- なし"]),
  ].join("\n");

  const rowHandlers = {
    onToggleComplete: handleToggleComplete,
    onToggleToday: handleToggleToday,
    onOpenDetail: handleOpenDetail,
  };

  return (
    <div className="page today-page">
      <PageHeader title="Today" subtitle="今日見るものを一か所に集めます。">
        <button className="secondary-button" onClick={() => workspaceApi.copyText(todayMarkdown).then(() => setToast("Todayの内容をコピーしました。"))}>
          <IconClipboard size={16} /> コピー
        </button>
        <button className="primary-button" onClick={() => setShowAdd((v) => !v)}><IconPlus size={16} /> 今日のタスクを追加</button>
      </PageHeader>

      {showAdd && (
        <section className="panel">
          <div className="section-heading"><h2>今日のタスクを追加</h2></div>
          <div className="inline-actions" style={{ gap: "var(--space-sm)" }}>
            <input
              style={{ flex: 1 }}
              value={addTitle}
              onChange={(e) => setAddTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTask()}
              placeholder="タスク名"
              autoFocus
            />
            <select value={addTheme} onChange={(e) => setAddTheme(e.target.value)}>
              <option value="">個人業務</option>
              {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
            </select>
            <button className="primary-button compact" onClick={addTask}>追加</button>
          </div>
        </section>
      )}

      <div className="metric-grid today-metrics">
        <Metric label="今日" value={todayRows.length} tone="primary" />
        <Metric label="期限切れ" value={overdue.length} tone={overdue.length ? "danger" : ""} />
        <Metric label="Inbox" value={inbox.length} />
        <Metric label="予定なし" value={noSchedule.length} />
      </div>

      <section className="panel today-focus-panel">
        <div className="section-heading">
          <h2>今日やること</h2>
          <button className="text-button compact" onClick={() => navigate("todo")}>ToDoへ</button>
        </div>
        <TodayRows rows={todayRows} themes={themes} empty="今日のタスクはありません" today={today} {...rowHandlers} onAdd={() => setShowAdd(true)} />
      </section>

      <div className="today-grid">
        <section className="panel">
          <div className="section-heading"><h2>期限切れ</h2><span>{overdue.length}件</span></div>
          <TodayRows rows={overdue.slice(0, 8)} themes={themes} empty="期限切れはありません" today={today} {...rowHandlers} />
        </section>
        <section className="panel">
          <div className="section-heading"><h2>Inbox未整理</h2><button className="text-button compact" onClick={() => navigate("inbox")}>整理へ</button></div>
          <TodayRows rows={inbox.slice(0, 8)} themes={themes} empty="未整理の記録はありません" today={today} {...rowHandlers} />
        </section>
      </div>

      <div className="today-grid">
        <section className="panel">
          <div className="section-heading"><h2>予定なし</h2><span>{noSchedule.length}件</span></div>
          <TodayRows rows={noSchedule.slice(0, 8)} themes={themes} empty="予定なしのタスクはありません" today={today} {...rowHandlers} onAdd={() => setShowAdd(true)} />
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
