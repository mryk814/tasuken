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

// 年間は年度（4月〜翌3月）で扱う。今が1〜3月なら前年4月始まりの年度に属する。
export function fiscalYearStart(today: string): number {
  const date = new Date(`${today}T00:00:00`);
  return date.getMonth() + 1 >= 4 ? date.getFullYear() : date.getFullYear() - 1;
}

// 指定の暦年・開始月から months ヶ月ぶんの範囲（月初〜月末）。月の繰り上がりは年をまたぐ。
function monthRange(year: number, startMonth: number, months: number): GanttRange {
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  return {
    start: iso(new Date(Date.UTC(year, startMonth - 1, 1))),
    end: iso(new Date(Date.UTC(year, startMonth - 1 + months, 0))),
  };
}

// 年間・半年・四半期は年度の「期」の区切りに合わせる（半年=4〜9 or 10〜3、四半期=4-6/7-9/10-12/1-3）。
// 現在の月がどの期に属するかで範囲を決める。月間・週間は今日を中心にした相対表示のまま。
export function ganttRange(scale: string, today: string): GanttRange {
  const date = new Date(`${today}T00:00:00`);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  if (scale === "year") return monthRange(fiscalYearStart(today), 4, 12);
  if (scale === "half") {
    if (month >= 4 && month <= 9) return monthRange(year, 4, 6);
    if (month >= 10) return monthRange(year, 10, 6);
    return monthRange(year - 1, 10, 6);
  }
  if (scale === "quarter") return monthRange(year, Math.floor((month - 1) / 3) * 3 + 1, 3);
  const span = scale === "week" ? 14 : 31;
  return { start: addDays(today, -Math.round(span * 0.25)), end: addDays(today, Math.round(span * 0.75)) };
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
