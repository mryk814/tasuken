import { useState } from "react";
import { IconCalendarPlus, IconCalendarCheck, IconFlag, IconFlagFilled, IconPlus } from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import { todayIso } from "../../../utils/dataFormat.js";
import type { PageProps } from "../types";
import { themeColor } from "../lib/domain";
import { addDays, formatDate } from "../lib/format";
import { parseTaskTable, type ParsedTaskRow } from "../lib/io";
import { EmptyState, PageHeader } from "../components/common";
import { TASK_STATE_LABELS } from "../domain-model/labels";
import { buildTodoView } from "../domain-model/selectors";
import { buildSaveTaskOperations, buildSaveScheduleOperations } from "../domain-model/persistence";
import type { Schedule, Task } from "../domain-model/types";

type TodoRow = {
  task: Task;
  schedule?: Schedule;
};

function scheduledDate(schedule?: Schedule): string {
  return String(schedule?.end_date || schedule?.start_date || "");
}

function isTodayRow(row: TodoRow, today: string): boolean {
  return row.schedule?.start_date === today || row.schedule?.end_date === today;
}

function isDoneRow(row: TodoRow): boolean {
  return row.task.state === "done" || row.task.state === "cancelled";
}

function compareTodoRows(today: string) {
  return (a: TodoRow, b: TodoRow): number => {
    const aToday = isTodayRow(a, today) ? 0 : 1;
    const bToday = isTodayRow(b, today) ? 0 : 1;
    if (aToday !== bToday) return aToday - bToday;
    return String(scheduledDate(a.schedule) || "9999-12-31").localeCompare(String(scheduledDate(b.schedule) || "9999-12-31"));
  };
}

export function TodoPage({ data, domain, themes, items, openDrawer, saveEntities, setToast }: PageProps) {
  const [filter, setFilter] = useState("open");
  const [selected, setSelected] = useState<string[]>([]);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pastePreview, setPastePreview] = useState<ParsedTaskRow[]>([]);
  const [shiftDays, setShiftDays] = useState(7);
  const [showAdd, setShowAdd] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addTheme, setAddTheme] = useState("");
  const [addDate, setAddDate] = useState("");
  const today = todayIso();
  const taskRows: TodoRow[] = buildTodoView(domain).tasks;
  const counters = {
    today: taskRows.filter((row) => !isDoneRow(row) && isTodayRow(row, today)).length,
    open: taskRows.filter((row) => !isDoneRow(row)).length,
    overdue: taskRows.filter((row) => !isDoneRow(row) && scheduledDate(row.schedule) && scheduledDate(row.schedule) < today).length,
    noSchedule: taskRows.filter((row) => !isDoneRow(row) && !scheduledDate(row.schedule)).length,
    done: taskRows.filter(isDoneRow).length,
  };
  const visible = taskRows.filter((row) => {
    if (filter === "today") return !isDoneRow(row) && isTodayRow(row, today);
    if (filter === "done") return isDoneRow(row);
    if (filter === "no-schedule") return !isDoneRow(row) && !scheduledDate(row.schedule);
    if (filter === "overdue") return !isDoneRow(row) && scheduledDate(row.schedule) && scheduledDate(row.schedule) < today;
    return !isDoneRow(row);
  }).sort(compareTodoRows(today));

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
    const nextTask: Task = {
      ...task,
      state: nextState,
      completed_at: nextState === "done" ? new Date().toISOString() : null,
    };
    await saveEntities(buildSaveTaskOperations(nextTask), nextState === "done" ? "完了しました。" : "未完了に戻しました。");
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

  async function bulkComplete() {
    const now = new Date().toISOString();
    const ops = selected.flatMap((id) => {
      const row = taskRows.find((r) => r.task.id === id);
      if (!row || isDoneRow(row)) return [];
      return buildSaveTaskOperations({ ...row.task, state: "done", completed_at: now });
    });
    if (!ops.length) return;
    await saveEntities(ops, `${selected.length}件を完了にしました。`);
    setSelected([]);
  }

  async function bulkThemeChange(projectId: string) {
    const ops = selected.flatMap((id) => {
      const row = taskRows.find((r) => r.task.id === id);
      if (!row) return [];
      return buildSaveTaskOperations({ ...row.task, project_id: projectId });
    });
    if (!ops.length) return;
    await saveEntities(ops, `${selected.length}件のThemeを変更しました。`);
    setSelected([]);
  }

  async function shiftSelected() {
    const ops = selected.flatMap((id) => {
      const row = taskRows.find((r) => r.task.id === id);
      if (!row?.schedule) return [];
      return buildSaveScheduleOperations({
        ...row.schedule,
        start_date: row.schedule.start_date ? addDays(row.schedule.start_date, shiftDays) || null : null,
        end_date: row.schedule.end_date ? addDays(row.schedule.end_date, shiftDays) || null : null,
      }, { reason: `一括操作で${shiftDays}日シフト` });
    });
    if (!ops.length) { setToast("日程のあるタスクが選択されていません。"); return; }
    await saveEntities(ops, `${selected.length}件の日程を${shiftDays}日移動しました。`);
    setSelected([]);
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
    const header = "タスク\t状態\tテーマ\t今日\t予定終了\t旗";
    const rows = visible.map(({ task, schedule }) => `${task.title}\t${TASK_STATE_LABELS[task.state]}\t${themes.find((theme) => theme.id === task.project_id)?.name || "個人業務"}\t${isTodayRow({ task, schedule }, today) ? "今日" : ""}\t${scheduledDate(schedule) || "予定なし"}\t${task.priority === "high" ? "あり" : "なし"}`);
    workspaceApi.copyText([header, ...rows].join("\n")).then(() => setToast("ToDo一覧をコピーしました。"));
  }

  function openTaskDetail(task: Task, schedule?: Schedule) {
    openDrawer({ type: "task", entity: { ...task, _schedule: schedule } as Record<string, unknown> });
  }

  return (
    <div className="page">
      <PageHeader title="ToDo" subtitle="今日の作業と予定なしの仕事を整理します。">
        <button className="secondary-button" onClick={copyRows}>一覧をコピー</button>
        <button className="secondary-button" onClick={() => setShowPaste((current) => !current)}>表から追加</button>
        <button className="primary-button" onClick={() => setShowAdd((current) => !current)}><IconPlus size={16} /> タスクを追加</button>
      </PageHeader>
      {showAdd && (
        <section className="panel">
          <div className="section-heading"><h2>タスクを追加</h2></div>
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
            <input type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} />
            <button className="primary-button compact" onClick={addTask}>追加</button>
          </div>
        </section>
      )}
      <div className="todo-filter-tabs">
        {([["today", "今日", counters.today], ["open", "未完了", counters.open], ["overdue", "予定超過", counters.overdue], ["no-schedule", "予定なし", counters.noSchedule], ["done", "完了", counters.done]] as const).map(([id, label, count]) => (
          <button key={id} className={filter === id ? "is-active" : ""} onClick={() => setFilter(id)}>{label}<span className="tab-count">{count}</span></button>
        ))}
      </div>
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
        {selected.length > 0 && (
          <div className="list-toolbar">
            <div className="inline-actions bulk-actions">
              <span>{selected.length}件選択</span>
              <button className="secondary-button compact" onClick={bulkComplete}>完了にする</button>
              <select aria-label="Themeを一括変更" onChange={(event) => event.target.value && bulkThemeChange(event.target.value)} defaultValue="">
                <option value="">Theme変更</option>
                {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
              </select>
              <input className="shift-days" aria-label="日程を移動する日数" type="number" value={shiftDays} onChange={(event) => setShiftDays(Number(event.target.value) || 0)} />
              <button className="secondary-button compact" onClick={shiftSelected}>日程を移動</button>
            </div>
          </div>
        )}
        <div className="data-table todo-table">
          <div className="table-head"><span /><span /><span>タスク</span><span>状態</span><span>Theme</span><span>予定終了</span></div>
          {visible.map(({ task, schedule }) => {
            const theme = (data.themes || []).find((entry) => entry.id === task.project_id);
            const themeIndex = Math.max(0, (data.themes || []).findIndex((entry) => entry.id === task.project_id));
            const chipColor = `var(--color-${themeColor(theme, themeIndex)})`;
            return (
            <div className="table-row" key={task.id} style={{ "--chip-color": chipColor } as React.CSSProperties}>
              <span className="todo-theme-bar" />
              <input type="checkbox" checked={selected.includes(task.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, task.id] : current.filter((id) => id !== task.id))} aria-label={`${task.title}を選択`} />
              <div className="row-title-wrap">
                <button
                  className={`priority-flag-button ${task.priority === "high" ? "is-active" : ""}`}
                  onClick={() => togglePriority(task)}
                  aria-label={task.priority === "high" ? "旗を外す" : "旗を付ける"}
                  title={task.priority === "high" ? "旗を外す" : "旗を付ける"}
                >
                  {task.priority === "high" ? <IconFlagFilled size={16} /> : <IconFlag size={16} />}
                </button>
                <button
                  className={`today-plan-button ${isTodayRow({ task, schedule }, today) ? "is-active" : ""}`}
                  onClick={() => toggleToday(task, schedule)}
                  aria-label={isTodayRow({ task, schedule }, today) ? "今日の予定から外す" : "今日の予定に追加"}
                  title={isTodayRow({ task, schedule }, today) ? "今日の予定から外す" : "今日の予定に追加"}
                >
                  {isTodayRow({ task, schedule }, today) ? <IconCalendarCheck size={16} /> : <IconCalendarPlus size={16} />}
                </button>
                <button className="row-title" onClick={() => openTaskDetail(task, schedule)}>{task.title}</button>
              </div>
              <button className="check-action" onClick={() => toggleTask(task)}>{task.state === "done" ? "戻す" : "完了"}</button>
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
