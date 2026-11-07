import { assertEntityType, validateEntity } from "./domain.mjs";

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
