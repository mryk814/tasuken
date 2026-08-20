import { TaskenCoreHost } from "../infrastructure/http/taskenCoreHost.ts";
import {
  createTaskenCore,
  type AgentReadyTaskWorkspacePersistence,
  type AgentWorkspacePersistence,
} from "../infrastructure/sqlite/public.ts";

export class TaskenCoreRuntime {
  private readonly host: TaskenCoreHost;

  constructor(userDataPath: string, persistence: AgentReadyTaskWorkspacePersistence & AgentWorkspacePersistence) {
    const core = createTaskenCore(persistence);
    this.host = new TaskenCoreHost({
      userDataPath,
      listAgentReadyTasks: core.listAgentReadyTasks,
      resolveRepositoryContext: core.resolveRepositoryContext,
      findTasksForRepository: core.findTasksForRepository,
      getTaskAssignment: core.getTaskAssignment,
    });
  }

  async start() {
    await this.host.start();
  }

  async stop() {
    await this.host.stop();
  }
}
