import { todayIso, toYaml } from "../../../utils/dataFormat.js";
import type {
  BaseRecord,
  Dependency,
  Item,
  KnowledgeNode,
  KnowledgeRelation,
  Link,
  Note,
  SourceRecord,
  StatusUpdate,
  Theme,
  WorkspaceData,
} from "../types";
import { KIND_LABELS, KNOWLEDGE_NODE_LABELS, STATUS_LABELS } from "./domain";
import { addDays } from "./format";
import { domainToItems } from "../domain-model/compat/itemProjection";
import type { Resource, WorkspaceDomain } from "../domain-model/types";

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
  knowledge_nodes: KnowledgeNode[];
  knowledge_relations: KnowledgeRelation[];
}

interface BuildExportArgs {
  data: WorkspaceData;
  domain: WorkspaceDomain;
  themes: Theme[];
  items: Item[];
  activeTheme: Theme | null;
  scope: string;
}

export function buildExportData({ data, domain, themes, items, activeTheme, scope }: BuildExportArgs): ExportData {
  const today = todayIso();
  const horizon = scope === "week" ? 7 : scope === "month" ? 30 : scope === "quarter" ? 90 : null;
  const v2Items = domainToItems(domain);
  const legacyIds = new Set(items.map((item) => item.id));
  const v2OnlyItems = v2Items.filter((item) => !legacyIds.has(item.id));
  const mergedItems = [...items, ...v2OnlyItems];

  const inHorizon = (item: Item) => {
    const date = item.planned_end || item.planned_start;
    return Boolean(date && horizon != null && date >= today && date <= addDays(today, horizon));
  };
  let scopedItems = mergedItems;
  let scopedNotes = data.notes || [];
  const resourcesAsLinks: Link[] = (domain.resources || [])
    .filter((r) => r.title)
    .map((r) => ({
      id: r.id,
      title: r.title,
      url: r.url || "",
      theme_id: r.project_id || null,
      description: r.description || "",
      source_record_id: r.source_record_id || null,
    }));
  const legacyLinkIds = new Set((data.links || []).map((l) => l.id));
  const mergedLinks: Link[] = [...(data.links || []), ...resourcesAsLinks.filter((r) => !legacyLinkIds.has(r.id))];
  let scopedLinks = mergedLinks;
  let scopedKnowledgeNodes = data.knowledge_nodes || [];
  let scopedThemes = themes;
  if (scope === "theme" && activeTheme) {
    scopedThemes = [activeTheme];
    scopedItems = mergedItems.filter((item) => item.theme_id === activeTheme.id);
    scopedNotes = scopedNotes.filter((note) => note.theme_id === activeTheme.id);
    scopedLinks = scopedLinks.filter((link) => link.theme_id === activeTheme.id);
    scopedKnowledgeNodes = scopedKnowledgeNodes.filter((node) => node.theme_id === activeTheme.id);
  } else if (horizon) {
    scopedItems = mergedItems.filter(inHorizon);
  } else if (scope === "open") {
    scopedItems = mergedItems.filter((item) => item.status !== "done" && item.status !== "cancelled");
  } else if (scope === "waiting") {
    scopedItems = mergedItems.filter((item) => item.kind === "waiting" || item.status === "waiting");
  } else if (scope === "recent_notes") {
    scopedItems = [];
    scopedNotes = [...scopedNotes].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 20);
  } else if (scope === "milestones") {
    scopedItems = mergedItems.filter((item) => item.kind === "milestone");
  }
  const themeIds = new Set(
    [
      ...scopedItems.map((item) => item.theme_id),
      ...scopedNotes.map((note) => note.theme_id),
      ...scopedLinks.map((link) => link.theme_id),
      ...scopedKnowledgeNodes.map((node) => node.theme_id),
    ].filter(Boolean) as string[],
  );
  const knowledgeIds = new Set(scopedKnowledgeNodes.map((node) => node.id));
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
    knowledge_nodes: scopedKnowledgeNodes,
    knowledge_relations: (data.knowledge_relations || []).filter((relation) =>
      knowledgeIds.has(String(relation.source_node_id)) || knowledgeIds.has(String(relation.target_node_id))),
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

function renderKnowledgeSection(nodes: KnowledgeNode[], relations: KnowledgeRelation[] = []): string[] {
  const activeByType = (type: string) => nodes.filter((node) => node.node_type === type && (node.status || "active") === "active");
  const evidenceIds = new Set(nodes.filter((node) => node.node_type === "evidence").map((node) => node.id));
  const claimsWithoutEvidence = activeByType("claim").filter((claim) => {
    const supportTargets = relations
      .filter((relation) => relation.source_node_id === claim.id && relation.relation_type === "supports")
      .map((relation) => relation.target_node_id);
    return supportTargets.every((id) => !evidenceIds.has(String(id)));
  });
  const contradictions = relations.filter((relation) => relation.relation_type === "contradicts");
  const nodeTitle = (id?: string) => nodes.find((node) => node.id === id)?.title || "不明";
  return [
    "### Questions",
    ...(activeByType("question").length ? activeByType("question").map((node) => `- ${node.title}`) : ["- なし"]),
    "",
    "### Claims",
    ...(activeByType("claim").length ? activeByType("claim").map((node) => `- ${node.title}`) : ["- なし"]),
    "",
    "### Evidence",
    ...(activeByType("evidence").length ? activeByType("evidence").map((node) => `- ${node.title}`) : ["- なし"]),
    "",
    "### Decisions",
    ...(activeByType("decision").length ? activeByType("decision").map((node) => `- ${node.title}`) : ["- なし"]),
    "",
    "### Risks / Contradictions",
    ...(contradictions.length ? contradictions.map((relation) => `- ${nodeTitle(relation.source_node_id)} contradicts ${nodeTitle(relation.target_node_id)}`) : ["- なし"]),
    ...(claimsWithoutEvidence.length ? ["", "### Claims Without Evidence", ...claimsWithoutEvidence.map((node) => `- ${node.title}`)] : []),
    "",
  ];
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
    const knowledgeNodes = data.knowledge_nodes.filter((node) => node.theme_id === theme.id);
    const knowledgeIds = new Set(knowledgeNodes.map((node) => node.id));
    const knowledgeRelations = data.knowledge_relations.filter((relation) =>
      knowledgeIds.has(String(relation.source_node_id)) || knowledgeIds.has(String(relation.target_node_id)));
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
      "### Knowledge",
      ...(knowledgeNodes.length
        ? knowledgeNodes.map((node) => `- ${KNOWLEDGE_NODE_LABELS[node.node_type] || node.node_type}: ${node.title}${node.body ? `: ${formatNoteBody(node.body)}` : ""}`)
        : ["- なし"]),
      "",
      ...renderKnowledgeSection(knowledgeNodes, knowledgeRelations),
    ];
  });
  const unscopedItems = data.items.filter((item) => !item.theme_id);
  const unscopedNotes = data.notes.filter((note) => !note.theme_id);
  const unscopedKnowledgeNodes = data.knowledge_nodes.filter((node) => !node.theme_id);
  if (unscopedItems.length || unscopedNotes.length || unscopedKnowledgeNodes.length || !sections.length) {
    sections.push(
      "## Themeなし",
      "",
      ...renderItemSection(unscopedItems),
      "### Notes",
      ...(unscopedNotes.length ? unscopedNotes.map((note) => `- **${note.title}**: ${formatNoteBody(note.body_markdown ?? "")}`) : ["- なし"]),
      "",
      "### Knowledge",
      ...(unscopedKnowledgeNodes.length
        ? unscopedKnowledgeNodes.map((node) => `- ${KNOWLEDGE_NODE_LABELS[node.node_type] || node.node_type}: ${node.title}`)
        : ["- なし"]),
      "",
      ...renderKnowledgeSection(unscopedKnowledgeNodes, data.knowledge_relations),
    );
  }
  return [
    "# Current Work Context",
    "",
    "## AIに渡す時の注意事項",
    "- Taskenの正本はSQLiteです。提案は保存前に差分確認してください。",
    "- タスク親子関係とDependencyは循環禁止です。",
    "- 期限や今日判定は利用者のローカル日付を基準にしてください。",
    "- 不明な参照先は推測で作らず、候補として分けてください。",
    "",
    ...sections,
  ].join("\n");
}

function itemDate(item: Item): string {
  return String(item.planned_end || item.planned_start || item.due_date || "");
}

function isOpen(item: Item): boolean {
  return item.status !== "done" && item.status !== "cancelled" && item.status !== "archived";
}

function latestUpdateFor(theme: Theme, updates: StatusUpdate[]): StatusUpdate | undefined {
  return updates
    .filter((entry) => entry.theme_id === theme.id)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0];
}

function itemLine(item: Item): string {
  const status = STATUS_LABELS[item.status ?? ""] || item.status || "未設定";
  const kind = KIND_LABELS[item.kind ?? ""] || "タスク";
  const date = itemDate(item) || "予定なし";
  return `- ${date} / ${status} / ${kind}: ${item.title}${item.priority === "high" ? " [優先]" : ""}`;
}

export function exportProgressReport(data: ExportData): string {
  const today = todayIso();
  const weekStart = addDays(today, -6);
  const soon = addDays(today, 14);
  const completed = data.items
    .filter((item) => item.status === "done" && String(item.completed_at || item.actual_end || item.updated_at || "").slice(0, 10) >= weekStart)
    .sort((a, b) => String(b.completed_at || b.actual_end || b.updated_at || "").localeCompare(String(a.completed_at || a.actual_end || a.updated_at || "")));
  const delayed = data.items
    .filter((item) => isOpen(item) && itemDate(item) && itemDate(item) < today)
    .sort((a, b) => itemDate(a).localeCompare(itemDate(b)));
  const waiting = data.items
    .filter((item) => isOpen(item) && (item.kind === "waiting" || item.status === "waiting"))
    .sort((a, b) => itemDate(a).localeCompare(itemDate(b)));
  const milestones = data.items
    .filter((item) => isOpen(item) && item.kind === "milestone" && itemDate(item) && itemDate(item) <= soon)
    .sort((a, b) => itemDate(a).localeCompare(itemDate(b)));
  const risks = data.status_updates
    .filter((entry) => entry.risks)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 8);
  const nextActions = data.status_updates
    .filter((entry) => entry.next_actions)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 8);
  const sections = data.themes.map((theme) => {
    const update = latestUpdateFor(theme, data.status_updates);
    const themeItems = data.items.filter((item) => item.theme_id === theme.id && isOpen(item));
    return [
      `### ${theme.name}`,
      `- 現在地: ${update?.summary || "未記録"}`,
      update?.risks ? `- リスク: ${update.risks}` : "- リスク: なし",
      update?.next_actions ? `- 次アクション: ${update.next_actions}` : "- 次アクション: 未設定",
      `- 未完了: ${themeItems.length}件`,
    ].join("\n");
  });
  return [
    `# 週報 / 現在地レポート (${weekStart} - ${today})`,
    "",
    "## Themeごとの現在地",
    ...(sections.length ? sections : ["- Themeなし"]),
    "",
    "## 完了したこと",
    ...(completed.length ? completed.map(itemLine) : ["- なし"]),
    "",
    "## 未完了・遅延",
    ...(delayed.length ? delayed.map(itemLine) : ["- なし"]),
    "",
    "## Waiting",
    ...(waiting.length ? waiting.map((item) => `${itemLine(item)}${item.waiting_for ? ` / 相手: ${item.waiting_for}` : ""}${item.next_action ? ` / 次: ${item.next_action}` : ""}`) : ["- なし"]),
    "",
    "## 近いマイルストーン",
    ...(milestones.length ? milestones.map(itemLine) : ["- なし"]),
    "",
    "## リスク",
    ...(risks.length ? risks.map((entry) => `- ${entry.date || "日付なし"} / ${data.themes.find((theme) => theme.id === entry.theme_id)?.name || "全体"}: ${entry.risks}`) : ["- なし"]),
    "",
    "## 次アクション",
    ...(nextActions.length ? nextActions.map((entry) => `- ${entry.date || "日付なし"} / ${data.themes.find((theme) => theme.id === entry.theme_id)?.name || "全体"}: ${entry.next_actions}`) : ["- なし"]),
    "",
    "## AIに依頼したい時の補足",
    "- 上の内容をもとに、過不足の確認、優先順位案、報告文への整形を依頼できます。",
  ].join("\n");
}

export { toYaml };
