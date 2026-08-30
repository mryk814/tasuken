import { createHash } from "node:crypto";

import {
  proposeRepositoryTaskRequestSchema,
  proposeRepositoryTaskResponseSchema,
  type ProposeRepositoryTaskRequest,
  type ProposeRepositoryTaskResponse,
} from "../../../shared/contracts/task/public.ts";
import { buildRepositoryContextProposalCandidate } from "../../../shared/repositoryContextProposal.ts";
import type { AiProposalRecord, AiProposalWritePort } from "../ports/aiProposalWritePort.ts";

export class ProposeRepositoryTaskError extends Error {
  constructor(
    readonly code: "IDEMPOTENCY_CONFLICT" | "INVALID_PROPOSAL",
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ProposeRepositoryTaskError";
  }
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function canonicalIdentity(request: ProposeRepositoryTaskRequest) {
  return {
    tool: request.kind === "repository_context" ? "tasken.propose_repository_context" : "tasken.propose_task",
    caller: request.caller,
    actor: request.actor,
    source: request.source,
    source_session: request.source_session || null,
  };
}

function proposalId(sourceApp: string, payloadType: string, idempotencyKey: string): string {
  const hash = createHash("sha256").update(`${sourceApp}\0${payloadType}\0${idempotencyKey}`).digest("hex");
  const uuidHex = `${hash.slice(0, 12)}5${hash.slice(13, 16)}8${hash.slice(17, 32)}`;
  return `${uuidHex.slice(0, 8)}-${uuidHex.slice(8, 12)}-${uuidHex.slice(12, 16)}-${uuidHex.slice(16, 20)}-${uuidHex.slice(20, 32)}`;
}

function repositoryTaskPayload(request: ProposeRepositoryTaskRequest): { payloadType: "repository_contexts" | "items"; payload: Record<string, unknown> } {
  if (request.kind === "repository_context") {
    const candidate = buildRepositoryContextProposalCandidate({
      action: "create",
      label: request.label,
      ...(request.provider ? { provider: request.provider } : {}),
      remote_url: request.remote_url || null,
      local_path: request.local_path || null,
      web_url: request.web_url || null,
      repository_slug: request.repository_slug || null,
      subdirectory: request.subdirectory || null,
      default_branch: request.default_branch || null,
      reason: request.reason || "",
    }, []);
    if (candidate.issues.length || candidate.action !== "create") {
      throw new ProposeRepositoryTaskError("INVALID_PROPOSAL", "RepositoryContext proposalが公開可能な内容ではありません。", {
        issues: candidate.issues.map(() => "公開できないRepositoryContext fieldがあります。"),
      });
    }
    return { payloadType: "repository_contexts", payload: { repository_contexts: [candidate.entry] } };
  }
  return {
    payloadType: "items",
    payload: {
      items: [{
        action: "create",
        kind: "task",
        status: "todo",
        title: request.title,
        description: request.description || "",
        theme: request.theme || "",
        priority: request.priority || "normal",
        planned_start: request.planned_start || null,
        planned_end: request.planned_end || null,
        reason: request.reason || "",
      }],
    },
  };
}

export class ProposeRepositoryTaskService {
  constructor(
    private readonly writePort: AiProposalWritePort,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  execute(input: ProposeRepositoryTaskRequest): ProposeRepositoryTaskResponse {
    const request = proposeRepositoryTaskRequestSchema.parse(input);
    const sourceApp = request.source_app || "mcp-client";
    const { payloadType, payload } = repositoryTaskPayload(request);
    const id = proposalId(sourceApp, payloadType, request.idempotency_key);
    const identity = canonicalIdentity(request);
    const payloadDigest = digest({ payload, identity });
    const proposalRequest = { ...identity, idempotency_key: request.idempotency_key, payload_digest: payloadDigest };
    const status = this.writePort.runTransaction((transaction) => {
      const existing = transaction.get(id);
      if (existing) {
        const existingRequest = existing.request || {};
        const existingIdentity = {
          tool: existingRequest.tool || "",
          caller: existingRequest.caller || "",
          actor: existingRequest.actor || { kind: "ai_agent" },
          source: existingRequest.source || "mcp",
          source_session: existingRequest.source_session || null,
        };
        const existingDigest = digest({ payload: existing.payload, identity: existingIdentity });
        if (existing.source !== "mcp" || existing.payload_type !== payloadType || existingDigest !== payloadDigest) {
          throw new ProposeRepositoryTaskError("IDEMPOTENCY_CONFLICT", "同じidempotency_keyへ異なる内容を送信できません。", { proposal_id: id });
        }
        return "duplicate" as const;
      }
      const proposal: AiProposalRecord = {
        id,
        source: "mcp",
        source_app: sourceApp,
        payload_type: payloadType,
        payload,
        request: proposalRequest,
        status: "pending",
        received_at: this.now(),
      };
      transaction.save(proposal);
      return "queued" as const;
    });
    return proposeRepositoryTaskResponseSchema.parse({
      proposal_id: id,
      status,
      payload_type: payloadType,
      message: status === "queued"
        ? "TaskenのAI連携にProposalとして送りました。TaskenでPreviewして採用してください。"
        : "同じidempotency_keyのProposalはすでに受信済みです。",
    });
  }
}
