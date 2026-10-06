import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  IconArrowLeft,
  IconArrowRight,
  IconCalendarWeek,
  IconClock,
  IconFileImport,
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
import {
  agentDateText,
  agentSessionInterval,
  buildAgentDayLayout,
  agentOutcomeDetails,
} from "../lib/activityTimelineLayout";
import type { BaseRecord, PageProps } from "../types";
import { Button } from "./common";
import { AgentWorkLogImportDialog } from "./AgentWorkLogImportDialog";
import { ProposalDetail } from "./AiProposalPanel";
import { workspaceApi } from "../../../services/workspaceApi";
import { SEMANTIC_ICONS } from "../../../pages/semanticIcons";
import "./AgentWorkTimeline.css";
import type {
  AgentLogSetup,
  AgentLogService,
  AgentLogProbe,
} from "../../../../../shared/agentLogSync";

export function AgentLogSyncPanel() {
  const desktop = workspaceApi.canSyncAgentLogs();
  const [setup, setSetup] = useState<AgentLogSetup | null>(null);
  const [service, setService] = useState<AgentLogService>("codex");
  const [sourcePath, setSourcePath] = useState("");
  const [probe, setProbe] = useState<AgentLogProbe | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [adoptResult, setAdoptResult] = useState("");
  const sourceSetup = useRef<HTMLDetailsElement>(null);
  const refresh = async () => {
    const next = await workspaceApi.agentLogSetup();
    setSetup(next);
    return next;
  };
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      try {
        await refresh();
      } catch {
        /* Preserve the original error and form input. */
      }
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!desktop) return;
    let live = true;
    void workspaceApi
      .agentLogSetup()
      .then((next) => {
        if (live) setSetup(next);
      })
      .catch((failure) => {
        if (live) setError(String(failure));
      });
    return () => {
      live = false;
    };
  }, [desktop]);
  useEffect(() => {
    if (!desktop || (!busy && !setup?.background && setup?.state !== "running")) return;
    const timer = setInterval(() => {
      void refresh().catch((failure) => setError(String(failure)));
    }, 1000);
    return () => clearInterval(timer);
  }, [desktop, busy, setup?.background, setup?.state]);
  const selectPath = (value: string) => {
    setSourcePath(value);
    setProbe(null);
    setConsent(false);
  };
  const candidates = setup?.candidates.filter((candidate) => candidate.service === service) || [];
  const selectedPath = sourcePath || candidates[0]?.path || "";
  const stamp = (value: string | null) =>
    value ? new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) + " JST" : "未確認";
  return (
    <details className="panel agent-log-sync">
      <summary>
        ログ同期{" "}
        <small>
          {setup?.state === "error"
            ? "要確認"
            : setup?.state === "running"
              ? "収集中"
              : setup?.sources.length
                ? `${setup.sources.length}か所`
                : "保存先を設定"}
        </small>
      </summary>
      {!desktop ? (
        <p>
          ログの収集・保存先の設定は PC の Tasken
          で行います。スマートフォンには取り込んだ記録が表示されます。
        </p>
      ) : (
        <>
          <p>
            PC
            に保存されたログの新規・変更を収集し、そのままActivityの履歴に入れます。対応待ちには並べません。
          </p>
          {setup && (
            <>
              <div className="agent-log-sync-actions">
                <Button
                  disabled={busy || setup.state === "running" || !setup.sources.length}
                  onClick={() => {
                    setSetup({
                      ...setup,
                      state: "running",
                      scanned: 0,
                      queued: 0,
                      unchanged: 0,
                      deferred: 0,
                    });
                    void act(() => workspaceApi.syncAgentLogs());
                  }}
                >
                  ログ同期
                </Button>
                {setup.state === "running" && (
                  <Button onClick={() => void act(() => workspaceApi.cancelAgentLogSync())}>
                    同期を停止
                  </Button>
                )}
                <label>
                  <input
                    type="checkbox"
                    checked={setup.background}
                    disabled={busy || !setup.sources.length}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      setSetup({ ...setup, background: enabled });
                      void act(() => workspaceApi.setAgentLogBackground(enabled));
                    }}
                  />
                  Tasken 起動中に5分ごとに同期
                </label>
              </div>
              <p role="status">
                {setup.state === "running"
                  ? "収集中"
                  : setup.state === "cancelled"
                    ? "停止しました。残りは次回に続きます。"
                    : "同期状況"}{" "}
                · 確認 {setup.scanned} · 新規・更新 {setup.queued} · 変更なし {setup.unchanged} ·
                保留 {setup.deferred}
              </p>
              {setup.pendingRecords > 0 && (
                <div className="agent-log-sync-pending" role="group" aria-label="採用待ちの記録">
                  <p>
                    以前の版で採用待ちのまま残った記録が {setup.pendingRecords}{" "}
                    件あります。内容は変えずに、まとめてActivityの履歴へ入れられます。
                  </p>
                  <Button
                    disabled={busy || setup.state === "running"}
                    onClick={() =>
                      void act(async () => {
                        setAdoptResult("");
                        const result = await workspaceApi.adoptPendingAgentLogRecords();
                        setAdoptResult(
                          result.failed
                            ? `${result.accepted}件を履歴へ入れました。${result.failed}件は入れられませんでした（${result.messages.join(" / ")}）。`
                            : `${result.accepted}件を履歴へ入れました。`,
                        );
                      })
                    }
                  >
                    まとめて履歴へ入れる
                  </Button>
                </div>
              )}
              {adoptResult && <p role="status">{adoptResult}</p>}
              {setup.sources.length ? (
                <ul className="agent-log-source-list">
                  {setup.sources.map((source) => (
                    <li key={source.id}>
                      <strong>{source.service === "codex" ? "Codex" : "Claude Code"}</strong>
                      <small>
                        {source.path.split(/[\\/]/).filter(Boolean).slice(-2).join(" / ")}
                      </small>
                      <span>
                        {source.message} · 最終確認 {stamp(source.lastScan)}
                      </span>
                      <details>
                        <summary>保存先の場所</summary>
                        <code>{source.path}</code>
                      </details>
                      <Button
                        disabled={busy || setup.state === "running"}
                        onClick={() => {
                          setService(source.service);
                          selectPath(source.path);
                          if (sourceSetup.current) sourceSetup.current.open = true;
                        }}
                      >
                        保存先を再確認
                      </Button>
                      <Button
                        disabled={busy || setup.state === "running"}
                        onClick={() => void act(() => workspaceApi.removeAgentLogSource(source.id))}
                      >
                        登録を解除
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>保存先はまだ登録されていません。</p>
              )}
              <details className="agent-log-source-setup" ref={sourceSetup}>
                <summary>保存先を追加・再確認</summary>
                <label>
                  サービス
                  <select
                    aria-label="ログ収集サービス"
                    value={service}
                    onChange={(event) => {
                      setService(event.target.value as AgentLogService);
                      selectPath("");
                    }}
                  >
                    <option value="codex">Codex</option>
                    <option value="claude_code">Claude Code</option>
                  </select>
                </label>
                <label>
                  保存先候補
                  <select
                    aria-label="ログ保存先候補"
                    value={
                      sourcePath && !candidates.some((c) => c.path === sourcePath)
                        ? "custom"
                        : selectedPath
                    }
                    onChange={(event) =>
                      selectPath(event.target.value === "custom" ? "" : event.target.value)
                    }
                  >
                    {candidates.map((candidate) => (
                      <option key={candidate.path} value={candidate.path}>
                        {candidate.label}
                      </option>
                    ))}
                    <option value="custom" disabled>
                      指定したフォルダー
                    </option>
                  </select>
                </label>
                <div className="agent-log-sync-actions">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const result =
                          await workspaceApi.chooseDirectory("AI ログの保存フォルダーを選択");
                        if (result.path) selectPath(result.path);
                      })
                    }
                  >
                    別の保存先を選ぶ
                  </Button>
                  <Button
                    disabled={busy || !selectedPath}
                    onClick={() =>
                      void act(async () => {
                        setProbe(await workspaceApi.probeAgentLogSource(service, selectedPath));
                        setConsent(false);
                      })
                    }
                  >
                    場所を確認
                  </Button>
                </div>
                <details>
                  <summary>場所の詳細・WSL / 別プロファイル</summary>
                  <label>
                    フォルダーの場所
                    <input
                      aria-label="ログ保存先の場所"
                      value={selectedPath}
                      onChange={(event) => selectPath(event.target.value)}
                    />
                  </label>
                  <p>
                    標準候補はこの PC の環境変数に基づきます。WSL や
                    portable、別のプロファイルは、その環境からアクセスできるログフォルダーを指定してください。WSL
                    を起動したり、ドライブ全体を探したりはしません。
                  </p>
                  <p>
                    Codex は CODEX_HOME / sessions（標準 ~/.codex/sessions）、Claude Code は
                    CLAUDE_CONFIG_DIR / projects（標準
                    ~/.claude/projects）。ほかのサービスはファイル取込を利用してください。
                  </p>
                </details>
                {probe && (
                  <div role="status">
                    <strong>
                      {probe.state === "ready"
                        ? `${probe.count}件のログ候補`
                        : probe.state === "empty"
                          ? "ログなし"
                          : probe.state === "missing"
                            ? "保存先なし"
                            : probe.state === "denied"
                              ? "アクセスできません"
                              : "確認できません"}
                    </strong>
                    <p>
                      {probe.message} · 更新 {stamp(probe.lastUpdated)}
                    </p>
                  </div>
                )}
                <p>
                  保存するのは時刻・サービス・Session ID
                  と、依頼・回答の短い抜粋（各500文字以内・秘匿処理済み）です。生ログの全文は保存しません。提案と採用した記録は既存の共有同期設定に従います。
                </p>
                <pre className="agent-log-destination">{setup.destination}</pre>
                <label>
                  <input
                    type="checkbox"
                    checked={consent}
                    disabled={!probe || !["ready", "empty"].includes(probe.state)}
                    onChange={(event) => setConsent(event.target.checked)}
                  />
                  この保存内容と同期先を確認しました
                </label>
                <Button
                  disabled={busy || !consent || !probe || !["ready", "empty"].includes(probe.state)}
                  onClick={() =>
                    void act(async () => {
                      await workspaceApi.configureAgentLogSource({
                        service,
                        path: selectedPath,
                        consent,
                        destination: setup.destination,
                      });
                      setConsent(false);
                      setProbe(null);
                    })
                  }
                >
                  この場所を登録
                </Button>
              </details>
              {setup.errors.length > 0 && (
                <ul role="alert">
                  {setup.errors.map((issue, index) => (
                    <li key={index}>{issue}</li>
                  ))}
                </ul>
              )}
            </>
          )}
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </details>
  );
}

const CLIENTS = {
  codex: "Codex",
  claude_code: "Claude Code",
  github_copilot: "Copilot",
  opencode: "OpenCode",
  deepseek_harness: "DeepSeek",
  cursor: "Cursor",
  other: "AI client",
};
const AiGeneratedIcon = SEMANTIC_ICONS.aiGenerated;
function dateText(value: Date) {
  return agentDateText(value);
}
function offsetDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateText(date);
}
function time(value: string) {
  return new Date(value).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  });
}
function intervalText(session: AgentSession, now: string) {
  const interval = agentSessionInterval(session, now);
  const stamp = (value: string) => `${dateText(new Date(value))} ${time(value)}`;
  return `${stamp(session.started_at)} ～ ${interval.endLabel === "終了未確認" ? "終了未確認" : `${stamp(interval.end)} (${interval.endLabel})`}`;
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
        ? IconClock
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
  props: PageProps & {
    date: string;
    onDateChange(date: string): void;
    importing?: boolean;
    onImportingChange?(value: boolean): void;
  },
) {
  const { domain, date, onDateChange } = props;
  const [mode, setMode] = useState<"day" | "week">("week");
  const [client, setClient] = useState("");
  const [repository, setRepository] = useState("");
  const [selected, setSelected] = useState("");
  const [localImporting, setLocalImporting] = useState(false);
  const importing = props.importing ?? localImporting;
  const setImporting = props.onImportingChange ?? setLocalImporting;
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
            ...domain.agent_sessions.filter(
              (session) => !pending.some((entry) => entry.session.id === session.id),
            ),
            ...pending.map((entry) => entry.session),
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
  const monday = offsetDate(date, -((new Date(`${date}T12:00:00+09:00`).getUTCDay() + 6) % 7));
  const days =
    effectiveMode === "week" ? Array.from({ length: 7 }, (_, i) => offsetDate(monday, i)) : [date];
  const filtered = rows.filter(
    (row) =>
      (!client || row.session.client_kind === client) &&
      (!repository || row.repositories.some((repo) => repo.id === repository)),
  );
  const now = new Date().toISOString();
  const dayLayouts = days.map((day) => buildAgentDayLayout(filtered, day, now));
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
  function changeDate(next: string) {
    closeDetail();
    onDateChange(next);
  }
  function renderDetail(row: AgentWorkProjectionRow) {
    const session = row.session;
    const outcomeDetails = agentOutcomeDetails(session.outcome);
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
          {intervalText(session, now)}
          <small>JST · 経過区間（待機・背景処理を含む）</small>
        </p>
        <dl>
          <dt>実働時間 / 費用</dt>
          <dd>未収録</dd>
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
        {outcomeDetails.length > 0 && (
          <details>
            <summary>成果の詳細</summary>
            <dl>
              {outcomeDetails.map((section) => (
                <div key={section.label}>
                  <dt>{section.label}</dt>
                  <dd>{section.values.join("\n")}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
        {(row.tasks.length > 0 || row.receipts.length > 0 || row.themes.length > 0) && (
          <details>
            <summary>関連タスクと報告</summary>
            {row.themes.length > 0 && <p>{row.themes.map((theme) => theme.name).join(" / ")}</p>}
            {row.tasks.map((task) => (
              <Button
                key={task.id}
                onClick={() => {
                  closeDetail();
                  props.openDrawer({ type: "task", entity: task as unknown as BaseRecord });
                }}
              >
                Task: {task.title}
              </Button>
            ))}
            {row.receipts.map((receipt) => (
              <div key={receipt.id}>
                <p>{receipt.summary}</p>
                {(receipt.external_references || []).map((reference) => (
                  <a
                    key={`${reference.kind}:${reference.url}`}
                    href={reference.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {reference.display_label}
                  </a>
                ))}
              </div>
            ))}
          </details>
        )}
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
          <dl>
            <dt>Client</dt>
            <dd>{session.client_label || CLIENTS[session.client_kind]}</dd>
            {session.agent_label && (
              <>
                <dt>Agent</dt>
                <dd>{session.agent_label}</dd>
              </>
            )}
            {session.model_label && (
              <>
                <dt>Model</dt>
                <dd>{session.model_label}</dd>
              </>
            )}
          </dl>
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
    <section
      ref={root}
      className={`panel agent-log-panel${narrow ? " is-narrow" : ""}`}
      aria-label="AI作業ログ"
    >
      <div className="agent-log-toolbar">
        <h2>
          <IconCalendarWeek size={20} aria-hidden="true" />
          AI作業ログ
        </h2>
        <div className="agent-log-date-controls">
          <Button
            aria-label="前の期間"
            onClick={() => changeDate(offsetDate(date, effectiveMode === "week" ? -7 : -1))}
          >
            <IconArrowLeft size={17} aria-hidden="true" />
          </Button>
          <label>
            <span className="sr-only">表示日</span>
            <input
              type="date"
              value={date}
              onChange={(event) => event.target.value && changeDate(event.target.value)}
            />
          </label>
          <Button
            aria-label="次の期間"
            onClick={() => changeDate(offsetDate(date, effectiveMode === "week" ? 7 : 1))}
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
        <small>{visibleIds.size} Session · JST · 経過区間</small>
      </div>
      <div
        className="agent-log-body"
        style={narrow ? { gridTemplateColumns: "minmax(0,1fr)" } : undefined}
      >
        <div className="agent-log-calendar">
          {narrow ? (
            <ol className="agent-log-day-list" aria-label={`${date}のAI作業`}>
              {dayLayouts[0].map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="agent-log-list-entry"
                    onClick={() => setSelected(entry.id)}
                  >
                    <span>
                      <StatusIcon session={entry.row.session} />
                      {CLIENTS[entry.row.session.client_kind]} ·{" "}
                      {STATUSES[entry.row.session.status]}
                    </span>
                    <strong>{entry.row.session.intent.summary}</strong>
                    <small className="agent-log-list-result">
                      成果: {entry.row.result || "未記録"}
                    </small>
                    <span>
                      {entry.row.repositories.map((repo) => repo.label).join(" / ") ||
                        "Repository未関連"}
                    </span>
                    <small>{intervalText(entry.row.session, now)}</small>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <>
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
                      changeDate(day);
                      setMode("day");
                    }}
                  >
                    <span>
                      {new Date(`${day}T12:00:00+09:00`).toLocaleDateString("ja-JP", {
                        weekday: "short",
                        timeZone: "Asia/Tokyo",
                      })}
                    </span>
                    <strong>{Number(day.slice(-2))}</strong>
                    <small>{dayLayouts[days.indexOf(day)].length}件</small>
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
                            title={`${entry.row.repositories.map((repo) => repo.label).join(" / ") || "Repository未関連"}\n${session.intent.summary}\n${intervalText(session, now)} · ${STATUSES[session.status]}`}
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
                              <span className="agent-log-client">
                                {CLIENTS[session.client_kind]}
                              </span>
                            </span>
                            <strong>{session.intent.summary}</strong>
                            {entry.height >= 72 && (
                              <small>
                                {entry.row.repositories.map((repo) => repo.label).join(" / ") ||
                                  "Repository未関連"}
                              </small>
                            )}
                            {entry.height >= 72 && <small>{time(session.started_at)}</small>}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
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
                <AiGeneratedIcon size={30} aria-hidden="true" />
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
