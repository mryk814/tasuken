import {
  deriveAgentWorkState,
  type AgentWorkReadModel,
} from "../../../../../shared/contracts/task/public.ts";
import type { Schedule, Task } from "../domain-model/types";

export type BoardRow = { task: Task; schedule?: Schedule };

export const BOARD_STATES: Task["state"][] = [
  "todo",
  "doing",
  "review",
  "waiting",
  "done",
  "cancelled",
];

export function boardKeyboardState(task: Task, direction: -1 | 1): Task["state"] | undefined {
  const allowed = BOARD_STATES.filter(
    (state) =>
      state !== "done" ||
      task.state === "done" ||
      task.intended_executor !== "ai_agent" ||
      task.work_state === "accepted",
  );
  return allowed[allowed.indexOf(task.state) + direction];
}

export function boardDropBeforeId(
  rows: readonly BoardRow[],
  targetId: string,
  after: boolean,
): string | undefined {
  const index = rows.findIndex(({ task }) => task.id === targetId);
  return rows[index + (after ? 1 : 0)]?.task.id;
}

/** 手動順序のない既存Taskも、一覧のソート設定に左右されない安定順で扱う。 */
export function sortBoardRows(rows: readonly BoardRow[]): BoardRow[] {
  return [...rows].sort(({ task: left }, { task: right }) => {
    const rank = (task: Task) => task.board_order ?? Number.MAX_SAFE_INTEGER;
    return (
      rank(left) - rank(right) ||
      String(left.created_at || "").localeCompare(String(right.created_at || "")) ||
      left.id.localeCompare(right.id)
    );
  });
}

/** 全Taskから移動先を求める。絞り込みで隠れたTaskの相対順を失わない。 */
export function moveBoardTask(
  rows: readonly BoardRow[],
  taskId: string,
  state: Task["state"],
  beforeId?: string,
): Task[] {
  const task = rows.find((row) => row.task.id === taskId)?.task;
  if (!task) throw new Error("移動するタスクが見つかりません。");
  if (
    state === "done" &&
    task.state !== "done" &&
    task.intended_executor === "ai_agent" &&
    task.work_state !== "accepted"
  ) {
    throw new Error("AIの報告を採用してから完了にしてください。");
  }
  if (beforeId === taskId) return [];
  const column = sortBoardRows(rows.filter((row) => row.task.state === state)).map(
    (row) => row.task,
  );
  const destination = column.filter((item) => item.id !== taskId);
  const index = beforeId
    ? destination.findIndex((item) => item.id === beforeId)
    : destination.length;
  if (index < 0) throw new Error("移動先が変わりました。もう一度操作してください。");
  destination.splice(
    index,
    0,
    task.state === state ? task : { ...task, state, completed_at: null },
  );
  if (
    column.length === destination.length &&
    column.every((item, index) => item.id === destination[index].id)
  )
    return [];
  return destination.flatMap((item, board_order) =>
    item.board_order === board_order && item.id !== taskId ? [] : [{ ...item, board_order }],
  );
}

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
