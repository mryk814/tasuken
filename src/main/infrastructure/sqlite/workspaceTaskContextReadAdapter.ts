import { DEFAULT_AI_VISIBILITY, normalizeAiVisibility } from "../../../shared/aiMetadata.mjs";
import type { TaskContextReadPort, TaskContextRecord, TaskContextWorkspace } from "../../core/public.ts";

export interface TaskContextWorkspacePersistence {
  readWorkspaceSnapshot(includeDeleted?: boolean): TaskContextWorkspace;
  list(type: "theme", includeDeleted?: boolean): TaskContextRecord[];
  getPreference(key: "aiVisibilityDefault"): unknown;
}

/** Uses the composition root's existing WorkspaceDatabase; it never opens a database. */
export class WorkspaceTaskContextReadAdapter implements TaskContextReadPort {
  constructor(private readonly persistence: TaskContextWorkspacePersistence) {}

  loadTaskContextWorkspace(includeArchived: boolean) {
    return this.persistence.readWorkspaceSnapshot(includeArchived);
  }

  loadTaskContextVisibilityThemes() {
    return this.persistence.list("theme", true);
  }

  workspaceAiVisibilityDefault() {
    return normalizeAiVisibility(this.persistence.getPreference("aiVisibilityDefault"))
      || [...DEFAULT_AI_VISIBILITY];
  }
}
