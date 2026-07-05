import { isTodayRow, scheduledDate } from "./todoRows.js";
import type { Schedule, Task } from "../domain-model/types";

export interface TimeboxRow {
  task: Task;
  schedule?: Schedule;
}

export interface TimedTimeboxRow extends TimeboxRow {
  startTime: string;
  durationMinutes: number;
  endTime: string;
  overlaps: boolean;
}

export interface TimeboxView {
  timed: TimedTimeboxRow[];
  untimed: TimeboxRow[];
  conflicts: TimedTimeboxRow[];
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function minutesToTime(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function timeToMinutes(value: string): number | null {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function normalizeStartTime(value: unknown): string {
  if (typeof value !== "string") return "";
  const minutes = timeToMinutes(value.trim());
  return minutes == null ? "" : minutesToTime(minutes);
}

export function normalizeDurationMinutes(value: unknown): number | null {
  const minutes = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : null;
  if (!Number.isInteger(minutes) || minutes == null || minutes <= 0 || minutes > 1440) return null;
  return minutes;
}

function rowStartMinutes(row: TimedTimeboxRow): number {
  return timeToMinutes(row.startTime) || 0;
}

function rowEndMinutes(row: TimedTimeboxRow): number {
  return rowStartMinutes(row) + row.durationMinutes;
}

export function buildTimeboxView(rows: TimeboxRow[], today: string): TimeboxView {
  const timed: TimedTimeboxRow[] = [];
  const untimed: TimeboxRow[] = [];

  for (const row of rows) {
    if (!isTodayRow(row, today)) continue;
    const startTime = normalizeStartTime(row.task.planned_start_time);
    const durationMinutes = normalizeDurationMinutes(row.task.planned_duration_minutes) || 30;
    if (!startTime) {
      untimed.push(row);
      continue;
    }
    const endMinutes = Math.min(24 * 60, (timeToMinutes(startTime) || 0) + durationMinutes);
    timed.push({
      ...row,
      startTime,
      durationMinutes,
      endTime: minutesToTime(endMinutes),
      overlaps: false,
    });
  }

  timed.sort((a, b) => rowStartMinutes(a) - rowStartMinutes(b) || a.task.title.localeCompare(b.task.title, "ja"));
  untimed.sort((a, b) => String(scheduledDate(a.schedule) || "").localeCompare(String(scheduledDate(b.schedule) || "")) || a.task.title.localeCompare(b.task.title, "ja"));

  for (let index = 0; index < timed.length; index += 1) {
    const current = timed[index];
    for (let otherIndex = index + 1; otherIndex < timed.length; otherIndex += 1) {
      const other = timed[otherIndex];
      if (rowStartMinutes(other) >= rowEndMinutes(current)) break;
      current.overlaps = true;
      other.overlaps = true;
    }
  }

  return {
    timed,
    untimed,
    conflicts: timed.filter((row) => row.overlaps),
  };
}
