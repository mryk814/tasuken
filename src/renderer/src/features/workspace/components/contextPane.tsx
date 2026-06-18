import { IconMessageCircle, IconNotes, IconPointFilled } from "@tabler/icons-react";

import type { Item, Link, Note, OpenDrawer, Theme, WorkspaceData } from "../types";
import { STATUS_LABELS, THEME_STATUS_LABELS } from "../lib/domain";
import { dateOnly, formatDate, str } from "../lib/format";
import { EmptyState, StatusBadge } from "./common";

interface ContextPaneProps {
  data: WorkspaceData;
  activeTheme: Theme | null;
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

function itemDueDate(item: Item): string {
  return dateOnly(item.planned_end || item.planned_start);
}

function itemThemeName(themes: Theme[], item: Item): string {
  return themes.find((theme) => theme.id === item.theme_id)?.name || "個人";
}

export function ContextPane({ data, activeTheme, openDrawer, navigate }: ContextPaneProps) {
  const today = dateOnly(new Date().toISOString());
  const themeItems = activeTheme ? data.items.filter((item) => item.theme_id === activeTheme.id) : data.items;
  const openItems = themeItems.filter((item) => !["done", "cancelled", "archived"].includes(str(item.status)));
  const overdue = openItems.filter((item) => itemDueDate(item) && itemDueDate(item) < today).sort((a, b) => itemDueDate(a).localeCompare(itemDueDate(b)));
  const waiting = openItems.filter((item) => item.status === "waiting").slice(0, 4);
  const recentUpdates = [...data.status_updates]
    .filter((entry) => !activeTheme || entry.theme_id === activeTheme.id)
    .sort((a, b) => str(b.date || b.updated_at).localeCompare(str(a.date || a.updated_at)))
    .slice(0, 2);
  const notes = pickRediscovery<Note>(data.notes, 2);
  const chatLinks = pickRediscovery<Link>(data.links.filter((link) => ["chatgpt", "claude", "gemini", "copilot"].includes(str(link.link_type))), 2);

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
            <button onClick={() => navigate("todo")}>
              <span>期限切れ</span>
              <strong>{overdue.length}</strong>
            </button>
            <button onClick={() => navigate("waiting")}>
              <span>待ち</span>
              <strong>{waiting.length}</strong>
            </button>
          </div>
          {overdue.slice(0, 3).map((item) => (
            <button className="context-row" key={item.id} onClick={() => openDrawer({ type: "item", entity: item })}>
              <IconPointFilled size={14} />
              <span>
                <strong>{item.title}</strong>
                <small>{itemThemeName(data.themes, item)} / {formatDate(itemDueDate(item))}</small>
              </span>
            </button>
          ))}
          {!overdue.length && <EmptyState title="急ぎの期限切れはありません" action="タスクを見る" onAction={() => navigate("todo")} />}
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

        {waiting.length > 0 && (
          <section className="context-section">
            <div className="context-section-heading">
              <h2>待ちの手触り</h2>
              <button className="text-button compact" onClick={() => navigate("waiting")}>一覧</button>
            </div>
            {waiting.map((item) => (
              <button className="context-row" key={item.id} onClick={() => openDrawer({ type: "item", entity: item })}>
                <StatusBadge value={item.status} label={STATUS_LABELS[item.status ?? ""]} />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.next_action || item.description || "次の確認を決める"}</small>
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
              <button className="context-note-row" key={note.id} onClick={() => openDrawer({ type: "note", entity: note })}>
                <IconNotes size={16} />
                <span>
                  <strong>{note.title}</strong>
                  <small>{str(note.body_markdown).slice(0, 84) || formatDate(recordDate(note))}</small>
                </span>
              </button>
            ))}
            {chatLinks.map((link) => (
              <button className="context-note-row" key={link.id} onClick={() => openDrawer({ type: "link", entity: link })}>
                <IconMessageCircle size={16} />
                <span>
                  <strong>{link.title}</strong>
                  <small>{str(link.chat_group) || str(link.description).slice(0, 84) || formatDate(recordDate(link))}</small>
                </span>
              </button>
            ))}
            {!notes.length && !chatLinks.length && <EmptyState title="拾い直せるメモはまだありません" action="メモを書く" onAction={() => openDrawer({ type: "note", mode: "edit", entity: {} })} />}
          </div>
        </section>
      </div>
    </aside>
  );
}
