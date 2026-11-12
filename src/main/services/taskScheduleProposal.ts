import {
  taskScheduleProposalRequestSchema,
  taskScheduleSnapshot,
  type TaskScheduleProposal,
  type TaskScheduleProposalRequest,
} from "../../shared/taskScheduleProposal.ts";
import type { Entity } from "../../shared/types/workspace.ts";

interface ScheduleProposalRepository {
  get(type: "task" | "theme", id: string): Entity | null;
  list(type: "schedule"): Entity[];
}

/** The Task version is checked before transmission and after the awaited provider. */
export async function proposeTaskSchedule(
  repository: ScheduleProposalRepository,
  value: unknown,
  propose: (input: TaskScheduleProposalRequest) => Promise<TaskScheduleProposal>,
): Promise<TaskScheduleProposal> {
  const input = taskScheduleProposalRequestSchema.parse(value);
  function checkCurrent() {
    const task = repository.get("task", input.current.taskId);
    if (!task) throw new Error("Taskが見つかりません。画面を読み直してください。");
    const schedule = repository
      .list("schedule")
      .find((entry) => entry.owner_type === "task" && entry.owner_id === task.id);
    const current = taskScheduleSnapshot(task, schedule);
    if (JSON.stringify(current) !== JSON.stringify(input.current))
      throw new Error("Taskまたは日程が更新されています。現在の予定で提案を作り直してください。");
    return current;
  }
  const current = checkCurrent();
  const proposal = await propose({ ...input, current });
  checkCurrent();
  return proposal;
}
