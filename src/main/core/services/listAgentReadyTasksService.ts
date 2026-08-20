import {
  listAgentReadyTasksRequestSchema,
  listAgentReadyTasksResponseSchema,
  type ListAgentReadyTasksRequest,
  type ListAgentReadyTasksResponse,
} from "../../../shared/contracts/task/public.ts";
import type { AgentReadyTaskReadPort } from "../ports/agentReadyTaskReadPort.ts";
import { AgentReadyTaskAiProjectionPolicy } from "../policies/agentReadyTaskAiProjectionPolicy.ts";

const DEFAULT_LIMIT = 20;

export class ListAgentReadyTasksService {
  private readonly readPort: AgentReadyTaskReadPort;
  private readonly projectionPolicy: AgentReadyTaskAiProjectionPolicy;

  constructor(
    readPort: AgentReadyTaskReadPort,
    projectionPolicy = new AgentReadyTaskAiProjectionPolicy(),
  ) {
    this.readPort = readPort;
    this.projectionPolicy = projectionPolicy;
  }

  execute(input: ListAgentReadyTasksRequest = {}): ListAgentReadyTasksResponse {
    const request = listAgentReadyTasksRequestSchema.parse(input);
    const limit = request.limit ?? DEFAULT_LIMIT;
    const candidates = this.readPort.listTasks(Boolean(request.include_archived))
      .filter((task) => task.intended_executor === "ai_agent")
      .filter((task) => (task.work_state || "ready_for_agent") === "ready_for_agent")
      .filter((task) => task.state !== "done" && task.state !== "cancelled")
      .filter((task) => !request.theme_id || task.project_id === request.theme_id)
      .sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")));
    const projected = this.projectionPolicy.project(
      candidates,
      this.readPort.listThemes(),
      this.readPort.workspaceAiVisibilityDefault(),
    );

    return listAgentReadyTasksResponseSchema.parse({
      tasks: projected.records.slice(0, limit),
      limit,
      ai_audience: "coding_agent",
      read_only: true,
      excluded_count: projected.excluded_count,
      excluded_reasons: projected.excluded_reasons,
    });
  }
}
