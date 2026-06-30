import { useEffect, useRef, useState } from "react";

import type { BaseRecord, Item } from "../types";

type Dependency = BaseRecord;
import { DAY, hasPlannedSchedule, itemLevel, statusProgress } from "../lib/domain";
import { addDays, daysBetween, localDateIso, str } from "../lib/format";
import type { GanttRange, TimelineRow } from "../lib/timeline";

export interface SelectedDependency {
  dependency: Dependency;
  sourceTitle: string;
  targetTitle: string;
}

function isInProgressStatus(status?: string): boolean {
  return status === "doing" || status === "進行中";
}

type DragMode = "move" | "start" | "end";
const BASE_ROW_HEIGHT = 44;
const LANE_STEP = 26;
const LANE_TOP = 11;
const LANE_BAR_HEIGHT = 22;

export interface ConnectingState {
  sourceId: string;
  sourceTitle: string;
}

function barRange(item: Item): { start: string; end: string } | null {
  const start = item.planned_start || item.planned_end;
  const end = item.planned_end || start;
  if (!start || !end || !hasPlannedSchedule(item)) return null;
  return { start, end };
}

function clippedBarRange(item: Item, range: GanttRange): { start: string; end: string } | null {
  const base = barRange(item);
  if (!base) return null;
  if (base.end < range.start || base.start > range.end) return null;
  return {
    start: base.start < range.start ? range.start : base.start,
    end: base.end > range.end ? range.end : base.end,
  };
}

export function assignGanttSubLanes(items: Item[]): Map<string, number> {
  const lanes: string[] = [];
  const result = new Map<string, number>();
  const scheduled = items
    .map((item, index) => ({ item, index, range: barRange(item) }))
    .filter((entry): entry is { item: Item; index: number; range: { start: string; end: string } } => Boolean(entry.range))
    .sort((a, b) => a.range.start.localeCompare(b.range.start) || a.range.end.localeCompare(b.range.end) || a.index - b.index);
  for (const entry of scheduled) {
    let lane = lanes.findIndex((lastEnd) => entry.range.start > lastEnd);
    if (lane < 0) {
      lane = lanes.length;
      lanes.push(entry.range.end);
    } else {
      lanes[lane] = entry.range.end;
    }
    result.set(entry.item.id, lane);
  }
  return result;
}

export function ganttSubLaneCount(items: Item[]): number {
  const lanes = assignGanttSubLanes(items);
  return Math.max(1, ...[...lanes.values()].map((lane) => lane + 1));
}

export function ganttRowHeight(items: Item[]): number {
  return BASE_ROW_HEIGHT + Math.max(0, ganttSubLaneCount(items) - 1) * LANE_STEP;
}

function ganttBarCenterY(rowItems: Item[], itemId: string): number {
  const lanes = assignGanttSubLanes(rowItems);
  const lane = lanes.get(itemId) || 0;
  if (rowItems.length <= 1) return BASE_ROW_HEIGHT / 2;
  return LANE_TOP + lane * LANE_STEP + LANE_BAR_HEIGHT / 2;
}

export function GanttItemRow({
  item,
  laneItems,
  range,
  hint,
  selectedItemId,
  onOpen,
  onSelect,
  onMove,
  connecting,
  onConnect,
  onCreateRange,
  themeColorKey,
  resolveDropTarget,
  onCtrlClick,
}: {
  item: Item;
  laneItems?: Item[];
  range: GanttRange;
  hint: (item: Item) => string;
  selectedItemId?: string | null;
  onOpen: (item: Item) => void;
  onSelect?: (item: Item) => void;
  onMove: (item: Item, delta: number, mode: DragMode, targetParent?: Item | null) => void;
  connecting?: ConnectingState | null;
  onConnect?: (item: Item) => void;
  onCreateRange?: (parent: Item, startDate: string, endDate: string) => void;
  themeColorKey?: string;
  resolveDropTarget?: (clientY: number) => Item | null | undefined;
  onCtrlClick?: (item: Item) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ itemId: string; mode: DragMode; dxPercent: number } | null>(null);
  const [rangeDraft, setRangeDraft] = useState<{ startPercent: number; widthPercent: number } | null>(null);
  const movedRef = useRef(false);
  const total = Math.max(1, daysBetween(range.start, range.end));
  const bars = laneItems?.length ? laneItems : [item];
  const lanes = assignGanttSubLanes(bars);
  const laneCount = Math.max(1, ...[...lanes.values()].map((lane) => lane + 1));
  const rowHeight = BASE_ROW_HEIGHT + Math.max(0, laneCount - 1) * LANE_STEP;

  function beginDrag(event: React.PointerEvent, target: Item, mode: DragMode) {
    event.preventDefault();
    event.stopPropagation();
    const initialX = event.clientX;
    const initialY = event.clientY;
    const trackWidth = rowRef.current?.clientWidth || 1;
    movedRef.current = false;
    onSelect?.(target);
    const onPointerMove = (moveEvent: PointerEvent) => {
      const dxPercent = ((moveEvent.clientX - initialX) / trackWidth) * 100;
      if (Math.abs(dxPercent) > 0.5 || Math.abs(moveEvent.clientY - initialY) > 6) movedRef.current = true;
      setDrag({ itemId: target.id, mode, dxPercent });
    };
    const cleanup = () => {
      removeEventListener("pointermove", onPointerMove);
      removeEventListener("pointerup", onPointerUp);
      removeEventListener("pointercancel", onPointerCancel);
      setDrag(null);
    };
    const onPointerUp = (upEvent: PointerEvent) => {
      cleanup();
      const delta = Math.round(((upEvent.clientX - initialX) / trackWidth) * total);
      if (!movedRef.current && !delta) return;
      const targetParent = resolveDropTarget?.(upEvent.clientY);
      if (delta || targetParent !== undefined) onMove(target, delta, mode, targetParent);
    };
    const onPointerCancel = () => {
      // キャンセル時は確定せず、プレビューだけ戻す（既存データを壊さない）。
      cleanup();
      movedRef.current = false;
    };
    addEventListener("pointermove", onPointerMove);
    addEventListener("pointerup", onPointerUp);
    addEventListener("pointercancel", onPointerCancel);
  }

  function beginRangeCreate(event: React.PointerEvent<HTMLDivElement>) {
    if (!onCreateRange || isConnecting || event.target !== event.currentTarget) return;
    event.preventDefault();
    const initialX = event.clientX;
    const trackWidth = rowRef.current?.clientWidth || 1;
    const startPercent = Math.max(0, Math.min(100, ((initialX - event.currentTarget.getBoundingClientRect().left) / trackWidth) * 100));
    setRangeDraft({ startPercent, widthPercent: Math.max(0.6, 100 / total) });
    const onPointerMove = (moveEvent: PointerEvent) => {
      const dxPercent = ((moveEvent.clientX - initialX) / trackWidth) * 100;
      const nextStart = Math.max(0, Math.min(100, dxPercent < 0 ? startPercent + dxPercent : startPercent));
      const nextWidth = Math.max(100 / total, Math.min(100 - nextStart, Math.abs(dxPercent)));
      setRangeDraft({ startPercent: nextStart, widthPercent: nextWidth });
    };
    const cleanup = () => {
      removeEventListener("pointermove", onPointerMove);
      removeEventListener("pointerup", onPointerUp);
      removeEventListener("pointercancel", onPointerCancel);
      setRangeDraft(null);
    };
    const onPointerUp = (upEvent: PointerEvent) => {
      const dxPercent = ((upEvent.clientX - initialX) / trackWidth) * 100;
      cleanup();
      const startDays = Math.round((Math.min(startPercent, startPercent + dxPercent) / 100) * total);
      const endDays = Math.round((Math.max(startPercent, startPercent + dxPercent) / 100) * total);
      onCreateRange(item, addDays(range.start, startDays), addDays(range.start, Math.max(startDays, endDays)));
    };
    const onPointerCancel = () => cleanup();
    addEventListener("pointermove", onPointerMove);
    addEventListener("pointerup", onPointerUp);
    addEventListener("pointercancel", onPointerCancel);
  }

  const isConnecting = !!connecting;

  function handleClick(target: Item, event?: React.MouseEvent) {
    if (movedRef.current) {
      movedRef.current = false;
      return;
    }
    if ((event?.ctrlKey || event?.metaKey) && onCtrlClick) {
      onCtrlClick(target);
      return;
    }
    if (isConnecting && onConnect) {
      onSelect?.(target);
      onConnect(target);
      return;
    }
    onSelect?.(target);
    onOpen(target);
  }

  return (
    <div className={`gantt-item-row level-${itemLevel(item)}`} ref={rowRef} onPointerDown={beginRangeCreate} style={{ height: rowHeight }}>
      {rangeDraft && (
        <span
          className="gantt-range-draft"
          style={{ left: `${rangeDraft.startPercent}%`, width: `${rangeDraft.widthPercent}%` }}
        />
      )}
      {bars.map((barItem) => {
        const level = itemLevel(barItem);
        const clipped = clippedBarRange(barItem, range);
        const start = clipped?.start || "";
        const end = clipped?.end || start;
        const left = start ? Math.max(0, Math.min(100, (daysBetween(range.start, start) / total) * 100)) : 0;
        const width = start
          ? Math.max(barItem.kind === "milestone" ? 0.8 : 1.4, Math.min(100 - left, ((daysBetween(start, end || start) + 1) / total) * 100))
          : 0;
        let displayLeft = left;
        let displayWidth = width;
        if (drag?.itemId === barItem.id) {
          if (drag.mode === "move") displayLeft = left + drag.dxPercent;
          else if (drag.mode === "start") { displayLeft = left + drag.dxPercent; displayWidth = width - drag.dxPercent; }
          else displayWidth = width + drag.dxPercent;
          displayWidth = Math.max(0.6, displayWidth);
        }
        const isSource = !!connecting?.sourceId && connecting.sourceId === barItem.id;
        const laneIndex = lanes.get(barItem.id) || 0;
        const barClass = [
          `gantt-item-bar level-${level}`,
          bars.length > 1 ? "in-lane" : "",
          barItem.kind === "milestone" ? "milestone" : "",
          drag?.itemId === barItem.id ? "is-dragging" : "",
          selectedItemId === barItem.id ? "is-selected" : "",
          isSource ? "is-connect-source" : "",
          isConnecting && !isSource ? "is-connect-target" : "",
        ].filter(Boolean).join(" ");
        return hasPlannedSchedule(barItem) && start ? (
          <button
            className={barClass}
            key={barItem.id}
            style={{ left: `${displayLeft}%`, width: `${displayWidth}%`, "--lane-index": laneIndex, "--bar-color": themeColorKey ? `var(--color-${themeColorKey})` : undefined } as React.CSSProperties}
            onClick={(e) => handleClick(barItem, e)}
            onPointerDown={isConnecting ? undefined : (event) => beginDrag(event, barItem, "move")}
            title={isConnecting ? (isSource ? `${barItem.title}（選択中）` : `${barItem.title} を後続にする`) : `${hint(barItem)}\nCtrl+クリックで依存を接続`}
          >
            {barItem.kind !== "milestone" && !isConnecting && <span className="resize-handle start" onPointerDown={(event) => beginDrag(event, barItem, "start")} />}
            <span>{barItem.kind === "milestone" ? "◆" : barItem.title}</span>
            {barItem.kind !== "milestone" && !isConnecting && <span className="resize-handle end" onPointerDown={(event) => beginDrag(event, barItem, "end")} />}
          </button>
        ) : null;
      })}
    </div>
  );
}

export function TimeAxis({ start, end, dayWidth }: { start: string; end: string; dayWidth: number }) {
  const marks = ganttTimeMarks(start, end, dayWidth);
  return (
    <div className="gantt-axis">
      {marks.map((mark) => (
        <span className={`gantt-axis-mark ${mark.kind}`} key={mark.date} style={{ left: `${mark.left}%` }}>
          {mark.label}
        </span>
      ))}
    </div>
  );
}

type GanttTimeMark = {
  date: string;
  label: string;
  left: number;
  kind: "day" | "week" | "month" | "quarter";
};

function markLeft(start: string, end: string, date: string): number {
  const total = Math.max(1, daysBetween(start, end));
  return Math.max(0, Math.min(100, (daysBetween(start, date) / total) * 100));
}

function pushMark(marks: GanttTimeMark[], start: string, end: string, date: string, kind: GanttTimeMark["kind"], label: string) {
  if (date < start || date > end) return;
  marks.push({ date, kind, label, left: markLeft(start, end, date) });
}

function ganttTimeMarks(start: string, end: string, dayWidth: number): GanttTimeMark[] {
  const marks: GanttTimeMark[] = [];
  const endDate = new Date(`${end}T00:00:00`);
  if (dayWidth >= 16) {
    const step = dayWidth >= 56 ? 1 : dayWidth >= 36 ? 7 : 14;
    const cursor = new Date(`${start}T00:00:00`);
    if (step > 1) {
      const dow = cursor.getDay();
      cursor.setTime(cursor.getTime() + ((dow === 0 ? 1 : 8 - dow) % 7) * DAY);
    }
    while (cursor <= endDate && marks.length < 500) {
      const date = localDateIso(cursor);
      const isMonth = cursor.getDate() === 1;
      const kind = isMonth ? (cursor.getMonth() % 3 === 0 ? "quarter" : "month") : step === 1 ? "day" : "week";
      const label = isMonth ? date.slice(0, 7) : date.slice(5);
      pushMark(marks, start, end, date, kind, label);
      cursor.setTime(cursor.getTime() + step * DAY);
    }
    return marks;
  }
  const cursor = new Date(`${start}T00:00:00`);
  cursor.setDate(1);
  while (cursor <= endDate && marks.length < 240) {
    const date = localDateIso(cursor);
    const kind = cursor.getMonth() % 3 === 0 ? "quarter" : "month";
    pushMark(marks, start, end, date, kind, date.slice(0, 7));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return marks;
}

export function ganttGridBackground(start: string, end: string, dayWidth: number): string {
  const marks = ganttTimeMarks(start, end, dayWidth);
  if (!marks.length) return "none";
  return marks.map((mark) => {
    const color = mark.kind === "quarter"
      ? "var(--color-border-strong)"
      : mark.kind === "month"
        ? "var(--color-border)"
        : "var(--color-border-subtle)";
    const width = mark.kind === "day" ? "0.5px" : "1px";
    return `linear-gradient(to right, transparent calc(${mark.left}% - ${width}), ${color} calc(${mark.left}% - ${width}), ${color} calc(${mark.left}% + ${width}), transparent calc(${mark.left}% + ${width}))`;
  }).join(", ");
}

function milestoneDate(item: Item): string {
  return String(item.planned_end || item.due_date || item.planned_start || "");
}

function milestoneLabel(item: Item, dayWidth: number): string {
  if (dayWidth < 6) return item.title.length > 10 ? `${item.title.slice(0, 10)}...` : item.title;
  return item.title;
}

export function MilestoneLane({
  milestones,
  range,
  dayWidth,
  hint,
  onOpen,
  onMove,
  onCreateMilestone,
  themeColorKey,
}: {
  milestones: Item[];
  range: GanttRange;
  dayWidth: number;
  hint: (item: Item) => string;
  onOpen: (item: Item) => void;
  onMove?: (item: Item, delta: number) => void;
  onCreateMilestone?: (date: string) => void;
  themeColorKey?: string;
}) {
  const laneRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ itemId: string; dxPercent: number } | null>(null);
  const movedRef = useRef(false);
  const total = Math.max(1, daysBetween(range.start, range.end));

  function dateFromClientX(clientX: number): string | null {
    const rect = laneRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const offset = Math.max(0, Math.min(total, Math.round(((clientX - rect.left) / Math.max(1, rect.width)) * total)));
    return addDays(range.start, offset);
  }

  function createMilestoneAt(event: React.PointerEvent<HTMLDivElement>) {
    if (!onCreateMilestone || event.target !== event.currentTarget) return;
    const date = dateFromClientX(event.clientX);
    if (date && date >= range.start && date <= range.end) onCreateMilestone(date);
  }

  function beginDrag(event: React.PointerEvent, target: Item) {
    if (!onMove) return;
    event.preventDefault();
    event.stopPropagation();
    const initialX = event.clientX;
    const trackWidth = laneRef.current?.clientWidth || 1;
    movedRef.current = false;
    const onPointerMove = (moveEvent: PointerEvent) => {
      const dxPercent = ((moveEvent.clientX - initialX) / trackWidth) * 100;
      if (Math.abs(dxPercent) > 0.5) movedRef.current = true;
      setDrag({ itemId: target.id, dxPercent });
    };
    const cleanup = () => {
      removeEventListener("pointermove", onPointerMove);
      removeEventListener("pointerup", onPointerUp);
      removeEventListener("pointercancel", onPointerCancel);
      setDrag(null);
    };
    const onPointerUp = (upEvent: PointerEvent) => {
      cleanup();
      const delta = Math.round(((upEvent.clientX - initialX) / trackWidth) * total);
      if (delta) onMove(target, delta);
    };
    const onPointerCancel = () => {
      cleanup();
      movedRef.current = false;
    };
    addEventListener("pointermove", onPointerMove);
    addEventListener("pointerup", onPointerUp);
    addEventListener("pointercancel", onPointerCancel);
  }

  const byMonth = new Map<string, Item[]>();
  for (const milestone of milestones) {
    const date = milestoneDate(milestone);
    if (!date) continue;
    const key = date.slice(0, 7);
    byMonth.set(key, [...(byMonth.get(key) || []), milestone]);
  }
  const marks = [...byMonth.entries()].flatMap(([month, entries]) => {
    if (entries.length >= 3) return [{ id: month, items: entries, date: `${month}-15` }];
    return entries.map((item) => ({ id: item.id, items: [item], date: milestoneDate(item) }));
  });

  return (
    <div className="gantt-milestone-lane" ref={laneRef} onPointerUp={createMilestoneAt} title="空白をクリックしてマイルストーンを追加">
      {marks.map((mark) => {
        if (mark.date < range.start || mark.date > range.end) return null;
        const baseLeft = Math.max(0, Math.min(100, (daysBetween(range.start, mark.date) / total) * 100));
        const first = mark.items[0];
        const clustered = mark.items.length > 1;
        const isDragging = !clustered && drag?.itemId === first.id;
        const displayLeft = isDragging ? baseLeft + drag!.dxPercent : baseLeft;
        const title = clustered
          ? mark.items.map((item) => `${milestoneDate(item)} ${item.title}`).join("\n")
          : hint(first);
        return (
          <button
            className={`milestone-lane-mark ${clustered ? "is-cluster" : ""} ${isDragging ? "is-dragging" : ""}`}
            key={mark.id}
            style={{ left: `${displayLeft}%`, "--bar-color": themeColorKey ? `var(--color-${themeColorKey})` : undefined } as React.CSSProperties}
            onClick={() => { if (!movedRef.current) onOpen(first); movedRef.current = false; }}
            onPointerDown={clustered ? (event) => event.stopPropagation() : (event) => beginDrag(event, first)}
            title={title}
          >
            <span>{clustered ? `◆${mark.items.length}` : "◆"}</span>
            <small>{clustered ? mark.id : milestoneLabel(first, dayWidth)}</small>
          </button>
        );
      })}
    </div>
  );
}

type ItemRow = Extract<TimelineRow, { rowType: "item" }>;

function rowItems(row: TimelineRow): Item[] {
  if (row.rowType !== "item") return [];
  return row.laneItems.length ? row.laneItems : [row.item];
}

function timelineRowHeight(row: TimelineRow): number {
  if (row.rowType === "item") return ganttRowHeight(rowItems(row));
  return BASE_ROW_HEIGHT;
}

function rowTopOffsets(rows: TimelineRow[]): number[] {
  const offsets: number[] = [];
  let top = 0;
  for (const row of rows) {
    offsets.push(top);
    top += timelineRowHeight(row);
  }
  return offsets;
}

export function DependencyOverlay({
  dependencies,
  rows,
  range,
  selected,
  onSelect,
}: {
  dependencies: Dependency[];
  rows: TimelineRow[];
  range: GanttRange;
  selected?: SelectedDependency | null;
  onSelect?: (sel: SelectedDependency | null) => void;
}) {
  const total = Math.max(1, daysBetween(range.start, range.end));
  const rowTops = rowTopOffsets(rows);
  const rowIndexOf = (id?: string) => rows.findIndex((row) => row.rowType === "item" && (row.item.id === id || row.laneItems.some((item) => item.id === id)));
  const lines = dependencies.flatMap((dependency) => {
    const sourceItemId = str(dependency.source_item_id);
    const targetItemId = str(dependency.target_item_id);
    const sourceIndex = rowIndexOf(sourceItemId);
    const targetIndex = rowIndexOf(targetItemId);
    if (sourceIndex < 0 || targetIndex < 0) return [];
    const sourceRow = rows[sourceIndex] as ItemRow;
    const targetRow = rows[targetIndex] as ItemRow;
    const source = sourceRow.item.id === sourceItemId ? sourceRow.item : sourceRow.laneItems.find((item) => item.id === sourceItemId) || sourceRow.item;
    const target = targetRow.item.id === targetItemId ? targetRow.item : targetRow.laneItems.find((item) => item.id === targetItemId) || targetRow.item;
    const sourceDate = source.planned_end;
    const targetDate = target.planned_start || target.planned_end;
    if (!sourceDate || !targetDate) return [];
    if (sourceDate < range.start || sourceDate > range.end || targetDate < range.start || targetDate > range.end) return [];
    const sourceX = Math.max(0, Math.min(100, ((daysBetween(range.start, sourceDate) + 1) / total) * 100));
    const targetX = Math.max(0, Math.min(100, (daysBetween(range.start, targetDate) / total) * 100));
    const sourceY = rowTops[sourceIndex] + ganttBarCenterY(rowItems(sourceRow), source.id);
    const targetY = rowTops[targetIndex] + ganttBarCenterY(rowItems(targetRow), target.id);
    const dayPercent = 100 / total;
    const preferredBend = sourceX + Math.max(dayPercent * 2, 0.9);
    const targetSide = targetX >= sourceX ? targetX - Math.max(dayPercent, 0.6) : targetX + Math.max(dayPercent, 0.6);
    const bendX = targetX >= sourceX
      ? Math.min(Math.max(preferredBend, sourceX + 0.6), Math.max(sourceX + 0.6, targetSide))
      : Math.max(Math.min(sourceX - Math.max(dayPercent * 2, 0.9), sourceX - 0.6), Math.min(sourceX - 0.6, targetSide));
    return [{ id: dependency.id, sourceX, sourceY, targetX, targetY, bendX, sourceTitle: source.title, targetTitle: target.title, dependency }];
  });
  if (!lines.length) return null;
  const height = rows.reduce((sum, row) => sum + timelineRowHeight(row), 0);
  return (
    <svg className="dependency-overlay" viewBox={`0 0 100 ${height}`} style={{ height }} preserveAspectRatio="none">
      <defs>
        <marker id="dependency-arrow" markerWidth="5" markerHeight="5" refX="4.4" refY="2.5" orient="auto">
          <path d="M0,0 L5,2.5 L0,5 Z" />
        </marker>
        <marker id="dependency-arrow-selected" markerWidth="5" markerHeight="5" refX="4.4" refY="2.5" orient="auto">
          <path d="M0,0 L5,2.5 L0,5 Z" className="dep-selected-marker" />
        </marker>
      </defs>
      {lines.map((line) => {
        const isSelected = selected?.dependency.id === line.id;
        const d = `M ${line.sourceX} ${line.sourceY} H ${line.bendX} V ${line.targetY} H ${line.targetX}`;
        return (
          <g key={line.id}>
            {/* 太めの透明ヒットエリア */}
            <path
              d={d}
              className="dep-hit-area"
              onClick={(event) => {
                event.stopPropagation();
                onSelect?.(isSelected ? null : { dependency: line.dependency, sourceTitle: line.sourceTitle, targetTitle: line.targetTitle });
              }}
            >
              <title>{`${line.sourceTitle} → ${line.targetTitle}`}</title>
            </path>
            <path
              d={d}
              className={isSelected ? "dep-line dep-line-selected" : "dep-line"}
              markerEnd={isSelected ? "url(#dependency-arrow-selected)" : "url(#dependency-arrow)"}
            />
          </g>
        );
      })}
    </svg>
  );
}

export function LightningOverlay({
  rows,
  range,
  today,
}: {
  rows: TimelineRow[];
  range: GanttRange;
  today: string;
}) {
  const totalDays = Math.max(1, daysBetween(range.start, range.end));
  const todayX = (daysBetween(range.start, today) / totalDays) * 100;
  const points = rows.flatMap((row, index) => {
    if (row.rowType !== "item") return [];
    const item = row.laneItems[0] || row.item;
    const start = item.planned_start || item.planned_end;
    const end = item.planned_end || start;
    if (!start || !end || !hasPlannedSchedule(item)) return [];
    if (end < range.start || start > range.end) return [];
    const duration = Math.max(1, daysBetween(start, end) + 1);
    const elapsed = Math.max(0, Math.min(duration, daysBetween(start, today) + 1));
    const plannedProgress = elapsed / duration;
    const actualProgress = isInProgressStatus(item.status) ? plannedProgress : statusProgress(item.status);
    const varianceDays = (actualProgress - plannedProgress) * duration;
    const x = Math.max(0, Math.min(100, todayX + (varianceDays / totalDays) * 100));
    const top = rows.slice(0, index).reduce((sum, entry) => sum + timelineRowHeight(entry), 0);
    return [{ x, y: BASE_ROW_HEIGHT + top + ganttBarCenterY(rowItems(row), item.id), varianceDays }];
  });
  if (!points.length) return null;
  const height = Math.max(88, rows.reduce((sum, row) => sum + timelineRowHeight(row), BASE_ROW_HEIGHT));
  const path = points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  return (
    <svg className="lightning-overlay" viewBox={`0 0 100 ${height}`} style={{ height }} preserveAspectRatio="none" aria-label="計画進捗と実進捗の差分">
      <path d={path} />
    </svg>
  );
}
