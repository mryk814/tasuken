import { IconCalendarPlus, IconClipboard, IconFlagFilled } from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import { todayIso } from "../../../utils/dataFormat.js";
import type { Item, PageProps } from "../types";
import { KIND_LABELS, STATUS_LABELS, hasPlannedSchedule } from "../lib/domain";
import { addDays, compareDate, formatDate } from "../lib/format";
import { EmptyState, Metric, PageHeader, StatusBadge } from "../components/common";

function itemDate(item: Item): string {
  return String(item.planned_end || item.planned_start || item.due_date || "");
}

function isOpen(item: Item): boolean {
  return item.status !== "done" && item.status !== "cancelled" && item.status !== "archived";
}

function isTodayTask(item: Item, today: string): boolean {
  return item.today_flag === true || item.planned_start === today || item.planned_end === today;
}

function TaskRows({
  items,
  themes,
  empty,
  openDrawer,
  toggleItem,
  saveEntity,
}: Pick<PageProps, "themes" | "openDrawer" | "toggleItem" | "saveEntity"> & {
  items: Item[];
  empty: string;
}) {
  if (!items.length) return <EmptyState title={empty} action="タスクを追加" onAction={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "task" } })} />;
  return (
    <div className="today-task-list">
      {items.map((item) => {
        const theme = themes.find((entry) => entry.id === item.theme_id);
        return (
          <div className="today-task-row" key={item.id}>
            <button className="check-button" aria-label={`${item.title}を完了`} onClick={() => toggleItem(item)} />
            <button className="today-task-title" onClick={() => openDrawer({ type: "item", entity: item })}>
              <strong>{item.title}</strong>
              <span>{theme?.name || "個人業務"} / {KIND_LABELS[item.kind ?? "task"] || "タスク"}</span>
            </button>
            {item.priority === "high" && <IconFlagFilled className="inline-icon accent" size={16} aria-label="優先" />}
            <StatusBadge value={item.status} label={STATUS_LABELS[item.status ?? ""] || item.status} />
            <time>{formatDate(itemDate(item))}</time>
            <button
              className={`today-plan-button ${item.today_flag ? "is-active" : ""}`}
              onClick={() => saveEntity("item", { ...item, today_flag: !item.today_flag })}
              aria-label={item.today_flag ? "今日の予定から外す" : "今日の予定に追加"}
              title={item.today_flag ? "今日の予定から外す" : "今日の予定に追加"}
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
  const openItems = items.filter(isOpen);
  const todayTasks = openItems
    .filter((item) => item.status !== "inbox" && isTodayTask(item, today))
    .sort(compareDate);
  const overdue = openItems
    .filter((item) => item.status !== "inbox" && itemDate(item) && itemDate(item) < today)
    .sort(compareDate);
  const inbox = items.filter((item) => item.status === "inbox" || item.kind === "idea");
  const noSchedule = openItems
    .filter((item) => item.status !== "inbox" && item.kind !== "milestone" && !hasPlannedSchedule(item))
    .sort((a, b) => Number(b.priority === "high") - Number(a.priority === "high") || a.title.localeCompare(b.title, "ja"));
  const milestones = openItems
    .filter((item) => item.kind === "milestone" && itemDate(item) && itemDate(item) >= today && itemDate(item) <= soon)
    .sort(compareDate);
  const waitingSoon = openItems
    .filter((item) => (item.kind === "waiting" || item.status === "waiting") && itemDate(item) && itemDate(item) <= soon)
    .sort(compareDate);
  const latestUpdates = [...(data.status_updates || [])]
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 5);

  const todayMarkdown = [
    "# Today",
    "",
    "## 今日やること",
    ...(todayTasks.length ? todayTasks.map((item) => `- [ ] ${item.title} (${themes.find((theme) => theme.id === item.theme_id)?.name || "個人業務"})`) : ["- なし"]),
    "",
    "## 期限切れ",
    ...(overdue.length ? overdue.map((item) => `- ${itemDate(item) || "予定なし"} ${item.title}`) : ["- なし"]),
    "",
    "## Waiting",
    ...(waitingSoon.length ? waitingSoon.map((item) => `- ${itemDate(item) || "予定なし"} ${item.title}${item.waiting_for ? ` / ${item.waiting_for}` : ""}`) : ["- なし"]),
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
        <Metric label="今日" value={todayTasks.length} tone="primary" />
        <Metric label="期限切れ" value={overdue.length} tone={overdue.length ? "danger" : ""} />
        <Metric label="Inbox" value={inbox.length} />
        <Metric label="予定なし" value={noSchedule.length} />
      </div>

      <section className="panel today-focus-panel">
        <div className="section-heading">
          <h2>今日やること</h2>
          <button className="text-button compact" onClick={() => navigate("todo")}>ToDoへ</button>
        </div>
        <TaskRows items={todayTasks} themes={themes} empty="今日のタスクはありません" openDrawer={openDrawer} toggleItem={toggleItem} saveEntity={saveEntity} />
      </section>

      <div className="today-grid">
        <section className="panel">
          <div className="section-heading"><h2>期限切れ</h2><span>{overdue.length}件</span></div>
          <TaskRows items={overdue.slice(0, 8)} themes={themes} empty="期限切れはありません" openDrawer={openDrawer} toggleItem={toggleItem} saveEntity={saveEntity} />
        </section>
        <section className="panel">
          <div className="section-heading"><h2>Inbox未整理</h2><button className="text-button compact" onClick={() => navigate("inbox")}>整理へ</button></div>
          <TaskRows items={inbox.slice(0, 8)} themes={themes} empty="未整理の記録はありません" openDrawer={openDrawer} toggleItem={toggleItem} saveEntity={saveEntity} />
        </section>
      </div>

      <div className="today-grid">
        <section className="panel">
          <div className="section-heading"><h2>予定なし</h2><span>{noSchedule.length}件</span></div>
          <TaskRows items={noSchedule.slice(0, 8)} themes={themes} empty="予定なしのタスクはありません" openDrawer={openDrawer} toggleItem={toggleItem} saveEntity={saveEntity} />
        </section>
        <section className="panel">
          <div className="section-heading"><h2>近いマイルストーン</h2><button className="text-button compact" onClick={() => navigate("timeline")}>Timelineへ</button></div>
          <TaskRows items={milestones.slice(0, 8)} themes={themes} empty="近いマイルストーンはありません" openDrawer={openDrawer} toggleItem={toggleItem} saveEntity={saveEntity} />
        </section>
      </div>

      <div className="today-grid">
        <section className="panel">
          <div className="section-heading"><h2>期限が近い待ち</h2><button className="text-button compact" onClick={() => navigate("waiting")}>Waitingへ</button></div>
          <TaskRows items={waitingSoon.slice(0, 8)} themes={themes} empty="近い待ちはありません" openDrawer={openDrawer} toggleItem={toggleItem} saveEntity={saveEntity} />
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
