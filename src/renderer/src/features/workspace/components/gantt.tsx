import { useEffect, useRef, useState } from "react";

import type { BaseRecord, Item } from "../types";

type Dependency = BaseRecord;
import { DAY, hasPlannedSchedule, itemLevel, statusProgress } from "../lib/domain";
import { daysBetween, localDateIso, str } from "../lib/format";
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

export interface ConnectingState {
  sourceId: string;
  sourceTitle: string;
}

export function GanttItemRow({
  item,
  laneItems,
  range,
  hint,
  onOpen,
  onMove,
  connecting,
  onConnect,
  themeColorKey,
  resolveDropTarget,
  onCtrlClick,
}: {
  item: Item;
  laneItems?: Item[];
  range: GanttRange;
  hint: (item: Item) => string;
  onOpen: (item: Item) => void;
  onMove: (item: Item, delta: number, mode: DragMode, targetParent?: Item | null) => void;
  connecting?: ConnectingState | null;
  onConnect?: (item: Item) => void;
  themeColorKey?: string;
  resolveDropTarget?: (clientY: number) => Item | null | undefined;
  onCtrlClick?: (item: Item) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ itemId: string; mode: DragMode; dxPercent: number } | null>(null);
  const movedRef = useRef(false);
  const total = Math.max(1, daysBetween(range.start, range.end));
  const bars = laneItems?.length ? laneItems : [item];

  function beginDrag(event: React.PointerEvent, target: Item, mode: DragMode) {
    event.preventDefault();
    event.stopPropagation();
    const initialX = event.clientX;
    const initialY = event.clientY;
    const trackWidth = rowRef.current?.clientWidth || 1;
    movedRef.current = false;
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
      onConnect(target);
      return;
    }
    onOpen(target);
  }

  return (
    <div className={`gantt-item-row level-${itemLevel(item)}`} ref={rowRef}>
      {bars.map((barItem) => {
        const level = itemLevel(barItem);
        const start = barItem.planned_start || barItem.planned_end;
        const end = barItem.planned_end || start;
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
        const barClass = [
          `gantt-item-bar level-${level}`,
          bars.length > 1 ? "in-lane" : "",
          barItem.kind === "milestone" ? "milestone" : "",
          drag?.itemId === barItem.id ? "is-dragging" : "",
          isSource ? "is-connect-source" : "",
          isConnecting && !isSource ? "is-connect-target" : "",
        ].filter(Boolean).join(" ");
        return hasPlannedSchedule(barItem) && start ? (
          <button
            className={barClass}
            key={barItem.id}
            style={{ left: `${displayLeft}%`, width: `${displayWidth}%`, "--bar-color": themeColorKey ? `var(--color-${themeColorKey})` : undefined } as React.CSSProperties}
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
  if (dayWidth >= 16) {
    const blocks: string[] = [];
    const cursor = new Date(`${start}T00:00:00`);
    const last = new Date(`${end}T00:00:00`);
    const step = dayWidth >= 36 ? 7 : 14;
    const dow = cursor.getDay();
    cursor.setTime(cursor.getTime() + ((dow === 0 ? 1 : 8 - dow) % 7) * DAY);
    while (cursor <= last && blocks.length < 400) {
      blocks.push(localDateIso(cursor));
      cursor.setTime(cursor.getTime() + step * DAY);
    }
    return (
      <div className="gantt-axis" style={{ gridTemplateColumns: `repeat(${blocks.length}, 1fr)` }}>
        {blocks.map((value) => <span key={value}>{value.slice(5)}</span>)}
      </div>
    );
  }
  const blocks: { label: string; days: number }[] = [];
  let cursor = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  while (cursor < endDate && blocks.length < 200) {
    const nextMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    const segmentEnd = nextMonth <= endDate ? nextMonth : endDate;
    const days = Math.round((segmentEnd.getTime() - cursor.getTime()) / DAY);
    if (days > 0) blocks.push({ label: localDateIso(cursor).slice(0, 7), days });
    cursor = nextMonth;
  }
  return (
    <div className="gantt-axis" style={{ gridTemplateColumns: blocks.map((b) => `${b.days}fr`).join(" ") }}>
      {blocks.map((b) => <span key={b.label}>{b.label}</span>)}
    </div>
  );
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
  themeColorKey,
}: {
  milestones: Item[];
  range: GanttRange;
  dayWidth: number;
  hint: (item: Item) => string;
  onOpen: (item: Item) => void;
  onMove?: (item: Item, delta: number) => void;
  themeColorKey?: string;
}) {
  const laneRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ itemId: string; dxPercent: number } | null>(null);
  const movedRef = useRef(false);
  const total = Math.max(1, daysBetween(range.start, range.end));

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
    <div className="gantt-milestone-lane" ref={laneRef}>
      {marks.map((mark) => {
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
            onPointerDown={clustered ? undefined : (event) => beginDrag(event, first)}
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
  const ROW_H = 44;
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
    const sourceX = Math.max(0, Math.min(100, ((daysBetween(range.start, sourceDate) + 1) / total) * 100));
    const targetX = Math.max(0, Math.min(100, (daysBetween(range.start, targetDate) / total) * 100));
    const sourceY = sourceIndex * ROW_H + ROW_H / 2;
    const targetY = targetIndex * ROW_H + ROW_H / 2;
    const bendX = Math.max(sourceX + 1.5, (sourceX + targetX) / 2);
    return [{ id: dependency.id, sourceX, sourceY, targetX, targetY, bendX, sourceTitle: source.title, targetTitle: target.title, dependency }];
  });
  if (!lines.length) return null;
  const height = rows.length * ROW_H;
  return (
    <svg className="dependency-overlay" viewBox={`0 0 100 ${height}`} style={{ height }} preserveAspectRatio="none">
      <defs>
        <marker id="dependency-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 Z" />
        </marker>
        <marker id="dependency-arrow-selected" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 Z" className="dep-selected-marker" />
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
    const duration = Math.max(1, daysBetween(start, end) + 1);
    const elapsed = Math.max(0, Math.min(duration, daysBetween(start, today) + 1));
    const plannedProgress = elapsed / duration;
    const actualProgress = isInProgressStatus(item.status) ? plannedProgress : statusProgress(item.status);
    const varianceDays = (actualProgress - plannedProgress) * duration;
    const x = Math.max(0, Math.min(100, todayX + (varianceDays / totalDays) * 100));
    return [{ x, y: 44 + index * 44 + 22, varianceDays }];
  });
  if (!points.length) return null;
  const height = Math.max(88, rows.length * 44 + 44);
  const path = points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  return (
    <svg className="lightning-overlay" viewBox={`0 0 100 ${height}`} style={{ height }} preserveAspectRatio="none" aria-label="計画進捗と実進捗の差分">
      <path d={path} />
    </svg>
  );
}
