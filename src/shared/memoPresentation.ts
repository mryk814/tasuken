import type { Entity } from "./types/workspace";

/** Memoの表示状態はcapture_entryの既存properties_jsonに保存する（#298 / #327）。 */
const PRESENTATION_PROPERTY = "presentation";
const PRESENTATION_COLOR_PROPERTY = "presentation_color";

export const MEMO_STICKY_COLORS = ["yellow", "blue", "green", "pink", "purple", "neutral"] as const;
export type MemoStickyColor = typeof MEMO_STICKY_COLORS[number];

export const MEMO_STICKY_COLOR_LABELS: Record<MemoStickyColor, string> = {
  yellow: "イエロー",
  blue: "ブルー",
  green: "グリーン",
  pink: "ピンク",
  purple: "パープル",
  neutral: "グレー",
};

export type MemoStickyVisibilityAction = "empty" | "show" | "hide";

export interface MemoStickyTargetRequest {
  memoId: string;
  target: boolean;
}

export interface MemoStickyColorRequest {
  color: MemoStickyColor;
}

export interface MemoStickyThemeRequest {
  theme: "light" | "dark";
}

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

export function memoStickyColorOf(entity: Entity | { properties_json?: unknown }): MemoStickyColor {
  const rawProperties = (entity as { properties_json?: unknown }).properties_json;
  const properties = rawProperties && typeof rawProperties === "object"
    ? rawProperties as Record<string, unknown>
    : {};
  const color = properties[PRESENTATION_COLOR_PROPERTY];
  return typeof color === "string" && MEMO_STICKY_COLORS.includes(color as MemoStickyColor)
    ? color as MemoStickyColor
    : "yellow";
}

export function markMemoStickyColor(entity: Entity, color: MemoStickyColor): Entity {
  return {
    ...entity,
    properties_json: {
      ...propertiesOf(entity),
      [PRESENTATION_COLOR_PROPERTY]: color,
    },
  };
}

export function memoStickyVisibilityAction(
  targetMemoIds: readonly string[],
  visibleMemoIds: readonly string[],
): MemoStickyVisibilityAction {
  if (targetMemoIds.length === 0) return "empty";
  const visible = new Set(visibleMemoIds);
  return targetMemoIds.every((memoId) => visible.has(memoId)) ? "hide" : "show";
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value as Record<string, unknown>).sort();
  const expectedKeys = [...keys].sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index]);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

export function parseMemoStickyTargetRequest(value: unknown): MemoStickyTargetRequest | null {
  if (!isExactRecord(value, ["memoId", "target"])) return null;
  return isUuid(value.memoId) && typeof value.target === "boolean"
    ? { memoId: value.memoId, target: value.target }
    : null;
}

export function parseMemoStickyColorRequest(value: unknown): MemoStickyColorRequest | null {
  if (!isExactRecord(value, ["color"])) return null;
  return typeof value.color === "string" && MEMO_STICKY_COLORS.includes(value.color as MemoStickyColor)
    ? { color: value.color as MemoStickyColor }
    : null;
}

export function parseMemoStickyThemeRequest(value: unknown): MemoStickyThemeRequest | null {
  if (!isExactRecord(value, ["theme"])) return null;
  return value.theme === "light" || value.theme === "dark" ? { theme: value.theme } : null;
}
