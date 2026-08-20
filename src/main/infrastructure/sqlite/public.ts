import { ListAgentReadyTasksService } from "../../core/public.ts";
import {
  WorkspaceAgentReadyTaskReadAdapter,
  type AgentReadyTaskWorkspacePersistence,
} from "./workspaceAgentReadyTaskReadAdapter.ts";

export { WorkspaceAgentReadyTaskReadAdapter, type AgentReadyTaskWorkspacePersistence };

export function createTaskenCore(persistence: AgentReadyTaskWorkspacePersistence) {
  return {
    listAgentReadyTasks: new ListAgentReadyTasksService(new WorkspaceAgentReadyTaskReadAdapter(persistence)),
  };
}
