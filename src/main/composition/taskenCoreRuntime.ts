import { TaskenCoreHost } from "../infrastructure/http/taskenCoreHost.ts";
import {
  createTaskenCore,
  type AgentReadyTaskWorkspacePersistence,
} from "../infrastructure/sqlite/public.ts";

export class TaskenCoreRuntime {
  private readonly host: TaskenCoreHost;

  constructor(userDataPath: string, persistence: AgentReadyTaskWorkspacePersistence) {
    const core = createTaskenCore(persistence);
    this.host = new TaskenCoreHost({
      userDataPath,
      listAgentReadyTasks: core.listAgentReadyTasks,
    });
  }

  async start() {
    await this.host.start();
  }

  async stop() {
    await this.host.stop();
  }
}
