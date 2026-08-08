import type { Item, Theme } from "../types";
import { getScheduleKind, type ScheduleKind } from "../domain-model/scheduleSemantics";
import type { Schedule, ScheduleRangeSemantics } from "../domain-model/types";
import { itemLevel } from "./domain";
import { addDays, daysBetween, localDateIso } from "./format";

export type TimelineRow =
  | { rowType: "theme"; groupKey: string; theme: Theme | null; initiativeCount: number; planCount: number }
  | { rowType: "milestones"; groupKey: string; theme: Theme | null; milestones: Item[] }
  | { rowType: "item"; item: Item; depth: number; laneItems: Item[] };

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
  return {
    start: localDateIso(new Date(year, startMonth - 1, 1)),
    end: localDateIso(new Date(year, startMonth - 1 + months, 0)),
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
  collapsedThemes: string[];
  scale?: string;
}

export function dataRange(items: Item[], today: string, paddingDays = 90): GanttRange {
  let min = today;
  let max = today;
  for (const item of items) {
    for (const d of [item.planned_start, item.planned_end, item.due_date]) {
      if (d && d < min) min = d;
      if (d && d > max) max = d;
    }
  }
  const span = daysBetween(min, max);
  const extra = Math.max(paddingDays, Math.floor((180 - span) / 2));
  return { start: addDays(min, -extra), end: addDays(max, extra) };
}

export function scaleFromDayWidth(dayWidth: number): string {
  if (dayWidth >= 36) return "week";
  if (dayWidth >= 16) return "month";
  if (dayWidth >= 6) return "quarter";
  if (dayWidth >= 3) return "half";
  return "year";
}

/**
 * Timeline itemの状態（#318）。
 *
 * Theme色は「どの束のものか」を、状態は「いまどうなっているか」を表す。
 * 二つを同じ色体系で混ぜないため、状態はここで一意に決めて
 * class / label / icon へ同じ値を配る。色だけで伝えない。
 */
export type TimelineItemState =
  | "completed"
  | "cancelled"
  | "overdue"
  | "ongoing"
  | "execution_window"
  | "active"
  | "planned";

interface TimelineStateInput {
  status?: string;
  planned_start?: string | null;
  planned_end?: string | null;
  /** #309の日付範囲の意味。未設定は「分類していない範囲」。 */
  range_semantics?: string | null;
}

/** Timelineも日付範囲の意味を直接読まず、#309の判定へ接続する。 */
export function timelineItemScheduleKind(item: TimelineStateInput): ScheduleKind {
  const start = item.planned_start || null;
  const end = item.planned_end || null;
  const schedule: Schedule = {
    id: `timeline-schedule:${item.planned_start || "none"}:${item.planned_end || "none"}`,
    owner_type: "plan_node",
    owner_id: "timeline-item",
    start_date: start,
    end_date: end,
    date_kind: start && end && end > start ? "range" : end ? "deadline" : start ? "point" : "unknown",
    range_semantics: item.range_semantics === "ongoing" || item.range_semantics === "once_within_window"
      ? item.range_semantics as ScheduleRangeSemantics
      : null,
    confidence: "fixed",
    granularity: "day",
  };
  return getScheduleKind(schedule);
}

export function timelineItemState(item: TimelineStateInput, today: string): TimelineItemState {
  const status = String(item.status || "");
  if (status === "done") return "completed";
  if (status === "cancelled") return "cancelled";

  const start = String(item.planned_start || "");
  const end = String(item.planned_end || "");
  // 終了日を過ぎた未完了だけを期限超過にする。開始前の項目は含めない。
  if (end && end < today) return "overdue";

  const started = !start || start <= today;
  const inRange = started && (!end || end >= today);
  const scheduleKind = timelineItemScheduleKind(item);
  if (inRange && scheduleKind === "ongoing_period") return "ongoing";
  if (inRange && scheduleKind === "execution_window") return "execution_window";
  if (inRange && (start || end)) return "active";
  return "planned";
}

export const ZOOM_PRESETS = [
  { id: "year", label: "年間", dayWidth: 2 },
  { id: "half", label: "半年", dayWidth: 4 },
  { id: "quarter", label: "四半期", dayWidth: 8 },
  { id: "month", label: "月間", dayWidth: 24 },
  { id: "week", label: "週間", dayWidth: 48 },
] as const;

export const MIN_DAY_WIDTH = 1;
export const MAX_DAY_WIDTH = 80;

const SCALE_ORDER = ["year", "half", "quarter", "month", "week"];

function dateOf(item: Item): string {
  return String(item.planned_end || item.due_date || item.planned_start || "");
}

function visibilityRank(value?: unknown): number {
  const index = SCALE_ORDER.indexOf(String(value || "year"));
  return index >= 0 ? index : 0;
}

function scaleRank(scale?: string): number {
  const index = SCALE_ORDER.indexOf(String(scale || "quarter"));
  return index >= 0 ? index : 2;
}

function isVisibleAtScale(item: Item, scale?: string): boolean {
  const level = String(item.visibility_level || "");
  if (level) return visibilityRank(level) <= scaleRank(scale);
  const importance = String(item.importance || "");
  if (scale === "year") return importance ? importance === "major" : true;
  if (scale === "half" || scale === "quarter") return importance !== "minor";
  return true;
}

// テーマ別レーンで行を組み立てる。親を持たない計画Itemは左表の「実施事項」、
// その子Itemは同じタイムライン行に並ぶ「計画」として扱う。
export function buildTimelineRows({ items, themes, collapsedThemes, scale }: BuildRowsArgs): TimelineRow[] {
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
    const milestones = pool
      .filter((item) => item.kind === "milestone" && String(item.display_lane || "theme_lane") !== "item_endpoint" && isVisibleAtScale(item, scale))
      .sort((a, b) => dateOf(a).localeCompare(dateOf(b)) || (a.sort_order || 0) - (b.sort_order || 0));
    const allPlans = pool
      .filter((item) => item.kind !== "milestone" && itemLevel(item) === "plan")
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const planIds = new Set(allPlans.map((item) => item.id));
    const initiatives = allPlans.filter((item) => !item.parent_item_id || !planIds.has(item.parent_item_id));
    const planCount = allPlans.length - initiatives.length;
    rows.push({
      rowType: "theme",
      groupKey,
      theme: themes.find((theme) => theme.id === themeId) || null,
      initiativeCount: initiatives.length,
      planCount,
    });
    if (collapsedThemes.includes(groupKey)) continue;
    if (milestones.length) {
      rows.push({
        rowType: "milestones",
        groupKey,
        theme: themes.find((theme) => theme.id === themeId) || null,
        milestones,
      });
    }
    const childPlans = allPlans
      .filter((item) => item.parent_item_id && planIds.has(item.parent_item_id))
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const children = new Map<string, Item[]>();
    for (const item of childPlans) {
      const parent = String(item.parent_item_id);
      children.set(parent, [...(children.get(parent) || []), item]);
    }
    for (const plan of initiatives) {
      const laneItems = children.get(plan.id) || [];
      rows.push({
        rowType: "item",
        item: plan,
        depth: 0,
        laneItems: laneItems.length > 0 ? laneItems : [plan],
      });
    }
  }
  return rows;
}
