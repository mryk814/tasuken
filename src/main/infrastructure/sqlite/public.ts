import {
  ActivityEntriesQueryService,
  AgentWorkspaceQueryService,
  ContentDetailQueryService,
  ItemQueryService,
  ListAgentReadyTasksService,
  TaskContextQueryService,
} from "../../core/public.ts";
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
import {
  WorkspaceContentDetailReadAdapter,
  type ContentDetailWorkspacePersistence,
} from "./workspaceContentDetailReadAdapter.ts";
import {
  WorkspaceActivityEntriesReadAdapter,
  type ActivityEntriesWorkspacePersistence,
} from "./workspaceActivityEntriesReadAdapter.ts";

export { WorkspaceAgentReadyTaskReadAdapter, type AgentReadyTaskWorkspacePersistence };
export { WorkspaceAgentWorkspaceReadAdapter, type AgentWorkspacePersistence };
export { WorkspaceTaskContextReadAdapter, type TaskContextWorkspacePersistence };
export { WorkspaceItemQueryReadAdapter, type ItemQueryWorkspacePersistence };
export { WorkspaceContentDetailReadAdapter, type ContentDetailWorkspacePersistence };
export { WorkspaceActivityEntriesReadAdapter, type ActivityEntriesWorkspacePersistence };

export type TaskenCorePersistence = AgentReadyTaskWorkspacePersistence
  & AgentWorkspacePersistence
  & TaskContextWorkspacePersistence
  & ItemQueryWorkspacePersistence
  & ContentDetailWorkspacePersistence
  & ActivityEntriesWorkspacePersistence;

export function createTaskenCore(persistence: TaskenCorePersistence) {
  const agentWorkspace = new AgentWorkspaceQueryService(new WorkspaceAgentWorkspaceReadAdapter(persistence));
  const itemQueries = new ItemQueryService(new WorkspaceItemQueryReadAdapter(persistence));
  const contentDetails = new ContentDetailQueryService(new WorkspaceContentDetailReadAdapter(persistence));
  return {
    listAgentReadyTasks: new ListAgentReadyTasksService(new WorkspaceAgentReadyTaskReadAdapter(persistence)),
    resolveRepositoryContext: { execute: agentWorkspace.resolveRepositoryContext.bind(agentWorkspace) },
    findTasksForRepository: { execute: agentWorkspace.findTasksForRepository.bind(agentWorkspace) },
    getTaskAssignment: { execute: agentWorkspace.getTaskAssignment.bind(agentWorkspace) },
    getTaskContext: new TaskContextQueryService(new WorkspaceTaskContextReadAdapter(persistence)),
    searchItems: { execute: itemQueries.searchItems.bind(itemQueries) },
    listOpenItems: { execute: itemQueries.listOpenItems.bind(itemQueries) },
    getNote: { execute: contentDetails.getNote.bind(contentDetails) },
    getConversation: { execute: contentDetails.getConversation.bind(contentDetails) },
    getArtifactMetadata: { execute: contentDetails.getArtifactMetadata.bind(contentDetails) },
    getActivityEntries: new ActivityEntriesQueryService(new WorkspaceActivityEntriesReadAdapter(persistence)),
  };
}
