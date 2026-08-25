import { useState } from "react";
import {
  IconChevronDown,
  IconChevronRight,
  IconExternalLink,
} from "@tabler/icons-react";

import { AI_ICON } from "../../../pages/semanticIcons";
import type { OpenDrawer } from "../types";
import type { WorkspaceDomain } from "../domain-model/types";
import { EXTERNAL_REFERENCE_KIND_LABELS } from "../domain-model/labels";
import { buildAgentWorkProjection } from "../lib/agentSessionProjection";

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
  limit?: number;
  title?: string;
  onOpenTheme?(themeId: string): void;
  openDrawer: OpenDrawer;
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
  limit = 8,
  title = "AI work",
  onOpenTheme,
  openDrawer,
}: AgentWorkSummaryPanelProps) {
  const [expandedId, setExpandedId] = useState("");
  const rows = buildAgentWorkProjection(domain, { date, themeId, includeUnresolved, limit });
  const unresolvedCount = rows.filter((row) => row.unresolved).length;

  return (
    <section className="panel agent-work-panel">
      <div className="section-heading">
        <h2>
          {title}
          {unresolvedCount > 0 && <span className="agent-work-handoff-count">引き継ぎ {unresolvedCount}</span>}
        </h2>
        <span>{rows.length} session</span>
      </div>
      {rows.length ? (
        <div className="agent-work-list">
          {rows.map((row) => {
            const { session } = row;
            const expanded = expandedId === session.id;
            const timestamp = session.ended_at || session.started_at;
            const remaining = session.outcome?.remaining_work || [];
            return (
              <article className={`agent-work-row status-${session.status}`} key={session.id}>
                <button
                  type="button"
                  className="agent-work-summary"
                  aria-expanded={expanded}
                  onClick={() => setExpandedId(expanded ? "" : session.id)}
                >
                  <span className="agent-work-client" title={session.model_label || undefined}>
                    <AI_ICON size={15} aria-hidden="true" />
                    {session.client_label || CLIENT_LABELS[session.client_kind] || session.client_kind}
                  </span>
                  <span className="agent-work-main">
                    <strong>{session.outcome?.summary || session.intent.summary}</strong>
                    <span>
                      {[...row.themes.map((theme) => theme.name), ...row.repositories.map((repo) => repo.label)]
                        .filter(Boolean)
                        .join(" · ") || "未割当"}
                    </span>
                  </span>
                  <span className={`agent-session-status status-${session.status}`}>
                    {STATUS_LABELS[session.status] || session.status}
                  </span>
                  <time dateTime={timestamp}>{timeLabel(timestamp, row.date, date)}</time>
                  {expanded ? <IconChevronDown size={16} aria-hidden="true" /> : <IconChevronRight size={16} aria-hidden="true" />}
                </button>
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
                    {((onOpenTheme && row.themes.length > 0) || row.tasks.length > 0) && (
                      <div className="agent-work-links" aria-label="関連先">
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
        </div>
      ) : (
        <div className="agent-work-empty">AI sessionはまだありません。</div>
      )}
    </section>
  );
}
