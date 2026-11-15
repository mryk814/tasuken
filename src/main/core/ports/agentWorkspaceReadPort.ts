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
  listAiProposals(includeArchived: boolean): AgentWorkspaceRecord[];
  listWorkingCopies(includeArchived: boolean): AgentWorkspaceRecord[];
  listAgentSessions(includeArchived: boolean): AgentWorkspaceRecord[];
  /** AI の作業（新しい記録）。 */
  listAgentWorkRecords(includeDeleted: boolean): AgentWorkspaceRecord[];
  listReferences(includeArchived: boolean): AgentWorkspaceRecord[];
}
