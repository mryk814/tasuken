import type { AiAudience } from "../../../shared/aiMetadata.mjs";

export interface ThemeContextRecord extends Record<string, any> {
  id: string;
}

export interface ThemeContextWorkspace extends Record<string, any> {
  canonical_root_status?: Record<string, unknown>;
}

/** Supplies one immutable workspace snapshot from the composition root's database owner. */
export interface ThemeContextReadPort {
  loadThemeContextWorkspace(includeArchived: boolean): ThemeContextWorkspace;
  /** Archived Themes remain available solely for visibility inheritance. */
  loadThemeContextVisibilityThemes(): ThemeContextRecord[];
  workspaceAiVisibilityDefault(): AiAudience[];
}
