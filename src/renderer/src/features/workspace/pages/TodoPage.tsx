import { useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import { todayIso } from "../../../utils/dataFormat.js";
import type { PageProps, SaveOperation } from "../types";
import { STATUS_LABELS, defaultLevel } from "../lib/domain";
import { addDays, formatDate } from "../lib/format";
import { parseTaskTable, type ParsedTaskRow } from "../lib/io";
import { EmptyState, Metric, PageHeader } from "../components/common";

export function TodoPage({ themes, items, openDrawer, saveEntity, saveEntities, toggleItem, setToast }: PageProps) {
  const [filter, setFilter] = useState("open");
  const [selected, setSelected] = useState<string[]>([]);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pastePreview, setPastePreview] = useState<ParsedTaskRow[]>([]);
  const [shiftDays, setShiftDays] = useState(7);
  const today = todayIso();
  const tasks = items.filter((item) => item.status === "inbox" || ["task", "deliverable", "reminder"].includes(item.kind ?? "") || item.is_personal_task);
  const counters = {
    today: tasks.filter((item) => item.status !== "done" && item.due_date === today).length,
    overdue: tasks.filter((item) => item.status !== "done" && item.due_date && item.due_date < today).length,
    inbox: tasks.filter((item) => item.status === "inbox").length,
    unscheduled: tasks.filter((item) => item.status !== "done" && item.schedule_status === "unscheduled").length,
  };
  const visible = tasks.filter((item) => {
    if (filter === "done") return item.status === "done";
    if (filter === "inbox") return item.status === "inbox";
    if (filter === "unscheduled") return item.status !== "done" && item.schedule_status === "unscheduled";
    if (filter === "overdue") return item.status !== "done" && item.due_date && item.due_date < today;
    return item.status !== "done" && item.status !== "inbox";
  }).sort((a, b) => String(a.due_date || a.planned_end || "9999-12-31").localeCompare(String(b.due_date || b.planned_end || "9999-12-31")));

  // 一括操作は1transactionで完結させ、途中失敗時に一部だけ更新された状態を残さない。
  async function bulkUpdate(field: string, value: string) {
    const operations: SaveOperation[] = selected.flatMap((id) => {
      const item = items.find((entry) => entry.id === id);
      return item ? [{ action: "save", type: "item", entity: { ...item, [field]: value } }] : [];
    });
    if (!operations.length) return;
    const count = operations.length;
    await saveEntities(operations, `${count}件を更新しました。`);
    setSelected([]);
  }

  async function shiftSelected() {
    const operations: SaveOperation[] = selected.flatMap((id) => {
      const item = items.find((entry) => entry.id === id);
      return item
        ? [{
          action: "save",
          type: "item",
          entity: {
            ...item,
            planned_start: addDays(item.planned_start, shiftDays),
            planned_end: addDays(item.planned_end, shiftDays),
            due_date: addDays(item.due_date, shiftDays),
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
        priority: row.priority || "normal",
        planned_start: row.planned_start ?? null,
        planned_end: row.planned_end ?? null,
        due_date: row.due_date,
        schedule_status: row.planned_start || row.planned_end || row.due_date ? "scheduled" : "unscheduled",
        schedule_confidence: "tentative",
        date_granularity: "day",
        is_personal_task: !row.theme_id,
        sort_order: items.length + index,
        progress: 0,
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
    const header = "タスク\t状態\tテーマ\t期限";
    const rows = visible.map((item) => `${item.title}\t${STATUS_LABELS[item.status ?? ""]}\t${themes.find((theme) => theme.id === item.theme_id)?.name || "個人業務"}\t${item.due_date || "日程未確定"}`);
    workspaceApi.copyText([header, ...rows].join("\n")).then(() => setToast("ToDo一覧をコピーしました。"));
  }

  return (
    <div className="page">
      <PageHeader title="ToDo" subtitle="今日の作業と日程未確定の仕事を整理します。">
        <button className="secondary-button" onClick={copyRows}>一覧をコピー</button>
        <button className="secondary-button" onClick={() => setShowPaste((current) => !current)}>表から追加</button>
        <button className="primary-button" onClick={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "task" } })}>タスクを追加</button>
      </PageHeader>
      <div className="metric-grid todo-metrics">
        <Metric label="今日やる" value={counters.today} tone="primary" />
        <Metric label="期限超過" value={counters.overdue} tone="danger" />
        <Metric label="Inbox" value={counters.inbox} />
        <Metric label="日程未確定" value={counters.unscheduled} />
      </div>
      {showPaste && (
        <section className="panel paste-panel">
          <div className="section-heading"><h2>表から追加</h2><span>タイトル / Theme / 期限 / 状態 / 説明</span></div>
          <textarea value={pasteText} onChange={(event) => { setPasteText(event.target.value); setPastePreview([]); }} placeholder={"タイトル\tTheme\t期限\t状態\t説明\n測定条件を確認\t材料A評価\t2026-06-20\t未着手\t条件表と照合"} />
          {pastePreview.length > 0 && (
            <div className="paste-preview">
              {pastePreview.map((row, index) => (
                <div key={`${row.title}-${index}`}>
                  <strong>{row.title}</strong>
                  <span>{themes.find((theme) => theme.id === row.theme_id)?.name || "個人業務"}</span>
                  <time>{row.due_date || "日程未確定"}</time>
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
        <div className="list-toolbar">
          <div className="segmented">
            {[["open", "未完了"], ["inbox", "Inbox"], ["overdue", "期限超過"], ["unscheduled", "日程未確定"], ["done", "完了"]].map(([id, label]) => <button key={id} className={filter === id ? "is-active" : ""} onClick={() => setFilter(id)}>{label}</button>)}
          </div>
          {selected.length > 0 && (
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
          )}
        </div>
        <div className="data-table todo-table">
          <div className="table-head"><span /><span>タスク</span><span>状態</span><span>Theme</span><span>期限</span></div>
          {visible.map((item) => (
            <div className="table-row" key={item.id}>
              <input type="checkbox" checked={selected.includes(item.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} aria-label={`${item.title}を選択`} />
              <button className="row-title" onClick={() => openDrawer({ type: "item", entity: item })}>{item.title}</button>
              {item.status === "inbox"
                ? <button className="check-action" onClick={() => saveEntity("item", { ...item, status: "todo", kind: item.kind === "idea" ? "task" : item.kind })}>整理</button>
                : <button className="check-action" onClick={() => toggleItem(item)}>{item.status === "done" ? "戻す" : "完了"}</button>}
              <span>{themes.find((theme) => theme.id === item.theme_id)?.name || "個人業務"}</span>
              <span className="num">{item.date_text || formatDate(item.due_date)}</span>
            </div>
          ))}
        </div>
        {!visible.length && <EmptyState title="該当するタスクはありません" action="タスクを追加" onAction={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "task" } })} />}
      </section>
    </div>
  );
}
