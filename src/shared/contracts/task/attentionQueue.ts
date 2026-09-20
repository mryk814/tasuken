import * as z from "zod/v4";

import { deriveAgentWorkState, type AgentWorkActionId } from "./agentWork.ts";

/**
 * 人間が次に判断・回答・承認すべきもの（#596）。
 *
 * **新しいInbox Entityではない。** 既存のTask / Work Receipt / Proposal / agent work state
 * から導出するattention projectionであり、正本は常に元のsourceにある。
 * 表示の正本は `docs/agent-collaboration.md` §6、件数の意味は §件数の規則。
 */

/** 判断の種類。同じTaskに独立した判断が2つあれば2件として数える。 */
export const attentionKindSchema = z.enum([
  /** agentが人間からの情報を待っている（blocked / input_required）。 */
  "answer_request",
  /** A/B選択・許可・仕様判断など（decision_required）。 */
  "decision_request",
  /** agentの成果確認（review_ready）。 */
  "review_report",
  /** AI Proposalのaccept / reject（proposal_pending）。 */
  "proposal_pending",
]);

export type AttentionKind = z.output<typeof attentionKindSchema>;

/** sourceの種別。itemは必ず元のsourceへlocatorを持つ。 */
export const attentionSourceTypeSchema = z.enum(["ai_proposal", "work_receipt", "task"]);

export type AttentionSourceType = z.output<typeof attentionSourceTypeSchema>;

export interface AttentionItem {
  /** source参照から導出する安定ID。同じ内容の再送では変わらない。 */
  attentionId: string;
  kind: AttentionKind;
  /** Taskに紐づかないProposal（Note / Artifact等）では null。 */
  taskId: string | null;
  taskTitle: string | null;
  themeId: string | null;
  themeName: string | null;
  /** 作業した相手の表示名。Task-less Proposalでは提案元。 */
  agentLabel: string | null;
  /** 見出し。 */
  headline: string;
  /** 短い要旨。 */
  summary: string;
  /** 人間に求めること（質問文または操作の説明）。 */
  questionOrAction: string;
  /** 受信時刻。 */
  createdAt: string | null;
  /** 同じ判断のうち最後に動いた時刻。 */
  updatedAt: string | null;
  sourceType: AttentionSourceType;
  sourceId: string;
  sourceVersion: number | null;
  /** 作業単位。Task work以外では null。 */
  workAttemptId: string | null;
  /** 回答対象の質問ID。 */
  requestId: string | null;
  availableActions: AgentWorkActionId[];
  /** 同じ判断としてまとめた追加のsource。二重表示を避けるために残す。 */
  relatedSourceIds: string[];
  /** AI生成の文章か。事実と提案を色だけで判定させない。 */
  generated: boolean;
}

type WorkRecord = { id: string; [key: string]: unknown };

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * 外部AI clientの接続hookが送ったAgent Sessionの観測。
 * 判断待ちではなく観測なので、要対応の件数に数えない（Agent Deskの提案一覧と同じ扱い）。
 */
export function isPassiveAgentSessionProposal(proposal: Record<string, unknown>): boolean {
  return (
    proposal.status === "pending" &&
    proposal.payload_type === "agent_sessions" &&
    text(proposal.source_app).startsWith("tasken-session-hook:")
  );
}

/** 判断の種類ごとの表示順。AIの自己申告では動かさない。 */
const KIND_ORDER: Record<AttentionKind, number> = {
  answer_request: 0,
  decision_request: 1,
  review_report: 2,
  proposal_pending: 3,
};

function timeOf(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}

/** 異なる層のrow（SQLite row / Rendererの型付きTask / Entity）を受け取るための正規化。 */
function asRecords(value: readonly unknown[] | undefined): WorkRecord[] {
  const records: WorkRecord[] = [];
  for (const item of value || []) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    if (!("id" in item)) continue;
    records.push(item as WorkRecord);
  }
  return records;
}

/**
 * 未解決の判断を一つのqueueへ集約する。
 *
 * - Task workの判断は `deriveAgentWorkState` の導出結果をそのまま使う（二重実装しない）。
 * - TaskなしのProposalも同じcontractへ写像する。
 * - 解決済み（accepted / rejected）のsourceは自然に消える。staleなsourceを成功扱いしない。
 */
export function buildAttentionQueue(input: {
  tasks?: readonly unknown[];
  proposals?: readonly unknown[];
  receipts?: readonly unknown[];
  themes?: readonly unknown[];
}): AttentionItem[] {
  const tasks = asRecords(input.tasks).filter((task) => !task.deleted_at);
  const proposals = asRecords(input.proposals).filter((proposal) => !proposal.deleted_at);
  const receipts = asRecords(input.receipts).filter((receipt) => !receipt.deleted_at);
  const themes = asRecords(input.themes).filter((theme) => !theme.deleted_at);
  const themeName = new Map(themes.map((theme) => [String(theme.id), text(theme.name)]));
  const taskTitle = new Map(tasks.map((task) => [String(task.id), text(task.title)]));

  const items: AttentionItem[] = [];
  const taskWorkSourceIds = new Set<string>();

  for (const task of tasks) {
    const state = deriveAgentWorkState({ task, proposals, receipts });
    if (!state) continue;
    for (const attention of state.attention) {
      // 同じreportから生じたreviewとProposalは一つの判断としてまとめる。
      if (attention.sourceRef.type === "ai_proposal") taskWorkSourceIds.add(attention.sourceRef.id);
      if (attention.sourceRef.type === "work_receipt")
        taskWorkSourceIds.add(attention.sourceRef.id);
      const themeId = text(task.project_id) || null;
      items.push({
        attentionId: `task-work:${attention.attentionId}`,
        kind: attention.kind,
        taskId: String(task.id),
        taskTitle: text(task.title) || null,
        themeId,
        themeName: themeId ? themeName.get(themeId) || null : null,
        agentLabel: state.delegate.lastExecutorLabel || state.delegate.executorIdentity || null,
        // 質問には見出しが無い。空の見出しを返さず、要旨をそのまま見出しに使う。
        headline: attention.headline || attention.summary,
        summary: attention.summary,
        questionOrAction: attention.summary,
        createdAt: attention.receivedAt || attention.reportedAt,
        updatedAt: attention.receivedAt || attention.reportedAt,
        sourceType: attention.sourceRef.type,
        sourceId: attention.sourceRef.id,
        sourceVersion: attention.sourceVersion,
        workAttemptId: attention.workAttemptId,
        requestId: attention.requestId,
        availableActions: attention.availableActions,
        relatedSourceIds: [],
        generated: attention.generated,
      });
    }
  }

  for (const proposal of proposals) {
    // Task workの判断は上で導出済み。同じsourceを二度並べない。
    if (taskWorkSourceIds.has(String(proposal.id))) continue;
    if (isPassiveAgentSessionProposal(proposal)) continue;
    if (text(proposal.status) !== "pending") continue;
    if (text(proposal.payload_type) === "task_work") continue;
    const request = (proposal.request || {}) as Record<string, unknown>;
    const taskId = typeof request.task_id === "string" && request.task_id ? request.task_id : null;
    const themeId =
      typeof request.theme_id === "string" && request.theme_id ? request.theme_id : null;
    const summary = text(proposal.summary) || text(proposal.title) || proposalLabel(proposal);
    items.push({
      attentionId: `proposal:${proposal.id}`,
      kind: "proposal_pending",
      taskId,
      taskTitle: taskId ? taskTitle.get(taskId) || null : null,
      themeId,
      themeName: themeId ? themeName.get(themeId) || null : null,
      agentLabel: text(proposal.source_app) || text(proposal.source) || null,
      headline: proposalLabel(proposal),
      summary,
      questionOrAction: "内容を確認して、採用するかどうかを決めてください。",
      createdAt: timeOf(proposal.received_at) ?? timeOf(proposal.created_at),
      updatedAt: timeOf(proposal.received_at) ?? timeOf(proposal.created_at),
      sourceType: "ai_proposal",
      sourceId: String(proposal.id),
      sourceVersion: typeof proposal.version === "number" ? proposal.version : null,
      workAttemptId: null,
      requestId: null,
      availableActions: ["view_proposal", "reject_proposal", "defer_attention"],
      relatedSourceIds: [],
      generated: true,
    });
  }

  // 同じ判断の重複を畳む。同じattentionIdが2つ来ることは通常ないが、
  // 経路の違いで生じた重複を件数へ持ち込まない。
  const deduped = new Map<string, AttentionItem>();
  for (const item of items) {
    const previous = deduped.get(item.attentionId);
    if (!previous) {
      deduped.set(item.attentionId, item);
      continue;
    }
    const previousAt = Date.parse(previous.updatedAt || "") || 0;
    const currentAt = Date.parse(item.updatedAt || "") || 0;
    if (currentAt >= previousAt) {
      deduped.set(item.attentionId, {
        ...item,
        relatedSourceIds: [...new Set([...previous.relatedSourceIds, previous.sourceId])],
      });
    }
  }

  return [...deduped.values()].sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (a.createdAt || "").localeCompare(b.createdAt || "") ||
      a.attentionId.localeCompare(b.attentionId),
  );
}

/** 未処理のhuman attentionの数。badgeはこの数だけを表す。 */
export function countAttention(items: readonly AttentionItem[]): number {
  return items.length;
}

function proposalLabel(proposal: WorkRecord): string {
  const type = text(proposal.payload_type);
  const labels: Record<string, string> = {
    notes: "Noteの変更案",
    items: "項目の変更案",
    links: "リンクの変更案",
    knowledge_nodes: "Knowledgeの変更案",
    sketches: "Sketchの変更案",
    artifacts: "Artifactの変更案",
    status_update: "状況更新の提案",
    repository_contexts: "Repository Contextの提案",
    agent_sessions: "Agent Sessionの記録",
  };
  return labels[type] || "AIからの提案";
}
