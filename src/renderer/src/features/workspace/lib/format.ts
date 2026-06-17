import { DAY } from "./domain";

export const uuid = (): string => crypto.randomUUID();

export const str = (value: unknown): string => (value == null ? "" : String(value));
export const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const dateOnly = (value: unknown): string => (value ? String(value).slice(0, 10) : "");

export const localDateIso = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const daysBetween = (from: string, to: string): number =>
  Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / DAY);

export const addDays = (value: unknown, count: number): string => {
  if (!value) return "";
  const date = new Date(`${dateOnly(value)}T00:00:00`);
  date.setDate(date.getDate() + count);
  return localDateIso(date);
};

export const formatDate = (value: unknown): string => {
  if (!value) return "—";
  const date = new Date(`${dateOnly(value)}T00:00:00`);
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
};

// FormDataから値を取り出してtrimする。
export const formText = (data: FormData, key: string, fallback = ""): string =>
  String(data.get(key) ?? fallback).trim();

export const activeRecords = <T extends { deleted_at?: string | null }>(records: T[] = []): T[] =>
  records.filter((record) => !record.deleted_at);

export function compareDate(
  a: { planned_end?: string | null; planned_start?: string | null },
  b: { planned_end?: string | null; planned_start?: string | null },
): number {
  return String(a.planned_end || a.planned_start || "9999-12-31").localeCompare(
    String(b.planned_end || b.planned_start || "9999-12-31"),
  );
}
