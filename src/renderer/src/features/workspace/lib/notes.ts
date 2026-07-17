export const NOTES_SORT_OPTIONS = [
  { value: "updated_desc", label: "更新日：新しい順" },
  { value: "updated_asc", label: "更新日：古い順" },
  { value: "created_desc", label: "作成日：新しい順" },
  { value: "created_asc", label: "作成日：古い順" },
] as const;

export type NotesSortOrder = (typeof NOTES_SORT_OPTIONS)[number]["value"];
export type NotesScope = "all" | "note" | "resource" | "report" | "prompt";

export type NotesPreferences = {
  scope: NotesScope;
  sortOrder: NotesSortOrder;
};

export const DEFAULT_NOTES_PREFS: NotesPreferences = {
  scope: "note",
  sortOrder: "updated_desc",
};

function recordDate<T extends { created_at?: string; updated_at?: string }>(record: T, field: "created" | "updated"): string {
  return String(field === "created" ? record.created_at || "" : record.updated_at || record.created_at || "");
}

export function compareNotesRecords<T extends { id: string; created_at?: string; updated_at?: string }>(
  left: T,
  right: T,
  order: NotesSortOrder,
): number {
  const field = order.startsWith("created") ? "created" : "updated";
  const direction = order.endsWith("asc") ? 1 : -1;
  return direction * (recordDate(left, field).localeCompare(recordDate(right, field)) || left.id.localeCompare(right.id));
}

export function sortNotesRecords<T extends { id: string; created_at?: string; updated_at?: string }>(
  records: T[],
  order: NotesSortOrder,
): T[] {
  return [...records].sort((left, right) => compareNotesRecords(left, right, order));
}
