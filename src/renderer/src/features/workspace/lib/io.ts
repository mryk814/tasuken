import { todayIso, toYaml } from "../../../utils/dataFormat.js";
import type {
  BaseRecord,
  Item,
  Link,
  Note,
  SourceRecord,
  StatusUpdate,
  Theme,
  WorkspaceData,
} from "../types";
import { STATUS_LABELS } from "./domain";
import { addDays } from "./format";

export interface ParsedTaskRow {
  title: string;
  theme_id: string | null;
  due_date: string | null;
  status: string;
  description: string;
  kind?: string;
  priority?: string;
  planned_start?: string | null;
  planned_end?: string | null;
}

export function parseTaskTable(text: string, themes: Theme[]): ParsedTaskRow[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const delimiter = lines.some((line) => line.includes("\t")) ? "\t" : ",";
  const rows = lines.map((line) => line.split(delimiter).map((value) => value.trim()));
  const normalized = (value: string) => String(value || "").toLowerCase().replace(/\s/g, "");
  const knownHeaders = ["title", "タイトル", "タスク", "theme", "テーマ", "期限", "due", "状態", "status", "説明", "description"];
  const hasHeader = rows[0].some((value) => knownHeaders.includes(normalized(value)));
  const headers = hasHeader ? rows.shift()!.map(normalized) : ["タイトル", "theme", "期限", "状態", "説明"];
  const fieldIndex = (aliases: string[]) => headers.findIndex((header) => aliases.includes(header));
  const titleIndex = fieldIndex(["title", "タイトル", "タスク"]);
  const themeIndex = fieldIndex(["theme", "テーマ"]);
  const dueIndex = fieldIndex(["due", "due_date", "期限"]);
  const statusIndex = fieldIndex(["status", "状態"]);
  const descriptionIndex = fieldIndex(["description", "説明"]);
  const statusMap: Record<string, string> = Object.fromEntries(
    Object.entries(STATUS_LABELS).flatMap(([key, label]) => [[key, key], [label, key]]),
  );
  return rows.flatMap<ParsedTaskRow>((row) => {
    const title = row[titleIndex >= 0 ? titleIndex : 0]?.trim();
    if (!title) return [];
    const themeName = row[themeIndex] || "";
    const theme = themes.find((entry) => entry.id === themeName || entry.name === themeName);
    const due = row[dueIndex] || "";
    return [{
      title,
      theme_id: theme?.id || null,
      due_date: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
      status: statusMap[row[statusIndex]] || "todo",
      description: row[descriptionIndex] || "",
    }];
  });
}

export interface ExportData {
  themes: Theme[];
  items: Item[];
  notes: Note[];
  links: Link[];
  status_updates: StatusUpdate[];
  log_entries: BaseRecord[];
  source_records: SourceRecord[];
}

interface BuildExportArgs {
  data: WorkspaceData;
  themes: Theme[];
  items: Item[];
  activeTheme: Theme | null;
  scope: string;
}

export function buildExportData({ data, themes, items, activeTheme, scope }: BuildExportArgs): ExportData {
  const today = todayIso();
  const horizon = scope === "week" ? 7 : scope === "month" ? 30 : scope === "quarter" ? 90 : null;
  const inHorizon = (item: Item) => {
    const date = item.due_date || item.planned_end || item.planned_start;
    return Boolean(date && horizon != null && date >= today && date <= addDays(today, horizon));
  };
  let scopedItems = items;
  let scopedNotes = data.notes || [];
  let scopedLinks = data.links || [];
  let scopedThemes = themes;
  if (scope === "theme" && activeTheme) {
    scopedThemes = [activeTheme];
    scopedItems = items.filter((item) => item.theme_id === activeTheme.id);
    scopedNotes = scopedNotes.filter((note) => note.theme_id === activeTheme.id);
    scopedLinks = scopedLinks.filter((link) => link.theme_id === activeTheme.id);
  } else if (horizon) {
    scopedItems = items.filter(inHorizon);
  } else if (scope === "open") {
    scopedItems = items.filter((item) => item.status !== "done" && item.status !== "cancelled");
  } else if (scope === "waiting") {
    scopedItems = items.filter((item) => item.kind === "waiting" || item.status === "waiting");
  } else if (scope === "recent_notes") {
    scopedItems = [];
    scopedNotes = [...scopedNotes].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 20);
  } else if (scope === "milestones") {
    scopedItems = items.filter((item) => item.kind === "milestone");
  }
  const themeIds = new Set(
    [
      ...scopedItems.map((item) => item.theme_id),
      ...scopedNotes.map((note) => note.theme_id),
      ...scopedLinks.map((link) => link.theme_id),
    ].filter(Boolean) as string[],
  );
  if (scope !== "all" && scope !== "theme") scopedThemes = themes.filter((theme) => themeIds.has(theme.id));
  return {
    themes: scopedThemes,
    items: scopedItems,
    notes: scopedNotes,
    links: scopedLinks,
    status_updates: (data.status_updates || []).filter((entry) => !themeIds.size || (entry.theme_id != null && themeIds.has(entry.theme_id))),
    log_entries: (data.log_entries || []).filter((entry) => {
      const themeId = entry.theme_id as string | undefined;
      return !themeIds.size || (themeId != null && themeIds.has(themeId));
    }),
    source_records: data.source_records || [],
  };
}

export function exportMarkdown(data: ExportData): string {
  const sections = data.themes.flatMap((theme) => {
    const items = data.items.filter((item) => item.theme_id === theme.id);
    const notes = data.notes.filter((note) => note.theme_id === theme.id);
    const updates = data.status_updates
      .filter((entry) => entry.theme_id === theme.id)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return [
      `## Theme: ${theme.name}`,
      theme.description || "",
      "",
      "### Current Status",
      updates[0]?.summary || "- 未記録",
      "",
      "### Items",
      ...(items.length
        ? items.map((item) => `- [${item.status === "done" ? "x" : " "}] ${item.due_date || item.date_text || "日程未確定"} ${item.title}`)
        : ["- なし"]),
      "",
      "### Notes",
      ...(notes.length ? notes.map((note) => `- ${note.title}: ${note.body_markdown}`) : ["- なし"]),
      "",
    ];
  });
  const unscopedItems = data.items.filter((item) => !item.theme_id);
  const unscopedNotes = data.notes.filter((note) => !note.theme_id);
  if (unscopedItems.length || unscopedNotes.length || !sections.length) {
    sections.push(
      "## Themeなし",
      "",
      "### Items",
      ...(unscopedItems.length
        ? unscopedItems.map((item) => `- [${item.status === "done" ? "x" : " "}] ${item.due_date || item.date_text || "日程未確定"} ${item.title}`)
        : ["- なし"]),
      "",
      "### Notes",
      ...(unscopedNotes.length ? unscopedNotes.map((note) => `- ${note.title}: ${note.body_markdown}`) : ["- なし"]),
      "",
    );
  }
  return ["# Current Work Context", "", ...sections].join("\n");
}

export { toYaml };
