import { createHash } from "node:crypto";

import {
  proposeAgentSessionRequestSchema,
  proposeAgentSessionResponseSchema,
  type ProposeAgentSessionRequest,
  type ProposeAgentSessionResponse,
} from "../../../shared/contracts/task/public.ts";

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
 * 古い会話（Agent Session）の受け口。もう保存しない（#751 PR 3）。
 *
 * AI の作業は、AI が書く 1 件（`record-agent-work`）と、Desktop がログから拾う 1 件に替わった。
 * ここへ送ってくるのは、古い hooks がまだ入っている PC だけ。その hook は、受け口が誤りを返すと
 * 手元の控えを残して送り続けるので、形の合う要求には「受信済み」と答える（hook が控えを捨てる）。
 * 案も会話も作らない。各 PC で hooks を外したら、受け口ごと消す（#751 PR 5）。
 */
export class ProposeAgentSessionService {
  execute(input: ProposeAgentSessionRequest): ProposeAgentSessionResponse {
    const request = proposeAgentSessionRequestSchema.parse(input);
    // 前の版と同じ作り方の ID を返す（古い hook の控えに残る値が、版の前後で変わらない）。
    return proposeAgentSessionResponseSchema.parse({
      proposal_id: uuidFrom([request.source_app, "agent_sessions", request.idempotency_key]),
      agent_session_id:
        request.action === "finish"
          ? request.agent_session_id
          : uuidFrom([
              request.source_app,
              "agent_session",
              request.source_session,
              ...(request.action === "capture" ? [new Date(request.started_at).toISOString()] : []),
            ]),
      status: "duplicate",
      payload_type: "agent_sessions",
      message: "Agent Session の受け口は役目を終えました。受信済みとして扱い、保存しません。",
    });
  }
}
