import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  IconArrowLeft,
  IconArrowRight,
  IconCalendarWeek,
  IconClock,
  IconFileImport,
  IconRobot,
  IconX,
  IconCopy,
  IconPlayerPause,
  IconCircleCheck,
  IconQuestionMark,
} from "@tabler/icons-react";
import {
  buildAgentWorkProjection,
  type AgentWorkProjectionRow,
} from "../domain-model/agentSessionProjection";
import type { AgentSession } from "../domain-model/types";
import { buildActivityTimelineLayout } from "../lib/activityTimelineLayout";
import type { BaseRecord, PageProps } from "../types";
import { Button } from "./common";
import { AgentWorkLogImportDialog } from "./AgentWorkLogImportDialog";
import { ProposalDetail } from "./AiProposalPanel";
import { workspaceApi } from "../../../services/workspaceApi";
import "./AgentWorkTimeline.css";

const CLIENTS = {
  codex: "Codex",
  claude_code: "Claude Code",
  github_copilot: "Copilot",
  opencode: "OpenCode",
  deepseek_harness: "DeepSeek",
  cursor: "Cursor",
  other: "AI client",
};
function dateText(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
function offsetDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return dateText(date);
}
function time(value: string) {
  return new Date(value).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}
function pendingRecords(proposals: PageProps["domain"]["ai_proposals"]) {
  return proposals.flatMap((proposal) => {
    if (proposal.status !== "pending" || proposal.payload_type !== "agent_sessions") return [];
    let payload = proposal.payload;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        return [];
      }
    }
    const entries =
      (
        payload as {
          agent_sessions?: Array<{
            session: AgentSession;
            references?: PageProps["domain"]["references"];
          }>;
        }
      )?.agent_sessions || [];
    return entries.map((entry) => ({ ...entry, proposal }));
  });
}
function StatusIcon({ session }: { session: AgentSession }) {
  const Icon =
    session.status === "completed"
      ? IconCircleCheck
      : session.status === "active"
        ? IconRobot
        : session.status === "unknown"
          ? IconQuestionMark
          : IconPlayerPause;
  return <Icon size={16} aria-hidden="true" />;
}
const STATUSES: Record<string, string> = {
  active: "進行中",
  completed: "終了",
  blocked: "停止",
  abandoned: "中断",
  interrupted: "中断",
  unknown: "終了未確認",
};

export function AgentWorkTimeline(
  props: PageProps & { date: string; onDateChange(date: string): void },
) {
  const { domain, date, onDateChange } = props;
  const [mode, setMode] = useState<"day" | "week">("week");
  const [client, setClient] = useState("");
  const [repository, setRepository] = useState("");
  const [selected, setSelected] = useState("");
  const [importing, setImporting] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const root = useRef<HTMLElement>(null);
  const detailDialog = useRef<HTMLDialogElement>(null);
  const pending = useMemo(() => pendingRecords(domain.ai_proposals), [domain.ai_proposals]);
  const rows = useMemo(
    () =>
      buildAgentWorkProjection(
        {
          ...domain,
          agent_sessions: [
            ...domain.agent_sessions,
            ...pending
              .filter(
                (entry) =>
                  !domain.agent_sessions.some((session) => session.id === entry.session.id),
              )
              .map((entry) => entry.session),
          ],
          references: [...domain.references, ...pending.flatMap((entry) => entry.references || [])],
        },
        { limit: Infinity },
      ),
    [domain, pending],
  );
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 820));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const effectiveMode = narrow ? "day" : mode;
  const monday = offsetDate(date, -((new Date(`${date}T12:00:00`).getDay() + 6) % 7));
  const days =
    effectiveMode === "week" ? Array.from({ length: 7 }, (_, i) => offsetDate(monday, i)) : [date];
  const filtered = rows.filter(
    (row) =>
      (!client || row.session.client_kind === client) &&
      (!repository || row.repositories.some((repo) => repo.id === repository)),
  );
  const dayLayouts = days.map((day) =>
    buildActivityTimelineLayout(
      filtered.map((row) => ({
        id: row.session.id,
        start_at: row.session.started_at,
        end_at: row.session.ended_at || new Date().toISOString(),
        row,
      })),
      {
        date: day,
        pixelsPerHour: 52,
        pointHeight: 44,
        dayStart: new Date(`${day}T00:00:00`).getTime(),
      },
    ),
  );
  const visibleIds = new Set(dayLayouts.flatMap((layout) => layout.map((entry) => entry.id)));
  const selectedRow = rows.find((row) => row.session.id === selected);
  const selectedProposal = pending.find((entry) => entry.session.id === selected)?.proposal as
    BaseRecord | undefined;
  useEffect(() => {
    const dialog = detailDialog.current;
    if (narrow && selected && dialog && !dialog.open) dialog.showModal();
  }, [narrow, selected, selectedRow?.session.id]);
  const minHour = Math.min(
    8,
    ...dayLayouts.flatMap((layout) => layout.map((entry) => Math.floor(entry.start_minutes / 60))),
  );
  const maxHour = Math.max(
    19,
    ...dayLayouts.flatMap((layout) => layout.map((entry) => Math.ceil(entry.end_minutes / 60))),
  );
  function closeDetail() {
    detailDialog.current?.close();
    setSelected("");
  }
  function renderDetail(row: AgentWorkProjectionRow) {
    const session = row.session;
    return (
      <>
        <header>
          <span>
            <StatusIcon session={session} />
            {STATUSES[session.status]}
            {selectedProposal ? " · 採用待ち" : ""}
          </span>
          <Button aria-label="詳細を閉じる" onClick={closeDetail}>
            <IconX size={18} aria-hidden="true" />
          </Button>
        </header>
        <h3>{CLIENTS[session.client_kind] || session.client_kind}</h3>
        <p className="agent-log-interval">
          <IconClock size={16} aria-hidden="true" />
          {time(session.started_at)} ～ {session.ended_at ? time(session.ended_at) : "現在"}
          <small>{session.observation ? "取込履歴の観測区間" : "開始〜終了の区間"}</small>
        </p>
        <dl>
          <dt>依頼</dt>
          <dd>{session.intent.summary}</dd>
          <dt>成果</dt>
          <dd>{session.outcome?.summary || "未記録"}</dd>
          <dt>残件</dt>
          <dd>
            {session.outcome?.remaining_work.length
              ? session.outcome.remaining_work.join("\n")
              : "未記録"}
          </dd>
          {session.outcome?.verification.length ? (
            <>
              <dt>確認</dt>
              <dd>{session.outcome.verification.join("\n")}</dd>
            </>
          ) : null}
          {row.repositories.length ? (
            <>
              <dt>Repository</dt>
              <dd>{row.repositories.map((repo) => repo.label).join(" / ")}</dd>
            </>
          ) : null}
        </dl>
        <details>
          <summary>元Sessionと収録範囲</summary>
          <code>{session.source_session_id || session.id}</code>
          <Button
            aria-label="元Session IDをコピー"
            onClick={() =>
              void workspaceApi
                .copyText(session.source_session_id || session.id)
                .then(() => props.setToast("Session IDをコピーしました。", "success"))
                .catch(() =>
                  props.setToast("コピーできませんでした。再試行してください。", "danger"),
                )
            }
          >
            <IconCopy size={16} aria-hidden="true" />
          </Button>
          <p>
            {session.observation
              ? `${session.observation.adapter} · client ${session.observation.client_version} · ${session.observation.coverage === "partial" ? "一部の履歴" : "選択範囲全体"}`
              : "Sessionに記録された内容"}
          </p>
        </details>
        {session.request_events?.length || session.response_checkpoints?.length ? (
          <details>
            <summary>依頼と回答の経過</summary>
            <ol>
              {[
                ...(session.request_events || []).map((entry) => ({ ...entry, kind: "依頼" })),
                ...(session.response_checkpoints || []).map((entry) => ({
                  ...entry,
                  kind: "回答",
                })),
              ]
                .sort((a, b) => a.observed_at.localeCompare(b.observed_at))
                .map((entry, index) => (
                  <li key={index}>
                    <time>{time(entry.observed_at)}</time>
                    <strong>{entry.kind}</strong>
                    <p>{entry.text}</p>
                  </li>
                ))}
            </ol>
          </details>
        ) : null}
        {selectedProposal && (
          <ProposalDetail
            {...props}
            proposal={selectedProposal}
            onDecided={() => setSelected("")}
          />
        )}
      </>
    );
  }
  return (
    <section ref={root} className="panel agent-log-panel" aria-label="AI作業ログ">
      <div className="agent-log-toolbar">
        <h2>
          <IconCalendarWeek size={20} aria-hidden="true" />
          AI作業ログ
        </h2>
        <div className="agent-log-date-controls">
          <Button
            aria-label="前の期間"
            onClick={() => onDateChange(offsetDate(date, effectiveMode === "week" ? -7 : -1))}
          >
            <IconArrowLeft size={17} aria-hidden="true" />
          </Button>
          <label>
            <span className="sr-only">表示日</span>
            <input
              type="date"
              value={date}
              onChange={(event) => event.target.value && onDateChange(event.target.value)}
            />
          </label>
          <Button
            aria-label="次の期間"
            onClick={() => onDateChange(offsetDate(date, effectiveMode === "week" ? 7 : 1))}
          >
            <IconArrowRight size={17} aria-hidden="true" />
          </Button>
        </div>
        {!narrow && (
          <div className="agent-log-mode" aria-label="表示期間">
            <Button aria-pressed={mode === "day"} onClick={() => setMode("day")}>
              日
            </Button>
            <Button aria-pressed={mode === "week"} onClick={() => setMode("week")}>
              週
            </Button>
          </div>
        )}
        <Button
          aria-label="AI作業ログを取り込む"
          title="AI作業ログを取り込む"
          onClick={() => setImporting(true)}
        >
          <IconFileImport size={18} aria-hidden="true" />
          <span>取込</span>
        </Button>
      </div>
      <div className="agent-log-filters">
        <label>
          <span className="sr-only">Clientで絞る</span>
          <select
            aria-label="Clientで絞る"
            value={client}
            onChange={(event) => {
              setClient(event.target.value);
              setSelected("");
            }}
          >
            <option value="">すべてのClient</option>
            {Object.entries(CLIENTS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Repositoryで絞る</span>
          <select
            aria-label="Repositoryで絞る"
            value={repository}
            onChange={(event) => {
              setRepository(event.target.value);
              setSelected("");
            }}
          >
            <option value="">すべてのRepository</option>
            {domain.repository_contexts.map((repo) => (
              <option key={repo.id} value={repo.id}>
                {repo.label}
              </option>
            ))}
          </select>
        </label>
        <small>{visibleIds.size}区間 · 開始から終了／最終観測まで</small>
      </div>
      <div
        className="agent-log-body"
        style={narrow ? { gridTemplateColumns: "minmax(0,1fr)" } : undefined}
      >
        <div className="agent-log-calendar">
          <div
            className="agent-log-day-heads"
            style={{ gridTemplateColumns: `40px repeat(${days.length},minmax(0,1fr))` }}
          >
            <span aria-hidden="true" />
            {days.map((day) => (
              <button
                key={day}
                type="button"
                aria-label={`${day}の日表示`}
                onClick={() => {
                  onDateChange(day);
                  setMode("day");
                }}
              >
                <span>
                  {new Date(`${day}T12:00:00`).toLocaleDateString("ja-JP", { weekday: "short" })}
                </span>
                <strong>{new Date(`${day}T12:00:00`).getDate()}</strong>
              </button>
            ))}
          </div>
          <div className="agent-log-grid-scroll">
            <div
              className="agent-log-grid"
              style={{
                gridTemplateColumns: `40px repeat(${days.length},minmax(0,1fr))`,
                height: (maxHour - minHour) * 52,
              }}
            >
              <div className="agent-log-hours">
                {Array.from({ length: maxHour - minHour + 1 }, (_, i) => (
                  <time key={i} style={{ top: i * 52 }}>
                    {String(i + minHour).padStart(2, "0")}
                  </time>
                ))}
              </div>
              {dayLayouts.map((layout, index) => (
                <div key={days[index]} className="agent-log-day">
                  {layout.map((entry) => {
                    const session = entry.row.session;
                    const color = (Object.keys(CLIENTS).indexOf(session.client_kind) % 6) + 1;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        className={`agent-log-block${selected === entry.id ? " is-selected" : ""}${session.status === "active" ? " is-live" : ""}`}
                        aria-pressed={selected === entry.id}
                        aria-label={`${CLIENTS[session.client_kind]} ${time(session.started_at)} ${session.intent.summary} ${STATUSES[session.status]}`}
                        title={`${session.intent.summary}\n${time(session.started_at)} ～ ${session.ended_at ? time(session.ended_at) : "現在"} · ${STATUSES[session.status]}`}
                        onClick={() => setSelected(entry.id)}
                        style={
                          {
                            top: entry.top - minHour * 52,
                            height: entry.height,
                            left: `calc(${(entry.lane / entry.lane_count) * 100}% + 3px)`,
                            width: `calc(${100 / entry.lane_count}% - 6px)`,
                            "--agent-log-color": `var(--color-chart-${color})`,
                          } as CSSProperties
                        }
                      >
                        <span>
                          <StatusIcon session={session} />
                          {CLIENTS[session.client_kind]}
                        </span>
                        <strong>{session.intent.summary}</strong>
                        {entry.height >= 72 && <small>{time(session.started_at)}</small>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          {!visibleIds.size && (
            <p className="agent-log-empty">
              この期間のAI作業はありません。
              <Button onClick={() => setImporting(true)}>ログを取り込む</Button>
            </p>
          )}
        </div>
        {!narrow && (
          <aside className="agent-log-detail" aria-label="選択Sessionの詳細">
            {selectedRow ? (
              renderDetail(selectedRow)
            ) : (
              <div className="agent-log-detail-empty">
                <IconRobot size={30} aria-hidden="true" />
                <p>区間を選ぶと依頼と成果を確認できます。</p>
              </div>
            )}
          </aside>
        )}
      </div>
      {narrow && selectedRow && (
        <dialog
          ref={detailDialog}
          className="agent-log-detail agent-log-detail-dialog"
          onCancel={closeDetail}
          aria-label="選択Sessionの詳細"
        >
          {renderDetail(selectedRow)}
        </dialog>
      )}
      {importing && (
        <AgentWorkLogImportDialog
          domain={domain}
          setToast={props.setToast}
          close={() => setImporting(false)}
          onQueued={(id, startedAt) => {
            setSelected(id);
            onDateChange(dateText(new Date(startedAt)));
          }}
        />
      )}
    </section>
  );
}
