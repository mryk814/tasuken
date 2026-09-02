import { useEffect, useMemo, useState } from "react";
import {
  IconCalendarPlus,
  IconCalendarCheck,
  IconClock,
  IconCopyPlus,
  IconLoader2,
  IconPlus,
} from "@tabler/icons-react";

import { AI_ICON } from "../../../pages/semanticIcons";
import { workspaceApi } from "../../../services/workspaceApi";
import { todayIso } from "../../../utils/dataFormat.js";
import { usePreference } from "../../../utils/usePreference";
import { playCompleteSound } from "../../../utils/sounds";
import type { PageProps } from "../types";
import { themeColor } from "../lib/domain";
import { formatDate } from "../lib/format";
import { compareTodoRows, isTodayRow, scheduledDate } from "../lib/todoRows.js";
import {
  filterTodoRows,
  normalizeTaskViewFilters,
  type TaskViewFilters,
  type TaskViewTab,
} from "../lib/savedTaskViews";
import { Button, EmptyState, PageHeader, ThemePickerSelect } from "../components/common";
import { InlineAddPanel } from "../components/InlineAddPanel";
import { ChecklistProgressBadge, InlineTaskChecklist } from "../../task/public";
import { TASK_STATE_LABELS } from "../domain-model/labels";
import { buildTodoView } from "../domain-model/selectors";
import { buildSaveTaskOperations, buildSaveScheduleOperations } from "../domain-model/persistence";
import { duplicateTask } from "../domain-model/taskDuplication";
import { buildCompleteTaskOperations, repeatRuleLabel } from "../domain-model/taskRecurrence";
import type { Schedule, Task } from "../domain-model/types";
import { canonicalThemeId, PERSONAL_DEFAULT_THEME_ID } from "../../../../../shared/themeRef.mjs";

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

const INITIAL_RENDERED_TASKS = 160;
const RENDERED_TASK_BATCH = 160;

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

function sortTodoRows(
  rows: TodoRow[],
  sortMode: TodoSortMode,
  direction: TodoSortDirection,
  filter: string,
  today: string,
  themes: PageProps["themes"],
): TodoRow[] {
  const themeName = (row: TodoRow) =>
    themes.find((theme) => theme.id === row.task.project_id)?.name || "個人業務";
  const baseCompare = (left: TodoRow, right: TodoRow) => {
    if (sortMode === "default" && filter === "done") {
      return String(left.task.completed_at || "0000-00-00").localeCompare(
        String(right.task.completed_at || "0000-00-00"),
      );
    }
    return compareTodoRows(today)(left, right);
  };
  return [...rows].sort((left, right) => {
    let result = 0;
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

function groupTodoRows(
  rows: TodoRow[],
  groupMode: TodoGroupMode,
  today: string,
  themes: PageProps["themes"],
): TodoRowGroup[] {
  if (groupMode === "none") return [{ id: "all", title: "すべて", rows }];
  const groups = new Map<string, TodoRowGroup>();
  rows.forEach((row) => {
    const theme = themes.find((entry) => entry.id === row.task.project_id);
    const title =
      groupMode === "theme" ? theme?.name || "個人業務" : scheduleGroupLabel(row, today);
    const id = groupMode === "theme" ? row.task.project_id || "personal" : title;
    if (!groups.has(id)) groups.set(id, { id, title, rows: [] });
    groups.get(id)?.rows.push(row);
  });
  return [...groups.values()];
}

export function TodoPage({
  data,
  domain,
  themes,
  route,
  openDrawer,
  saveEntities,
  setToast,
  startFocusSession,
}: PageProps) {
  const [viewPreference, setViewPreference] = usePreference("todo.preferences");
  const { filter, taskFilters, sortMode, sortDirection, groupMode } = viewPreference;
  const [showAdd, setShowAdd] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addTheme, setAddTheme] = useState(PERSONAL_DEFAULT_THEME_ID);
  const [addDate, setAddDate] = useState("");
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() => new Set());
  const [bulkThemeId, setBulkThemeId] = useState(PERSONAL_DEFAULT_THEME_ID);
  const today = todayIso();

  const taskRows: TodoRow[] = useMemo(() => buildTodoView(domain).tasks, [domain]);
  const currentFilters: TaskViewFilters = useMemo(
    () =>
      normalizeTaskViewFilters({
        ...taskFilters,
        tab: filter,
        priority: "",
      }),
    [filter, taskFilters],
  );
  const counters = useMemo(
    () => ({
      today: taskRows.filter((row) => !isDoneRow(row) && isTodayRow(row, today)).length,
      open: taskRows.filter((row) => !isDoneRow(row)).length,
      overdue: taskRows.filter(
        (row) =>
          !isDoneRow(row) && scheduledDate(row.schedule) && scheduledDate(row.schedule) < today,
      ).length,
      noSchedule: taskRows.filter((row) => !isDoneRow(row) && !scheduledDate(row.schedule)).length,
      done: taskRows.filter(isDoneRow).length,
    }),
    [taskRows, today],
  );
  const visible = useMemo(
    () =>
      sortTodoRows(
        filterTodoRows(taskRows, currentFilters, today),
        sortMode,
        sortDirection,
        filter,
        today,
        themes,
      ),
    [currentFilters, filter, sortDirection, sortMode, taskRows, themes, today],
  );
  const visibleTaskCount = visible.length;
  const [renderedTaskCount, setRenderedTaskCount] = useState(INITIAL_RENDERED_TASKS);
  useEffect(() => {
    if (visibleTaskCount <= INITIAL_RENDERED_TASKS) return undefined;
    let cancelled = false;
    let idleHandle = 0;
    let nextCount = INITIAL_RENDERED_TASKS;
    const renderNextBatch = () => {
      idleHandle = window.requestIdleCallback(
        () => {
          if (cancelled) return;
          nextCount = Math.min(visibleTaskCount, nextCount + RENDERED_TASK_BATCH);
          setRenderedTaskCount(nextCount);
          if (nextCount < visibleTaskCount) renderNextBatch();
        },
        { timeout: 120 },
      );
    };
    renderNextBatch();
    return () => {
      cancelled = true;
      window.cancelIdleCallback(idleHandle);
    };
  }, [visibleTaskCount]);
  const groupedVisible = useMemo(
    () => groupTodoRows(visible.slice(0, renderedTaskCount), groupMode, today, themes),
    [groupMode, renderedTaskCount, themes, today, visible],
  );
  const selectedVisibleRows = useMemo(
    () => visible.filter((row) => selectedTaskIds.has(row.task.id)),
    [selectedTaskIds, visible],
  );
  const allVisibleSelected = visible.length > 0 && selectedVisibleRows.length === visible.length;

  function patchTaskFilters(patch: Partial<TaskViewFilters>) {
    setViewPreference((current) => ({
      ...current,
      taskFilters: normalizeTaskViewFilters({ ...current.taskFilters, ...patch }),
    }));
  }

  function selectFilterTab(nextFilter: TaskViewTab) {
    setViewPreference((current) => ({
      ...current,
      filter: nextFilter,
      taskFilters: { ...current.taskFilters, tab: nextFilter },
    }));
  }

  function setSortMode(next: TodoSortMode) {
    setViewPreference((current) => ({ ...current, sortMode: next }));
  }

  function setSortDirection(next: TodoSortDirection) {
    setViewPreference((current) => ({ ...current, sortDirection: next }));
  }

  function setGroupMode(next: TodoGroupMode) {
    setViewPreference((current) => ({ ...current, groupMode: next }));
  }

  function toggleTaskSelection(taskId: string) {
    setSelectedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  function toggleVisibleSelection() {
    const visibleIds = visible.map((row) => row.task.id);
    setSelectedTaskIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function reassignSelectedTheme() {
    const themeId = canonicalThemeId(bulkThemeId, { defaultPersonal: true });
    const changedRows = selectedVisibleRows.filter((row) => row.task.project_id !== themeId);
    if (!changedRows.length) {
      setToast("選択したタスクはすでにこのThemeです。", "info");
      return;
    }
    await saveEntities(
      changedRows.flatMap((row) =>
        buildSaveTaskOperations(
          { ...row.task, project_id: themeId },
          { reason: "bulk_theme_reassigned" },
        ),
      ),
      `${changedRows.length}件のThemeを変更しました。`,
    );
    setSelectedTaskIds((current) => {
      const next = new Set(current);
      selectedVisibleRows.forEach((row) => next.delete(row.task.id));
      return next;
    });
  }

  async function addTask() {
    const title = addTitle.trim();
    if (!title) {
      setToast("タイトルを入力してください。");
      return;
    }
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
    const nextMessage =
      nextState === "done" && task.repeat_rule
        ? "完了しました。次のタスクを作成しました。"
        : nextState === "done"
          ? "完了しました。"
          : "未完了に戻しました。";
    await saveEntities(buildCompleteTaskOperations(task, row?.schedule), nextMessage);
  }

  async function toggleAiReady(task: Task) {
    const workState =
      task.work_state ||
      (task.intended_executor === "ai_agent" ? "ready_for_agent" : "not_delegated");
    const aiReady = task.intended_executor === "ai_agent" && workState === "ready_for_agent";
    await saveEntities(
      buildSaveTaskOperations({
        ...task,
        intended_executor: aiReady ? "self" : "ai_agent",
        work_state: aiReady ? "not_delegated" : "ready_for_agent",
      }),
      aiReady ? "AI Readyを解除しました。" : "AI Readyにしました。",
    );
  }

  async function toggleChecklistItem(task: Task, itemId: string) {
    const nextItems = (task.checklist_items || []).map((item) =>
      item.id === itemId
        ? { ...item, done: !item.done, completed_at: !item.done ? new Date().toISOString() : null }
        : item,
    );
    await saveEntities(
      buildSaveTaskOperations({ ...task, checklist_items: nextItems }),
      "チェックリストを更新しました。",
    );
  }

  async function toggleToday(task: Task, schedule: Schedule | undefined) {
    if (task.today_date === today) {
      await saveEntities(
        buildSaveTaskOperations({ ...task, today_date: null }),
        "今日の予定から外しました。",
      );
    } else if (!schedule) {
      await saveEntities(
        buildSaveTaskOperations({ ...task, today_date: today }),
        "今日の予定に追加しました。",
      );
    } else if (schedule.start_date === today || schedule.end_date === today) {
      const next: Schedule = {
        ...schedule,
        start_date: schedule.start_date === today ? null : schedule.start_date,
        end_date: schedule.end_date === today ? null : schedule.end_date,
      };
      await saveEntities(buildSaveScheduleOperations(next), "今日の予定から外しました。");
    } else {
      await saveEntities(
        buildSaveTaskOperations({ ...task, today_date: today }),
        "今日の予定に追加しました。",
      );
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
    const header = "タスク\t状態\tテーマ\t今日\t予定終了\t完了日\tリマインダー\t繰り返し";
    const rows = visible.map(
      ({ task, schedule }) =>
        `${task.title}\t${TASK_STATE_LABELS[task.state]}\t${themes.find((theme) => theme.id === task.project_id)?.name || "個人業務"}\t${isTodayRow({ task, schedule }, today) ? "今日" : ""}\t${scheduledDate(schedule) || "予定なし"}\t${task.completed_at ? task.completed_at.slice(0, 10) : ""}\t${reminderTimeLabel(task.reminder_at, today)}\t${repeatRuleLabel(task.repeat_rule)}`,
    );
    workspaceApi
      .copyText([header, ...rows].join("\n"))
      .then(() => setToast("ToDo一覧をコピーしました。"));
  }

  function openTaskDetail(task: Task, schedule?: Schedule) {
    openDrawer({
      type: "task",
      mode: "edit",
      entity: { ...task, _schedule: schedule } as Record<string, unknown>,
    });
  }

  function openChecklistEditor(task: Task, schedule?: Schedule) {
    const checklistItems = task.checklist_items || [];
    const focusItemId = crypto.randomUUID();
    openDrawer({
      type: "task",
      mode: "edit",
      entity: {
        ...task,
        checklist_items: [
          ...checklistItems,
          {
            id: focusItemId,
            title: "",
            done: false,
            completed_at: null,
            sort_order: checklistItems.length,
          },
        ],
        _focusChecklistItem: focusItemId,
        _schedule: schedule,
      } as Record<string, unknown>,
    });
  }

  function renderTodoRow({ task, schedule }: TodoRow) {
    const theme = (data.themes || []).find((entry) => entry.id === task.project_id);
    const themeIndex = Math.max(
      0,
      (data.themes || []).findIndex((entry) => entry.id === task.project_id),
    );
    const chipColor = `var(--color-${themeColor(theme, themeIndex)})`;
    const done = task.state === "done" || task.state === "cancelled";
    const workState =
      task.work_state ||
      (task.intended_executor === "ai_agent" ? "ready_for_agent" : "not_delegated");
    const requiresHumanAcceptance =
      task.intended_executor === "ai_agent" && workState !== "accepted";
    const aiReady = task.intended_executor === "ai_agent" && workState === "ready_for_agent";
    const aiWorking = task.intended_executor === "ai_agent" && workState === "in_progress";
    const canToggleAiReady = !done && ["not_delegated", "ready_for_agent"].includes(workState);
    const due = scheduledDate(schedule);
    const completionDate = task.completed_at ? task.completed_at.slice(0, 10) : "";
    const urgency =
      !done && due ? (due < today ? "overdue" : due === today ? "due-today" : null) : null;
    const reminder = reminderTimeLabel(task.reminder_at, today);
    return (
      <div
        className={`table-row is-clickable-row${urgency ? ` is-${urgency}` : ""}`}
        key={task.id}
        style={{ "--chip-color": chipColor } as React.CSSProperties}
        onClick={() => openTaskDetail(task, schedule)}
      >
        <input
          className="todo-row-selector"
          type="checkbox"
          checked={selectedTaskIds.has(task.id)}
          onClick={(event) => event.stopPropagation()}
          onChange={() => toggleTaskSelection(task.id)}
          aria-label={`${task.title}を一括操作に選択`}
        />
        <span className="todo-theme-bar" />
        <button
          className={`todo-check-circle ${done ? "is-done" : ""}`}
          disabled={requiresHumanAcceptance}
          onClick={(event) => {
            event.stopPropagation();
            toggleTask(task);
          }}
          aria-label={done ? `${task.title}を未完了に戻す` : `${task.title}を完了`}
          title={done ? "未完了に戻す" : "完了にする"}
        >
          {done && (
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path
                d="M2 6l3 3 5-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
        <div className="row-title-wrap">
          <button
            className={`priority-flag-button ${aiReady ? "is-active" : ""}${aiWorking ? " is-working" : ""}`}
            disabled={!canToggleAiReady}
            onClick={(event) => {
              event.stopPropagation();
              void toggleAiReady(task);
            }}
            aria-label={aiWorking ? "AIが作業中" : aiReady ? "AI Readyを解除" : "AI Readyにする"}
            title={aiWorking ? "AIが作業中" : aiReady ? "AI Readyを解除" : "AI Readyにする"}
          >
            {aiWorking ? <IconLoader2 size={16} /> : <AI_ICON size={16} />}
          </button>
          <button
            className={`today-plan-button ${isTodayRow({ task, schedule }, today) ? "is-active" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              toggleToday(task, schedule);
            }}
            aria-label={
              isTodayRow({ task, schedule }, today) ? "今日の予定から外す" : "今日の予定に追加"
            }
            title={
              isTodayRow({ task, schedule }, today) ? "今日の予定から外す" : "今日の予定に追加"
            }
          >
            {isTodayRow({ task, schedule }, today) ? (
              <IconCalendarCheck size={16} />
            ) : (
              <IconCalendarPlus size={16} />
            )}
          </button>
          <button
            className="todo-copy-button"
            onClick={(event) => {
              event.stopPropagation();
              copyTask(task, schedule);
            }}
            aria-label={`${task.title}を複製`}
            title="複製"
          >
            <IconCopyPlus size={16} />
          </button>
          <div className="row-title-main">
            <button
              className={`row-title ${done ? "is-done" : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                openTaskDetail(task, schedule);
              }}
            >
              <span>{task.title}</span>
              <ChecklistProgressBadge items={task.checklist_items} />
            </button>
            <InlineTaskChecklist
              items={task.checklist_items}
              onToggle={(itemId) => toggleChecklistItem(task, itemId)}
              onAdd={() => openChecklistEditor(task, schedule)}
            />
          </div>
          {!done && (
            <button
              className="todo-focus-button"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                startFocusSession(task.id);
              }}
              aria-label={`${task.title}でFocusを開始`}
              title="Focusを開始"
            >
              <IconClock size={16} />
            </button>
          )}
          {reminder && (
            <span className="row-reminder-meta">
              <IconClock size={13} />
              {reminder}
            </span>
          )}
        </div>
        <span className="todo-repeat-label">{repeatRuleLabel(task.repeat_rule)}</span>
        <span className="theme-inline">
          <span className="chip-dot" />
          {theme?.name || "個人業務"}
        </span>
        <span className={`num${urgency ? ` is-${urgency}` : ""}`}>
          {formatDate(done ? completionDate : due)}
        </span>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader route="todo">
        <Button variant="secondary" onClick={copyRows}>
          一覧をコピー
        </Button>
        <Button variant="primary" onClick={() => setShowAdd((current) => !current)}>
          <IconPlus size={16} /> タスクを追加
        </Button>
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
          extraFields={
            <input
              type="date"
              value={addDate}
              onChange={(event) => setAddDate(event.target.value)}
            />
          }
        />
      )}
      <div className="todo-filter-tabs">
        {(
          [
            ["today", "今日", counters.today],
            ["open", "未完了", counters.open],
            ["overdue", "予定超過", counters.overdue],
            ["no-schedule", "予定なし", counters.noSchedule],
            ["done", "完了", counters.done],
          ] as const
        ).map(([id, label, count]) => (
          <button
            key={id}
            className={filter === id ? "is-active" : ""}
            onClick={() => selectFilterTab(id)}
          >
            {label}
            <span className="tab-count">{count}</span>
          </button>
        ))}
      </div>
      <section className="panel list-page">
        <div className="todo-table-toolbar">
          <ThemePickerSelect
            themes={themes}
            value={taskFilters.themeId}
            onChange={(themeId) => patchTaskFilters({ themeId })}
            allowAll
            allowNone
            allLabel="すべてのTheme"
            ariaLabel="Themeで絞り込み"
          />
          <select
            value={taskFilters.state}
            onChange={(event) => patchTaskFilters({ state: event.target.value })}
            aria-label="状態で絞り込み"
          >
            <option value="">すべての状態</option>
            {Object.entries(TASK_STATE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={taskFilters.schedule}
            onChange={(event) =>
              patchTaskFilters({ schedule: event.target.value as TaskViewFilters["schedule"] })
            }
            aria-label="予定で絞り込み"
          >
            <option value="">予定条件なし</option>
            <option value="scheduled">予定あり</option>
            <option value="no-schedule">予定なし</option>
            <option value="overdue">予定超過</option>
            <option value="this-week">今週中</option>
            <option value="today">今日</option>
          </select>
          <select
            value={taskFilters.rangeSemantics}
            onChange={(event) =>
              patchTaskFilters({
                rangeSemantics: event.target.value as TaskViewFilters["rangeSemantics"],
              })
            }
            aria-label="期間の意味で絞り込み"
          >
            <option value="">期間の意味: すべて</option>
            <option value="execution_window">期間内に一度</option>
            <option value="ongoing_period">期間中継続</option>
            <option value="unspecified_range">期間未分類</option>
          </select>
          <select
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as TodoSortMode)}
            aria-label="並び替え"
          >
            <option value="default">並び替え: {filter === "done" ? "完了日" : "予定終了日"}</option>
            <option value="theme">並び替え: Theme順</option>
            <option value="title">並び替え: 名前順</option>
          </select>
          <select
            value={sortDirection}
            onChange={(event) => setSortDirection(event.target.value as TodoSortDirection)}
            aria-label="並び順の向き"
          >
            <option value="desc">降順（新しい順）</option>
            <option value="asc">昇順（古い順）</option>
          </select>
          <select
            value={groupMode}
            onChange={(event) => setGroupMode(event.target.value as TodoGroupMode)}
            aria-label="グループ"
          >
            <option value="none">グループなし</option>
            <option value="schedule">予定でグループ</option>
            <option value="theme">Themeでグループ</option>
          </select>
        </div>
        {selectedVisibleRows.length > 0 && (
          <div className="todo-bulk-bar" aria-label="選択したタスクの一括操作">
            <strong>{selectedVisibleRows.length}件を選択</strong>
            <ThemePickerSelect
              themes={themes}
              value={bulkThemeId}
              onChange={setBulkThemeId}
              ariaLabel="一括変更先のTheme"
              className="todo-bulk-theme-picker"
            />
            <Button variant="secondary" compact onClick={() => void reassignSelectedTheme()}>
              Themeを変更
            </Button>
            <button
              type="button"
              className="text-button compact"
              onClick={() => setSelectedTaskIds(new Set())}
            >
              選択解除
            </button>
          </div>
        )}
        <div className="data-table todo-table">
          <div className="table-head">
            <span>
              <input
                className="todo-row-selector"
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleVisibleSelection}
                aria-label="表示中のタスクをすべて選択"
              />
            </span>
            <span />
            <span />
            <span>タスク</span>
            <span>繰り返し</span>
            <span>Theme</span>
            <span>{filter === "done" ? "完了日" : "予定終了"}</span>
          </div>
          {groupedVisible.map((group) => (
            <div key={group.id} className="todo-row-group">
              {groupMode !== "none" && (
                <div className="todo-group-heading">
                  <span>{group.title}</span>
                  <strong>{group.rows.length}件</strong>
                </div>
              )}
              {group.rows.map(renderTodoRow)}
            </div>
          ))}
        </div>
        {!visible.length && (
          <EmptyState
            title="該当するタスクはありません"
            action="タスクを追加"
            onAction={() => setShowAdd(true)}
          />
        )}
      </section>
    </div>
  );
}
