import { derivedUuid } from "../repositories/derivedRecords.mjs";
import { normalizeReminderDateTime } from "../../shared/taskNotifications";

/**
 * 待ちを Task に写す（#755 束7）。待ちの画面と入力を外し、待ちは Task の「待ち」の状態に含める。
 *
 * - 起動のたびに確かめ、まだ写していない待ちだけを 1 件ずつ Task に写す。元の待ちは消さず、
 *   書き換えもしない（種類の登録に読むだけで残る）。
 * - 写した Task の ID は待ちの ID から決める（derivedRecords.mjs）。対応する Task が、消した物
 *   （墓標）も含めて既にあれば写さない。だから二度目は写らず、本人が写した Task を消せば、
 *   消したまま残る（元の待ちは残っているので、記録は失われない）。古い版の端末から後で届いた
 *   待ちは、次の起動で写る。
 * - 中身と時刻は待ちだけから決める。複数の PC が独立に写しても、同期では同じ版として 1 件に収まる。
 * - 待ちに付いた日程（schedule）は付け替えず、写した Task の日程（期限）として別の ID で写す。
 * - 写す物がある時だけ、写す前に DB の控えを取る。控えが取れなければ写さず、次の起動でやり直す。
 * - 画面の無い NAS の replica では呼ばない（写すのは Desktop の起動だけ）。
 */

type RecordLike = Record<string, unknown>;

export interface WaitingConversionSource {
  /** WorkspaceDatabase.list と同じ形。includeDeleted を省くと、削除した記録を除く。 */
  list(type: string, includeDeleted?: boolean): RecordLike[];
  /** WorkspaceDatabase.get と同じ形。includeDeleted を省くと、削除した記録は null。 */
  get(type: string, id: string, includeDeleted?: boolean): RecordLike | null;
}

export interface DerivedRecordWrite {
  type: "task" | "schedule";
  entity: RecordLike;
  operationAt: string;
}

export interface WaitingConversionRepository extends WaitingConversionSource {
  writeDerivedRecords(records: DerivedRecordWrite[]): number;
}

export interface WaitingConversionPlan {
  waitingId: string;
  records: DerivedRecordWrite[];
}

export type WaitingConversionResult =
  | { state: "nothing" | "error" }
  | { state: "backup_failed"; pending: number }
  | { state: "done"; waitings: number; tasks: number; schedules: number; failed: number };

/** 待ちを写した Task の ID。どの端末でも同じ待ちからは同じ値になる。 */
export function waitingTaskId(waitingId: string): string {
  return derivedUuid(["tasken-retired-waiting-task", waitingId]);
}

/** 待ちの日程を写した、Task の日程の ID。 */
export function waitingScheduleId(scheduleId: string): string {
  return derivedUuid(["tasken-retired-waiting-schedule", scheduleId]);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value !== "" && !Number.isNaN(Date.parse(value));
}

const TASK_STATES: Record<string, string> = {
  waiting: "waiting",
  received: "done",
  cancelled: "cancelled",
};

const SCHEDULE_FIELDS = [
  "start_date",
  "end_date",
  "date_kind",
  "range_semantics",
  "confidence",
  "granularity",
  "baseline_start",
  "baseline_end",
  "actual_start",
  "actual_end",
] as const;

/** 待っている相手と次にすることは Task に欄が無いので、説明の後ろに書く。 */
export function waitingTaskDescription(waiting: RecordLike): string {
  const description = typeof waiting.description === "string" ? waiting.description.trimEnd() : "";
  const facts = [
    ["待っている相手", text(waiting.waiting_for)],
    ["次にすること", text(waiting.next_action)],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`);
  return [description, facts.join("\n")].filter(Boolean).join("\n\n");
}

function isLive(source: WaitingConversionSource, types: string[], id: unknown): boolean {
  const value = text(id);
  return Boolean(value) && types.some((type) => Boolean(source.get(type, value)));
}

/** 待ち 1 件を写した Task の中身。待ちだけから決まる値にする（端末の時計や時差を使わない）。 */
export function waitingTaskEntity(
  waiting: RecordLike,
  source: WaitingConversionSource,
): DerivedRecordWrite {
  const waitingId = text(waiting.id);
  const createdAt = isTimestamp(waiting.created_at) ? waiting.created_at : undefined;
  const updatedAt = isTimestamp(waiting.updated_at) ? waiting.updated_at : (createdAt ?? "");
  const state = TASK_STATES[text(waiting.state)] || "waiting";
  const aiFields = Object.fromEntries(
    Object.entries(waiting).filter(([key]) => key.startsWith("ai_")),
  );
  const reminder = state === "waiting" && normalizeReminderDateTime(waiting.check_reminder_at);
  const entity: RecordLike = {
    ...aiFields,
    id: waitingTaskId(waitingId),
    title: text(waiting.title) || "無題の待ち",
    description: waitingTaskDescription(waiting),
    state,
    priority: "normal",
    // 消した Theme・Task は指さない（保存の検査が断る）。待ちの側の値は元の待ちに残る。
    project_id: isLive(source, ["project", "theme"], waiting.project_id)
      ? text(waiting.project_id)
      : null,
    parent_task_id: isLive(source, ["task"], waiting.task_id) ? text(waiting.task_id) : null,
    reminder_at: reminder ? String(waiting.check_reminder_at).trim() : null,
    completed_at: state === "done" ? updatedAt || null : null,
    source: "waiting",
    ...(createdAt ? { created_at: createdAt } : {}),
  };
  return { type: "task", entity, operationAt: updatedAt };
}

/**
 * まだ写していない待ちと、その日程を、待ちごとにまとめる。削除した待ちは写さない。
 * 写した Task が消した物も含めて既にあれば、その待ちは写さない（日程も足さない）。
 * Task が生きていて日程の写しだけが無ければ（後から日程が届いた時など）、日程だけを足す。
 */
export function planWaitingConversion(source: WaitingConversionSource): WaitingConversionPlan[] {
  const schedulesByWaiting = new Map<string, RecordLike[]>();
  for (const schedule of source.list("schedule")) {
    if (text(schedule.owner_type) !== "waiting") continue;
    const owner = text(schedule.owner_id);
    const list = schedulesByWaiting.get(owner);
    if (list) list.push(schedule);
    else schedulesByWaiting.set(owner, [schedule]);
  }
  const plans: WaitingConversionPlan[] = [];
  const waitings = [...source.list("waiting")].sort(
    (left, right) =>
      text(left.created_at).localeCompare(text(right.created_at)) ||
      text(left.id).localeCompare(text(right.id)),
  );
  for (const waiting of waitings) {
    const waitingId = text(waiting.id);
    if (!waitingId) continue;
    const taskId = waitingTaskId(waitingId);
    const existingTask = source.get("task", taskId, true);
    if (existingTask?.deleted_at) continue;
    const task = waitingTaskEntity(waiting, source);
    const records: DerivedRecordWrite[] = existingTask ? [] : [task];
    for (const schedule of schedulesByWaiting.get(waitingId) || []) {
      const scheduleId = waitingScheduleId(text(schedule.id));
      if (source.get("schedule", scheduleId, true)) continue;
      const entity: RecordLike = { id: scheduleId, owner_type: "task", owner_id: taskId };
      for (const field of SCHEDULE_FIELDS) if (field in schedule) entity[field] = schedule[field];
      if (isTimestamp(schedule.created_at)) entity.created_at = schedule.created_at;
      entity.source = "waiting";
      const operationAt = isTimestamp(schedule.updated_at)
        ? schedule.updated_at
        : text(entity.created_at) || task.operationAt;
      records.push({ type: "schedule", entity, operationAt });
    }
    if (records.length) plans.push({ waitingId, records });
  }
  return plans;
}

/**
 * 起動の後に呼ぶ。写す物があれば控えを取り、待ちごとに 1 つの transaction で写す。1 件が
 * 書けなくても残りは写す（書けなかった物は次の起動でやり直す）。失敗は起動を止めない。
 * ログには数と code だけを出し、題名や本文は出さない。
 */
export async function runWaitingConversionOnce(input: {
  repository: WaitingConversionRepository;
  /** 写す前の DB の控え。取れた時だけ true。 */
  backup: () => Promise<boolean>;
  log?: (level: "info" | "warn", message: string) => void;
}): Promise<WaitingConversionResult> {
  const { repository, log = () => {} } = input;
  try {
    const plans = planWaitingConversion(repository);
    if (plans.length === 0) return { state: "nothing" };
    let backedUp = false;
    try {
      backedUp = await input.backup();
    } catch {
      backedUp = false;
    }
    if (!backedUp) {
      log("warn", `待ちを Task に写す前の控えが取れなかったので写さない: waitings=${plans.length}`);
      return { state: "backup_failed", pending: plans.length };
    }
    // 控えを取っている間に同期で届いた写しを数え直す（既にあれば書かない）。
    let tasks = 0;
    let schedules = 0;
    let failed = 0;
    let waitings = 0;
    for (const plan of planWaitingConversion(repository)) {
      try {
        const written = repository.writeDerivedRecords(plan.records);
        if (written === 0) continue;
        waitings += 1;
        for (const record of plan.records) {
          if (record.type === "task") tasks += 1;
          else schedules += 1;
        }
      } catch (error) {
        failed += 1;
        const code = (error as { code?: unknown } | null)?.code;
        log("warn", `待ちを 1 件 Task に写せなかった${code ? `: ${String(code)}` : ""}`);
      }
    }
    log(
      "info",
      `待ちを Task に写した: waitings=${waitings} tasks=${tasks} schedules=${schedules} failed=${failed}`,
    );
    return { state: "done", waitings, tasks, schedules, failed };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    log("warn", `待ちを Task に写せなかった${code ? `: ${String(code)}` : ""}`);
    return { state: "error" };
  }
}
