import * as z from "zod/v4";

import { taskWorkEntry } from "./taskWorkProposal.ts";

/**
 * Agent work の表示状態。**保存しない read model**。
 * `Task.work_state` とは別物で、この値を新しい enum として永続化しない。
 * 対応表は docs/agent-collaboration.md §6.3。
 */
export const agentWorkDisplayStateSchema = z.enum([
  "not_delegated",
  "start_waiting",
  "working",
  "answer_waiting",
  "decision_waiting",
  "answered_resume_waiting",
  "review_waiting",
  "accepted_continuing",
  "accepted_completed",
  "revision_requested",
  "past_attempt_report",
  "unknown_source",
]);

export type AgentWorkDisplayState = z.output<typeof agentWorkDisplayStateSchema>;

/**
 * 画面が選べる操作。UIは文言ではなくこのIDでCommandを決める。
 * 実行できない理由は `unavailableReason` に持たせ、文言から挙動を推測させない。
 */
export const agentWorkActionIdSchema = z.enum([
  "open_task",
  "open_record",
  "view_proposal",
  "answer_request",
  "review_report",
  "accept_report",
  "accept_and_complete",
  "request_revision",
  "reject_proposal",
  "defer_attention",
  "change_today_date",
  "change_deadline",
  "release_delegation",
]);

export type AgentWorkActionId = z.output<typeof agentWorkActionIdSchema>;

/** 要対応の種類。同じTaskに独立した判断が2つあれば2件として数える。 */
export const agentWorkAttentionKindSchema = z.enum([
  "answer_request",
  "decision_request",
  "review_report",
]);

export type AgentWorkAttentionKind = z.output<typeof agentWorkAttentionKindSchema>;

export interface AgentWorkSourceRef {
  type: "ai_proposal" | "work_receipt" | "task";
  id: string;
}

export interface AgentWorkAttentionItem {
  /** source参照から導出する安定ID。同じ内容の再送では変わらない。 */
  attentionId: string;
  kind: AgentWorkAttentionKind;
  displayState: AgentWorkDisplayState;
  sourceRef: AgentWorkSourceRef;
  sourceVersion: number | null;
  taskId: string | null;
  workAttemptId: string | null;
  /** 人間が回答すべき一回の質問のID。未採番の旧データでは null。 */
  requestId: string | null;
  headline: string;
  summary: string;
  /** agent側の発信時刻。時計のずれを含みうる。 */
  reportedAt: string | null;
  /** Taskenが受け取った時刻。並び順の基準はこちらを優先する。 */
  receivedAt: string | null;
  sequence: number | null;
  /** 見出し・要旨がAI生成か。事実と提案を色だけで判定させないために返す。 */
  generated: boolean;
  availableActions: AgentWorkActionId[];
}

export interface AgentWorkReportView {
  proposalId: string | null;
  receiptId: string | null;
  taskId: string;
  workAttemptId: string | null;
  isCurrentAttempt: boolean;
  displayState: AgentWorkDisplayState;
  action: string;
  summary: string;
  executorLabel: string;
  reportedAt: string | null;
  receivedAt: string | null;
  sequence: number | null;
  /** 人が採用済みか。pending のままかは proposalStatus で分かる。 */
  proposalStatus: string | null;
}

export interface AgentWorkReadModel {
  taskId: string;
  state: AgentWorkDisplayState;
  /** 現在参照している作業単位。未採番の旧Taskでは null。 */
  workAttemptId: string | null;
  /** 作業単位を識別できない旧データかどうか。true の間は遅着判定を行わない。 */
  legacyAttemptTracking: boolean;
  delegate: {
    intendedExecutor: string | null;
    executorIdentity: string | null;
    lastExecutorLabel: string | null;
  };
  currentReceiptId: string | null;
  attention: AgentWorkAttentionItem[];
  reports: AgentWorkReportView[];
  /** この状態を導出した根拠。UIやテストが表示理由を説明できるようにする。 */
  evidence: string[];
}

type WorkRecord = { id: string; [key: string]: unknown };

const RECORDED_ACTIONS = new Set(["append_receipt", "report_done", "report_blocked"]);

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function attemptIdOf(record: Record<string, unknown> | null | undefined): string | null {
  const value = record?.work_attempt_id ?? record?.workAttemptId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sequenceOf(record: Record<string, unknown> | null | undefined): number | null {
  const value = record?.report_sequence ?? record?.reportSequence;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function timeOf(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}

/**
 * 同じ作業単位の中での並び順。
 * 発信側の時計 (`reported_at`) だけで current を選ばないため、
 * `report_sequence` → 受信時刻 → 発信時刻 の順に強い根拠を使う。
 */
export function agentWorkOrderKey(report: AgentWorkReportView): [number, number, string] {
  const sequence = report.sequence;
  if (sequence !== null) return [0, sequence, report.proposalId || report.receiptId || ""];
  const received = report.receivedAt ? Date.parse(report.receivedAt) : Number.NaN;
  if (Number.isFinite(received)) return [1, received, report.proposalId || report.receiptId || ""];
  const reported = report.reportedAt ? Date.parse(report.reportedAt) : Number.NaN;
  return [2, Number.isFinite(reported) ? reported : 0, report.proposalId || report.receiptId || ""];
}

function compareReports(a: AgentWorkReportView, b: AgentWorkReportView): number {
  const [aRank, aValue, aId] = agentWorkOrderKey(a);
  const [bRank, bValue, bId] = agentWorkOrderKey(b);
  return aRank - bRank || aValue - bValue || aId.localeCompare(bId);
}

function needsInput(entry: Record<string, unknown>): boolean {
  const value = entry.needed_input;
  return Array.isArray(value) && value.some((item) => typeof item === "string" && item.trim());
}

/**
 * Task一件のAI作業状態を、既存データだけから導出する。
 *
 * - 新しいEntityやenumを保存しない。
 * - `work_attempt_id` を持たない旧Taskでは、従来どおり全報告を current として扱う（遅着判定をしない）。
 * - `work_attempt_id` を持つTaskでは、IDなしの報告を current 状態を確定する証拠に使わない。
 */
export function deriveAgentWorkState(input: {
  task: WorkRecord | null;
  proposals?: WorkRecord[];
  receipts?: WorkRecord[];
  /** 取得元を読めなかった場合。最後の確定状態を保持する意味を呼び出し側へ伝える。 */
  sourceAvailable?: boolean;
}): AgentWorkReadModel | null {
  const task = input.task;
  if (!task || task.deleted_at) return null;
  const taskId = String(task.id);
  const currentAttemptId = attemptIdOf(task);
  const legacyAttemptTracking = currentAttemptId === null;

  if (input.sourceAvailable === false) {
    return {
      taskId,
      state: "unknown_source",
      workAttemptId: currentAttemptId,
      legacyAttemptTracking,
      delegate: {
        intendedExecutor: text(task.intended_executor) || null,
        executorIdentity: text(task.executor_identity) || null,
        lastExecutorLabel: null,
      },
      currentReceiptId: null,
      attention: [],
      reports: [],
      evidence: ["source_unavailable"],
    };
  }

  const proposals = (input.proposals || []).filter((item) => !item.deleted_at);
  const receipts = (input.receipts || []).filter((item) => !item.deleted_at);
  const receiptById = new Map(receipts.map((item) => [String(item.id), item]));
  const reports: AgentWorkReportView[] = [];

  for (const proposal of proposals) {
    const entry = taskWorkEntry(proposal);
    if (!entry) continue;
    if (String(entry.task_id) !== taskId) continue;
    const action = text(entry.action);
    if (!RECORDED_ACTIONS.has(action)) continue;
    const receipt = receiptById.get(String(proposal.id));
    const attemptId = attemptIdOf(entry) ?? attemptIdOf(receipt);
    reports.push({
      proposalId: String(proposal.id),
      receiptId: proposal.status === "accepted" ? String(proposal.id) : null,
      taskId,
      workAttemptId: attemptId,
      isCurrentAttempt: legacyAttemptTracking || attemptId === currentAttemptId,
      displayState: "working",
      action,
      summary: text(entry.summary) || text(entry.blocker),
      executorLabel: text(entry.executor_label) || text(task.executor_identity) || "AI",
      reportedAt: timeOf(entry.reported_at) ?? timeOf(entry.started_at),
      receivedAt: timeOf(proposal.received_at) ?? timeOf(proposal.created_at),
      sequence: sequenceOf(entry),
      proposalStatus: proposal.status ? String(proposal.status) : null,
    });
  }

  for (const receipt of receipts) {
    if (String(receipt.task_id) !== taskId) continue;
    if (receipt.provenance && (receipt.provenance as Record<string, unknown>).proposal_id) continue;
    if (reports.some((report) => report.receiptId === String(receipt.id))) continue;
    const metadata = receipt.runtime_metadata as Record<string, unknown> | undefined;
    const kind = text(metadata?.report_kind);
    // 人の返答は型付きの receipt_kind で判別する。旧データは runtime_metadata で読む（#597）。
    const isHumanReply = text(receipt.receipt_kind) === "human_reply" || kind === "human_reply";
    const attemptId = attemptIdOf(receipt);
    reports.push({
      proposalId: null,
      receiptId: String(receipt.id),
      taskId,
      workAttemptId: attemptId,
      isCurrentAttempt: legacyAttemptTracking || attemptId === currentAttemptId,
      displayState: "working",
      action: isHumanReply
        ? "human_reply"
        : kind === "done"
          ? "report_done"
          : kind === "blocked"
            ? "report_blocked"
            : "append_receipt",
      summary: text(receipt.summary),
      executorLabel: text(receipt.executor_label) || text(task.executor_identity) || "AI",
      reportedAt: timeOf(receipt.reported_at),
      receivedAt: timeOf(receipt.created_at),
      sequence: sequenceOf(receipt),
      proposalStatus: "accepted",
    });
  }

  reports.sort(compareReports);

  const evidence: string[] = [];
  if (legacyAttemptTracking) evidence.push("legacy_attempt_tracking");
  else evidence.push(`work_attempt:${currentAttemptId}`);

  const answeredRequests = new Set(
    receipts
      .map((receipt) => {
        const metadata = receipt.runtime_metadata as Record<string, unknown> | undefined;
        const isHumanReply =
          text(receipt.receipt_kind) === "human_reply" ||
          text(metadata?.report_kind) === "human_reply";
        // 質問の識別は型付きの request_id を優先し、旧データだけ metadata を読む。
        return isHumanReply ? text(receipt.request_id) || text(metadata?.request_id) : "";
      })
      .filter(Boolean),
  );

  const workStateForAttention = text(task.work_state);
  const reviewStillNeeded =
    workStateForAttention === "reported_done" || workStateForAttention === "needs_human_review";

  const attention: AgentWorkAttentionItem[] = [];
  for (const report of reports) {
    if (!report.isCurrentAttempt) continue;
    const proposal = report.proposalId
      ? proposals.find((item) => String(item.id) === report.proposalId)
      : null;
    const entry = proposal ? taskWorkEntry(proposal) : null;
    const requestId =
      typeof entry?.request_id === "string" && entry.request_id.trim() ? entry.request_id : null;

    if (report.action === "report_blocked") {
      // 質問は報告を採用しただけでは解決しない。人が回答を保存するまで未解決として残す。
      const resolved = requestId
        ? answeredRequests.has(requestId)
        : workStateForAttention !== "blocked";
      if (resolved) continue;
      const kind: AgentWorkAttentionKind =
        entry && needsInput(entry) ? "answer_request" : "decision_request";
      attention.push({
        attentionId: requestId
          ? `request:${requestId}`
          : `receipt:${report.receiptId || report.proposalId}`,
        kind,
        displayState: kind === "answer_request" ? "answer_waiting" : "decision_waiting",
        sourceRef: report.proposalId
          ? { type: "ai_proposal", id: report.proposalId }
          : { type: "work_receipt", id: String(report.receiptId) },
        sourceVersion: typeof proposal?.version === "number" ? proposal.version : null,
        taskId,
        workAttemptId: report.workAttemptId,
        requestId,
        headline: text(entry?.headline) || "",
        summary: report.summary,
        reportedAt: report.reportedAt,
        receivedAt: report.receivedAt,
        sequence: report.sequence,
        generated: true,
        availableActions: ["answer_request", "open_task", "defer_attention"],
      });
      continue;
    }

    if (
      report.action === "report_done" &&
      (report.proposalStatus === "pending" || reviewStillNeeded)
    ) {
      const reviewId = report.proposalId || String(report.receiptId);
      attention.push({
        attentionId: `review:${reviewId}`,
        kind: "review_report",
        displayState: "review_waiting",
        sourceRef: report.proposalId
          ? { type: "ai_proposal", id: report.proposalId }
          : { type: "work_receipt", id: String(report.receiptId) },
        sourceVersion: typeof proposal?.version === "number" ? proposal.version : null,
        taskId,
        workAttemptId: report.workAttemptId,
        requestId: null,
        headline: text(entry?.headline) || "",
        summary: report.summary,
        reportedAt: report.reportedAt,
        receivedAt: report.receivedAt,
        sequence: report.sequence,
        generated: true,
        availableActions: [
          "review_report",
          "accept_report",
          "accept_and_complete",
          "request_revision",
        ],
      });
    }
  }

  // 同じ質問の再送は、経過時刻が変わっても一つの判断として数える。
  const deduped = new Map<string, AgentWorkAttentionItem>();
  for (const item of attention) {
    const previous = deduped.get(item.attentionId);
    if (!previous) {
      deduped.set(item.attentionId, item);
      continue;
    }
    const previousAt = Date.parse(previous.receivedAt || previous.reportedAt || "") || 0;
    const currentAt = Date.parse(item.receivedAt || item.reportedAt || "") || 0;
    if (currentAt >= previousAt) deduped.set(item.attentionId, item);
  }

  const openAttention = [...deduped.values()].filter(
    (item) => !(item.requestId && answeredRequests.has(item.requestId)),
  );

  const currentReports = reports.filter((report) => report.isCurrentAttempt);
  const terminalCurrent = currentReports.filter(
    (report) => report.action === "report_done" || report.action === "report_blocked",
  );
  const latestTerminal = terminalCurrent.at(-1) || null;
  const latestReceipt = currentReports.filter((report) => report.receiptId !== null).at(-1) || null;
  const workState = text(task.work_state);
  const taskState = text(task.state);

  for (const report of reports) {
    if (report.isCurrentAttempt) continue;
    report.displayState = "past_attempt_report";
  }

  let state: AgentWorkDisplayState = "not_delegated";
  if (taskState === "done" && workState === "accepted") state = "accepted_completed";
  else if (workState === "accepted") state = "accepted_continuing";
  else if (openAttention.some((item) => item.kind === "answer_request")) state = "answer_waiting";
  else if (openAttention.some((item) => item.kind === "decision_request"))
    state = "decision_waiting";
  else if (openAttention.some((item) => item.kind === "review_report")) state = "review_waiting";
  else if (workState === "in_progress") state = "working";
  else if (workState === "ready_for_agent") state = "start_waiting";
  else if (workState === "reported_done" || workState === "needs_human_review")
    state = "review_waiting";
  else if (workState === "blocked")
    // 質問は解決したが agent の再開をまだ観測していない状態。
    state = answeredRequests.size > 0 ? "answered_resume_waiting" : "decision_waiting";
  else if (workState === "failed" || text(task.work_review_note)) state = "revision_requested";

  if (!legacyAttemptTracking && terminalCurrent.length === 0 && currentReports.length === 0) {
    evidence.push("no_report_in_current_attempt");
  }
  if (state === "answer_waiting" || state === "decision_waiting" || state === "review_waiting") {
    evidence.push(`attention:${openAttention.length}`);
  }
  if (latestTerminal && latestTerminal.displayState !== "past_attempt_report") {
    evidence.push(`terminal:${latestTerminal.proposalId || latestTerminal.receiptId}`);
  }

  return {
    taskId,
    state,
    workAttemptId: currentAttemptId,
    legacyAttemptTracking,
    delegate: {
      intendedExecutor: text(task.intended_executor) || null,
      executorIdentity: text(task.executor_identity) || null,
      // 現在の作業単位に報告がまだ無い場合、委任先の識別子だけが分かる。
      lastExecutorLabel: latestReceipt?.executorLabel || text(task.executor_identity) || null,
    },
    currentReceiptId: latestReceipt?.receiptId || null,
    attention: openAttention,
    reports,
    evidence,
  };
}
