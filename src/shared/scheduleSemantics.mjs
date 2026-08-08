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
  return Boolean(schedule?.end_date) && getScheduleKind(schedule) !== "none" && schedule.end_date < date;
}

export function isScheduleOngoingOn(schedule, date) {
  return getScheduleKind(schedule) === "ongoing_period"
    && Boolean(schedule?.start_date && schedule.end_date)
    && schedule.start_date <= date && date <= schedule.end_date;
}

export function isExecutionWindowOpenOn(schedule, date) {
  return getScheduleKind(schedule) === "execution_window"
    && Boolean(schedule?.start_date && schedule.end_date)
    && schedule.start_date <= date && date <= schedule.end_date;
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
