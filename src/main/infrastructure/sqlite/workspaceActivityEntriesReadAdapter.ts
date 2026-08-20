import { DEFAULT_AI_VISIBILITY, normalizeAiVisibility } from "../../../shared/aiMetadata.mjs";
import type {
  ActivityEntriesReadPort,
  ActivityEntriesRecord,
  ActivityEntriesSnapshot,
  ActivityEntriesWorkspace,
} from "../../core/ports/activityEntriesReadPort.ts";

export interface ActivityEntriesWorkspacePersistence {
  readWorkspaceSnapshot(includeDeleted?: boolean): ActivityEntriesWorkspace;
  list(type: "theme", includeDeleted?: boolean): ActivityEntriesRecord[];
  getPreference(key: "aiVisibilityDefault"): unknown;
}

/** Uses the injected WorkspaceDatabase and its side-effect-free snapshot API. */
export class WorkspaceActivityEntriesReadAdapter implements ActivityEntriesReadPort {
  constructor(private readonly persistence: ActivityEntriesWorkspacePersistence) {}

  readActivityEntriesSnapshot(includeArchived: boolean): ActivityEntriesSnapshot {
    return {
      workspace: this.persistence.readWorkspaceSnapshot(includeArchived),
      // Archived Theme policy still governs an active Task that references it.
      visibilityThemes: this.persistence.list("theme", true),
      workspaceAiVisibilityDefault: normalizeAiVisibility(this.persistence.getPreference("aiVisibilityDefault"))
        || [...DEFAULT_AI_VISIBILITY],
    };
  }
}
