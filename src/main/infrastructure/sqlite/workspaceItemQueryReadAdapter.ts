import { DEFAULT_AI_VISIBILITY, normalizeAiVisibility } from "../../../shared/aiMetadata.mjs";
import type {
  ItemQueryReadPort,
  ItemQueryRecord,
  ItemQuerySnapshot,
  ItemQueryThemeRecord,
} from "../../core/public.ts";

export interface ItemQueryWorkspacePersistence {
  list(type: "item" | "task" | "waiting" | "plan_node" | "schedule", includeDeleted?: boolean): ItemQueryRecord[];
  list(type: "theme", includeDeleted?: boolean): ItemQueryThemeRecord[];
  getPreference(key: "aiVisibilityDefault"): unknown;
}

/** Builds a query-scoped snapshot from the existing database; every operation is read-only. */
export class WorkspaceItemQueryReadAdapter implements ItemQueryReadPort {
  constructor(private readonly persistence: ItemQueryWorkspacePersistence) {}

  readItemQuerySnapshot(includeArchived: boolean): ItemQuerySnapshot {
    return {
      items: this.persistence.list("item", includeArchived),
      tasks: this.persistence.list("task", includeArchived),
      waitings: this.persistence.list("waiting", includeArchived),
      planNodes: this.persistence.list("plan_node", includeArchived),
      schedules: this.persistence.list("schedule", includeArchived),
      themes: this.persistence.list("theme", true),
      workspaceAiVisibilityDefault: normalizeAiVisibility(this.persistence.getPreference("aiVisibilityDefault"))
        || [...DEFAULT_AI_VISIBILITY],
    };
  }
}
