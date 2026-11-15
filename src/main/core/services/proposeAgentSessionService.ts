import { createHash } from "node:crypto";

import {
  proposeAgentSessionRequestSchema,
  proposeAgentSessionResponseSchema,
  type ProposeAgentSessionRequest,
  type ProposeAgentSessionResponse,
} from "../../../shared/contracts/task/public.ts";
import type { AgentWorkSessionFoldRequest } from "./agentWorkRecordService.ts";

/** 受け口（taskenCoreHost）の誤りの対応表が名前で引く。この service はもう投げない。受け口と一緒に消す。 */
export class ProposeAgentSessionError extends Error {
  constructor(
    readonly code:
      "IDEMPOTENCY_CONFLICT" | "SESSION_NOT_FOUND" | "SESSION_CONFLICT" | "INVALID_REFERENCE",
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ProposeAgentSessionError";
  }
}

function uuidFrom(parts: string[]) {
  const hash = createHash("sha256").update(parts.join("\0")).digest("hex");
  const value = `${hash.slice(0, 12)}5${hash.slice(13, 16)}8${hash.slice(17, 32)}`;
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

/**
 * 古い会話（Agent Session）の受け口。会話も案も、もう作らない（#751 PR 3）。
 *
 * AI の作業は、AI が書く 1 件（`record-agent-work`）と、Desktop がログから拾う 1 件に替わった。
 * ここへ送ってくるのは、古い hooks がまだ入っている PC だけ。その hook は、誤りでない返事を
 * 受けると手元の控えを消す。控えはその会話の最後の写しになりうるので、捨てずに、終わった会話
 * （capture）を新しい記録 1 件に畳んで書いてから「受信済み」と答える。同じ会話をもう数えて
 * あれば書かない（判定は AI の作業の入口と同じ所）。start と finish は、送る物がもう無い
 * （古い hook は capture だけを送る）ので、受けるだけで何も書かない。
 * 各 PC で hooks を外したら、受け口ごと消す（#751 PR 5）。
 */
export class ProposeAgentSessionService {
  constructor(
    /** 終わった会話 1 つを、AI の作業 1 件に畳んで書く（AgentWorkRecordService.foldSession）。 */
    private readonly fold: (session: AgentWorkSessionFoldRequest) => unknown,
  ) {}

  execute(input: ProposeAgentSessionRequest): ProposeAgentSessionResponse {
    const request = proposeAgentSessionRequestSchema.parse(input);
    // 前の版と同じ作り方の ID（古い hook の控えに残る値が、版の前後で変わらない）。
    const sessionId =
      request.action === "finish"
        ? request.agent_session_id
        : uuidFrom([
            request.source_app,
            "agent_session",
            request.source_session,
            ...(request.action === "capture" ? [new Date(request.started_at).toISOString()] : []),
          ]);
    if (request.action === "capture") {
      this.fold({
        session_id: sessionId,
        caller: request.caller,
        source_session: request.source_session,
        client_kind: request.client_kind,
        client_label: request.client_label || request.agent_label,
        model_label: request.model_label,
        started_at: request.started_at,
        ended_at: request.ended_at,
        status: request.status,
        response_checkpoints: request.response_checkpoints,
        intent: request.intent,
        outcome: request.outcome,
        theme_ids: request.theme_ids,
        task_ids: request.task_ids,
        repository_context_ids: request.repository_context_ids,
      });
    }
    return proposeAgentSessionResponseSchema.parse({
      proposal_id: uuidFrom([request.source_app, "agent_sessions", request.idempotency_key]),
      agent_session_id: sessionId,
      status: "duplicate",
      payload_type: "agent_sessions",
      message:
        request.action === "capture"
          ? "受信済みです。会話は AI の作業 1 件として記録しました（もう記録してあれば増やしません）。"
          : "受信済みです。Agent Session の開始と終了は、もう記録しません。",
    });
  }
}
