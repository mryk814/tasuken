import { createHash } from "node:crypto";

import { normalizeAgentSession } from "../../../shared/agentSession.mjs";
import {
  proposeAgentSessionRequestSchema,
  proposeAgentSessionResponseSchema,
  type ProposeAgentSessionRequest,
  type ProposeAgentSessionResponse,
} from "../../../shared/contracts/task/public.ts";
import type { AiProposalRecord, AiProposalWritePort } from "../ports/aiProposalWritePort.ts";

export class ProposeAgentSessionError extends Error {
  constructor(
    readonly code: "IDEMPOTENCY_CONFLICT" | "SESSION_NOT_FOUND" | "SESSION_CONFLICT" | "INVALID_REFERENCE",
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

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function relationEntries(
  request: Extract<ProposeAgentSessionRequest, { action: "start" }>,
  sessionId: string,
  proposalId: string,
) {
  const targets = [
    ...(request.theme_ids || []).map((id) => ["project", id, "worked_on"]),
    ...(request.task_ids || []).map((id) => ["task", id, "worked_on"]),
    ...(request.repository_context_ids || []).map((id) => ["repository_context", id, "worked_on"]),
    ...(request.working_copy_ids || []).map((id) => ["working_copy", id, "executed_in"]),
  ] as Array<[string, string, string]>;
  return [...new Map(targets.map((target) => [`${target[0]}:${target[1]}`, target])).values()].map(
    ([type, id, predicate]) => ({
      id: uuidFrom(["agent-session-reference", sessionId, type, id, predicate]),
      source_type: "agent_session",
      source_id: sessionId,
      target_type: type,
      target_id: id,
      relation_type: predicate,
      layer: "provenance",
      status: "asserted",
      origin: "ai_suggested",
      metadata: { accepted_from_proposal_id: proposalId },
    }),
  );
}

export class ProposeAgentSessionService {
  constructor(
    private readonly writePort: AiProposalWritePort,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  execute(input: ProposeAgentSessionRequest): ProposeAgentSessionResponse {
    const request = proposeAgentSessionRequestSchema.parse(input);
    const proposalId = uuidFrom([request.source_app, "agent_sessions", request.idempotency_key]);
    const sessionId = request.action === "start"
      ? uuidFrom([request.source_app, "agent_session", request.source_session])
      : request.agent_session_id;
    const receivedAt = this.now();
    const requestDigest = digest(request);

    const status = this.writePort.runTransaction((transaction) => {
      const existingProposal = transaction.get(proposalId);
      if (existingProposal) {
        const existingDigest = String(existingProposal.request.request_digest || "");
        if (
          existingProposal.source !== "mcp"
          || existingProposal.payload_type !== "agent_sessions"
          || existingDigest !== requestDigest
        ) {
          throw new ProposeAgentSessionError(
            "IDEMPOTENCY_CONFLICT",
            "同じ idempotency_key に異なる Agent Session 内容を送信できません。",
            { proposal_id: proposalId },
          );
        }
        return "duplicate" as const;
      }

      const current = request.action === "finish" ? transaction.getEntity("agent_session", sessionId) : null;
      if (request.action === "finish") {
        if (!current) {
          throw new ProposeAgentSessionError(
            "SESSION_NOT_FOUND",
            "終了対象の Agent Session がありません。",
            { agent_session_id: sessionId },
          );
        }
        if (Number(current.version || 0) !== request.expected_version) {
          throw new ProposeAgentSessionError(
            "SESSION_CONFLICT",
            "Agent Session が更新されています。再取得してから終了してください。",
            { agent_session_id: sessionId },
          );
        }
        if (current.status !== "active") {
          throw new ProposeAgentSessionError(
            "SESSION_CONFLICT",
            "active 以外の Agent Session は終了できません。",
            { agent_session_id: sessionId },
          );
        }
        if (current.source_session_id !== request.source_session) {
          throw new ProposeAgentSessionError(
            "SESSION_CONFLICT",
            "source_session が Agent Session と一致しません。",
            { agent_session_id: sessionId },
          );
        }
      }
      if (request.action === "start" && transaction.getEntity("agent_session", sessionId)) {
        throw new ProposeAgentSessionError(
          "SESSION_CONFLICT",
          "同じ source_session の Agent Session はすでに存在します。",
          { agent_session_id: sessionId },
        );
      }

      const session = normalizeAgentSession(request.action === "start" ? {
        id: sessionId,
        started_at: request.started_at,
        status: "active",
        client_kind: request.client_kind,
        client_label: request.client_label || null,
        agent_label: request.agent_label || null,
        provider_label: request.provider_label || null,
        model_label: request.model_label || null,
        source_session_id: request.source_session,
        intent: request.intent,
        source: "ai_proposal",
      } : {
        ...current,
        ended_at: request.ended_at,
        status: request.status,
        outcome: request.outcome,
      });
      const references = request.action === "start" ? relationEntries(request, sessionId, proposalId) : [];
      for (const reference of references) {
        if (!transaction.getEntity(reference.target_type, reference.target_id)) {
          throw new ProposeAgentSessionError(
            "INVALID_REFERENCE",
            "Agent Session の関連先が存在しません。",
            { type: reference.target_type, id: reference.target_id },
          );
        }
      }
      const payload = { agent_sessions: [{ action: request.action, session, references }] };
      const proposal: AiProposalRecord = {
        id: proposalId,
        source: "mcp",
        source_app: request.source_app,
        payload_type: "agent_sessions",
        payload,
        request: {
          tool: request.action === "start" ? "tasken.start_agent_session" : "tasken.finish_agent_session",
          idempotency_key: request.idempotency_key,
          caller: request.caller,
          actor: request.actor,
          source: request.source,
          source_session: request.source_session,
          request_digest: requestDigest,
          payload_digest: digest(payload),
        },
        status: "pending",
        received_at: receivedAt,
      };
      transaction.save(proposal);
      return "queued" as const;
    });

    return proposeAgentSessionResponseSchema.parse({
      proposal_id: proposalId,
      agent_session_id: sessionId,
      status,
      payload_type: "agent_sessions",
      message: status === "queued"
        ? "Agent Session を提案として送りました。Tasuken の AI Inbox で確認してください。"
        : "同じ idempotency_key の Agent Session Proposal は受信済みです。",
    });
  }
}
