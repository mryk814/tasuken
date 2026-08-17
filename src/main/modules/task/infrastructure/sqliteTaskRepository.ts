import type { Entity, EntityType, SaveOperation } from "../../../../shared/types/workspace.ts";
import type { TaskRepository, WorkspaceTaskPersistence } from "../ports/taskRepository.ts";

/**
 * Task's SQLite adapter over the current WorkspaceRepository transaction.
 * Connection, migration, and transaction ownership remain in the Main coordinator.
 */
export class SqliteTaskRepository implements TaskRepository {
  private readonly persistence: WorkspaceTaskPersistence;

  constructor(persistence: WorkspaceTaskPersistence) {
    this.persistence = persistence;
  }

  list(type: EntityType, includeDeleted = false): Entity[] {
    return this.persistence.list(type, includeDeleted);
  }

  get(type: EntityType, id: string, includeDeleted = false): Entity | null {
    return this.persistence.get(type, id, includeDeleted);
  }

  save(type: EntityType, entity: Entity): Entity {
    return this.persistence.save(type, entity);
  }

  saveMany(operations: SaveOperation[]): Entity[] {
    return this.persistence.saveMany(operations);
  }

  removeTask(id: string): Entity | null {
    return this.persistence.remove("task", id);
  }
}
