import type { AiAudience } from "../../../shared/aiMetadata.mjs";

export interface KnowledgeReadRecord extends Record<string, any> {
  id: string;
}

export type KnowledgeReadEntityType =
  | "theme"
  | "note"
  | "knowledge_node"
  | "knowledge_edge"
  | "link"
  | "resource"
  | "item"
  | "task"
  | "waiting"
  | "plan_node"
  | "schedule";

/** Narrow, read-only source for notes, Knowledge, and plan/data health queries. */
export interface KnowledgeReadPort {
  list(type: KnowledgeReadEntityType, includeArchived: boolean): KnowledgeReadRecord[];
  workspaceAiVisibilityDefault(): AiAudience[];
}
