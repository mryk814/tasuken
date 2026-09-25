import {
  IconBell,
  IconClock,
  IconMessageCircle,
  IconNotes,
  IconPointFilled,
} from "@tabler/icons-react";

import { AI_ICON } from "../../../pages/semanticIcons";
import type { OpenDrawer, Theme, WorkspaceData } from "../types";
import type { WorkspaceDomain } from "../domain-model/types";
import { WAITING_STATE_LABELS } from "../domain-model/labels";
import {
  buildAgentActivity,
  type AgentActivity,
  type AgentRecentEntry,
  type AgentWorkEntry,
} from "../lib/agentActivity";
import { buildGlance, recordDate } from "../lib/glance";
import { formatDate, str } from "../lib/format";
import { THEME_STATUS_LABELS } from "../lib/domain";
import type { FeedItem } from "../lib/feedFixtures";
import { EmptyState, StatusBadge } from "./common";

/**
 * Feedの右レール（`docs/feed-surface.md`）。
 *
 * 投稿を読みながら、いま人が対応すべきこととAIの動きへ触れるための補助面。
 * 面を移動せずとも対応キューを開ける。0件のセクションは枠を出さない（design-guide §5）。
 * Thread（会話スロット）を開いた間は非表示（右側補助領域は1スロット、§21）。
 */

interface FeedContextRailProps {
  data: WorkspaceData;
  domain: WorkspaceDomain;
  activeTheme: Theme | null;
  /** 対応待ちの行（`buildAttentionQueue` 投影済み）。0件ならセクションを畳む。 */
  attention: FeedItem[];
  openDrawer: OpenDrawer;
  navigate(next: string): void;
  /** 対応待ちタブを開き、該当行の回答欄へ進む。 */
  onOpenAttention(item: FeedItem): void;
  /** 投稿の絞り込み（そのAIの投稿だけ表示）。 */
  onFilterAuthor(authorId: string | null): void;
}

function AgentRow({
  agent,
  onFilterAuthor,
}: {
  agent: AgentActivity;
  onFilterAuthor(authorId: string | null): void;
}) {
  const waiting = agent.waiting.length;
  const working = agent.work.filter((entry) => entry.state === "working").length;
  const queued = agent.work.filter((entry) => entry.state === "start_waiting").length;
  const posts = agent.posts.length;
  return (
    <button
      className="context-row"
      onClick={() => onFilterAuthor(agent.authorId)}
      aria-label={`${agent.label} の投稿だけを表示`}
    >
      <AI_ICON size={14} />
      <span>
        <strong>{agent.label}</strong>
        <small>
          {waiting > 0 ? `対応待ち ${waiting} / ` : ""}
          {working > 0 ? `作業中 ${working} / ` : ""}
          {queued > 0 ? `開始待ち ${queued} / ` : ""}
          投稿 {posts}
        </small>
      </span>
    </button>
  );
}

/**
 * 作業の実体（#599の契約）。
 * 経過時間で状態を変えず、`deriveAgentWorkState` の結果だけを出す。
 * 開始していない仕事は「開始は未確認」と書き、取得済みと偽らない。
 */
function WorkRow({ entry }: { entry: AgentWorkEntry }) {
  return (
    <div className="context-row" role="listitem">
      <IconPointFilled size={14} />
      <span>
        <strong>{entry.title}</strong>
        <small>{entry.state === "start_waiting" ? "開始は未確認" : "作業中"}</small>
      </span>
    </div>
  );
}

/** 採用した報告（#602）。採用と完了を混同しない文言で読ませる。 */
function RecentRow({ entry }: { entry: AgentRecentEntry }) {
  return (
    <div className="context-row" role="listitem">
      <IconClock size={14} />
      <span>
        <strong>{entry.title}</strong>
        <small>{entry.completed ? "受入れ済み／Task完了" : "受入れ済み／Taskは継続"}</small>
      </span>
    </div>
  );
}

export function FeedContextRail({
  data,
  domain: v2,
  activeTheme,
  attention,
  openDrawer,
  navigate,
  onOpenAttention,
  onFilterAuthor,
}: FeedContextRailProps) {
  const { overdue, waitingRows, recentUpdates, notes, chatResources } = buildGlance({
    data,
    domain: v2,
    activeTheme,
  });
  const schedulesMap = new Map(v2.schedules.map((s) => [`${s.owner_type}:${s.owner_id}`, s]));
  /** 活動の実体があるAIだけ出す（Agent Deskと同じ導出）。 */
  const agents = buildAgentActivity({
    tasks: v2.tasks as unknown[],
    proposals: v2.ai_proposals as unknown[],
    receipts: data.work_receipts as unknown[],
    themes: data.themes as unknown[],
    feedReplies: v2.feed_replies as unknown[],
  }).filter((agent) => agent.waiting.length > 0 || agent.work.length > 0 || agent.posts.length > 0);

  return (
    <aside className="feed-rail" aria-label="Feedの補助情報">
      {attention.length > 0 && (
        <section className="context-section context-focus">
          <div className="context-section-heading">
            <h2>対応キュー</h2>
            <button className="text-button compact" onClick={() => onOpenAttention(attention[0])}>
              まとめて見る
            </button>
          </div>
          <div className="context-stack">
            {attention.slice(0, 5).map((item) => (
              <button
                className="context-row"
                key={item.id}
                onClick={() => onOpenAttention(item)}
                aria-label={`${item.headline} を対応待ちで開く`}
              >
                <IconBell size={14} />
                <span>
                  <strong>{item.headline}</strong>
                  <small>
                    {item.stateLabel} / {item.actorLabel ?? "Tasken"}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {agents.length > 0 && (
        <section className="context-section">
          <div className="context-section-heading">
            <h2>AI活動</h2>
            <span>絞り込み</span>
          </div>
          <div className="context-stack">
            {agents.map((agent) => (
              <div key={agent.authorId} className="feed-rail-agent">
                <AgentRow agent={agent} onFilterAuthor={onFilterAuthor} />
                {/* 作業の実体と採用済みの報告。経過時間ではなくderived stateだけを出す（#599/#602）。 */}
                {agent.work.slice(0, 2).map((entry) => (
                  <WorkRow key={entry.taskId} entry={entry} />
                ))}
                {agent.recent.slice(0, 2).map((entry) => (
                  <RecentRow key={entry.taskId} entry={entry} />
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {(overdue.length > 0 || waitingRows.length > 0 || recentUpdates.length > 0) && (
        <section className="context-section">
          <div className="context-section-heading">
            <h2>今見るもの</h2>
            <button className="text-button compact" onClick={() => navigate("today")}>
              今日へ
            </button>
          </div>
          {overdue.length + waitingRows.length + recentUpdates.length > 0 && (
            <div className="context-metrics">
              {overdue.length > 0 && (
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
          <div className="context-stack">
            {overdue.slice(0, 2).map(({ task, date, themeName }) => (
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
            {waitingRows.slice(0, 2).map((w) => (
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
          </div>
        </section>
      )}

      {(notes.length > 0 || chatResources.length > 0) && (
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
          </div>
        </section>
      )}

      {attention.length === 0 &&
        agents.length === 0 &&
        overdue.length === 0 &&
        waitingRows.length === 0 &&
        recentUpdates.length === 0 &&
        notes.length === 0 &&
        chatResources.length === 0 && (
          <EmptyState
            title="いま見守る更新はありません"
            action="タスクを見る"
            onAction={() => navigate("todo")}
          />
        )}
    </aside>
  );
}
