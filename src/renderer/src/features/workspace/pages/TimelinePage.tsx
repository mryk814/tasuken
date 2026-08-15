import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconCalendarPlus, IconGripVertical, IconPlus, IconPresentationAnalytics, IconTrash } from "@tabler/icons-react";

import { todayIso } from "../../../utils/dataFormat.js";
import { usePreference } from "../../../utils/usePreference";
import type { Item, PageProps, SaveOperation } from "../types";
import { themeColor } from "../lib/domain";
import { daysBetween, formatDate, localDateIso, uuid } from "../lib/format";
import { buildTimelineRows, scaleFromDayWidth, timelineItemScheduleKind, timelineItemState, ZOOM_PRESETS, MIN_DAY_WIDTH, MAX_DAY_WIDTH } from "../lib/timeline";
import { SCHEDULE_KIND_LABELS, TIMELINE_ITEM_STATE_LABELS } from "../domain-model/labels";
import { type ConnectingState, type SelectedDependency, DependencyOverlay, GanttItemRow, LightningOverlay, MilestoneLane, TimeAxis, ganttGridBackground, ganttRowHeight } from "../components/gantt";
import { Button, PageHeader, StatusBadge, ThemePickerSelect, ToolbarOverflow } from "../components/common";
import { SlideTimelineDialog } from "../components/SlideTimelineDialog";
import {
  isTimelineCompleted,
  legacyTimelineWorkspace,
  timelineAddDependencyOperations,
  findPlanDependencyId,
  timelineItemDateSpan,
  timelineItemHasSchedule,
  timelineItemIsMilestone,
  timelineItemLevel,
  timelineItemStatusLabel,
  timelineItemStatusValue,
  timelineReparentItemDraft,
  timelineSaveItemOperations,
  timelineShiftItemDraft,
  timelineThemeId,
  timelineResolveParentPlanNodeId,
} from "../domain-model/compat/timelineProjection";
import type { PlanNode, Schedule } from "../domain-model/types";

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
  rangeBufferMonths: 0 | 3 | 6;
}
/**
 * 常設するのは中長期のscaleだけ（#318）。週間はTodayの実行管理と役割が重なり
 * 利用実績もないため、廃止せずmenuへ畳む。
 */
const LONG_RANGE_ZOOM_PRESETS = ZOOM_PRESETS.filter((preset) => preset.id !== "week");
const SHORT_RANGE_ZOOM_PRESETS = ZOOM_PRESETS.filter((preset) => preset.id === "week");

const RANGE_BUFFER_OPTIONS = [
  { value: 0, label: "年度" },
  { value: 3, label: "前後3か月" },
  { value: 6, label: "前後6か月" },
] as const;

function fiscalYearStart(today: string): number {
  const date = new Date(`${today}T00:00:00`);
  return date.getMonth() + 1 >= 4 ? date.getFullYear() : date.getFullYear() - 1;
}

function fiscalRange(today: string, bufferMonths: number) {
  const year = fiscalYearStart(today);
  const start = new Date(year, 3 - bufferMonths, 1);
  const end = new Date(year, 3 + 12 + bufferMonths, 0);
  return { start: localDateIso(start), end: localDateIso(end) };
}

function themeLabel(theme: { name?: string } | null | undefined, fallback = "個人業務"): string {
  return theme?.name || fallback;
}

function sameTimelineItemShape(a: Item, b: Item): boolean {
  const aSpan = timelineItemDateSpan(a);
  const bSpan = timelineItemDateSpan(b);
  return aSpan.start === bSpan.start
    && aSpan.end === bSpan.end
    && a.due_date === b.due_date
    && a.parent_item_id === b.parent_item_id
    && timelineThemeId(a) === timelineThemeId(b);
}

export function TimelinePage({ data, domain: v2, themes, items, openDrawer, saveEntity, saveEntities, removeEntityQuiet, setToast }: PageProps) {
  const [prefs, setPrefs] = usePreference("timeline.preferences");
  const { dayWidth, themeFilter, showCompleted, showDependencies, showLightning, rangeBufferMonths = 0, collapsedThemes } = prefs;
  const scale = scaleFromDayWidth(dayWidth);
  const updatePrefs = (patch: Partial<TimelinePrefs>) => setPrefs((current) => ({ ...current, ...patch }));
  const today = todayIso();
  const setCollapsedThemes = (next: string[] | ((current: string[]) => string[])) => {
    setPrefs((current) => ({
      ...current,
      collapsedThemes: typeof next === "function" ? next(current.collapsedThemes) : next,
    }));
  };
  const [connecting, setConnecting] = useState<ConnectingState | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [selectedDep, setSelectedDep] = useState<SelectedDependency | null>(null);
  const [selectedTimelineItemId, setSelectedTimelineItemId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<{ id: string; value: string } | null>(null);
  const [draggingSortId, setDraggingSortId] = useState<string | null>(null);
  const [dropSortTargetId, setDropSortTargetId] = useState<string | null>(null);
  const [slideTimelineOpen, setSlideTimelineOpen] = useState(false);
  const [optimisticTimelineItems, setOptimisticTimelineItems] = useState<Record<string, Item>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const undoStack = useRef<TimelineUndo[]>([]);
  const timelineWorkspace = legacyTimelineWorkspace(data, v2);
  const persistedTimelineItems = timelineWorkspace.items || [];
  const timelineItems = persistedTimelineItems.map((item) => optimisticTimelineItems[item.id] || item);
  const timelineDependencies = timelineWorkspace.dependencies || [];

  useEffect(() => {
    if (!Object.keys(optimisticTimelineItems).length) return;
    setOptimisticTimelineItems((current) => {
      let changed = false;
      const next = { ...current };
      for (const [id, optimistic] of Object.entries(current)) {
        const persisted = persistedTimelineItems.find((item) => item.id === id);
        if (!persisted || sameTimelineItemShape(persisted, optimistic)) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [optimisticTimelineItems, persistedTimelineItems]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inInput = ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "") || target?.isContentEditable;
      if (target?.closest(".drawer")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey && !inInput) {
        event.preventDefault();
        void undoTimelineOperation();
        return;
      }
      if (event.key === "Escape") {
        setConnecting(null);
        setConnectMode(false);
        setSelectedDep(null);
        setSelectedTimelineItemId(null);
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedDep) {
        event.preventDefault();
        void deleteDependency(selectedDep);
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedTimelineItemId && !inInput) {
        const item = timelineItems.find((entry) => entry.id === selectedTimelineItemId);
        if (item && timelineItemLevel(item) === "plan") {
          event.preventDefault();
          void deleteItem(item);
        }
      }
    };
    addEventListener("keydown", onKeyDown);
    return () => removeEventListener("keydown", onKeyDown);
  }, [selectedDep, selectedTimelineItemId, timelineItems]);

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
      const domainDependencyId = findPlanDependencyId(sel.dependency, v2);
      const depId = domainDependencyId || sel.dependency.id;
      const planDep = v2.plan_dependencies.find((pd) => pd.id === depId);
      await removeEntityQuiet("plan_dependency", depId);
      pushUndo({
        label: "依存削除",
        run: async () => {
          if (planDep) {
            await saveEntity("plan_dependency", planDep as unknown as Record<string, unknown>);
          }
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
    const exists = timelineDependencies.some(
      (d) => d.source_item_id === connecting.sourceId && d.target_item_id === target.id,
    );
    if (exists) {
      setToast("この依存関係はすでに登録されています。");
      setConnecting(null);
      return;
    }
    try {
      const result = timelineAddDependencyOperations(connecting.sourceId, target.id, v2);
      if (result) {
        await saveEntities(result.ops, `依存を追加: ${connecting.sourceTitle} → ${target.title}`);
        const depId = result.planDepId;
        pushUndo({
          label: "依存追加",
          run: async () => { await removeEntityQuiet("plan_dependency", depId); },
        });
      } else {
        setToast("対応する計画ノードが見つかりません。先にPlanNodeを追加してください。");
      }
    } catch {
      // saveEntity already shows error toast
    }
    setConnecting(null);
    setConnectMode(false);
  }, [connecting, timelineDependencies, v2, saveEntity, saveEntities, setToast]);

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

  function selectTimelineItem(item: Item) {
    setSelectedTimelineItemId(item.id);
    setSelectedDep(null);
  }
  const range = fiscalRange(today, rangeBufferMonths);
  const visibleTimelineItems = timelineItems.filter((item) => {
    if (!showCompleted && isTimelineCompleted(item)) return false;
    if (themeFilter !== "all" && timelineThemeId(item) !== themeFilter) return false;
    return true;
  });
  const rows = buildTimelineRows({ items: visibleTimelineItems, themes, collapsedThemes, scale });
  const groupKeys = rows.filter((row) => row.rowType === "theme").map((row) => (row as Extract<typeof row, { rowType: "theme" }>).groupKey);
  // 一括開閉は一つのtoggleにする（#318）。すべて畳んでいるときだけ「展開」を出す。
  const allThemesCollapsed = groupKeys.length > 0 && groupKeys.every((key) => collapsedThemes.includes(key));

  /** 表示倍率の変更。中心位置を保ったまま拡大縮小する。 */
  function applyZoom(nextDayWidth: number) {
    const scroll = scrollRef.current;
    if (scroll) {
      const cx = scroll.clientWidth / 2;
      pendingScroll.current = { cursorDayOffset: daysBetween(range.start, today), mouseX: cx };
    }
    updatePrefs({ dayWidth: nextDayWidth });
  }
  const days = Math.max(1, daysBetween(range.start, range.end));
  const canvasWidth = Math.round(days * dayWidth);
  const gridBackground = ganttGridBackground(range.start, range.end, dayWidth);
  const todayLeft = (daysBetween(range.start, today) / days) * 100;
  const outsideCount = visibleTimelineItems.filter((item) => {
    const span = timelineItemDateSpan(item);
    const start = span.start || span.end;
    const end = span.end || span.start;
    return start && end && (end < range.start || start > range.end);
  }).length;

  const didInitialScroll = useRef(false);
  useEffect(() => {
    if (!didInitialScroll.current && scrollRef.current) {
      scrollToday();
      didInitialScroll.current = true;
    }
  }, []);

  const dayWidthRef = useRef(dayWidth);
  dayWidthRef.current = dayWidth;
  const pendingScroll = useRef<{ cursorDayOffset: number; mouseX: number } | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const mouseX = e.clientX - el.getBoundingClientRect().left;
      const cursorDayOffset = (el.scrollLeft + mouseX) / dayWidthRef.current;
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      const next = Math.min(MAX_DAY_WIDTH, Math.max(MIN_DAY_WIDTH, dayWidthRef.current * factor));
      if (Math.abs(next - dayWidthRef.current) > 0.01) {
        pendingScroll.current = { cursorDayOffset, mouseX };
        updatePrefs({ dayWidth: next });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useLayoutEffect(() => {
    if (pendingScroll.current && scrollRef.current) {
      const { cursorDayOffset, mouseX } = pendingScroll.current;
      const nextScrollLeft = cursorDayOffset * dayWidth - mouseX;
      const maxScrollLeft = Math.max(0, scrollRef.current.scrollWidth - scrollRef.current.clientWidth);
      scrollRef.current.scrollLeft = Math.max(0, Math.min(maxScrollLeft, nextScrollLeft));
      pendingScroll.current = null;
    }
  }, [dayWidth]);

  function dateHint(item: Item): string {
    if (!timelineItemHasSchedule(item)) return `${item.title}（予定なし）`;
    const spanDates = timelineItemDateSpan(item);
    const span = `${formatDate(spanDates.start)} 〜 ${formatDate(spanDates.end)}`;
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
    let top = 0;
    const row = rows.find((entry) => {
      const height = entry.rowType === "item" ? ganttRowHeight(entry.laneItems.length ? entry.laneItems : [entry.item]) : 44;
      const hit = y >= top && y < top + height;
      top += height;
      return hit;
    });
    if (!row || row.rowType !== "item" || timelineItemLevel(row.item) !== "plan") return undefined;
    return row.item;
  }

  async function renameItem(item: Item, title: string) {
    const nextTitle = title.trim();
    setEditingTitle(null);
    if (!nextTitle || nextTitle === item.title) return;
    const next = { ...item, title: nextTitle };
    const ops = timelineSaveItemOperations(next, v2);
    if (!ops.length) return;
    await saveEntities(ops);
    pushUndo({ label: "名称変更", run: async () => { await saveEntities(timelineSaveItemOperations(item, v2)); } });
  }

  async function moveItem(item: Item, delta: number, mode: DragMode = "move", targetParent?: Item | null) {
    if (!delta && targetParent === undefined) return;
    let next: Item = { ...item };
    const currentSpan = timelineItemDateSpan(item);
    if (delta) {
      const shifted = timelineShiftItemDraft(item, delta, mode);
      if (!shifted) return;
      next = shifted;
    }
    next = timelineReparentItemDraft(next, targetParent);
    const nextSpan = timelineItemDateSpan(next);
    const dateChanged = currentSpan.start !== nextSpan.start || currentSpan.end !== nextSpan.end || item.due_date !== next.due_date;
    const parentChanged = item.parent_item_id !== next.parent_item_id || timelineThemeId(item) !== timelineThemeId(next);
    if (!dateChanged && !parentChanged) return;
    if (nextSpan.start && nextSpan.end && nextSpan.end < nextSpan.start) {
      setToast("開始日と終了日の順序が逆になるため変更しませんでした。");
      return;
    }
    const ops = timelineSaveItemOperations(next, v2);
    if (!ops.length) return;
    setOptimisticTimelineItems((current) => ({ ...current, [next.id]: next }));
    try {
      await saveEntities(ops, dateChanged ? "日程を移動しました。Ctrl+Zで戻せます。" : undefined);
      pushUndo({ label: "計画変更", run: async () => { await saveEntities(timelineSaveItemOperations(item, v2)); } });
    } catch (error) {
      setOptimisticTimelineItems((current) => {
        const { [next.id]: _removed, ...rest } = current;
        return rest;
      });
      throw error;
    }
  }

  function planNodeFor(item: Item) {
    return v2.plan_nodes.find((node) => node.legacy_item_id === item.id || node.id === item.id);
  }

  function scheduleForPlanNode(planNodeId: string) {
    return v2.schedules.find((schedule) => schedule.owner_type === "plan_node" && schedule.owner_id === planNodeId);
  }

  function createMilestone(themeId: string | null, date: string) {
    openDrawer({
      type: "plan_node",
      mode: "edit",
      entity: {
        type: "milestone",
        node_type: "milestone",
        state: "planned",
        node_state: "planned",
        project_id: themeId,
        _focusTitle: true,
        _schedule: {
          id: uuid(),
          owner_type: "plan_node",
          owner_id: "",
          start_date: date,
          end_date: date,
          date_kind: "point",
          confidence: "fixed",
          granularity: "day",
        },
      },
    });
  }

  function openPlanNode(item: Item) {
    selectTimelineItem(item);
    const planNode = planNodeFor(item);
    openDrawer({ type: "plan_node", mode: "edit", entity: { ...(planNode || item) } as Record<string, unknown> });
  }

  async function createRangeFromRow(parent: Item, startDate: string, endDate: string) {
    const start = startDate <= endDate ? startDate : endDate;
    const end = endDate >= startDate ? endDate : startDate;
    const planNodeId = uuid();
    const parentPlanNodeId = timelineResolveParentPlanNodeId(v2, parent.id);
    const siblings = timelineItems.filter((item) => item.parent_item_id === parent.id && timelineThemeId(item) === timelineThemeId(parent));
    const sortOrder = Math.max(0, ...siblings.map((item) => Number(item.sort_order) || 0)) + 10;
    const planNode: PlanNode = {
      id: planNodeId,
      title: "無題の計画",
      project_id: parent.theme_id || null,
      parent_plan_node_id: parentPlanNodeId,
      type: "phase",
      state: "planned",
      sort_order: sortOrder,
      description: null,
      created_at: new Date().toISOString(),
    };
    const schedule: Schedule = {
      id: uuid(),
      owner_type: "plan_node",
      owner_id: planNodeId,
      start_date: start,
      end_date: end,
      date_kind: "range",
      confidence: "tentative",
      granularity: "day",
    };
    await saveEntities([
      { action: "save", type: "plan_node", entity: planNode as unknown as SaveOperation["entity"] },
      { action: "save", type: "schedule", entity: schedule as unknown as SaveOperation["entity"] },
    ], "計画を追加しました。Ctrl+Zで戻せます。");
    pushUndo({ label: "計画追加", run: async () => { await removeEntityQuiet("plan_node", planNodeId); } });
    setSelectedTimelineItemId(planNodeId);
    openDrawer({ type: "plan_node", mode: "edit", entity: { ...planNode, _schedule: schedule, _focusTitle: true } as unknown as Record<string, unknown> });
  }

  async function reorderItemToTarget(item: Item, target: Item) {
    if (item.id === target.id) return;
    if (item.parent_item_id !== target.parent_item_id || timelineThemeId(item) !== timelineThemeId(target)) {
      setToast("同じ階層の計画同士で並び替えてください。");
      return;
    }
    const siblings = timelineItems
      .filter((entry) => entry.kind !== "milestone" && entry.parent_item_id === item.parent_item_id && timelineThemeId(entry) === timelineThemeId(item))
      .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || String(a.title).localeCompare(String(b.title)));
    const fromIndex = siblings.findIndex((entry) => entry.id === item.id);
    const toIndex = siblings.findIndex((entry) => entry.id === target.id);
    if (fromIndex < 0 || toIndex < 0) return;
    const reordered = [...siblings];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    const ops = reordered.flatMap((entry, orderIndex) => timelineSaveItemOperations({ ...entry, sort_order: (orderIndex + 1) * 10 }, v2));
    const previousOptimistic = optimisticTimelineItems;
    setOptimisticTimelineItems((current) => ({
      ...current,
      ...Object.fromEntries(reordered.map((entry, orderIndex) => [entry.id, { ...entry, sort_order: (orderIndex + 1) * 10 }])),
    }));
    try {
      await saveEntities(ops, "並び順を変更しました。Ctrl+Zで戻せます。");
      pushUndo({
        label: "並び替え",
        run: async () => {
          await saveEntities(siblings.flatMap((entry) => timelineSaveItemOperations(entry, v2)));
        },
      });
    } catch {
      setOptimisticTimelineItems(previousOptimistic);
      setToast("並び替えを保存できませんでした。再試行してください。", "danger");
    }
  }

  async function deleteItem(item: Item) {
    const planNode = planNodeFor(item);
    if (!planNode) {
      setToast("削除対象の計画ノードが見つかりません。");
      return;
    }
    const schedule = scheduleForPlanNode(planNode.id);
    const deps = v2.plan_dependencies.filter((dep) => dep.plan_node_id === planNode.id || dep.depends_on_plan_node_id === planNode.id);
    await removeEntityQuiet("plan_node", planNode.id);
    pushUndo({
      label: "計画削除",
      run: async () => {
        await saveEntities([
          { action: "save", type: "plan_node", entity: planNode as unknown as SaveOperation["entity"] },
          ...(schedule ? [{ action: "save" as const, type: "schedule" as const, entity: schedule as unknown as SaveOperation["entity"] }] : []),
          ...deps.map((dep) => ({ action: "save" as const, type: "plan_dependency" as const, entity: dep as unknown as SaveOperation["entity"] })),
        ]);
      },
    });
    setSelectedTimelineItemId((current) => current === item.id ? null : current);
    setToast("計画を削除しました。Ctrl+Zで元に戻せます。");
  }

  return (
    <div className="page timeline-wide">
      <PageHeader route="timeline">
        <Button variant="secondary" onClick={() => setSlideTimelineOpen(true)}><IconPresentationAnalytics size={16} />スライド用</Button>
        <Button variant="primary" onClick={() => openDrawer({ type: "plan_node", mode: "edit", entity: { node_type: "phase", node_state: "planned" } })}><IconPlus size={16} />実施事項を追加</Button>
      </PageHeader>
      {/* 狭幅では横一列に詰め込まず、意味単位で行送りする。表示切替と一括開閉は
          利用頻度が低いのでメニューへ畳み、幅が変わっても位置を動かさない（#300）。 */}
      <section className="timeline-toolbar toolbar-row panel">
        <label>Theme
          <ThemePickerSelect
            themes={themes}
            value={themeFilter}
            onChange={(next) => updatePrefs({ themeFilter: next })}
            allowAll
            allowNone
            allLabel="すべて"
            ariaLabel="Themeで絞り込み"
          />
        </label>
        <div className="segmented" aria-label="表示範囲">
          {RANGE_BUFFER_OPTIONS.map((option) => <button key={option.value} className={rangeBufferMonths === option.value ? "is-active" : ""} onClick={() => updatePrefs({ rangeBufferMonths: option.value })}>{option.label}</button>)}
        </div>
        {/* 中長期の把握が主用途（#318）。週間はTodayと役割が重なるのでmenuへ畳む。 */}
        <div className="segmented" aria-label="表示倍率">{LONG_RANGE_ZOOM_PRESETS.map(({ id, label, dayWidth: pw }) => <button key={id} className={Math.abs(dayWidth - pw) < 0.5 ? "is-active" : ""} onClick={() => applyZoom(pw)}>{label}</button>)}</div>
        <Button
          variant="secondary"
          compact
          className={connectMode || connecting ? "is-active" : ""}
          onClick={() => {
            const next = !(connectMode || connecting);
            setConnectMode(next);
            setConnecting(next ? { sourceId: "", sourceTitle: "" } : null);
            setSelectedDep(null);
          }}
        >
          依存をつなぐ
        </Button>
        {/* 展開と折りたたみは同時に出さず、いまの状態から次の操作だけを出す（#318）。 */}
        <Button
          variant="secondary"
          compact
          aria-expanded={!allThemesCollapsed}
          onClick={() => setCollapsedThemes(allThemesCollapsed ? [] : groupKeys)}
        >
          {allThemesCollapsed ? "すべて展開" : "すべて折りたたむ"}
        </Button>
        <ToolbarOverflow label="表示" ariaLabel="タイムラインの表示切替">
          <label className="toggle"><input type="checkbox" checked={showCompleted} onChange={(event) => updatePrefs({ showCompleted: event.target.checked })} />完了タスク</label>
          <label className="toggle"><input type="checkbox" checked={showDependencies} onChange={(event) => updatePrefs({ showDependencies: event.target.checked })} />依存線</label>
          <label className="toggle"><input type="checkbox" checked={showLightning} onChange={(event) => updatePrefs({ showLightning: event.target.checked })} />イナズマ線</label>
          <hr />
          {SHORT_RANGE_ZOOM_PRESETS.map(({ id, label, dayWidth: pw }) => (
            <button key={id} type="button" role="menuitem" onClick={() => applyZoom(pw)}>{label}表示にする</button>
          ))}
        </ToolbarOverflow>
      </section>
      <section className={`split-gantt panel ${connecting ? "is-connecting" : ""}`}>
        {connecting && (
          <div className="connect-status-popover" role="status" aria-live="polite">
            <span>{connecting.sourceTitle ? <>先行: <strong>{connecting.sourceTitle}</strong> → 後続タスクをクリック</> : "先行タスクをクリック"}</span>
            <Button variant="secondary" compact onClick={() => { setConnecting(null); setConnectMode(false); }}>キャンセル</Button>
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
                    <strong>{themeLabel(row.theme, "個人業務 / Themeなし")}</strong>
                    {row.theme?.code && <span className="theme-code">{row.theme.code}</span>}
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
            const isPlan = timelineItemLevel(item) === "plan";
            const rowHeight = ganttRowHeight(row.laneItems.length ? row.laneItems : [item]);
            const scheduleKind = timelineItemScheduleKind(item);
            const timelineState = timelineItemState(item, today);
            return (
              <div
                className={`gantt-table-row level-${timelineItemLevel(item)} ${connecting?.sourceId === item.id ? "is-connect-source" : ""} ${selectedTimelineItemId === item.id ? "is-selected" : ""} ${draggingSortId === item.id ? "is-row-dragging" : ""} ${dropSortTargetId === item.id ? "is-row-drop-target" : ""}`}
                key={item.id}
                style={{ minHeight: rowHeight }}
                onClick={() => selectTimelineItem(item)}
                onDragOver={(event) => {
                  if (!isPlan || !draggingSortId || draggingSortId === item.id) return;
                  event.preventDefault();
                  setDropSortTargetId(item.id);
                }}
                onDragLeave={() => dropSortTargetId === item.id && setDropSortTargetId(null)}
                onDrop={(event) => {
                  event.preventDefault();
                  const sourceId = event.dataTransfer.getData("text/plain") || draggingSortId;
                  const source = timelineItems.find((entry) => entry.id === sourceId);
                  setDraggingSortId(null);
                  setDropSortTargetId(null);
                  if (source && isPlan) void reorderItemToTarget(source, item);
                }}
              >
                <div className="gantt-name" style={{ paddingLeft: `calc(var(--space-2) + ${depth * 14}px)` }}>
                  {timelineItemIsMilestone(item) && <span className="gantt-milestone-mark">◆</span>}
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
                    <>
                      <button
                        className="gantt-title-button"
                        // 長いタイトルは省略表示になるので、全文はtooltipで読めるようにする（#318）。
                        title={item.title}
                        onClick={(e) => {
                          if ((e.ctrlKey || e.metaKey) && !isPlan) { handleCtrlClick(item); return; }
                          isPlan && !connectMode && !connecting ? setEditingTitle({ id: item.id, value: item.title }) : connecting || connectMode ? startConnecting(item) : openPlanNode(item);
                        }}
                      >
                        {item.title}
                      </button>
                      {/* 状態は色だけで伝えず、語でも読めるようにする（#312 / #318）。 */}
                      {timelineState !== "ongoing" && <StatusBadge
                        value={timelineState}
                        label={TIMELINE_ITEM_STATE_LABELS[timelineState]}
                        className={`timeline-state-chip is-state-${timelineState}`}
                      />}
                      {(scheduleKind === "execution_window" || scheduleKind === "unspecified_range") && (
                        <span className={`timeline-range-chip is-range-${scheduleKind}`}>
                          {SCHEDULE_KIND_LABELS[scheduleKind]}
                        </span>
                      )}
                    </>
                  )}
                </div>
                {isPlan
                  ? (
                    <div className="gantt-row-actions">
                      {dropSortTargetId === item.id && draggingSortId && <span className="gantt-drop-label">ここへ移動</span>}
                      <button
                        className="gantt-row-action drag"
                        draggable
                        aria-label={`${item.title}をドラッグで並べ替え`}
                        title="ドラッグで並べ替え"
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", item.id);
                          selectTimelineItem(item);
                          setDraggingSortId(item.id);
                          setDropSortTargetId(null);
                        }}
                        onDragEnd={() => {
                          setDraggingSortId(null);
                          setDropSortTargetId(null);
                        }}
                      ><IconGripVertical size={15} /></button>
                      <button className="gantt-row-action danger" aria-label={`${item.title}を削除`} title="削除" onClick={() => deleteItem(item)}><IconTrash size={14} /></button>
                    </div>
                  )
                  : <StatusBadge value={timelineItemStatusValue(item)} label={timelineItemStatusLabel(item)} />}
              </div>
            );
          })}
        </div>
        <div className="gantt-scroll" ref={scrollRef}>
          <div className="gantt-canvas" ref={canvasRef} style={{ width: canvasWidth, "--gantt-grid-image": gridBackground } as React.CSSProperties} onClick={() => selectedDep && setSelectedDep(null)}>
            <TimeAxis start={range.start} end={range.end} dayWidth={dayWidth} />
            <div className="gantt-today" style={{ left: `${todayLeft}%` }}><span>今日</span></div>
            {rows.map((row) => {
              if (row.rowType === "theme") return <div className="gantt-canvas-theme-row" key={`theme-${row.groupKey}`} />;
              if (row.rowType === "milestones") {
                const colorKey = themeColor(row.theme, themes.indexOf(row.theme ?? themes[0]));
                return <MilestoneLane key={`milestones-${row.groupKey}`} milestones={row.milestones} range={range} dayWidth={dayWidth} hint={dateHint} onOpen={openPlanNode} onMove={(item, delta) => { selectTimelineItem(item); moveItem(item, delta, "move"); }} onCreateMilestone={(date) => createMilestone(row.theme?.id || null, date)} themeColorKey={colorKey} />;
              }
              const itemTheme = themes.find((t) => t.id === row.item.theme_id);
              const colorKey = themeColor(itemTheme, themes.indexOf(itemTheme ?? themes[0]));
              return <GanttItemRow key={row.item.id} item={row.item} laneItems={row.laneItems} range={range} hint={dateHint} selectedItemId={selectedTimelineItemId} onOpen={(item) => connecting ? startConnecting(item) : openPlanNode(item)} onSelect={selectTimelineItem} onMove={(item, delta, mode, targetParent) => { selectTimelineItem(item); moveItem(item, delta, mode, targetParent); }} connecting={connecting} onConnect={startConnecting} onCreateRange={createRangeFromRow} themeColorKey={colorKey} resolveDropTarget={resolveDropTarget} onCtrlClick={handleCtrlClick} />;
            })}
            {showDependencies && <DependencyOverlay dependencies={timelineDependencies} rows={rows} range={range} selected={selectedDep} onSelect={setSelectedDep} />}
            {showLightning && <LightningOverlay rows={rows} range={range} today={today} />}
          </div>
        </div>
      </section>
      {outsideCount > 0 && <div className="timeline-range-note">表示範囲外の計画が {outsideCount} 件あります。前後期間を広げると確認できます。</div>}
      {slideTimelineOpen && (
        <SlideTimelineDialog
          domain={v2}
          statusUpdates={data.status_updates}
          themes={themes}
          initialThemeId={themeFilter}
          initialStart={range.start}
          initialEnd={range.end}
          initialShowCompleted={showCompleted}
          onClose={() => setSlideTimelineOpen(false)}
          setToast={setToast}
        />
      )}
    </div>
  );
}
