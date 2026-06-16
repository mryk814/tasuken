import { useCallback, useEffect, useRef, useState } from "react";

import { todayIso } from "../../../utils/dataFormat.js";
import { usePersistentState } from "../../../utils/usePersistentState";
import type { Item, PageProps } from "../types";
import { STATUS_LABELS, hasPlannedSchedule, itemLevel, themeColor } from "../lib/domain";
import { addDays, daysBetween, formatDate, uuid } from "../lib/format";
import { buildTimelineRows, ganttRange } from "../lib/timeline";
import { type ConnectingState, type SelectedDependency, DependencyOverlay, GanttItemRow, LightningOverlay, TimeAxis } from "../components/gantt";
import { PageHeader, StatusBadge } from "../components/common";

type DragMode = "move" | "start" | "end";

// 表示トグル・スケールはUI設定としてlocalStorageに記憶し、次回も同じ表示で開く。
// 完了Item・依存線・イナズマ線は既定ON。
interface TimelinePrefs {
  scale: string;
  themeFilter: string;
  showCompleted: boolean;
  showDependencies: boolean;
  showLightning: boolean;
  showTasks: boolean;
}
const DEFAULT_PREFS: TimelinePrefs = {
  scale: "quarter",
  themeFilter: "all",
  showCompleted: true,
  showDependencies: true,
  showLightning: true,
  showTasks: false,
};

export function TimelinePage({ data, themes, items, openDrawer, saveEntity, removeEntity, setToast, navigate }: PageProps) {
  const [prefs, setPrefs] = usePersistentState<TimelinePrefs>("timeline:prefs", DEFAULT_PREFS);
  const { scale, themeFilter, showCompleted, showDependencies, showLightning, showTasks } = prefs;
  const updatePrefs = (patch: Partial<TimelinePrefs>) => setPrefs((current) => ({ ...current, ...patch }));
  const [collapsedThemes, setCollapsedThemes] = useState<string[]>([]);
  const [collapsedItems, setCollapsedItems] = useState<string[]>([]);
  const [connecting, setConnecting] = useState<ConnectingState | null>(null);
  const [selectedDep, setSelectedDep] = useState<SelectedDependency | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const today = todayIso();

  useEffect(() => {
    if (!connecting && !selectedDep) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setConnecting(null);
        setSelectedDep(null);
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedDep) {
        event.preventDefault();
        void deleteDependency(selectedDep);
      }
    };
    addEventListener("keydown", onKeyDown);
    return () => removeEventListener("keydown", onKeyDown);
  }, [connecting, selectedDep]);

  async function deleteDependency(sel: SelectedDependency) {
    try {
      await removeEntity("dependency", sel.dependency);
    } catch {
      // removeEntity already shows error toast
    }
    setSelectedDep(null);
  }

  const handleConnect = useCallback(async (target: Item) => {
    if (!connecting) return;
    if (target.id === connecting.sourceId) {
      setConnecting(null);
      return;
    }
    const exists = (data.dependencys || []).some(
      (d) => d.source_item_id === connecting.sourceId && d.target_item_id === target.id,
    );
    if (exists) {
      setToast("この依存関係はすでに登録されています。");
      setConnecting(null);
      return;
    }
    try {
      await saveEntity("dependency", {
        id: uuid(),
        source_item_id: connecting.sourceId,
        target_item_id: target.id,
        dependency_type: "finish_to_start",
      });
      setToast(`依存を追加: ${connecting.sourceTitle} → ${target.title}`);
    } catch {
      // saveEntity already shows error toast
    }
    setConnecting(null);
  }, [connecting, data.dependencys, saveEntity, setToast]);

  function startConnecting(item: Item) {
    if (!connecting) return;
    if (!connecting.sourceId) {
      setConnecting({ sourceId: item.id, sourceTitle: item.title });
    } else {
      handleConnect(item);
    }
  }
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

  function dateHint(item: Item): string {
    if (!hasPlannedSchedule(item)) return `${item.title}（予定なし）`;
    const span = `${formatDate(item.planned_start)} 〜 ${formatDate(item.planned_end)}`;
    return `${item.title}\n${span}`;
  }

  function scrollToday() {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollLeft = Math.max(0, (element.scrollWidth * todayLeft) / 100 - element.clientWidth / 2);
  }

  async function moveItem(item: Item, delta: number, mode: DragMode = "move") {
    if (!delta || !hasPlannedSchedule(item)) return;
    const next: Item = { ...item };
    if (mode === "start") next.planned_start = addDays(item.planned_start, delta);
    else if (mode === "end") next.planned_end = addDays(item.planned_end, delta);
    else {
      next.planned_start = addDays(item.planned_start, delta);
      next.planned_end = addDays(item.planned_end, delta);
      next.due_date = null;
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
        {connecting
          ? <button className="danger-button" onClick={() => setConnecting(null)}>接続をキャンセル</button>
          : <button className="secondary-button" onClick={() => { setConnecting({ sourceId: "", sourceTitle: "" }); setSelectedDep(null); }}>依存を接続</button>}
        <button className="primary-button" onClick={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "period" } })}>期間予定を追加</button>
      </PageHeader>
      {connecting && (
        <div className="connect-status-bar">
          {connecting.sourceId
            ? <span>先行: <strong>{connecting.sourceTitle}</strong> → 後続Itemをクリックしてください（Escでキャンセル）</span>
            : <span>先行Itemをクリックしてください（Escでキャンセル）</span>}
        </div>
      )}
      <section className="timeline-toolbar panel">
        <label>Theme
          <select value={themeFilter} onChange={(event) => updatePrefs({ themeFilter: event.target.value })}>
            <option value="all">すべて</option>
            {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
          </select>
        </label>
        <div className="segmented">{[["year", "年間"], ["half", "半年"], ["quarter", "四半期"], ["month", "月間"], ["week", "週間"]].map(([id, label]) => <button key={id} className={scale === id ? "is-active" : ""} onClick={() => updatePrefs({ scale: id })}>{label}</button>)}</div>
        <label className="toggle"><input type="checkbox" checked={showTasks} onChange={(event) => updatePrefs({ showTasks: event.target.checked })} />タスクを表示</label>
        <label className="toggle"><input type="checkbox" checked={showCompleted} onChange={(event) => updatePrefs({ showCompleted: event.target.checked })} />完了Item</label>
        <label className="toggle"><input type="checkbox" checked={showDependencies} onChange={(event) => updatePrefs({ showDependencies: event.target.checked })} />依存線</label>
        <label className="toggle"><input type="checkbox" checked={showLightning} onChange={(event) => updatePrefs({ showLightning: event.target.checked })} />イナズマ線</label>
        <button className="secondary-button compact" onClick={() => { setCollapsedThemes([]); setCollapsedItems([]); }}>全展開</button>
        <button className="secondary-button compact" onClick={() => setCollapsedThemes(groupKeys)}>全折りたたみ</button>
      </section>
      <section className="split-gantt panel">
        <div className="gantt-table">
          <div className="gantt-table-head"><span>Item</span><span>状態</span></div>
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
              <div className={`gantt-table-row level-${itemLevel(item)} ${connecting?.sourceId === item.id ? "is-connect-source" : ""}`} key={item.id}>
                <button className="gantt-name" style={{ paddingLeft: `calc(var(--space-2) + ${depth * 14}px)` }} onClick={() => connecting ? startConnecting(item) : openDrawer({ type: "item", entity: item })}>
                  {hasChildren
                    ? <span onClick={(event) => { event.stopPropagation(); setCollapsedItems((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]); }}>{collapsedItems.includes(item.id) ? "＋" : "−"}</span>
                    : item.kind === "milestone" && <span className="gantt-milestone-mark">◆</span>}
                  {item.title}
                </button>
                <StatusBadge value={item.status} label={STATUS_LABELS[item.status ?? ""]} />
              </div>
            );
          })}
        </div>
        <div className="gantt-scroll" ref={scrollRef}>
          <div className="gantt-canvas" onClick={() => selectedDep && setSelectedDep(null)}>
            <TimeAxis start={range.start} end={range.end} scale={scale} />
            <div className="gantt-today" style={{ left: `${todayLeft}%` }}><span>今日</span></div>
            {rows.map((row) => {
              if (row.rowType === "theme") return <div className="gantt-canvas-theme-row" key={`theme-${row.groupKey}`} />;
              const itemTheme = themes.find((t) => t.id === row.item.theme_id);
              const colorKey = themeColor(itemTheme, themes.indexOf(itemTheme ?? themes[0]));
              return <GanttItemRow key={row.item.id} item={row.item} range={range} hint={dateHint(row.item)} onOpen={() => connecting ? startConnecting(row.item) : openDrawer({ type: "item", entity: row.item })} onMove={moveItem} connecting={connecting} onConnect={startConnecting} themeColorKey={colorKey} />;
            })}
            {showDependencies && <DependencyOverlay dependencies={data.dependencys || []} rows={rows} range={range} selected={selectedDep} onSelect={setSelectedDep} />}
            {showLightning && <LightningOverlay rows={rows} range={range} today={today} />}
          </div>
        </div>
      </section>
      <div className="timeline-legend"><span><i className="legend-solid" />計画（期間）</span><span><i className="legend-diamond" />マイルストーン</span><span><i className="legend-task" />タスク</span><span><i className="legend-lightning" />実進捗の到達日</span><span>予定なしは左表のみ</span></div>
    </div>
  );
}
