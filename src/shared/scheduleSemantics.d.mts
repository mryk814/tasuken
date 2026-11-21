export type ScheduleKind =
  "none" | "point" | "deadline" | "execution_window" | "ongoing_period" | "unspecified_range";
export function getScheduleKind(schedule?: object | null): ScheduleKind;
export function isScheduleDueOn(schedule: object | null | undefined, date: string): boolean;
export function isScheduleOverdueOn(schedule: object | null | undefined, date: string): boolean;
export interface ScheduleEnd {
  /** 期限の日（YYYY-MM-DD）。 */
  date: string;
  /** その日の時刻（HH:mm）。無ければ null。 */
  time: string | null;
  /** 時刻の何分前に知らせるか。無ければ null。 */
  notifyBeforeMinutes: number | null;
}
export function scheduleEnd(schedule: object | null | undefined): ScheduleEnd | null;
export function scheduleEndTime(schedule: object | null | undefined): string;
export function normalizeScheduleEndFields<T>(schedule: T): T;
export function isScheduleOverdueAt(
  schedule: object | null | undefined,
  nowMinute: string,
): boolean;
export function isScheduleOngoingOn(schedule: object | null | undefined, date: string): boolean;
export function isExecutionWindowOpenOn(schedule: object | null | undefined, date: string): boolean;
export function isScheduleAvailableOn(schedule: object | null | undefined, date: string): boolean;
export function isOngoingPeriodPastEnd(schedule: object | null | undefined, date: string): boolean;
export function daysUntil(from: string, to: string): number;
export function inclusiveDays(start: string, end: string): number;
