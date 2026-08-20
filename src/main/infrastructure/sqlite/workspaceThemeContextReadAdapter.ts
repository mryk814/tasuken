import { DEFAULT_AI_VISIBILITY, normalizeAiVisibility } from "../../../shared/aiMetadata.mjs";
import type { ThemeContextReadPort, ThemeContextRecord, ThemeContextWorkspace } from "../../core/public.ts";

export interface ThemeContextWorkspacePersistence {
  readWorkspaceSnapshot(includeDeleted?: boolean): ThemeContextWorkspace;
  list(type: "theme", includeDeleted?: boolean): ThemeContextRecord[];
  readPreference(key: "aiVisibilityDefault"): unknown;
}

/** Uses the existing WorkspaceDatabase instance and never opens its own database. */
export class WorkspaceThemeContextReadAdapter implements ThemeContextReadPort {
  constructor(private readonly persistence: ThemeContextWorkspacePersistence) {}

  loadThemeContextWorkspace(includeArchived: boolean) {
    return this.persistence.readWorkspaceSnapshot(includeArchived);
  }

  loadThemeContextVisibilityThemes() {
    return this.persistence.list("theme", true);
  }

  workspaceAiVisibilityDefault() {
    return normalizeAiVisibility(this.persistence.readPreference("aiVisibilityDefault"))
      || [...DEFAULT_AI_VISIBILITY];
  }
}
