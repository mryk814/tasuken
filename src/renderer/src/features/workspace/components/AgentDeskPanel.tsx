import { useCallback, useMemo, useState } from "react";

import {
  buildAttentionQueue,
  deriveAgentWorkState,
  taskWorkEntry,
  type AttentionItem,
} from "../../../../../shared/contracts/task/public.ts";
import type { PageProps } from "../types";
import { Button } from "./common";

/** 異なる層のrow（SQLite row / Rendererの型付きTask / Entity）を同じ形で扱う。 */
type Row = { id: string; [key: string]: unknown };

type TaskWorkStateRow = {
  taskId: string;
  title: string;
  executorLabel: string;
  state: string;
  lastReportAt: string | null;
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function list(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function formatAt(value: string | null): string {
  if (!value) return "時刻不明";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "時刻不明";
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * Agent Desk（#599）。任せた仕事の進みと待ちを4つの見出しで一覧し、
 * 質問への回答と成果の確認をこの画面で一往復させる。
 *
 * 正本は既存のTask / Proposal / Work Receipt。この画面は導出したread modelを表示し、
 * 操作は既存のApplication Commandへ渡す。**独自の状態管理を持たない。**
 */
export function AgentDeskPanel({ data, domain, executeCommand, setToast, openDrawer }: PageProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyChoice, setReplyChoice] = useState("");
  const [replyNote, setReplyNote] = useState("");
  const [completeTask, setCompleteTask] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const tasks = domain.tasks as unknown as Row[];
  const proposals = domain.ai_proposals as unknown as Row[];
  const receipts = data.work_receipts as unknown as Row[];

  const attention = useMemo(
    () => buildAttentionQueue({ tasks, proposals, receipts, themes: data.themes as unknown[] }),
    // domain/dataは保存のたびに差し替わる。内容が同じ間は再計算しない。
    [tasks, proposals, receipts, data.themes],
  );

  const workStates = useMemo(() => {
    const rows: Array<{ row: TaskWorkStateRow; reports: ReturnType<typeof deriveAgentWorkState> }> =
      [];
    for (const task of tasks) {
      const state = deriveAgentWorkState({ task, proposals, receipts });
      if (!state) continue;
      const currentReports = state.reports.filter((report) => report.isCurrentAttempt);
      const latest = currentReports.at(-1) || null;
      rows.push({
        row: {
          taskId: state.taskId,
          title: str(task.title) || state.taskId,
          executorLabel: state.delegate.lastExecutorLabel || "AI",
          state: state.state,
          lastReportAt: latest?.reportedAt || latest?.receivedAt || null,
        },
        reports: state,
      });
    }
    return rows;
  }, [tasks, proposals, receipts]);

  const working = workStates.filter((entry) => entry.row.state === "working");
  const startWaiting = workStates.filter((entry) => entry.row.state === "start_waiting");
  const recently = useMemo(
    () =>
      workStates
        .flatMap((entry) =>
          (entry.reports?.reports || [])
            .filter(
              (report) => report.proposalStatus === "accepted" && report.action !== "human_reply",
            )
            .map((report) => ({
              taskId: entry.row.taskId,
              title: entry.row.title,
              executorLabel: report.executorLabel,
              summary: report.summary,
              at: report.reportedAt || report.receivedAt,
              completed: entry.row.state === "accepted_completed",
            })),
        )
        .sort((a, b) => (b.at || "").localeCompare(a.at || ""))
        .slice(0, 8),
    [workStates],
  );

  const selected = attention.find((item) => item.attentionId === selectedId) || null;
  const selectedProposal = selected
    ? proposals.find((proposal) => String(proposal.id) === selected.sourceId) || null
    : null;
  const selectedEntry = selectedProposal ? taskWorkEntry(selectedProposal) : null;
  const selectedTask = selected?.taskId
    ? tasks.find((task) => String(task.id) === selected.taskId) || null
    : null;
  const choices = list(selectedEntry?.needed_input);

  const openTask = useCallback(
    (taskId: string | null) => {
      if (!taskId) return;
      const task = domain.tasks.find((entry) => entry.id === taskId);
      if (!task) return;
      openDrawer({
        type: "task",
        mode: "edit",
        entity: task as unknown as Record<string, unknown>,
      });
    },
    [domain.tasks, openDrawer],
  );

  const select = useCallback((item: AttentionItem) => {
    setSelectedId(item.attentionId);
    setReplyChoice("");
    setReplyNote("");
    setCompleteTask(false);
    setReviewNote("");
  }, []);

  async function sendReply(item: AttentionItem) {
    if (busy || !item.taskId) return;
    const body = replyNote.trim() || replyChoice;
    if (!body) {
      setToast("回答を入力してください。", "warning");
      return;
    }
    if (!item.requestId) {
      setToast("この質問のIDがありません。画面を再読み込みしてください。", "danger");
      return;
    }
    const task = domain.tasks.find((entry) => entry.id === item.taskId);
    if (!task) return;
    setBusy(true);
    try {
      await executeCommand({
        commandId: `${item.attentionId}:reply`,
        name: "ReplyToAgentRequest",
        payload: {
          taskId: item.taskId,
          requestId: item.requestId,
          body,
          ...(replyChoice ? { choiceId: replyChoice } : {}),
        },
        actor: { kind: "user" },
        source: "main_ui",
        expectedVersions: [
          { type: "task", id: item.taskId, version: Number((task as unknown as Row).version || 0) },
        ],
        issuedAt: new Date().toISOString(),
      } as never);
      setToast("回答を送りました。agentの再開を待ちます。", "success");
      setSelectedId(null);
      setReplyNote("");
      setReplyChoice("");
    } catch (error) {
      setToast(
        `回答を送れませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    } finally {
      setBusy(false);
    }
  }

  async function acceptReport(item: AttentionItem, withCompletion: boolean) {
    if (busy || !item.taskId) return;
    const task = domain.tasks.find((entry) => entry.id === item.taskId);
    const proposal = proposals.find((entry) => String(entry.id) === item.sourceId);
    if (!task || !proposal) return;
    setBusy(true);
    try {
      const receipt = await executeCommand({
        commandId: `${proposal.id as string}:accept`,
        name: "ApplyTaskWorkProposal",
        payload: { proposalId: proposal.id as string, decision: "accept" },
        actor: { kind: "user" },
        source: "main_ui",
        expectedVersions: [
          { type: "task", id: item.taskId, version: Number((task as unknown as Row).version || 0) },
          {
            type: "ai_proposal",
            id: proposal.id as string,
            version: Number(proposal.version || 0),
          },
        ],
        issuedAt: new Date().toISOString(),
      } as never);
      if (!withCompletion) {
        setToast("報告を採用しました。Taskは継続します。", "success");
        setSelectedId(null);
        return;
      }
      const accepted = receipt.changes.find(
        (entry) => entry.type === "task" && entry.entity.id === item.taskId,
      );
      const nextVersion = Number(accepted?.entity.version || (task as unknown as Row).version || 0);
      await executeCommand({
        commandId: `${proposal.id as string}:accept:complete`,
        name: "AcceptTaskWork",
        payload: { taskId: item.taskId, receiptId: proposal.id as string, completeTask: true },
        actor: { kind: "user" },
        source: "main_ui",
        expectedVersions: [{ type: "task", id: item.taskId, version: nextVersion }],
        issuedAt: new Date().toISOString(),
      } as never);
      setToast("報告を採用し、Taskを完了しました。", "success");
      setSelectedId(null);
    } catch (error) {
      // 採用と完了は二つのCommand。前半だけ成功した場合を全体の失敗にしない。
      setToast(
        `報告を採用できませんでした。${error instanceof Error ? error.message : String(error)} 既に採用済みの場合は、Task完了だけを再試行できます。`,
        "danger",
      );
    } finally {
      setBusy(false);
    }
  }

  async function returnReport(item: AttentionItem) {
    if (busy || !item.taskId) return;
    const note = reviewNote.trim();
    if (!note) {
      setToast("修正してほしい内容を入力してください。", "warning");
      return;
    }
    const task = domain.tasks.find((entry) => entry.id === item.taskId);
    if (!task) return;
    setBusy(true);
    try {
      await executeCommand({
        commandId: `${item.attentionId}:return`,
        name: "ReturnTaskWork",
        payload: { taskId: item.taskId, receiptId: item.sourceId, reviewNote: note },
        actor: { kind: "user" },
        source: "main_ui",
        expectedVersions: [
          { type: "task", id: item.taskId, version: Number((task as unknown as Row).version || 0) },
        ],
        issuedAt: new Date().toISOString(),
      } as never);
      setToast("修正を依頼しました。Taskは継続します。", "success");
      setSelectedId(null);
      setReviewNote("");
    } catch (error) {
      setToast(
        `修正を依頼できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    } finally {
      setBusy(false);
    }
  }

  async function rejectProposal(item: AttentionItem) {
    if (busy) return;
    const proposal = proposals.find((entry) => String(entry.id) === item.sourceId);
    if (!proposal) return;
    setBusy(true);
    try {
      await executeCommand({
        commandId: `${proposal.id as string}:reject`,
        name: "ApplyTaskWorkProposal",
        payload: { proposalId: proposal.id as string, decision: "reject" },
        actor: { kind: "user" },
        source: "main_ui",
        expectedVersions: [
          {
            type: "ai_proposal",
            id: proposal.id as string,
            version: Number(proposal.version || 0),
          },
        ],
        issuedAt: new Date().toISOString(),
      } as never);
      setToast("この変更案を却下しました。", "success");
      setSelectedId(null);
    } catch (error) {
      setToast(
        `却下できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="agent-desk">
      <div className="agent-desk-layout">
        <div className="agent-desk-list">
          <section className="panel agent-desk-section">
            <div className="section-heading">
              <h2>対応待ち</h2>
              <span className="agent-desk-count">{attention.length}</span>
            </div>
            {attention.length === 0 ? (
              <p className="agent-desk-empty">対応待ちはありません。</p>
            ) : (
              <ul className="agent-desk-rows">
                {attention.map((item) => (
                  <li
                    key={item.attentionId}
                    className={
                      item.attentionId === selectedId
                        ? "agent-desk-row is-selected"
                        : "agent-desk-row"
                    }
                  >
                    <button type="button" className="agent-desk-open" onClick={() => select(item)}>
                      <span className="agent-desk-headline">{item.headline || item.summary}</span>
                      <span className="agent-desk-meta">
                        <span className="agent-desk-actor">{item.agentLabel || "AI"}</span>
                        <span className="agent-desk-path">
                          {item.taskTitle || "Taskなしの提案"}
                        </span>
                        <span className={`agent-desk-kind is-${item.kind}`}>
                          {item.kind === "answer_request"
                            ? "回答待ち"
                            : item.kind === "decision_request"
                              ? "判断待ち"
                              : item.kind === "review_report"
                                ? "成果確認"
                                : "変更案"}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel agent-desk-section">
            <div className="section-heading">
              <h2>作業中</h2>
              <span className="agent-desk-count">{working.length}</span>
            </div>
            {working.length === 0 ? (
              <p className="agent-desk-empty">作業中の仕事はありません。</p>
            ) : (
              <ul className="agent-desk-rows">
                {working.map((entry) => (
                  <li key={entry.row.taskId} className="agent-desk-row">
                    <button
                      type="button"
                      className="agent-desk-open"
                      onClick={() => openTask(entry.row.taskId)}
                    >
                      <span className="agent-desk-headline">{entry.row.title}</span>
                      <span className="agent-desk-meta">
                        <span className="agent-desk-actor">{entry.row.executorLabel}</span>
                        <span>
                          {entry.row.lastReportAt
                            ? `最終報告 ${formatAt(entry.row.lastReportAt)}`
                            : "報告はまだありません"}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel agent-desk-section">
            <div className="section-heading">
              <h2>開始待ち</h2>
              <span className="agent-desk-count">{startWaiting.length}</span>
            </div>
            {startWaiting.length === 0 ? (
              <p className="agent-desk-empty">開始待ちはありません。</p>
            ) : (
              <ul className="agent-desk-rows">
                {startWaiting.map((entry) => (
                  <li key={entry.row.taskId} className="agent-desk-row">
                    <button
                      type="button"
                      className="agent-desk-open"
                      onClick={() => openTask(entry.row.taskId)}
                    >
                      <span className="agent-desk-headline">{entry.row.title}</span>
                      <span className="agent-desk-meta">
                        <span className="agent-desk-actor">{entry.row.executorLabel}</span>
                        {/* 開始は未観測。取得済みとは表示しない。 */}
                        <span>開始は未確認</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel agent-desk-section">
            <div className="section-heading">
              <h2>最近の結果</h2>
              <button
                type="button"
                className="text-button compact"
                onClick={() => setHistoryOpen((value) => !value)}
                aria-expanded={historyOpen}
              >
                {historyOpen ? "畳む" : `${recently.length}件`}
              </button>
            </div>
            {historyOpen ? (
              recently.length === 0 ? (
                <p className="agent-desk-empty">まだ結果はありません。</p>
              ) : (
                <ul className="agent-desk-rows">
                  {recently.map((entry, index) => (
                    <li key={`${entry.taskId}:${entry.at}:${index}`} className="agent-desk-row">
                      <button
                        type="button"
                        className="agent-desk-open"
                        onClick={() => openTask(entry.taskId)}
                      >
                        <span className="agent-desk-headline">{entry.summary || entry.title}</span>
                        <span className="agent-desk-meta">
                          <span className="agent-desk-actor">{entry.executorLabel}</span>
                          <span>
                            {entry.completed ? "受入れ済み／Task完了" : "受入れ済み／Taskは継続"}
                          </span>
                          <span>{formatAt(entry.at)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </section>
        </div>

        <aside className="agent-desk-detail" aria-label="選択中の項目">
          {!selected ? (
            <p className="agent-desk-empty">項目を選ぶと、ここで回答と確認ができます。</p>
          ) : selected.kind === "proposal_pending" ? (
            <>
              <h3>{selected.headline}</h3>
              <p className="agent-desk-summary">{selected.questionOrAction}</p>
              <p className="agent-desk-note">
                Proposalの中身は下の「AIの提案」から確認して採用・却下できます。
              </p>
              <div className="agent-desk-actions">
                <Button
                  variant="primary"
                  onClick={() => void rejectProposal(selected)}
                  disabled={busy}
                >
                  この変更案を却下
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => openTask(selected.taskId)}
                  disabled={!selected.taskId}
                >
                  Taskを開く
                </Button>
              </div>
            </>
          ) : selected.kind === "review_report" ? (
            <>
              <h3>成果を確認</h3>
              <p className="agent-desk-summary">{selected.summary}</p>
              <dl className="agent-desk-rows-detail">
                <div>
                  <dt>成果</dt>
                  <dd>{selected.summary}</dd>
                </div>
                <div>
                  <dt>確認できたこと</dt>
                  <dd>{list(selectedEntry?.verification).join("／") || "—"}</dd>
                </div>
                <div>
                  <dt>未確認事項</dt>
                  <dd>{list(selectedEntry?.remaining_work).join("／") || "—"}</dd>
                </div>
                <div>
                  <dt>Taskenへ反映する内容</dt>
                  <dd>
                    {list(selectedEntry?.completed_checklist_item_ids).join("／") ||
                      "チェック項目の変更はありません"}
                  </dd>
                </div>
              </dl>
              {/* 既定の主操作は「報告を採用」。Task完了は選ばれていない明示オプションにする。 */}
              <label className="agent-desk-option">
                <input
                  type="checkbox"
                  checked={completeTask}
                  onChange={(event) => setCompleteTask(event.target.checked)}
                />
                Taskも完了する
              </label>
              <div className="agent-desk-actions">
                <Button
                  variant="primary"
                  onClick={() => void acceptReport(selected, completeTask)}
                  disabled={busy}
                >
                  {completeTask ? "採用してTaskを完了" : "報告を採用"}
                </Button>
                <Button variant="secondary" onClick={() => openTask(selected.taskId)}>
                  Taskを開く
                </Button>
              </div>
              <div className="agent-desk-return">
                <label htmlFor="agent-desk-return-note">修正してほしい内容</label>
                <textarea
                  id="agent-desk-return-note"
                  rows={2}
                  value={reviewNote}
                  onChange={(event) => setReviewNote(event.target.value)}
                  placeholder="例: 検証の条件を明記して、もう一度報告してください。"
                />
                <Button
                  variant="secondary"
                  onClick={() => void returnReport(selected)}
                  disabled={busy}
                >
                  修正を依頼
                </Button>
              </div>
            </>
          ) : (
            <>
              <h3>{selected.headline || "回答してください"}</h3>
              <p className="agent-desk-summary">{selected.summary}</p>
              {choices.length ? (
                <div className="agent-desk-choices" role="radiogroup" aria-label="選択肢">
                  {choices.map((choice) => (
                    <label key={choice}>
                      <input
                        type="radio"
                        name="agent-desk-choice"
                        value={choice}
                        checked={replyChoice === choice}
                        onChange={() => setReplyChoice(choice)}
                      />
                      {choice}
                    </label>
                  ))}
                </div>
              ) : null}
              <div className="agent-desk-return">
                <label htmlFor="agent-desk-reply">回答（選択肢がある場合も自由記述できます）</label>
                <textarea
                  id="agent-desk-reply"
                  rows={3}
                  value={replyNote}
                  onChange={(event) => setReplyNote(event.target.value)}
                />
                <div className="agent-desk-actions">
                  <Button
                    variant="primary"
                    onClick={() => void sendReply(selected)}
                    disabled={busy}
                  >
                    回答を送る
                  </Button>
                  <Button variant="secondary" onClick={() => openTask(selected.taskId)}>
                    Taskを開く
                  </Button>
                </div>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
