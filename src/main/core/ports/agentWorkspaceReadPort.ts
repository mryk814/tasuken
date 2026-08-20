import type { AiAudience } from "../../../shared/aiMetadata.mjs";
import type {
  AgentReadyTaskSourceRecord,
  AgentReadyTaskThemeRecord,
} from "./agentReadyTaskReadPort.ts";

export interface AgentWorkspaceRecord extends Record<string, unknown> {
  id: string;
  deleted_at?: unknown;
}

export interface AgentWorkspaceReadPort {
  listTasks(includeArchived: boolean): AgentReadyTaskSourceRecord[];
  listThemes(includeArchived: boolean): AgentReadyTaskThemeRecord[];
  listRepositoryContexts(includeArchived: boolean): AgentWorkspaceRecord[];
  listWorkReceipts(includeArchived: boolean): AgentWorkspaceRecord[];
  workspaceAiVisibilityDefault(): AiAudience[];
}
