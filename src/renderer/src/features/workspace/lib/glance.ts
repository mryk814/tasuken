import type { Note, Resource, Task, Waiting, WorkspaceDomain } from "../domain-model/types";
import type { StatusUpdate, Theme, WorkspaceData } from "../types";
import { resolveChatService } from "./chatServices";
import { dateOnly, str } from "./format";

/**
 * 右側の補助面（ContextPane / FeedContextRail）が読む「今」の断片。
 *
 * どちらも同じ正本（`WorkspaceData` / `WorkspaceDomain`）から導出し、
 * 0件の断片は呼び出し側で畳む。文章を生成して空白を埋めない。
 */

export function recordDate(record: {
  updated_at?: string;
  created_at?: string;
  captured_at?: string | null;
}): string {
  return dateOnly(record.updated_at || record.captured_at || record.created_at);
}

export function daysAgo(value: string): number {
  if (!value) return 9999;
  const today = new Date();
  const then = new Date(`${value}T00:00:00`);
  return Math.floor((today.getTime() - then.getTime()) / 86400000);
}

function daySeed(): number {
  const key = dateOnly(new Date().toISOString());
  return key.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

/** 7日以上前の記録から、日替わりで拾い直す候補を決める。順序は利用日で安定させる。 */
export function pickRediscovery<
  T extends { id: string; updated_at?: string; created_at?: string; captured_at?: string | null },
>(records: T[], count: number): T[] {
  const seed = daySeed();
  return [...records]
    .filter((record) => daysAgo(recordDate(record)) >= 7)
    .sort((a, b) => {
      const aScore = (a.id.charCodeAt(0) || 0) + seed + daysAgo(recordDate(a));
      const bScore = (b.id.charCodeAt(0) || 0) + seed + daysAgo(recordDate(b));
      return (aScore % 97) - (bScore % 97);
    })
    .slice(0, count);
}

export interface OverdueRow {
  task: Task;
  date: string;
  themeName: string | null;
}

export interface Glance {
  today: string;
  overdue: OverdueRow[];
  waitingRows: Waiting[];
  recentUpdates: StatusUpdate[];
  notes: (Note & { updated_at?: string; created_at?: string })[];
  chatResources: (Resource & { updated_at?: string; created_at?: string })[];
}

export function buildGlance(input: {
  data: WorkspaceData;
  domain: WorkspaceDomain;
  activeTheme: Theme | null;
}): Glance {
  const { data, domain: v2, activeTheme } = input;
  const today = dateOnly(new Date().toISOString());
  const schedulesMap = new Map(v2.schedules.map((s) => [`${s.owner_type}:${s.owner_id}`, s]));
  const themeNameOf = (projectId: string | null | undefined) =>
    (projectId && data.themes.find((t) => t.id === projectId)?.name) || null;

  const themeTasks = activeTheme
    ? v2.tasks.filter((t) => t.project_id === activeTheme.id)
    : v2.tasks;
  const overdue: OverdueRow[] = themeTasks
    .filter((t) => t.state !== "done" && t.state !== "cancelled")
    .map((task) => ({
      task,
      date: schedulesMap.get(`task:${task.id}`)?.end_date || "",
      themeName: themeNameOf(task.project_id),
    }))
    .filter((row) => row.date && row.date < today)
    .sort((a, b) => a.date.localeCompare(b.date));

  const themeWaitings = activeTheme
    ? v2.waitings.filter((w) => w.project_id === activeTheme.id)
    : v2.waitings;
  const waitingRows = themeWaitings.filter((w) => w.state === "waiting").slice(0, 4);

  const recentUpdates = ([...data.status_updates] as StatusUpdate[])
    .filter((entry) => !activeTheme || entry.theme_id === activeTheme.id)
    .sort((a, b) => str(b.date || b.updated_at).localeCompare(str(a.date || a.updated_at)))
    .slice(0, 2);

  const notes = pickRediscovery(
    v2.notes as (Note & { updated_at?: string; created_at?: string })[],
    2,
  );
  const chatResources = pickRediscovery(
    v2.resources.filter((r) => resolveChatService(r) !== "other") as (Resource & {
      updated_at?: string;
      created_at?: string;
    })[],
    2,
  );

  return { today, overdue, waitingRows, recentUpdates, notes, chatResources };
}
