import { useEffect, useRef, useState } from "react";

import type { Dependency, Item } from "../types";
import { DAY, hasPlannedSchedule, itemLevel, statusProgress } from "../lib/domain";
import { daysBetween } from "../lib/format";
import type { GanttRange, TimelineRow } from "../lib/timeline";

export interface SelectedDependency {
  dependency: Dependency;
  sourceTitle: string;
  targetTitle: string;
}

type DragMode = "move" | "start" | "end";

export interface ConnectingState {
  sourceId: string;
  sourceTitle: string;
}

export function GanttItemRow({
  item,
  range,
  hint,
  onOpen,
  onMove,
  connecting,
  onConnect,
  themeColorKey,
}: {
  item: Item;
  range: GanttRange;
  hint: string;
  onOpen: () => void;
  onMove: (item: Item, delta: number, mode: DragMode) => void;
  connecting?: ConnectingState | null;
  onConnect?: (item: Item) => void;
  themeColorKey?: string;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const movedRef = useRef(false);
  const [drag, setDrag] = useState<{ mode: DragMode; dxPercent: number } | null>(null);
  const level = itemLevel(item);
  const start = item.planned_start || item.planned_end;
  const end = item.planned_end || start;
  const total = Math.max(1, daysBetween(range.start, range.end));
  const left = start ? Math.max(0, Math.min(100, (daysBetween(range.start, start) / total) * 100)) : 0;
  const width = start
    ? Math.max(item.kind === "milestone" ? 0.8 : 1.4, Math.min(100 - left, ((daysBetween(start, end || start) + 1) / total) * 100))
    : 0;

  // ドラッグ確定は離した瞬間に日単位でスナップする一方、移動中はライブで位置/幅をプレビューする。
  let displayLeft = left;
  let displayWidth = width;
  if (drag) {
    if (drag.mode === "move") displayLeft = left + drag.dxPercent;
    else if (drag.mode === "start") { displayLeft = left + drag.dxPercent; displayWidth = width - drag.dxPercent; }
    else displayWidth = width + drag.dxPercent;
    displayWidth = Math.max(0.6, displayWidth);
  }

  function beginDrag(event: React.PointerEvent, mode: DragMode) {
    event.preventDefault();
    event.stopPropagation();
    const initialX = event.clientX;
    const trackWidth = rowRef.current?.clientWidth || 1;
    movedRef.current = false;
    const onPointerMove = (moveEvent: PointerEvent) => {
      const dxPercent = ((moveEvent.clientX - initialX) / trackWidth) * 100;
      if (Math.abs(dxPercent) > 0.5) movedRef.current = true;
      setDrag({ mode, dxPercent });
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
      if (delta) onMove(item, delta, mode);
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

  const isSource = !!connecting?.sourceId && connecting.sourceId === item.id;
  const isConnecting = !!connecting;

  function handleClick() {
    if (movedRef.current) {
      movedRef.current = false;
      return;
    }
    if (isConnecting && onConnect) {
      onConnect(item);
      return;
    }
    onOpen();
  }

  const barClass = [
    `gantt-item-bar level-${level}`,
    item.kind === "milestone" ? "milestone" : "",
    drag ? "is-dragging" : "",
    isSource ? "is-connect-source" : "",
    isConnecting && !isSource ? "is-connect-target" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={`gantt-item-row level-${level}`} ref={rowRef}>
      {hasPlannedSchedule(item) && start && (
        <button
          className={barClass}
          style={{ left: `${displayLeft}%`, width: `${displayWidth}%`, "--bar-color": themeColorKey ? `var(--color-${themeColorKey})` : undefined } as React.CSSProperties}
          onClick={handleClick}
          onPointerDown={isConnecting ? undefined : (event) => beginDrag(event, "move")}
          title={isConnecting ? (isSource ? `${item.title}（選択中）` : connecting?.sourceId ? `${item.title} を後続にする` : `${item.title} を先行にする`) : hint}
        >
          {item.kind !== "milestone" && !isConnecting && <span className="resize-handle start" onPointerDown={(event) => beginDrag(event, "start")} />}
          <span>{item.kind === "milestone" ? "◆" : item.title}</span>
          {item.kind !== "milestone" && !isConnecting && <span className="resize-handle end" onPointerDown={(event) => beginDrag(event, "end")} />}
        </button>
      )}
    </div>
  );
}

export function TimeAxis({ start, end, scale }: { start: string; end: string; scale: string }) {
  const blocks: string[] = [];
  let cursor = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  const step = scale === "week" ? 1 : scale === "month" ? 7 : 30;
  while (cursor <= last && blocks.length < 60) {
    blocks.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + step * DAY);
  }
  return (
    <div className="gantt-axis" style={{ gridTemplateColumns: `repeat(${blocks.length}, 1fr)` }}>
      {blocks.map((value) => <span key={value}>{scale === "week" ? value.slice(5) : value.slice(0, 7)}</span>)}
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
  const rowIndexOf = (id?: string) => rows.findIndex((row) => row.rowType === "item" && row.item.id === id);
  const lines = dependencies.flatMap((dependency) => {
    const sourceIndex = rowIndexOf(dependency.source_item_id);
    const targetIndex = rowIndexOf(dependency.target_item_id);
    if (sourceIndex < 0 || targetIndex < 0) return [];
    const source = (rows[sourceIndex] as ItemRow).item;
    const target = (rows[targetIndex] as ItemRow).item;
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

export function LightningOverlay({ rows, range, today }: { rows: TimelineRow[]; range: GanttRange; today: string }) {
  const totalDays = Math.max(1, daysBetween(range.start, range.end));
  const todayX = (daysBetween(range.start, today) / totalDays) * 1000;
  const points = rows.flatMap((row, index) => {
    if (row.rowType !== "item") return [];
    const item = row.item;
    const start = item.planned_start || item.planned_end;
    const end = item.planned_end || start;
    if (!start || !end || !hasPlannedSchedule(item)) return [];
    const duration = Math.max(1, daysBetween(start, end) + 1);
    const elapsed = Math.max(0, Math.min(duration, daysBetween(start, today) + 1));
    const plannedProgress = elapsed / duration;
    const actualProgress = statusProgress(item.status);
    const varianceDays = (actualProgress - plannedProgress) * duration;
    const x = Math.max(0, Math.min(1000, todayX + (varianceDays / totalDays) * 1000));
    return [{ x, y: 44 + index * 44 + 22, varianceDays }];
  });
  if (!points.length) return null;
  const path = points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  return (
    <svg className="lightning-overlay" viewBox={`0 0 1000 ${Math.max(88, rows.length * 44 + 44)}`} preserveAspectRatio="none" aria-label="計画進捗と実進捗の差分">
      <path d={path} />
      {points.map((point, index) => <circle key={`${point.x}-${point.y}-${index}`} cx={point.x} cy={point.y} r="4" />)}
    </svg>
  );
}
