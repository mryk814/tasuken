import { useState } from "react";
import { IconCalendarPlus, IconCalendarCheck, IconFlag, IconFlagFilled } from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import { todayIso } from "../../../utils/dataFormat.js";
import type { Item, PageProps, SaveOperation } from "../types";
import { defaultLevel, themeColor } from "../lib/domain";
import { addDays, formatDate } from "../lib/format";
import { parseTaskTable, type ParsedTaskRow } from "../lib/io";
import { EmptyState, PageHeader } from "../components/common";
import { legacyWorkspaceToV2 } from "../../workspace-v2/domain/legacyAdapter";
import { TASK_STATE_LABELS } from "../../workspace-v2/domain/labels";
import { buildTodoView } from "../../workspace-v2/domain/selectors";
import type { Schedule, Task } from "../../workspace-v2/domain/types";

type TodoRow = {
  task: Task;
  schedule?: Schedule;
  legacyItem?: Item;
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

export function TodoPage({ data, themes, items, openDrawer, saveEntity, saveEntities, toggleItem, setToast }: PageProps) {
  const [filter, setFilter] = useState("open");
  const [selected, setSelected] = useState<string[]>([]);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pastePreview, setPastePreview] = useState<ParsedTaskRow[]>([]);
  const [shiftDays, setShiftDays] = useState(7);
  const today = todayIso();
  const legacyItemsById = new Map(items.map((item) => [item.id, item]));
  const taskRows: TodoRow[] = buildTodoView(legacyWorkspaceToV2(data)).tasks.map((row) => ({
    ...row,
    legacyItem: row.task.legacy_item_id ? legacyItemsById.get(row.task.legacy_item_id) : undefined,
  }));
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

  // 一括操作は1transactionで完結させ、途中失敗時に一部だけ更新された状態を残さない。
  async function bulkUpdate(field: string, value: string) {
    const operations: SaveOperation[] = selected.flatMap((id) => {
      const row = taskRows.find((entry) => entry.task.id === id);
      return row?.legacyItem ? [{ action: "save", type: "item", entity: { ...row.legacyItem, [field]: value } }] : [];
    });
    if (!operations.length) return;
    const count = operations.length;
    await saveEntities(operations, `${count}件を更新しました。`);
    setSelected([]);
  }

  async function shiftSelected() {
    const operations: SaveOperation[] = selected.flatMap((id) => {
      const row = taskRows.find((entry) => entry.task.id === id);
      return row?.legacyItem
        ? [{
          action: "save",
          type: "item",
          entity: {
            ...row.legacyItem,
            planned_start: addDays(row.legacyItem.planned_start, shiftDays),
            planned_end: addDays(row.legacyItem.planned_end, shiftDays),
            due_date: null,
          },
          options: { reason: `一括操作で${shiftDays}日シフト` },
        }]
        : [];
    });
    if (!operations.length) return;
    const count = operations.length;
    await saveEntities(operations, `${count}件の日程を${shiftDays}日移動しました。`);
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
    const operations: SaveOperation[] = pastePreview.map((row, index) => ({
      action: "save",
      type: "item",
      entity: {
        id: crypto.randomUUID(),
        title: row.title,
        kind: row.kind || "task",
        level: defaultLevel(row.kind || "task"),
        theme_id: row.theme_id,
        status: row.status || "todo",
        priority: row.priority === "high" ? "high" : "normal",
        planned_start: row.planned_start ?? null,
        planned_end: row.planned_end ?? null,
        due_date: null,
        schedule_confidence: "fixed",
        date_granularity: "day",
        is_personal_task: !row.theme_id,
        sort_order: items.length + index,
        description: row.description || "",
      },
      options: { source: "pasted_table" },
    }));
    if (!operations.length) return;
    const count = operations.length;
    await saveEntities(operations, `${count}件を追加しました。`);
    setPasteText("");
    setPastePreview([]);
    setShowPaste(false);
  }

  function copyRows() {
    const header = "タスク\t状態\tテーマ\t今日\t予定終了\t旗";
    const rows = visible.map(({ task, schedule }) => `${task.title}\t${TASK_STATE_LABELS[task.state]}\t${themes.find((theme) => theme.id === task.project_id)?.name || "個人業務"}\t${isTodayRow({ task, schedule }, today) ? "今日" : ""}\t${scheduledDate(schedule) || "予定なし"}\t${task.priority === "high" ? "あり" : "なし"}`);
    workspaceApi.copyText([header, ...rows].join("\n")).then(() => setToast("ToDo一覧をコピーしました。"));
  }

  return (
    <div className="page">
      <PageHeader title="ToDo" subtitle="今日の作業と予定なしの仕事を整理します。">
        <button className="secondary-button" onClick={copyRows}>一覧をコピー</button>
        <button className="secondary-button" onClick={() => setShowPaste((current) => !current)}>表から追加</button>
        <button className="primary-button" onClick={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "task" } })}>タスクを追加</button>
      </PageHeader>
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
              <button className="secondary-button compact" onClick={() => bulkUpdate("status", "done")}>完了にする</button>
              <select aria-label="Themeを一括変更" onChange={(event) => event.target.value && bulkUpdate("theme_id", event.target.value)} defaultValue="">
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
          {visible.map(({ task, schedule, legacyItem }) => {
            const theme = (data.themes || []).find((entry) => entry.id === task.project_id);
            const themeIndex = Math.max(0, (data.themes || []).findIndex((entry) => entry.id === task.project_id));
            const chipColor = `var(--color-${themeColor(theme, themeIndex)})`;
            return (
            <div className="table-row" key={task.id} style={{ "--chip-color": chipColor } as React.CSSProperties}>
              <span className="todo-theme-bar" />
              <input type="checkbox" checked={selected.includes(task.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, task.id] : current.filter((id) => id !== task.id))} aria-label={`${task.title}を選択`} disabled={!legacyItem} />
              <div className="row-title-wrap">
                <button
                  className={`priority-flag-button ${task.priority === "high" ? "is-active" : ""}`}
                  onClick={() => legacyItem && saveEntity("item", { ...legacyItem, priority: task.priority === "high" ? "normal" : "high" })}
                  aria-label={task.priority === "high" ? "旗を外す" : "旗を付ける"}
                  title={task.priority === "high" ? "旗を外す" : "旗を付ける"}
                  disabled={!legacyItem}
                >
                  {task.priority === "high" ? <IconFlagFilled size={16} /> : <IconFlag size={16} />}
                </button>
                <button
                  className={`today-plan-button ${isTodayRow({ task, schedule }, today) ? "is-active" : ""}`}
                  onClick={() => legacyItem && saveEntity("item", { ...legacyItem, today_flag: !legacyItem.today_flag })}
                  aria-label={isTodayRow({ task, schedule }, today) ? "今日の予定から外す" : "今日の予定に追加"}
                  title={isTodayRow({ task, schedule }, today) ? "今日の予定から外す" : "今日の予定に追加"}
                  disabled={!legacyItem}
                >
                  {isTodayRow({ task, schedule }, today) ? <IconCalendarCheck size={16} /> : <IconCalendarPlus size={16} />}
                </button>
                <button className="row-title" onClick={() => legacyItem && openDrawer({ type: "item", entity: legacyItem })}>{task.title}</button>
              </div>
              <button className="check-action" onClick={() => legacyItem && toggleItem(legacyItem)} disabled={!legacyItem}>{task.state === "done" ? "戻す" : "完了"}</button>
              <span className="theme-inline">
                <span className="chip-dot" />
                {theme?.name || "個人業務"}
              </span>
              <span className="num">{formatDate(scheduledDate(schedule))}</span>
            </div>
            );
          })}
        </div>
        {!visible.length && <EmptyState title="該当するタスクはありません" action="タスクを追加" onAction={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "task" } })} />}
      </section>
    </div>
  );
}
