import { TaskenCoreHost } from "../infrastructure/http/taskenCoreHost.ts";
import {
  createTaskenCore,
  type AgentReadyTaskWorkspacePersistence,
  type AgentWorkspacePersistence,
  type TaskContextWorkspacePersistence,
  type ItemQueryWorkspacePersistence,
  type ContentDetailWorkspacePersistence,
  type ActivityEntriesWorkspacePersistence,
  type ThemeContextWorkspacePersistence,
  type KnowledgeWorkspacePersistence,
  type AgentContextWorkspacePersistence,
  type TaskWorkProposalPersistence,
} from "../infrastructure/sqlite/public.ts";

export class TaskenCoreRuntime {
  private readonly host: TaskenCoreHost;

  constructor(userDataPath: string, persistence: AgentReadyTaskWorkspacePersistence & AgentWorkspacePersistence & TaskContextWorkspacePersistence & ItemQueryWorkspacePersistence & ContentDetailWorkspacePersistence & ActivityEntriesWorkspacePersistence & ThemeContextWorkspacePersistence & KnowledgeWorkspacePersistence & AgentContextWorkspacePersistence & TaskWorkProposalPersistence) {
    const core = createTaskenCore(persistence);
    this.host = new TaskenCoreHost({
      userDataPath,
      listAgentReadyTasks: core.listAgentReadyTasks,
      resolveRepositoryContext: core.resolveRepositoryContext,
      findTasksForRepository: core.findTasksForRepository,
      findThemesForRepository: core.findThemesForRepository,
      getRepositoryContext: core.getRepositoryContext,
      getTaskAssignment: core.getTaskAssignment,
      getTaskContext: core.getTaskContext,
      searchItems: core.searchItems,
      listOpenItems: core.listOpenItems,
      getNote: core.getNote,
      getConversation: core.getConversation,
      getArtifactMetadata: core.getArtifactMetadata,
      getActivityEntries: core.getActivityEntries,
      getThemeContext: core.getThemeContext,
      getRecentNotes: core.getRecentNotes,
      searchKnowledge: core.searchKnowledge,
      getKnowledgeContext: core.getKnowledgeContext,
      getPlanHealth: core.getPlanHealth,
      getKnowledgeHealth: core.getKnowledgeHealth,
      getActivity: core.getActivity,
      getContextSubgraph: core.getContextSubgraph,
      exportAiContext: core.exportAiContext,
      proposeTaskWork: core.proposeTaskWork,
    });
  }

  async start() {
    await this.host.start();
  }

  async stop() {
    await this.host.stop();
  }
}
