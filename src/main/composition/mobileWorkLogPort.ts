import { ApplicationCommandError } from "../../shared/applicationCommand.ts";
import {
  isAiAudienceAllowed,
  normalizeAiVisibility,
  resolveAiVisibility,
} from "../../shared/aiMetadata.mjs";
import type { AdoptWorkLogOrganizationCommand } from "../../shared/workLogOrganization.ts";
import {
  normalizeWorkLogCommand,
  type RecordWorkLogCommand,
  type WorkLogReceipt,
  type WorkLogLifecycleCommand,
  type WorkLogLifecycleReceipt,
} from "../../shared/workLog";
import { mobileWorkLogSchema, type MobileWorkLog } from "../../shared/contracts/mobile/public.ts";
import type {
  MobileGatewayCorePort,
  MobileGatewayWorkLogCommandResult,
} from "../gateway/mobile/public.ts";

export interface WorkLogWriterPort {
  adoptOrganization?(
    command: AdoptWorkLogOrganizationCommand,
    actor: { kind: "user"; id: string },
  ): void;
  record(command: RecordWorkLogCommand, actor: { kind: "user"; id: string }): WorkLogReceipt;
  changeLifecycle(
    command: WorkLogLifecycleCommand,
    actor: { kind: "user"; id: string },
  ): WorkLogLifecycleReceipt;
}

interface WorkLogReadPersistence {
  get(type: string, id: string, includeDeleted?: boolean): Record<string, unknown> | null;
  list(type: string, includeDeleted?: boolean): Record<string, unknown>[];
  readPreference(key: "aiVisibilityDefault"): unknown;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Mobile reads only WorkLog-marked Notes; the writer owns canonical Markdown and transactions. */
export function createMobileWorkLogPort(
  persistence: WorkLogReadPersistence,
  writer?: WorkLogWriterPort,
): Pick<
  MobileGatewayCorePort,
  "getWorkLog" | "canSendWorkLogToExternalAi" | "executeWorkLogCommand"
> {
  if (!writer) return {};
  function getWorkLog(id: string): MobileWorkLog | null {
    const note = persistence.get("note", id, true);
    if (!note) return null;
    const marker = object(object(note.properties_json).work_log);
    if (marker.schema !== "tasken-work-log/v1") return null;
    const taskId = typeof marker.task_id === "string" && marker.task_id ? marker.task_id : null;
    return mobileWorkLogSchema.parse({
      id: note.id,
      version: Number(note.version),
      body: String(note.body_markdown || ""),
      performedDate: marker.performed_date,
      enteredAt: marker.entered_at,
      themeId: typeof note.project_id === "string" && note.project_id ? note.project_id : null,
      taskId,
      taskMissing: Boolean(taskId && !persistence.get("task", taskId)),
      deleted: Boolean(note.deleted_at),
    });
  }
  return {
    getWorkLog,
    canSendWorkLogToExternalAi(id) {
      const note = persistence.get("note", id);
      if (
        !note ||
        note.deleted_at ||
        object(object(note.properties_json).work_log).schema !== "tasken-work-log/v1"
      )
        return false;
      const theme =
        typeof note.project_id === "string" ? persistence.get("theme", note.project_id) : null;
      const visibility = resolveAiVisibility({
        entity: note,
        theme,
        workspaceDefault: normalizeAiVisibility(persistence.readPreference("aiVisibilityDefault")),
      });
      return isAiAudienceAllowed(visibility.audiences, "external_ai");
    },
    executeWorkLogCommand(input): MobileGatewayWorkLogCommandResult {
      const actor = { kind: "user" as const, id: input.actorId };
      const previous = persistence
        .list("change_event", true)
        .find((event) => event.command_id === input.commandId);
      if (previous && previous.command_name !== input.command.name)
        return { ok: false, code: "idempotency_conflict" };
      try {
        let noteId: string;
        let status: "applied" | "no_change";
        if (input.command.name === "RecordWorkLog") {
          let command: RecordWorkLogCommand;
          try {
            command = normalizeWorkLogCommand({
              schemaVersion: 1,
              commandName: "RecordWorkLog",
              commandId: input.commandId,
              issuedAt: input.issuedAt,
              body: input.command.body,
              performedDate: input.command.performedDate,
              themeId: input.command.themeId ?? null,
              taskId: input.command.taskId ?? null,
            });
          } catch {
            return { ok: false, code: "validation_failed" };
          }
          const receipt = writer.record(command, actor);
          noteId = receipt.noteId;
          status = previous ? "no_change" : "applied";
        } else if (input.command.name === "AdoptWorkLogOrganization") {
          if (!writer.adoptOrganization) return { ok: false, code: "validation_failed" };
          writer.adoptOrganization(
            {
              commandId: input.commandId,
              issuedAt: input.issuedAt,
              sourceId: input.command.sourceId,
              sourceVersion: input.command.sourceVersion,
              proposal: input.command.proposal,
            },
            actor,
          );
          noteId = input.command.sourceId;
          status = previous ? "no_change" : "applied";
        } else {
          const receipt = writer.changeLifecycle(
            {
              commandId: input.commandId,
              name: input.command.name,
              noteId: input.command.noteId,
              expectedVersion: input.command.expectedVersion,
              issuedAt: input.issuedAt,
            },
            actor,
          );
          noteId = receipt.noteId;
          status = previous ? "no_change" : receipt.status;
        }
        const workLog = getWorkLog(noteId);
        if (!workLog) return { ok: false, code: "not_found" };
        return { ok: true, commandId: input.commandId, status, workLog };
      } catch (error) {
        if (error instanceof ApplicationCommandError) {
          if (error.code === "COMMAND_ID_REUSED")
            return { ok: false, code: "idempotency_conflict" };
          if (error.code === "NOT_FOUND")
            return {
              ok: false,
              code: error.details?.type === "theme" ? "theme_not_found" : "not_found",
            };
          if (error.code === "CONFLICT") return { ok: false, code: "entity_conflict" };
          return { ok: false, code: "validation_failed" };
        }
        throw error;
      }
    },
  };
}
