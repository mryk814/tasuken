import { IconMessageCircle, IconNotes, IconPointFilled } from "@tabler/icons-react";

import type { OpenDrawer, Theme, WorkspaceData } from "../types";
import type { Note, Resource, WorkspaceDomain } from "../domain-model/types";
import { resolveChatService } from "../lib/chatServices";
import { THEME_STATUS_LABELS } from "../lib/domain";
import { dateOnly, formatDate, str } from "../lib/format";
import { EmptyState, StatusBadge } from "./common";
import { WAITING_STATE_LABELS } from "../domain-model/labels";

interface ContextPaneProps {
  data: WorkspaceData;
  domain: WorkspaceDomain;
  activeTheme: Theme | null;
  route: string;
  openDrawer: OpenDrawer;
  navigate(next: string): void;
}

function recordDate(record: { updated_at?: string; created_at?: string; captured_at?: string | null }): string {
  return dateOnly(record.updated_at || record.captured_at || record.created_at);
}

function daysAgo(value: string): number {
  if (!value) return 9999;
  const today = new Date();
  const then = new Date(`${value}T00:00:00`);
  return Math.floor((today.getTime() - then.getTime()) / 86400000);
}

function daySeed(): number {
  const key = dateOnly(new Date().toISOString());
  return key.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function pickRediscovery<T extends { id: string; updated_at?: string; created_at?: string; captured_at?: string | null }>(records: T[], count: number): T[] {
  const seed = daySeed();
  return [...records]
    .filter((record) => daysAgo(recordDate(record)) >= 7)
    .sort((a, b) => {
      const aScore = (a.id.charCodeAt(0) || 0) + seed + daysAgo(recordDate(a));
      const bScore = (b.id.charCodeAt(0) || 0) + seed + daysAgo(recordDate(b));
      return (aScore % 97) - (bScore % 97);
    })
    .slice(0, count);
}

export function ContextPane({ data, domain: v2, activeTheme, route, openDrawer, navigate }: ContextPaneProps) {
  const today = dateOnly(new Date().toISOString());
  const isTodayRoute = route === "today";
  const schedulesMap = new Map(v2.schedules.map((s) => [`${s.owner_type}:${s.owner_id}`, s]));
  const themeTasks = activeTheme ? v2.tasks.filter((t) => t.project_id === activeTheme.id) : v2.tasks;
  const openTasks = themeTasks.filter((t) => t.state !== "done" && t.state !== "cancelled");
  const overdue = openTasks
    .map((t) => ({ task: t, date: schedulesMap.get(`task:${t.id}`)?.end_date || "" }))
    .filter((r) => r.date && r.date < today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const themeWaitings = activeTheme ? v2.waitings.filter((w) => w.project_id === activeTheme.id) : v2.waitings;
  const waitingRows = themeWaitings.filter((w) => w.state === "waiting").slice(0, 4);
  const recentUpdates = [...data.status_updates]
    .filter((entry) => !activeTheme || entry.theme_id === activeTheme.id)
    .sort((a, b) => str(b.date || b.updated_at).localeCompare(str(a.date || a.updated_at)))
    .slice(0, 2);
  const notes = pickRediscovery(v2.notes as (Note & { updated_at?: string; created_at?: string })[], 2);
  const chatResources = pickRediscovery(
    v2.resources.filter((r) => resolveChatService(r) !== "other") as (Resource & { updated_at?: string; created_at?: string })[],
    2,
  );

  return (
    <aside className="context-pane" aria-label="コンテキスト">
      <div className="context-pane-header">
        <span>Context</span>
        <strong>{activeTheme?.name || "全体"}</strong>
      </div>
      <div className="context-pane-content">
        <section className="context-section context-focus">
          <div className="context-section-heading">
            <h2>今見るもの</h2>
            <button className="text-button compact" onClick={() => navigate("today")}>今日へ</button>
          </div>
          <div className="context-metrics">
            {!isTodayRoute && (
              <button onClick={() => navigate("todo")}>
                <span>期限切れ</span>
                <strong>{overdue.length}</strong>
              </button>
            )}
            <button onClick={() => navigate("waiting")}>
              <span>待ち</span>
              <strong>{waitingRows.length}</strong>
            </button>
          </div>
          {!isTodayRoute && overdue.slice(0, 3).map(({ task, date }) => (
            <button className="context-row" key={task.id} onClick={() => openDrawer({ type: "task", entity: { ...task, _schedule: schedulesMap.get(`task:${task.id}`) } as Record<string, unknown> })}>
              <IconPointFilled size={14} />
              <span>
                <strong>{task.title}</strong>
                <small>{data.themes.find((t) => t.id === task.project_id)?.name || "個人"} / {formatDate(date)}</small>
              </span>
            </button>
          ))}
          {!isTodayRoute && !overdue.length && <EmptyState title="急ぎの期限切れはありません" action="タスクを見る" onAction={() => navigate("todo")} />}
        </section>

        <section className="context-section">
          <div className="context-section-heading">
            <h2>最近の現在地</h2>
            <button className="text-button compact" onClick={() => openDrawer({ type: "status_update", mode: "edit", entity: { theme_id: activeTheme?.id || null, date: today } })}>記録</button>
          </div>
          <div className="context-stack">
            {recentUpdates.map((entry) => (
              <button className="context-note-row" key={entry.id} onClick={() => openDrawer({ type: "status_update", entity: entry })}>
                <StatusBadge value={entry.status} label={THEME_STATUS_LABELS[entry.status ?? ""] || entry.status} />
                <strong>{entry.summary}</strong>
                <small>{formatDate(entry.date)}</small>
              </button>
            ))}
            {!recentUpdates.length && <EmptyState title="現在地はまだありません" action="記録する" onAction={() => openDrawer({ type: "status_update", mode: "edit", entity: { theme_id: activeTheme?.id || null, date: today } })} />}
          </div>
        </section>

        {waitingRows.length > 0 && (
          <section className="context-section">
            <div className="context-section-heading">
              <h2>待ちの手触り</h2>
              <button className="text-button compact" onClick={() => navigate("waiting")}>一覧</button>
            </div>
            {waitingRows.map((w) => (
              <button className="context-row" key={w.id} onClick={() => openDrawer({ type: "waiting", entity: { ...w, _schedule: schedulesMap.get(`waiting:${w.id}`) } as Record<string, unknown> })}>
                <StatusBadge value={w.state} label={WAITING_STATE_LABELS[w.state]} />
                <span>
                  <strong>{w.title}</strong>
                  <small>{w.next_action || w.description || "次の確認を決める"}</small>
                </span>
              </button>
            ))}
          </section>
        )}

        <section className="context-section">
          <div className="context-section-heading">
            <h2>再発見</h2>
            <span>日替わり</span>
          </div>
          <div className="context-stack">
            {notes.map((note) => (
              <button className="context-note-row" key={note.id} onClick={() => openDrawer({ type: "note", entity: note as unknown as Record<string, unknown> })}>
                <IconNotes size={16} />
                <span>
                  <strong>{note.title}</strong>
                  <small>{str(note.body_markdown).slice(0, 84) || formatDate(recordDate(note))}</small>
                </span>
              </button>
            ))}
            {chatResources.map((r) => (
              <button className="context-note-row" key={r.id} onClick={() => openDrawer({ type: "resource", entity: r as unknown as Record<string, unknown> })}>
                <IconMessageCircle size={16} />
                <span>
                  <strong>{r.title}</strong>
                  <small>{str(r.chat_group) || str(r.description).slice(0, 84) || formatDate(recordDate(r))}</small>
                </span>
              </button>
            ))}
            {!notes.length && !chatResources.length && <EmptyState title="拾い直せるメモはまだありません" action="メモを書く" onAction={() => openDrawer({ type: "note", mode: "edit", entity: {} })} />}
          </div>
        </section>
      </div>
    </aside>
  );
}
