import { assertEntityType, validateEntity } from "./domain.mjs";

/** 差分の検査で拒否された失敗の code。文言ではなくこの code で「拒否」と「通信の失敗」を区別する。 */
export const SYNC_PACKET_REJECTED = "SYNC_PACKET_REJECTED";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * 同期差分（tasken-sync-change）を取り込む前に、形と中身を確かめる。
 *
 * 端末どうしの契約は共有フォルダの差分で、各端末のSQLite schemaは端末の中だけのもの。
 * この版が別の端末の差分を読めるかどうかはここで決まる。Repositoryの取り込み
 * （applySyncPacket）と、NASのreplicaを入れ替える前の版ずれの検査
 * （src/main/headless/replicaCheck.ts）が同じ規則を使うため、ここ以外に検査を足さない。
 */
export function assertSyncPacket(packet, workspaceId) {
  try {
    checkSyncPacket(packet, workspaceId);
  } catch (error) {
    // 文言はそのまま保つ（replica-checkが理由として表示する）。code だけを足す。
    const message = error instanceof Error ? error.message : String(error);
    throw Object.assign(new Error(message, { cause: error }), { code: SYNC_PACKET_REJECTED });
  }
}

function checkSyncPacket(packet, workspaceId) {
  if (
    !isPlainObject(packet) ||
    packet.format !== "tasken-sync-change" ||
    packet.formatVersion !== 1
  ) {
    throw new Error("同期差分の形式が不正です。");
  }
  if (packet.workspaceId !== workspaceId) throw new Error("別のWorkspaceの同期差分です。");
  assertEntityType(packet.entityType);
  if (
    !isPlainObject(packet.entity) ||
    String(packet.entity.id || "") !== String(packet.entityId || "")
  ) {
    throw new Error("同期差分のEntityが不正です。");
  }
  validateEntity(packet.entityType, packet.entity);
}
