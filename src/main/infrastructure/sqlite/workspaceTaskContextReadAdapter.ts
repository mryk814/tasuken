import type {
  TaskContextReadPort,
  TaskContextRecord,
  TaskContextWorkspace,
} from "../../core/public.ts";

export interface TaskContextWorkspacePersistence {
  readWorkspaceSnapshot(includeDeleted?: boolean): TaskContextWorkspace;
  list(type: "theme", includeDeleted?: boolean): TaskContextRecord[];
}

/** Uses the composition root's existing WorkspaceDatabase; it never opens a database. */
export class WorkspaceTaskContextReadAdapter implements TaskContextReadPort {
  constructor(private readonly persistence: TaskContextWorkspacePersistence) {}

  loadTaskContextWorkspace(includeArchived: boolean) {
    return this.persistence.readWorkspaceSnapshot(includeArchived);
  }

  loadTaskContextThemes() {
    return this.persistence.list("theme", true);
  }
}
