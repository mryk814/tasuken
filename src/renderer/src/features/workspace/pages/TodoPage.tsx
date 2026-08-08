import { useEffect, useState } from "react";
import { IconCalendarPlus, IconCalendarCheck, IconClock, IconCopyPlus, IconFlag, IconFlagFilled, IconPlus } from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import { todayIso } from "../../../utils/dataFormat.js";
import { playCompleteSound } from "../../../utils/sounds";
import type { PageProps } from "../types";
import { themeColor } from "../lib/domain";
import { formatDate } from "../lib/format";
import { compareTodoRows, isTodayRow, scheduledDate } from "../lib/todoRows.js";
import {
  DEFAULT_TASK_VIEW_FILTERS,
  filterTodoRows,
  normalizeTaskViewFilters,
  type TaskViewFilters,
  type TaskViewTab,
} from "../lib/savedTaskViews";
import { Button, EmptyState, PageHeader } from "../components/common";
import { InlineAddPanel } from "../components/InlineAddPanel";
import { ChecklistProgressBadge } from "../components/taskChecklist";
import { SCHEDULE_KIND_LABELS, TASK_STATE_LABELS } from "../domain-model/labels";
import { buildTodoView } from "../domain-model/selectors";
import { getScheduleKind } from "../domain-model/scheduleSemantics";
import { buildSaveTaskOperations, buildSaveScheduleOperations } from "../domain-model/persistence";
import { duplicateTask } from "../domain-model/taskDuplication";
import { buildCompleteTaskOperations, repeatRuleLabel } from "../domain-model/taskRecurrence";
import type { Schedule, Task } from "../domain-model/types";
import { canonicalThemeId } from "../../../../../shared/themeRef.mjs";

type TodoRow = {
  task: Task;
  schedule?: Schedule;
};

type TodoSortMode = "default" | "priority" | "theme" | "title";
type TodoSortDirection = "asc" | "desc";
type TodoGroupMode = "none" | "schedule" | "theme";
type TodoRowGroup = {
  id: string;
  title: string;
  rows: TodoRow[];
};

function isDoneRow(row: TodoRow): boolean {
  return row.task.state === "done" || row.task.state === "cancelled";
}

function reminderTimeLabel(value: unknown, today: string): string {
  const raw = String(value || "");
  if (!raw) return "";
  const date = raw.slice(0, 10);
  const time = raw.includes("T") ? raw.slice(11, 16) : "";
  if (!time) return "";
  return date && date !== today ? `${formatDate(date)} ${time}` : time;
}

function sortTodoRows(rows: TodoRow[], sortMode: TodoSortMode, direction: TodoSortDirection, filter: string, today: string, themes: PageProps["themes"]): TodoRow[] {
  const themeName = (row: TodoRow) => themes.find((theme) => theme.id === row.task.project_id)?.name || "個人業務";
  const priorityRank = (row: TodoRow) => row.task.priority === "high" ? 0 : 1;
  const baseCompare = (left: TodoRow, right: TodoRow) => {
    if (sortMode === "default" && filter === "done") {
      return String(left.task.completed_at || "0000-00-00").localeCompare(String(right.task.completed_at || "0000-00-00"));
    }
    return compareTodoRows(today)(left, right);
  };
  return [...rows].sort((left, right) => {
    let result = 0;
    if (sortMode === "priority") {
      const priorityDiff = priorityRank(left) - priorityRank(right);
      if (priorityDiff) result = priorityDiff;
    }
    if (!result && sortMode === "theme") {
      const themeDiff = themeName(left).localeCompare(themeName(right), "ja");
      if (themeDiff) result = themeDiff;
    }
    if (!result && sortMode === "title") {
      const titleDiff = left.task.title.localeCompare(right.task.title, "ja");
      if (titleDiff) result = titleDiff;
    }
    if (!result) result = baseCompare(left, right);
    return direction === "desc" ? -result : result;
  });
}

function scheduleGroupLabel(row: TodoRow, today: string): string {
  const date = scheduledDate(row.schedule);
  if (!date) return "予定なし";
  if (date < today) return "予定超過";
  if (date === today) return "今日";
  return "今後";
}

function rangeSemanticsBadge(row: TodoRow, openTaskDetail: (task: Task, schedule?: Schedule) => void) {
  const kind = getScheduleKind(row.schedule);
  if (kind !== "execution_window" && kind !== "ongoing_period" && kind !== "unspecified_range") return null;
  const label = SCHEDULE_KIND_LABELS[kind];
  if (kind === "unspecified_range") {
    return (
      <button
        type="button"
        className="range-semantics-badge range-semantics-badge-button"
        onClick={(event) => { event.stopPropagation(); openTaskDetail(row.task, row.schedule); }}
        title="編集して期間の意味を選ぶ"
      >{label}</button>
    );
  }
  return <span className="range-semantics-badge">{label}</span>;
}

function groupTodoRows(rows: TodoRow[], groupMode: TodoGroupMode, today: string, themes: PageProps["themes"]): TodoRowGroup[] {
  if (groupMode === "none") return [{ id: "all", title: "すべて", rows }];
  const groups = new Map<string, TodoRowGroup>();
  rows.forEach((row) => {
    const theme = themes.find((entry) => entry.id === row.task.project_id);
    const title = groupMode === "theme" ? theme?.name || "個人業務" : scheduleGroupLabel(row, today);
    const id = groupMode === "theme" ? row.task.project_id || "personal" : title;
    if (!groups.has(id)) groups.set(id, { id, title, rows: [] });
    groups.get(id)?.rows.push(row);
  });
  return [...groups.values()];
}

export function TodoPage({ data, domain, themes, route, openDrawer, saveEntities, setToast }: PageProps) {
  const [filter, setFilter] = useState("open");
  const [taskFilters, setTaskFilters] = useState<TaskViewFilters>(DEFAULT_TASK_VIEW_FILTERS);
  const [sortMode, setSortMode] = useState<TodoSortMode>("default");
  const [sortDirection, setSortDirection] = useState<TodoSortDirection>("desc");
  const [groupMode, setGroupMode] = useState<TodoGroupMode>("none");
  const [showAdd, setShowAdd] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addTheme, setAddTheme] = useState("");
  const [addDate, setAddDate] = useState("");
  const today = todayIso();

  useEffect(() => {
    if (route === "todo") {
      setFilter("open");
      setTaskFilters(DEFAULT_TASK_VIEW_FILTERS);
      setSortMode("default");
      setSortDirection("desc");
      setGroupMode("none");
    }
  }, [route]);

  const taskRows: TodoRow[] = buildTodoView(domain).tasks;
  const currentFilters: TaskViewFilters = normalizeTaskViewFilters({ ...taskFilters, tab: filter });
  const counters = {
    today: taskRows.filter((row) => !isDoneRow(row) && isTodayRow(row, today)).length,
    open: taskRows.filter((row) => !isDoneRow(row)).length,
    overdue: taskRows.filter((row) => !isDoneRow(row) && scheduledDate(row.schedule) && scheduledDate(row.schedule) < today).length,
    noSchedule: taskRows.filter((row) => !isDoneRow(row) && !scheduledDate(row.schedule)).length,
    done: taskRows.filter(isDoneRow).length,
  };
  const visible = sortTodoRows(filterTodoRows(taskRows, currentFilters, today), sortMode, sortDirection, filter, today, themes);
  const groupedVisible = groupTodoRows(visible, groupMode, today, themes);

  function patchTaskFilters(patch: Partial<TaskViewFilters>) {
    setTaskFilters((current) => normalizeTaskViewFilters({ ...current, ...patch }));
  }

  function selectFilterTab(nextFilter: TaskViewTab) {
    setFilter(nextFilter);
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
      created_at: new Date().toISOString(),
    };
    const ops = buildSaveTaskOperations(task);
    if (addDate) {
      const schedule: Schedule = {
        id: crypto.randomUUID(),
        owner_type: "task",
        owner_id: taskId,
        end_date: addDate,
        date_kind: "deadline",
        confidence: "fixed",
        granularity: "day",
      };
      ops.push(...buildSaveScheduleOperations(schedule));
    }
    await saveEntities(ops, "タスクを追加しました。");
    setAddTitle("");
    setAddDate("");
  }

  async function toggleTask(task: Task) {
    const nextState = task.state === "done" ? "todo" : "done";
    if (nextState === "done") playCompleteSound();
    const row = taskRows.find((entry) => entry.task.id === task.id);
    const nextMessage = nextState === "done" && task.repeat_rule ? "完了しました。次のタスクを作成しました。" : nextState === "done" ? "完了しました。" : "未完了に戻しました。";
    await saveEntities(buildCompleteTaskOperations(task, row?.schedule), nextMessage);
  }

  async function togglePriority(task: Task) {
    const nextTask: Task = { ...task, priority: task.priority === "high" ? "normal" : "high" };
    await saveEntities(buildSaveTaskOperations(nextTask));
  }

  async function toggleToday(task: Task, schedule: Schedule | undefined) {
    const isToday = schedule?.start_date === today || schedule?.end_date === today;
    if (!schedule) {
      const newSchedule: Schedule = {
        id: crypto.randomUUID(),
        owner_type: "task",
        owner_id: task.id,
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
  }

  async function copyTask(task: Task, schedule?: Schedule) {
    const duplicated = duplicateTask(task, schedule);
    const ops = buildSaveTaskOperations(duplicated.task, { reason: "duplicated" });
    if (duplicated.schedule) {
      ops.push(...buildSaveScheduleOperations(duplicated.schedule, { reason: "duplicated" }));
    }
    await saveEntities(ops, "タスクを複製しました。");
    openTaskDetail(duplicated.task, duplicated.schedule);
  }

  function copyRows() {
    const header = "タスク\t状態\tテーマ\t今日\t予定終了\t完了日\tリマインダー\t旗\t繰り返し";
    const rows = visible.map(({ task, schedule }) => `${task.title}\t${TASK_STATE_LABELS[task.state]}\t${themes.find((theme) => theme.id === task.project_id)?.name || "個人業務"}\t${isTodayRow({ task, schedule }, today) ? "今日" : ""}\t${scheduledDate(schedule) || "予定なし"}\t${task.completed_at ? task.completed_at.slice(0, 10) : ""}\t${reminderTimeLabel(task.reminder_at, today)}\t${task.priority === "high" ? "あり" : "なし"}\t${repeatRuleLabel(task.repeat_rule)}`);
    workspaceApi.copyText([header, ...rows].join("\n")).then(() => setToast("ToDo一覧をコピーしました。"));
  }

  function openTaskDetail(task: Task, schedule?: Schedule) {
    openDrawer({ type: "task", mode: "edit", entity: { ...task, _schedule: schedule } as Record<string, unknown> });
  }

  function renderTodoRow({ task, schedule }: TodoRow) {
    const theme = (data.themes || []).find((entry) => entry.id === task.project_id);
    const themeIndex = Math.max(0, (data.themes || []).findIndex((entry) => entry.id === task.project_id));
    const chipColor = `var(--color-${themeColor(theme, themeIndex)})`;
    const done = task.state === "done" || task.state === "cancelled";
    const due = scheduledDate(schedule);
    const completionDate = task.completed_at ? task.completed_at.slice(0, 10) : "";
    const urgency = !done && due ? (due < today ? "overdue" : due === today ? "due-today" : null) : null;
    const reminder = reminderTimeLabel(task.reminder_at, today);
    return (
      <div
        className={`table-row is-clickable-row${urgency ? ` is-${urgency}` : ""}`}
        key={task.id}
        style={{ "--chip-color": chipColor } as React.CSSProperties}
        onClick={() => openTaskDetail(task, schedule)}
      >
        <span className="todo-theme-bar" />
        <button
          className={`todo-check-circle ${done ? "is-done" : ""}`}
          onClick={(event) => { event.stopPropagation(); toggleTask(task); }}
          aria-label={done ? `${task.title}を未完了に戻す` : `${task.title}を完了`}
          title={done ? "未完了に戻す" : "完了にする"}
        >
          {done && <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </button>
        <div className="row-title-wrap">
          <button
            className={`priority-flag-button ${task.priority === "high" ? "is-active" : ""}`}
            onClick={(event) => { event.stopPropagation(); togglePriority(task); }}
            aria-label={task.priority === "high" ? "旗を外す" : "旗を付ける"}
            title={task.priority === "high" ? "旗を外す" : "旗を付ける"}
          >
            {task.priority === "high" ? <IconFlagFilled size={16} /> : <IconFlag size={16} />}
          </button>
          <button
            className={`today-plan-button ${isTodayRow({ task, schedule }, today) ? "is-active" : ""}`}
            onClick={(event) => { event.stopPropagation(); toggleToday(task, schedule); }}
            aria-label={isTodayRow({ task, schedule }, today) ? "今日の予定から外す" : "今日の予定に追加"}
            title={isTodayRow({ task, schedule }, today) ? "今日の予定から外す" : "今日の予定に追加"}
          >
            {isTodayRow({ task, schedule }, today) ? <IconCalendarCheck size={16} /> : <IconCalendarPlus size={16} />}
          </button>
          <button
            className="todo-copy-button"
            onClick={(event) => { event.stopPropagation(); copyTask(task, schedule); }}
            aria-label={`${task.title}を複製`}
            title="複製"
          >
            <IconCopyPlus size={16} />
          </button>
          <button className={`row-title ${done ? "is-done" : ""}`} onClick={(event) => { event.stopPropagation(); openTaskDetail(task, schedule); }}>
            <span>{task.title}</span>
            <ChecklistProgressBadge items={task.checklist_items} />
          </button>
           {rangeSemanticsBadge({ task, schedule }, openTaskDetail)}
          {reminder && <span className="row-reminder-meta"><IconClock size={13} />{reminder}</span>}
        </div>
        <span className="todo-repeat-label">{repeatRuleLabel(task.repeat_rule)}</span>
        <span className="theme-inline">
          <span className="chip-dot" />
          {theme?.name || "個人業務"}
        </span>
        <span className={`num${urgency ? ` is-${urgency}` : ""}`}>{formatDate(done ? completionDate : due)}</span>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader route="todo">
        <button className="secondary-button" onClick={copyRows}>一覧をコピー</button>
        <Button variant="primary" onClick={() => setShowAdd((current) => !current)}><IconPlus size={16} /> タスクを追加</Button>
      </PageHeader>
      {showAdd && (
        <InlineAddPanel
          heading="タスクを追加"
          title={addTitle}
          titlePlaceholder="タスク名"
          theme={addTheme}
          themes={themes}
          onTitleChange={setAddTitle}
          onThemeChange={setAddTheme}
          onSubmit={addTask}
          extraFields={<input type="date" value={addDate} onChange={(event) => setAddDate(event.target.value)} />}
        />
      )}
      <div className="todo-filter-tabs">
        {([["today", "今日", counters.today], ["open", "未完了", counters.open], ["overdue", "予定超過", counters.overdue], ["no-schedule", "予定なし", counters.noSchedule], ["done", "完了", counters.done]] as const).map(([id, label, count]) => (
          <button key={id} className={filter === id ? "is-active" : ""} onClick={() => selectFilterTab(id)}>{label}<span className="tab-count">{count}</span></button>
        ))}
      </div>
      <section className="panel list-page">
        <div className="todo-table-toolbar">
          <select value={taskFilters.themeId} onChange={(event) => patchTaskFilters({ themeId: event.target.value })} aria-label="Themeで絞り込み">
            <option value="">すべてのTheme</option>
            {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
          </select>
          <select value={taskFilters.state} onChange={(event) => patchTaskFilters({ state: event.target.value })} aria-label="状態で絞り込み">
            <option value="">すべての状態</option>
            {Object.entries(TASK_STATE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select value={taskFilters.schedule} onChange={(event) => patchTaskFilters({ schedule: event.target.value as TaskViewFilters["schedule"] })} aria-label="予定で絞り込み">
            <option value="">予定条件なし</option>
            <option value="scheduled">予定あり</option>
            <option value="no-schedule">予定なし</option>
            <option value="overdue">予定超過</option>
            <option value="this-week">今週中</option>
            <option value="today">今日</option>
          </select>
          <select value={taskFilters.rangeSemantics} onChange={(event) => patchTaskFilters({ rangeSemantics: event.target.value as TaskViewFilters["rangeSemantics"] })} aria-label="期間の意味で絞り込み">
            <option value="">期間の意味: すべて</option>
            <option value="execution_window">期間内に一度</option>
            <option value="ongoing_period">期間中継続</option>
            <option value="unspecified_range">期間未分類</option>
          </select>
          <select value={taskFilters.priority} onChange={(event) => patchTaskFilters({ priority: event.target.value as TaskViewFilters["priority"] })} aria-label="旗で絞り込み">
            <option value="">旗条件なし</option>
            <option value="high">旗あり</option>
            <option value="normal">旗なし</option>
          </select>
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as TodoSortMode)} aria-label="並び替え">
            <option value="default">並び替え: {filter === "done" ? "完了日" : "予定終了日"}</option>
            <option value="priority">並び替え: 旗優先</option>
            <option value="theme">並び替え: Theme順</option>
            <option value="title">並び替え: 名前順</option>
          </select>
          <select value={sortDirection} onChange={(event) => setSortDirection(event.target.value as TodoSortDirection)} aria-label="並び順の向き">
            <option value="desc">降順（新しい順）</option>
            <option value="asc">昇順（古い順）</option>
          </select>
          <select value={groupMode} onChange={(event) => setGroupMode(event.target.value as TodoGroupMode)} aria-label="グループ">
            <option value="none">グループなし</option>
            <option value="schedule">予定でグループ</option>
            <option value="theme">Themeでグループ</option>
          </select>
        </div>
        <div className="data-table todo-table">
          <div className="table-head"><span /><span /><span>タスク</span><span>繰り返し</span><span>Theme</span><span>{filter === "done" ? "完了日" : "予定終了"}</span></div>
          {groupedVisible.map((group) => (
            <div key={group.id} className="todo-row-group">
              {groupMode !== "none" && <div className="todo-group-heading"><span>{group.title}</span><strong>{group.rows.length}件</strong></div>}
              {group.rows.map(renderTodoRow)}
            </div>
          ))}
        </div>
        {!visible.length && <EmptyState title="該当するタスクはありません" action="タスクを追加" onAction={() => setShowAdd(true)} />}
      </section>
    </div>
  );
}
