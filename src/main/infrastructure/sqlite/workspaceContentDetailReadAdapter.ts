import { DEFAULT_AI_VISIBILITY, normalizeAiVisibility } from "../../../shared/aiMetadata.mjs";
import type { ContentDetailReadPort, ContentDetailRecord } from "../../core/public.ts";

export interface ContentDetailWorkspacePersistence {
  list(type: "theme" | "note" | "resource" | "artifact", includeDeleted?: boolean): ContentDetailRecord[];
  readPreference(key: "aiVisibilityDefault"): unknown;
}

/** Query-specific adapter over the composition root's existing WorkspaceDatabase. */
export class WorkspaceContentDetailReadAdapter implements ContentDetailReadPort {
  constructor(private readonly persistence: ContentDetailWorkspacePersistence) {}

  list(type: "theme" | "note" | "resource" | "artifact", includeArchived: boolean) {
    return this.persistence.list(type, includeArchived);
  }

  workspaceAiVisibilityDefault() {
    return normalizeAiVisibility(this.persistence.readPreference("aiVisibilityDefault"))
      || [...DEFAULT_AI_VISIBILITY];
  }
}
