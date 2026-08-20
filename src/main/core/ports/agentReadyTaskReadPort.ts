import type { AiAudience } from "../../../shared/aiMetadata.mjs";

interface AiProjectionSourceFields {
  ai_summary?: unknown;
  ai_summary_authority?: unknown;
  ai_freshness?: unknown;
  ai_authority?: unknown;
  ai_visibility?: unknown;
  ai_last_verified_at?: unknown;
  ai_superseded_by?: unknown;
  ai_source_refs?: unknown;
}

/**
 * Query-specific Task source record.
 * Additional Task body fields stay lossless until the legacy MCP response is retired;
 * this is not permission to expose other entity collections or a workspace aggregate.
 */
export interface AgentReadyTaskSourceRecord extends AiProjectionSourceFields, Record<string, unknown> {
  id: string;
  title?: unknown;
  description?: unknown;
  project_id?: unknown;
  theme_id?: unknown;
  intended_executor?: unknown;
  work_state?: unknown;
  state?: unknown;
  updated_at?: unknown;
  deleted_at?: unknown;
}

export interface AgentReadyTaskThemeRecord extends Record<string, unknown> {
  id: string;
  name?: unknown;
  default_ai_visibility?: unknown;
}

/** Read-only data needed by the first Tasken Core query slice. */
export interface AgentReadyTaskReadPort {
  listTasks(includeArchived: boolean): AgentReadyTaskSourceRecord[];
  listThemes(): AgentReadyTaskThemeRecord[];
  workspaceAiVisibilityDefault(): AiAudience[];
}
