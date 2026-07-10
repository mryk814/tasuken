import type { StatusUpdate, Theme } from "../types";
import type { WorkspaceDomain } from "../domain-model/types";
import { compareCapturesNewestFirst } from "../domain-model/selectors";

interface ActivityLogInput {
  date: string;
  domain: Pick<WorkspaceDomain, "tasks" | "waitings" | "notes" | "resources" | "knowledge_nodes" | "capture_entries">;
  statusUpdates: StatusUpdate[];
  themes: Theme[];
}

/** Activity Log 用の Theme 表示。ID から現時点の正式名・識別子・概要を解決する。 */
export type ActivityThemeRef = {
  id: string | null;
  /** 表示名（正式な Theme 名、またはフォールバック） */
  name: string;
  /** Theme.code。未設定・参照切れ時は空 */
  code: string;
  /** Theme.description（概要） */
  description: string;
  /** themes 一覧に存在しない（削除済みなど） */
  missing: boolean;
};

function recordDate(value: unknown): string {
  return String(value || "").slice(0, 10);
}

function timestampOf(record: unknown): unknown {
  const row = record as Record<string, unknown>;
  return row.updated_at || row.created_at;
}

function text(value: unknown): string {
  return String(value || "").trim();
}

/**
 * project_id / theme_id から現在の Theme を解決する。
 * - 未所属: 個人業務
 * - 削除済み・参照切れ: 削除済みTheme + 短い ID 断片（後から辿れる程度）
 */
export function resolveActivityTheme(themes: Theme[], projectId?: string | null): ActivityThemeRef {
  const id = text(projectId);
  if (!id) {
    return { id: null, name: "個人業務", code: "", description: "", missing: false };
  }
  const theme = themes.find((entry) => entry.id === id);
  if (!theme) {
    return {
      id,
      name: "削除済みTheme",
      code: id.slice(0, 8),
      description: "",
      missing: true,
    };
  }
  return {
    id: theme.id,
    name: text(theme.name) || "無題のTheme",
    code: text(theme.code),
    description: text(theme.description),
    missing: false,
  };
}

/** 各行の短い Theme ラベル。例: 材料A (MAT-A) */
export function formatActivityThemeLabel(ref: ActivityThemeRef): string {
  if (ref.code) return `${ref.name} (${ref.code})`;
  return ref.name;
}

/** Theme 一覧セクションの1行。Theme名 / 識別子 / 概要 */
export function formatActivityThemeDetail(ref: ActivityThemeRef): string {
  const code = ref.code || "—";
  const description = ref.description || "—";
  return `- ${ref.name} / ${code} / ${description}`;
}

function collectThemeIds(ids: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const raw of ids) {
    const id = text(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  return ordered;
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

  const labelOf = (projectId?: string | null) => formatActivityThemeLabel(resolveActivityTheme(themes, projectId));

  const themeIds = collectThemeIds([
    ...completedTasks.map((task) => task.project_id),
    ...receivedWaitings.map((waiting) => waiting.project_id),
    ...notes.map((note) => note.project_id),
    ...resources.map((resource) => resource.project_id),
    ...knowledge.map((node) => node.project_id),
    ...updates.map((entry) => entry.theme_id),
  ]);
  const themeDetails = themeIds.map((id) => formatActivityThemeDetail(resolveActivityTheme(themes, id)));

  return [
    `# Activity Log ${date}`,
    "",
    "## 登場したTheme",
    ...(themeDetails.length ? themeDetails : ["- なし"]),
    "",
    "## 完了したタスク",
    ...(completedTasks.length ? completedTasks.map((task) => `- [x] ${labelOf(task.project_id)} / ${task.title}`) : ["- なし"]),
    "",
    "## 受け取ったWaiting",
    ...(receivedWaitings.length ? receivedWaitings.map((waiting) => `- ${labelOf(waiting.project_id)} / ${waiting.title} / ${waiting.waiting_for}`) : ["- なし"]),
    "",
    "## 作成・更新したNotes",
    ...(notes.length ? notes.map((note) => `- ${labelOf(note.project_id)} / ${note.title}`) : ["- なし"]),
    "",
    "## 追加・更新したリンク/資料",
    ...(resources.length ? resources.map((resource) => `- ${labelOf(resource.project_id)} / ${resource.title}${resource.url ? ` (${resource.url})` : ""}`) : ["- なし"]),
    "",
    "## Knowledge",
    ...(knowledge.length ? knowledge.map((node) => `- ${labelOf(node.project_id)} / ${node.node_type}: ${node.title}`) : ["- なし"]),
    "",
    "## 現在地更新",
    ...(updates.length
      ? updates.map((entry) => {
        const theme = resolveActivityTheme(themes, entry.theme_id);
        // Theme なしの現在地は「全体」（個人業務にしない）
        const head = entry.theme_id ? formatActivityThemeLabel(theme) : "全体";
        return `- ${head}: ${entry.summary || entry.next_actions || entry.risks}`;
      })
      : ["- なし"]),
    "",
    "## Capture / やったこと記録",
    ...(captures.length ? captures.map((entry) => `- ${entry.title || entry.text}`) : ["- なし"]),
  ].join("\n");
}
