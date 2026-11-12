import type {
  AgentContextReadPort,
  AgentContextRecord,
  AgentContextSnapshot,
  AgentContextWorkspace,
} from "../../core/public.ts";

export interface AgentContextWorkspacePersistence {
  readWorkspaceSnapshot(includeDeleted?: boolean): AgentContextWorkspace;
  list(type: "theme", includeDeleted?: boolean): AgentContextRecord[];
}

export class WorkspaceAgentContextReadAdapter implements AgentContextReadPort {
  constructor(private readonly persistence: AgentContextWorkspacePersistence) {}

  readAgentContextSnapshot(includeArchived: boolean): AgentContextSnapshot {
    return {
      workspace: this.persistence.readWorkspaceSnapshot(includeArchived),
    };
  }
}
