import { IconCalendarPlus, IconClipboard, IconFlagFilled } from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import { todayIso } from "../../../utils/dataFormat.js";
import type { Item, PageProps } from "../types";
import { addDays, formatDate } from "../lib/format";
import { EmptyState, Metric, PageHeader, StatusBadge } from "../components/common";
import { workspaceToV2 } from "../../workspace-v2/domain/legacyAdapter";
import {
  CAPTURE_ENTRY_STATE_LABELS,
  PLAN_NODE_STATE_LABELS,
  PLAN_NODE_TYPE_LABELS,
  TASK_STATE_LABELS,
  WAITING_STATE_LABELS,
} from "../../workspace-v2/domain/labels";
import { buildTodayView } from "../../workspace-v2/domain/selectors";
import type { CaptureEntry, PlanNode, Schedule, Task, Waiting, WorkspaceV2 } from "../../workspace-v2/domain/types";
import type { TodayEntry } from "../../workspace-v2/domain/viewModels";

type TodayRow = {
  id: string;
  title: string;
  projectId?: string | null;
  date?: string;
  kindLabel: string;
  status: string;
  statusLabel: string;
  priority?: "normal" | "high";
  legacyItem?: Item;
  waitingFor?: string | null;
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

function schedulesByOwner(v2: WorkspaceV2): Map<string, Schedule> {
  return new Map(v2.schedules.map((schedule) => [`${schedule.owner_type}:${schedule.owner_id}`, schedule]));
}

function rowDate(row: TodayRow): string {
  return String(row.date || "9999-12-31");
}

function compareRows(a: TodayRow, b: TodayRow): number {
  return rowDate(a).localeCompare(rowDate(b)) || a.title.localeCompare(b.title, "ja");
}

function taskToRow(task: Task, schedule: Schedule | undefined, legacyItem?: Item): TodayRow {
  return {
    id: task.id,
    title: task.title,
    projectId: task.project_id,
    date: scheduleDate(schedule),
    kindLabel: "タスク",
    status: task.state,
    statusLabel: TASK_STATE_LABELS[task.state],
    priority: task.priority,
    legacyItem,
  };
}

function waitingToRow(waiting: Waiting, schedule: Schedule | undefined, legacyItem?: Item): TodayRow {
  return {
    id: waiting.id,
    title: waiting.title,
    projectId: waiting.project_id,
    date: scheduleDate(schedule),
    kindLabel: "待ち",
    status: waiting.state,
    statusLabel: WAITING_STATE_LABELS[waiting.state],
    legacyItem,
    waitingFor: waiting.waiting_for,
  };
}

function planNodeToRow(planNode: PlanNode, schedule: Schedule | undefined, legacyItem?: Item): TodayRow {
  return {
    id: planNode.id,
    title: planNode.title,
    projectId: planNode.project_id,
    date: scheduleDate(schedule),
    kindLabel: PLAN_NODE_TYPE_LABELS[planNode.type],
    status: planNode.state,
    statusLabel: planNode.type === "milestone" ? "マイルストーン" : PLAN_NODE_STATE_LABELS[planNode.state],
    legacyItem,
  };
}

function captureToRow(captureEntry: CaptureEntry, legacyItem?: Item): TodayRow {
  return {
    id: captureEntry.id,
    title: captureEntry.title || captureEntry.text,
    date: captureEntry.captured_at,
    kindLabel: "Capture",
    status: captureEntry.state,
    statusLabel: CAPTURE_ENTRY_STATE_LABELS[captureEntry.state],
    legacyItem,
  };
}

function todayEntryToRow(entry: TodayEntry, legacyItemsById: Map<string, Item>): TodayRow {
  if (entry.type === "task") return taskToRow(entry.task, entry.schedule, entry.task.legacy_item_id ? legacyItemsById.get(entry.task.legacy_item_id) : undefined);
  if (entry.type === "waiting") return waitingToRow(entry.waiting, entry.schedule, entry.waiting.legacy_item_id ? legacyItemsById.get(entry.waiting.legacy_item_id) : undefined);
  if (entry.type === "milestone") return planNodeToRow(entry.planNode, entry.schedule, entry.planNode.legacy_item_id ? legacyItemsById.get(entry.planNode.legacy_item_id) : undefined);
  return captureToRow(entry.captureEntry, entry.captureEntry.legacy_item_id ? legacyItemsById.get(entry.captureEntry.legacy_item_id) : undefined);
}

function TodayRows({
  rows,
  themes,
  empty,
  today,
  openDrawer,
  toggleItem,
  saveEntity,
}: Pick<PageProps, "themes" | "openDrawer" | "toggleItem" | "saveEntity"> & {
  rows: TodayRow[];
  empty: string;
  today: string;
}) {
  if (!rows.length) return <EmptyState title={empty} action="タスクを追加" onAction={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "task" } })} />;
  return (
    <div className="today-task-list">
      {rows.map((row) => {
        const theme = themes.find((entry) => entry.id === row.projectId);
        const isToday = row.date?.slice(0, 10) === today;
        return (
          <div className="today-task-row" key={row.id}>
            <button className="check-button" aria-label={`${row.title}を完了`} onClick={() => row.legacyItem && toggleItem(row.legacyItem)} disabled={!row.legacyItem} />
            <button className="today-task-title" onClick={() => row.legacyItem && openDrawer({ type: "item", entity: row.legacyItem })}>
              <strong>{row.title}</strong>
              <span>{theme?.name || "個人業務"} / {row.kindLabel}</span>
            </button>
            {row.priority === "high" && <IconFlagFilled className="inline-icon accent" size={16} aria-label="優先" />}
            <StatusBadge value={row.status} label={row.statusLabel} />
            <time>{formatDate(row.date)}</time>
            <button
              className={`today-plan-button ${isToday ? "is-active" : ""}`}
              onClick={() => row.legacyItem && saveEntity("item", { ...row.legacyItem, today_flag: !row.legacyItem.today_flag })}
              aria-label={isToday ? "今日の予定から外す" : "今日の予定に追加"}
              title={isToday ? "今日の予定から外す" : "今日の予定に追加"}
              disabled={!row.legacyItem}
            >
              <IconCalendarPlus size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function TodayPage({ data, themes, items, openDrawer, navigate, saveEntity, toggleItem, setToast }: PageProps) {
  const today = todayIso();
  const soon = addDays(today, 14);
  const v2 = workspaceToV2(data);
  const schedules = schedulesByOwner(v2);
  const legacyItemsById = new Map(items.map((item) => [item.id, item]));
  const legacyFor = (legacyItemId?: string | null): Item | undefined => legacyItemId ? legacyItemsById.get(legacyItemId) : undefined;
  const todayRows = buildTodayView(v2, today).map((entry) => todayEntryToRow(entry, legacyItemsById));
  const taskRows = v2.tasks.map((task) => taskToRow(task, schedules.get(`task:${task.id}`), legacyFor(task.legacy_item_id)));
  const waitingRows = v2.waitings.map((waiting) => waitingToRow(waiting, schedules.get(`waiting:${waiting.id}`), legacyFor(waiting.legacy_item_id)));
  const planNodeRows = v2.plan_nodes.map((planNode) => planNodeToRow(planNode, schedules.get(`plan_node:${planNode.id}`), legacyFor(planNode.legacy_item_id)));
  const overdue = [
    ...taskRows.filter((row) => row.status !== "done" && row.status !== "cancelled" && row.date && row.date < today),
    ...waitingRows.filter((row) => row.status === "waiting" && row.date && row.date < today),
    ...planNodeRows.filter((row) => row.status !== "done" && row.status !== "cancelled" && row.date && row.date < today),
  ].sort(compareRows);
  const inbox = v2.capture_entries
    .filter((entry) => entry.state === "untriaged")
    .map((entry) => captureToRow(entry, legacyFor(entry.legacy_item_id)))
    .sort(compareRows);
  const noSchedule = taskRows
    .filter((row) => row.status !== "done" && row.status !== "cancelled" && !row.date)
    .sort((a, b) => Number(b.priority === "high") - Number(a.priority === "high") || a.title.localeCompare(b.title, "ja"));
  const milestones = v2.plan_nodes
    .filter((planNode) => planNode.type === "milestone" && isActivePlanNode(planNode) && scheduleTouchesRange(schedules.get(`plan_node:${planNode.id}`), today, soon))
    .map((planNode) => planNodeToRow(planNode, schedules.get(`plan_node:${planNode.id}`), legacyFor(planNode.legacy_item_id)))
    .sort(compareRows);
  const waitingSoon = v2.waitings
    .filter((waiting) => waiting.state === "waiting" && scheduleTouchesRange(schedules.get(`waiting:${waiting.id}`), "", soon))
    .map((waiting) => waitingToRow(waiting, schedules.get(`waiting:${waiting.id}`), legacyFor(waiting.legacy_item_id)))
    .sort(compareRows);
  const latestUpdates = [...(data.status_updates || [])]
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 5);

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

  return (
    <div className="page today-page">
      <PageHeader title="Today" subtitle="今日見るものを一か所に集めます。">
        <button className="secondary-button" onClick={() => workspaceApi.copyText(todayMarkdown).then(() => setToast("Todayの内容をコピーしました。"))}>
          <IconClipboard size={16} /> コピー
        </button>
        <button className="primary-button" onClick={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "task", today_flag: true, planned_end: today } })}>今日のタスクを追加</button>
      </PageHeader>

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
        <TodayRows rows={todayRows} themes={themes} empty="今日のタスクはありません" today={today} openDrawer={openDrawer} toggleItem={toggleItem} saveEntity={saveEntity} />
      </section>

      <div className="today-grid">
        <section className="panel">
          <div className="section-heading"><h2>期限切れ</h2><span>{overdue.length}件</span></div>
          <TodayRows rows={overdue.slice(0, 8)} themes={themes} empty="期限切れはありません" today={today} openDrawer={openDrawer} toggleItem={toggleItem} saveEntity={saveEntity} />
        </section>
        <section className="panel">
          <div className="section-heading"><h2>Inbox未整理</h2><button className="text-button compact" onClick={() => navigate("inbox")}>整理へ</button></div>
          <TodayRows rows={inbox.slice(0, 8)} themes={themes} empty="未整理の記録はありません" today={today} openDrawer={openDrawer} toggleItem={toggleItem} saveEntity={saveEntity} />
        </section>
      </div>

      <div className="today-grid">
        <section className="panel">
          <div className="section-heading"><h2>予定なし</h2><span>{noSchedule.length}件</span></div>
          <TodayRows rows={noSchedule.slice(0, 8)} themes={themes} empty="予定なしのタスクはありません" today={today} openDrawer={openDrawer} toggleItem={toggleItem} saveEntity={saveEntity} />
        </section>
        <section className="panel">
          <div className="section-heading"><h2>近いマイルストーン</h2><button className="text-button compact" onClick={() => navigate("timeline")}>Timelineへ</button></div>
          <TodayRows rows={milestones.slice(0, 8)} themes={themes} empty="近いマイルストーンはありません" today={today} openDrawer={openDrawer} toggleItem={toggleItem} saveEntity={saveEntity} />
        </section>
      </div>

      <div className="today-grid">
        <section className="panel">
          <div className="section-heading"><h2>期限が近い待ち</h2><button className="text-button compact" onClick={() => navigate("waiting")}>Waitingへ</button></div>
          <TodayRows rows={waitingSoon.slice(0, 8)} themes={themes} empty="近い待ちはありません" today={today} openDrawer={openDrawer} toggleItem={toggleItem} saveEntity={saveEntity} />
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
