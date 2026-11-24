/**
 * 本体の指定（#754・段 4 #812）の、記録の形だけの決まり。
 *
 * 本体の指定は、同期される記録（Entity の workspace_designation）として差分に乗せる。
 * Workspace に 1 件だけなので、ID は固定にする。2 台が別々の端末を同時に指定したら、
 * 同じ ID への競合として今の仕組み（本人が選ぶ）に乗る。
 * `tasken-sync.json` には入れない（形が崩れると全端末の同期が止まるため）。
 */

/** 本体の指定の固定 ID（Workspace に 1 件だけ）。 */
export const WORKSPACE_DESIGNATION_ID = "workspace-designation";

/** 指定先の端末 ID。記録が無い・欄が空なら空文字。 */
export function workspaceDesignationDeviceId(record) {
  if (!record || typeof record !== "object") return "";
  const value = record.main_device_id;
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 記録の並びから本体の指定を 1 件引く。固定 ID の、消されていない記録だけが指定として効く。
 * @returns {Record<string, unknown> | null}
 */
export function findWorkspaceDesignation(records) {
  if (!Array.isArray(records)) return null;
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    if (record.id !== WORKSPACE_DESIGNATION_ID) continue;
    if (record.deleted_at) continue;
    return record;
  }
  return null;
}
