import { useEffect, useState } from "react";
import { IconCalendarPlus, IconCalendarCheck, IconClock, IconCopyPlus, IconFlag, IconFlagFilled, IconPlus } from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import { todayIso } from "../../../utils/dataFormat.js";
import { playCompleteSound } from "../../../utils/sounds";
import type { PageProps, SaveOperation } from "../types";
import { themeColor } from "../lib/domain";
import { addDays, formatDate } from "../lib/format";
import { parseTaskTable, type ParsedTaskRow } from "../lib/io";
import { compareTodoRows, isTodayRow, scheduledDate } from "../lib/todoRows.js";
import {
  DEFAULT_TASK_VIEW_FILTERS,
  countTodoRowsForView,
  filterTodoRows,
  isTaskSavedView,
  normalizeSavedTaskView,
  normalizeTaskViewFilters,
  type SavedTaskView,
  type TaskViewFilters,
  type TaskViewTab,
} from "../lib/savedTaskViews";
import { EmptyState, PageHeader } from "../components/common";
import { InlineAddPanel } from "../components/InlineAddPanel";
import { ChecklistProgressBadge } from "../components/taskChecklist";
import { TASK_STATE_LABELS } from "../domain-model/labels";
import { buildTodoView } from "../domain-model/selectors";
import { buildSaveTaskOperations, buildSaveScheduleOperations } from "../domain-model/persistence";
import { duplicateTask } from "../domain-model/taskDuplication";
import { buildCompleteTaskOperations, repeatRuleLabel } from "../domain-model/taskRecurrence";
import type { Schedule, Task } from "../domain-model/types";

type TodoRow = {
  task: Task;
  schedule?: Schedule;
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

export function TodoPage({ data, domain, themes, route, openDrawer, saveEntities, removeEntity, setToast }: PageProps) {
  const [filter, setFilter] = useState("open");
  const [taskFilters, setTaskFilters] = useState<TaskViewFilters>(DEFAULT_TASK_VIEW_FILTERS);
  const [savedViewName, setSavedViewName] = useState("");
  const [activeSavedViewId, setActiveSavedViewId] = useState("");
  const [renameTitle, setRenameTitle] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pastePreview, setPastePreview] = useState<ParsedTaskRow[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addTheme, setAddTheme] = useState("");
  const [addDate, setAddDate] = useState("");
  const today = todayIso();

  useEffect(() => {
    if (route === "todo") {
      setFilter("open");
      setTaskFilters(DEFAULT_TASK_VIEW_FILTERS);
      setActiveSavedViewId("");
      setRenameTitle("");
    }
  }, [route]);

  const taskRows: TodoRow[] = buildTodoView(domain).tasks;
  const savedTaskViews = (data.views || [])
    .filter((view) => isTaskSavedView(view as Record<string, unknown>))
    .map((view) => normalizeSavedTaskView(view as Record<string, unknown>))
    .filter((view) => view.id);
  const activeSavedView = savedTaskViews.find((view) => view.id === activeSavedViewId) || null;
  const currentFilters: TaskViewFilters = normalizeTaskViewFilters({ ...taskFilters, tab: filter });
  const counters = {
    today: taskRows.filter((row) => !isDoneRow(row) && isTodayRow(row, today)).length,
    open: taskRows.filter((row) => !isDoneRow(row)).length,
    overdue: taskRows.filter((row) => !isDoneRow(row) && scheduledDate(row.schedule) && scheduledDate(row.schedule) < today).length,
    noSchedule: taskRows.filter((row) => !isDoneRow(row) && !scheduledDate(row.schedule)).length,
    done: taskRows.filter(isDoneRow).length,
  };
  const visible = filterTodoRows(taskRows, currentFilters, today).sort(compareTodoRows(today));

  function patchTaskFilters(patch: Partial<TaskViewFilters>) {
    setTaskFilters((current) => normalizeTaskViewFilters({ ...current, ...patch }));
    setActiveSavedViewId("");
    setRenameTitle("");
  }

  function selectFilterTab(nextFilter: TaskViewTab) {
    setFilter(nextFilter);
    setActiveSavedViewId("");
    setRenameTitle("");
  }

  async function saveCurrentView() {
    const title = savedViewName.trim();
    if (!title) { setToast("保存済みビュー名を入力してください。", "warning"); return; }
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const view = {
      id,
      title,
      view_type: "task",
      filters: currentFilters,
      sort_order: savedTaskViews.length,
      created_at: now,
    };
    await saveEntities([{ action: "save", type: "view", entity: view as SaveOperation["entity"] }], "保存済みビューを追加しました。");
    setSavedViewName("");
    setActiveSavedViewId(id);
    setRenameTitle(title);
  }

  function openSavedView(view: SavedTaskView) {
    setFilter(view.filters.tab);
    setTaskFilters(view.filters);
    setActiveSavedViewId(view.id);
    setRenameTitle(view.title);
  }

  async function renameSavedView(view: SavedTaskView) {
    const title = renameTitle.trim();
    if (!title) { setToast("保存済みビュー名を入力してください。", "warning"); return; }
    const source = (data.views || []).find((entry) => entry.id === view.id) || view;
    await saveEntities([{
      action: "save",
      type: "view",
      entity: { ...source, title, view_type: "task", filters: view.filters } as SaveOperation["entity"],
    }], "保存済みビュー名を更新しました。");
  }

  async function deleteSavedView(view: SavedTaskView) {
    await removeEntity("view", { ...view });
    setActiveSavedViewId("");
    setRenameTitle("");
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

  function previewPaste() {
    const rows = parseTaskTable(pasteText, themes);
    if (!rows.length) {
      setToast("貼り付け内容を読み取れませんでした。1行に1件、またはTSV/CSVの表を貼り付けてください。");
      return;
    }
    setPastePreview(rows);
  }

  async function importPaste() {
    const now = new Date().toISOString();
    const ops = pastePreview.flatMap((row) => {
      const taskId = crypto.randomUUID();
      const task: Task = {
        id: taskId,
        title: row.title,
        project_id: row.theme_id || null,
        state: "todo",
        priority: row.priority === "high" ? "high" : "normal",
        description: row.description || null,
        created_at: now,
      };
      const result = buildSaveTaskOperations(task, { source: "import" });
      if (row.planned_end || row.planned_start) {
        const hasRange = row.planned_start && row.planned_end && row.planned_start !== row.planned_end;
        const schedule: Schedule = {
          id: crypto.randomUUID(),
          owner_type: "task",
          owner_id: taskId,
          start_date: row.planned_start || null,
          end_date: row.planned_end || null,
          date_kind: hasRange ? "range" : "deadline",
          confidence: "fixed",
          granularity: "day",
        };
        result.push(...buildSaveScheduleOperations(schedule, { source: "import" }));
      }
      return result;
    });
    if (!ops.length) return;
    await saveEntities(ops, `${pastePreview.length}件を追加しました。`);
    setPasteText("");
    setPastePreview([]);
    setShowPaste(false);
  }

  function copyRows() {
    const header = "タスク\t状態\tテーマ\t今日\t予定終了\tリマインダー\t旗\t繰り返し";
    const rows = visible.map(({ task, schedule }) => `${task.title}\t${TASK_STATE_LABELS[task.state]}\t${themes.find((theme) => theme.id === task.project_id)?.name || "個人業務"}\t${isTodayRow({ task, schedule }, today) ? "今日" : ""}\t${scheduledDate(schedule) || "予定なし"}\t${reminderTimeLabel(task.reminder_at, today)}\t${task.priority === "high" ? "あり" : "なし"}\t${repeatRuleLabel(task.repeat_rule)}`);
    workspaceApi.copyText([header, ...rows].join("\n")).then(() => setToast("ToDo一覧をコピーしました。"));
  }

  function openTaskDetail(task: Task, schedule?: Schedule) {
    openDrawer({ type: "task", mode: "edit", entity: { ...task, _schedule: schedule } as Record<string, unknown> });
  }

  return (
    <div className="page">
      <PageHeader title="ToDo" subtitle="今日の作業と予定なしの仕事を整理します。">
        <button className="secondary-button" onClick={copyRows}>一覧をコピー</button>
        <button className="secondary-button" onClick={() => setShowPaste((current) => !current)}>表から追加</button>
        <button className="primary-button" onClick={() => setShowAdd((current) => !current)}><IconPlus size={16} /> タスクを追加</button>
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
      <section className="panel saved-view-panel">
        <div className="section-heading"><h2>保存済みビュー</h2><span>{savedTaskViews.length}件</span></div>
        <div className="filter-bar">
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
          <select value={taskFilters.priority} onChange={(event) => patchTaskFilters({ priority: event.target.value as TaskViewFilters["priority"] })} aria-label="旗で絞り込み">
            <option value="">旗条件なし</option>
            <option value="high">旗あり</option>
            <option value="normal">旗なし</option>
          </select>
        </div>
        <div className="saved-view-actions">
          <input value={savedViewName} onChange={(event) => setSavedViewName(event.target.value)} placeholder="ビュー名" />
          <button className="secondary-button compact" onClick={saveCurrentView}>現在の条件を保存</button>
        </div>
        {savedTaskViews.length > 0 && (
          <div className="saved-view-list">
            {savedTaskViews.map((view) => (
              <button key={view.id} className={activeSavedViewId === view.id ? "is-active" : ""} onClick={() => openSavedView(view)}>
                <span>{view.title}</span>
                <span className="tab-count">{countTodoRowsForView(view, taskRows, today)}</span>
              </button>
            ))}
          </div>
        )}
        {activeSavedView && (
          <div className="saved-view-actions">
            <input value={renameTitle} onChange={(event) => setRenameTitle(event.target.value)} aria-label="保存済みビュー名" />
            <button className="secondary-button compact" onClick={() => renameSavedView(activeSavedView)}>名前を更新</button>
            <button className="danger-button compact" onClick={() => deleteSavedView(activeSavedView)}>削除</button>
          </div>
        )}
      </section>
      {showPaste && (
        <section className="panel paste-panel">
          <div className="section-heading"><h2>表から追加</h2><span>タイトル / Theme / 予定終了 / 状態 / 説明</span></div>
          <textarea value={pasteText} onChange={(event) => { setPasteText(event.target.value); setPastePreview([]); }} placeholder={"タイトル\tTheme\t予定終了\t状態\t説明\n測定条件を確認\t材料A評価\t2026-06-20\t未着手\t条件表と照合"} />
          {pastePreview.length > 0 && (
            <div className="paste-preview">
              {pastePreview.map((row, index) => (
                <div key={`${row.title}-${index}`}>
                  <strong>{row.title}</strong>
                  <span>{themes.find((theme) => theme.id === row.theme_id)?.name || "個人業務"}</span>
                  <time>{row.planned_end || "予定なし"}</time>
                </div>
              ))}
            </div>
          )}
          <div className="form-actions">
            <button className="secondary-button" onClick={() => { setShowPaste(false); setPastePreview([]); }}>閉じる</button>
            {pastePreview.length ? <button className="primary-button" onClick={importPaste}>追加する</button> : <button className="primary-button" onClick={previewPaste}>内容を確認</button>}
          </div>
        </section>
      )}
      <section className="panel list-page">
        <div className="data-table todo-table">
          <div className="table-head"><span /><span /><span>タスク</span><span>繰り返し</span><span>Theme</span><span>予定終了</span></div>
          {visible.map(({ task, schedule }) => {
            const theme = (data.themes || []).find((entry) => entry.id === task.project_id);
            const themeIndex = Math.max(0, (data.themes || []).findIndex((entry) => entry.id === task.project_id));
            const chipColor = `var(--color-${themeColor(theme, themeIndex)})`;
            const done = task.state === "done" || task.state === "cancelled";
            const reminder = reminderTimeLabel(task.reminder_at, today);
            return (
            <div
              className="table-row is-clickable-row"
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
                {reminder && <span className="row-reminder-meta"><IconClock size={13} />{reminder}</span>}
              </div>
              <span className="todo-repeat-label">{repeatRuleLabel(task.repeat_rule)}</span>
              <span className="theme-inline">
                <span className="chip-dot" />
                {theme?.name || "個人業務"}
              </span>
              <span className="num">{formatDate(scheduledDate(schedule))}</span>
            </div>
            );
          })}
        </div>
        {!visible.length && <EmptyState title="該当するタスクはありません" action="タスクを追加" onAction={() => setShowAdd(true)} />}
      </section>
    </div>
  );
}
