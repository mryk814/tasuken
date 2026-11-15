import { useState } from "react";
import { IconChevronDown, IconChevronRight, IconExternalLink } from "@tabler/icons-react";

import type { OpenDrawer, RemoveEntity, SaveEntities } from "../types";
import type { WorkspaceDomain } from "../domain-model/types";
import { EXTERNAL_REFERENCE_KIND_LABELS } from "../domain-model/labels";
import {
  agentSessionActivities,
  agentSessionActivityIds,
  buildAgentSessionAssignmentOperations,
  buildAgentWorkProjection,
  groupAgentWorkProjection,
  type AgentWorkProjectionRow,
} from "../domain-model/agentSessionProjection";
import { useActivityEvents } from "../lib/useActivityEvents";
import {
  AgentWorkCardDetail,
  AgentWorkClientMark,
  agentWorkCardLineClass,
  agentWorkCardStatusLabel,
  agentWorkRowPlace,
} from "./AgentWorkCardDetail";

interface AgentWorkSummaryPanelProps {
  domain: WorkspaceDomain;
  date?: string;
  themeId?: string;
  includeUnresolved?: boolean;
  carryoverOnly?: boolean;
  groupByTheme?: boolean;
  limit?: number;
  title?: string;
  onOpenTheme?(themeId: string): void;
  openDrawer: OpenDrawer;
  saveEntities: SaveEntities;
  /** カードを消す（消した印を付ける。すぐ後の「元に戻す」で戻せる）。 */
  removeEntity?: RemoveEntity;
}

interface AssignmentEditorState {
  sessionId: string;
  themeId: string;
  repositoryContextId: string;
}

/**
 * 開いた行の根拠（Task の作業報告と、その会話から出た活動）。来歴は Workspace に載らないので、
 * 開いた時にその会話の分だけを読む（#755 束0b）。新しい記録は来歴を持たないので、ふつうは何も出ない。
 */
function AgentWorkEvidence({ row }: { row: AgentWorkProjectionRow }) {
  const loaded = useActivityEvents({ sessionIds: agentSessionActivityIds(row.card) });
  const activities = agentSessionActivities(
    loaded.events as unknown as WorkspaceDomain["change_events"],
    row.card,
  );
  if (row.receipts.length === 0 && activities.length === 0) return null;
  return (
    <div className="agent-work-evidence">
      {row.receipts.map((receipt) => (
        <div className="agent-work-receipt" key={receipt.id}>
          <span>Work Receipt</span>
          <p>{receipt.summary}</p>
          {(receipt.external_references || []).map((reference) => (
            <a
              key={`${reference.kind}:${reference.url}`}
              href={reference.url}
              target="_blank"
              rel="noreferrer"
            >
              {reference.display_label || EXTERNAL_REFERENCE_KIND_LABELS[reference.kind]}
              <IconExternalLink size={12} aria-hidden="true" />
            </a>
          ))}
        </div>
      ))}
      {activities.length > 0 && (
        <div className="agent-work-activity">
          <span>Activity {activities.length}</span>
          <p>
            {activities
              .slice(0, 3)
              .map((event) => event.summary || event.event_kind)
              .filter(Boolean)
              .join(" / ")}
          </p>
        </div>
      )}
    </div>
  );
}

function timeLabel(value: string, rowDate: string, selectedDate?: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return value;
  const time = timestamp.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  if (selectedDate && rowDate === selectedDate) return time;
  const calendarDate = timestamp.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
  return `${calendarDate} ${time}`;
}

/**
 * テーマ（と今日）の「AI の作業」。カード = 時刻・AI の印・リポジトリかテーマ・要約 1 行。
 * 開くと、変えた物・確かめたこと・残り。残りがある物・止まった物は引き継ぎとして上に残す。
 */
export function AgentWorkSummaryPanel({
  domain,
  date,
  themeId,
  includeUnresolved = false,
  carryoverOnly = false,
  groupByTheme = false,
  limit = 8,
  title = carryoverOnly ? "AI の作業の引き継ぎ" : "AI の作業",
  onOpenTheme,
  openDrawer,
  saveEntities,
  removeEntity,
}: AgentWorkSummaryPanelProps) {
  const [expandedId, setExpandedId] = useState("");
  const [assignmentEditor, setAssignmentEditor] = useState<AssignmentEditorState | null>(null);
  const [savingAssignmentId, setSavingAssignmentId] = useState("");
  const allRows = buildAgentWorkProjection(domain, {
    date,
    themeId,
    includeUnresolved,
    carryoverOnly,
    limit: Number.MAX_SAFE_INTEGER,
  });
  const visibleRows = allRows.slice(0, limit);
  const rows = visibleRows.filter((row) => row.presentation !== "record");
  const recordRows = allRows.filter((row) => row.presentation === "record");
  const omittedCarryoverCount = carryoverOnly
    ? Math.max(0, allRows.length - visibleRows.length)
    : 0;
  const groups = groupByTheme
    ? groupAgentWorkProjection(rows)
    : [{ key: "all", themeLabel: "", repositoryLabel: "", rows }];
  const unresolvedCount = allRows.filter((row) => row.unresolved).length;
  const availableRepositories = domain.repository_contexts.filter(
    (repository) => !repository.deleted_at && repository.active !== false,
  );

  function openAssignmentEditor(row: AgentWorkProjectionRow) {
    setAssignmentEditor({
      sessionId: row.card.id,
      themeId: row.themes[0]?.id || "",
      repositoryContextId: row.repositories[0]?.id || "",
    });
  }

  async function saveAssignment(row: AgentWorkProjectionRow) {
    if (!row.session || !assignmentEditor || assignmentEditor.sessionId !== row.card.id) return;
    const operations = buildAgentSessionAssignmentOperations(row.session.id, {
      themeId: assignmentEditor.themeId,
      repositoryContextId: assignmentEditor.repositoryContextId,
      existingThemeIds: row.themes.map((theme) => theme.id),
      existingRepositoryContextIds: row.repositories.map((repository) => repository.id),
    });
    if (!operations.length) return;
    setSavingAssignmentId(row.card.id);
    try {
      await saveEntities(operations, "関連付けを保存しました。");
      setAssignmentEditor(null);
    } finally {
      setSavingAssignmentId("");
    }
  }

  function renderRow(row: AgentWorkProjectionRow) {
    const { card } = row;
    const expanded = expandedId === card.id;
    const editingAssignment = assignmentEditor?.sessionId === card.id;
    const canSaveAssignment = Boolean(
      editingAssignment &&
      assignmentEditor.themeId &&
      (!row.themes.some((theme) => theme.id === assignmentEditor.themeId) ||
        (assignmentEditor.repositoryContextId &&
          !row.repositories.some(
            (repository) => repository.id === assignmentEditor.repositoryContextId,
          ))),
    );
    const place = agentWorkRowPlace(row);
    const showStatus = card.running || card.status !== "done";

    return (
      <article
        className={`agent-work-row agent-work-line ${agentWorkCardLineClass(card)} status-${card.running ? "active" : card.status} presentation-${row.presentation}`}
        key={card.id}
      >
        <button
          type="button"
          className="agent-work-summary"
          aria-expanded={expanded}
          onClick={() => setExpandedId(expanded ? "" : card.id)}
        >
          <span className="agent-work-main">
            <span className="agent-work-head">
              <time dateTime={card.ended_at}>{timeLabel(card.ended_at, row.date, date)}</time>
              <AgentWorkClientMark card={card} />
              {place && <span className="agent-work-place">{place}</span>}
            </span>
            <strong>{row.headline}</strong>
            {row.unresolved && card.remaining.length > 0 && (
              <span className="agent-work-remaining">残り: {card.remaining.join(" / ")}</span>
            )}
          </span>
          <span className="agent-work-meta">
            {showStatus && (
              <span
                className={`agent-session-status status-${card.running ? "active" : card.status}`}
              >
                {agentWorkCardStatusLabel(card)}
              </span>
            )}
          </span>
          {expanded ? (
            <IconChevronDown size={16} aria-hidden="true" />
          ) : (
            <IconChevronRight size={16} aria-hidden="true" />
          )}
        </button>
        {expanded && (
          <div className="agent-work-detail">
            <AgentWorkCardDetail row={row} removeEntity={removeEntity}>
              {((onOpenTheme && row.themes.length > 0) || row.tasks.length > 0) && (
                <div className="agent-work-links" aria-label="関連先">
                  {onOpenTheme &&
                    row.themes.map((theme) => (
                      <button type="button" key={theme.id} onClick={() => onOpenTheme?.(theme.id)}>
                        Theme: {theme.name}
                      </button>
                    ))}
                  {row.tasks.map((task) => (
                    <button
                      type="button"
                      key={task.id}
                      onClick={() =>
                        openDrawer({
                          type: "task",
                          entity: task as unknown as Record<string, unknown>,
                        })
                      }
                    >
                      Task: {task.title}
                    </button>
                  ))}
                </div>
              )}
              {row.assignmentIncomplete && (
                <div className="agent-work-assignment">
                  <button
                    type="button"
                    className="agent-work-assignment-trigger"
                    aria-expanded={editingAssignment}
                    onClick={() => openAssignmentEditor(row)}
                  >
                    関連付け
                  </button>
                  {editingAssignment && (
                    <form
                      className="agent-work-assignment-editor"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveAssignment(row);
                      }}
                    >
                      <label>
                        Theme
                        <select
                          value={assignmentEditor.themeId}
                          onChange={(event) =>
                            setAssignmentEditor((current) =>
                              current ? { ...current, themeId: event.target.value } : current,
                            )
                          }
                          required
                        >
                          <option value="">Themeを選択</option>
                          {domain.projects.map((theme) => (
                            <option key={theme.id} value={theme.id}>
                              {theme.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Repository
                        <select
                          value={assignmentEditor.repositoryContextId}
                          onChange={(event) =>
                            setAssignmentEditor((current) =>
                              current
                                ? { ...current, repositoryContextId: event.target.value }
                                : current,
                            )
                          }
                        >
                          <option value="">Repositoryを選ばない</option>
                          {availableRepositories.map((repository) => (
                            <option key={repository.id} value={repository.id}>
                              {repository.label || repository.repository_slug || "Repository"}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="agent-work-assignment-actions">
                        <button
                          type="button"
                          onClick={() => openDrawer({ type: "theme", mode: "edit", entity: {} })}
                        >
                          新しいThemeを作成
                        </button>
                        <button
                          type="submit"
                          disabled={!canSaveAssignment || savingAssignmentId === card.id}
                        >
                          {savingAssignmentId === card.id ? "保存中…" : "保存"}
                        </button>
                        <button type="button" onClick={() => setAssignmentEditor(null)}>
                          キャンセル
                        </button>
                      </div>
                      {!availableRepositories.length && (
                        <p>Repositoryは未登録です。Themeのみを関連付けできます。</p>
                      )}
                      {!canSaveAssignment && assignmentEditor.themeId && (
                        <p>
                          {availableRepositories.length
                            ? "現在の選択はすでに関連付け済みです。追加するRepositoryを選択してください。"
                            : "Themeは関連付け済みですが、利用できるRepositoryがありません。"}
                        </p>
                      )}
                    </form>
                  )}
                </div>
              )}
              <AgentWorkEvidence row={row} />
            </AgentWorkCardDetail>
          </div>
        )}
      </article>
    );
  }

  return (
    <section className="panel agent-work-panel">
      <div className="section-heading">
        <h2>
          {title}
          {unresolvedCount > 0 && (
            <span className="agent-work-handoff-count">引き継ぎ {unresolvedCount}</span>
          )}
        </h2>
        <span>
          {allRows.length}件{omittedCarryoverCount > 0 ? ` / ほか${omittedCarryoverCount}件` : ""}
        </span>
      </div>
      {allRows.length ? (
        <div className="agent-work-list">
          {groups.map((group) => (
            <section className="agent-work-group" key={group.key}>
              {groupByTheme && (
                <div className="agent-work-group-heading">
                  <span>
                    <strong>{group.themeLabel}</strong>
                    <small>{group.repositoryLabel}</small>
                  </span>
                  <small>{group.rows.length}件</small>
                </div>
              )}
              {group.rows.map(renderRow)}
            </section>
          ))}
          {recordRows.length > 0 && (
            <details className="agent-work-records">
              <summary>
                <span>記録のみ</span>
                <small>要約の記録なし {recordRows.length}件</small>
              </summary>
              <div className="agent-work-record-list">{recordRows.map(renderRow)}</div>
            </details>
          )}
        </div>
      ) : (
        <div className="agent-work-empty">
          {carryoverOnly ? "引き継ぐ AI の作業はありません。" : "AI の作業はまだありません。"}
        </div>
      )}
    </section>
  );
}
