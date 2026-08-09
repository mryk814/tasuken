import type { BaseRecord, WorkspaceData } from "../types";
import { activeRecords } from "./format";

export const WORKSPACE_ARRAY_KEYS: (keyof WorkspaceData)[] = [
  "themes", "items", "notes", "links", "resources", "views",
  "status_updates", "source_records", "entity_sources",
  "field_definitions", "field_values", "log_entries", "import_batchs",
  "knowledge_nodes", "ai_proposals", "plan_revisions",
  "projects", "capture_entrys", "tasks", "waitings", "plan_nodes",
  "schedules", "references", "task_dependencies", "plan_dependencies",
  "knowledge_edges", "change_events", "artifacts", "repository_contexts",
  "sketches", "work_receipts",
];

export function emptyWorkspaceData(): WorkspaceData {
  return Object.fromEntries(WORKSPACE_ARRAY_KEYS.map((key) => [key, []])) as unknown as WorkspaceData;
}

export function projectWorkspaceData(workspace: Record<string, unknown> | null): WorkspaceData {
  const result = emptyWorkspaceData();
  if (!workspace) return result;
  for (const key of WORKSPACE_ARRAY_KEYS) {
    const value = workspace[key];
    if (Array.isArray(value)) (result[key] as BaseRecord[]) = activeRecords(value as BaseRecord[]);
  }
  result.meta = (workspace.meta as WorkspaceData["meta"]) || undefined;
  result.canonical_root_status = workspace.canonical_root_status as WorkspaceData["canonical_root_status"];
  return result;
}
