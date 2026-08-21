import { createHash } from "node:crypto";

import {
  proposeTaskWorkRequestSchema,
  proposeTaskWorkResponseSchema,
  type ProposeTaskWorkRequest,
  type ProposeTaskWorkResponse,
} from "../../../shared/contracts/task/public.ts";
import type { AiProposalRecord, AiProposalWritePort } from "../ports/aiProposalWritePort.ts";

const TOOL_BY_ACTION = {
  start: "tasken.start_task_work",
  append_receipt: "tasken.append_work_receipt",
  report_done: "tasken.report_task_done",
  report_blocked: "tasken.report_task_blocked",
} as const;

export class ProposeTaskWorkError extends Error {
  constructor(
    readonly code: "IDEMPOTENCY_CONFLICT",
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ProposeTaskWorkError";
  }
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function canonicalIdentity(request: Record<string, unknown>) {
  const actor = request.actor && typeof request.actor === "object" && !Array.isArray(request.actor)
    ? request.actor as Record<string, unknown>
    : {};
  return {
    tool: typeof request.tool === "string" ? request.tool : "",
    caller: typeof request.caller === "string" ? request.caller : "",
    actor: {
      kind: typeof actor.kind === "string" ? actor.kind : "ai_agent",
      ...(typeof actor.id === "string" && actor.id ? { id: actor.id } : {}),
    },
    source: typeof request.source === "string" ? request.source : "mcp",
    source_session: typeof request.source_session === "string" && request.source_session
      ? request.source_session
      : null,
  };
}

function proposalDigest(payload: Record<string, unknown>, request: Record<string, unknown>): string {
  return digest({ payload, identity: canonicalIdentity(request) });
}

function proposalId(sourceApp: string, idempotencyKey: string): string {
  const hash = createHash("sha256").update(`${sourceApp}\0task_work\0${idempotencyKey}`).digest("hex");
  const uuidHex = `${hash.slice(0, 12)}5${hash.slice(13, 16)}8${hash.slice(17, 32)}`;
  return `${uuidHex.slice(0, 8)}-${uuidHex.slice(8, 12)}-${uuidHex.slice(12, 16)}-${uuidHex.slice(16, 20)}-${uuidHex.slice(20, 32)}`;
}

function commonEntry(request: ProposeTaskWorkRequest) {
  return {
    action: request.action,
    task_id: request.task_id,
    expected_version: request.expected_version,
    caller: request.caller,
    source_session: request.source_session || null,
    repository_context: request.repository_context || null,
  };
}

function receiptFields(request: Extract<ProposeTaskWorkRequest, { action: "append_receipt" | "report_done" }>) {
  return {
    executor_kind: request.executor_kind,
    executor_label: request.executor_label,
    summary: request.summary,
    completed_items: request.completed_items || [],
    changed_or_created_items: request.changed_or_created_items || [],
    verification: request.verification || [],
    remaining_work: request.remaining_work || [],
    external_references: request.external_references || [],
    reported_at: request.reported_at || null,
    repository_context: request.repository_context || null,
    runtime_metadata: request.provider || request.model
      ? { provider: request.provider || null, model: request.model || null }
      : null,
  };
}

function taskWorkEntry(request: ProposeTaskWorkRequest): Record<string, unknown> {
  if (request.action === "start") {
    return {
      ...commonEntry(request),
      executor_kind: request.executor_kind || "ai_agent",
      executor_identity: request.executor_identity || null,
      started_at: request.started_at || null,
    };
  }
  if (request.action === "report_blocked") {
    return {
      ...commonEntry(request),
      executor_kind: request.executor_kind || "ai_agent",
      executor_label: request.executor_label,
      summary: request.blocker,
      completed_items: request.attempted_work || [],
      changed_or_created_items: request.retained_artifacts || [],
      verification: [],
      remaining_work: request.needed_input || [],
      external_references: request.external_references || [],
      reported_at: request.reported_at || null,
      repository_context: request.repository_context || null,
      runtime_metadata: {
        ...(request.provider ? { provider: request.provider } : {}),
        ...(request.model ? { model: request.model } : {}),
        report_kind: "blocked",
      },
    };
  }
  return { ...commonEntry(request), ...receiptFields(request) };
}

export class ProposeTaskWorkService {
  constructor(
    private readonly writePort: AiProposalWritePort,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  execute(input: ProposeTaskWorkRequest): ProposeTaskWorkResponse {
    const request = proposeTaskWorkRequestSchema.parse(input);
    const sourceApp = request.source_app || "mcp-client";
    const payload = { task_work: [taskWorkEntry(request)] };
    const id = proposalId(sourceApp, request.idempotency_key);
    const receivedAt = this.now();
    const proposalRequestBase = {
      tool: TOOL_BY_ACTION[request.action],
      expected_version: request.expected_version,
      idempotency_key: request.idempotency_key,
      caller: request.caller,
      actor: request.actor,
      source: request.source,
      source_session: request.source_session || null,
    };
    const payloadDigest = proposalDigest(payload, proposalRequestBase);
    const proposalRequest = { ...proposalRequestBase, payload_digest: payloadDigest };

    const status = this.writePort.runTransaction((transaction) => {
      const existing = transaction.get(id);
      if (existing) {
        const existingDigest = proposalDigest(existing.payload, existing.request || {});
        if (existing.source !== "mcp"
          || existing.payload_type !== "task_work"
          || existingDigest !== payloadDigest) {
          throw new ProposeTaskWorkError(
            "IDEMPOTENCY_CONFLICT",
            "同じidempotency_keyへ異なる内容を送信できません。",
            { proposal_id: id },
          );
        }
        return "duplicate" as const;
      }
      const proposal: AiProposalRecord = {
        id,
        source: "mcp",
        source_app: sourceApp,
        payload_type: "task_work",
        payload,
        request: proposalRequest,
        status: "pending",
        received_at: receivedAt,
      };
      transaction.save(proposal);
      return "queued" as const;
    });

    return proposeTaskWorkResponseSchema.parse({
      proposal_id: id,
      status,
      payload_type: "task_work",
      message: status === "queued"
        ? "TaskenのAI連携にProposalとして送りました。TaskenでPreviewして採用してください。"
        : "同じidempotency_keyのProposalはすでに受信済みです。",
    });
  }
}
