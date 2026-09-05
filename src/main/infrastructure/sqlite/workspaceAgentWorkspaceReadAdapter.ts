import { DEFAULT_AI_VISIBILITY, normalizeAiVisibility } from "../../../shared/aiMetadata.mjs";
import type {
  AgentWorkspaceReadPort,
  AgentWorkspaceRecord,
  AgentReadyTaskSourceRecord,
  AgentReadyTaskThemeRecord,
} from "../../core/public.ts";

export interface AgentWorkspacePersistence {
  list(type: "task", includeDeleted?: boolean): AgentReadyTaskSourceRecord[];
  list(type: "theme", includeDeleted?: boolean): AgentReadyTaskThemeRecord[];
  list(
    type:
      | "repository_context"
      | "work_receipt"
      | "working_copy"
      | "agent_session"
      | "reference"
      | "ai_proposal",
    includeDeleted?: boolean,
  ): AgentWorkspaceRecord[];
  readPreference(key: "aiVisibilityDefault"): unknown;
}

/** Query-specific adapter over the composition root's existing WorkspaceDatabase. */
export class WorkspaceAgentWorkspaceReadAdapter implements AgentWorkspaceReadPort {
  constructor(private readonly persistence: AgentWorkspacePersistence) {}

  listTasks(includeArchived: boolean) {
    return this.persistence.list("task", includeArchived);
  }

  listThemes(includeArchived: boolean) {
    return this.persistence.list("theme", includeArchived);
  }

  listRepositoryContexts(includeArchived: boolean) {
    return this.persistence.list("repository_context", includeArchived);
  }

  listWorkReceipts(includeArchived: boolean) {
    return this.persistence.list("work_receipt", includeArchived);
  }

  listAiProposals(includeArchived: boolean) {
    return this.persistence.list("ai_proposal", includeArchived);
  }

  listWorkingCopies(includeArchived: boolean) {
    return this.persistence.list("working_copy", includeArchived);
  }

  listAgentSessions(includeArchived: boolean) {
    return this.persistence.list("agent_session", includeArchived);
  }

  listReferences(includeArchived: boolean) {
    return this.persistence.list("reference", includeArchived);
  }

  workspaceAiVisibilityDefault() {
    return (
      normalizeAiVisibility(this.persistence.readPreference("aiVisibilityDefault")) || [
        ...DEFAULT_AI_VISIBILITY,
      ]
    );
  }
}
