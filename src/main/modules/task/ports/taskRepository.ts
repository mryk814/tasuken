import type { Entity, EntityType, SaveOperation } from "../../../../shared/types/workspace.ts";

/** Cross-feature lookup exists only for Theme and Reference validation. */
export interface TaskEntityAccess {
  list(type: EntityType, includeDeleted?: boolean): Entity[];
  get(type: EntityType, id: string, includeDeleted?: boolean): Entity | null;
  save(type: EntityType, entity: Entity): Entity;
  saveMany(operations: SaveOperation[]): Entity[];
}

/** Task aggregate write port. */
export interface TaskRepository extends TaskEntityAccess {
  removeTask(id: string): Entity | null;
}

export interface WorkspaceTaskPersistence {
  list(type: EntityType, includeDeleted?: boolean): Entity[];
  get(type: EntityType, id: string, includeDeleted?: boolean): Entity | null;
  save(type: EntityType, entity: Entity): Entity;
  saveMany(operations: SaveOperation[]): Entity[];
  remove(type: EntityType, id: string): Entity | null;
}
