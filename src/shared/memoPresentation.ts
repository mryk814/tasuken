import type { Entity } from "./types/workspace";

/** Memoの表示状態はcapture_entryの既存properties_jsonに保存する（#298 / #327）。 */
const PRESENTATION_PROPERTY = "presentation";

function propertiesOf(entity: Entity): Record<string, unknown> {
  return entity.properties_json && typeof entity.properties_json === "object"
    ? { ...(entity.properties_json as Record<string, unknown>) }
    : {};
}

export function isStickyMemoTarget(entity: Entity): boolean {
  if (entity.kind !== "micro_memo" || entity.state === "archived" || entity.deleted_at) return false;
  const properties = propertiesOf(entity);
  // sticky=trueは開発初期の保存値を読み続けるためだけの互換読み込み。
  return properties[PRESENTATION_PROPERTY] === "floating" || properties.sticky === true;
}

export function markStickyMemoTarget(entity: Entity, sticky: boolean): Entity {
  const { sticky: _legacySticky, ...properties } = propertiesOf(entity);
  return {
    ...entity,
    properties_json: {
      ...properties,
      [PRESENTATION_PROPERTY]: sticky ? "floating" : "normal",
    },
  };
}
