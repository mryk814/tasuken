import { createHash } from "node:crypto";
import {
  aiItemCreationRequestSchema,
  aiItemCreationResponseSchema,
  type AiItemCreationRequest,
  type AiItemCreationResponse,
} from "../../../shared/contracts/task/public.ts";
import { PERSONAL_DEFAULT_THEME_ID } from "../../../shared/themeRef.mjs";
import { canonicalMarkdownBindingFromProperties } from "../../../shared/canonicalMarkdown.mjs";
import type { CommandEnvelope, CommandReceipt } from "../../../shared/applicationCommand.ts";
import type { CanonicalNoteCreationCompanion, Entity } from "../../../shared/types/workspace.ts";

interface Persistence {
  readonly workspaceId: string;
  get(type: string, id: string, includeDeleted?: boolean): Record<string, unknown> | null;
}
export interface AiItemCreationPort {
  executeTask(command: CommandEnvelope, event: Entity): CommandReceipt;
  recoverNotes(): void;
  saveNote(note: Entity, companion: CanonicalNoteCreationCompanion): Record<string, unknown>;
}

export class AiItemCreationError extends Error {
  constructor(
    readonly code: "IDEMPOTENCY_CONFLICT" | "WRITE_NOT_ALLOWED",
    message: string,
  ) {
    super(message);
    this.name = "AiItemCreationError";
  }
}

function stableId(value: string): string {
  const h = createHash("sha256").update(value).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** The authenticated host supplies one persistence instance; no caller-selected workspace/actor. */
export class AiItemCreationService {
  constructor(
    private readonly persistence: Persistence,
    private readonly port: AiItemCreationPort,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  execute(input: AiItemCreationRequest): AiItemCreationResponse {
    const request = aiItemCreationRequestSchema.parse(input);
    if (request.kind === "note") this.port.recoverNotes();
    const commandId = stableId(
      JSON.stringify([
        this.persistence.workspaceId,
        request.kind,
        request.source_app,
        request.idempotency_key,
      ]),
    );
    const entityId = stableId(`${commandId}:entity`);
    const eventId = `ai-item-created-${commandId}`;
    const fingerprint = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    const previous = this.persistence.get("change_event", eventId, true);
    if (previous) {
      if (previous.command_fingerprint !== fingerprint)
        throw new AiItemCreationError(
          "IDEMPOTENCY_CONFLICT",
          "同じidempotency_keyの内容が異なります。",
        );
      return this.readback(request.kind, entityId, "duplicate");
    }
    if (this.persistence.get(request.kind, entityId, true))
      throw new AiItemCreationError("IDEMPOTENCY_CONFLICT", "同じ作成IDが既に存在します。");
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
      project_id: PERSONAL_DEFAULT_THEME_ID,
      ai_authority: "ai_generated",
      ai_creation: origin,
      ai_seen_at: null,
      ...(request.kind === "task"
        ? {
            description: request.body,
            state: "todo",
            priority: "normal",
            requester: "self",
            intended_executor: "self",
            work_state: "not_delegated",
          }
        : { body_markdown: request.body, note_type: "memo" }),
    };
    // This event and Entity are committed together, including canonical Note recovery.
    const event: Entity = {
      id: eventId,
      entity_type: request.kind,
      record_type: request.kind,
      entity_id: entityId,
      change_type: "created",
      changed_at: receivedAt,
      event_kind: request.kind === "task" ? "task_created" : "note_created",
      occurred_at: receivedAt,
      entity_ref: { type: request.kind, id: entityId },
      ...(request.kind === "task" ? { no_change: true } : {}),
      actor_kind: "ai_agent",
      actor_id: request.caller,
      source: "ai",
      command_source: "mcp",
      command_id: commandId,
      command_name: "CreateAiItem",
      command_fingerprint: fingerprint,
      before_json: "null",
      after_json: JSON.stringify(entity),
      metadata: { ai_creation: origin },
    };
    if (request.kind === "task") {
      this.port.executeTask(
        {
          commandId,
          name: "CreateTask",
          actor: { kind: "ai_agent", id: request.caller },
          source: "mcp",
          issuedAt: receivedAt,
          expectedVersions: [],
          payload: { task: entity },
        },
        event,
      );
    } else {
      this.port.saveNote(entity, {
        schema: "tasken-note-creation-companion/v1",
        noteId: entityId,
        commandId,
        event,
      });
    }
    return this.readback(request.kind, entityId, "created");
  }

  private readback(kind: "task" | "note", id: string, status: "created" | "duplicate") {
    const entity = this.persistence.get(kind, id, true);
    if (!entity) throw new Error("保存済みEntityを読み戻せません。");
    const binding =
      kind === "note"
        ? canonicalMarkdownBindingFromProperties(entity.properties_json, { noteId: id })
        : null;
    return aiItemCreationResponseSchema.parse({
      schema: "tasken-ai-item-creation/v1",
      status,
      workspace_id: this.persistence.workspaceId,
      canonical_node: "this_node",
      entity: {
        type: kind,
        id,
        version: Number(entity.version),
        title: String(entity.title),
        body: String((kind === "note" ? entity.body_markdown : entity.description) || ""),
        deleted_at: entity.deleted_at || null,
        ai_creation: entity.ai_creation,
        ai_seen_at: entity.ai_seen_at || null,
        canonical_sync_state: binding?.sync_state || null,
      },
    });
  }
}
