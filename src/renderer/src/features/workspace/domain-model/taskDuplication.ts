import type { Schedule, Task, TaskChecklistItem, TaskRepeatRule } from "./types";

export interface DuplicatedTaskBundle {
  task: Task;
  schedule?: Schedule;
}

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

export function duplicateTask(task: Task, schedule?: Schedule, now = new Date().toISOString()): DuplicatedTaskBundle {
  const taskId = crypto.randomUUID();
  return {
    task: {
      ...task,
      id: taskId,
      state: "todo",
      completed_at: null,
      created_at: now,
      updated_at: undefined,
      repeat_rule: cloneRepeatRule(task.repeat_rule),
      repeat_series_id: null,
      repeat_parent_task_id: null,
      checklist_items: duplicateChecklist(task.checklist_items),
      legacy_item_id: null,
    },
    schedule: duplicateSchedule(schedule, taskId),
  };
}
