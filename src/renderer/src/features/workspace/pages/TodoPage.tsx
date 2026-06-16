import { useState } from "react";
import { IconFlag, IconFlagFilled } from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import { todayIso } from "../../../utils/dataFormat.js";
import type { PageProps, SaveOperation } from "../types";
import { STATUS_LABELS, defaultLevel, hasPlannedSchedule, themeColor } from "../lib/domain";
import { addDays, formatDate } from "../lib/format";
import { parseTaskTable, type ParsedTaskRow } from "../lib/io";
import { EmptyState, Metric, PageHeader } from "../components/common";

export function TodoPage({ data, themes, items, openDrawer, saveEntity, saveEntities, toggleItem, setToast }: PageProps) {
  const [filter, setFilter] = useState("open");
  const [selected, setSelected] = useState<string[]>([]);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pastePreview, setPastePreview] = useState<ParsedTaskRow[]>([]);
  const [shiftDays, setShiftDays] = useState(7);
  const today = todayIso();
  const tasks = items.filter((item) => item.status === "inbox" || ["task", "deliverable", "reminder"].includes(item.kind ?? "") || !item.theme_id);
  const counters = {
    today: tasks.filter((item) => item.status !== "done" && item.planned_end === today).length,
    overdue: tasks.filter((item) => item.status !== "done" && item.planned_end && item.planned_end < today).length,
    inbox: tasks.filter((item) => item.status === "inbox").length,
    noSchedule: tasks.filter((item) => item.status !== "done" && !hasPlannedSchedule(item)).length,
  };
  const visible = tasks.filter((item) => {
    if (filter === "done") return item.status === "done";
    if (filter === "inbox") return item.status === "inbox";
    if (filter === "no-schedule") return item.status !== "done" && !hasPlannedSchedule(item);
    if (filter === "overdue") return item.status !== "done" && item.planned_end && item.planned_end < today;
    return item.status !== "done" && item.status !== "inbox";
  }).sort((a, b) => String(a.planned_end || a.planned_start || "9999-12-31").localeCompare(String(b.planned_end || b.planned_start || "9999-12-31")));

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
    const header = "タスク\t状態\tテーマ\t予定終了\t旗";
    const rows = visible.map((item) => `${item.title}\t${STATUS_LABELS[item.status ?? ""]}\t${themes.find((theme) => theme.id === item.theme_id)?.name || "個人業務"}\t${item.planned_end || "予定なし"}\t${item.priority === "high" ? "あり" : "なし"}`);
    workspaceApi.copyText([header, ...rows].join("\n")).then(() => setToast("ToDo一覧をコピーしました。"));
  }

  return (
    <div className="page">
      <PageHeader title="ToDo" subtitle="今日の作業と予定なしの仕事を整理します。">
        <button className="secondary-button" onClick={copyRows}>一覧をコピー</button>
        <button className="secondary-button" onClick={() => setShowPaste((current) => !current)}>表から追加</button>
        <button className="primary-button" onClick={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "task" } })}>タスクを追加</button>
      </PageHeader>
      <div className="metric-grid todo-metrics">
        <Metric label="今日やる" value={counters.today} tone="primary" />
        <Metric label="予定超過" value={counters.overdue} tone="danger" />
        <Metric label="Inbox" value={counters.inbox} />
        <Metric label="予定なし" value={counters.noSchedule} />
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
        <div className="list-toolbar">
          <div className="segmented">
            {[["open", "未完了"], ["inbox", "Inbox"], ["overdue", "予定超過"], ["no-schedule", "予定なし"], ["done", "完了"]].map(([id, label]) => <button key={id} className={filter === id ? "is-active" : ""} onClick={() => setFilter(id)}>{label}</button>)}
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
          <div className="table-head"><span /><span /><span>タスク</span><span>状態</span><span>Theme</span><span>予定終了</span></div>
          {visible.map((item) => {
            const theme = (data.themes || []).find((entry) => entry.id === item.theme_id);
            const themeIndex = Math.max(0, (data.themes || []).findIndex((entry) => entry.id === item.theme_id));
            const chipColor = `var(--color-${themeColor(theme, themeIndex)})`;
            return (
            <div className="table-row" key={item.id} style={{ "--chip-color": chipColor } as React.CSSProperties}>
              <span className="todo-theme-bar" />
              <input type="checkbox" checked={selected.includes(item.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} aria-label={`${item.title}を選択`} />
              <div className="row-title-wrap">
                <button
                  className={`priority-flag-button ${item.priority === "high" ? "is-active" : ""}`}
                  onClick={() => saveEntity("item", { ...item, priority: item.priority === "high" ? "normal" : "high" })}
                  aria-label={item.priority === "high" ? "旗を外す" : "旗を付ける"}
                  title={item.priority === "high" ? "旗を外す" : "旗を付ける"}
                >
                  {item.priority === "high" ? <IconFlagFilled size={16} /> : <IconFlag size={16} />}
                </button>
                <button className="row-title" onClick={() => openDrawer({ type: "item", entity: item })}>{item.title}</button>
              </div>
              {item.status === "inbox"
                ? <button className="check-action" onClick={() => saveEntity("item", { ...item, status: "todo", kind: item.kind === "idea" ? "task" : item.kind })}>整理</button>
                : <button className="check-action" onClick={() => toggleItem(item)}>{item.status === "done" ? "戻す" : "完了"}</button>}
              <span className="theme-inline">
                <span className="chip-dot" />
                {theme?.name || "個人業務"}
              </span>
              <span className="num">{formatDate(item.planned_end)}</span>
            </div>
            );
          })}
        </div>
        {!visible.length && <EmptyState title="該当するタスクはありません" action="タスクを追加" onAction={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "task" } })} />}
      </section>
    </div>
  );
}
