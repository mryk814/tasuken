import { createHash } from "node:crypto";

import {
  AGENT_WORK_RECORD_LIMITS,
  agentWorkRecordFieldsSchema,
  agentWorkRecordPublicSchema,
  recordAgentWorkRequestSchema,
  recordAgentWorkResponseSchema,
  type AgentWorkRecordFields,
  type RecordAgentWorkRequest,
  type RecordAgentWorkResponse,
} from "../../../shared/contracts/task/public.ts";
import type { AgentWorkRecordPort, AgentWorkRecordRow } from "../ports/agentWorkRecordPort.ts";
import { CorePublicError } from "./corePublicError.ts";

/** 書いた経路。folded（移行で畳んだ）は受け口を通らないので、ここには無い。 */
export type AgentWorkWriteBasis = "ai_report" | "log_pickup";

/**
 * 拾い上げ（log_pickup）は、AI が書いた記録の終わりがログの最後の動きの 10 分前より後なら、
 * 同じ作業を書いたとみなして何も書かない（design.md の 3 章）。AI が書く時はゆとりを持たない。
 */
const PICKUP_SLACK_MS = 10 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

function stableId(value: string): string {
  const h = createHash("sha256").update(value).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function time(value: unknown): number {
  return typeof value === "string" ? Date.parse(value) : Number.NaN;
}

export type AgentWorkRangePlan =
  { kind: "covered"; record: AgentWorkRecordRow } | { kind: "write"; startedAt: string | null };

/**
 * 同じ作業を 2 回数えない判定（鍵は client ＋ 会話の ID ＋ 時間の範囲）。判定はここ 1 か所に置く。
 * `prior` は同じ AI の同じ会話の記録（消した物も含む。本人が消した作業を拾い直さないため）。
 * - 新しい終わりが、前の記録の終わり（拾い上げはゆとりを足した時刻）までに収まるなら、もう数えてある。
 * - そうでなければ書く。始まりは前の記録の終わりより前にしない（範囲を重ねない）。省けば前の終わり。
 */
export function planAgentWorkRange(
  prior: readonly AgentWorkRecordRow[],
  incoming: { startedAt: string | null; endedAt: string },
  basis: AgentWorkWriteBasis,
): AgentWorkRangePlan {
  const ends = prior
    .map((record) => ({ record, end: time(record.ended_at) }))
    .filter((entry) => Number.isFinite(entry.end))
    .sort((a, b) => a.end - b.end);
  const latest = ends.at(-1);
  if (!latest) return { kind: "write", startedAt: incoming.startedAt };
  const end = time(incoming.endedAt);
  const slack = basis === "log_pickup" ? PICKUP_SLACK_MS : 0;
  if (end - slack <= latest.end) {
    // 新しい終わりを含む記録のうち、いちばん早く終わる物（その時点の作業を数えた記録）。
    const covering = ends.find((entry) => entry.end + slack >= end) || latest;
    return { kind: "covered", record: covering.record };
  }
  const latestEnd = String(latest.record.ended_at);
  const start = incoming.startedAt;
  return {
    kind: "write",
    startedAt: start === null || time(start) < latest.end ? latestEnd : start,
  };
}

function invalid(field: string, message: string): CorePublicError {
  return new CorePublicError("VALIDATION_FAILED", message, 400, { field });
}

export interface AgentWorkRecordServiceOptions {
  now?: () => string;
}

/**
 * AI が自分の 1 回の作業を要約した記録（AI の作業）を書く、Core の限定の入口（#751）。
 * 本人の記録（Task・Note・Theme）を作らず変えない 1 件だけを足すので、案を通さない（AGENTS.md）。
 * 書き手（written_by）・根拠（basis）・経路（source）は Core が決め、呼び手には選ばせない。
 * 来歴は作らず、保存 1 回で同期の差分が 1 つだけ出る。
 */
export class AgentWorkRecordService {
  private readonly now: () => string;

  constructor(
    private readonly port: AgentWorkRecordPort,
    options: AgentWorkRecordServiceOptions = {},
  ) {
    this.now = options.now || (() => new Date().toISOString());
  }

  record(
    input: RecordAgentWorkRequest,
    basis: AgentWorkWriteBasis = "ai_report",
  ): RecordAgentWorkResponse {
    const request = recordAgentWorkRequestSchema.parse(input);
    const receivedAt = this.now();
    const { dry_run: dryRun, ...identity } = request;
    const fingerprint = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
    const id = stableId(
      JSON.stringify([
        this.port.workspaceId,
        request.source_app,
        "agent_work_record",
        request.idempotency_key,
      ]),
    );
    const endedAt = request.ended_at || receivedAt;
    if (request.started_at && time(request.started_at) > time(endedAt))
      throw invalid("started_at", "started_atがended_atより後です。");
    const repositoryIds = this.repositoryIds(request);
    const changed = request.changed || [];

    return this.port.runTransaction((transaction) => {
      const existing = transaction.get(id);
      if (existing) {
        if (existing.request_fingerprint !== fingerprint)
          throw new CorePublicError(
            "IDEMPOTENCY_CONFLICT",
            "同じidempotency_keyの内容が異なります。",
            409,
            { id },
          );
        return this.response("duplicate", existing);
      }
      const references = [
        ["theme_ids", "theme", request.theme_ids || []],
        ["task_ids", "task", request.task_ids || []],
        ["repository_context_ids", "repository_context", repositoryIds],
      ] as const;
      for (const [field, type, ids] of references) {
        const missing = ids.find((value) => !transaction.exists(type, value));
        if (missing)
          throw new CorePublicError("INVALID_REFERENCE", `${field}に無いIDがあります。`, 400, {
            field,
            id: missing,
          });
      }
      let startedAt = request.started_at || null;
      if (request.source_session) {
        const plan = planAgentWorkRange(
          transaction.listForSession(request.client_kind, request.source_session),
          { startedAt, endedAt },
          basis,
        );
        if (plan.kind === "covered") return this.response("duplicate", plan.record);
        startedAt = plan.startedAt;
      }
      const since = new Date(time(receivedAt) - DAY_MS).toISOString();
      if (
        transaction.countWrittenSince(request.caller, since) >=
        AGENT_WORK_RECORD_LIMITS.perClientPerDay
      )
        throw new CorePublicError(
          "DAILY_LIMIT",
          `AIの作業は1つのclientにつき1日${AGENT_WORK_RECORD_LIMITS.perClientPerDay}件までです。`,
          429,
        );
      const fields: AgentWorkRecordFields = agentWorkRecordFieldsSchema.parse({
        started_at: startedAt,
        ended_at: endedAt,
        client_kind: request.client_kind,
        client_label: request.client_label || null,
        model_label: request.model_label || null,
        source_session_id: request.source_session || null,
        theme_ids: [...new Set(request.theme_ids || [])],
        task_ids: [...new Set(request.task_ids || [])],
        repository_context_ids: repositoryIds,
        intent: request.intent || null,
        summary: request.summary,
        changed: changed.slice(0, AGENT_WORK_RECORD_LIMITS.changedKept),
        changed_more: Math.max(0, changed.length - AGENT_WORK_RECORD_LIMITS.changedKept),
        verified: request.verified || [],
        remaining: request.remaining || [],
        status: request.status,
        notice: request.notice || null,
        basis,
        written_by: request.caller,
        request_fingerprint: fingerprint,
      });
      if (dryRun)
        return this.response("validated", {
          ...fields,
          id,
          created_at: receivedAt,
          deleted_at: null,
        });
      return this.response("recorded", transaction.insert({ ...fields, id }));
    });
  }

  /**
   * AI が自分の書いた記録を取り消す（消した印を付ける。本人は戻せる）。`tasken.undo_change` に
   * 記録の ID を渡すと、ここへ来る。AI の作業の記録でなければ null（Task の取り消しへ回す）。
   * ほかの client が書いた記録は消させない。
   */
  retract(request: {
    change_id?: string;
    caller: string;
  }): { change_id: string; undo_change_id: string; agent_work_record_id: string } | null {
    const id = request.change_id;
    if (!id) return null;
    return this.port.runTransaction((transaction) => {
      const record = transaction.get(id);
      if (!record) return null;
      if (record.written_by !== request.caller)
        throw new CorePublicError(
          "NOT_RECORD_WRITER",
          "自分が書いたAIの作業の記録だけを取り消せます。",
          403,
          { id },
        );
      if (!record.deleted_at) transaction.markDeleted(id);
      return {
        change_id: id,
        undo_change_id: `agent-work-retract:${id}`,
        agent_work_record_id: id,
      };
    });
  }

  /** 書かれたリポジトリのIDと、作業場所から直したID。重ねず、上限を超えたら断る。 */
  private repositoryIds(request: { repository_context_ids?: string[]; cwd?: string }): string[] {
    const ids = [...(request.repository_context_ids || [])];
    if (request.cwd) {
      const resolved = this.port.resolveRepositoryContextId(request.cwd);
      if (resolved) ids.push(resolved);
    }
    const unique = [...new Set(ids)];
    if (unique.length > AGENT_WORK_RECORD_LIMITS.ids)
      throw invalid(
        "repository_context_ids",
        `リポジトリは${AGENT_WORK_RECORD_LIMITS.ids}件までです。`,
      );
    return unique;
  }

  private response(
    status: RecordAgentWorkResponse["status"],
    row: AgentWorkRecordRow,
  ): RecordAgentWorkResponse {
    const publicFields: Record<string, unknown> = {};
    for (const key of Object.keys(agentWorkRecordPublicSchema.shape))
      publicFields[key] = row[key] ?? null;
    return recordAgentWorkResponseSchema.parse({
      schema: "tasken-agent-work-record/v1",
      status,
      id: row.id,
      record: agentWorkRecordPublicSchema.parse({
        ...publicFields,
        created_at: String(row.created_at || ""),
        deleted_at: row.deleted_at || null,
      }),
    });
  }
}
