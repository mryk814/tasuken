import { createHash } from "node:crypto";
import { buildActivityEvent } from "../../shared/activityEvent.mjs";
import { normalizeWorkLogCommand, type WorkLogReceipt } from "../../shared/workLog";
import type { Entity } from "../../shared/types/workspace";

export interface WorkLogCompanion {
  schema: "tasken-work-log-companion/v1";
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
