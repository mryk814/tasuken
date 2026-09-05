import { createHash } from "node:crypto";

import {
  hasTaskenUploadImageDestination,
  proposeContentRequestSchema,
  proposeContentResponseSchema,
  type ContentProposalPayloadType,
  type NoteProposalImage,
  type ProposeContentRequest,
  type ProposeContentResponse,
} from "../../../shared/contracts/task/public.ts";
import { validateArtifactProposal, validateSafeSvg } from "../../../shared/proposalMedia.mjs";
import type {
  AiProposalRecord,
  AiProposalTransaction,
  AiProposalWritePort,
} from "../ports/aiProposalWritePort.ts";
import type {
  NoteProposalImageManifestEntry,
  NoteProposalImagePort,
  PreparedNoteProposalImages,
} from "../ports/noteProposalImagePort.ts";

const MAX_CANONICAL_PROPOSAL_BYTES = 64 * 1024;

const TOOL_BY_KIND = {
  note_create: "tasken.propose_note",
  note_edit: "tasken.propose_note_edit",
  knowledge_create: "tasken.propose_knowledge",
  sketch_create: "tasken.propose_sketch",
  artifact_create: "tasken.propose_artifact",
} as const;

const PAYLOAD_TYPE_BY_KIND = {
  note_create: "notes",
  note_edit: "notes",
  knowledge_create: "knowledge_nodes",
  sketch_create: "sketches",
  artifact_create: "artifacts",
} as const satisfies Record<ProposeContentRequest["kind"], ContentProposalPayloadType>;

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

function payloadFor(
  request: ProposeContentRequest,
  preparedImages?: { body: string; manifest: readonly NoteProposalImageManifestEntry[] },
): {
  payload: Record<string, unknown>;
  target?: Record<string, unknown>;
} {
  if (request.kind === "note_create") {
    return {
      payload: {
        notes: [
          {
            action: "create",
            title: request.title,
            body: preparedImages?.body ?? request.body,
            theme: request.theme || "",
            note_type: request.note_type || "memo",
            ...(request.report_date ? { report_date: request.report_date } : {}),
            reason: request.reason || "",
          },
        ],
        ...(preparedImages ? { note_images: preparedImages.manifest } : {}),
      },
    };
  }
  if (request.kind === "note_edit") {
    return {
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
  return { payload: { artifacts: [artifact] } };
}

function prepareNoteImages(
  imagePort: NoteProposalImagePort | undefined,
  proposalId: string,
  body: string,
  images: readonly NoteProposalImage[] | undefined,
):
  | {
      body: string;
      manifest: readonly NoteProposalImageManifestEntry[];
      prepared: unknown;
    }
  | undefined {
  if (!images) {
    if (hasTaskenUploadImageDestination(body)) {
      throw new ProposeContentError(
        "VALIDATION_FAILED",
        "本文の画像プレースホルダーに対応する画像データがありません。画像を添えて再提案してください。",
      );
    }
    return undefined;
  }
  const inputImages = images;
  if (!imagePort) {
    throw new ProposeContentError(
      "VALIDATION_FAILED",
      "画像付きのノートProposalには画像ストレージが必要です。画像を外すか、対応するTasken Coreへ送信してください。",
    );
  }

  let result: PreparedNoteProposalImages;
  try {
    result = imagePort.prepare({ proposalId, body, images: inputImages });
  } catch (error) {
    if (error instanceof ProposeContentError) throw error;
    throw new ProposeContentError(
      "VALIDATION_FAILED",
      error instanceof Error
        ? error.message
        : "ノート画像を準備できませんでした。画像の形式と内容を確認してください。",
    );
  }
  if (typeof result.body !== "string" || result.manifest.length !== inputImages.length) {
    throw new ProposeContentError(
      "VALIDATION_FAILED",
      "ノート画像の準備結果が不正です。画像を確認してProposalを作り直してください。",
    );
  }
  return {
    body: result.body,
    manifest: result.manifest.map((entry) => ({
      reference_id: entry.reference_id,
      file_name: entry.file_name,
      mime_type: entry.mime_type,
      size: entry.size,
      sha256: entry.sha256,
      url: entry.url,
    })),
    prepared: result.prepared,
  };
}

export class ProposeContentService {
  constructor(
    private readonly writePort: AiProposalWritePort,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly noteProposalImagePort?: NoteProposalImagePort,
  ) {}

  execute(input: ProposeContentRequest): ProposeContentResponse {
    const request = proposeContentRequestSchema.parse(input);
    const sourceApp = request.source_app || "mcp-client";
    const payloadType = PAYLOAD_TYPE_BY_KIND[request.kind];
    const id = proposalId(sourceApp, payloadType, request.idempotency_key);
    const preparedImages =
      request.kind === "note_create"
        ? prepareNoteImages(this.noteProposalImagePort, id, request.body, request.images)
        : undefined;
    const { payload, target } = payloadFor(request, preparedImages);
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

    type ExistingStatus =
      { result: "queued" } | { result: "duplicate"; restorePendingImages: boolean };
    const getExistingStatus = (transaction: AiProposalTransaction): ExistingStatus => {
      const existing = transaction.get(id);
      if (!existing) return { result: "queued" };
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
      return {
        result: "duplicate",
        restorePendingImages: existing.status === "pending" && !existing.deleted_at,
      };
    };
    const saveOrFindExisting = () =>
      this.writePort.runTransaction((transaction) => {
        const existing = getExistingStatus(transaction);
        if (existing.result === "duplicate") return existing;
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
        return { result: "queued" } as const;
      });

    let status: "queued" | "duplicate";
    if (!preparedImages) {
      status = saveOrFindExisting().result;
    } else {
      const preflight = this.writePort.runTransaction(getExistingStatus);
      if (preflight.result === "duplicate" && !preflight.restorePendingImages) {
        status = "duplicate";
      } else {
        try {
          this.noteProposalImagePort!.stage(preparedImages.prepared);
        } catch (error) {
          try {
            this.noteProposalImagePort!.rollback(preparedImages.prepared);
          } catch {
            // Preserve the original staging failure after attempting compensating cleanup.
          }
          throw new ProposeContentError(
            "VALIDATION_FAILED",
            error instanceof Error
              ? error.message
              : "ノート画像を保存できませんでした。画像と保存先を確認してください。",
          );
        }
        try {
          const committed = saveOrFindExisting();
          status = committed.result;
          if (committed.result === "duplicate" && !committed.restorePendingImages) {
            this.noteProposalImagePort!.rollback(preparedImages.prepared);
          }
        } catch (error) {
          try {
            this.noteProposalImagePort!.rollback(preparedImages.prepared);
          } catch {
            // Preserve the original database failure after attempting compensating cleanup.
          }
          throw error;
        }
      }
    }

    return proposeContentResponseSchema.parse({
      proposal_id: id,
      status,
      payload_type: payloadType,
      message:
        status === "queued"
          ? preparedImages?.manifest.length
            ? "画像付きNote Proposalを受信しました。このTasken DesktopでPreviewして採用してください。"
            : "TaskenのAI連携にProposalとして送りました。TaskenでPreviewして採用してください。"
          : "同じidempotency_keyのProposalはすでに受信済みです。",
    });
  }
}
