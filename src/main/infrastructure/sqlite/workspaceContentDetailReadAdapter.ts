import type { ContentDetailReadPort, ContentDetailRecord } from "../../core/public.ts";

export interface ContentDetailWorkspacePersistence {
  list(
    type: "theme" | "note" | "resource" | "artifact" | "capture_entry" | "task",
    includeDeleted?: boolean,
  ): ContentDetailRecord[];
}

/** Query-specific adapter over the composition root's existing WorkspaceDatabase. */
export class WorkspaceContentDetailReadAdapter implements ContentDetailReadPort {
  constructor(private readonly persistence: ContentDetailWorkspacePersistence) {}

  list(
    type: "theme" | "note" | "resource" | "artifact" | "capture_entry" | "task",
    includeArchived: boolean,
  ) {
    return this.persistence.list(type, includeArchived);
  }
}
