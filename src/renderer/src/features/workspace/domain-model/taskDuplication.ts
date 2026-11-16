import type { Schedule, Task, TaskChecklistItem, TaskRepeatRule } from "./types";

export interface DuplicatedTaskBundle {
  task: Task;
  schedule?: Schedule;
}

/**
 * 複製・繰り返しの次の回は、AIへの委任を引き継がない（#755 束10a）。AIへの新しい委任の入口は外したので、
 * 写しで委任を作らない。元のTaskの委任の値は書き換えない（委任の欄を書かなくするのは束10b）。
 */
export const UNDELEGATED_COPY = {
  intended_executor: "self",
  executor_identity: null,
  work_state: "not_delegated",
  work_attempt_id: null,
  work_started_at: null,
  work_reported_at: null,
  work_review_note: null,
  handoff_expected_result: null,
  handoff_instruction: null,
  handoff_context_ref: null,
  handoff_requested_at: null,
} as const satisfies Partial<Task>;

function cloneRepeatRule(rule?: TaskRepeatRule | null): TaskRepeatRule | null {
  if (!rule) return null;
  return {
    ...rule,
    weekdays: rule.weekdays ? [...rule.weekdays] : undefined,
  };
}

function duplicateChecklist(items?: TaskChecklistItem[]): TaskChecklistItem[] | undefined {
  if (!items?.length) return undefined;
  return items.map((item, index) => ({
    id: crypto.randomUUID(),
    title: item.title,
    done: false,
    sort_order: Number.isFinite(Number(item.sort_order)) ? Number(item.sort_order) : index,
    completed_at: null,
  }));
}

function duplicateSchedule(schedule: Schedule | undefined, taskId: string): Schedule | undefined {
  if (!schedule) return undefined;
  return {
    ...schedule,
    id: crypto.randomUUID(),
    owner_type: "task",
    owner_id: taskId,
    legacy_item_id: null,
  };
}

export function duplicateTask(
  task: Task,
  schedule?: Schedule,
  now = new Date().toISOString(),
): DuplicatedTaskBundle {
  const taskId = crypto.randomUUID();
  return {
    task: {
      ...task,
      id: taskId,
      state: "todo",
      board_order: undefined,
      completed_at: null,
      // 完了時のひとことは元のTaskの記録なので複製へは引き継がない（#308）。
      completion_note: null,
      created_at: now,
      updated_at: undefined,
      repeat_rule: cloneRepeatRule(task.repeat_rule),
      repeat_series_id: null,
      repeat_parent_task_id: null,
      ...UNDELEGATED_COPY,
      checklist_items: duplicateChecklist(task.checklist_items),
      legacy_item_id: null,
    },
    schedule: duplicateSchedule(schedule, taskId),
  };
}
