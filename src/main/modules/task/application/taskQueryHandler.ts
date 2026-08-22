import type { Entity } from "../../../../shared/types/workspace.ts";
import type { TaskRepository } from "../ports/taskRepository.ts";

export class TaskQueryHandler {
  private readonly repository: TaskRepository;

  constructor(repository: TaskRepository) {
    this.repository = repository;
  }

  getTask(id: string, includeDeleted = false): Entity | null {
    return this.repository.get("task", id, includeDeleted);
  }

  listTasks(includeDeleted = false): Entity[] {
    return this.repository.list("task", includeDeleted);
  }

  getTaskSchedule(taskId: string): Entity | null {
    const schedules = this.repository.list("schedule")
      .filter((schedule) => schedule.owner_type === "task" && schedule.owner_id === taskId);
    if (schedules.length > 1) {
      throw new Error(`Taskにactive Scheduleが複数あります: ${taskId}`);
    }
    return schedules[0] || null;
  }
}
