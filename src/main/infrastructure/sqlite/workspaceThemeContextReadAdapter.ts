import type { ThemeContextReadPort, ThemeContextWorkspace } from "../../core/public.ts";

export interface ThemeContextWorkspacePersistence {
  readWorkspaceSnapshot(includeDeleted?: boolean): ThemeContextWorkspace;
}

/** Uses the existing WorkspaceDatabase instance and never opens its own database. */
export class WorkspaceThemeContextReadAdapter implements ThemeContextReadPort {
  constructor(private readonly persistence: ThemeContextWorkspacePersistence) {}

  loadThemeContextWorkspace(includeArchived: boolean) {
    return this.persistence.readWorkspaceSnapshot(includeArchived);
  }
}
