import type { Item, Theme } from "../types";
import { itemLevel } from "./domain";
import { addDays } from "./format";

export type TimelineRow =
  | { rowType: "theme"; groupKey: string; theme: Theme | null; planCount: number; taskCount: number }
  | { rowType: "item"; item: Item; depth: number; hasChildren: boolean };

export interface GanttRange {
  start: string;
  end: string;
}

export function ganttRange(scale: string, today: string): GanttRange {
  const date = new Date(`${today}T00:00:00`);
  if (scale === "year") return { start: `${date.getFullYear()}-01-01`, end: `${date.getFullYear()}-12-31` };
  const spans: Record<string, number> = { half: 183, quarter: 92, month: 31, week: 14 };
  const span = spans[scale] || 92;
  return { start: addDays(today, -Math.round(span * 0.25)), end: addDays(today, Math.round(span * 0.75)) };
}

export function ganttWidth(scale: string): number {
  const widths: Record<string, number> = { year: 1100, half: 1300, quarter: 1500, month: 1900, week: 2200 };
  return widths[scale] || 1500;
}

interface BuildRowsArgs {
  items: Item[];
  themes: Theme[];
  showTasks: boolean;
  collapsedThemes: string[];
  collapsedItems: string[];
}

// テーマ別レーンで行を組み立てる。各テーマの先頭にヘッダ行を置き、
// 既定では計画レベル（plan）のItemだけ、showTasks時は実行レベル（task）も親の下にネストする。
export function buildTimelineRows({ items, themes, showTasks, collapsedThemes, collapsedItems }: BuildRowsArgs): TimelineRow[] {
  const themeIds = new Set(themes.map((theme) => theme.id));
  const byTheme = new Map<string | null, Item[]>();
  for (const item of items) {
    const key = item.theme_id && themeIds.has(item.theme_id) ? item.theme_id : null;
    byTheme.set(key, [...(byTheme.get(key) || []), item]);
  }
  const rows: TimelineRow[] = [];
  const order: (string | null)[] = [...themes.map((theme) => theme.id), null];
  for (const themeId of order) {
    const pool = byTheme.get(themeId) || [];
    if (!pool.length) continue;
    const groupKey = themeId || "__none";
    const planCount = pool.filter((item) => itemLevel(item) === "plan").length;
    rows.push({
      rowType: "theme",
      groupKey,
      theme: themes.find((theme) => theme.id === themeId) || null,
      planCount,
      taskCount: pool.length - planCount,
    });
    if (collapsedThemes.includes(groupKey)) continue;
    const visiblePool = showTasks ? pool : pool.filter((item) => itemLevel(item) === "plan");
    const visibleIds = new Set(visiblePool.map((item) => item.id));
    const children = new Map<string, Item[]>();
    for (const item of visiblePool) {
      const parent = item.parent_item_id && visibleIds.has(item.parent_item_id) ? item.parent_item_id : "__root";
      children.set(parent, [...(children.get(parent) || []), item]);
    }
    children.forEach((records) => records.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));
    const visit = (parent: string, depth: number): void => {
      for (const item of children.get(parent) || []) {
        const hasChildren = (children.get(item.id) || []).length > 0;
        rows.push({ rowType: "item", item, depth, hasChildren });
        if (hasChildren && !collapsedItems.includes(item.id)) visit(item.id, depth + 1);
      }
    };
    visit("__root", 0);
  }
  return rows;
}
