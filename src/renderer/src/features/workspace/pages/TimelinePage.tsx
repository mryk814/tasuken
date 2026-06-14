import { useRef, useState } from "react";

import { todayIso } from "../../../utils/dataFormat.js";
import type { Item, PageProps } from "../types";
import { STATUS_LABELS, itemLevel } from "../lib/domain";
import { addDays, daysBetween, formatDate } from "../lib/format";
import { buildTimelineRows, ganttRange, ganttWidth } from "../lib/timeline";
import { DependencyOverlay, GanttItemRow, LightningOverlay, TimeAxis } from "../components/gantt";
import { PageHeader, StatusBadge } from "../components/common";

type DragMode = "move" | "start" | "end";

export function TimelinePage({ data, themes, items, openDrawer, saveEntity, setToast, navigate }: PageProps) {
  const [scale, setScale] = useState("quarter");
  const [themeFilter, setThemeFilter] = useState("all");
  const [showCompleted, setShowCompleted] = useState(false);
  const [showDependencies, setShowDependencies] = useState(true);
  const [showLightning, setShowLightning] = useState(false);
  const [showTasks, setShowTasks] = useState(false);
  const [collapsedThemes, setCollapsedThemes] = useState<string[]>([]);
  const [collapsedItems, setCollapsedItems] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const today = todayIso();
  const range = ganttRange(scale, today);
  const timelineItems = items.filter((item) => {
    if (!showCompleted && item.status === "done") return false;
    if (themeFilter !== "all" && item.theme_id !== themeFilter) return false;
    return true;
  });
  const rows = buildTimelineRows({ items: timelineItems, themes, showTasks, collapsedThemes, collapsedItems });
  const groupKeys = rows.filter((row) => row.rowType === "theme").map((row) => (row as Extract<typeof row, { rowType: "theme" }>).groupKey);
  const days = Math.max(1, daysBetween(range.start, range.end));
  const todayLeft = (daysBetween(range.start, today) / days) * 100;

  function scrollToday() {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollLeft = Math.max(0, (element.scrollWidth * todayLeft) / 100 - element.clientWidth / 2);
  }

  async function moveItem(item: Item, delta: number, mode: DragMode = "move") {
    if (!delta || item.schedule_status === "unscheduled") return;
    const next: Item = { ...item };
    if (mode === "start") next.planned_start = addDays(item.planned_start, delta);
    else if (mode === "end") next.planned_end = addDays(item.planned_end, delta);
    else {
      next.planned_start = addDays(item.planned_start, delta);
      next.planned_end = addDays(item.planned_end, delta);
      if (item.due_date) next.due_date = addDays(item.due_date, delta);
    }
    if (next.planned_start && next.planned_end && next.planned_end < next.planned_start) {
      setToast("開始日と終了日の順序が逆になるため変更しませんでした。");
      return;
    }
    await saveEntity("item", next);
  }

  return (
    <div className="page timeline-wide">
      <PageHeader title="Timeline" subtitle="テーマ別レーンで計画（期間・マイルストーン）を俯瞰します。細かいタスクは「タスクを表示」で展開します。">
        <button className="secondary-button" onClick={scrollToday}>今日へ移動</button>
        <button className="secondary-button" onClick={() => navigate("milestones")}>マイルストーン</button>
        <button className="primary-button" onClick={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "period", schedule_status: "scheduled" } })}>期間予定を追加</button>
      </PageHeader>
      <section className="timeline-toolbar panel">
        <label>Theme<select value={themeFilter} onChange={(event) => setThemeFilter(event.target.value)}><option value="all">すべて</option>{themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</select></label>
        <div className="segmented">{[["year", "年間"], ["half", "半年"], ["quarter", "四半期"], ["month", "月間"], ["week", "週間"]].map(([id, label]) => <button key={id} className={scale === id ? "is-active" : ""} onClick={() => setScale(id)}>{label}</button>)}</div>
        <label className="toggle"><input type="checkbox" checked={showTasks} onChange={(event) => setShowTasks(event.target.checked)} />タスクを表示</label>
        <label className="toggle"><input type="checkbox" checked={showCompleted} onChange={(event) => setShowCompleted(event.target.checked)} />完了Item</label>
        <label className="toggle"><input type="checkbox" checked={showDependencies} onChange={(event) => setShowDependencies(event.target.checked)} />依存線</label>
        <label className="toggle"><input type="checkbox" checked={showLightning} onChange={(event) => setShowLightning(event.target.checked)} />イナズマ線</label>
        <button className="secondary-button compact" onClick={() => { setCollapsedThemes([]); setCollapsedItems([]); }}>全展開</button>
        <button className="secondary-button compact" onClick={() => setCollapsedThemes(groupKeys)}>全折りたたみ</button>
      </section>
      <section className="split-gantt panel">
        <div className="gantt-table">
          <div className="gantt-table-head"><span>Item</span><span>状態</span><span>開始</span><span>終了</span><span>進捗</span></div>
          {rows.map((row) => {
            if (row.rowType === "theme") {
              const collapsed = collapsedThemes.includes(row.groupKey);
              return (
                <div className="gantt-theme-row" key={`theme-${row.groupKey}`}>
                  <button className="gantt-theme-toggle" onClick={() => setCollapsedThemes((current) => current.includes(row.groupKey) ? current.filter((key) => key !== row.groupKey) : [...current, row.groupKey])} aria-expanded={!collapsed}>
                    <span className="gantt-theme-caret">{collapsed ? "＋" : "−"}</span>
                    <strong>{row.theme?.name || "個人業務 / Themeなし"}</strong>
                    {row.theme && <StatusBadge value={row.theme.status} label={row.theme.status} />}
                  </button>
                  <span className="gantt-theme-count">計画 {row.planCount} / タスク {row.taskCount}</span>
                </div>
              );
            }
            const { item, depth, hasChildren } = row;
            return (
              <div className={`gantt-table-row level-${itemLevel(item)}`} key={item.id}>
                <button className="gantt-name" style={{ paddingLeft: `calc(var(--space-2) + ${depth * 14}px)` }} onClick={() => openDrawer({ type: "item", entity: item })}>
                  {hasChildren
                    ? <span onClick={(event) => { event.stopPropagation(); setCollapsedItems((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]); }}>{collapsedItems.includes(item.id) ? "＋" : "−"}</span>
                    : item.kind === "milestone" && <span className="gantt-milestone-mark">◆</span>}
                  {item.title}
                </button>
                <StatusBadge value={item.status} label={STATUS_LABELS[item.status ?? ""]} />
                <span className="num">{formatDate(item.planned_start)}</span>
                <span className="num">{formatDate(item.planned_end)}</span>
                <span className="num">{item.progress || 0}%</span>
              </div>
            );
          })}
        </div>
        <div className="gantt-scroll" ref={scrollRef}>
          <div className="gantt-canvas" style={{ minWidth: ganttWidth(scale) }}>
            <TimeAxis start={range.start} end={range.end} scale={scale} />
            <div className="gantt-today" style={{ left: `${todayLeft}%` }}><span>今日</span></div>
            {rows.map((row) => row.rowType === "theme"
              ? <div className="gantt-canvas-theme-row" key={`theme-${row.groupKey}`} />
              : <GanttItemRow key={row.item.id} item={row.item} range={range} onOpen={() => openDrawer({ type: "item", entity: row.item })} onMove={moveItem} />)}
            {showDependencies && <DependencyOverlay dependencies={data.dependencys || []} rows={rows} range={range} />}
            {showLightning && <LightningOverlay rows={rows} range={range} today={today} />}
          </div>
        </div>
      </section>
      <div className="timeline-legend"><span><i className="legend-solid" />計画（期間）</span><span><i className="legend-diamond" />マイルストーン</span><span><i className="legend-task" />タスク</span><span><i className="legend-lightning" />実進捗の到達日</span><span>日程未確定は左表のみ</span></div>
    </div>
  );
}
