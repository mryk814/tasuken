/** Canonical schedule meaning used by every Today projection. */
export function getScheduleKind(schedule) {
  if (!schedule) return "none";
  const { start_date: start, end_date: end } = schedule;
  if (!start && !end) return "none";
  if (!start && end) return "deadline";
  if (start && (!end || end === start)) return "point";
  if (!(start && end && end > start)) return "point";
  if (schedule.range_semantics === "once_within_window") return "execution_window";
  if (schedule.range_semantics === "ongoing") return "ongoing_period";
  return "unspecified_range";
}

export function isScheduleDueOn(schedule, date) {
  const kind = getScheduleKind(schedule);
  if (kind === "none") return false;
  if (kind === "point") return schedule.start_date === date || schedule.end_date === date;
  return schedule.end_date === date;
}

export function isScheduleOverdueOn(schedule, date) {
  return (
    Boolean(schedule?.end_date) && getScheduleKind(schedule) !== "none" && schedule.end_date < date
  );
}

const SCHEDULE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SCHEDULE_END_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const SCHEDULE_NOTIFY_BEFORE_MAX_MINUTES = 10080;

/**
 * 予定終了（#785）。日付は終了日、無ければ開始日（一日だけの予定）。時刻はその日の現地の時刻で、
 * 日単位の日程にだけ意味がある。知らせ（notifyBeforeMinutes）は時刻がある時だけ。
 * 時刻と知らせを読む所は、すべてここを通す（同期などで古い組み合わせが残っていても無いものとして読む）。
 * 日程が無ければ null。
 */
export function scheduleEnd(schedule) {
  const raw = schedule?.end_date || schedule?.start_date;
  if (typeof raw !== "string" || !SCHEDULE_DATE_PATTERN.test(raw)) return null;
  const dayGranularity = schedule.granularity === undefined || schedule.granularity === "day";
  const time =
    dayGranularity &&
    typeof schedule.end_time === "string" &&
    SCHEDULE_END_TIME_PATTERN.test(schedule.end_time)
      ? schedule.end_time
      : null;
  const minutes = schedule.notify_before_minutes;
  const notifyBeforeMinutes =
    time &&
    Number.isInteger(minutes) &&
    minutes >= 0 &&
    minutes <= SCHEDULE_NOTIFY_BEFORE_MAX_MINUTES
      ? minutes
      : null;
  return { date: raw, time, notifyBeforeMinutes };
}

/** 予定終了の時刻（HH:mm）。無ければ空文字。 */
export function scheduleEndTime(schedule) {
  return scheduleEnd(schedule)?.time || "";
}

/**
 * 保存の前に時刻の組をそろえる（#785）。日程が無い・日単位でない日程は時刻を外し、時刻の無い日程は
 * 知らせを外す。拒まずにそろえる（日付しか知らない古いスマホが日付を外しても、見えない時刻のせいで
 * 断られないように）。欄の無い日程に欄を足さない。読めない保存値は書き換えない。
 */
export function normalizeScheduleEndFields(schedule) {
  if (!schedule || typeof schedule !== "object") return schedule;
  const next = { ...schedule };
  const hasDate = Boolean(next.end_date || next.start_date);
  const dayGranularity = next.granularity === undefined || next.granularity === "day";
  if (Object.hasOwn(next, "end_time") && next.end_time != null && (!hasDate || !dayGranularity))
    next.end_time = null;
  if (
    Object.hasOwn(next, "notify_before_minutes") &&
    next.notify_before_minutes != null &&
    next.end_time == null
  )
    next.notify_before_minutes = null;
  return next;
}

/**
 * 予定超過か（時刻まで見る）。終了日が過ぎた日程に加えて、期限の日のうちでも時刻を過ぎたら超過（#785）。
 * nowMinute は現地時刻の分（YYYY-MM-DDTHH:mm）。時刻の無い日程は isScheduleOverdueOn と同じ。
 */
export function isScheduleOverdueAt(schedule, nowMinute) {
  const today = String(nowMinute || "").slice(0, 10);
  if (isScheduleOverdueOn(schedule, today)) return true;
  if (getScheduleKind(schedule) === "none") return false;
  const end = scheduleEnd(schedule);
  return Boolean(end?.time && end.date === today && end.time <= String(nowMinute).slice(11, 16));
}

export function isScheduleOngoingOn(schedule, date) {
  return (
    getScheduleKind(schedule) === "ongoing_period" &&
    Boolean(schedule?.start_date && schedule.end_date) &&
    schedule.start_date <= date &&
    date <= schedule.end_date
  );
}

export function isExecutionWindowOpenOn(schedule, date) {
  return (
    getScheduleKind(schedule) === "execution_window" &&
    Boolean(schedule?.start_date && schedule.end_date) &&
    schedule.start_date <= date &&
    date <= schedule.end_date
  );
}

export function isScheduleAvailableOn(schedule, date) {
  const kind = getScheduleKind(schedule);
  if (kind === "none") return false;
  if (kind === "deadline") return Boolean(schedule.end_date && date <= schedule.end_date);
  if (kind === "point") return schedule.start_date === date || schedule.end_date === date;
  return Boolean(schedule.start_date && schedule.start_date <= date);
}

export function isOngoingPeriodPastEnd(schedule, date) {
  return getScheduleKind(schedule) === "ongoing_period" && String(schedule?.end_date) < date;
}

export function daysUntil(from, to) {
  const fromTime = Date.parse(`${from}T00:00:00.000Z`);
  const toTime = Date.parse(`${to}T00:00:00.000Z`);
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) return 0;
  return Math.round((toTime - fromTime) / 86400000);
}

export function inclusiveDays(start, end) {
  return daysUntil(start, end) + 1;
}
