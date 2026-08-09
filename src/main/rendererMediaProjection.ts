import type { Entity, EntityType } from "../shared/types/workspace";
import type { CommandReceipt } from "../shared/applicationCommand";

const PRIVATE_MEDIA_PATH_FIELDS = [
  "stored_path", "target", "original_path", "file_path", "path",
  "linked_source_real_path", "linked_source_device", "linked_source_inode",
] as const;

function mediaArtifact(value: unknown): value is Entity {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && ["audio", "video"].includes(String((value as Entity).media_kind || "")));
}

function redactMediaArtifact(entity: Entity): Entity {
  const projected = { ...entity };
  for (const field of PRIVATE_MEDIA_PATH_FIELDS) delete projected[field];
  return projected;
}

function projectNestedMedia(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projectNestedMedia);
  if (!value || typeof value !== "object") return value;
  if (mediaArtifact(value)) {
    const redacted = redactMediaArtifact(value);
    return Object.fromEntries(Object.entries(redacted).map(([key, nested]) => [key, projectNestedMedia(nested)]));
  }
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, projectNestedMedia(nested)]));
}

function redactEventJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(projectNestedMedia(parsed));
  } catch {
    return value;
  }
}

export function projectEntityForRenderer(type: EntityType, entity: Entity): Entity {
  if (type === "artifact" && mediaArtifact(entity)) return redactMediaArtifact(entity);
  if (type === "change_event") {
    return {
      ...entity,
      before_json: redactEventJson(entity.before_json),
      after_json: redactEventJson(entity.after_json),
      receipt_json: redactEventJson(entity.receipt_json),
    };
  }
  return entity;
}

export function projectCommandReceiptForRenderer(receipt: CommandReceipt): CommandReceipt {
  const projectChanges = (changes: CommandReceipt["changes"]): CommandReceipt["changes"] => changes.map((change) => ({
    ...change,
    entity: projectEntityForRenderer(change.type, change.entity),
  }));
  return {
    ...receipt,
    changes: projectChanges(receipt.changes),
    ...(receipt.eventChanges ? { eventChanges: projectChanges(receipt.eventChanges) } : {}),
  };
}

export function projectSnapshotInspectForRenderer<T>(result: T): T {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const value = result as Record<string, unknown>;
  if (!Array.isArray(value.changes)) return result;
  const changes = value.changes.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const change = entry as Record<string, unknown>;
    const type = change.type as EntityType;
    const project = (candidate: unknown) => candidate && typeof candidate === "object" && !Array.isArray(candidate)
      ? projectEntityForRenderer(type, candidate as Entity)
      : candidate;
    return { ...change, incoming: project(change.incoming), local: project(change.local) };
  });
  return { ...value, changes } as T;
}

export function projectChangesForRenderer(changes: Array<{ type: EntityType; entity: Entity }>): Array<{ type: EntityType; entity: Entity }> {
  return changes.map((change) => ({ ...change, entity: projectEntityForRenderer(change.type, change.entity) }));
}

export function commandNotificationPayloads(
  entityChanges: Array<{ type: EntityType; entity: Entity }>,
  eventChanges: Array<{ type: EntityType; entity: Entity }>,
  senderReceivesAll = false,
): {
  sender: { entities: Array<{ type: EntityType; entity: Entity }> };
  other: { entities: Array<{ type: EntityType; entity: Entity }> };
  satellite: { entities: Array<{ type: EntityType; entity: Entity }> };
} {
  const safeEvents = projectChangesForRenderer(eventChanges);
  const safeAll = [...projectChangesForRenderer(entityChanges), ...safeEvents];
  return {
    sender: { entities: senderReceivesAll ? safeAll : safeEvents },
    other: { entities: safeAll },
    satellite: { entities: safeAll },
  };
}

export function projectWorkspaceForRenderer(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const workspace = value as Record<string, unknown>;
  const projected = { ...workspace };
  if (Array.isArray(workspace.artifacts)) {
    projected.artifacts = workspace.artifacts.map((entity) => projectEntityForRenderer("artifact", entity as Entity));
  }
  if (Array.isArray(workspace.change_events)) {
    projected.change_events = workspace.change_events.map((entity) => projectEntityForRenderer("change_event", entity as Entity));
  }
  return projected;
}
