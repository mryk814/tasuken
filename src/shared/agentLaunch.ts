import { aiTaskStartRequestSchema } from "./contracts/task/public.ts";

export type TaskAgentClientId = "claude_code" | "codex";
export interface AgentLaunchRequest {
  taskId: string;
  expectedVersion: number;
  clientId: TaskAgentClientId;
  cwd: string;
}
export interface AgentLaunchClient {
  id: TaskAgentClientId;
  label: string;
  available: boolean;
  reason?: string;
}

export function validateAgentLaunchTask(
  task: Record<string, unknown> | null,
  version: number,
): string {
  if (!task || task.deleted_at) throw new Error("タスクが見つかりません。画面を更新してください。");
  if (!Number.isInteger(version) || version < 1 || task.version !== version) {
    throw new Error("タスクが更新されました。画面を更新して再試行してください。");
  }
  if (["done", "cancelled"].includes(String(task.state)))
    throw new Error("完了・中止したタスクは起動できません。");
  if (
    task.intended_executor !== "ai_agent" ||
    ![undefined, null, "ready_for_agent"].includes(task.work_state as string | null | undefined)
  ) {
    throw new Error("AI Readyのタスクだけを起動できます。進行中の作業はCLI側で続けてください。");
  }
  const attempt = aiTaskStartRequestSchema.shape.work_attempt_id.safeParse(task.work_attempt_id);
  if (!attempt.success)
    throw new Error("依頼の作業単位を確認できません。画面を更新して依頼を準備し直してください。");
  return attempt.data;
}
