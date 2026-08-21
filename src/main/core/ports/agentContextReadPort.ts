import type { AiAudience } from "../../../shared/aiMetadata.mjs";

export interface AgentContextRecord extends Record<string, any> { id: string }
export interface AgentContextWorkspace extends Record<string, any> {
  themes?: AgentContextRecord[];
  change_events?: AgentContextRecord[];
  references?: AgentContextRecord[];
  canonical_root_status?: Record<string, unknown>;
}
export interface AgentContextSnapshot {
  workspace: AgentContextWorkspace;
  visibilityThemes: AgentContextRecord[];
  workspaceAiVisibilityDefault: AiAudience[];
}

/** A single immutable workspace read for bounded Activity/Context projections. */
export interface AgentContextReadPort {
  readAgentContextSnapshot(includeArchived: boolean): AgentContextSnapshot;
}
