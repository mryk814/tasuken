import { IconHourglassHigh } from "@tabler/icons-react";

import { scheduleEndTimeText } from "../domain-model/labels";
import type { Schedule } from "../domain-model/types";
import { isScheduleOverdueAt, scheduleEnd } from "../../../../../shared/scheduleSemantics.mjs";

/**
 * 行に添える期限の時刻（#785）。「23:59まで」、時刻を過ぎたら「23:59 超過」を超過の色で出す。
 * リマインダー（時計の印）と見分けられるよう、砂時計の印にする。時刻の無い日程と、行の日付が
 * 期限の日でない時（期間の開始日の行など）は何も出さない。
 */
export function DeadlineTimeMeta({
  schedule,
  rowDate,
  now,
  done,
}: {
  schedule: Schedule | null | undefined;
  /** 行が示す日付。期限の日と違えば出さない。省けば日付を見ない。 */
  rowDate?: string | null;
  /** 現地時刻の分（YYYY-MM-DDTHH:mm）。 */
  now: string;
  done: boolean;
}) {
  const end = scheduleEnd(schedule);
  if (!end?.time) return null;
  if (rowDate && rowDate.slice(0, 10) !== end.date) return null;
  const passed = !done && isScheduleOverdueAt(schedule, now);
  return (
    <small
      className={`row-deadline-meta${passed ? " is-passed" : ""}`}
      title={`期限 ${end.date} ${end.time}`}
    >
      <IconHourglassHigh size={13} aria-hidden="true" />
      {scheduleEndTimeText(end.time, passed)}
    </small>
  );
}
