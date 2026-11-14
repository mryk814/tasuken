import * as z from "zod/v4";

import { entityIdSchema, isoTimestampSchema } from "../../kernel/public.ts";

/**
 * AI の作業（#751）。AI が自分の 1 回の作業を要約した記録で、`entities` の種類
 * `agent_work_record` に 1 件で置く。1 回だけ書き、書き換えない（本人が消すと消した印が付く）。
 * 細かい全部（途中の依頼と回答・前後の写し・命令の全文）は持たない。
 *
 * 上限は「把握できる大きさ」を保つための物で、超えた入力は切り詰めずに断る（何が長いかを返す）。
 * 例外は変えた物の名前の数で、10 件を超えた分は名前を捨てて数だけを `changed_more` に残す。
 */
export const AGENT_WORK_RECORD_LIMITS = Object.freeze({
  label: 80,
  sourceSession: 200,
  ids: 5,
  intent: 160,
  summary: 400,
  changedKept: 10,
  changedItem: 100,
  /** 一度に受ける名前の数。超えた分を数えるだけなので、受ける数は広めにする。 */
  changedReceived: 500,
  listItems: 5,
  listItem: 120,
  notice: 200,
  /** 1 つの client（書き手）が 24 時間に書ける件数。 */
  perClientPerDay: 200,
});

export const AGENT_WORK_STATUSES = ["done", "partial", "blocked"] as const;
/** ai_report = AI が書いた、log_pickup = 終わった会話のログから拾った、folded = 移行で畳んだ。 */
export const AGENT_WORK_BASES = ["ai_report", "log_pickup", "folded"] as const;

/** 端末の場所を記録に入れない。絶対パス・file URL・ホームからの名前を断る。 */
function isTerminalLocation(value: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|[\\/]|~[\\/]|file:)/i.test(value);
}

const NO_LOCATION_MESSAGE =
  "端末の場所（絶対パス）は入れられません。リポジトリからの相対の名前にしてください。";

const label = z.string().trim().min(1).max(AGENT_WORK_RECORD_LIMITS.label);
const sourceSession = z
  .string()
  .trim()
  .min(1)
  .max(AGENT_WORK_RECORD_LIMITS.sourceSession)
  .refine((value) => !isTerminalLocation(value), NO_LOCATION_MESSAGE);
const relatedIds = z.array(entityIdSchema).max(AGENT_WORK_RECORD_LIMITS.ids);
const changedName = z
  .string()
  .trim()
  .min(1)
  .max(AGENT_WORK_RECORD_LIMITS.changedItem)
  .refine((value) => !isTerminalLocation(value), NO_LOCATION_MESSAGE);
const shortList = z
  .array(z.string().trim().min(1).max(AGENT_WORK_RECORD_LIMITS.listItem))
  .max(AGENT_WORK_RECORD_LIMITS.listItems);

/** 保存する中身（`data_json`）。共通の列（id・版・消した印など）は repository が持つ。 */
export const agentWorkRecordFieldsSchema = z
  .object({
    started_at: isoTimestampSchema.nullable(),
    ended_at: isoTimestampSchema,
    client_kind: label,
    client_label: label.nullable(),
    model_label: label.nullable(),
    source_session_id: sourceSession.nullable(),
    theme_ids: relatedIds,
    task_ids: relatedIds,
    repository_context_ids: relatedIds,
    intent: z.string().trim().min(1).max(AGENT_WORK_RECORD_LIMITS.intent).nullable(),
    summary: z.string().trim().min(1).max(AGENT_WORK_RECORD_LIMITS.summary),
    changed: z.array(changedName).max(AGENT_WORK_RECORD_LIMITS.changedKept),
    changed_more: z.number().int().nonnegative(),
    verified: shortList,
    remaining: shortList,
    status: z.enum(AGENT_WORK_STATUSES),
    notice: z.string().trim().min(1).max(AGENT_WORK_RECORD_LIMITS.notice).nullable(),
    basis: z.enum(AGENT_WORK_BASES),
    written_by: label,
    /** 同じ idempotency_key の再送が同じ中身かを見る要約値。中身そのものは持たない。 */
    request_fingerprint: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
  })
  .strict();

export type AgentWorkRecordFields = z.output<typeof agentWorkRecordFieldsSchema>;

const COMMON_COLUMNS = [
  "id",
  "created_at",
  "updated_at",
  "deleted_at",
  "device_id",
  "version",
  "source",
] as const;
const RECORD_FIELDS = Object.keys(agentWorkRecordFieldsSchema.shape);

/**
 * 保存の境界（repository）で、決まった欄だけを残して確かめる。知らない欄は保存しない
 * （同期で届いた差分に余計な欄があっても、記録を大きくしない）。
 */
export function normalizeAgentWorkRecord(input: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const key of RECORD_FIELDS) fields[key] = input[key];
  const parsed = agentWorkRecordFieldsSchema.safeParse(fields);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `agent_work_record.${issue?.path.join(".") || "?"}が不正です（${issue?.message || "値が不正です"}）。`,
    );
  }
  const common: Record<string, unknown> = {};
  for (const key of COMMON_COLUMNS) if (key in input) common[key] = input[key];
  return { ...common, ...parsed.data };
}

/**
 * Core の受け口（`/v1/commands/record-agent-work`）の入力。書き手・経路・根拠は Core が決める。
 * MCP の `tasken.report_work`（Task を伴わない呼び出し）がここへ送る。
 */
export const recordAgentWorkRequestSchema = z
  .object({
    idempotency_key: z.string().trim().min(1).max(200),
    caller: label.describe("Writer name; HTTP forces the verified client name."),
    source_app: z.string().trim().min(1).max(120).default("mcp-client"),
    source_session: sourceSession.optional(),
    client_kind: label,
    client_label: label.optional(),
    model_label: label.optional(),
    started_at: isoTimestampSchema.optional(),
    ended_at: isoTimestampSchema.optional(),
    status: z.enum(AGENT_WORK_STATUSES),
    summary: z.string().trim().min(1).max(AGENT_WORK_RECORD_LIMITS.summary),
    intent: z.string().trim().min(1).max(AGENT_WORK_RECORD_LIMITS.intent).optional(),
    changed: z.array(changedName).max(AGENT_WORK_RECORD_LIMITS.changedReceived).optional(),
    verified: shortList.optional(),
    remaining: shortList.optional(),
    notice: z.string().trim().min(1).max(AGENT_WORK_RECORD_LIMITS.notice).optional(),
    theme_ids: relatedIds.optional(),
    task_ids: relatedIds.optional(),
    repository_context_ids: relatedIds.optional(),
    /** 作業場所。今ある解決の道でリポジトリに直すだけで、場所そのものは保存しない。 */
    cwd: z.string().trim().min(1).max(2_000).optional(),
    dry_run: z.boolean().optional(),
  })
  .strict();

export const agentWorkRecordPublicSchema = agentWorkRecordFieldsSchema
  .omit({ request_fingerprint: true })
  .extend({
    id: z.string(),
    created_at: z.string(),
    deleted_at: z.string().nullable(),
  })
  .strict();

export const recordAgentWorkResponseSchema = z
  .object({
    schema: z.literal("tasken-agent-work-record/v1"),
    /** recorded = 新しく 1 件書いた。duplicate = 同じ作業の記録が既にある（返すのはその記録）。validated = dry_run。 */
    status: z.enum(["recorded", "duplicate", "validated"]),
    id: z.string(),
    record: agentWorkRecordPublicSchema,
  })
  .strict();

export type RecordAgentWorkRequest = z.input<typeof recordAgentWorkRequestSchema>;
export type RecordAgentWorkResponse = z.output<typeof recordAgentWorkResponseSchema>;
export type AgentWorkRecordPublic = z.output<typeof agentWorkRecordPublicSchema>;
