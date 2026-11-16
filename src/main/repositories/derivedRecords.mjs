import { createHash } from "node:crypto";

/**
 * 元の記録から決まる ID と、その記録を作った最初の版（root revision）の ID（#755 束7）。
 *
 * 切った機能の記録を別の種類へ写す時（待ち → Task）、写すのは各 Desktop の起動で、同期の
 * 前後を問わず複数の PC が同じ待ちを写しうる。写した記録の ID を元の ID から決め、最初の版の
 * ID も種類と ID から決めると、2 台が独立に写しても同期では同じ版として 1 件に収まる
 * （applySyncPacket は同じ版を duplicate として受け、版が進んだ後に届いた最初の版は
 * isDerivedRootRevision で読み飛ばす）。
 */

/** 文字列の並びから決まる UUID（v5 の形。uuidPattern で照合する欄にも入れられる）。 */
export function derivedUuid(parts) {
  const hash = createHash("sha256").update(parts.map(String).join("\0")).digest("hex");
  const value = `${hash.slice(0, 12)}5${hash.slice(13, 16)}8${hash.slice(17, 32)}`;
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

/** 写した記録の最初の版の ID。どの端末でも、同じ種類・同じ ID からは同じ値になる。 */
export function derivedRootRevisionId(type, id) {
  return derivedUuid(["tasken-derived-root-revision", type, id]);
}

/**
 * 届いた差分が、写した記録の最初の版か。親を持たず、版の ID が種類と ID から決まる値と同じ物。
 * その記録が手元にあれば、手元の版は必ずこの版から続いている（写した記録はこの版でしか生まれない）。
 */
export function isDerivedRootRevision(type, id, revisionId, parentRevisionIds) {
  return (
    Array.isArray(parentRevisionIds) &&
    parentRevisionIds.length === 0 &&
    revisionId === derivedRootRevisionId(type, String(id))
  );
}
