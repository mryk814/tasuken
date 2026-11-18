import { createHash } from "node:crypto";
import {
  aiDocumentCreationRequestSchema,
  aiDocumentCreationResponseSchema,
  type AiDocumentCreationRequest,
  type AiDocumentCreationResponse,
  type DocumentAsset,
} from "../../../shared/contracts/task/public.ts";
import { hasTaskenUploadAssetReference } from "../../../shared/proposalMedia.mjs";
import { PERSONAL_DEFAULT_THEME_ID } from "../../../shared/themeRef.mjs";
import type { Entity } from "../../../shared/types/workspace.ts";
import type {
  DocumentAssetManifestEntry,
  PreparedDocumentAssets,
} from "../ports/documentAssetPort.ts";
import type { AiDocumentCreationPort } from "../ports/documentCreationPort.ts";
import { CorePublicError, directWriteDisabled } from "./corePublicError.ts";

interface DocumentTransaction {
  get(type: string, id: string, includeDeleted?: boolean): Record<string, unknown> | null;
  save(type: string, entity: Record<string, unknown>): Record<string, unknown>;
}

interface Persistence {
  readonly workspaceId: string;
  get(type: string, id: string, includeDeleted?: boolean): Record<string, unknown> | null;
  runTransaction<T>(callback: (transaction: DocumentTransaction) => T): T;
}

export class AiDocumentCreationError extends Error {
  constructor(
    readonly code: "IDEMPOTENCY_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "AiDocumentCreationError";
  }
}

export interface AiDocumentCreationOptions {
  /**
   * Desktopだけが渡す。本人が設定で直接の書き込みを許しているかを、要求のたびに読む。
   * NAS replicaは配備の書き込み範囲（create-only）を選んだ時点で許しているので渡さない。
   */
  isEnabled?: () => boolean;
  now?: () => string;
}

function stableId(value: string): string {
  const h = createHash("sha256").update(value).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function validationFailed(message: string): CorePublicError {
  return new CorePublicError("VALIDATION_FAILED", message, 400);
}

/**
 * AIがTask配下へDocument（HTML文書）を直接作る限定の入口（#789）。
 * 提案→採用は通らない。Task・Noteの直接作成（AiItemCreationService）と同じ規律：
 * Coreがactorと出所（ai_creation）を固定し、冪等性はChange Eventで担保する。
 * 中身の自己完結HTMLは管理ファイルに置き、Entityにはメタデータだけを持つ
 * （Artifactのmaterializeと同じ理由：本文をEntityや同期差分へ載せない）。
 */
export class AiDocumentCreationService {
  private readonly now: () => string;

  constructor(
    private readonly persistence: Persistence,
    private readonly port: AiDocumentCreationPort,
    private readonly options: AiDocumentCreationOptions = {},
  ) {
    this.now = options.now || (() => new Date().toISOString());
  }

  execute(input: AiDocumentCreationRequest): AiDocumentCreationResponse {
    if (this.options.isEnabled && !this.options.isEnabled()) throw directWriteDisabled();
    const request = aiDocumentCreationRequestSchema.parse(input);
    const commandId = stableId(
      JSON.stringify([
        this.persistence.workspaceId,
        "document",
        request.source_app,
        request.idempotency_key,
      ]),
    );
    const entityId = stableId(`${commandId}:entity`);
    const eventId = `ai-document-created-${commandId}`;
    const fingerprint = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    const previous = this.persistence.get("change_event", eventId, true);
    if (previous) {
      if (previous.command_fingerprint !== fingerprint)
        throw new AiDocumentCreationError(
          "IDEMPOTENCY_CONFLICT",
          "同じidempotency_keyの内容が異なります。",
        );
      return this.readback(entityId, "duplicate");
    }
    if (this.persistence.get("document", entityId, true))
      throw new AiDocumentCreationError("IDEMPOTENCY_CONFLICT", "同じ作成IDが既に存在します。");
    const task = this.persistence.get("task", request.task_id);
    if (!task)
      throw new CorePublicError("INVALID_REFERENCE", "指定したTaskがありません。", 400, {
        field: "task_id",
      });
    const themeId =
      typeof task.project_id === "string" && task.project_id
        ? task.project_id
        : PERSONAL_DEFAULT_THEME_ID;
    if (!this.persistence.get("theme", themeId))
      throw new CorePublicError("INVALID_REFERENCE", "TaskのThemeがありません。", 400, {
        field: "task_id",
      });

    const preparedAssets = this.prepareAssets(commandId, request.content, request.assets);
    let staged = false;
    let writtenFile: { filename: string; size: number; created: boolean } | null = null;
    try {
      if (preparedAssets) {
        try {
          this.port.assets!.stage(preparedAssets.prepared);
          staged = true;
        } catch (error) {
          try {
            this.port.assets!.rollback(preparedAssets.prepared);
          } catch {
            // Preserve the original staging failure after attempting cleanup.
          }
          throw validationFailed(
            error instanceof Error
              ? error.message
              : "アセットを保存できませんでした。アセットと保存先を確認してください。",
          );
        }
      }
      let finalContent = request.content;
      if (preparedAssets) {
        try {
          finalContent = this.port.assets!.inline(
            commandId,
            preparedAssets.manifest,
            request.content,
          );
        } catch (error) {
          throw validationFailed(
            error instanceof Error
              ? error.message
              : "アセットを検証できませんでした。形式と内容を確認してください。",
          );
        }
      }
      try {
        writtenFile = this.port.writeFile({
          fileName: request.file_name,
          content: finalContent,
          materializationKey: commandId,
        });
      } catch (error) {
        throw validationFailed(
          error instanceof Error
            ? error.message
            : "Documentを保存できませんでした。保存先を確認してください。",
        );
      }

      const receivedAt = this.now();
      const origin = {
        schema: "tasken-ai-creation/v1" as const,
        command_id: commandId,
        caller: request.caller,
        source_app: request.source_app,
        source_session: request.source_session || null,
        received_at: receivedAt,
        reason: request.reason,
      };
      const entity: Entity = {
        id: entityId,
        title: request.title,
        filename: writtenFile.filename,
        media_type: "text/html",
        file_size: writtenFile.size,
        sha256: createHash("sha256").update(finalContent).digest("hex"),
        task_id: request.task_id,
        theme_id: themeId,
        description: request.reason || "",
        ai_authority: "ai_generated",
        ai_creation: origin,
        ai_seen_at: null,
      };
      const event: Entity = {
        id: eventId,
        entity_type: "document",
        record_type: "document",
        entity_id: entityId,
        change_type: "created",
        changed_at: receivedAt,
        event_kind: "document_created",
        occurred_at: receivedAt,
        entity_ref: { type: "document", id: entityId },
        actor_kind: "ai_agent",
        actor_id: request.caller,
        source: "ai",
        command_source: "mcp",
        command_id: commandId,
        command_name: "CreateAiDocument",
        command_fingerprint: fingerprint,
        before_json: "null",
        after_json: JSON.stringify(entity),
        metadata: { ai_creation: origin, task_id: request.task_id },
      };
      this.persistence.runTransaction((transaction) => {
        transaction.save("document", entity);
        transaction.save("change_event", event);
      });
    } catch (error) {
      if (writtenFile?.created) {
        try {
          this.port.removeFile(writtenFile.filename);
        } catch {
          // Preserve the original failure after attempting compensating cleanup.
        }
      }
      if (staged && preparedAssets) {
        try {
          this.port.assets!.rollback(preparedAssets.prepared);
        } catch {
          // Preserve the original failure after attempting compensating cleanup.
        }
      }
      throw error;
    }
    if (preparedAssets) {
      try {
        this.port.assets!.discard(commandId, preparedAssets.manifest);
      } catch {
        // The Document is already durable; staged asset cleanup is best effort.
      }
    }
    try {
      this.port.onCommitted?.();
    } catch {
      // The Document is already durable; a failed refresh must not fail the write.
    }
    return this.readback(entityId, "created");
  }

  private prepareAssets(
    creationId: string,
    content: string,
    assets: readonly DocumentAsset[] | undefined,
  ): PreparedDocumentAssets | undefined {
    if (!assets) {
      if (hasTaskenUploadAssetReference(content)) {
        throw validationFailed(
          "本文のアセット参照に対応するデータがありません。アセットを添えて送り直してください。",
        );
      }
      return undefined;
    }
    if (!this.port.assets) {
      throw validationFailed(
        "アセット付きのDocumentにはアセットストレージが必要です。アセットを外すか、対応するTasken Coreへ送信してください。",
      );
    }
    let result: PreparedDocumentAssets;
    try {
      result = this.port.assets.prepare({ creationId, content, assets });
    } catch (error) {
      if (error instanceof CorePublicError) throw error;
      throw validationFailed(
        error instanceof Error
          ? error.message
          : "アセットを準備できませんでした。形式と内容を確認してください。",
      );
    }
    if (!Array.isArray(result.manifest) || result.manifest.length !== assets.length) {
      throw validationFailed(
        "アセットの準備結果が不正です。アセットを確認して送り直してください。",
      );
    }
    return {
      manifest: result.manifest.map((entry) => ({
        reference_id: entry.reference_id,
        file_name: entry.file_name,
        mime_type: entry.mime_type,
        size: entry.size,
        sha256: entry.sha256,
      })),
      prepared: result.prepared,
    };
  }

  private readback(id: string, status: "created" | "duplicate") {
    const entity = this.persistence.get("document", id, true);
    if (!entity) throw new Error("保存済みDocumentを読み戻せません。");
    return aiDocumentCreationResponseSchema.parse({
      schema: "tasken-ai-document-creation/v1",
      status,
      workspace_id: this.persistence.workspaceId,
      canonical_node: "this_node",
      entity: {
        type: "document",
        id,
        version: Number(entity.version),
        title: String(entity.title),
        file_name: String(entity.filename),
        task_id: String(entity.task_id),
        theme_id: typeof entity.theme_id === "string" ? entity.theme_id : null,
        deleted_at: entity.deleted_at || null,
        ai_creation: entity.ai_creation,
        ai_seen_at: entity.ai_seen_at || null,
      },
    });
  }
}
