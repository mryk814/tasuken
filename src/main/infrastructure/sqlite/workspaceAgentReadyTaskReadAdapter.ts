import type {
  AgentReadyTaskReadPort,
  AgentReadyTaskSourceRecord,
  AgentReadyTaskThemeRecord,
} from "../../core/public.ts";

export interface AgentReadyTaskWorkspacePersistence {
  list(type: "task", includeDeleted?: boolean): AgentReadyTaskSourceRecord[];
  list(type: "theme", includeDeleted?: boolean): AgentReadyTaskThemeRecord[];
}

/** Uses the composition root's existing WorkspaceDatabase instance; it never opens a DB. */
export class WorkspaceAgentReadyTaskReadAdapter implements AgentReadyTaskReadPort {
  private readonly persistence: AgentReadyTaskWorkspacePersistence;

  constructor(persistence: AgentReadyTaskWorkspacePersistence) {
    this.persistence = persistence;
  }

  listTasks(includeArchived: boolean): AgentReadyTaskSourceRecord[] {
    return this.persistence.list("task", includeArchived);
  }

  listThemes(): AgentReadyTaskThemeRecord[] {
    return this.persistence.list("theme", true);
  }
}
