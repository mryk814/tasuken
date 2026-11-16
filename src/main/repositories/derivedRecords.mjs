import { createHash } from "node:crypto";

/**
 * 切った機能の記録を別の種類へ写した記録（#755 束7。待ち → Task）の、最初の版の ID。
 *
 * 写すのは各 Desktop の起動で、複数の PC が同じ待ちを写しうる。写した記録の ID は元の ID から
 * 決まる（services/waitingRetirement.ts）。最初の版の ID は、種類・ID・中身から決める。
 * - 2 台が同じ中身を独立に写すと、同じ版の ID になり、同期では同じ版として 1 件に収まる
 *   （applySyncPacket は同じ版を duplicate として受け、版が進んだ後に届いた同じ最初の版は
 *   読み飛ばす）。
 * - 中身が違えば（片方の端末にだけ待ちの直しが届いていたなど）版の ID が違い、ふつうの競合として
 *   登録され、本人が選ぶ。黙って片方を残さない。
 * 中身から除くのは、端末ごとに変わる device_id だけ（時刻と版の数は元の記録から決まる）。
 */

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function uuidFromHash(hash) {
  const value = `${hash.slice(0, 12)}5${hash.slice(13, 16)}8${hash.slice(17, 32)}`;
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

/** 写した記録の最初の版の ID。同じ種類・ID・中身からは、どの端末でも同じ値になる。 */
export function derivedRootRevisionId(type, entity) {
  const { device_id: _deviceId, ...content } = entity;
  const hash = createHash("sha256")
    .update(
      ["tasken-derived-root-revision", type, String(entity.id), canonicalJson(content)].join("\0"),
    )
    .digest("hex");
  return uuidFromHash(hash);
}

/** 端末ごとの控え（workspace_meta）に、その記録の最初の版の ID を持つ時のキー。同期には載せない。 */
export function derivedRootMetaKey(type, id) {
  return `derived_root_v1:${type}:${id}`;
}
