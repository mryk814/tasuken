import { isoTimestampSchema, localDateSchema, isWellFormedUnicode } from "./kernel/public";

/** Desktop / future clients share this date-precision user-report command. */
export interface RecordWorkLogCommand {
  schemaVersion: 1;
  commandName: "RecordWorkLog";
  commandId: string;
  issuedAt: string;
  body: string;
  performedDate: string;
  themeId?: string | null;
  taskId?: string | null;
}

export interface WorkLogReceipt {
  schemaVersion: 1;
  commandId: string;
  noteId: string;
  noteVersion: 1;
  eventId: string;
  enteredAt: string;
}

export function normalizeWorkLogCommand(value: unknown): RecordWorkLogCommand {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("作業記録の入力が不正です。");
  const input = value as Record<string, unknown>;
  if (
    input.schemaVersion !== 1 ||
    input.commandName !== "RecordWorkLog" ||
    typeof input.commandId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(input.commandId) ||
    typeof input.body !== "string" ||
    !input.body.trim() ||
    !isWellFormedUnicode(input.body) ||
    !isoTimestampSchema.safeParse(input.issuedAt).success ||
    !localDateSchema.safeParse(input.performedDate).success
  )
    throw new Error("本文・実施日・入力日時を確認してください。");
  for (const key of ["themeId", "taskId"])
    if (input[key] != null && (typeof input[key] !== "string" || !String(input[key]).trim()))
      throw new Error("参照先の指定が不正です。");
  return {
    schemaVersion: 1,
    commandName: "RecordWorkLog",
    commandId: input.commandId,
    issuedAt: input.issuedAt as string,
    body: input.body,
    performedDate: input.performedDate as string,
    themeId: (input.themeId as string | null) ?? null,
    taskId: (input.taskId as string | null) ?? null,
  };
}
