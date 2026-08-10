import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * 切り離しウィンドウの位置・サイズを覚えるための純粋な部分（#290）。
 *
 * Electronに依存しないので単体で検証できる。BrowserWindowの生成・破棄は
 * satelliteWindowRegistry.ts が受け持つ。
 *
 * ここに置く状態は「端末ごとのウィンドウの見え方」であり正本データではない。
 * 別端末へ同期させたくないので、DBではなくuserData配下のJSONへ書く。
 */

/** 切り離せる面の種類。EntityのtypeではなくUIの面としてのkind。 */
export type SatelliteWindowKind = "memo" | "note" | "today" | "recording";

export interface SatelliteWindowKey {
  kind: SatelliteWindowKind;
  entityId: string;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 復元先の候補となる画面。Electronのscreen.getAllDisplays()のworkAreaを想定する。 */
export interface DisplayArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SatelliteWindowSizeLimits {
  minWidth: number;
  minHeight: number;
}

/** 同じEntityに二つのウィンドウを作らないための一意キー。 */
export function satelliteWindowKeyOf(key: SatelliteWindowKey): string {
  return `${key.kind}:${key.entityId}`;
}

export function parseSatelliteWindowKey(value: string): SatelliteWindowKey | null {
  const separator = value.indexOf(":");
  if (separator <= 0) return null;
  const kind = value.slice(0, separator);
  const entityId = value.slice(separator + 1);
  if (!entityId) return null;
  if (kind !== "memo" && kind !== "note" && kind !== "today") return null;
  return { kind, entityId };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeBounds(value: unknown): WindowBounds | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const { x, y, width, height } = candidate;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

function overlapArea(bounds: WindowBounds, display: DisplayArea): number {
  const overlapWidth = Math.min(bounds.x + bounds.width, display.x + display.width) - Math.max(bounds.x, display.x);
  const overlapHeight = Math.min(bounds.y + bounds.height, display.y + display.height) - Math.max(bounds.y, display.y);
  return overlapWidth > 0 && overlapHeight > 0 ? overlapWidth * overlapHeight : 0;
}

/**
 * 保存した位置を、いま存在する画面の中へ収める（#290）。
 *
 * モニターを外した後や表示倍率を変えた後に、画面外の座標へ復元すると
 * ウィンドウが二度と掴めなくなる。重なりが最大の画面を選び、そこへ寄せる。
 * 画面より大きいウィンドウは画面いっぱいまで縮め、最小サイズは必ず守る。
 */
export function clampBoundsToDisplays(
  bounds: WindowBounds,
  displays: DisplayArea[],
  limits: SatelliteWindowSizeLimits,
): WindowBounds {
  if (!displays.length) return bounds;
  const target = displays.reduce((best, display) => (
    overlapArea(bounds, display) > overlapArea(bounds, best) ? display : best
  ), displays[0]);

  const width = Math.max(limits.minWidth, Math.min(bounds.width, target.width));
  const height = Math.max(limits.minHeight, Math.min(bounds.height, target.height));
  const maxX = target.x + Math.max(0, target.width - width);
  const maxY = target.y + Math.max(0, target.height - height);
  return {
    width,
    height,
    x: Math.round(Math.min(Math.max(bounds.x, target.x), maxX)),
    y: Math.round(Math.min(Math.max(bounds.y, target.y), maxY)),
  };
}

export interface SatelliteWindowStateStore {
  read: (key: SatelliteWindowKey) => WindowBounds | null;
  write: (key: SatelliteWindowKey, bounds: WindowBounds) => void;
  forget: (key: SatelliteWindowKey) => void;
}

/**
 * 位置・サイズをJSON1ファイルへ持つ。読み書きの失敗でウィンドウが開けなくなると
 * 困るので、壊れたファイルは既定値として扱い、書き込み失敗は無視する。
 */
export function createSatelliteWindowStateStore(filePath: string): SatelliteWindowStateStore {
  function readAll(): Record<string, WindowBounds> {
    if (!existsSync(filePath)) return {};
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object") return {};
      const result: Record<string, WindowBounds> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        const bounds = normalizeBounds(value);
        if (bounds && parseSatelliteWindowKey(key)) result[key] = bounds;
      }
      return result;
    } catch {
      // 壊れた状態ファイルは端末ごとの見え方の情報でしかない。
      // 正本データではないので、既定位置で開き直せれば十分。
      return {};
    }
  }

  function writeAll(entries: Record<string, WindowBounds>): void {
    try {
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
    } catch {
      // 位置を覚えられないだけで編集内容には影響しないため、保存失敗は無視する。
    }
  }

  return {
    read: (key) => readAll()[satelliteWindowKeyOf(key)] ?? null,
    write: (key, bounds) => {
      const entries = readAll();
      entries[satelliteWindowKeyOf(key)] = bounds;
      writeAll(entries);
    },
    forget: (key) => {
      const entries = readAll();
      delete entries[satelliteWindowKeyOf(key)];
      writeAll(entries);
    },
  };
}
