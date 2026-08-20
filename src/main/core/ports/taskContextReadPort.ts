import type { AiAudience } from "../../../shared/aiMetadata.mjs";

export interface TaskContextRecord extends Record<string, any> {
  id: string;
}

export interface TaskContextWorkspace extends Record<string, any> {
  themes?: TaskContextRecord[];
  tasks?: TaskContextRecord[];
  repository_contexts?: TaskContextRecord[];
  work_receipts?: TaskContextRecord[];
  change_events?: TaskContextRecord[];
  references?: TaskContextRecord[];
  canonical_root_status?: Record<string, unknown>;
}

/** The adapter returns the bounded query's source snapshot from the one WorkspaceDatabase owner. */
export interface TaskContextReadPort {
  loadTaskContextWorkspace(includeArchived: boolean): TaskContextWorkspace;
  workspaceAiVisibilityDefault(): AiAudience[];
}
