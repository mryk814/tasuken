import type { StatusUpdate, Theme } from "../types";
import type { WorkspaceDomain } from "../domain-model/types";

export type SlideTimelineKind = "task" | "activity";
export type SlideTimelineUnit = "day" | "week" | "month";
export type SlideTimelineBackground = "white" | "transparent";

export interface SlideTimelineCandidate {
  id: string;
  kind: SlideTimelineKind;
  title: string;
  start: string;
  end: string;
  projectId: string | null;
  status: string;
  detail: string;
}

export interface SlideTimelineBuildOptions {
  title: string;
  subtitle: string;
  themeName: string;
  start: string;
  end: string;
  unit: SlideTimelineUnit;
  background: SlideTimelineBackground;
  items: SlideTimelineCandidate[];
}

const SLIDE_WIDTH = 1600;
const SLIDE_HEIGHT = 900;
const MAX_VISIBLE_ITEMS = 24;

function dateOnly(value: unknown): string {
  const text = String(value || "");
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] || "";
}

function dateNumber(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function addDays(value: string, amount: number): string {
  const date = new Date(dateNumber(value));
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function addMonths(value: string, amount: number): string {
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + amount, 1)).toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  return Math.round((dateNumber(end) - dateNumber(start)) / 86_400_000);
}

function inRange(date: string, start: string, end: string): boolean {
  return Boolean(date) && date >= start && date <= end;
}

function projectMatches(projectId: string | null | undefined, themeId: string): boolean {
  return themeId === "all" || String(projectId || "") === themeId;
}

function recordTimestamp(record: unknown): string {
  const row = record as Record<string, unknown>;
  return dateOnly(row.updated_at || row.created_at);
}

function entityProjectId(domain: WorkspaceDomain, type: string, id: string): string | null {
  const collections: Record<string, Array<{ id: string; project_id?: string | null }>> = {
    task: domain.tasks,
    waiting: domain.waitings,
    plan_node: domain.plan_nodes,
    note: domain.notes,
    resource: domain.resources,
    capture_entry: domain.capture_entries,
    knowledge_node: domain.knowledge_nodes,
  };
  return collections[type]?.find((entry) => entry.id === id)?.project_id || null;
}

function entityTitle(domain: WorkspaceDomain, type: string, id: string): string {
  const collections: Record<string, Array<{ id: string; title?: string | null; text?: string | null }>> = {
    task: domain.tasks,
    waiting: domain.waitings,
    plan_node: domain.plan_nodes,
    note: domain.notes,
    resource: domain.resources,
    capture_entry: domain.capture_entries,
    knowledge_node: domain.knowledge_nodes,
  };
  const entity = collections[type]?.find((entry) => entry.id === id);
  return String(entity?.title || entity?.text || type);
}

function activityLabel(changeType: string): string {
  return ({
    created: "作成",
    updated: "更新",
    completed: "完了",
    rescheduled: "日程変更",
    triaged: "整理",
    deleted: "削除",
  } as Record<string, string>)[changeType] || "活動";
}

export function buildSlideTimelineCandidates(
  domain: WorkspaceDomain,
  statusUpdates: StatusUpdate[],
  options: { themeId: string; start: string; end: string },
): SlideTimelineCandidate[] {
  const candidates: SlideTimelineCandidate[] = [];

  for (const task of domain.tasks) {
    if (!projectMatches(task.project_id, options.themeId)) continue;
    const schedule = domain.schedules.find((entry) => entry.owner_type === "task" && entry.owner_id === task.id);
    const fallback = dateOnly(task.completed_at || task.updated_at || task.created_at);
    const start = dateOnly(schedule?.start_date || schedule?.end_date) || fallback;
    const end = dateOnly(schedule?.end_date || schedule?.start_date) || start;
    if (!start || end < options.start || start > options.end) continue;
    candidates.push({
      id: `task:${task.id}`,
      kind: "task",
      title: task.title,
      start: start < options.start ? options.start : start,
      end: end > options.end ? options.end : end,
      projectId: task.project_id || null,
      status: task.state,
      detail: task.state === "done" ? "完了" : task.state === "doing" ? "進行中" : "予定",
    });
  }

  for (const event of domain.change_events) {
    const date = dateOnly(event.changed_at);
    const projectId = entityProjectId(domain, event.entity_type, event.entity_id);
    if (!inRange(date, options.start, options.end) || !projectMatches(projectId, options.themeId)) continue;
    candidates.push({
      id: `activity:${event.id}`,
      kind: "activity",
      title: entityTitle(domain, event.entity_type, event.entity_id),
      start: date,
      end: date,
      projectId,
      status: event.change_type,
      detail: activityLabel(event.change_type),
    });
  }

  for (const update of statusUpdates) {
    const date = dateOnly(update.date || update.updated_at || update.created_at);
    if (!inRange(date, options.start, options.end) || !projectMatches(update.theme_id, options.themeId)) continue;
    candidates.push({
      id: `activity:status:${update.id}`,
      kind: "activity",
      title: String(update.summary || update.next_actions || update.risks || "現在地を更新"),
      start: date,
      end: date,
      projectId: update.theme_id || null,
      status: "updated",
      detail: "現在地",
    });
  }

  const seen = new Set<string>();
  return candidates.sort((a, b) => (
    a.start.localeCompare(b.start)
    || (a.kind === b.kind ? 0 : a.kind === "task" ? -1 : 1)
    || a.title.localeCompare(b.title, "ja")
  )).filter((item) => {
    const key = [item.kind, item.projectId, item.start, item.end, item.title, item.detail].join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character] || character);
}

function truncate(value: string, length: number): string {
  const characters = Array.from(value.trim());
  return characters.length <= length ? value.trim() : `${characters.slice(0, length - 1).join("")}…`;
}

function tickDates(start: string, end: string, unit: SlideTimelineUnit): string[] {
  const dates: string[] = [];
  let current = start;
  while (current <= end && dates.length < 80) {
    dates.push(current);
    current = unit === "month" ? addMonths(current, 1) : addDays(current, unit === "week" ? 7 : 1);
  }
  if (dates.at(-1) !== end) dates.push(end);
  return dates;
}

function dateLabel(value: string, unit: SlideTimelineUnit): string {
  if (unit === "month") return `${Number(value.slice(5, 7))}月`;
  return `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}`;
}

export function buildSlideTimelineSvg(options: SlideTimelineBuildOptions): string {
  if (!options.start || !options.end || options.start > options.end) {
    throw new Error("開始日と終了日を正しい順序で指定してください。");
  }
  const left = 330;
  const right = 70;
  const top = 190;
  const bottom = 84;
  const plotWidth = SLIDE_WIDTH - left - right;
  const plotHeight = SLIDE_HEIGHT - top - bottom;
  const visibleItems = options.items.slice(0, MAX_VISIBLE_ITEMS);
  const overflowCount = Math.max(0, options.items.length - visibleItems.length);
  const rowHeight = plotHeight / Math.max(visibleItems.length + (overflowCount ? 1 : 0), 1);
  const totalDays = Math.max(1, daysBetween(options.start, options.end));
  const xFor = (date: string) => left + Math.max(0, Math.min(totalDays, daysBetween(options.start, date))) / totalDays * plotWidth;
  const ticks = tickDates(options.start, options.end, options.unit);
  const background = options.background === "white"
    ? `<rect width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" fill="#fffdfb"/>`
    : "";

  const tickMarkup = ticks.map((date, index) => {
    const x = xFor(date);
    const anchor = index === 0 ? "start" : index === ticks.length - 1 ? "end" : "middle";
    return `<line x1="${x}" y1="${top - 24}" x2="${x}" y2="${SLIDE_HEIGHT - bottom + 8}" stroke="#e5d9d8" stroke-width="1"/>`
      + `<text x="${x}" y="${top - 38}" text-anchor="${anchor}" class="tick">${escapeXml(dateLabel(date, options.unit))}</text>`;
  }).join("");

  const rowMarkup = visibleItems.map((item, index) => {
    const y = top + rowHeight * index + rowHeight / 2;
    const rowTop = top + rowHeight * index;
    const x1 = xFor(item.start);
    const x2 = xFor(item.end);
    const kind = item.kind === "task" ? "TASK" : "ACT";
    const title = truncate(item.title, 30);
    const label = `<text x="56" y="${y + 5}" class="kind">${kind}</text>`
      + `<text x="112" y="${y + 5}" class="label">${escapeXml(title)}</text>`
      + `<text x="${left - 18}" y="${y + 5}" text-anchor="end" class="detail">${escapeXml(item.detail)}</text>`;
    const mark = item.kind === "task"
      ? `<rect x="${x1}" y="${y - 8}" width="${Math.max(8, x2 - x1)}" height="16" rx="8" fill="${item.status === "done" ? "#6f7767" : "#8a2f3b"}"/>`
        + (item.status === "done" ? `<path d="M ${Math.max(x1 + 5, x2 - 18)} ${y} l 4 4 l 8 -9" fill="none" stroke="#fffdfb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` : "")
      : `<line x1="${left}" y1="${y}" x2="${x1}" y2="${y}" stroke="#d6c7c6" stroke-width="2"/>`
        + `<path d="M ${x1} ${y - 9} L ${x1 + 9} ${y} L ${x1} ${y + 9} L ${x1 - 9} ${y} Z" fill="#2f6fa6"/>`;
    return `<rect x="40" y="${rowTop}" width="${SLIDE_WIDTH - 80}" height="${rowHeight}" fill="${index % 2 ? "#fbf6f3" : "transparent"}"/>${label}${mark}`;
  }).join("");

  const overflowMarkup = overflowCount
    ? `<text x="56" y="${top + rowHeight * visibleItems.length + rowHeight / 2 + 5}" class="overflow">ほか ${overflowCount} 件 — 項目選択で1枚に収められます</text>`
    : "";
  const emptyMarkup = visibleItems.length
    ? ""
    : `<text x="${SLIDE_WIDTH / 2}" y="${SLIDE_HEIGHT / 2}" text-anchor="middle" class="empty">期間内の項目を選択してください</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" viewBox="0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}">`
    + `<style>text{font-family:"Yu Gothic UI","Meiryo",sans-serif;fill:#342e2c}.title{font-size:42px;font-weight:700}.subtitle{font-size:19px;fill:#756967}.theme{font-size:18px;font-weight:700;fill:#8a2f3b}.tick{font-size:15px;fill:#756967}.kind{font-size:12px;font-weight:800;letter-spacing:1px;fill:#756967}.label{font-size:17px;font-weight:600}.detail{font-size:13px;fill:#756967}.overflow{font-size:16px;font-weight:600;fill:#8a2f3b}.empty{font-size:22px;fill:#756967}</style>`
    + background
    + `<text x="56" y="76" class="title">${escapeXml(truncate(options.title || "Timeline", 48))}</text>`
    + `<text x="56" y="112" class="subtitle">${escapeXml(truncate(options.subtitle, 72))}</text>`
    + `<text x="1544" y="76" text-anchor="end" class="theme">${escapeXml(truncate(options.themeName, 34))}</text>`
    + `<text x="1544" y="110" text-anchor="end" class="subtitle">${escapeXml(`${options.start} — ${options.end}`)}</text>`
    + `<line x1="${left}" y1="${top - 24}" x2="${SLIDE_WIDTH - right}" y2="${top - 24}" stroke="#8a2f3b" stroke-width="3"/>`
    + tickMarkup
    + rowMarkup
    + overflowMarkup
    + emptyMarkup
    + `</svg>`;
}

export async function slideTimelineSvgToPng(svg: string, scale = 2): Promise<string> {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = SLIDE_WIDTH * scale;
  canvas.height = SLIDE_HEIGHT * scale;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("高解像度PNGを作成できませんでした。");
  context.scale(scale, scale);
  context.drawImage(image, 0, 0, SLIDE_WIDTH, SLIDE_HEIGHT);
  return canvas.toDataURL("image/png");
}

export function slideTimelineThemeName(themes: Theme[], themeId: string): string {
  if (themeId === "all") return "All Themes";
  return themes.find((theme) => theme.id === themeId)?.name || "Theme未設定";
}
