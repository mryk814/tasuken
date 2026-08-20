import type { AiAudience } from "../../../shared/aiMetadata.mjs";

interface AiProjectionFields {
  ai_summary?: unknown;
  ai_summary_authority?: unknown;
  ai_freshness?: unknown;
  ai_authority?: unknown;
  ai_visibility?: unknown;
  ai_last_verified_at?: unknown;
  ai_superseded_by?: unknown;
  ai_source_refs?: unknown;
}

export interface ItemQueryRecord extends AiProjectionFields, Record<string, unknown> {
  id: string;
  title?: unknown;
  description?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  deleted_at?: unknown;
}

export interface ItemQueryThemeRecord extends Record<string, unknown> {
  id: string;
  default_ai_visibility?: unknown;
}

export interface ItemQuerySnapshot {
  items: ItemQueryRecord[];
  tasks: ItemQueryRecord[];
  waitings: ItemQueryRecord[];
  planNodes: ItemQueryRecord[];
  schedules: ItemQueryRecord[];
  themes: ItemQueryThemeRecord[];
  workspaceAiVisibilityDefault: AiAudience[];
}

/** One query-specific, read-only snapshot. It never creates defaults or writes. */
export interface ItemQueryReadPort {
  readItemQuerySnapshot(includeArchived: boolean): ItemQuerySnapshot;
}
