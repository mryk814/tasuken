import {
  ActivityEntriesQueryService,
  AgentContextQueryService,
  AgentContextExportService,
  AgentWorkspaceQueryService,
  ContentDetailQueryService,
  ItemQueryService,
  ListAgentReadyTasksService,
  KnowledgeQueryService,
  ProposeTaskWorkService,
  ProposeAgentSessionService,
  ProposeRepositoryTaskService,
  ProposeContentService,
  TaskContextQueryService,
  ThemeContextQueryService,
} from "../../core/public.ts";
import { WorkspaceAiProposalWriteAdapter } from "./workspaceAiProposalWriteAdapter.ts";
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
import {
  WorkspaceThemeContextReadAdapter,
  type ThemeContextWorkspacePersistence,
} from "./workspaceThemeContextReadAdapter.ts";
import {
  WorkspaceKnowledgeReadAdapter,
  type KnowledgeWorkspacePersistence,
} from "./workspaceKnowledgeReadAdapter.ts";
import { WorkspaceAgentContextReadAdapter, type AgentContextWorkspacePersistence } from "./workspaceAgentContextReadAdapter.ts";

export { WorkspaceAgentReadyTaskReadAdapter, type AgentReadyTaskWorkspacePersistence };
export { WorkspaceAgentWorkspaceReadAdapter, type AgentWorkspacePersistence };
export { WorkspaceTaskContextReadAdapter, type TaskContextWorkspacePersistence };
export { WorkspaceItemQueryReadAdapter, type ItemQueryWorkspacePersistence };
export { WorkspaceContentDetailReadAdapter, type ContentDetailWorkspacePersistence };
export { WorkspaceActivityEntriesReadAdapter, type ActivityEntriesWorkspacePersistence };
export { WorkspaceThemeContextReadAdapter, type ThemeContextWorkspacePersistence };
export { WorkspaceKnowledgeReadAdapter, type KnowledgeWorkspacePersistence };
export { WorkspaceAgentContextReadAdapter, type AgentContextWorkspacePersistence };
export { WorkspaceAiProposalWriteAdapter };

export interface AiProposalPersistence {
  runTransaction<T>(callback: (repository: {
    get(type: string, id: string, includeDeleted?: boolean): Record<string, unknown> | null;
    save(type: string, entity: Record<string, unknown>, options?: unknown): Record<string, unknown>;
  }) => T): T;
}

export type TaskenCorePersistence = AgentReadyTaskWorkspacePersistence
  & AgentWorkspacePersistence
  & TaskContextWorkspacePersistence
  & ItemQueryWorkspacePersistence
  & ContentDetailWorkspacePersistence
  & ActivityEntriesWorkspacePersistence
  & ThemeContextWorkspacePersistence
  & KnowledgeWorkspacePersistence
  & AgentContextWorkspacePersistence
  & AiProposalPersistence;

export function createTaskenCore(persistence: TaskenCorePersistence) {
  const agentWorkspace = new AgentWorkspaceQueryService(new WorkspaceAgentWorkspaceReadAdapter(persistence));
  const itemQueries = new ItemQueryService(new WorkspaceItemQueryReadAdapter(persistence));
  const contentDetails = new ContentDetailQueryService(new WorkspaceContentDetailReadAdapter(persistence));
  const knowledge = new KnowledgeQueryService(new WorkspaceKnowledgeReadAdapter(persistence));
  const agentContext = new AgentContextQueryService(new WorkspaceAgentContextReadAdapter(persistence));
  const agentContextPort = new WorkspaceAgentContextReadAdapter(persistence);
  const exportAiContext = new AgentContextExportService(agentContextPort, itemQueries, knowledge, agentContext);
  return {
    listAgentReadyTasks: new ListAgentReadyTasksService(new WorkspaceAgentReadyTaskReadAdapter(persistence)),
    resolveRepositoryContext: { execute: agentWorkspace.resolveRepositoryContext.bind(agentWorkspace) },
    findTasksForRepository: { execute: agentWorkspace.findTasksForRepository.bind(agentWorkspace) },
    findThemesForRepository: { execute: agentWorkspace.findThemesForRepository.bind(agentWorkspace) },
    getRepositoryContext: { execute: agentWorkspace.getRepositoryContext.bind(agentWorkspace) },
    getAgentSessionContext: { execute: agentWorkspace.getAgentSessionContext.bind(agentWorkspace) },
    getTaskAssignment: { execute: agentWorkspace.getTaskAssignment.bind(agentWorkspace) },
    getTaskContext: new TaskContextQueryService(new WorkspaceTaskContextReadAdapter(persistence)),
    searchItems: { execute: itemQueries.searchItems.bind(itemQueries) },
    listOpenItems: { execute: itemQueries.listOpenItems.bind(itemQueries) },
    getNote: { execute: contentDetails.getNote.bind(contentDetails) },
    getConversation: { execute: contentDetails.getConversation.bind(contentDetails) },
    getArtifactMetadata: { execute: contentDetails.getArtifactMetadata.bind(contentDetails) },
    getActivityEntries: new ActivityEntriesQueryService(new WorkspaceActivityEntriesReadAdapter(persistence)),
    getThemeContext: new ThemeContextQueryService(new WorkspaceThemeContextReadAdapter(persistence)),
    getRecentNotes: { execute: knowledge.getRecentNotes.bind(knowledge) },
    searchKnowledge: { execute: knowledge.searchKnowledge.bind(knowledge) },
    getKnowledgeContext: { execute: knowledge.getKnowledgeContext.bind(knowledge) },
    getPlanHealth: { execute: knowledge.getPlanHealth.bind(knowledge) },
    getKnowledgeHealth: { execute: knowledge.getKnowledgeHealth.bind(knowledge) },
    getActivity: { execute: agentContext.getActivity.bind(agentContext) },
    getContextSubgraph: { execute: agentContext.getContextSubgraph.bind(agentContext) },
    exportAiContext,
    proposeTaskWork: new ProposeTaskWorkService(new WorkspaceAiProposalWriteAdapter(persistence)),
    proposeAgentSession: new ProposeAgentSessionService(new WorkspaceAiProposalWriteAdapter(persistence)),
    proposeRepositoryTask: new ProposeRepositoryTaskService(new WorkspaceAiProposalWriteAdapter(persistence)),
    proposeContent: new ProposeContentService(new WorkspaceAiProposalWriteAdapter(persistence)),
  };
}
