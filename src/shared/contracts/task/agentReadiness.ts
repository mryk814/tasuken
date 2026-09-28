/**
 * AIがTaskへ新しく着手してよいかを、Taskの状態から導出する。
 *
 * `work_state`はAIへの委任の段階だけを表し、削除・完了・中止を含まない。
 * そのため`ready_for_agent`だけを見ると、削除済みのTaskも「着手できる」に見える。
 * AIへ返すときは、この導出結果を`agent_state`として添える。
 */
export interface TaskAgentState {
  lifecycle: "active" | "archived" | "done" | "cancelled";
  ai_ready: boolean;
  runnable: boolean;
  not_runnable_reasons: string[];
}

export function taskAgentState(task: Record<string, unknown> | null | undefined): TaskAgentState {
  const lifecycle = task?.deleted_at
    ? "archived"
    : task?.state === "done"
      ? "done"
      : task?.state === "cancelled"
        ? "cancelled"
        : "active";
  const delegated = task?.intended_executor === "ai_agent";
  const workState = String(task?.work_state || (delegated ? "ready_for_agent" : "not_delegated"));
  const aiReady = delegated && workState === "ready_for_agent";
  const reasons: string[] = [];
  if (!delegated) reasons.push("not_delegated_to_ai");
  else if (!aiReady) reasons.push(`work_state_${workState}`);
  if (lifecycle !== "active") reasons.push(`task_${lifecycle}`);
  return {
    lifecycle,
    ai_ready: aiReady,
    runnable: aiReady && lifecycle === "active",
    not_runnable_reasons: reasons,
  };
}
