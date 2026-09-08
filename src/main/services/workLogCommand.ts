import { createHash } from "node:crypto";
import { buildActivityEvent } from "../../shared/activityEvent.mjs";
import { normalizeWorkLogCommand, type WorkLogReceipt } from "../../shared/workLog";
import type { Entity } from "../../shared/types/workspace";
import type { WorkLogLifecycleCommand } from "../../shared/workLog";
import {
  entityIdSchema,
  entityVersionSchema,
  isoTimestampSchema,
} from "../../shared/kernel/public.ts";
import { ApplicationCommandError } from "../../shared/applicationCommand.ts";
import {
  adoptWorkLogOrganizationSchema,
  validateWorkLogOrganization,
  workLogOrganizationMarkdown,
  type AdoptWorkLogOrganizationCommand,
} from "../../shared/workLogOrganization.ts";

export interface WorkLogLifecycleCommit {
  command: WorkLogLifecycleCommand;
  actor: { kind: "user"; id: string };
  fingerprint: string;
  before: Record<string, unknown>;
  status: "applied" | "no_change";
}

export function normalizeWorkLogLifecycleCommand(
  value: WorkLogLifecycleCommand,
): WorkLogLifecycleCommand {
  if (
    !value ||
    !["DeleteWorkLog", "RestoreWorkLog"].includes(value.name) ||
    !entityIdSchema.safeParse(value.commandId).success ||
    !entityIdSchema.safeParse(value.noteId).success ||
    !entityVersionSchema.safeParse(value.expectedVersion).success ||
    !isoTimestampSchema.safeParse(value.issuedAt).success
  )
    throw new ApplicationCommandError("INVALID_PAYLOAD", "作業記録の削除・復元の入力が不正です。");
  return {
    commandId: value.commandId,
    name: value.name,
    noteId: value.noteId,
    expectedVersion: value.expectedVersion,
    issuedAt: value.issuedAt,
  };
}

export function workLogLifecycleFingerprint(
  command: WorkLogLifecycleCommand,
  actor: { kind: "user"; id: string },
): string {
  return createHash("sha256").update(JSON.stringify({ command, actor })).digest("hex");
}

export function workLogLifecycleEvent(
  commit: WorkLogLifecycleCommit,
  after: Record<string, unknown>,
  acceptedAt: string,
): Entity {
  const receipt = {
    commandId: commit.command.commandId,
    noteId: String(after.id),
    noteVersion: Number(after.version),
    status: commit.status,
  };
  return buildActivityEvent({
    id: `work-log-lifecycle-${commit.command.commandId}`,
    entity_type: "note",
    entity_id: after.id,
    command_id: commit.command.commandId,
    command_name: commit.command.name,
    command_fingerprint: commit.fingerprint,
    actor: commit.actor,
    source: "manual",
    origin: { kind: "mobile" },
    occurred_at: commit.command.issuedAt,
    changed_at: acceptedAt,
    event_kind: commit.command.name === "DeleteWorkLog" ? "entity_deleted" : "note_updated",
    before_json: JSON.stringify(commit.before),
    after_json: JSON.stringify(after),
    metadata: {
      command_source: "mobile",
      include_in_activity: commit.status === "applied",
      work_log_lifecycle: { schema: "tasken-work-log-lifecycle/v1", receipt },
    },
  }) as Entity;
}

export interface WorkLogCompanion {
  schema: "tasken-work-log-companion/v1" | "tasken-work-log-organization-companion/v1";
  noteId: string;
  event: Entity;
}

export function normalizeWorkLogCompanion(value: unknown, noteId: string): WorkLogCompanion | null {
  if (value == null) return null;
  const item = value as WorkLogCompanion;
  const event = item.event;
  let after: Record<string, unknown> = {};
  try {
    after = typeof event?.after_json === "string" ? JSON.parse(event.after_json) : {};
  } catch {
    /* reject below */
  }
  const metadata = event?.metadata as Record<string, unknown> | undefined;
  if (item.schema === "tasken-work-log-organization-companion/v1") {
    const marker = metadata?.work_log_organization as Record<string, unknown> | undefined;
    if (
      item.noteId !== noteId ||
      event?.command_name !== "AdoptWorkLogOrganization" ||
      event.command_id !== noteId ||
      event.entity_type !== "note" ||
      event.entity_id !== noteId ||
      event.id !== `work-log-organization-${noteId}` ||
      event.event_kind !== "note_created" ||
      after.id !== noteId ||
      !/^[a-f0-9]{64}$/.test(String(event.command_fingerprint)) ||
      marker?.schema !== "tasken-work-log-organization/v1" ||
      marker.assertion !== "ai_organized" ||
      typeof marker.source_id !== "string" ||
      !Number.isInteger(marker.source_version)
    )
      throw new Error("作業記録の整理補足の復旧データが不正です。");
    return item;
  }
  const receipt = metadata?.work_log_receipt as WorkLogReceipt | undefined;
  const report = metadata?.work_log as Record<string, unknown> | undefined;
  if (
    item.schema !== "tasken-work-log-companion/v1" ||
    item.noteId !== noteId ||
    !event ||
    event.command_name !== "RecordWorkLog" ||
    event.command_id !== noteId ||
    event.entity_type !== "note" ||
    event.entity_id !== noteId ||
    event.id !== `work-log-${noteId}` ||
    !/^[a-f0-9]{64}$/.test(String(event.command_fingerprint)) ||
    after.id !== noteId ||
    event.event_kind !== "note_created" ||
    receipt?.schemaVersion !== 1 ||
    receipt.noteId !== noteId ||
    receipt.commandId !== noteId ||
    receipt.eventId !== event.id ||
    receipt.noteVersion !== 1 ||
    report?.schema !== "tasken-work-log/v1" ||
    report.assertion !== "user_report" ||
    report.date_precision !== "day"
  )
    throw new Error("作業記録の復旧データが不正です。");
  return item;
}

export function planWorkLogOrganization(
  value: AdoptWorkLogOrganizationCommand,
  source: Record<string, unknown>,
  acceptedAt: string,
  actor: { kind: "user"; id: string },
) {
  const command = adoptWorkLogOrganizationSchema.parse(value);
  const proposal = validateWorkLogOrganization(
    command.proposal,
    String(source.body_markdown || ""),
  );
  const fingerprint = workLogOrganizationFingerprint(command, actor);
  const marker = {
    schema: "tasken-work-log-organization/v1",
    assertion: "ai_organized",
    source_id: command.sourceId,
    source_version: command.sourceVersion,
    proposal,
    adopted_at: command.issuedAt,
  };
  const note: Entity = {
    id: command.commandId,
    title: `AI整理: ${String(source.title || "作業記録").slice(0, 70)}`,
    note_type: "note",
    project_id: source.project_id,
    ai_authority: "ai_generated",
    ...(Array.isArray(source.ai_visibility) ? { ai_visibility: [...source.ai_visibility] } : {}),
    body_markdown: workLogOrganizationMarkdown(proposal, command.sourceId, command.sourceVersion),
    properties_json: { work_log_organization: marker },
  };
  const event = buildActivityEvent({
    id: `work-log-organization-${command.commandId}`,
    entity_type: "note",
    entity_id: note.id,
    event_kind: "note_created",
    command_id: command.commandId,
    command_name: "AdoptWorkLogOrganization",
    command_fingerprint: fingerprint,
    occurred_at: command.issuedAt,
    changed_at: acceptedAt,
    after_json: JSON.stringify(note),
    actor,
    source: "manual",
    summary: "作業記録のAI整理を補足として採用",
    metadata: { work_log_organization: marker },
  }) as Entity;
  return {
    note,
    fingerprint,
    companion: {
      schema: "tasken-work-log-organization-companion/v1",
      noteId: note.id,
      event,
    } satisfies WorkLogCompanion,
  };
}

export function workLogOrganizationFingerprint(
  command: AdoptWorkLogOrganizationCommand,
  actor: { kind: "user"; id: string },
): string {
  return createHash("sha256").update(JSON.stringify({ command, actor })).digest("hex");
}

export function planWorkLog(
  value: unknown,
  acceptedAt: string,
  themeId: string,
  actor: { kind: "user"; id: string },
): {
  note: Entity;
  companion: WorkLogCompanion;
  receipt: WorkLogReceipt;
  fingerprint: string;
} {
  const command = normalizeWorkLogCommand(value);
  if (actor.kind !== "user" || !actor.id.trim()) throw new Error("作業記録の利用者が不正です。");
  const fingerprint = createHash("sha256").update(JSON.stringify({ command, actor })).digest("hex");
  const receipt: WorkLogReceipt = {
    schemaVersion: 1,
    commandId: command.commandId,
    noteId: command.commandId,
    noteVersion: 1,
    eventId: `work-log-${command.commandId}`,
    enteredAt: command.issuedAt,
  };
  const workLog = {
    schema: "tasken-work-log/v1",
    performed_date: command.performedDate,
    date_precision: "day",
    entered_at: command.issuedAt,
    assertion: "user_report",
  };
  const note: Entity = {
    id: command.commandId,
    title: Array.from(command.body.trim().split(/\r?\n/)[0]).slice(0, 80).join(""),
    note_type: "note",
    body_markdown: command.body,
    project_id: themeId,
    properties_json: {
      work_log: {
        ...workLog,
        command_id: command.commandId,
        input_fingerprint: fingerprint,
        actor,
        task_id: command.taskId,
        receipt,
      },
    },
  };
  const event = buildActivityEvent({
    id: receipt.eventId,
    entity_type: "note",
    entity_id: note.id,
    event_kind: "note_created",
    command_id: command.commandId,
    command_name: "RecordWorkLog",
    command_fingerprint: fingerprint,
    occurred_at: command.issuedAt,
    changed_at: acceptedAt,
    after_json: JSON.stringify(note),
    actor,
    source: "manual",
    summary: "やったことを記録（本人の申告）",
    metadata: { work_log: workLog, work_log_receipt: receipt },
  }) as Entity;
  return {
    note,
    companion: { schema: "tasken-work-log-companion/v1", noteId: note.id, event },
    receipt,
    fingerprint,
  };
}
