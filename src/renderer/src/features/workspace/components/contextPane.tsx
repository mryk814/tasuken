import { IconMessageCircle, IconNotes, IconPointFilled } from "@tabler/icons-react";

import type { OpenDrawer, Theme, WorkspaceData } from "../types";
import type { WorkspaceDomain } from "../domain-model/types";
import { THEME_STATUS_LABELS } from "../lib/domain";
import { buildGlance, recordDate } from "../lib/glance";
import { formatDate, str } from "../lib/format";
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

export function ContextPane({
  data,
  domain: v2,
  activeTheme,
  route,
  openDrawer,
  navigate,
}: ContextPaneProps) {
  const isTodayRoute = route === "today";
  const { today, overdue, waitingRows, recentUpdates, notes, chatResources } = buildGlance({
    data,
    domain: v2,
    activeTheme,
  });
  const schedulesMap = new Map(v2.schedules.map((s) => [`${s.owner_type}:${s.owner_id}`, s]));

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
            <button className="text-button compact" onClick={() => navigate("today")}>
              今日へ
            </button>
          </div>
          {/* 0件のメトリクスは面を占領しない。中身があるときだけ数える（design-guide §5）。 */}
          {(overdue.length > 0 || waitingRows.length > 0) && (
            <div className="context-metrics">
              {!isTodayRoute && overdue.length > 0 && (
                <button onClick={() => navigate("todo")}>
                  <span>期限切れ</span>
                  <strong>{overdue.length}</strong>
                </button>
              )}
              {waitingRows.length > 0 && (
                <button onClick={() => navigate("waiting")}>
                  <span>待ち</span>
                  <strong>{waitingRows.length}</strong>
                </button>
              )}
            </div>
          )}
          {!isTodayRoute &&
            overdue.slice(0, 3).map(({ task, date, themeName }) => (
              <button
                className="context-row"
                key={task.id}
                onClick={() =>
                  openDrawer({
                    type: "task",
                    entity: { ...task, _schedule: schedulesMap.get(`task:${task.id}`) } as Record<
                      string,
                      unknown
                    >,
                  })
                }
              >
                <IconPointFilled size={14} />
                <span>
                  <strong>{task.title}</strong>
                  <small>
                    {themeName || "個人"} / {formatDate(date)}
                  </small>
                </span>
              </button>
            ))}
          {!isTodayRoute && !overdue.length && (
            <EmptyState
              title="急ぎの期限切れはありません"
              action="タスクを見る"
              onAction={() => navigate("todo")}
            />
          )}
        </section>

        <section className="context-section">
          <div className="context-section-heading">
            <h2>最近の現在地</h2>
            <button
              className="text-button compact"
              onClick={() =>
                openDrawer({
                  type: "status_update",
                  mode: "edit",
                  entity: { theme_id: activeTheme?.id || null, date: today },
                })
              }
            >
              記録
            </button>
          </div>
          <div className="context-stack">
            {recentUpdates.map((entry) => (
              <button
                className="context-note-row"
                key={entry.id}
                onClick={() => openDrawer({ type: "status_update", entity: entry })}
              >
                <StatusBadge
                  value={entry.status}
                  label={THEME_STATUS_LABELS[entry.status ?? ""] || entry.status}
                />
                <strong>{entry.summary}</strong>
                <small>{formatDate(entry.date)}</small>
              </button>
            ))}
            {!recentUpdates.length && (
              <EmptyState
                title="現在地はまだありません"
                action="記録する"
                onAction={() =>
                  openDrawer({
                    type: "status_update",
                    mode: "edit",
                    entity: { theme_id: activeTheme?.id || null, date: today },
                  })
                }
              />
            )}
          </div>
        </section>

        {waitingRows.length > 0 && (
          <section className="context-section">
            <div className="context-section-heading">
              <h2>待ちの手触り</h2>
              <button className="text-button compact" onClick={() => navigate("waiting")}>
                一覧
              </button>
            </div>
            {waitingRows.map((w) => (
              <button
                className="context-row"
                key={w.id}
                onClick={() =>
                  openDrawer({
                    type: "waiting",
                    entity: { ...w, _schedule: schedulesMap.get(`waiting:${w.id}`) } as Record<
                      string,
                      unknown
                    >,
                  })
                }
              >
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
              <button
                className="context-note-row"
                key={note.id}
                onClick={() =>
                  openDrawer({ type: "note", entity: note as unknown as Record<string, unknown> })
                }
              >
                <IconNotes size={16} />
                <span>
                  <strong>{note.title}</strong>
                  <small>
                    {str(note.body_markdown).slice(0, 84) || formatDate(recordDate(note))}
                  </small>
                </span>
              </button>
            ))}
            {chatResources.map((r) => (
              <button
                className="context-note-row"
                key={r.id}
                onClick={() =>
                  openDrawer({ type: "resource", entity: r as unknown as Record<string, unknown> })
                }
              >
                <IconMessageCircle size={16} />
                <span>
                  <strong>{r.title}</strong>
                  <small>
                    {str(r.chat_group) ||
                      str(r.description).slice(0, 84) ||
                      formatDate(recordDate(r))}
                  </small>
                </span>
              </button>
            ))}
            {!notes.length && !chatResources.length && (
              <EmptyState
                title="拾い直せるメモはまだありません"
                action="メモを書く"
                onAction={() => openDrawer({ type: "note", mode: "edit", entity: {} })}
              />
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}
