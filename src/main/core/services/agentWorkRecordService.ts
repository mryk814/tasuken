import { createHash } from "node:crypto";

import {
  AGENT_WORK_RECORD_LIMITS,
  agentWorkRecordFieldsSchema,
  agentWorkRecordPublicSchema,
  normalizeAgentClientKind,
  recordAgentWorkRequestSchema,
  recordAgentWorkResponseSchema,
  type AgentWorkRecordFields,
  type RecordAgentWorkRequest,
  type RecordAgentWorkResponse,
} from "../../../shared/contracts/task/public.ts";
import { containsSecretLike } from "../../../shared/taskContext.mjs";
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
const FUTURE_TOLERANCE_MS = 5 * 60_000;

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

/** 拾い上げの書き手の名前。Core が固定する（呼び手には選ばせない）。 */
export const AGENT_WORK_PICKUP_WRITER = "Tasken log pickup";
const PICKUP_SOURCE_APP = "tasken-log-pickup";

/**
 * 静かになった会話 1 つを、ログから拾った物。変えた物・確かめたこと・残りは持たない
 * （ログから推測で作らない）。`cwd` はリポジトリに直すだけで、保存しない。
 */
export interface AgentWorkPickupRequest {
  client_kind: string;
  source_session: string;
  started_at: string;
  /** ログの最後の動き。 */
  ended_at: string;
  /** 最後の回答の先頭。 */
  summary: string;
  /** 最初の依頼の先頭。 */
  intent?: string | null;
  cwd?: string | null;
}

export interface AgentWorkPickupResult {
  /** recorded = 新しく 1 件書いた。covered = もう数えてある（AI が書いた・前に拾った・本人が消した）。 */
  status: "recorded" | "covered";
  id: string | null;
}

/** 上限を超えた字を切る（最後の 1 字を「…」にする）。読み替え（agentWorkCard）と同じ切り方。 */
function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** 古い会話（agent_session）の終わり。記録された終わり、無ければ最後に見た時刻、無ければ始まり。 */
function legacySessionEnd(session: AgentWorkRecordRow): string | null {
  const observation = session.observation as { observed_until?: unknown } | null | undefined;
  for (const value of [session.ended_at, observation?.observed_until, session.started_at])
    if (Number.isFinite(time(value))) return String(value);
  return null;
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

  record(input: RecordAgentWorkRequest): RecordAgentWorkResponse {
    const parsed = recordAgentWorkRequestSchema.parse(input);
    const request = { ...parsed, client_kind: normalizeAgentClientKind(parsed.client_kind) };
    const receivedAt = this.now();
    // 先の時刻を受けると、同じ会話の後の報告がその時刻まで duplicate で捨てられる
    // （時差を Z と書き違えた時など）。時計のずれを見て 5 分までは受ける。
    for (const field of ["started_at", "ended_at"] as const) {
      const value = request[field];
      if (value && time(value) > time(receivedAt) + FUTURE_TOLERANCE_MS)
        throw invalid(
          field,
          `${field}が受け取った時刻より先です。時差の書き方を確かめてください。`,
        );
    }
    for (const [field, values] of [
      ["summary", [request.summary]],
      ["intent", [request.intent]],
      ["notice", [request.notice]],
      ["changed", request.changed || []],
      ["verified", request.verified || []],
      ["remaining", request.remaining || []],
      ["client_label", [request.client_label]],
      ["model_label", [request.model_label]],
      ["source_session", [request.source_session]],
    ] as const) {
      if (values.some((value) => value && containsSecretLike(value)))
        throw invalid(field, `${field}に秘密の情報（トークン・鍵など）らしい文字列があります。`);
    }
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
        const prior = transaction.listForSession(request.client_kind, request.source_session);
        const plan = planAgentWorkRange(
          // AI が書く時は、同じ書き手が取り消した記録を数えない（取り消して書き直せるように）。
          // 拾い上げ（pickUp）は消した記録も数える（本人が消した作業を拾い直さない）。
          prior.filter((record) => !(record.deleted_at && record.written_by === request.caller)),
          { startedAt, endedAt },
          "ai_report",
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
        basis: "ai_report",
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
   * ログからの拾い上げ（#751 PR 3）。Desktop の中からだけ呼ぶ（HTTP の受け口には出さない）。
   * 同じ作業を 2 回数えない判定は、AI が書く時と同じ `planAgentWorkRange` に通す。数える前の記録は:
   * - 同じ AI の同じ会話の記録（消した物も含む。本人が消した作業を拾い直さない）。
   * - 同じ AI の同じ会話の、古い会話（agent_session。移行までの間。消した物も含む）。
   * - 会話の ID が違っても、同じ AI が同じリポジトリについて書いた記録のうち、時間の範囲が
   *   重なる物。AI は自分の会話の ID を知らない事が多く、ID だけで見ると 2 件になるため。
   * 続きが長い時は、続きの分だけを書く（始まり = 前の記録の終わり）。
   * 記録の ID は「会話 ＋ 範囲の始まり」から作るので、読み直しても 2 件にならない。
   * 1 日の件数の上限は掛けない（上限は外の client の書き過ぎを止める物。拾い上げは、本人が
   * 登録した保存先の会話の数だけしか書かない）。
   */
  pickUp(input: AgentWorkPickupRequest): AgentWorkPickupResult {
    const clientKind = normalizeAgentClientKind(input.client_kind);
    const request = recordAgentWorkRequestSchema.parse({
      idempotency_key: `log-pickup:${clientKind}:${input.source_session}`.slice(0, 200),
      caller: AGENT_WORK_PICKUP_WRITER,
      source_app: PICKUP_SOURCE_APP,
      source_session: input.source_session,
      client_kind: clientKind,
      started_at: input.started_at,
      ended_at: input.ended_at,
      // ログからは、終わったのか止まったのかが分からない（古い会話の読み替えと同じ扱い）。
      status: "partial",
      summary: clip(input.summary.trim(), AGENT_WORK_RECORD_LIMITS.summary),
      ...(input.intent?.trim()
        ? { intent: clip(input.intent.trim(), AGENT_WORK_RECORD_LIMITS.intent) }
        : {}),
    });
    const sourceSession = request.source_session!;
    const logStart = time(request.started_at);
    const logEnd = time(request.ended_at);
    if (!(logStart <= logEnd)) throw invalid("started_at", "started_atがended_atより後です。");
    const resolved = input.cwd ? this.port.resolveRepositoryContextId(input.cwd) : null;
    const repositoryIds = resolved ? [resolved] : [];

    return this.port.runTransaction((transaction): AgentWorkPickupResult => {
      const prior: AgentWorkRecordRow[] = [
        ...transaction.listForSession(clientKind, sourceSession),
        ...transaction.listLegacySessions(clientKind, sourceSession).flatMap((session) => {
          const end = legacySessionEnd(session);
          return end ? [{ id: session.id, ended_at: end }] : [];
        }),
      ];
      if (repositoryIds.length) {
        const known = new Set(prior.map((record) => record.id));
        // 記録は終わってから書かれる（先の時刻は 5 分までしか受けない）ので、会話の始まりより
        // 前に書かれた記録は重ならない。ゆとりを足して、読む数を絞る。
        const since = new Date(logStart - PICKUP_SLACK_MS - FUTURE_TOLERANCE_MS).toISOString();
        for (const record of transaction.listReportsForRepositories(
          clientKind,
          repositoryIds,
          since,
        )) {
          if (known.has(record.id) || record.basis !== "ai_report") continue;
          const end = time(record.ended_at);
          const start = Number.isFinite(time(record.started_at)) ? time(record.started_at) : end;
          if (end >= logStart && start <= logEnd) prior.push(record);
        }
      }
      const plan = planAgentWorkRange(
        prior,
        { startedAt: request.started_at!, endedAt: request.ended_at! },
        "log_pickup",
      );
      if (plan.kind === "covered") return { status: "covered", id: plan.record.id };
      const startedAt = plan.startedAt!;
      const id = stableId(
        JSON.stringify([
          this.port.workspaceId,
          "agent_work_record",
          "log_pickup",
          clientKind,
          sourceSession,
          new Date(time(startedAt)).toISOString(),
        ]),
      );
      if (transaction.get(id)) return { status: "covered", id };
      const fields: AgentWorkRecordFields = agentWorkRecordFieldsSchema.parse({
        started_at: startedAt,
        ended_at: request.ended_at,
        client_kind: clientKind,
        client_label: null,
        model_label: null,
        source_session_id: sourceSession,
        theme_ids: [],
        task_ids: [],
        repository_context_ids: repositoryIds,
        intent: request.intent || null,
        summary: request.summary,
        changed: [],
        changed_more: 0,
        verified: [],
        remaining: [],
        status: request.status,
        notice: null,
        basis: "log_pickup",
        written_by: AGENT_WORK_PICKUP_WRITER,
        request_fingerprint: null,
      });
      return { status: "recorded", id: transaction.insert({ ...fields, id }).id };
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
