import { DEFAULT_AI_VISIBILITY, normalizeAiVisibility } from "../../../shared/aiMetadata.mjs";
import type { TaskContextReadPort, TaskContextWorkspace } from "../../core/public.ts";

export interface TaskContextWorkspacePersistence {
  loadWorkspace(includeDeleted?: boolean): TaskContextWorkspace;
  getPreference(key: "aiVisibilityDefault"): unknown;
}

/** Uses the composition root's existing WorkspaceDatabase; it never opens a database. */
export class WorkspaceTaskContextReadAdapter implements TaskContextReadPort {
  constructor(private readonly persistence: TaskContextWorkspacePersistence) {}

  loadTaskContextWorkspace(includeArchived: boolean) {
    return this.persistence.loadWorkspace(includeArchived);
  }

  workspaceAiVisibilityDefault() {
    return normalizeAiVisibility(this.persistence.getPreference("aiVisibilityDefault"))
      || [...DEFAULT_AI_VISIBILITY];
  }
}
