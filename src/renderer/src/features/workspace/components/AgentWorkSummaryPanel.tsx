import { useState } from "react";
import {
  IconChevronDown,
  IconChevronRight,
  IconExternalLink,
} from "@tabler/icons-react";

import { AI_ICON } from "../../../pages/semanticIcons";
import type { OpenDrawer, SaveEntities } from "../types";
import type { WorkspaceDomain } from "../domain-model/types";
import { EXTERNAL_REFERENCE_KIND_LABELS } from "../domain-model/labels";
import {
  buildAgentSessionAssignmentOperations,
  buildAgentWorkProjection,
  groupAgentWorkProjection,
  type AgentWorkProjectionRow,
} from "../lib/agentSessionProjection";

const CLIENT_LABELS: Record<string, string> = {
  codex: "Codex",
  claude_code: "Claude Code",
  cursor: "Cursor",
  github_copilot: "GitHub Copilot",
  other: "AI client",
};

const STATUS_LABELS: Record<string, string> = {
  active: "作業中",
  completed: "完了",
  blocked: "停止中",
  abandoned: "中止",
};

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
}

interface AssignmentEditorState {
  sessionId: string;
  themeId: string;
  repositoryContextId: string;
}

function timeLabel(value: string, rowDate: string, selectedDate?: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return value;
  const time = timestamp.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  if (selectedDate && rowDate === selectedDate) return time;
  const calendarDate = timestamp.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
  return `${calendarDate} ${time}`;
}

export function AgentWorkSummaryPanel({
  domain,
  date,
  themeId,
  includeUnresolved = false,
  carryoverOnly = false,
  groupByTheme = false,
  limit = 8,
  title = carryoverOnly ? "AI作業の引き継ぎ" : "AI work",
  onOpenTheme,
  openDrawer,
  saveEntities,
}: AgentWorkSummaryPanelProps) {
  const [expandedId, setExpandedId] = useState("");
  const [assignmentEditor, setAssignmentEditor] = useState<AssignmentEditorState | null>(null);
  const [savingAssignmentId, setSavingAssignmentId] = useState("");
  const rows = buildAgentWorkProjection(domain, {
    date,
    themeId,
    includeUnresolved,
    carryoverOnly,
    limit,
  });
  const omittedCarryoverCount = carryoverOnly
    ? Math.max(
        0,
        buildAgentWorkProjection(domain, {
          date,
          themeId,
          carryoverOnly: true,
          limit: Number.MAX_SAFE_INTEGER,
        }).length - rows.length,
      )
    : 0;
  const groups = groupByTheme
    ? groupAgentWorkProjection(rows)
    : [{ key: "all", themeLabel: "", repositoryLabel: "", rows }];
  const unresolvedCount = rows.filter((row) => row.unresolved).length;
  const availableRepositories = domain.repository_contexts.filter(
    (repository) => !repository.deleted_at && repository.active !== false,
  );

  function openAssignmentEditor(row: AgentWorkProjectionRow) {
    setAssignmentEditor({
      sessionId: row.session.id,
      themeId: row.themes[0]?.id || "",
      repositoryContextId: row.repositories[0]?.id || "",
    });
  }

  async function saveAssignment(row: AgentWorkProjectionRow) {
    if (!assignmentEditor || assignmentEditor.sessionId !== row.session.id) return;
    const operations = buildAgentSessionAssignmentOperations(row.session.id, {
      themeId: assignmentEditor.themeId,
      repositoryContextId: assignmentEditor.repositoryContextId,
      existingThemeIds: row.themes.map((theme) => theme.id),
      existingRepositoryContextIds: row.repositories.map((repository) => repository.id),
    });
    if (!operations.length) return;
    setSavingAssignmentId(row.session.id);
    try {
      await saveEntities(operations, "関連付けを保存しました。");
      setAssignmentEditor(null);
    } finally {
      setSavingAssignmentId("");
    }
  }

  return (
    <section className="panel agent-work-panel">
      <div className="section-heading">
        <h2>
          {title}
          {unresolvedCount > 0 && <span className="agent-work-handoff-count">引き継ぎ {unresolvedCount}</span>}
        </h2>
        <span>
          {rows.length}件{omittedCarryoverCount > 0 ? ` / ほか${omittedCarryoverCount}件` : ""}
        </span>
      </div>
      {rows.length ? (
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
              {group.rows.map((row) => {
            const { session } = row;
            const expanded = expandedId === session.id;
            const timestamp = session.ended_at || session.started_at;
            const remaining = session.outcome?.remaining_work || [];
            const editingAssignment = assignmentEditor?.sessionId === session.id;
            const canSaveAssignment = Boolean(
              editingAssignment &&
                assignmentEditor.themeId &&
                (!row.themes.some((theme) => theme.id === assignmentEditor.themeId) ||
                  (assignmentEditor.repositoryContextId &&
                    !row.repositories.some(
                      (repository) => repository.id === assignmentEditor.repositoryContextId,
                    ))),
            );
            return (
              <article className={`agent-work-row status-${session.status}`} key={session.id}>
                <button
                  type="button"
                  className="agent-work-summary"
                  aria-expanded={expanded}
                  onClick={() => setExpandedId(expanded ? "" : session.id)}
                >
                  <span className="agent-work-client-stack" title={session.model_label || undefined}>
                    <span className="agent-work-client">
                      <AI_ICON size={15} aria-hidden="true" />
                      {session.client_label || CLIENT_LABELS[session.client_kind] || session.client_kind}
                    </span>
                    <span className="agent-session-identity">{row.sessionIdentity}</span>
                  </span>
                  <span className="agent-work-main">
                    <strong>{row.topic}</strong>
                    <span className="agent-work-result">
                      {row.result ? `結果: ${row.result}` : "結果: 作業中です。"}
                    </span>
                    <span>
                      {[
                        row.themes.length
                          ? row.themes.map((theme) => theme.name).join(" / ")
                          : "Theme未割当",
                        row.repositories.length
                          ? row.repositories.map((repo) => repo.label).filter(Boolean).join(" / ")
                          : "Repository未割当",
                      ].join(" · ")}
                    </span>
                  </span>
                  <span className={`agent-session-status status-${session.status}`}>
                    {STATUS_LABELS[session.status] || session.status}
                  </span>
                  <time dateTime={timestamp}>{timeLabel(timestamp, row.date, date)}</time>
                  {expanded ? <IconChevronDown size={16} aria-hidden="true" /> : <IconChevronRight size={16} aria-hidden="true" />}
                </button>
                {row.assignmentIncomplete && (
                  <button
                    type="button"
                    className="agent-work-assignment-trigger"
                    aria-expanded={editingAssignment}
                    onClick={() => openAssignmentEditor(row)}
                  >
                    関連付け
                  </button>
                )}
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
                        type="submit"
                        disabled={!canSaveAssignment || savingAssignmentId === session.id}
                      >
                        {savingAssignmentId === session.id ? "保存中…" : "保存"}
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
                {expanded && (
                  <div className="agent-work-detail">
                    <div className="agent-handoff-line">
                      <div><span>Intent</span><p>{session.intent.summary}</p></div>
                      <div><span>Outcome</span><p>{session.outcome?.summary || "作業中です。"}</p></div>
                      <div className={remaining.length ? "has-remaining" : ""}>
                        <span>残り</span>
                        <p>{remaining.length ? remaining.join(" / ") : "なし"}</p>
                      </div>
                    </div>
                    <div className="agent-session-identity-detail">
                      <span>Session</span>
                      <code title={`${session.client_kind}:${session.source_session_id || session.id}`}>
                        {session.client_kind}:{row.sessionIdentity}
                      </code>
                      <span>
                        {row.requestCount} prompts / {row.responseCount} responses
                      </span>
                    </div>
                    {((onOpenTheme && row.themes.length > 0) || row.tasks.length > 0) && (
                      <div className="agent-work-links" aria-label="関連先">
                        {row.unresolved && onOpenTheme && row.themes[0] && (
                          <button type="button" onClick={() => onOpenTheme(row.themes[0].id)}>
                            Themeで引き継ぎを確認
                          </button>
                        )}
                        {onOpenTheme && row.themes.map((theme) => (
                          <button type="button" key={theme.id} onClick={() => onOpenTheme?.(theme.id)}>
                            Theme: {theme.name}
                          </button>
                        ))}
                        {row.tasks.map((task) => (
                          <button type="button" key={task.id} onClick={() => openDrawer({ type: "task", entity: task as unknown as Record<string, unknown> })}>
                            Task: {task.title}
                          </button>
                        ))}
                      </div>
                    )}
                    {(row.receipts.length > 0 || row.activities.length > 0) && (
                      <div className="agent-work-evidence">
                        {row.receipts.map((receipt) => (
                          <div className="agent-work-receipt" key={receipt.id}>
                            <span>Work Receipt</span>
                            <p>{receipt.summary}</p>
                            {(receipt.external_references || []).map((reference) => (
                              <a key={`${reference.kind}:${reference.url}`} href={reference.url} target="_blank" rel="noreferrer">
                                {reference.display_label || EXTERNAL_REFERENCE_KIND_LABELS[reference.kind]}
                                <IconExternalLink size={12} aria-hidden="true" />
                              </a>
                            ))}
                          </div>
                        ))}
                        {row.activities.length > 0 && (
                          <div className="agent-work-activity">
                            <span>Activity {row.activities.length}</span>
                            <p>{row.activities.slice(0, 3).map((event) => event.summary || event.event_kind).filter(Boolean).join(" / ")}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
              })}
            </section>
          ))}
        </div>
      ) : (
        <div className="agent-work-empty">
          {carryoverOnly ? "引き継ぐAI作業はありません。" : "AI sessionはまだありません。"}
        </div>
      )}
    </section>
  );
}
