export interface TaskAgentState {
  lifecycle: "active" | "archived" | "done" | "cancelled";
  ai_ready: boolean;
  runnable: boolean;
  not_runnable_reasons: string[];
}

export function taskAgentState(task: Record<string, unknown> | null | undefined): TaskAgentState;
