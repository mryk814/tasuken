import { createHash } from "node:crypto";
import fs from "node:fs";

import { taskReminderAtSchema } from "../../shared/contracts/task/public.ts";

/**
 * 待ちを Task に写す（#755 束7）。待ちの画面と入力を外し、待ちは Task の「待ち」の状態に含める。
 *
 * - 起動のたびに確かめ、まだ写していない待ちだけを 1 件ずつ Task に写す。元の待ちは消さず、
 *   書き換えもしない（種類の登録に読むだけで残る）。
 * - 写した Task の ID は待ちの ID から決める。対応する Task が、消した物（墓標）も含めて既に
 *   あれば写さない。だから二度目は写らず、本人が写した Task を消せば、消したまま残る（元の待ちは
 *   残っているので、記録は失われない）。古い版の端末から後で届いた待ちは、次の起動で写る。
 * - 同期を使っている端末は、ほかの端末の変更を全部取り込み終えている時だけ写す。先に写した端末の
 *   Task が届いていれば、もう写さない（既にあるので）。
 * - 中身と時刻は待ちだけから決める。同期の最初の版の ID も中身から決まるので（derivedRecords.mjs）、
 *   同じ中身の写しは 1 件に収まり、中身の違う写しは競合として本人に見せる。
 * - 待ちに付いた日程（schedule）は付け替えず、写した Task の日程（期限）として別の ID で写す。
 * - 関係する Task（待ちの task_id）は親子にせず、記録どうしの関係（reference、related_to）で結ぶ。
 *   元の Task も「待ち」の時に、親子 2 件の「待ち」にしないため。
 * - 写す物がある時だけ、写す前に DB の控えを取る（別の名前で、世代の入れ替えで消えない）。
 *   控えが取れなければ写さず、次の起動でやり直す。写せない待ちが残っても、写していない待ちの
 *   組が同じで控えが残っていれば、控えを取り直さない（起動のたびに控えを増やさない）。
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
  type: "task" | "schedule" | "reference";
  entity: RecordLike;
  operationAt: string;
}

const BACKUP_MARK = "waiting_conversion_backup";

export interface WaitingConversionRepository extends WaitingConversionSource {
  writeDerivedRecords(records: DerivedRecordWrite[]): number;
  readRetiredExportMark(name: typeof BACKUP_MARK): string | null;
  markRetiredExportDone(name: typeof BACKUP_MARK, value: string): void;
}

export interface WaitingConversionPlan {
  waitingId: string;
  records: DerivedRecordWrite[];
}

export type WaitingConversionResult =
  | { state: "nothing" | "error" }
  | { state: "not_caught_up" | "backup_failed"; pending: number }
  | { state: "done"; waitings: number; tasks: number; schedules: number; failed: number };

/**
 * 設定の同期の欄に出す「写していない待ち」（#755 束7）。写せていない時だけ数と理由を返し、
 * 写せた・写す物が無い時は null（何も出さない）。
 */
export function unconvertedWaitingsFrom(
  result: WaitingConversionResult,
): { count: number; reason: "sync_behind" | "backup_failed" | "write_failed" } | null {
  if (result.state === "not_caught_up") return { count: result.pending, reason: "sync_behind" };
  if (result.state === "backup_failed") return { count: result.pending, reason: "backup_failed" };
  if (result.state === "done" && result.failed > 0)
    return { count: result.failed, reason: "write_failed" };
  return null;
}

/**
 * 文字列の並びから決まる UUID（v5 の形）。値を変えると、写した Task と別の ID になり、
 * 次の起動で同じ待ちをもう一度写してしまうので、形も入力も変えない。
 */
function derivedUuid(parts: string[]): string {
  const hash = createHash("sha256").update(parts.join("\0")).digest("hex");
  const value = `${hash.slice(0, 12)}5${hash.slice(13, 16)}8${hash.slice(17, 32)}`;
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

/** 待ちを写した Task の ID。どの端末でも同じ待ちからは同じ値になる。 */
export function waitingTaskId(waitingId: string): string {
  return derivedUuid(["tasken-retired-waiting-task", waitingId]);
}

/** 待ちの日程を写した、Task の日程の ID。 */
export function waitingScheduleId(scheduleId: string): string {
  return derivedUuid(["tasken-retired-waiting-schedule", scheduleId]);
}

/** 写した Task と、待ちの関係する Task を結ぶ関係（reference）の ID。 */
export function waitingReferenceId(waitingId: string): string {
  return derivedUuid(["tasken-retired-waiting-reference", waitingId]);
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

/**
 * 待ちの確認の時刻を、Task のリマインダーが受ける形（taskReminderAtSchema）にそろえる。
 * 時差つきの値は瞬間なのでそのまま、時差なしの値は「YYYY-MM-DDTHH:mm」の現地の分にそろえる
 * （時差で直さないので、どの端末でも同じ値になる）。そろえられなければ null。
 */
export function waitingReminderAt(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  if (taskReminderAtSchema.safeParse(raw).success) return raw;
  const match = raw.match(
    /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/u,
  );
  if (!match) return null;
  const local = `${match[1]}T${match[2].padStart(2, "0")}:${match[3]}`;
  const candidate = match[5] ? `${local}:${match[4] || "00"}${match[5]}` : local;
  return taskReminderAtSchema.safeParse(candidate).success ? candidate : null;
}

/**
 * 待っている相手・次にすること・リマインダーに移せなかった確認の時刻は Task に欄が無いので、
 * 説明の後ろに書く（捨てない）。
 */
export function waitingTaskDescription(waiting: RecordLike, reminderCarried: boolean): string {
  const description = typeof waiting.description === "string" ? waiting.description.trimEnd() : "";
  const facts = [
    ["待っている相手", text(waiting.waiting_for)],
    ["次にすること", text(waiting.next_action)],
    ["確認の時刻", reminderCarried ? "" : text(waiting.check_reminder_at)],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`);
  return [description, facts.join("\n")].filter(Boolean).join("\n\n");
}

function liveId(source: WaitingConversionSource, types: string[], id: unknown): string {
  const value = text(id);
  return value && types.some((type) => Boolean(source.get(type, value))) ? value : "";
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
  // 確認の時刻は、待っている間だけリマインダーにする（済んだ・やめた待ちを鳴らさない）。
  const reminder = state === "waiting" ? waitingReminderAt(waiting.check_reminder_at) : null;
  const sourceRecordId = liveId(source, ["source_record"], waiting.source_record_id);
  const entity: RecordLike = {
    ...aiFields,
    id: waitingTaskId(waitingId),
    title: text(waiting.title) || "無題の待ち",
    description: waitingTaskDescription(waiting, Boolean(reminder)),
    state,
    priority: "normal",
    // 消した Theme は指さない（保存の検査が断る）。待ちの側の値は元の待ちに残る。
    project_id: liveId(source, ["project", "theme"], waiting.project_id) || null,
    reminder_at: reminder,
    completed_at: state === "done" ? updatedAt || null : null,
    ...(sourceRecordId ? { source_record_id: sourceRecordId } : {}),
    source: "waiting",
    ...(createdAt ? { created_at: createdAt } : {}),
  };
  return { type: "task", entity, operationAt: updatedAt };
}

/**
 * まだ写していない待ちと、その日程と関係を、待ちごとにまとめる。削除した待ちは写さない。
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
    const records: DerivedRecordWrite[] = [];
    if (!existingTask) {
      records.push(task);
      const relatedTaskId = liveId(source, ["task"], waiting.task_id);
      const referenceId = waitingReferenceId(waitingId);
      if (relatedTaskId && !source.get("reference", referenceId, true)) {
        records.push({
          type: "reference",
          entity: {
            id: referenceId,
            assertion_id: referenceId,
            subject: { type: "task", id: taskId },
            predicate: "related_to",
            object: { type: "task", id: relatedTaskId },
            layer: "operational",
            status: "asserted",
            origin: "migration",
            source: "waiting",
            ...(task.entity.created_at ? { created_at: task.entity.created_at } : {}),
          },
          operationAt: task.operationAt,
        });
      }
    }
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

/** 写していない物の組。同じ組なら、前に取った控えを使い回す。 */
function planSignature(plans: WaitingConversionPlan[]): string {
  const ids = plans.flatMap((plan) => plan.records.map((record) => record.entity.id)).sort();
  return createHash("sha256").update(ids.join("\0")).digest("hex");
}

function readBackupMark(raw: string | null): { signature: string; path: string } | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { signature?: unknown; path?: unknown };
    return typeof value.signature === "string" && typeof value.path === "string"
      ? { signature: value.signature, path: value.path }
      : null;
  } catch {
    return null;
  }
}

/**
 * 起動の後に呼ぶ。写す物があれば、同期が追いついているかを確かめ、控えを取り、待ちごとに 1 つの
 * transaction で写す。1 件が書けなくても残りは写す（書けなかった物は次の起動でやり直す）。
 * 失敗は起動を止めない。ログには数と code だけを出し、題名や本文は出さない。
 */
export async function runWaitingConversionOnce(input: {
  repository: WaitingConversionRepository;
  /** 写す前の DB の控え。作れたらファイルの場所、作れなければ null。 */
  backup: () => Promise<string | null>;
  /** 同期がほかの端末に追いついているか。省くと追いついているとみなす（同期の無い試験）。 */
  isCaughtUp?: () => Promise<boolean>;
  backupExists?: (filePath: string) => boolean;
  log?: (level: "info" | "warn", message: string) => void;
}): Promise<WaitingConversionResult> {
  const {
    repository,
    log = () => {},
    backupExists = (filePath) => fs.existsSync(filePath),
  } = input;
  try {
    let plans = planWaitingConversion(repository);
    if (plans.length === 0) return { state: "nothing" };
    if (input.isCaughtUp) {
      let caughtUp = false;
      try {
        caughtUp = await input.isCaughtUp();
      } catch {
        caughtUp = false;
      }
      if (!caughtUp) {
        log("info", `同期が追いつくまで待ちを Task に写さない: waitings=${plans.length}`);
        return { state: "not_caught_up", pending: plans.length };
      }
      // 追いつく間に、ほかの端末の写しが届いていれば、それはもう写さない。
      plans = planWaitingConversion(repository);
      if (plans.length === 0) return { state: "nothing" };
    }
    const signature = planSignature(plans);
    const mark = readBackupMark(repository.readRetiredExportMark(BACKUP_MARK));
    if (!(mark && mark.signature === signature && backupExists(mark.path))) {
      let backupPath: string | null = null;
      try {
        backupPath = await input.backup();
      } catch {
        backupPath = null;
      }
      if (!backupPath) {
        log(
          "warn",
          `待ちを Task に写す前の控えが取れなかったので写さない: waitings=${plans.length}`,
        );
        return { state: "backup_failed", pending: plans.length };
      }
      repository.markRetiredExportDone(
        BACKUP_MARK,
        JSON.stringify({ signature, path: backupPath }),
      );
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
          else if (record.type === "schedule") schedules += 1;
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
