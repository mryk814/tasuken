import type {
  ActivityEntriesReadPort,
  ActivityEntriesRecord,
  ActivityEntriesSnapshot,
  ActivityEntriesWorkspace,
} from "../../core/public.ts";

export interface ActivityEntriesWorkspacePersistence {
  readWorkspaceSnapshot(includeDeleted?: boolean): ActivityEntriesWorkspace;
  list(type: "theme", includeDeleted?: boolean): ActivityEntriesRecord[];
}

/** Uses the injected WorkspaceDatabase and its side-effect-free snapshot API. */
export class WorkspaceActivityEntriesReadAdapter implements ActivityEntriesReadPort {
  constructor(private readonly persistence: ActivityEntriesWorkspacePersistence) {}

  readActivityEntriesSnapshot(includeArchived: boolean): ActivityEntriesSnapshot {
    return {
      workspace: this.persistence.readWorkspaceSnapshot(includeArchived),
    };
  }
}
