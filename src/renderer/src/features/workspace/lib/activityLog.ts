import type { StatusUpdate, Theme } from "../types";
import type { WorkspaceDomain } from "../domain-model/types";
import { compareCapturesNewestFirst } from "../domain-model/selectors";

interface ActivityLogInput {
  date: string;
  domain: Pick<WorkspaceDomain, "tasks" | "waitings" | "notes" | "resources" | "knowledge_nodes" | "capture_entries">;
  statusUpdates: StatusUpdate[];
  themes: Theme[];
}

function recordDate(value: unknown): string {
  return String(value || "").slice(0, 10);
}

function timestampOf(record: unknown): unknown {
  const row = record as Record<string, unknown>;
  return row.updated_at || row.created_at;
}

function themeName(themes: Theme[], projectId?: string | null): string {
  return themes.find((theme) => theme.id === projectId)?.name || "個人業務";
}

export function buildActivityLog({ date, domain, statusUpdates, themes }: ActivityLogInput): string {
  const completedTasks = domain.tasks
    .filter((task) => task.state === "done" && recordDate(task.completed_at || task.updated_at) === date)
    .sort((a, b) => String(a.title).localeCompare(String(b.title), "ja"));
  const receivedWaitings = domain.waitings
    .filter((waiting) => waiting.state === "received" && recordDate(waiting.updated_at) === date)
    .sort((a, b) => String(a.title).localeCompare(String(b.title), "ja"));
  const notes = domain.notes
    .filter((note) => recordDate(timestampOf(note)) === date)
    .sort((a, b) => String(a.title).localeCompare(String(b.title), "ja"));
  const resources = domain.resources
    .filter((resource) => recordDate(resource.captured_at || timestampOf(resource)) === date)
    .sort((a, b) => String(a.title).localeCompare(String(b.title), "ja"));
  const knowledge = domain.knowledge_nodes
    .filter((node) => recordDate(timestampOf(node)) === date)
    .sort((a, b) => String(a.title).localeCompare(String(b.title), "ja"));
  const updates = statusUpdates
    .filter((entry) => recordDate(entry.date || entry.updated_at || entry.created_at) === date)
    .sort((a, b) => String(a.summary).localeCompare(String(b.summary), "ja"));
  const captures = domain.capture_entries
    .filter((entry) => recordDate(entry.captured_at) === date)
    .sort(compareCapturesNewestFirst);

  return [
    `# Activity Log ${date}`,
    "",
    "## 完了したタスク",
    ...(completedTasks.length ? completedTasks.map((task) => `- [x] ${themeName(themes, task.project_id)} / ${task.title}`) : ["- なし"]),
    "",
    "## 受け取ったWaiting",
    ...(receivedWaitings.length ? receivedWaitings.map((waiting) => `- ${themeName(themes, waiting.project_id)} / ${waiting.title} / ${waiting.waiting_for}`) : ["- なし"]),
    "",
    "## 作成・更新したNotes",
    ...(notes.length ? notes.map((note) => `- ${themeName(themes, note.project_id)} / ${note.title}`) : ["- なし"]),
    "",
    "## 追加・更新したリンク/資料",
    ...(resources.length ? resources.map((resource) => `- ${themeName(themes, resource.project_id)} / ${resource.title}${resource.url ? ` (${resource.url})` : ""}`) : ["- なし"]),
    "",
    "## Knowledge",
    ...(knowledge.length ? knowledge.map((node) => `- ${themeName(themes, node.project_id)} / ${node.node_type}: ${node.title}`) : ["- なし"]),
    "",
    "## 現在地更新",
    ...(updates.length ? updates.map((entry) => `- ${themes.find((theme) => theme.id === entry.theme_id)?.name || "全体"}: ${entry.summary || entry.next_actions || entry.risks}`) : ["- なし"]),
    "",
    "## Capture / やったこと記録",
    ...(captures.length ? captures.map((entry) => `- ${entry.title || entry.text}`) : ["- なし"]),
  ].join("\n");
}
