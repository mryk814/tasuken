import type { BaseRecord } from "../types";
import type { Task } from "../domain-model/types";

export const TASK_SECTION_VIEW_TYPE = "task_section";
export const UNSECTIONED_TASK_SECTION_ID = "unsectioned";

export interface TaskSection extends BaseRecord {
  title: string;
  view_type: typeof TASK_SECTION_VIEW_TYPE;
  theme_id: string;
  sort_order: number;
}

export interface TaskSectionGroup {
  id: string;
  title: string;
  section: TaskSection | null;
  tasks: Task[];
  openCount: number;
  doneCount: number;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isDoneTask(task: Task): boolean {
  return task.state === "done" || task.state === "cancelled";
}

export function isTaskSection(record: BaseRecord | Record<string, unknown>): boolean {
  return text(record.view_type) === TASK_SECTION_VIEW_TYPE;
}

export function normalizeTaskSection(record: BaseRecord | Record<string, unknown>): TaskSection | null {
  if (!isTaskSection(record)) return null;
  const id = text(record.id);
  const title = text(record.title);
  const themeId = text(record.theme_id);
  if (!id || !title || !themeId) return null;
  return {
    ...(record as BaseRecord),
    id,
    title,
    view_type: TASK_SECTION_VIEW_TYPE,
    theme_id: themeId,
    sort_order: Number.isFinite(Number(record.sort_order)) ? Number(record.sort_order) : 0,
  };
}

export function listTaskSections(views: BaseRecord[] = [], themeId: string): TaskSection[] {
  return views
    .map((view) => normalizeTaskSection(view))
    .filter((section): section is TaskSection => Boolean(section && section.theme_id === themeId))
    .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, "ja"));
}

export function normalizeTaskSectionId(value: unknown, sections: TaskSection[], themeId?: string | null): string | null {
  const id = text(value);
  if (!id) return null;
  const section = sections.find((entry) => entry.id === id);
  if (!section) return null;
  return themeId && section.theme_id !== themeId ? null : section.id;
}

export function buildTaskSection({
  id,
  title,
  themeId,
  sortOrder,
  now = new Date().toISOString(),
}: {
  id?: string;
  title: string;
  themeId: string;
  sortOrder: number;
  now?: string;
}): TaskSection {
  return {
    id: id || crypto.randomUUID(),
    title: text(title),
    view_type: TASK_SECTION_VIEW_TYPE,
    theme_id: themeId,
    sort_order: sortOrder,
    created_at: now,
  };
}

export function groupTasksBySection(tasks: Task[], sections: TaskSection[], themeId: string): TaskSectionGroup[] {
  const sectionIds = new Set(sections.map((section) => section.id));
  const themeTasks = tasks.filter((task) => task.project_id === themeId);
  const groups: TaskSectionGroup[] = sections.map((section) => {
    const sectionTasks = themeTasks.filter((task) => task.section_id === section.id);
    return {
      id: section.id,
      title: section.title,
      section,
      tasks: sectionTasks,
      openCount: sectionTasks.filter((task) => !isDoneTask(task)).length,
      doneCount: sectionTasks.filter(isDoneTask).length,
    };
  });
  const unsectionedTasks = themeTasks
    .filter((task) => !task.section_id || !sectionIds.has(task.section_id))
    .sort((a, b) => a.title.localeCompare(b.title, "ja"));
  groups.push({
    id: UNSECTIONED_TASK_SECTION_ID,
    title: "未設定",
    section: null,
    tasks: unsectionedTasks,
    openCount: unsectionedTasks.filter((task) => !isDoneTask(task)).length,
    doneCount: unsectionedTasks.filter(isDoneTask).length,
  });
  return groups;
}
