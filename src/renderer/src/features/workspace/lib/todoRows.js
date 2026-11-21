import {
  getScheduleKind,
  isScheduleDueOn,
  scheduleEndTime,
} from "../../../../../shared/scheduleSemantics.mjs";

export function scheduledDate(schedule) {
  return String(schedule?.end_date || schedule?.start_date || "");
}

export function isTodayRow(row, today) {
  return (
    row.task?.state !== "cancelled" &&
    (row.task?.today_date === today ||
      (getScheduleKind(row.schedule) !== "ongoing_period" && isScheduleDueOn(row.schedule, today)))
  );
}

export function compareTodoRows(today) {
  return (a, b) => {
    const aDate = scheduledDate(a.schedule) || "9999-12-31";
    const bDate = scheduledDate(b.schedule) || "9999-12-31";
    // 同じ日の中は期限の時刻の早い順、時刻の無いものは後ろ（#785）。
    return (
      aDate.localeCompare(bDate) ||
      (scheduleEndTime(a.schedule) || "99:99").localeCompare(scheduleEndTime(b.schedule) || "99:99")
    );
  };
}
