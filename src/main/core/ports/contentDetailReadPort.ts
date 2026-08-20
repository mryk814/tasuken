import type { AiAudience } from "../../../shared/aiMetadata.mjs";

export interface ContentDetailRecord extends Record<string, any> {
  id: string;
}

/** Narrow read-only source used by the MCP content-detail queries. */
export interface ContentDetailReadPort {
  list(type: "theme" | "note" | "resource" | "artifact", includeArchived: boolean): ContentDetailRecord[];
  workspaceAiVisibilityDefault(): AiAudience[];
}
