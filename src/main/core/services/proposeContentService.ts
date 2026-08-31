import { createHash } from "node:crypto";

import {
  proposeContentRequestSchema,
  proposeContentResponseSchema,
  type ContentProposalPayloadType,
  type ProposeContentRequest,
  type ProposeContentResponse,
} from "../../../shared/contracts/task/public.ts";
import { validateArtifactProposal, validateSafeSvg } from "../../../shared/proposalMedia.mjs";
import type { AiProposalRecord, AiProposalWritePort } from "../ports/aiProposalWritePort.ts";

const MAX_CANONICAL_PROPOSAL_BYTES = 64 * 1024;

const TOOL_BY_KIND = {
  note_create: "tasken.propose_note",
  note_edit: "tasken.propose_note_edit",
  knowledge_create: "tasken.propose_knowledge",
  sketch_create: "tasken.propose_sketch",
  artifact_create: "tasken.propose_artifact",
} as const;

export class ProposeContentError extends Error {
  constructor(
    readonly code: "IDEMPOTENCY_CONFLICT" | "PROPOSAL_TOO_LARGE" | "VALIDATION_FAILED",
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ProposeContentError";
  }
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function canonicalRequestMetadata(request: Record<string, unknown>) {
  const { payload_digest: _payloadDigest, ...metadata } = request;
  return metadata;
}

function proposalDigest(
  payload: Record<string, unknown>,
  request: Record<string, unknown>,
): string {
  return digest({ payload, request: canonicalRequestMetadata(request) });
}

function legacyRequestMatches(
  existing: AiProposalRecord,
  payload: Record<string, unknown>,
  incomingRequest: Record<string, unknown>,
): boolean {
  const request = existing.request || {};
  if (
    ["caller", "actor", "source", "source_session"].some((field) =>
      Object.prototype.hasOwnProperty.call(request, field),
    )
  )
    return false;
  if (
    request.tool !== incomingRequest.tool ||
    request.idempotency_key !== incomingRequest.idempotency_key
  )
    return false;
  if (
    Object.prototype.hasOwnProperty.call(request, "target") &&
    JSON.stringify(request.target) !== JSON.stringify(incomingRequest.target)
  )
    return false;
  if (incomingRequest.repository_context != null) return false;
  return request.payload_digest === digest(payload);
}

function proposalId(
  sourceApp: string,
  payloadType: ContentProposalPayloadType,
  idempotencyKey: string,
): string {
  const hash = createHash("sha256")
    .update(`${sourceApp}\0${payloadType}\0${idempotencyKey}`)
    .digest("hex");
  const uuidHex = `${hash.slice(0, 12)}5${hash.slice(13, 16)}8${hash.slice(17, 32)}`;
  return `${uuidHex.slice(0, 8)}-${uuidHex.slice(8, 12)}-${uuidHex.slice(12, 16)}-${uuidHex.slice(16, 20)}-${uuidHex.slice(20, 32)}`;
}

function payloadFor(request: ProposeContentRequest): {
  payloadType: ContentProposalPayloadType;
  payload: Record<string, unknown>;
  target?: Record<string, unknown>;
} {
  if (request.kind === "note_create") {
    return {
      payloadType: "notes",
      payload: {
        notes: [
          {
            action: "create",
            title: request.title,
            body: request.body,
            theme: request.theme || "",
            note_type: request.note_type || "memo",
            ...(request.report_date ? { report_date: request.report_date } : {}),
            reason: request.reason || "",
          },
        ],
      },
    };
  }
  if (request.kind === "note_edit") {
    return {
      payloadType: "notes",
      payload: {
        notes: [
          {
            action: "merge",
            target_id: request.note_id,
            base_version: request.base_version,
            title: request.title,
            body: request.body,
            reason: request.reason,
          },
        ],
      },
      target: { type: "note", id: request.note_id, base_version: request.base_version },
    };
  }
  if (request.kind === "knowledge_create") {
    return {
      payloadType: "knowledge_nodes",
      payload: {
        knowledge_nodes: [
          {
            action: "create",
            title: request.title,
            body: request.body || "",
            node_type: request.node_type || "insight",
            theme: request.theme || "",
            confidence: request.confidence || "medium",
            reason: request.reason || "",
          },
        ],
      },
    };
  }
  if (request.kind === "sketch_create") {
    try {
      validateSafeSvg(request.svg);
    } catch (error) {
      throw new ProposeContentError(
        "VALIDATION_FAILED",
        error instanceof Error ? error.message : "SVGが不正です。",
      );
    }
    return {
      payloadType: "sketches",
      payload: {
        sketches: [
          {
            action: "create",
            title: request.title,
            svg: request.svg,
            theme: request.theme || "",
            reason: request.reason || "",
          },
        ],
      },
    };
  }
  const artifact = {
    action: "create",
    title: request.title,
    file_name: request.file_name,
    media_type: request.media_type,
    content: request.content,
    theme: request.theme || "",
    reason: request.reason || "",
  };
  try {
    validateArtifactProposal(artifact);
  } catch (error) {
    throw new ProposeContentError(
      "VALIDATION_FAILED",
      error instanceof Error ? error.message : "Artifactが不正です。",
    );
  }
  return { payloadType: "artifacts", payload: { artifacts: [artifact] } };
}

export class ProposeContentService {
  constructor(
    private readonly writePort: AiProposalWritePort,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  execute(input: ProposeContentRequest): ProposeContentResponse {
    const request = proposeContentRequestSchema.parse(input);
    const sourceApp = request.source_app || "mcp-client";
    const { payloadType, payload, target } = payloadFor(request);
    const id = proposalId(sourceApp, payloadType, request.idempotency_key);
    const proposalRequestBase = {
      tool: TOOL_BY_KIND[request.kind],
      idempotency_key: request.idempotency_key,
      caller: request.caller,
      actor: request.actor,
      source: request.source,
      source_session: request.source_session || null,
      repository_context: request.repository_context || null,
      ...(target ? { target } : {}),
    };
    if (
      Buffer.byteLength(JSON.stringify({ payload, request: proposalRequestBase }), "utf8") >
      MAX_CANONICAL_PROPOSAL_BYTES
    ) {
      throw new ProposeContentError("PROPOSAL_TOO_LARGE", "Proposalは64KiB以下にしてください。");
    }
    const payloadDigest = proposalDigest(payload, proposalRequestBase);
    const proposalRequest = { ...proposalRequestBase, payload_digest: payloadDigest };

    const status = this.writePort.runTransaction((transaction) => {
      const existing = transaction.get(id);
      if (existing) {
        const existingDigest = proposalDigest(existing.payload, existing.request || {});
        const matchesLegacy = legacyRequestMatches(existing, payload, proposalRequestBase);
        if (
          existing.source !== "mcp" ||
          existing.payload_type !== payloadType ||
          (!matchesLegacy && existingDigest !== payloadDigest)
        ) {
          throw new ProposeContentError(
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
        payload_type: payloadType,
        payload,
        request: proposalRequest,
        status: "pending",
        received_at: this.now(),
      };
      transaction.save(proposal);
      return "queued" as const;
    });

    return proposeContentResponseSchema.parse({
      proposal_id: id,
      status,
      payload_type: payloadType,
      message:
        status === "queued"
          ? "TaskenのAI連携にProposalとして送りました。TaskenでPreviewして採用してください。"
          : "同じidempotency_keyのProposalはすでに受信済みです。",
    });
  }
}
