import { createHash } from "node:crypto";
import {
  aiItemCreationRequestSchema,
  aiItemCreationResponseSchema,
  hasTaskenUploadImageDestination,
  taskScheduleEditFromAiInput,
  type AiItemCreationRequest,
  type AiItemCreationResponse,
  type NoteProposalImage,
} from "../../../shared/contracts/task/public.ts";
import { PERSONAL_DEFAULT_THEME_ID } from "../../../shared/themeRef.mjs";
import { canonicalMarkdownBindingFromProperties } from "../../../shared/canonicalMarkdown.mjs";
import type { CommandEnvelope, CommandReceipt } from "../../../shared/applicationCommand.ts";
import type { CanonicalNoteCreationCompanion, Entity } from "../../../shared/types/workspace.ts";
import type {
  NoteProposalImagePort,
  PreparedNoteProposalImages,
} from "../ports/noteProposalImagePort.ts";
import { CorePublicError, directWriteDisabled } from "./corePublicError.ts";

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

export interface AiItemCreationOptions {
  /**
   * Desktopだけが渡す。本人が設定で直接の書き込みを許しているかを、要求のたびに読む。
   * NAS replicaは配備の書き込み範囲（create-only）を選んだ時点で許しているので渡さない。
   */
  isEnabled?: () => boolean;
  /** Note作成時の添付画像を検証・保存するport。 */
  noteProposalImagePort?: NoteProposalImagePort;
  now?: () => string;
}

function stableId(value: string): string {
  const h = createHash("sha256").update(value).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** The authenticated host supplies one persistence instance; no caller-selected workspace/actor. */
export class AiItemCreationService {
  private readonly now: () => string;

  constructor(
    private readonly persistence: Persistence,
    private readonly port: AiItemCreationPort,
    private readonly options: AiItemCreationOptions = {},
  ) {
    this.now = options.now || (() => new Date().toISOString());
  }

  execute(input: AiItemCreationRequest): AiItemCreationResponse {
    if (this.options.isEnabled && !this.options.isEnabled()) throw directWriteDisabled();
    const request = aiItemCreationRequestSchema.parse(input);
    // NASとDesktopで受ける欄は同じにする。案内（inputSchema）に載る欄を一部の接続先だけが断ると、
    // AIは送って403を受けるまで分からない（#721）。
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
    // Noteの紐づけ先Task。Themeの検証と同じく、無いTaskへは作らない。
    const targetTask =
      request.kind === "note" && request.task_id
        ? this.persistence.get("task", request.task_id, true)
        : null;
    if (request.kind === "note" && request.task_id && (!targetTask || targetTask.deleted_at))
      throw new CorePublicError("INVALID_REFERENCE", "指定したTaskがありません。", 400, {
        field: "task_id",
      });
    // 紐づけ先Taskがあるとき、Themeの指定が無ければTaskのThemeを引き継ぐ
    // （Focus SessionのNoteと同じ置き方）。明示されたThemeは従来どおり優先する。
    const themeId =
      request.theme_id ||
      (typeof targetTask?.project_id === "string" && targetTask.project_id
        ? targetTask.project_id
        : PERSONAL_DEFAULT_THEME_ID);
    if (!this.persistence.get("theme", themeId))
      throw new CorePublicError("INVALID_REFERENCE", "指定したThemeがありません。", 400, {
        field: "theme_id",
      });
    const preparedImages =
      request.kind === "note"
        ? this.prepareNoteImages(commandId, request.body, request.images)
        : undefined;
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
    // 指定されなかった欄は足さない。NAS replicaの同期差分の形（contracts/sync/ai-item-packets.json）を、
    // 欄を使わない作成では変えないため。
    const entity: Entity = {
      id: entityId,
      title: request.title,
      project_id: themeId,
      ai_authority: "ai_generated",
      ai_creation: origin,
      ai_seen_at: null,
      ...(request.kind === "task"
        ? {
            description: request.body,
            state: "todo",
            priority: request.priority || "normal",
            requester: "self",
            intended_executor: "self",
            work_state: "not_delegated",
            ...(request.today_date ? { today_date: request.today_date } : {}),
            ...(request.reminder_at ? { reminder_at: request.reminder_at } : {}),
            ...(request.place_reminder ? { place_reminder: request.place_reminder } : {}),
            ...(request.checklist?.length
              ? {
                  checklist_items: request.checklist.map((title, index) => ({
                    id: stableId(`${commandId}:checklist:${index}`),
                    title,
                    done: false,
                    sort_order: index,
                  })),
                }
              : {}),
          }
        : {
            body_markdown: preparedImages?.body ?? request.body,
            note_type: request.note_type || "memo",
            // 日報の日付は、提案の採用と同じくproperties_json.daily_reportに置く（Debriefが読む場所）。
            ...(request.report_date
              ? { properties_json: { daily_report: { date: request.report_date } } }
              : {}),
          }),
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
      const schedule = request.schedule
        ? {
            ...taskScheduleEditFromAiInput(request.schedule),
            id: stableId(`${commandId}:schedule`),
            owner_type: "task",
            owner_id: entityId,
            version: 0,
            updated_at: receivedAt,
          }
        : null;
      this.port.executeTask(
        {
          commandId,
          name: "CreateTask",
          actor: { kind: "ai_agent", id: request.caller },
          source: "mcp",
          issuedAt: receivedAt,
          expectedVersions: [],
          payload: { task: entity, ...(schedule ? { schedule } : {}) },
        },
        event,
      );
    } else {
      if (preparedImages) {
        try {
          this.options.noteProposalImagePort!.stage(preparedImages.prepared);
        } catch (error) {
          try {
            this.options.noteProposalImagePort!.rollback(preparedImages.prepared);
          } catch {
            // Preserve the original staging failure after attempting compensating cleanup.
          }
          throw new CorePublicError(
            "VALIDATION_FAILED",
            error instanceof Error
              ? error.message
              : "ノート画像を保存できませんでした。画像と保存先を確認してください。",
            400,
          );
        }
      }
      // saveNote が投げても画像は消さない。Canonical Markdown は、ファイルと復旧用のreceiptを書いた後に
      // DBへの保存が失敗しうる（次回のrecoverNotesでNoteが確定する）ほか、DBの確定後に通知で投げることもある。
      // そこで消すと、確定したNoteの本文に壊れた添付URLだけが残る。残った画像は決定的な名前なので
      // 同じidempotency_keyの再送が再利用し、本文から参照されない間は同期にも載らない。
      this.port.saveNote(entity, {
        schema: "tasken-note-creation-companion/v1",
        noteId: entityId,
        commandId,
        event,
        ...(targetTask
          ? {
              taskLink: this.taskLink(
                commandId,
                entityId,
                String(targetTask.id),
                request,
                fingerprint,
                origin,
                receivedAt,
              ),
            }
          : {}),
      });
    }
    return this.readback(request.kind, entityId, "created");
  }

  private prepareNoteImages(
    commandId: string,
    body: string,
    images: readonly NoteProposalImage[] | undefined,
  ): PreparedNoteProposalImages | undefined {
    if (!images) {
      if (hasTaskenUploadImageDestination(body)) {
        throw new CorePublicError(
          "VALIDATION_FAILED",
          "本文の画像プレースホルダーに対応する画像データがありません。画像を添えて送り直してください。",
          400,
        );
      }
      return undefined;
    }
    const imagePort = this.options.noteProposalImagePort;
    if (!imagePort) {
      throw new CorePublicError(
        "VALIDATION_FAILED",
        "画像付きのNoteには画像ストレージが必要です。画像を外すか、対応するTasken Coreへ送信してください。",
        400,
      );
    }
    let result: PreparedNoteProposalImages;
    try {
      result = imagePort.prepare({ proposalId: commandId, body, images });
    } catch (error) {
      if (error instanceof CorePublicError) throw error;
      throw new CorePublicError(
        "VALIDATION_FAILED",
        error instanceof Error
          ? error.message
          : "ノート画像を準備できませんでした。画像の形式と内容を確認してください。",
        400,
      );
    }
    if (typeof result.body !== "string" || result.manifest.length !== images.length) {
      throw new CorePublicError(
        "VALIDATION_FAILED",
        "ノート画像の準備結果が不正です。画像を確認して送り直してください。",
        400,
      );
    }
    return result;
  }

  /**
   * Note→Taskの紐づけ。関連そのものは作成コマンドの機械的な同伴物なので、
   * AIの「提案」としての関連付け（origin: ai_suggested、採用の証跡が要る）とは分け、
   * system_actionとして、証跡にNote自身と作成コマンドを残す。IDはコマンドから
   * 決定的に導くので、再送・復旧で二重に作られない。
   */
  private taskLink(
    commandId: string,
    noteId: string,
    taskId: string,
    request: AiItemCreationRequest,
    fingerprint: string,
    origin: Record<string, unknown>,
    receivedAt: string,
  ): { reference: Entity; event: Entity } {
    const referenceId = stableId(`${commandId}:task-link`);
    const reference: Entity = {
      id: referenceId,
      source_type: "note",
      source_id: noteId,
      target_type: "task",
      target_id: taskId,
      relation_type: "related_to",
      layer: "operational",
      status: "asserted",
      origin: "system_action",
      evidence_refs: [{ type: "note", id: noteId }],
      metadata: { created_via: "create_ai_item", command_id: commandId },
      recorded_at: receivedAt,
    };
    const event: Entity = {
      id: `ai-item-task-link-${commandId}`,
      entity_type: "reference",
      record_type: "reference",
      entity_id: referenceId,
      change_type: "created",
      changed_at: receivedAt,
      event_kind: "reference_created",
      occurred_at: receivedAt,
      entity_ref: { type: "reference", id: referenceId },
      actor_kind: "ai_agent",
      actor_id: request.caller,
      source: "ai",
      command_source: "mcp",
      command_id: commandId,
      command_name: "CreateAiItem",
      command_fingerprint: fingerprint,
      before_json: "null",
      after_json: JSON.stringify(reference),
      metadata: { ai_creation: origin },
    };
    return { reference, event };
  }

  private readback(kind: "task" | "note", id: string, status: "created" | "duplicate") {
    const entity = this.persistence.get(kind, id, true);
    if (!entity) throw new Error("保存済みEntityを読み戻せません。");
    const binding =
      kind === "note"
        ? canonicalMarkdownBindingFromProperties(entity.properties_json, { noteId: id })
        : null;
    // 紐づけは応答の利便のためだけに読み戻す。正本はReferenceであり、
    // 本人が関連を消した後の再送では、消えたまま（null）で返す。
    let taskId: string | null = null;
    if (kind === "note") {
      const origin = entity.ai_creation as { command_id?: unknown } | undefined;
      if (typeof origin?.command_id === "string") {
        const reference = this.persistence.get(
          "reference",
          stableId(`${origin.command_id}:task-link`),
          true,
        );
        if (reference && !reference.deleted_at && typeof reference.target_id === "string")
          taskId = reference.target_id;
      }
    }
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
        theme_id: typeof entity.project_id === "string" ? entity.project_id : null,
        task_id: taskId,
        deleted_at: entity.deleted_at || null,
        ai_creation: entity.ai_creation,
        ai_seen_at: entity.ai_seen_at || null,
        canonical_sync_state: binding?.sync_state || null,
      },
    });
  }
}
