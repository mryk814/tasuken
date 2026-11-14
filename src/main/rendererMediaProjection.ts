import type { Entity, EntityType } from "../shared/types/workspace";
import type { CommandReceipt } from "../shared/applicationCommand";

const PRIVATE_MEDIA_PATH_FIELDS = [
  "stored_path",
  "target",
  "original_path",
  "file_path",
  "path",
  "linked_source_real_path",
  "linked_source_device",
  "linked_source_inode",
] as const;

function mediaArtifact(value: unknown): value is Entity {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    ["audio", "video"].includes(String((value as Entity).media_kind || "")),
  );
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
    return Object.fromEntries(
      Object.entries(redacted).map(([key, nested]) => [key, projectNestedMedia(nested)]),
    );
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, projectNestedMedia(nested)]),
  );
}

function redactEventJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  // 伏字にするのは media_kind を持つobjectの中だけ。キーの文字がそのまま現れず、\u による
  // 書き換えもない文字列にはmediaのobjectがないので、解析せずに返す（中身は同じ）。
  // workspace:loadのたびに全Eventの前後の写しを解析し直すと、実データで約0.35秒かかっていた。
  if (!value.includes("media_kind") && !value.includes("\\u")) return value;
  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(projectNestedMedia(parsed));
  } catch {
    return value;
  }
}

/**
 * Application Commandの冪等性のためにMainだけが読むActivity Eventの項目。Rendererは使わない。
 * 実データでは変更履歴112MBのうち約62MBをこの2つが占め、workspace:loadのIPCを倍にしていた。
 */
const MAIN_ONLY_EVENT_FIELDS = ["receipt_json", "command_fingerprint"] as const;

export function projectEntityForRenderer(type: EntityType, entity: Entity): Entity {
  if (type === "artifact" && mediaArtifact(entity)) return redactMediaArtifact(entity);
  if (type === "change_event") {
    const projected: Entity = {
      ...entity,
      before_json: redactEventJson(entity.before_json),
      after_json: redactEventJson(entity.after_json),
    };
    for (const field of MAIN_ONLY_EVENT_FIELDS) delete projected[field];
    return projected;
  }
  return entity;
}

/**
 * Rendererから届いたActivity Eventの保存で、Rendererへ渡していない項目を既存の値から戻す。
 * Rendererは既存のEventを保存し直さないが、もし送ってきても冪等性の記録を消さない。
 */
export function restoreMainOnlyEventFields(
  type: EntityType,
  entity: Entity,
  existing: Entity | null | undefined,
): Entity {
  if (type !== "change_event" || !existing) return entity;
  const restored: Entity = { ...entity };
  for (const field of MAIN_ONLY_EVENT_FIELDS) {
    if (restored[field] === undefined && existing[field] !== undefined) {
      restored[field] = existing[field];
    }
  }
  return restored;
}

export function projectCommandReceiptForRenderer(receipt: CommandReceipt): CommandReceipt {
  const projectChanges = (changes: CommandReceipt["changes"]): CommandReceipt["changes"] =>
    changes.map((change) => ({
      ...change,
      entity: projectEntityForRenderer(change.type, change.entity),
    }));
  return {
    ...receipt,
    changes: projectChanges(receipt.changes),
    ...(receipt.eventChanges ? { eventChanges: projectChanges(receipt.eventChanges) } : {}),
  };
}

export function projectChangesForRenderer(
  changes: Array<{ type: EntityType; entity: Entity }>,
): Array<{ type: EntityType; entity: Entity }> {
  return changes.map((change) => ({
    ...change,
    entity: projectEntityForRenderer(change.type, change.entity),
  }));
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

/**
 * 画面へ渡すWorkspace（読み込み・旧データの取り込み・Snapshotの適用の応答）。来歴（change_event）は
 * 載せない。画面は activity:events で範囲を絞って読む（#755 束0b。#734 で読み込みの約9割が来歴だった）。
 */
export function projectWorkspaceForRenderer(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const workspace = value as Record<string, unknown>;
  const { change_events: _changeEvents, ...projected } = workspace;
  if (Array.isArray(workspace.artifacts)) {
    projected.artifacts = workspace.artifacts.map((entity) =>
      projectEntityForRenderer("artifact", entity as Entity),
    );
  }
  return projected;
}
