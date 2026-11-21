/**
 * Task の時刻と期限の知らせの決まり（#753）。Desktop とスマホで同じにする
 * （スマホ側の同じ決まりは android-app の TaskNotificationPlan.kt）。
 *
 * - 時刻を付けた Task（reminder_at）は、その時刻に知らせる。逃した時刻は 24 時間まで後から出す。
 * - 期限の日は、本人が決めた時刻（既定 09:00、2 回目を足せる）に知らせる。期限の日のうちだけ出す。
 *   期限に時刻（#785）があり、決まった時刻がそれより前でなければ、前の日に「明日が期限」として出す。
 * - 期限の時刻の N 分前（Task ごとに選ぶ）に知らせる。逃した分は 24 時間まで後から出す。
 * - 完了・中止・削除した Task は知らせない。
 *
 * 時刻は端末の現地時刻の分（YYYY-MM-DDTHH:mm）で比べる。文字の大小がそのまま前後になる。
 */

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_DUE_NOTIFICATION_TIMES: readonly string[] = ["09:00"];
export const MAX_DUE_NOTIFICATION_TIMES = 2;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function localMinute(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * リマインダーの時刻を、この端末の現地時刻の分にそろえる。読めなければ空文字。
 * 保存された値は 2 つの形がある。画面が書く時差なし（現地の時刻）と、AI・スマホ・繰り返しが書く
 * 時差つき（Z や +09:00。その瞬間）。時差つきは瞬間として読んで現地に直す
 * （数字だけを拾うと、Z の値が時差の分だけずれて鳴る）。
 * 小数秒は何桁でも読む（AI の入口の isoTimestampSchema が受ける範囲と同じ。読めないと、
 * 引き出しがこの欄を空として保存し直してしまう）。
 */
export function normalizeReminderDateTime(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const match = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/,
  );
  if (!match) return "";
  if (match[4]) {
    const instant = new Date(trimmed.replace(" ", "T"));
    if (Number.isFinite(instant.getTime())) return localMinute(instant);
  }
  const time = `${pad(Number(match[2]))}:${match[3]}`;
  return TIME_PATTERN.test(time) ? `${match[1]}T${time}` : "";
}

/** 期限の日の知らせの時刻。読める HH:mm を重複なしで 2 つまで。1 つも無ければ既定（09:00）。 */
export function normalizeDueNotificationTimes(value: unknown): string[] {
  const times: string[] = [];
  for (const entry of Array.isArray(value) ? value : []) {
    if (typeof entry !== "string" || !TIME_PATTERN.test(entry) || times.includes(entry)) continue;
    times.push(entry);
    if (times.length === MAX_DUE_NOTIFICATION_TIMES) break;
  }
  return times.length > 0 ? times : [...DEFAULT_DUE_NOTIFICATION_TIMES];
}

/**
 * 「2 回目を足す」の最初の時刻。1 回目より後で、重ならない時刻（15:00、21:00、23:59 の順）。
 * 1 回目が 23:59 で後ろが無い時は null（足せない）。
 */
export function suggestedSecondDueTime(first: string): string | null {
  return ["15:00", "21:00", "23:59"].find((time) => time > first) ?? null;
}

/** 日程の「期限の日」。終了日、無ければ開始日（一日だけの予定）。日程が無ければ空文字。 */
export function scheduleDueDate(schedule: Record<string, unknown> | null | undefined): string {
  const date = schedule?.end_date || schedule?.start_date;
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

export interface TaskNotificationTask {
  id: string;
  title?: unknown;
  state?: unknown;
  reminder_at?: unknown;
  deleted_at?: unknown;
}

/**
 * 期限の日と、その日の時刻（#785）。時刻と知らせは shared/scheduleSemantics.mjs の scheduleEnd が
 * 読んだ値を渡す（日単位でない日程・時刻の無い知らせは、そこで無いものになっている）。
 */
export interface TaskNoticeEnd {
  date: string;
  time: string | null;
  notifyBeforeMinutes: number | null;
}

export interface TaskNotice {
  /** 同じ知らせを 2 度出さないための鍵。時刻や期限を変えると鍵も変わり、もう一度知らせる。 */
  key: string;
  /** time = リマインダー、due = 期限の日の決まった時刻、end = 期限の時刻の N 分前（#785）。 */
  kind: "time" | "due" | "end";
  taskId: string;
  title: string;
  at: string;
  /** due と end だけ。期限の時刻（YYYY-MM-DDTHH:mm）。時刻の無い期限は無い。 */
  endAt?: string;
  /** due だけ。期限が今日か明日か（時刻の早い期限は前の日に知らせる）。 */
  dueDay?: "today" | "tomorrow";
}

function isOpen(task: TaskNotificationTask): boolean {
  return task.state !== "done" && task.state !== "cancelled" && !task.deleted_at;
}

function shiftMinute(minute: string, deltaMinutes: number): string {
  const [date, time] = minute.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, min] = time.split(":").map(Number);
  return localMinute(new Date(year, month - 1, day, hour, min + deltaMinutes));
}

function previousDay(date: string): string {
  return shiftMinute(`${date}T00:00`, -24 * 60).slice(0, 10);
}

/**
 * いま出すべき知らせ（もう出したかどうかは見ない）。時刻の古い順。
 *
 * 期限の時刻（#785）がある Task は:
 * - end: 時刻の N 分前に知らせる（N は本人が Task ごとに選ぶ。無ければ出さない）。逃した分は time と同じく
 *   24 時間まで後から出す。日付・時刻・N を変えると鍵が変わり、もう一度知らせる。
 * - due: 期限の日の決まった時刻が期限の時刻より前なら、その日に今日どおり出す。そうでなければ
 *   前の日のその時刻に「明日が期限」として出す（02:00 の期限を、過ぎた後の 09:00 に知らせない）。
 */
export function dueTaskNotices(input: {
  tasks: readonly TaskNotificationTask[];
  /** Task の ID → 期限の日（YYYY-MM-DD）か、時刻つきの期限。 */
  dueDates: ReadonlyMap<string, string | TaskNoticeEnd>;
  dueTimes: readonly string[];
  now: Date;
}): TaskNotice[] {
  const nowMinute = localMinute(input.now);
  const today = nowMinute.slice(0, 10);
  const dayAgo = localMinute(new Date(input.now.getTime() - DAY_MS));
  const dueTimes = normalizeDueNotificationTimes(input.dueTimes);
  const notices: TaskNotice[] = [];
  for (const task of input.tasks) {
    if (!isOpen(task)) continue;
    const taskId = String(task.id);
    const title = typeof task.title === "string" && task.title.trim() ? task.title : "無題のタスク";
    const at = normalizeReminderDateTime(task.reminder_at);
    if (at && at <= nowMinute && at > dayAgo)
      notices.push({ key: `time:${taskId}:${at}`, kind: "time", taskId, title, at });
    const entry = input.dueDates.get(taskId);
    const end: TaskNoticeEnd | null =
      typeof entry === "string"
        ? { date: entry, time: null, notifyBeforeMinutes: null }
        : entry && typeof entry.date === "string"
          ? entry
          : null;
    if (!end?.date) continue;
    const time = end.time && TIME_PATTERN.test(end.time) ? end.time : null;
    const endAt = time ? `${end.date}T${time}` : undefined;
    if (endAt && end.notifyBeforeMinutes !== null && Number.isInteger(end.notifyBeforeMinutes)) {
      const noticeAt = shiftMinute(endAt, -end.notifyBeforeMinutes);
      if (noticeAt <= nowMinute && noticeAt > dayAgo)
        notices.push({
          key: `end:${taskId}:${endAt}:${end.notifyBeforeMinutes}`,
          kind: "end",
          taskId,
          title,
          at: noticeAt,
          endAt,
        });
    }
    for (const dueTime of dueTimes) {
      // 時刻の無い期限と、決まった時刻が期限の時刻より前の時は、期限の日に知らせる。
      const sameDay = !time || dueTime < time;
      const noticeDate = sameDay ? end.date : previousDay(end.date);
      if (noticeDate !== today) continue;
      const dueAt = `${today}T${dueTime}`;
      if (dueAt <= nowMinute)
        notices.push({
          key: `due:${taskId}:${dueAt}`,
          kind: "due",
          taskId,
          title,
          at: dueAt,
          ...(endAt ? { endAt } : {}),
          dueDay: sameDay ? "today" : "tomorrow",
        });
    }
  }
  return notices.sort((left, right) => left.at.localeCompare(right.at));
}

/**
 * 期限の時刻の知らせ（end）の見出し。出す時の時刻で決める（後から出す時に「あと 30 分」と言わない）。
 * 時刻の前は「あとN分で期限」（1 時間以上は時間・日で言う）か「まもなく期限」、時刻を過ぎたら「期限を過ぎました」。
 */
export function endNoticeTitle(notice: Pick<TaskNotice, "endAt">, now: Date): string {
  if (!notice.endAt) return "期限";
  const nowMinute = localMinute(now);
  if (notice.endAt <= nowMinute) return "期限を過ぎました";
  const [date, time] = notice.endAt.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const remaining = Math.round(
    (new Date(year, month - 1, day, hour, minute).getTime() -
      new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        now.getHours(),
        now.getMinutes(),
      ).getTime()) /
      60000,
  );
  if (remaining <= 1) return "まもなく期限";
  if (remaining < 60) return `あと${remaining}分で期限`;
  if (remaining < 24 * 60 && remaining % 60 === 0) return `あと${remaining / 60}時間で期限`;
  if (remaining < 24 * 60) return `あと${Math.floor(remaining / 60)}時間${remaining % 60}分で期限`;
  return `あと${Math.round(remaining / (24 * 60))}日で期限`;
}

/** 期限の知らせの本文の 1 行。時刻つきの期限は先頭に HH:mm を付ける。 */
export function dueNoticeLine(notice: Pick<TaskNotice, "endAt" | "title">): string {
  return notice.endAt ? `${notice.endAt.slice(11, 16)} ${notice.title}` : notice.title;
}

/**
 * 「後で」の先の時刻（reminder_at に書く、現地時刻の分）。
 * 1 時間後は今から 60 分後。明日は、明日の期限の知らせの最初の時刻（既定 09:00）。
 */
export function snoozedReminderAt(
  choice: "hour" | "tomorrow",
  now: Date,
  dueTimes: readonly string[] = DEFAULT_DUE_NOTIFICATION_TIMES,
): string {
  if (choice === "hour") return localMinute(new Date(now.getTime() + 60 * 60 * 1000));
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const first = [...normalizeDueNotificationTimes(dueTimes)].sort()[0];
  return `${localMinute(tomorrow).slice(0, 10)}T${first}`;
}

/** 控えを使い始めた日の印（知らせの鍵ではない。古くなっても落とさない）。 */
export const FIRED_NOTICES_STARTED_KEY = "started";

/** 出した知らせの控え（鍵 → 出した日）から、2 日より前のものを落とす。 */
export function pruneFiredNotices(
  fired: Readonly<Record<string, unknown>>,
  now: Date,
): Record<string, string> {
  const keepFrom = localMinute(new Date(now.getTime() - 2 * DAY_MS)).slice(0, 10);
  const kept: Record<string, string> = {};
  for (const [key, date] of Object.entries(fired))
    if (typeof date === "string" && (date >= keepFrom || key === FIRED_NOTICES_STARTED_KEY))
      kept[key] = date;
  return kept;
}

/**
 * いま出すべき知らせのうち、まだ出していないもの（fresh）と、書き戻す控え（fired）。
 * 控えがまだ無い時（この仕組みが入った後の最初の起動）は、今より前の知らせを全部「出した」ことにして、
 * 何も鳴らさない（過去 24 時間の時刻と今日の期限が、更新の直後にまとめて鳴らないように）。
 */
export function unfiredNotices(
  stored: Readonly<Record<string, unknown>>,
  notices: readonly TaskNotice[],
  now: Date,
): { fresh: TaskNotice[]; fired: Record<string, string>; started: boolean } {
  const today = localMinute(now).slice(0, 10);
  const fired = pruneFiredNotices(stored, now);
  if (typeof fired[FIRED_NOTICES_STARTED_KEY] !== "string") {
    fired[FIRED_NOTICES_STARTED_KEY] = today;
    for (const notice of notices) fired[notice.key] = today;
    return { fresh: [], fired, started: true };
  }
  return { fresh: notices.filter((notice) => !fired[notice.key]), fired, started: false };
}
