import { createHash } from "node:crypto";

import {
  TASK_CONTRACT_SCHEMA_VERSION,
  aiChangeUndoRequestSchema,
  aiChangeUndoResponseSchema,
  aiTaskChangeRequestSchema,
  aiTaskChangeResponseSchema,
  taskScheduleEditFromAiInput,
  type AiChangeUndoRequest,
  type AiChangeUndoResponse,
  type AiTaskChangeRequest,
  type AiTaskChangeResponse,
  type TaskCommand,
  type TaskCommandResponse,
  type TaskReadModel,
} from "../../../shared/contracts/task/public.ts";
import type { Entity } from "../../../shared/types/workspace.ts";
import { CorePublicError, directWriteDisabled } from "./corePublicError.ts";

/** 一つの会話（source_session）が、本人に確かめずに変えてよいTaskの数（本人の判断、2026-11-08）。 */
export const AI_DIRECT_CHANGE_BULK_LIMIT = 30;

/** 委任した作業の最中。AIが自分の作業を直接いじると、本人が報告を採用する流れを迂回するので断る。 */
const IN_FLIGHT_WORK_STATES = new Set([
  "in_progress",
  "reported_done",
  "needs_human_review",
  "blocked",
]);

/** 取り消しで前の値に戻す欄。AIが直接変えてよい欄（aiTaskEditSchema）の、保存上の名前。 */
const REVERTIBLE_TASK_FIELDS = [
  "title",
  "description",
  "project_id",
  "priority",
  "today_date",
  "planning_shelf",
  "planned_start_time",
  "planned_duration_minutes",
  "reminder_at",
  "checklist_items",
  "intended_executor",
  "handoff_expected_result",
  "handoff_instruction",
] as const;

/** 元のTaskに無かった欄を戻すときの値（nullを受けない欄だけ）。 */
const EMPTY_TASK_FIELD: Record<string, unknown> = {
  checklist_items: [],
  priority: "normal",
  intended_executor: "self",
};

interface Persistence {
  readonly workspaceId: string;
  get(type: string, id: string, includeDeleted?: boolean): Entity | null;
  save(type: "change_event", entity: Entity): Entity;
  listChangeEventsByCommandId(commandId: string): Entity[];
  changeEventCommandIdsWithPrefix(prefix: string): Set<string>;
  listChangeEventsForEntity(recordType: string, entityId: string): Entity[];
  hasSyncConflict(entityType: string, entityId: string): boolean;
}

export interface AiTaskChangePort {
  /** Task commandをai_agentとして実行し、`annotation`を全Change Eventの`metadata.ai_direct`に付ける。 */
  executeTaskCommand(
    command: TaskCommand,
    annotation: Record<string, unknown>,
  ): TaskCommandResponse;
  /** 削除したTaskを戻す（削除の取り消し）。 */
  restoreTask(
    input: {
      commandId: string;
      taskId: string;
      expectedVersion: number;
      actor: { kind: "ai_agent" | "user"; id?: string };
      source: "mcp" | "main_ui";
      issuedAt: string;
    },
    annotation: Record<string, unknown>,
  ): void;
  /** 削除済みを含む今のTask（日程つき）。 */
  readTask(taskId: string): TaskReadModel | null;
}

export interface AiTaskChangeOptions {
  /** 本人が設定で直接の書き込みを許しているか。要求のたびに読む。 */
  isEnabled: () => boolean;
  now?: () => string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sessionKey(session: string): string {
  return sha256(session).slice(0, 16);
}

/**
 * AIの直接変更のcommand_id。会話ごとの接頭辞を付け、command_idの索引だけで
 * 「この会話で変えたもの」を引けるようにする（新しい表を作らない）。
 */
function changePrefix(session: string): string {
  return `ai-change:${sessionKey(session)}:`;
}
function undoPrefix(session: string): string {
  return `ai-undo:${sessionKey(session)}:`;
}

function aiDirect(event: Entity | undefined): Record<string, unknown> | null {
  const metadata = event?.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).ai_direct;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJson(value: unknown): Entity | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Entity)
      : null;
  } catch {
    return null;
  }
}

function scheduleEdit(schedule: Record<string, unknown>) {
  return {
    start_date: (schedule.start_date as string | null) ?? null,
    end_date: (schedule.end_date as string | null) ?? null,
    date_kind: schedule.date_kind,
    range_semantics: (schedule.range_semantics as string | null) ?? null,
    confidence: schedule.confidence,
    granularity: schedule.granularity,
  } as never;
}

function stableChecklistId(changeId: string, index: number): string {
  const h = sha256(`${changeId}:checklist:${index}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * ローカルのAI（Claude Codeなど）が、本人の言葉を根拠に既存のTaskを直接変える限定の入口（#703）。
 * actorとsourceはCoreが固定し、変えてよい欄は許可リストに限る。根拠は全Change Eventに残し、
 * 取り消せるようにする。Desktopのstdio接続だけに出し、NASには出さない。
 */
export class AiTaskChangeService {
  private readonly now: () => string;

  constructor(
    private readonly persistence: Persistence,
    private readonly port: AiTaskChangePort,
    private readonly options: AiTaskChangeOptions,
  ) {
    this.now = options.now || (() => new Date().toISOString());
  }

  change(input: AiTaskChangeRequest): AiTaskChangeResponse {
    if (!this.options.isEnabled()) throw directWriteDisabled();
    const request = aiTaskChangeRequestSchema.parse(input);
    const changeId = `${changePrefix(request.source_session)}${sha256(
      JSON.stringify([this.persistence.workspaceId, request.source_app, request.idempotency_key]),
    ).slice(0, 40)}`;
    const fingerprint = sha256(JSON.stringify(request));
    const previous = this.persistence.listChangeEventsByCommandId(changeId);
    if (previous.length > 0) {
      if (aiDirect(previous[0])?.request_fingerprint !== fingerprint)
        throw new CorePublicError(
          "IDEMPOTENCY_CONFLICT",
          "同じidempotency_keyの内容が異なります。",
          409,
        );
      return this.changeResponse("duplicate", changeId, request.task_id);
    }
    const task = this.persistence.get("task", request.task_id, true);
    if (!task || task.deleted_at)
      throw new CorePublicError("NOT_FOUND", "Taskがありません。", 404, {
        task_id: request.task_id,
      });
    if (Number(task.version) !== request.expected_version) throw this.conflict(request.task_id);
    this.refuse(task, request.action);
    if (!request.said && this.needsUserWords(task))
      throw new CorePublicError(
        "ASK_USER",
        "このTaskの変更には本人の言葉が要ります。保存していません。",
        422,
        { reason: "needs_user_words" },
      );
    this.checkBulk(request);
    const command = this.taskCommand(request, task, changeId);
    if (!command) return this.changeResponse("no_change", changeId, request.task_id);
    const result = this.port.executeTaskCommand(command, {
      schema: "tasken-ai-direct/v1",
      action: request.action,
      ...(request.said ? { said: request.said } : { why: request.why }),
      caller: request.caller,
      source_app: request.source_app,
      source_session: request.source_session,
      request_fingerprint: fingerprint,
      ...(request.confirm_bulk ? { confirm_bulk: true } : {}),
    });
    if (!result.ok) throw this.taskError(result.error, request.task_id);
    return this.changeResponse(
      result.value.status === "no_change" ? "no_change" : "applied",
      changeId,
      request.task_id,
    );
  }

  undo(input: AiChangeUndoRequest): AiChangeUndoResponse {
    if (!this.options.isEnabled()) throw directWriteDisabled();
    const request = aiChangeUndoRequestSchema.parse(input);
    const undoBase = `${undoPrefix(request.source_session)}${sha256(
      JSON.stringify([this.persistence.workspaceId, request.source_app, request.idempotency_key]),
    ).slice(0, 40)}`;
    const fingerprint = sha256(JSON.stringify(request));
    const replayed = [...this.persistence.changeEventCommandIdsWithPrefix(`${undoBase}:`)];
    if (replayed.length > 0) return this.undoReplay(replayed, fingerprint);

    const targets = request.change_id
      ? [request.change_id]
      : this.sessionChanges(request.undo_session as string)
          .filter((change) => !aiDirect(change.events[0])?.undone_by)
          .map((change) => change.commandId);
    const plans = targets.map((commandId) => this.undoPlan(commandId));
    // 本人の言葉で決めた変更は、本人の言葉なしに戻さない。どれか一つでも要るなら、何も戻さず聞く。
    if (!request.said && plans.some((plan) => plan.needsUserWords))
      throw new CorePublicError(
        "ASK_USER",
        "本人の言葉で決めた変更を戻すには、本人の言葉が要ります。何も戻していません。",
        422,
        { reason: "needs_user_words" },
      );
    const undone: AiChangeUndoResponse["undone"] = [];
    let stopped: AiChangeUndoResponse["stopped"] = null;
    // この取り消しの中で戻したTaskは、今の版が「戻した変更の前の版」と同じ中身になる。
    // 同じ会話で同じTaskを二度変えていても、新しい方を戻した後に古い方を続けて戻せるようにする。
    const equivalent = new Map<string, { version: number; sameAs: number }>();
    const who: UndoActor = {
      actor: { kind: "ai_agent", id: request.caller },
      source: "mcp",
      annotation: {
        schema: "tasken-ai-direct/v1",
        action: "undo",
        ...(request.said ? { said: request.said } : { why: request.why }),
        caller: request.caller,
        source_app: request.source_app,
        source_session: request.source_session,
        request_fingerprint: fingerprint,
      },
    };
    for (const [index, plan] of plans.entries()) {
      const undoChangeId = `${undoBase}:${index}`;
      const failure = plan.failure || this.applyUndo(plan, undoChangeId, who, equivalent);
      if (failure) {
        stopped = { change_id: plan.commandId, ...failure };
        break;
      }
      const now = this.persistence.get("task", plan.taskId, true);
      if (now && plan.before && Number.isInteger(plan.before.version))
        equivalent.set(plan.taskId, {
          version: Number(now.version),
          sameAs: Number(plan.before.version),
        });
      undone.push({
        change_id: plan.commandId,
        undo_change_id: undoChangeId,
        task_id: plan.taskId,
      });
    }
    return aiChangeUndoResponseSchema.parse({
      schema: "tasken-ai-change-undo/v1",
      undone,
      stopped,
    });
  }

  /**
   * 本人がDesktopの画面（Activity）からAIの直接変更を一つ取り消す。本人の操作として記録し、
   * 設定で直接の書き込みを止めた後でも使える。同じ変更は一度しか戻さない。
   */
  undoByUser(changeId: string): AiChangeUndoResponse {
    const plan = this.undoPlan(changeId);
    const undoChangeId = `user-undo:${sha256(changeId).slice(0, 40)}`;
    const failure =
      plan.failure ||
      this.applyUndo(
        plan,
        undoChangeId,
        {
          actor: { kind: "user" },
          source: "desktop",
          annotation: { schema: "tasken-ai-direct/v1", action: "undo", by: "user" },
        },
        new Map(),
      );
    return aiChangeUndoResponseSchema.parse({
      schema: "tasken-ai-change-undo/v1",
      undone: failure
        ? []
        : [{ change_id: changeId, undo_change_id: undoChangeId, task_id: plan.taskId }],
      stopped: failure ? { change_id: changeId, ...failure } : null,
    });
  }

  /** 断る変更: 委任した作業の最中、繰り返しの完了（次の回をCoreが作れない）、同期の競合中。 */
  private refuse(task: Entity, action: string): void {
    if (IN_FLIGHT_WORK_STATES.has(String(task.work_state || "")))
      throw new CorePublicError(
        "DELEGATED_IN_PROGRESS",
        "委任した作業の最中のTaskは直接変えられません。",
        409,
        { work_state: task.work_state },
      );
    if (action === "complete" && task.repeat_rule)
      throw new CorePublicError(
        "COMPLETE_IN_DESKTOP",
        "繰り返しのTaskは、次の回を作るためDesktopの画面で完了してください。",
        422,
      );
    if (this.persistence.hasSyncConflict("task", String(task.id)))
      throw new CorePublicError(
        "SYNC_CONFLICT",
        "このTaskは同期の競合を本人が選ぶ前なので、変えられません。",
        409,
      );
  }

  /**
   * 本人の言葉が要らないのは、AIが作ったTaskを本人がまだ一度も触っていないときだけ（3.3）。
   * Taskの版の数だけAIのChange Eventがあることで確かめる。既読（ai_seen_at）や他端末からの同期など、
   * Eventの残らない変更があれば版が先へ進むので、本人が触ったとみなす（安全な側に倒す）。
   */
  private needsUserWords(task: Entity): boolean {
    if (!task.ai_creation) return true;
    const events = this.persistence
      .listChangeEventsForEntity("task", String(task.id))
      .filter((event) => !event.no_change);
    if (events.some((event) => event.actor_kind !== "ai_agent")) return true;
    // 本人の言葉で一度でも決めたTaskは、本人が手を入れたものとして扱う。
    if (events.some((event) => aiDirect(event)?.said)) return true;
    return events.length !== Number(task.version);
  }

  /** この会話の直接変更。新しい順。`confirm_bulk`は変えたTaskの数え直しの起点。 */
  private sessionChanges(
    session: string,
  ): Array<{ commandId: string; events: Entity[]; at: string; version: number }> {
    return (
      [...this.persistence.changeEventCommandIdsWithPrefix(changePrefix(session))]
        .map((commandId) => {
          const events = this.persistence
            .listChangeEventsByCommandId(commandId)
            .filter((event) => event.record_type === "task");
          const version = Number(parseJson(events[0]?.after_json)?.version || 0);
          return { commandId, events, at: String(events[0]?.created_at || ""), version };
        })
        .filter((change) => change.events.length > 0)
        // 同じミリ秒の変更もあるので、同じTaskならあとの版を新しいとみなす。
        .sort((left, right) => right.at.localeCompare(left.at) || right.version - left.version)
    );
  }

  private checkBulk(request: ReturnType<typeof aiTaskChangeRequestSchema.parse>): void {
    if (request.confirm_bulk) return;
    const changes = this.sessionChanges(request.source_session);
    const lastConfirm = changes.findIndex((change) => aiDirect(change.events[0])?.confirm_bulk);
    const window = new Set(
      (lastConfirm >= 0 ? changes.slice(0, lastConfirm + 1) : changes).map((change) =>
        String(change.events[0].entity_id),
      ),
    );
    if (window.has(request.task_id) || window.size < AI_DIRECT_CHANGE_BULK_LIMIT) return;
    throw new CorePublicError(
      "ASK_USER",
      `この会話で直接変えたTaskが${AI_DIRECT_CHANGE_BULK_LIMIT}件に達しました。保存していません。`,
      422,
      { reason: "bulk_limit", changed_tasks: window.size, limit: AI_DIRECT_CHANGE_BULK_LIMIT },
    );
  }

  private taskCommand(
    request: ReturnType<typeof aiTaskChangeRequestSchema.parse>,
    task: Entity,
    changeId: string,
  ): TaskCommand | null {
    const base = {
      schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
      command_id: changeId,
      actor: { kind: "ai_agent", id: request.caller },
      source: "mcp",
      entrypoint: "mcp",
      issued_at: this.now(),
    };
    const target = { task_id: request.task_id, expected_version: request.expected_version };
    if (request.action === "complete")
      return {
        ...base,
        name: "CompleteTask",
        payload: {
          ...target,
          ...(request.completion_note !== undefined
            ? { completion_note: request.completion_note }
            : {}),
        },
      } as TaskCommand;
    if (request.action === "reopen")
      return { ...base, name: "ReopenTask", payload: target } as TaskCommand;
    if (request.action === "delete")
      return { ...base, name: "DeleteTask", payload: target } as TaskCommand;
    const edit = request.changes!;
    const changes: Record<string, unknown> = {};
    for (const key of [
      "title",
      "description",
      "priority",
      "today_date",
      "planning_shelf",
      "planned_start_time",
      "planned_duration_minutes",
      "reminder_at",
      "intended_executor",
      "handoff_expected_result",
      "handoff_instruction",
    ] as const) {
      if (edit[key] !== undefined) changes[key] = edit[key];
    }
    if (edit.theme_id !== undefined) {
      if (!this.persistence.get("theme", edit.theme_id))
        throw new CorePublicError("INVALID_REFERENCE", "指定したThemeがありません。", 400, {
          field: "theme_id",
        });
      changes.project_id = edit.theme_id;
    }
    if (edit.checklist !== undefined) {
      const existing = new Map(
        (Array.isArray(task.checklist_items) ? (task.checklist_items as Entity[]) : []).map(
          (item) => [String(item.id), item],
        ),
      );
      changes.checklist_items = edit.checklist.map((item, index) => {
        if (item.id && !existing.has(item.id))
          throw new CorePublicError("INVALID_REFERENCE", "チェック項目のIDがありません。", 400, {
            field: "checklist",
            id: item.id,
          });
        const before = item.id ? existing.get(item.id) : undefined;
        // doneを省いた既存の項目は今の状態のまま（省いただけで済みが外れないように）。
        const done = item.done ?? Boolean(before?.done);
        return {
          id: item.id || stableChecklistId(changeId, index),
          title: item.title,
          done,
          sort_order: index,
          completed_at: done
            ? before?.done && before.completed_at
              ? before.completed_at
              : this.now()
            : null,
        };
      });
    }
    let scheduleChange: Record<string, unknown> | undefined;
    if (edit.schedule !== undefined) {
      const current = this.port.readTask(request.task_id)?.schedule || null;
      if (edit.schedule === null) {
        if (current)
          scheduleChange = {
            changes: scheduleEdit({
              ...current,
              start_date: null,
              end_date: null,
              date_kind: "unknown",
              range_semantics: null,
            }),
            base: scheduleEdit(current),
            expected_version: current.version,
          };
      } else
        scheduleChange = {
          changes: taskScheduleEditFromAiInput(edit.schedule),
          base: current ? scheduleEdit(current) : null,
          expected_version: current ? current.version : null,
        };
    }
    if (Object.keys(changes).length === 0 && !scheduleChange) return null;
    return {
      ...base,
      name: "UpdateTask",
      payload: {
        ...target,
        ...(Object.keys(changes).length > 0 ? { changes } : {}),
        ...(scheduleChange ? { schedule_change: scheduleChange } : {}),
      },
    } as TaskCommand;
  }

  private undoPlan(commandId: string): UndoPlan {
    const events = this.persistence.listChangeEventsByCommandId(commandId);
    const taskEvent = events.find((event) => event.record_type === "task" && !event.no_change);
    const scheduleEvent = events.find((event) => event.record_type === "schedule");
    const taskId = String(taskEvent?.entity_id || events[0]?.entity_id || "");
    const plan = (failure: UndoPlan["failure"]): UndoPlan => ({
      commandId,
      taskId,
      commandName: "",
      needsUserWords: false,
      failure,
    });
    if (!taskEvent)
      return plan({
        code: "NOT_FOUND",
        message: "取り消せる変更がありません。",
        current_task: null,
      });
    const marker = aiDirect(events.find((event) => aiDirect(event)) || taskEvent);
    const isAiCreation = events.some((event) => event.command_name === "CreateAiItem");
    if (!marker && !isAiCreation)
      return plan({
        code: "NOT_AI_CHANGE",
        message: "AIの直接変更・新規作成ではないので、ここからは取り消せません。",
        current_task: null,
      });
    if (marker?.undone_by)
      return plan({
        code: "ALREADY_UNDONE",
        message: "この変更は取り消し済みです。",
        current_task: null,
      });
    // 取り消しそのものは取り消さない（本人の取り消しを、本人の言葉なしにやり直せないように）。
    // やり直すなら、change_taskで根拠を添えて改めて変える。
    if (marker?.action === "undo")
      return plan({
        code: "NOT_AI_CHANGE",
        message: "取り消しは取り消せません。やり直すならchange_taskで改めて変えてください。",
        current_task: null,
      });
    const receipt = parseJson(taskEvent.receipt_json) as {
      changes?: Array<{ type: string; entity: Entity }>;
    } | null;
    const after = receipt?.changes?.find((change) => change.type === "task")?.entity;
    return {
      commandId,
      taskId,
      commandName: String(taskEvent.command_name || ""),
      afterVersion: after ? Number(after.version) : null,
      before: parseJson(taskEvent.before_json),
      after: parseJson(taskEvent.after_json),
      scheduleBefore: scheduleEvent ? parseJson(scheduleEvent.before_json) : undefined,
      scheduleAfterVersion: scheduleEvent
        ? Number(parseJson(scheduleEvent.after_json)?.version || 0)
        : undefined,
      events,
      needsUserWords: Boolean(marker?.said),
      failure: null,
    };
  }

  private applyUndo(
    plan: UndoPlan,
    undoChangeId: string,
    who: UndoActor,
    equivalent: Map<string, { version: number; sameAs: number }>,
  ): UndoPlan["failure"] {
    const current = this.persistence.get("task", plan.taskId, true);
    const same = equivalent.get(plan.taskId);
    const untouched =
      Number(current?.version) === plan.afterVersion ||
      (same !== undefined &&
        same.version === Number(current?.version) &&
        same.sameAs === plan.afterVersion);
    if (!current || plan.afterVersion === null || !untouched)
      return {
        code: "CONFLICT",
        message: "後から別の変更が入っているので戻せません。",
        current_task: this.port.readTask(plan.taskId),
      };
    if (this.persistence.hasSyncConflict("task", plan.taskId))
      return {
        code: "SYNC_CONFLICT",
        message: "同期の競合を本人が選ぶ前なので戻せません。",
        current_task: this.port.readTask(plan.taskId),
      };
    const annotation = { ...who.annotation, undo_of: plan.commandId };
    const issuedAt = this.now();
    const base = {
      schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
      command_id: undoChangeId,
      actor: who.actor,
      source: who.source,
      entrypoint: who.source === "mcp" ? "mcp" : "main_ui",
      issued_at: issuedAt,
    };
    const target = { task_id: plan.taskId, expected_version: Number(current.version) };
    let command: TaskCommand;
    if (plan.commandName === "DeleteTask") {
      try {
        this.port.restoreTask(
          {
            commandId: undoChangeId,
            taskId: plan.taskId,
            expectedVersion: Number(current.version),
            actor: who.actor,
            source: who.source === "mcp" ? "mcp" : "main_ui",
            issuedAt,
          },
          annotation,
        );
        return null;
      } catch (error) {
        return {
          code: String((error as { code?: unknown }).code || "INTERNAL_ERROR"),
          message: error instanceof Error ? error.message : "Taskを戻せませんでした。",
          current_task: this.port.readTask(plan.taskId),
        };
      }
    } else if (plan.commandName === "CompleteTask")
      // 完了で上書きした完了メモも元に戻す。
      command = {
        ...base,
        name: "ReopenTask",
        payload: { ...target, changes: { completion_note: plan.before?.completion_note ?? null } },
      } as TaskCommand;
    else if (plan.commandName === "ReopenTask")
      // 前の完了日時と完了メモのまま完了に戻す（取り消した時刻にしない）。
      command = {
        ...base,
        name: "CompleteTask",
        payload: {
          ...target,
          completion_note: (plan.before?.completion_note as string | null | undefined) ?? null,
          ...(plan.before?.completed_at
            ? { changes: { completed_at: plan.before.completed_at } }
            : {}),
        },
      } as TaskCommand;
    else if (plan.commandName === "CreateTask" || plan.commandName === "RestoreTask")
      command = { ...base, name: "DeleteTask", payload: target } as TaskCommand;
    else if (plan.commandName === "UpdateTask") {
      // 委任の付け替えで消えた差し戻しのメモは、委任を戻しても戻らない。正確に戻せないので断る。
      if (
        plan.before?.work_review_note &&
        !plan.after?.work_review_note &&
        plan.before.intended_executor !== plan.after?.intended_executor
      )
        return {
          code: "CANNOT_UNDO_EXACTLY",
          message: "委任の付け替えで消えた差し戻しのメモは戻せないので、取り消せません。",
          current_task: this.port.readTask(plan.taskId),
        };
      const changes: Record<string, unknown> = {};
      for (const key of REVERTIBLE_TASK_FIELDS) {
        const before = plan.before?.[key] ?? EMPTY_TASK_FIELD[key] ?? null;
        const after = plan.after?.[key] ?? EMPTY_TASK_FIELD[key] ?? null;
        if (JSON.stringify(before) !== JSON.stringify(after)) changes[key] = before;
      }
      let scheduleChange: Record<string, unknown> | undefined;
      if (plan.scheduleBefore !== undefined) {
        const schedule = this.port.readTask(plan.taskId)?.schedule || null;
        // 日程だけが後から変わっていないかも確かめる。
        if (schedule && plan.scheduleAfterVersion && schedule.version !== plan.scheduleAfterVersion)
          return {
            code: "CONFLICT",
            message: "後から日程が変わっているので戻せません。",
            current_task: this.port.readTask(plan.taskId),
          };
        if (schedule)
          scheduleChange = {
            changes: scheduleEdit(
              plan.scheduleBefore || {
                ...schedule,
                start_date: null,
                end_date: null,
                date_kind: "unknown",
                range_semantics: null,
              },
            ),
            base: scheduleEdit(schedule),
            expected_version: schedule.version,
          };
      }
      if (Object.keys(changes).length === 0 && !scheduleChange) {
        // 戻すものが無い（値の変わらない変更だった）。印だけ付け、二度は対象にしない。
        this.markUndone(plan, undoChangeId);
        return null;
      }
      command = {
        ...base,
        name: "UpdateTask",
        payload: {
          ...target,
          ...(Object.keys(changes).length > 0 ? { changes } : {}),
          ...(scheduleChange ? { schedule_change: scheduleChange } : {}),
        },
      } as TaskCommand;
    } else
      return {
        code: "NOT_AI_CHANGE",
        message: "この種類の変更は取り消せません。",
        current_task: null,
      };
    const result = this.port.executeTaskCommand(command, annotation);
    if (result.ok) return null;
    return {
      code: result.error.code,
      message: result.error.message,
      current_task: this.port.readTask(plan.taskId),
    };
  }

  private markUndone(plan: UndoPlan, undoChangeId: string): void {
    for (const event of plan.events || []) {
      const metadata =
        event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
          ? (event.metadata as Record<string, unknown>)
          : {};
      this.persistence.save("change_event", {
        ...event,
        metadata: {
          ...metadata,
          ai_direct: { ...(aiDirect(event) || {}), undone_by: undoChangeId },
        },
      });
    }
  }

  /** 同じ取り消しの再送。残っている取り消しの記録から、前と同じ結果を返す。 */
  private undoReplay(commandIds: string[], fingerprint: string): AiChangeUndoResponse {
    const done = commandIds
      .map((commandId) => {
        const events = this.persistence.listChangeEventsByCommandId(commandId);
        return { commandId, marker: aiDirect(events.find((event) => aiDirect(event))), events };
      })
      .sort((left, right) => left.commandId.localeCompare(right.commandId));
    if (done.some((entry) => entry.marker?.request_fingerprint !== fingerprint))
      throw new CorePublicError(
        "IDEMPOTENCY_CONFLICT",
        "同じidempotency_keyの内容が異なります。",
        409,
      );
    return aiChangeUndoResponseSchema.parse({
      schema: "tasken-ai-change-undo/v1",
      undone: done.map((entry) => ({
        change_id: String(entry.marker?.undo_of || ""),
        undo_change_id: entry.commandId,
        task_id: String(entry.events[0]?.entity_id || ""),
      })),
      stopped: null,
    });
  }

  private conflict(taskId: string): CorePublicError {
    return new CorePublicError(
      "CONFLICT",
      "Taskが更新されています。読み直して、今の版で送り直してください。",
      409,
      { current_task: this.port.readTask(taskId) },
    );
  }

  private taskError(error: { code: string; message: string; details?: unknown }, taskId: string) {
    if (error.code === "CONFLICT") return this.conflict(taskId);
    const status =
      error.code === "NOT_FOUND" ? 404 : error.code === "INVALID_TRANSITION" ? 422 : 400;
    return new CorePublicError(
      error.code === "INVALID_COMMAND" ? "VALIDATION_FAILED" : error.code,
      error.message,
      status,
    );
  }

  private changeResponse(
    status: AiTaskChangeResponse["status"],
    changeId: string,
    taskId: string,
  ): AiTaskChangeResponse {
    const task = this.port.readTask(taskId);
    if (!task) throw new Error("変更したTaskを読み戻せません。");
    return aiTaskChangeResponseSchema.parse({
      schema: "tasken-ai-task-change/v1",
      status,
      change_id: changeId,
      task,
    });
  }
}

/** 取り消す人。AI（MCP）か、Desktopの画面の本人。 */
interface UndoActor {
  actor: { kind: "ai_agent" | "user"; id?: string };
  source: "mcp" | "desktop";
  annotation: Record<string, unknown>;
}

interface UndoPlan {
  commandId: string;
  taskId: string;
  commandName: string;
  afterVersion?: number | null;
  before?: Entity | null;
  after?: Entity | null;
  /** 元の変更が日程も変えたときだけ。nullは「元は日程が無かった」。 */
  scheduleBefore?: Entity | null;
  scheduleAfterVersion?: number;
  events?: Entity[];
  needsUserWords: boolean;
  failure: { code: string; message: string; current_task: TaskReadModel | null } | null;
}
