import {
  deriveAgentWorkState,
  type AgentWorkReadModel,
} from "../../../../../shared/contracts/task/public.ts";
import type { Task } from "../domain-model/types";

export const AGENT_TURN_LABELS: Record<AgentWorkReadModel["state"], string> = {
  not_delegated: "次: 自分",
  start_waiting: "次: AI · 開始は未確認",
  working: "次: AI · 作業中",
  answer_waiting: "次: 自分 · 回答",
  decision_waiting: "次: 自分 · 判断",
  answered_resume_waiting: "次: AI · 再開待ち",
  review_waiting: "次: 自分 · 成果確認",
  accepted_continuing: "次: 自分 · Taskは継続",
  accepted_completed: "Task完了",
  revision_requested: "次: AI · 修正依頼済み",
  past_attempt_report: "過去の作業報告",
  unknown_source: "報告を確認できません",
};

export function taskWorkModel(
  task: Task,
  proposals: readonly unknown[],
  receipts: readonly unknown[],
) {
  type Row = { id: string; [key: string]: unknown };
  return deriveAgentWorkState({
    task: task as unknown as Row,
    proposals: proposals as Row[],
    receipts: receipts as Row[],
  })!;
}

export function taskNextTurn(task: Task, model: AgentWorkReadModel): string {
  if (task.state === "done") return "Task完了";
  if (task.state === "cancelled") return "Task中止";
  if (model.state !== "not_delegated") return AGENT_TURN_LABELS[model.state];
  return task.intended_executor === "human"
    ? `次: ${task.executor_identity || "他の人"}`
    : "次: 自分";
}
