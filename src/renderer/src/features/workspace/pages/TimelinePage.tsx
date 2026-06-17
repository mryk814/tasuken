import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { todayIso } from "../../../utils/dataFormat.js";
import { usePersistentState } from "../../../utils/usePersistentState";
import type { Item, PageProps } from "../types";
import { STATUS_LABELS, hasPlannedSchedule, itemLevel, themeColor } from "../lib/domain";
import { addDays, daysBetween, formatDate, uuid } from "../lib/format";
import { buildTimelineRows, dataRange, scaleFromDayWidth, ZOOM_PRESETS, MIN_DAY_WIDTH, MAX_DAY_WIDTH } from "../lib/timeline";
import { type ConnectingState, type SelectedDependency, DependencyOverlay, GanttItemRow, LightningOverlay, MilestoneLane, TimeAxis } from "../components/gantt";
import { PageHeader, StatusBadge } from "../components/common";

type DragMode = "move" | "start" | "end";

interface TimelineUndo {
  label: string;
  run(): Promise<void>;
}

interface TimelinePrefs {
  dayWidth: number;
  themeFilter: string;
  showCompleted: boolean;
  showDependencies: boolean;
  showLightning: boolean;
}
const DEFAULT_PREFS: TimelinePrefs = {
  dayWidth: 8,
  themeFilter: "all",
  showCompleted: true,
  showDependencies: true,
  showLightning: true,
};

export function TimelinePage({ data, themes, items, openDrawer, saveEntity, removeEntityQuiet, setToast }: PageProps) {
  const [prefs, setPrefs] = usePersistentState<TimelinePrefs>("timeline:prefs:v5", DEFAULT_PREFS);
  const { dayWidth, themeFilter, showCompleted, showDependencies, showLightning } = prefs;
  const scale = scaleFromDayWidth(dayWidth);
  const updatePrefs = (patch: Partial<TimelinePrefs>) => setPrefs((current) => ({ ...current, ...patch }));
  const [collapsedThemes, setCollapsedThemes] = useState<string[]>([]);
  const [connecting, setConnecting] = useState<ConnectingState | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [selectedDep, setSelectedDep] = useState<SelectedDependency | null>(null);
  const [editingTitle, setEditingTitle] = useState<{ id: string; value: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const undoStack = useRef<TimelineUndo[]>([]);
  const today = todayIso();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inInput = ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "") || target?.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey && !inInput) {
        event.preventDefault();
        void undoTimelineOperation();
        return;
      }
      if (event.key === "Escape") {
        setConnecting(null);
        setConnectMode(false);
        setSelectedDep(null);
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedDep) {
        event.preventDefault();
        void deleteDependency(selectedDep);
      }
    };
    addEventListener("keydown", onKeyDown);
    return () => removeEventListener("keydown", onKeyDown);
  }, [selectedDep]);

  function pushUndo(entry: TimelineUndo) {
    undoStack.current = [...undoStack.current.slice(-19), entry];
  }

  async function undoTimelineOperation() {
    const entry = undoStack.current.pop();
    if (!entry) {
      setToast("元に戻せるガント操作はありません。");
      return;
    }
    try {
      await entry.run();
      setToast(`${entry.label}を元に戻しました。`);
    } catch {
      setToast("元に戻せませんでした。変更後のデータを確認してください。");
    }
  }

  async function deleteDependency(sel: SelectedDependency) {
    try {
      await removeEntityQuiet("dependency", sel.dependency.id);
      pushUndo({
        label: "依存削除",
        run: async () => {
          await saveEntity("dependency", sel.dependency);
        },
      });
      setToast("依存を削除しました。Ctrl+Zで元に戻せます。");
    } catch {
      setToast("依存を削除できませんでした。");
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
      const saved = await saveEntity("dependency", {
        id: uuid(),
        source_item_id: connecting.sourceId,
        target_item_id: target.id,
        dependency_type: "finish_to_start",
      });
      pushUndo({
        label: "依存追加",
        run: async () => {
          await removeEntityQuiet("dependency", saved.id);
        },
      });
      setToast(`依存を追加: ${connecting.sourceTitle} → ${target.title}`);
    } catch {
      // saveEntity already shows error toast
    }
    setConnecting(null);
    setConnectMode(false);
  }, [connecting, data.dependencys, saveEntity, setToast]);

  function startConnecting(item: Item) {
    if (!connecting && !connectMode) return;
    if (!connecting || !connecting.sourceId) {
      setConnecting({ sourceId: item.id, sourceTitle: item.title });
    } else {
      handleConnect(item);
    }
  }

  function handleCtrlClick(item: Item) {
    if (!connecting) {
      setConnecting({ sourceId: item.id, sourceTitle: item.title });
      setSelectedDep(null);
    } else {
      handleConnect(item);
    }
  }
  const range = dataRange(items, today);
  const timelineItems = items.filter((item) => {
    if (!showCompleted && item.status === "done") return false;
    if (themeFilter !== "all" && item.theme_id !== themeFilter) return false;
    return true;
  });
  const rows = buildTimelineRows({ items: timelineItems, themes, collapsedThemes, scale });
  const groupKeys = rows.filter((row) => row.rowType === "theme").map((row) => (row as Extract<typeof row, { rowType: "theme" }>).groupKey);
  const days = Math.max(1, daysBetween(range.start, range.end));
  const canvasWidth = Math.round(days * dayWidth);
  const todayLeft = (daysBetween(range.start, today) / days) * 100;

  const didInitialScroll = useRef(false);
  useEffect(() => {
    if (!didInitialScroll.current && scrollRef.current) {
      scrollToday();
      didInitialScroll.current = true;
    }
  }, []);

  const dayWidthRef = useRef(dayWidth);
  dayWidthRef.current = dayWidth;
  const pendingScroll = useRef<{ ratio: number; mouseX: number } | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const mouseX = e.clientX - el.getBoundingClientRect().left;
      const oldWidth = el.scrollWidth;
      const ratio = (el.scrollLeft + mouseX) / oldWidth;
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      const next = Math.min(MAX_DAY_WIDTH, Math.max(MIN_DAY_WIDTH, dayWidthRef.current * factor));
      if (Math.abs(next - dayWidthRef.current) > 0.01) {
        pendingScroll.current = { ratio, mouseX };
        updatePrefs({ dayWidth: next });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useLayoutEffect(() => {
    if (pendingScroll.current && scrollRef.current) {
      const { ratio, mouseX } = pendingScroll.current;
      scrollRef.current.scrollLeft = ratio * scrollRef.current.scrollWidth - mouseX;
      pendingScroll.current = null;
    }
  }, [dayWidth]);

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

  function resolveDropTarget(clientY: number): Item | null | undefined {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const y = clientY - canvas.getBoundingClientRect().top - 44;
    const row = rows[Math.floor(y / 44)];
    if (!row || row.rowType !== "item" || itemLevel(row.item) !== "plan") return undefined;
    return row.item;
  }

  async function renameItem(item: Item, title: string) {
    const nextTitle = title.trim();
    setEditingTitle(null);
    if (!nextTitle || nextTitle === item.title) return;
    await saveEntity("item", { ...item, title: nextTitle });
    pushUndo({
      label: "名称変更",
      run: async () => {
        await saveEntity("item", item);
      },
    });
  }

  async function moveItem(item: Item, delta: number, mode: DragMode = "move", targetParent?: Item | null) {
    if (!delta && targetParent === undefined) return;
    const next: Item = { ...item };
    if (delta) {
      if (!hasPlannedSchedule(item)) return;
      if (mode === "start") next.planned_start = addDays(item.planned_start, delta);
      else if (mode === "end") next.planned_end = addDays(item.planned_end, delta);
      else {
        next.planned_start = addDays(item.planned_start, delta);
        next.planned_end = addDays(item.planned_end, delta);
        next.due_date = null;
      }
    }
    if (targetParent && targetParent.id !== item.id && targetParent.id !== item.parent_item_id) {
      next.parent_item_id = targetParent.id;
      next.theme_id = targetParent.theme_id || null;
    }
    if (next.planned_start && next.planned_end && next.planned_end < next.planned_start) {
      setToast("開始日と終了日の順序が逆になるため変更しませんでした。");
      return;
    }
    await saveEntity("item", next);
    pushUndo({
      label: "計画変更",
      run: async () => {
        await saveEntity("item", item);
      },
    });
    setToast("日程を移動しました。Ctrl+Zで戻せます。");
  }

  return (
    <div className="page timeline-wide">
      <PageHeader title="Timeline" subtitle="実施事項ごとに、分析依頼・試験依頼・整理などの計画を並べます。">
        <button className="primary-button" onClick={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "period", level: "plan" } })}>実施事項を追加</button>
      </PageHeader>
      <section className="timeline-toolbar panel">
        <label>Theme
          <select value={themeFilter} onChange={(event) => updatePrefs({ themeFilter: event.target.value })}>
            <option value="all">すべて</option>
            {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
          </select>
        </label>
        <div className="segmented">{ZOOM_PRESETS.map(({ id, label, dayWidth: pw }) => <button key={id} className={Math.abs(dayWidth - pw) < 0.5 ? "is-active" : ""} onClick={() => { const scroll = scrollRef.current; if (scroll) { const cx = scroll.clientWidth / 2; pendingScroll.current = { ratio: (scroll.scrollLeft + cx) / scroll.scrollWidth, mouseX: cx }; } updatePrefs({ dayWidth: pw }); }}>{label}</button>)}</div>
        <label className="toggle"><input type="checkbox" checked={showCompleted} onChange={(event) => updatePrefs({ showCompleted: event.target.checked })} />完了タスク</label>
        <label className="toggle"><input type="checkbox" checked={showDependencies} onChange={(event) => updatePrefs({ showDependencies: event.target.checked })} />依存線</label>
        <label className="toggle"><input type="checkbox" checked={showLightning} onChange={(event) => updatePrefs({ showLightning: event.target.checked })} />イナズマ線</label>
        <button
          className={`secondary-button compact ${connectMode || connecting ? "is-active" : ""}`}
          onClick={() => {
            const next = !(connectMode || connecting);
            setConnectMode(next);
            setConnecting(next ? { sourceId: "", sourceTitle: "" } : null);
            setSelectedDep(null);
          }}
        >
          依存をつなぐ
        </button>
        <button className="secondary-button compact" onClick={() => setCollapsedThemes([])}>全展開</button>
        <button className="secondary-button compact" onClick={() => setCollapsedThemes(groupKeys)}>全折りたたみ</button>
      </section>
      <section className={`split-gantt panel ${connecting ? "is-connecting" : ""}`}>
        {connecting && (
          <div className="connect-status-popover" role="status" aria-live="polite">
            <span>{connecting.sourceTitle ? <>先行: <strong>{connecting.sourceTitle}</strong> → 後続タスクをクリック</> : "先行タスクをクリック"}</span>
            <button className="danger-button compact" onClick={() => { setConnecting(null); setConnectMode(false); }}>キャンセル</button>
          </div>
        )}
        <div className="gantt-table">
          <div className="gantt-table-head"><span>実施事項 / 計画</span><span>操作</span></div>
          {rows.map((row) => {
            if (row.rowType === "theme") {
              const collapsed = collapsedThemes.includes(row.groupKey);
              return (
                <div className="gantt-theme-row" key={`theme-${row.groupKey}`}>
                  <button className="gantt-theme-toggle" onClick={() => setCollapsedThemes((current) => current.includes(row.groupKey) ? current.filter((key) => key !== row.groupKey) : [...current, row.groupKey])} aria-expanded={!collapsed}>
                    <span className="gantt-theme-caret">{collapsed ? "▸" : "▾"}</span>
                    <strong>{row.theme?.name || "個人業務 / Themeなし"}</strong>
                    {row.theme && <StatusBadge value={row.theme.status} label={row.theme.status} />}
                  </button>
                  <span className="gantt-theme-count">実施事項 {row.initiativeCount} / 計画 {row.planCount}</span>
                </div>
              );
            }
            if (row.rowType === "milestones") {
              return (
                <div className="gantt-milestone-table-row" key={`milestones-${row.groupKey}`}>
                  <span>Milestones</span>
                  <strong>{row.milestones.length}</strong>
                </div>
              );
            }
            const { item, depth } = row;
            const isPlan = itemLevel(item) === "plan";
            return (
              <div className={`gantt-table-row level-${itemLevel(item)} ${connecting?.sourceId === item.id ? "is-connect-source" : ""}`} key={item.id}>
                <div className="gantt-name" style={{ paddingLeft: `calc(var(--space-2) + ${depth * 14}px)` }}>
                  {item.kind === "milestone" && <span className="gantt-milestone-mark">◆</span>}
                  {editingTitle?.id === item.id ? (
                    <input
                      className="gantt-title-input"
                      autoFocus
                      value={editingTitle.value}
                      onChange={(event) => setEditingTitle({ id: item.id, value: event.target.value })}
                      onBlur={() => renameItem(item, editingTitle.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                        if (event.key === "Escape") setEditingTitle(null);
                      }}
                    />
                  ) : (
                    <button className="gantt-title-button" onClick={(e) => {
                      if ((e.ctrlKey || e.metaKey) && !isPlan) { handleCtrlClick(item); return; }
                      isPlan && !connectMode && !connecting ? setEditingTitle({ id: item.id, value: item.title }) : connecting || connectMode ? startConnecting(item) : openDrawer({ type: "item", entity: item });
                    }}>
                      {item.title}
                    </button>
                  )}
                </div>
                {isPlan
                  ? <button className="gantt-add-plan-button" aria-label={`${item.title}に計画を追加`} title="計画を追加" onClick={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "period", level: "plan", parent_item_id: item.id, theme_id: item.theme_id, planned_start: item.planned_start, planned_end: item.planned_end } })}>＋</button>
                  : <StatusBadge value={item.status} label={STATUS_LABELS[item.status ?? ""]} />}
              </div>
            );
          })}
        </div>
        <div className="gantt-scroll" ref={scrollRef}>
          <div className="gantt-canvas" ref={canvasRef} style={{ width: canvasWidth }} onClick={() => selectedDep && setSelectedDep(null)}>
            <TimeAxis start={range.start} end={range.end} dayWidth={dayWidth} />
            <div className="gantt-today" style={{ left: `${todayLeft}%` }}><span>今日</span></div>
            {rows.map((row) => {
              if (row.rowType === "theme") return <div className="gantt-canvas-theme-row" key={`theme-${row.groupKey}`} />;
              if (row.rowType === "milestones") {
                const colorKey = themeColor(row.theme, themes.indexOf(row.theme ?? themes[0]));
                return <MilestoneLane key={`milestones-${row.groupKey}`} milestones={row.milestones} range={range} dayWidth={dayWidth} hint={dateHint} onOpen={(item) => openDrawer({ type: "item", entity: item })} onMove={(item, delta) => moveItem(item, delta, "move")} themeColorKey={colorKey} />;
              }
              const itemTheme = themes.find((t) => t.id === row.item.theme_id);
              const colorKey = themeColor(itemTheme, themes.indexOf(itemTheme ?? themes[0]));
              return <GanttItemRow key={row.item.id} item={row.item} laneItems={row.laneItems} range={range} hint={dateHint} onOpen={(item) => connecting ? startConnecting(item) : openDrawer({ type: "item", entity: item })} onMove={moveItem} connecting={connecting} onConnect={startConnecting} themeColorKey={colorKey} resolveDropTarget={resolveDropTarget} onCtrlClick={handleCtrlClick} />;
            })}
            {showDependencies && <DependencyOverlay dependencies={data.dependencys || []} rows={rows} range={range} selected={selectedDep} onSelect={setSelectedDep} />}
            {showLightning && <LightningOverlay rows={rows} range={range} today={today} />}
          </div>
        </div>
      </section>
      <div className="timeline-legend"><span><i className="legend-solid" />実施事項</span><span><i className="legend-diamond" />マイルストーン</span><span><i className="legend-task" />計画</span><span><i className="legend-lightning" />実進捗の到達日</span><span>予定なしは左表のみ</span></div>
    </div>
  );
}
