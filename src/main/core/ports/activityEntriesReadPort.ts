import type { AiAudience } from "../../../shared/aiMetadata.mjs";

export interface ActivityEntriesRecord extends Record<string, any> {
  id: string;
}

export interface ActivityEntriesWorkspace extends Record<string, any> {
  tasks?: ActivityEntriesRecord[];
  themes?: ActivityEntriesRecord[];
  change_events?: ActivityEntriesRecord[];
  references?: ActivityEntriesRecord[];
  canonical_root_status?: Record<string, unknown>;
}

export interface ActivityEntriesSnapshot {
  workspace: ActivityEntriesWorkspace;
  visibilityThemes: ActivityEntriesRecord[];
  workspaceAiVisibilityDefault: AiAudience[];
}

/** One Activity query snapshot from the existing database owner; this port never writes. */
export interface ActivityEntriesReadPort {
  readActivityEntriesSnapshot(includeArchived: boolean): ActivityEntriesSnapshot;
}
