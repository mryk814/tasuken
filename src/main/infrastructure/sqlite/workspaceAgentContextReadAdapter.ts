import { DEFAULT_AI_VISIBILITY, normalizeAiVisibility } from "../../../shared/aiMetadata.mjs";
import type { AgentContextReadPort, AgentContextRecord, AgentContextSnapshot, AgentContextWorkspace } from "../../core/public.ts";

export interface AgentContextWorkspacePersistence {
  readWorkspaceSnapshot(includeDeleted?: boolean): AgentContextWorkspace;
  list(type: "theme", includeDeleted?: boolean): AgentContextRecord[];
  readPreference(key: "aiVisibilityDefault"): unknown;
}

export class WorkspaceAgentContextReadAdapter implements AgentContextReadPort {
  constructor(private readonly persistence: AgentContextWorkspacePersistence) {}

  readAgentContextSnapshot(includeArchived: boolean): AgentContextSnapshot {
    return {
      workspace: this.persistence.readWorkspaceSnapshot(includeArchived),
      visibilityThemes: this.persistence.list("theme", true),
      workspaceAiVisibilityDefault: normalizeAiVisibility(this.persistence.readPreference("aiVisibilityDefault")) || [...DEFAULT_AI_VISIBILITY],
    };
  }
}
