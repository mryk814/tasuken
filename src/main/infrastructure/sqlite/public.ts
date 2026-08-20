import { AgentWorkspaceQueryService, ItemQueryService, ListAgentReadyTasksService, TaskContextQueryService } from "../../core/public.ts";
import {
  WorkspaceAgentReadyTaskReadAdapter,
  type AgentReadyTaskWorkspacePersistence,
} from "./workspaceAgentReadyTaskReadAdapter.ts";
import {
  WorkspaceAgentWorkspaceReadAdapter,
  type AgentWorkspacePersistence,
} from "./workspaceAgentWorkspaceReadAdapter.ts";
import {
  WorkspaceTaskContextReadAdapter,
  type TaskContextWorkspacePersistence,
} from "./workspaceTaskContextReadAdapter.ts";
import {
  WorkspaceItemQueryReadAdapter,
  type ItemQueryWorkspacePersistence,
} from "./workspaceItemQueryReadAdapter.ts";

export { WorkspaceAgentReadyTaskReadAdapter, type AgentReadyTaskWorkspacePersistence };
export { WorkspaceAgentWorkspaceReadAdapter, type AgentWorkspacePersistence };
export { WorkspaceTaskContextReadAdapter, type TaskContextWorkspacePersistence };
export { WorkspaceItemQueryReadAdapter, type ItemQueryWorkspacePersistence };

export function createTaskenCore(persistence: AgentReadyTaskWorkspacePersistence & AgentWorkspacePersistence & TaskContextWorkspacePersistence & ItemQueryWorkspacePersistence) {
  const agentWorkspace = new AgentWorkspaceQueryService(new WorkspaceAgentWorkspaceReadAdapter(persistence));
  const itemQueries = new ItemQueryService(new WorkspaceItemQueryReadAdapter(persistence));
  return {
    listAgentReadyTasks: new ListAgentReadyTasksService(new WorkspaceAgentReadyTaskReadAdapter(persistence)),
    resolveRepositoryContext: { execute: agentWorkspace.resolveRepositoryContext.bind(agentWorkspace) },
    findTasksForRepository: { execute: agentWorkspace.findTasksForRepository.bind(agentWorkspace) },
    getTaskAssignment: { execute: agentWorkspace.getTaskAssignment.bind(agentWorkspace) },
    getTaskContext: new TaskContextQueryService(new WorkspaceTaskContextReadAdapter(persistence)),
    searchItems: { execute: itemQueries.searchItems.bind(itemQueries) },
    listOpenItems: { execute: itemQueries.listOpenItems.bind(itemQueries) },
  };
}
