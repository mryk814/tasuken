import { todayIso, toYaml } from "../../../utils/dataFormat.js";
import type {
  BaseRecord,
  Dependency,
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
  planned_end: string | null;
  status: string;
  description: string;
  kind?: string;
  priority?: string;
  planned_start?: string | null;
}

export function parseTaskTable(text: string, themes: Theme[]): ParsedTaskRow[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const delimiter = lines.some((line) => line.includes("\t")) ? "\t" : ",";
  const rows = lines.map((line) => line.split(delimiter).map((value) => value.trim()));
  const normalized = (value: string) => String(value || "").toLowerCase().replace(/\s/g, "");
  const knownHeaders = ["title", "タイトル", "タスク", "theme", "テーマ", "予定終了", "期限", "due", "状態", "status", "説明", "description"];
  const hasHeader = rows[0].some((value) => knownHeaders.includes(normalized(value)));
  const headers = hasHeader ? rows.shift()!.map(normalized) : ["タイトル", "theme", "予定終了", "状態", "説明"];
  const fieldIndex = (aliases: string[]) => headers.findIndex((header) => aliases.includes(header));
  const titleIndex = fieldIndex(["title", "タイトル", "タスク"]);
  const themeIndex = fieldIndex(["theme", "テーマ"]);
  const dueIndex = fieldIndex(["due", "due_date", "期限", "予定終了", "planned_end"]);
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
      planned_end: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
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
  dependencys: Dependency[];
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
    const date = item.planned_end || item.planned_start;
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
    dependencys: (data.dependencys || []).filter((dependency) => {
      const source = scopedItems.find((item) => item.id === dependency.source_item_id);
      const target = scopedItems.find((item) => item.id === dependency.target_item_id);
      return Boolean(source || target);
    }),
  };
}

function sortItemsForExport(items: Item[]): Item[] {
  return [...items].sort((a, b) => {
    const aDone = a.status === "done" ? 1 : 0;
    const bDone = b.status === "done" ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    const aDate = a.planned_end || a.planned_start || "9999-12-31";
    const bDate = b.planned_end || b.planned_start || "9999-12-31";
    return aDate.localeCompare(bDate);
  });
}

function formatNoteBody(body: string): string {
  const lines = body.split(/\r?\n/);
  if (lines.length <= 1) return body;
  return "\n" + lines.map((line) => `  > ${line}`).join("\n");
}

function renderItemSection(items: Item[]): string[] {
  const sorted = sortItemsForExport(items);
  const milestones = sorted.filter((item) => item.kind === "milestone");
  const waiting = sorted.filter((item) => item.kind === "waiting" || item.status === "waiting");
  const tasks = sorted.filter((item) => item.kind !== "milestone" && item.kind !== "waiting" && item.status !== "waiting");
  const lines: string[] = [];
  if (tasks.length) {
    lines.push("### Items", ...tasks.map((item) => `- [${item.status === "done" ? "x" : " "}] ${item.planned_end || "予定なし"} ${item.priority === "high" ? "!" : ""} ${item.title}`), "");
  }
  if (milestones.length) {
    lines.push("### Milestones", ...milestones.map((item) => `- ${item.planned_end || "予定なし"} ${item.title}`), "");
  }
  if (waiting.length) {
    lines.push("### Waiting", ...waiting.map((item) => `- ${item.planned_end || "予定なし"} ${item.title}`), "");
  }
  if (!lines.length) lines.push("### Items", "- なし", "");
  return lines;
}

export function exportMarkdown(data: ExportData): string {
  const sections = data.themes.flatMap((theme) => {
    const items = data.items.filter((item) => item.theme_id === theme.id);
    const notes = data.notes.filter((note) => note.theme_id === theme.id);
    const updates = data.status_updates
      .filter((entry) => entry.theme_id === theme.id)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const itemIds = new Set(items.map((item) => item.id));
    const dependencies = data.dependencys.filter((dependency) =>
      (dependency.source_item_id != null && itemIds.has(dependency.source_item_id))
      || (dependency.target_item_id != null && itemIds.has(dependency.target_item_id)));
    const itemTitle = (id?: string) => data.items.find((item) => item.id === id)?.title || id || "不明";
    return [
      `## Theme: ${theme.name}`,
      theme.description || "",
      "",
      "### Current Status",
      updates[0]?.summary || "- 未記録",
      "",
      ...renderItemSection(items),
      "### Dependencies",
      ...(dependencies.length
        ? dependencies.map((dependency) => `- ${itemTitle(dependency.source_item_id)} -> ${itemTitle(dependency.target_item_id)}`)
        : ["- なし"]),
      "",
      "### Notes",
      ...(notes.length ? notes.map((note) => `- **${note.title}**: ${formatNoteBody(note.body_markdown ?? "")}`) : ["- なし"]),
      "",
    ];
  });
  const unscopedItems = data.items.filter((item) => !item.theme_id);
  const unscopedNotes = data.notes.filter((note) => !note.theme_id);
  if (unscopedItems.length || unscopedNotes.length || !sections.length) {
    sections.push(
      "## Themeなし",
      "",
      ...renderItemSection(unscopedItems),
      "### Notes",
      ...(unscopedNotes.length ? unscopedNotes.map((note) => `- **${note.title}**: ${formatNoteBody(note.body_markdown ?? "")}`) : ["- なし"]),
      "",
    );
  }
  return [
    "# Current Work Context",
    "",
    "## AIに渡す時の注意事項",
    "- Taskenの正本はSQLiteです。提案は保存前に差分確認してください。",
    "- Item親子関係とDependencyは循環禁止です。",
    "- 期限や今日判定は利用者のローカル日付を基準にしてください。",
    "- 不明な参照先は推測で作らず、候補として分けてください。",
    "",
    ...sections,
  ].join("\n");
}

export { toYaml };
