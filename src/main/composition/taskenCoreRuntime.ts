import { TaskenCoreHost } from "../infrastructure/http/taskenCoreHost.ts";
import {
  createTaskenCore,
  type AgentReadyTaskWorkspacePersistence,
  type AgentWorkspacePersistence,
  type TaskContextWorkspacePersistence,
  type ItemQueryWorkspacePersistence,
  type ContentDetailWorkspacePersistence,
  type ActivityEntriesWorkspacePersistence,
} from "../infrastructure/sqlite/public.ts";

export class TaskenCoreRuntime {
  private readonly host: TaskenCoreHost;

  constructor(userDataPath: string, persistence: AgentReadyTaskWorkspacePersistence & AgentWorkspacePersistence & TaskContextWorkspacePersistence & ItemQueryWorkspacePersistence & ContentDetailWorkspacePersistence & ActivityEntriesWorkspacePersistence) {
    const core = createTaskenCore(persistence);
    this.host = new TaskenCoreHost({
      userDataPath,
      listAgentReadyTasks: core.listAgentReadyTasks,
      resolveRepositoryContext: core.resolveRepositoryContext,
      findTasksForRepository: core.findTasksForRepository,
      getTaskAssignment: core.getTaskAssignment,
      getTaskContext: core.getTaskContext,
      searchItems: core.searchItems,
      listOpenItems: core.listOpenItems,
      getNote: core.getNote,
      getConversation: core.getConversation,
      getArtifactMetadata: core.getArtifactMetadata,
      getActivityEntries: core.getActivityEntries,
    });
  }

  async start() {
    await this.host.start();
  }

  async stop() {
    await this.host.stop();
  }
}
