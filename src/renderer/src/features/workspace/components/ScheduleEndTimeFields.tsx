import { useState } from "react";

import {
  SCHEDULE_NOTIFY_BEFORE_DEFAULT,
  SCHEDULE_NOTIFY_BEFORE_OPTIONS,
  SCHEDULE_NOTIFY_CUSTOM,
} from "../domain-model/labels";
import type { Schedule } from "../domain-model/types";
import { scheduleEnd } from "../../../../../shared/scheduleSemantics.mjs";
import { Field } from "./common";

function initialNotifyChoice(minutes: number | null): string {
  if (minutes === null) return "";
  const preset = SCHEDULE_NOTIFY_BEFORE_OPTIONS.find(
    (option) => option.value !== SCHEDULE_NOTIFY_CUSTOM && option.value === String(minutes),
  );
  return preset ? preset.value : SCHEDULE_NOTIFY_CUSTOM;
}

/**
 * 期限の時刻と、その何分前に知らせるか（#785）。時刻は期限の日（終了日、無ければ開始日）の現地の時刻で、
 * リマインダー（reminder_at）とは別に持つ。日付が無い間は時刻を入れられない。
 * 時刻を入れた時だけ知らせの選択が出て、初めて入れた時は「30分前」を選んでおく。
 *
 * 入力欄は制御しない（defaultValue のまま）。ドロワーはフォームの最初の入力で同期的に描き直すため、
 * 制御した欄だと最初の入力が元の値に戻される（FAILURES.md 2026-11-12）。表示の切り替えに使う値だけ、
 * 入力から写して持つ。
 */
export function ScheduleEndTimeFields({
  schedule,
  hasDate,
}: {
  schedule: Schedule | null | undefined;
  hasDate: boolean;
}) {
  const end = scheduleEnd(schedule);
  const storedChoice = end?.time ? initialNotifyChoice(end.notifyBeforeMinutes) : "";
  const [time, setTime] = useState(end?.time || "");
  const [choice, setChoice] = useState(end?.time ? storedChoice : SCHEDULE_NOTIFY_BEFORE_DEFAULT);
  const showNotify = hasDate && Boolean(time);
  return (
    <div className="form-grid schedule-end-time">
      <Field label="期限の時刻">
        <input
          name="end_time"
          type="time"
          defaultValue={end?.time || ""}
          disabled={!hasDate}
          title={hasDate ? undefined : "開始か期限の日付を入れると時刻を付けられます"}
          onChange={(event) => setTime(event.currentTarget.value)}
        />
      </Field>
      {showNotify && (
        <Field label="知らせ">
          <span className="schedule-notify-inputs">
            <select
              name="notify_before_minutes"
              defaultValue={choice}
              onChange={(event) => setChoice(event.currentTarget.value)}
            >
              {SCHEDULE_NOTIFY_BEFORE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {choice === SCHEDULE_NOTIFY_CUSTOM && (
              <span className="schedule-notify-custom">
                <input
                  name="notify_before_custom"
                  type="number"
                  min="0"
                  max="10080"
                  step="1"
                  inputMode="numeric"
                  aria-label="何分前に知らせるか"
                  defaultValue={
                    end?.notifyBeforeMinutes !== null && end?.notifyBeforeMinutes !== undefined
                      ? String(end.notifyBeforeMinutes)
                      : ""
                  }
                />
                <span>分前</span>
              </span>
            )}
          </span>
        </Field>
      )}
    </div>
  );
}
