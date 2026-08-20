import { AgentWorkspaceQueryService, ListAgentReadyTasksService } from "../../core/public.ts";
import {
  WorkspaceAgentReadyTaskReadAdapter,
  type AgentReadyTaskWorkspacePersistence,
} from "./workspaceAgentReadyTaskReadAdapter.ts";
import {
  WorkspaceAgentWorkspaceReadAdapter,
  type AgentWorkspacePersistence,
} from "./workspaceAgentWorkspaceReadAdapter.ts";

export { WorkspaceAgentReadyTaskReadAdapter, type AgentReadyTaskWorkspacePersistence };
export { WorkspaceAgentWorkspaceReadAdapter, type AgentWorkspacePersistence };

export function createTaskenCore(persistence: AgentReadyTaskWorkspacePersistence & AgentWorkspacePersistence) {
  const agentWorkspace = new AgentWorkspaceQueryService(new WorkspaceAgentWorkspaceReadAdapter(persistence));
  return {
    listAgentReadyTasks: new ListAgentReadyTasksService(new WorkspaceAgentReadyTaskReadAdapter(persistence)),
    resolveRepositoryContext: { execute: agentWorkspace.resolveRepositoryContext.bind(agentWorkspace) },
    findTasksForRepository: { execute: agentWorkspace.findTasksForRepository.bind(agentWorkspace) },
    getTaskAssignment: { execute: agentWorkspace.getTaskAssignment.bind(agentWorkspace) },
  };
}
