import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { workspaceApi } from "../../services/workspaceApi";
import { actionDefinition, TOAST_ACTIONS } from "../../pages/semanticActions";
import { normalizeRoute, routeLabel } from "../../pages/routes";
import { useUiStore, type ToastTone } from "../../stores/uiStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { todayIso } from "../../utils/dataFormat.js";
import { usePreference } from "../../utils/usePreference";
import { noteProjectId } from "../../../../shared/themeRef.mjs";
import { createTaskClient, planTaskEdit, projectTaskDraft } from "../task/public";
import {
  type BaseRecord,
  type ContentViewerTarget,
  type DocumentSaveReferenceCompanion,
  type DocumentSaveSnapshot,
  type DrawerConfig,
  type DrawerEntity,
  type DrawerEntityType,
  type Entity,
  type EntityType,
  type Item,
  type Note,
  type PlanRevision,
  type SaveEntities,
  type SaveEntity,
  type SnapshotPreview,
  type Theme,
  type WorkspaceData,
} from "./types";
import { entityTitle } from "./lib/domain";
import { activeRecords, formText, str, uuid } from "./lib/format";
import {
  activityDatesToAutoExport,
  localDateAndTime,
  runActivityAutoExport,
} from "./lib/activityAutoExport";
import { resolveActivityLogDirectory } from "./lib/activityLogDirectory";
import { buildActivityReviewLog, collectActivityLogEntries } from "./lib/activityLog";
import { buildAgentWorkProjection } from "./lib/agentSessionProjection";
import {
  buildDailyAgentSessionContexts,
  projectActivitySessionLogEntries,
  reviewableActivityEvents,
  type ActivitySessionEvent,
} from "./lib/activityTimeline";
import { hasAiMetadataContract } from "../../../../shared/aiMetadata.mjs";
import { aiMetadataFromForm, themeDefaultAiVisibilityFromForm } from "./lib/aiMetadataForm";
import { buildDomainDrawerFormPlan, themeIntentFromForm } from "./lib/drawerFormPlans";
import type { SaveOperation } from "./types";
import { buildWorkspaceDomain } from "./domain-model/compat/legacyAdapter";
import {
  AppState,
  AppTitleBar,
  Sidebar,
  ShortcutDialog,
  type TitleBarLauncherData,
} from "./components/shell";
import { ContentViewer } from "./components/ContentViewer";
import { EntityDrawer } from "./components/drawer";
import { ContextPane } from "./components/contextPane";
import { WorkspacePageRouter } from "./components/WorkspacePageRouter";
import { currentWindowMode } from "./lib/windowMode";
import {
  isPersonalDefaultTheme,
  sortThemesWithDefaultFirst,
} from "../../../../shared/personalTheme.mjs";
import {
  CommandPalette,
  type CommandPaletteEntry,
  type CommandPaletteExecutionContext,
} from "./components/CommandPalette";
import { ContextPackDialog } from "./components/ContextPackDialog";
import { DailyScratchpadDialog } from "./components/DailyScratchpadDialog";
import { FocusSessionDialog } from "./components/FocusSessionDialog";
import {
  findActiveFocusSession,
  focusSessionProperties,
  focusSessionTaskId,
} from "../../../../shared/focusSession.mjs";
import { canonicalThemeId } from "../../../../shared/themeRef.mjs";
import type {
  ApplicationCommandSource,
  ApplyAiProposalCommandPayload,
  CommandEnvelope,
  CommandReceipt,
  ExpectedVersion,
} from "../../../../shared/applicationCommand";
import { collectionKeyForEntityType } from "../../../../shared/entityRegistry.mjs";
import { flushPendingNoteDraftSaves } from "./lib/noteDraftFlushRegistry";
import { flushPendingMediaRecordingFlushes } from "./lib/mediaRecordingFlushRegistry";
import { projectWorkspaceData } from "./lib/workspaceProjection";
import {
  buildDerivedFromDocumentCompanion,
  stripLineageDraftMetadata,
} from "./lib/lineageOperations";
import { buildRecallPaletteEntries, type RecallPaletteTarget } from "./lib/recallPaletteEntries";
const TASK_REFERENCE_TYPE: EntityType = "reference";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toastIcon(tone: ToastTone) {
  const ToastIcon = actionDefinition(TOAST_ACTIONS[tone]).icon;
  return ToastIcon ? <ToastIcon size={18} /> : null;
}

type FormSignatureScope = "all" | "checklist" | "non-checklist";

function isChecklistFormField(name: string): boolean {
  return (
    name === "checklist_id" ||
    name === "checklist_title" ||
    name.startsWith("checklist_done_") ||
    name.startsWith("checklist_completed_at_")
  );
}

function formSignature(form: HTMLFormElement, scope: FormSignatureScope = "all"): string {
  return JSON.stringify(
    Array.from(new FormData(form).entries())
      .filter(
        ([key]) =>
          scope === "all" ||
          (scope === "checklist" ? isChecklistFormField(key) : !isChecklistFormField(key)),
      )
      .map(([key, value]) => [key, typeof value === "string" ? value : value.name]),
  );
}

export function WorkspaceApp() {
  const workspace = useWorkspaceStore((state) => state.workspace);
  const loadState = useWorkspaceStore((state) => state.loadState);
  const loadError = useWorkspaceStore((state) => state.loadError);
  const loadWorkspaceAction = useWorkspaceStore((state) => state.load);
  const saveWorkspaceEntity = useWorkspaceStore((state) => state.save);
  const saveWorkspaceEntities = useWorkspaceStore((state) => state.saveMany);
  const applyCommandReceipt = useWorkspaceStore((state) => state.applyCommandReceipt);
  const removeWorkspaceEntity = useWorkspaceStore((state) => state.remove);
  const restoreWorkspaceEntity = useWorkspaceStore((state) => state.restore);
  const taskClient = useMemo(() => {
    if (!window.api?.task) throw new Error("Task capabilityを利用できません。");
    return createTaskClient(window.api.task);
  }, []);
  // 切り離しNoteウィンドウは本体と同じrendererを別モードで動かす（#290）。
  // Editorを二重に実装しないので、routeはNotesへ固定し外枠だけ落とす。
  const windowMode = useMemo(() => currentWindowMode(), []);
  const detachedNoteId = windowMode.kind === "note" ? windowMode.noteId : undefined;
  const storedRoute = useUiStore((state) => normalizeRoute(state.route));
  const route = detachedNoteId ? "notes" : storedRoute;
  const setRoute = useUiStore((state) => state.setRoute);
  const activeThemeId = useUiStore((state) => state.activeThemeId);
  const setActiveThemeId = useUiStore((state) => state.setActiveThemeId);
  const [drawer, setDrawer] = useState<DrawerConfig | null>(null);
  const [contentViewer, setContentViewer] = useState<ContentViewerTarget | null>(null);
  const toast = useUiStore((state) => state.toast);
  const toastToneValue = useUiStore((state) => state.toastTone);
  const setToast = useUiStore((state) => state.setToast);
  const themeMode = useUiStore((state) => state.themeMode);
  const setThemeMode = useUiStore((state) => state.setThemeMode);
  const activeGroups = useUiStore((state) => state.activeGroups);
  const setActiveGroups = useUiStore((state) => state.setActiveGroups);
  const setInboxLane = useUiStore((state) => state.setInboxLane);
  // 衛星ウィンドウの開閉・表示対象はMainのRegistry／IPC通知を購読する（#327）。
  const [openStickyMemoIds, setOpenStickyMemoIds] = useState<string[]>([]);
  const [stickyMemoTargetIds, setStickyMemoTargetIds] = useState<string[]>([]);
  const [todayWindowOpen, setTodayWindowOpen] = useState(false);
  const [snapshotPreview, setSnapshotPreview] = useState<SnapshotPreview | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [contextPackThemeId, setContextPackThemeId] = useState<string | null>(null);
  const [scratchpadDate, setScratchpadDate] = useState<string | null>(null);
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const closeContextPack = useCallback(() => setContextPackThemeId(null), []);
  const [sidebarCollapsed, setSidebarCollapsed] = usePreference("shell.sidebarCollapsed");
  const [sidebarWidth, setSidebarWidth] = usePreference("shell.sidebarWidth");
  const [zoomFactor, setZoomFactor] = usePreference("shell.zoomFactor");
  const [compactDrawerLayout, setCompactDrawerLayout] = useState(
    () => window.matchMedia("(max-width: 1680px)").matches,
  );
  const lastDeleted = useRef<{ type: EntityType; id: string } | null>(null);
  const drawerTrigger = useRef<HTMLElement | null>(null);
  const drawerGeneration = useRef(0);
  const compactDrawerClosing = useRef(false);
  const drawerFormRef = useRef<HTMLFormElement | null>(null);
  const drawerFormInitialSignature = useRef("");
  const drawerFormInitialChecklistSignature = useRef("");
  const drawerFormInitialNonChecklistSignature = useRef("");
  const [drawerFormDirty, setDrawerFormDirty] = useState(false);
  const drawerAutosavePromise = useRef<Promise<boolean> | null>(null);
  const noteAutoSaveTimer = useRef<number | null>(null);
  const noteAutoSaveTriggerRef = useRef<() => void>(() => {});
  const updateCheckStarted = useRef(false);
  /** 実行中Focusのtask id（#316）。global shortcutから最新値を読むため。 */
  const activeFocusTaskIdRef = useRef<string>("");
  const activityAutoExportRunning = useRef(false);
  const activityAutoExportFailedTarget = useRef("");
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const [sidebarResizeDraft, setSidebarResizeDraft] = useState<number | null>(null);
  const sidebarResizeDraftRef = useRef<number | null>(null);
  const sidebarResizeLastWidthRef = useRef(sidebarWidth);
  const sidebarResizeCollapsedRef = useRef(false);
  sidebarResizeDraftRef.current = sidebarResizeDraft;
  const effectiveSidebarWidth = sidebarResizeDraft ?? sidebarWidth;

  const handleSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      sidebarResizeLastWidthRef.current = sidebarWidth;
      sidebarResizeCollapsedRef.current = sidebarCollapsed;
      const collapseThreshold = 110;
      const onMove = (moveEvent: PointerEvent) => {
        const shellRect = appShellRef.current?.getBoundingClientRect();
        const rawWidth = moveEvent.clientX - (shellRect?.left ?? 0);
        if (rawWidth <= collapseThreshold) {
          sidebarResizeCollapsedRef.current = true;
          setSidebarCollapsed(true);
          sidebarResizeDraftRef.current = null;
          setSidebarResizeDraft(null);
          return;
        }
        sidebarResizeCollapsedRef.current = false;
        setSidebarCollapsed(false);
        const nextWidth = Math.max(180, Math.min(360, rawWidth));
        sidebarResizeLastWidthRef.current = nextWidth;
        sidebarResizeDraftRef.current = nextWidth;
        setSidebarResizeDraft(nextWidth);
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        if (!sidebarResizeCollapsedRef.current) {
          setSidebarWidth(sidebarResizeLastWidthRef.current);
          setSidebarCollapsed(false);
        }
        sidebarResizeDraftRef.current = null;
        setSidebarResizeDraft(null);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [setSidebarCollapsed, setSidebarWidth, sidebarCollapsed, sidebarWidth],
  );

  const handleSidebarResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (sidebarCollapsed) {
        if (event.key !== "ArrowRight") return;
        event.preventDefault();
        setSidebarCollapsed(false);
        setSidebarWidth(Math.max(180, Math.min(360, sidebarWidth)));
        return;
      }
      event.preventDefault();
      const delta = event.key === "ArrowLeft" ? -20 : 20;
      const nextWidth = sidebarWidth + delta;
      if (nextWidth <= 110) {
        setSidebarCollapsed(true);
        return;
      }
      setSidebarCollapsed(false);
      setSidebarWidth(Math.max(180, Math.min(360, nextWidth)));
    },
    [setSidebarCollapsed, setSidebarWidth, sidebarCollapsed, sidebarWidth],
  );

  async function loadWorkspace() {
    try {
      const loaded = await loadWorkspaceAction();
      setThemeMode((loaded.meta?.themeMode as "light" | "dark") || "light");
      const storedGroups = loaded.meta?.activeGroups;
      if (Array.isArray(storedGroups)) {
        setActiveGroups(storedGroups as string[]);
      } else if (typeof storedGroups === "string" && storedGroups) {
        setActiveGroups([storedGroups]);
        workspaceApi.setPreference("activeGroups", [storedGroups]).catch(() => {});
      } else {
        const legacy = loaded.meta?.activeGroup;
        const migrated = typeof legacy === "string" && legacy ? [legacy] : [];
        setActiveGroups(migrated);
        if (legacy) {
          workspaceApi.setPreference("activeGroups", migrated).catch(() => {});
          workspaceApi.setPreference("activeGroup", null).catch(() => {});
        }
      }
      if (!useUiStore.getState().activeThemeId) {
        setActiveThemeId(activeRecords((loaded.themes as Theme[]) || [])[0]?.id || "");
      }
    } catch {
      // loadStateにerrorが入るので画面側で再試行導線を出す。
    }
  }

  const refreshWorkspace = useWorkspaceStore((state) => state.refresh);
  const applyExternalSave = useWorkspaceStore((state) => state.applyExternalSave);
  const applyExternalSaves = useWorkspaceStore((state) => state.applyExternalSaves);

  useEffect(() => {
    void loadWorkspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mainの終了要求はrendererの保存完了ackを受け取ってから完了させる。
  // NotesPageの現在snapshotと、route unmount後も残るpending saveを合成してackする。
  useEffect(
    () =>
      workspaceApi.onAppFlushRequested((request) => {
        let settled = false;
        const respond = (ok: boolean) => {
          if (settled) return;
          settled = true;
          void workspaceApi.ackAppFlush(request.requestId, ok).catch(() => undefined);
        };
        const detail: {
          handled: boolean;
          flush: Promise<boolean> | null;
        } = { handled: false, flush: null };
        window.dispatchEvent(new CustomEvent("tasken:app-flush-requested", { detail }));
        // Notes routeがunmount済みでも、route cleanupが開始したsaveをここで待つ。
        const pageFlush = detail.flush || Promise.resolve(true);
        void Promise.all([
          pageFlush,
          flushPendingNoteDraftSaves(),
          flushPendingMediaRecordingFlushes(),
        ])
          .then(([pageOk, noteOk, mediaOk]) => respond(pageOk && noteOk && mediaOk))
          .catch(() => respond(false));
      }),
    [],
  );

  useEffect(() => {
    if (!window.api?.app?.onWorkspaceChanged) return;
    return window.api.app.onWorkspaceChanged((change) => {
      if (change?.entities?.length) {
        applyExternalSaves(change.entities);
        return;
      }
      if (change?.type && change.entity) {
        applyExternalSave(change.type, change.entity);
        void refreshWorkspace().catch((error) =>
          setToast(`更新を反映できませんでした。${errorMessage(error)}`, "danger"),
        );
        return;
      }
      void refreshWorkspace();
    });
  }, [applyExternalSave, applyExternalSaves, refreshWorkspace, setToast]);

  useEffect(() => {
    if (detachedNoteId) return undefined;
    const applyState = (state: {
      todayOpen: boolean;
      openMemoIds: string[];
      stickyMemoIds: string[];
      alwaysOnTopMemoIds: string[];
    }) => {
      setTodayWindowOpen(state.todayOpen);
      setOpenStickyMemoIds(state.openMemoIds);
      setStickyMemoTargetIds(state.stickyMemoIds);
    };
    void workspaceApi
      .getSatelliteWindowState()
      .then(applyState)
      .catch(() =>
        applyState({
          todayOpen: false,
          openMemoIds: [],
          stickyMemoIds: [],
          alwaysOnTopMemoIds: [],
        }),
      );
    return workspaceApi.onSatelliteWindowStateChanged(applyState);
  }, [detachedNoteId]);

  useEffect(() => {
    const onHash = () => setRoute(normalizeRoute(location.hash.slice(1) || "today"));
    onHash();
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, [setRoute]);

  useEffect(() => {
    const openPalette = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLocaleLowerCase() !== "k") return;
      const target = event.target as HTMLElement | null;
      const isEditing = Boolean(target?.closest("input, textarea, [contenteditable='true']"));
      if (!event.shiftKey && isEditing) return;
      event.preventDefault();
      setShowCommandPalette((current) => !current);
    };
    addEventListener("keydown", openPalette);
    return () => removeEventListener("keydown", openPalette);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1680px)");
    const updateLayout = () => setCompactDrawerLayout(query.matches);
    updateLayout();
    query.addEventListener("change", updateLayout);
    return () => query.removeEventListener("change", updateLayout);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    void workspaceApi.setTitleBarTheme(themeMode);
    void workspaceApi.setMemoStickyTheme(themeMode);
    if (loadState === "success") {
      workspaceApi.setPreference("themeMode", themeMode).catch((error) => {
        setToast(`表示設定を保存できませんでした。${errorMessage(error)}`, "danger");
      });
    }
  }, [themeMode, loadState, setToast]);

  useEffect(() => {
    const normalized = Math.min(1.3, Math.max(0.8, Math.round(zoomFactor * 10) / 10));
    if (normalized !== zoomFactor) setZoomFactor(normalized);
  }, [zoomFactor, setZoomFactor]);

  useEffect(() => {
    if (loadState === "success") {
      workspaceApi.setPreference("activeGroups", activeGroups).catch(() => {});
    }
  }, [activeGroups, loadState]);

  useEffect(() => {
    if (loadState !== "success" || updateCheckStarted.current) return undefined;
    updateCheckStarted.current = true;
    let canceled = false;
    const timer = window.setTimeout(() => {
      workspaceApi
        .checkForUpdates()
        .then((result) => {
          if (!canceled && result.status === "available") {
            setToast(
              `Tasken ${result.latestVersion} が公開されています。Settingsで更新できます。`,
              "info",
            );
          }
        })
        .catch(() => {});
    }, 1200);
    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [loadState, setToast]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(""), lastDeleted.current ? 4500 : 3200);
    return () => clearTimeout(timer);
  }, [toast, setToast]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const inInput =
        ["INPUT", "TEXTAREA", "SELECT"].includes(tag ?? "") || target?.isContentEditable;
      if (event.key === "Escape") {
        if (showShortcuts) setShowShortcuts(false);
        else if (drawer) closeDrawer();
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "s" &&
        drawerFormRef.current
      ) {
        event.preventDefault();
        void saveDirtyDrawerForm();
        return;
      }
      if (inInput) return;
      if (event.key === "?") {
        event.preventDefault();
        setShowShortcuts((current) => !current);
      }
      if (event.altKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        openDrawer({
          type: "capture_entry",
          mode: "edit",
          entity: { state: "untriaged", captured_at: new Date().toISOString().slice(0, 10) },
        });
      }
      // 実行中のFocus Sessionをどの画面からでも開く（#316）。Alt+N（クイック記録）と同系列。
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "f") {
        const taskId = activeFocusTaskIdRef.current;
        if (!taskId) return;
        event.preventDefault();
        setFocusTaskId(taskId);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawer, showShortcuts]);

  const fullData = useMemo(
    () => projectWorkspaceData(workspace as Record<string, unknown> | null),
    [workspace],
  );
  const fullDomain = useMemo(() => buildWorkspaceDomain(fullData), [fullData]);
  // 常設の既定Themeは並びの先頭へ固定し、グループ絞り込みでも消さない（#282）。
  // Themeが0件に見える状態でも個人業務は残る。
  const allThemes = useMemo(
    () => sortThemesWithDefaultFirst(fullData.themes) as Theme[],
    [fullData.themes],
  );
  const themes = useMemo(
    () =>
      activeGroups.length > 0
        ? allThemes.filter(
            (theme) => activeGroups.includes(theme.group || "") || isPersonalDefaultTheme(theme),
          )
        : allThemes,
    [activeGroups, allThemes],
  );
  const groupThemeIds = useMemo(() => new Set(themes.map((t) => t.id)), [themes]);
  const hasGroupFilter = activeGroups.length > 0;

  const data = useMemo(() => {
    if (!hasGroupFilter) return fullData;
    const match = (themeId: unknown) => typeof themeId === "string" && groupThemeIds.has(themeId);
    return {
      ...fullData,
      themes,
      items: fullData.items.filter((i) => match(i.theme_id)),
      notes: fullData.notes.filter((note) => match(noteProjectId(note))),
      links: fullData.links.filter((l) => match(l.theme_id)),
      status_updates: fullData.status_updates.filter((u) => match(u.theme_id)),
      knowledge_nodes: fullData.knowledge_nodes.filter((k) => match(k.theme_id)),
    };
  }, [fullData, hasGroupFilter, groupThemeIds, themes]);

  const domain = useMemo(() => {
    if (!hasGroupFilter) return fullDomain;
    const match = (projectId: unknown) =>
      typeof projectId === "string" && groupThemeIds.has(projectId);
    const tasks = fullDomain.tasks.filter((t) => match(t.project_id));
    const waitings = fullDomain.waitings.filter((w) => match(w.project_id));
    const plan_nodes = fullDomain.plan_nodes.filter((p) => match(p.project_id));
    const taskIds = new Set(tasks.map((t) => t.id));
    const waitingIds = new Set(waitings.map((w) => w.id));
    const planNodeIds = new Set(plan_nodes.map((p) => p.id));
    const ownerKey = (s: { owner_type: string; owner_id: string }) =>
      `${s.owner_type}:${s.owner_id}`;
    const ownerSet = new Set([
      ...tasks.map((t) => `task:${t.id}`),
      ...waitings.map((w) => `waiting:${w.id}`),
      ...plan_nodes.map((p) => `plan_node:${p.id}`),
    ]);
    return {
      ...fullDomain,
      tasks,
      waitings,
      plan_nodes,
      schedules: fullDomain.schedules.filter((s) => ownerSet.has(ownerKey(s))),
      knowledge_nodes: fullDomain.knowledge_nodes.filter((k) => match(k.project_id)),
      notes: fullDomain.notes.filter((n) => match(n.project_id)),
      resources: fullDomain.resources.filter((r) => match(r.project_id)),
      task_dependencies: fullDomain.task_dependencies.filter(
        (d) => taskIds.has(d.task_id) && taskIds.has(d.depends_on_task_id),
      ),
      plan_dependencies: fullDomain.plan_dependencies.filter(
        (d) => planNodeIds.has(d.plan_node_id) && planNodeIds.has(d.depends_on_plan_node_id),
      ),
    };
  }, [fullDomain, hasGroupFilter, groupThemeIds]);

  const items = data.items;
  const notes = data.notes;
  const links = data.links;
  const activeTheme = themes.find((theme) => theme.id === activeThemeId) || themes[0] || null;
  const activeFocusSession = useMemo(
    () =>
      findActiveFocusSession(
        fullData.notes as unknown as Array<Record<string, unknown>>,
      ) as BaseRecord | null,
    [fullData.notes],
  );
  const activeFocusTask =
    fullDomain.tasks.find((task) => task.id === focusSessionTaskId(activeFocusSession)) || null;
  // global shortcutは登録時のclosureを見るので、最新のtask idはrefで渡す（#316）。
  activeFocusTaskIdRef.current = activeFocusTask?.id || "";

  function startFocusSession(taskId: string) {
    const activeTaskId = focusSessionTaskId(activeFocusSession);
    if (activeTaskId && activeTaskId !== taskId) {
      setFocusTaskId(activeTaskId);
      setToast(
        `進行中のFocus Session「${activeFocusTask?.title || "Task"}」を再開しました。終了後に別のTaskを開始できます。`,
        "info",
      );
      return;
    }
    setFocusTaskId(taskId);
  }

  useEffect(() => {
    if (loadState !== "success") return undefined;
    let canceled = false;

    async function autoExportActivityLog(): Promise<void> {
      if (activityAutoExportRunning.current) return;
      const now = new Date();
      const current = localDateAndTime(now);
      let activeTargetDate = "";
      let activeDirectory = "";
      activityAutoExportRunning.current = true;
      try {
        const [time, directory, artifactDirectory, lastExportDate] = await Promise.all([
          workspaceApi.getPreference("activityLogAutoExportTime"),
          workspaceApi.getPreference("activityLogDirectory"),
          workspaceApi.getPreference("artifactDirectory"),
          workspaceApi.getPreference("activityLogLastAutoExportDate"),
        ]);
        activeDirectory = resolveActivityLogDirectory(directory, artifactDirectory);
        const targetDates = activityDatesToAutoExport({
          now,
          time,
          directory: activeDirectory,
          lastExportDate,
        });
        if (!targetDates.length || canceled) return;
        if (activityAutoExportFailedTarget.current === `${targetDates[0]}:${activeDirectory}`)
          return;

        await runActivityAutoExport({
          dates: targetDates,
          exportDate: async (targetDate) => {
            activeTargetDate = targetDate;
            const activityInput = {
              date: targetDate,
              domain: fullDomain,
              statusUpdates: fullData.status_updates || [],
              themes: allThemes,
              changeEvents: fullDomain.change_events as unknown as Array<Record<string, unknown>>,
              references: fullDomain.references as unknown as Array<Record<string, unknown>>,
              artifacts: fullData.artifacts as unknown as Array<Record<string, unknown>>,
              roots: fullData.canonical_root_status,
              timezone: "Asia/Tokyo",
            };
            const sessionEvents = reviewableActivityEvents(
              collectActivityLogEntries(activityInput).events as ActivitySessionEvent[],
            );
            const sessionRows = buildAgentWorkProjection(fullDomain, {
              limit: Math.max(fullDomain.agent_sessions.length, 1),
            });
            const sessionContexts = buildDailyAgentSessionContexts(
              sessionRows,
              targetDate,
              sessionEvents,
            );
            const result = await workspaceApi.exportMarkdownFile({
              title: `Tasken Activity Log ${targetDate}`,
              fileName: `tasken-activity-${targetDate}.md`,
              content: buildActivityReviewLog(
                activityInput,
                projectActivitySessionLogEntries(sessionContexts, allThemes),
              ),
              directory: activeDirectory,
              chooseDirectory: false,
            });
            if (canceled || result.canceled) throw new Error("自動出力を中断しました。");
          },
          markExported: (targetDate) =>
            workspaceApi.setPreference("activityLogLastAutoExportDate", targetDate).then(() => {}),
        });
        if (!canceled) {
          const period =
            targetDates.length === 1 ? targetDates[0] : `${targetDates[0]}〜${targetDates.at(-1)}`;
          setToast(
            `Activity Logを${targetDates.length}日分、自動出力しました。${period}`,
            "success",
          );
        }
      } catch (error) {
        activityAutoExportFailedTarget.current = `${activeTargetDate || current.date}:${activeDirectory}`;
        if (!canceled) {
          setToast(
            `Activity Log ${activeTargetDate || current.date}の自動出力に失敗しました。次回起動時に再試行します。${errorMessage(error)}`,
            "danger",
          );
        }
      } finally {
        activityAutoExportRunning.current = false;
      }
    }

    void autoExportActivityLog();
    const timer = window.setInterval(() => void autoExportActivityLog(), 60000);
    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [allThemes, fullData, fullDomain, loadState, setToast]);

  const handleDrawerFormInput = useCallback((event: Event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && isChecklistFormField(target.name)) return;
    setDrawerFormDirty(true);
    noteAutoSaveTriggerRef.current();
  }, []);
  const markDrawerFormDirty = useCallback(() => setDrawerFormDirty(true), []);

  const registerEditForm = useCallback(
    (form: HTMLFormElement | null) => {
      const previous = drawerFormRef.current;
      if (previous && previous !== form)
        previous.removeEventListener("input", handleDrawerFormInput);
      if (noteAutoSaveTimer.current) {
        window.clearTimeout(noteAutoSaveTimer.current);
        noteAutoSaveTimer.current = null;
      }
      drawerAutosavePromise.current = null;
      drawerFormRef.current = form;
      drawerFormInitialSignature.current = form ? formSignature(form) : "";
      drawerFormInitialChecklistSignature.current = form ? formSignature(form, "checklist") : "";
      drawerFormInitialNonChecklistSignature.current = form
        ? formSignature(form, "non-checklist")
        : "";
      setDrawerFormDirty(false);
      if (form) form.addEventListener("input", handleDrawerFormInput);
    },
    [handleDrawerFormInput],
  );

  function isDrawerFormDirty(): boolean {
    const form = drawerFormRef.current;
    return Boolean(
      form &&
      drawer &&
      (formSignature(form, "checklist") !== drawerFormInitialChecklistSignature.current ||
        formSignature(form, "non-checklist") !== drawerFormInitialNonChecklistSignature.current),
    );
  }

  const registerDrawerSave = useCallback((promise: Promise<boolean>) => {
    drawerAutosavePromise.current = promise;
  }, []);

  const markChecklistSaved = useCallback(() => {
    const form = drawerFormRef.current;
    if (!form || form.dataset.entityType !== "task") return;
    drawerFormInitialChecklistSignature.current = formSignature(form, "checklist");
    setDrawerFormDirty(
      formSignature(form, "non-checklist") !== drawerFormInitialNonChecklistSignature.current,
    );
  }, []);

  // 既存メモのメタ（タイトル・種別など）は入力が止まって1.5秒後に静かに自動保存する。
  // 本文は Notes 中央エリアの正本。新規作成中（entity.id未確定）やタイトルが空の間は対象外。
  async function autoSaveNoteDrawerForm(): Promise<void> {
    const form = drawerFormRef.current;
    if (!form || !drawer || drawer.type !== "note" || !drawer.entity?.id) return;
    if (drawerAutosavePromise.current || !isDrawerFormDirty()) return;
    const values = new FormData(form);
    if (!formText(values, "title")) return;
    const saving = saveFormElement(form, { closeAfterSave: false, quiet: true });
    drawerAutosavePromise.current = saving;
    try {
      await saving;
    } catch {
      // 失敗時はsaveEntity側で既にエラートーストを出しているため、ここでは自動保存を諦めるだけでよい。
    } finally {
      if (drawerAutosavePromise.current === saving) drawerAutosavePromise.current = null;
    }
  }

  useEffect(() => {
    noteAutoSaveTriggerRef.current = () => {
      if (!drawer || drawer.type !== "note" || !drawer.entity?.id) return;
      if (noteAutoSaveTimer.current) window.clearTimeout(noteAutoSaveTimer.current);
      noteAutoSaveTimer.current = window.setTimeout(() => {
        void autoSaveNoteDrawerForm();
      }, 1500);
    };
  });

  useEffect(
    () => () => {
      if (noteAutoSaveTimer.current) window.clearTimeout(noteAutoSaveTimer.current);
    },
    [],
  );

  async function saveDirtyDrawerForm(): Promise<boolean> {
    const form = drawerFormRef.current;
    if (!form || !drawer) return true;
    if (noteAutoSaveTimer.current) {
      window.clearTimeout(noteAutoSaveTimer.current);
      noteAutoSaveTimer.current = null;
    }
    const pending = drawerAutosavePromise.current;
    if (pending) {
      try {
        if (!(await pending)) return false;
      } catch {
        return false;
      }
    }
    if (!isDrawerFormDirty()) return true;
    const saving = saveFormElement(form, { closeAfterSave: false });
    drawerAutosavePromise.current = saving;
    try {
      const saved = await saving;
      return saved;
    } catch {
      return false;
    } finally {
      if (drawerAutosavePromise.current === saving) drawerAutosavePromise.current = null;
    }
  }

  async function dismissCompactDrawer(generation: number): Promise<void> {
    if (compactDrawerClosing.current || generation !== drawerGeneration.current) return;
    compactDrawerClosing.current = true;
    try {
      if (!(await saveDirtyDrawerForm()) || generation !== drawerGeneration.current) return;
      drawerGeneration.current += 1;
      setDrawer(null);
    } finally {
      compactDrawerClosing.current = false;
    }
  }

  useEffect(() => {
    const isSketchEditorDrawer = route === "sketch-editor" && drawer?.type === "sketch";
    if (!drawer || contentViewer || (!compactDrawerLayout && !isSketchEditorDrawer))
      return undefined;
    const generation = drawerGeneration.current;
    const isProtectedSurface = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return true;
      return Boolean(
        target.closest(".drawer, .content-viewer-overlay, .shortcut-overlay, .context-menu"),
      );
    };
    const isSketchWorkSurface = (target: EventTarget | null) =>
      isSketchEditorDrawer &&
      target instanceof Element &&
      Boolean(
        target.closest(
          ".sketch-toolbar, .sketch-page-rail, .sketch-canvas-area, .sketch-bottom-controls",
        ),
      );
    const isActionTrigger = (target: EventTarget | null) =>
      target instanceof Element && Boolean(target.closest("button, a, [role='button']"));
    const onPointerDown = (event: PointerEvent) => {
      if (isProtectedSurface(event.target) || isActionTrigger(event.target)) return;
      void dismissCompactDrawer(generation);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (isProtectedSurface(event.target) || isActionTrigger(event.target)) return;
      void dismissCompactDrawer(generation);
    };
    const onClick = (event: MouseEvent) => {
      if (isProtectedSurface(event.target) || !isSketchWorkSurface(event.target)) return;
      void dismissCompactDrawer(generation);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("click", onClick);
    };
    // saveDirtyDrawerFormは現在開いているフォームを参照するため、drawerの世代変更時だけ購読し直す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawer, compactDrawerLayout, contentViewer, route]);

  function navigate(next: string) {
    void (async () => {
      if (!(await saveDirtyDrawerForm())) return;
      drawerGeneration.current += 1;
      setDrawer(null);
      const normalized = normalizeRoute(next);
      location.hash = normalized;
      setRoute(normalized);
    })();
  }

  function openDrawer(config: DrawerConfig) {
    void (async () => {
      if (!(await saveDirtyDrawerForm())) return;
      drawerTrigger.current = document.activeElement as HTMLElement | null;
      drawerGeneration.current += 1;
      setDrawer(config);
    })();
  }

  function openSketchEditor(entity: DrawerEntity) {
    void (async () => {
      if (!(await saveDirtyDrawerForm())) return;
      localStorage.setItem("tasken:sketch:active-id", String(entity.id || ""));
      drawerTrigger.current = document.activeElement as HTMLElement | null;
      drawerGeneration.current += 1;
      location.hash = "sketch-editor";
      setRoute("sketch-editor");
      setDrawer({ type: "sketch", mode: "edit", entity });
    })();
  }

  function openContentViewer(target: ContentViewerTarget) {
    setContentViewer(target);
  }

  function closeContentViewer() {
    setContentViewer(null);
  }

  function closeDrawer(next: DrawerConfig | null = null) {
    void (async () => {
      if (!(await saveDirtyDrawerForm())) return;
      drawerGeneration.current += 1;
      setDrawer((current) =>
        next && current?.dataScope === "full" && !next.dataScope
          ? { ...next, dataScope: "full" }
          : next,
      );
      if (!next) {
        requestAnimationFrame(() => {
          const trigger = drawerTrigger.current;
          if (trigger?.isConnected) trigger.focus({ preventScroll: true });
          else document.querySelector<HTMLElement>(".main-area")?.focus({ preventScroll: true });
        });
      }
    })();
  }

  useEffect(() => {
    if (!window.api?.app?.onOpenTaskDetail || loadState !== "success") return undefined;
    return window.api.app.onOpenTaskDetail((taskId) => {
      const task = fullDomain.tasks.find((entry) => entry.id === taskId);
      if (!task) {
        setToast("タスクを開けませんでした。画面を更新してもう一度試してください。", "danger");
        return;
      }
      const schedule = fullDomain.schedules.find(
        (entry) => entry.owner_type === "task" && entry.owner_id === task.id,
      );
      location.hash = "todo";
      setRoute("todo");
      openDrawer({
        type: "task",
        mode: "edit",
        entity: { ...task, _schedule: schedule } as Record<string, unknown>,
      });
    });
  }, [fullDomain, loadState, setRoute, setToast]);

  useEffect(() => {
    if (!window.api?.app?.onOpenTaskenRootTarget || detachedNoteId || loadState !== "success")
      return undefined;
    return window.api.app.onOpenTaskenRootTarget((request) => {
      if (request.kind === "command") {
        if (request.id === "create:capture") {
          openDrawer({
            type: "capture_entry",
            mode: "edit",
            entity: { state: "untriaged", captured_at: new Date().toISOString() },
          });
          return;
        }
        if (request.id.startsWith("navigate:")) navigate(request.id.slice("navigate:".length));
        return;
      }
      if (request.kind === "task") {
        const task = fullDomain.tasks.find((entry) => entry.id === request.id);
        if (!task) {
          setToast("Taskを開けませんでした。画面を更新してもう一度試してください。", "danger");
          return;
        }
        if (request.action === "focus") {
          startFocusSession(task.id);
          return;
        }
        const schedule = fullDomain.schedules.find(
          (entry) => entry.owner_type === "task" && entry.owner_id === task.id,
        );
        location.hash = "todo";
        setRoute("todo");
        openDrawer({
          type: "task",
          mode: request.action === "edit" ? "edit" : undefined,
          entity: { ...task, _schedule: schedule } as Record<string, unknown>,
        });
        return;
      }
      if (request.kind === "note") {
        const note = fullDomain.notes.find((entry) => entry.id === request.id);
        if (!note) {
          setToast("Noteを開けませんでした。画面を更新してもう一度試してください。", "danger");
          return;
        }
        location.hash = "notes";
        setRoute("notes");
        window.dispatchEvent(new CustomEvent("tasken:select-note", { detail: note.id }));
        return;
      }
      if (request.kind === "theme") {
        const theme = allThemes.find((entry) => entry.id === request.id);
        if (!theme) return;
        setActiveThemeId(theme.id);
        navigate("theme");
        return;
      }
      if (request.kind === "resource") {
        const resource = fullDomain.resources.find((entry) => entry.id === request.id);
        if (resource)
          openDrawer({ type: "resource", entity: resource as unknown as Record<string, unknown> });
        return;
      }
      if (request.kind === "artifact") {
        const artifact = (fullData.artifacts || []).find((entry) => entry.id === request.id);
        if (artifact) openContentViewer({ type: "artifact", artifactId: artifact.id });
      }
    });
  }, [
    allThemes,
    detachedNoteId,
    fullData.artifacts,
    fullDomain,
    loadState,
    setActiveThemeId,
    setRoute,
    setToast,
  ]);

  // 切り離しウィンドウから本体へ表示を渡す（#290 / #298）。本体側だけが受ける。
  useEffect(() => {
    if (detachedNoteId || loadState !== "success") return undefined;
    const unsubscribers = [
      window.api?.app?.onOpenNote?.((noteId) => {
        location.hash = "notes";
        setRoute("notes");
        // NotesPageは自分でこのイベントを拾って対象Noteを選ぶ。
        window.dispatchEvent(new CustomEvent("tasken:select-note", { detail: noteId }));
      }),
      window.api?.app?.onOpenMemo?.(() => {
        location.hash = "inbox";
        setRoute("inbox");
        setInboxLane("micro");
      }),
      window.api?.app?.onNavigate?.((next) => {
        const normalized = normalizeRoute(next);
        location.hash = normalized;
        setRoute(normalized);
      }),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe?.();
    };
  }, [detachedNoteId, loadState, setInboxLane, setRoute]);

  const saveEntity: SaveEntity = async (
    type,
    entity,
    options = {},
    documentSnapshot?: DocumentSaveSnapshot,
    documentCompanions: DocumentSaveReferenceCompanion[] = [],
  ) => {
    try {
      if (type === "task") {
        const existing = fullDomain.tasks.find((candidate) => candidate.id === entity.id);
        const context = {
          commandId: uuid(),
          issuedAt: new Date().toISOString(),
          entrypoint: drawer?.commandSource || "main_ui",
        } as const;
        const outcome = await taskClient.applyEdit(
          projectTaskDraft(entity),
          existing
            ? { state: existing.state, version: Number((existing as unknown as Entity).version || 0) }
            : null,
          context,
        );
        if (!outcome.task) throw new Error("Task commandの結果にTaskがありません。");
        applyExternalSave("task", outcome.task as unknown as Entity);
        if (!options.quiet)
          setToast(entity.id ? "変更を保存しました。" : "追加しました。", "success");
        return outcome.task as unknown as Entity;
      }
      const saved =
        type === "note"
          ? await workspaceApi.saveDocument({
              entity: entity as Entity,
              snapshot: documentSnapshot || {
                owner: { recordType: "note", entityId: String(entity.id) },
                body: String(entity.body_markdown ?? ""),
                expectedRevision: Number(entity.version || 0),
              },
              options,
              companions: documentCompanions,
            })
          : await saveWorkspaceEntity(type, entity as Entity, options);
      if (!options.quiet) {
        const binding =
          saved.properties_json && typeof saved.properties_json === "object"
            ? (saved.properties_json as Record<string, unknown>).canonical_markdown
            : null;
        const syncState =
          binding && typeof binding === "object" && !Array.isArray(binding)
            ? String((binding as Record<string, unknown>).sync_state || "")
            : "";
        if (type === "note" && syncState === "conflict") {
          setToast(
            "Taskenへ保存しましたが、Markdownが外部で変更されています。内容を確認して再試行してください。",
            "warning",
          );
        } else if (type === "note" && ["internal_ahead", "unavailable"].includes(syncState)) {
          setToast(
            "Taskenへ保存しましたが、Markdownを更新できませんでした。保存先を確認して再試行してください。",
            "warning",
          );
        } else {
          setToast(entity.id ? "変更を保存しました。" : "追加しました。", "success");
        }
      }
      return saved;
    } catch (error) {
      setToast(`保存できませんでした。${errorMessage(error)}`, "danger");
      throw error;
    }
  };

  const executeTaskWorkCommand = async (envelope: CommandEnvelope): Promise<CommandReceipt> => {
    const receipt = await workspaceApi.executeCommand(envelope);
    applyCommandReceipt(receipt);
    return receipt;
  };

  const createTaskFromCapture = async (
    task: Entity,
    schedule: Entity | null,
    capture: Entity,
    artifactIds: string[],
  ): Promise<CommandReceipt> => {
    const currentCapture =
      fullData.capture_entrys?.find((entry) => entry.id === capture.id) || capture;
    const expectedVersions: ExpectedVersion[] = [
      {
        type: "capture_entry",
        id: currentCapture.id,
        version: Number(currentCapture.version || 0),
      },
    ];
    for (const artifactId of artifactIds) {
      const artifact = (fullData.artifacts || []).find((entry) => entry.id === artifactId);
      if (!artifact) throw new Error(`Artifactが見つかりません: ${artifactId}`);
      expectedVersions.push({
        type: "artifact",
        id: artifact.id,
        version: Number(artifact.version || 0),
      });
    }
    if (schedule) {
      const existingSchedule = fullDomain.schedules.find((entry) => entry.id === schedule.id);
      if (existingSchedule)
        expectedVersions.push({
          type: "schedule",
          id: existingSchedule.id,
          version: Number((existingSchedule as unknown as Entity).version || 0),
        });
    }
    const receipt = await workspaceApi.executeCommand({
      commandId: uuid(),
      name: "CreateTaskFromCapture",
      payload: {
        task,
        schedule,
        captureId: currentCapture.id,
        captureVersion: Number(currentCapture.version || 0),
        transition: "triage_to_task",
        artifactIds,
      },
      actor: { kind: "user" },
      source: "inbox",
      expectedVersions,
      issuedAt: new Date().toISOString(),
    });
    applyCommandReceipt(receipt);
    setToast("CaptureをTaskに整理しました。", "success");
    return receipt;
  };

  const saveEntities: SaveEntities = async (
    operations,
    successMessage = "変更を保存しました。",
    source: ApplicationCommandSource = drawer?.commandSource || "main_ui",
  ) => {
    try {
      // Taskの書き込みは、画面・Today・Inbox・補助windowを問わず同じ
      // Application Commandへ集約する。旧renderer event生成はここで除去し、
      // Main側のbefore/after判定を唯一のChange Event producerにする。
      let saved: Entity[] = [];
      const taskOperations = operations.filter((operation) => operation.type === "task");
      const taskIds = new Set(taskOperations.map((operation) => operation.entity.id));
      const remaining = operations.filter((operation) => {
        if (operation.type === "task" && taskIds.has(operation.entity.id)) return false;
        if (
          operation.type === "schedule" &&
          operation.entity.owner_type === "task" &&
          taskIds.has(String(operation.entity.owner_id))
        )
          return false;
        return !(
          operation.type === "change_event" &&
          operation.entity.entity_type === "task" &&
          taskIds.has(String(operation.entity.entity_id))
        );
      });
      const taskReferences = remaining.filter(
        (operation) =>
          operation.type === TASK_REFERENCE_TYPE &&
          (taskIds.has(String(operation.entity.source_id)) ||
            taskIds.has(String(operation.entity.target_id))),
      );
      const unsupportedMixed = remaining.filter((operation) => !taskReferences.includes(operation));

      const entityOperations = operations.filter((operation) => operation.type !== "change_event");
      const existingRecord = (type: EntityType, id: string): Entity | undefined => {
        const collection = collectionKeyForEntityType(type);
        const records = (fullData as unknown as Record<string, unknown>)[collection];
        return Array.isArray(records)
          ? records.find(
              (record): record is Entity =>
                Boolean(record) && typeof record === "object" && (record as Entity).id === id,
            )
          : undefined;
      };
      const expectedFor = (type: EntityType, id: string): ExpectedVersion | null => {
        const existing = existingRecord(type, id);
        return existing ? { type, id, version: Number(existing.version || 0) } : null;
      };
      const executeTyped = async (envelope: CommandEnvelope): Promise<CommandReceipt> => {
        const receipt = await workspaceApi.executeCommand(envelope);
        applyCommandReceipt(receipt);
        saved = [...saved, ...receipt.changes.map(({ entity }) => entity)];
        return receipt;
      };

      // 学び付き完了は、繰返しの次Task/Scheduleも含めて一つのCommandへ写す。
      const learningNoteOperation = entityOperations.find(
        (operation) =>
          operation.type === "note" &&
          operation.entity.note_type === "learning" &&
          typeof operation.entity.item_id === "string",
      );
      if (taskOperations.length && learningNoteOperation?.type === "note") {
        const taskId = String(learningNoteOperation.entity.item_id);
        const currentTaskOperation = taskOperations.find(
          (operation) => operation.entity.id === taskId,
        );
        const nextTaskOperations = taskOperations.filter(
          (operation) => operation.entity.id !== taskId,
        );
        const nextScheduleOperations = entityOperations.filter(
          (operation) =>
            operation.type === "schedule" &&
            nextTaskOperations.some((task) => task.entity.id === operation.entity.owner_id),
        );
        const learningRepresentedCount = taskOperations.length + 1 + nextScheduleOperations.length;
        const learningEntitiesAreExplicit =
          currentTaskOperation &&
          nextTaskOperations.length <= 1 &&
          nextScheduleOperations.length <= 1 &&
          learningRepresentedCount === entityOperations.length &&
          entityOperations.every(
            (operation) =>
              operation.type === "task" ||
              operation.type === "note" ||
              operation.type === "schedule",
          ) &&
          entityOperations.filter((operation) => operation.type === "note").length === 1;
        if (learningEntitiesAreExplicit && currentTaskOperation) {
          const expected = expectedFor("task", taskId);
          if (!expected) throw new Error("学び付き完了のTaskがWorkspaceにありません。");
          await executeTyped({
            commandId: uuid(),
            name: "CompleteTaskWithLearning",
            payload: {
              task: currentTaskOperation.entity,
              note: learningNoteOperation.entity,
              nextTask: nextTaskOperations[0]?.entity || null,
              nextSchedule: nextScheduleOperations[0]?.entity || null,
            },
            actor: { kind: "user" },
            source,
            expectedVersions: [expected],
            issuedAt: new Date().toISOString(),
          });
          setToast(successMessage, "success");
          return saved;
        }
      }

      // Focus終了はsession、選択Note、学びのpromoted Note/Reference、次Task、
      // status updateを名前付きpayloadへ写し、旧saveManyの部分commitを許さない。
      const focusSessionOperations = entityOperations.filter(
        (operation) =>
          operation.type === "note" &&
          (operation.entity.properties_json as Record<string, unknown> | undefined)
            ?.document_role === "focus_session" &&
          (operation.entity.properties_json as Record<string, unknown> | undefined)
            ?.session_state === "ended",
      );
      const focusSessionOperation = focusSessionOperations[0];
      if (taskOperations.length && focusSessionOperation?.type === "note") {
        const sessionProps = focusSessionOperation.entity.properties_json as Record<
          string,
          unknown
        >;
        const focusTaskId = typeof sessionProps.task_id === "string" ? sessionProps.task_id : "";
        const currentTaskOperation = taskOperations.find(
          (operation) => operation.entity.id === focusTaskId,
        );
        const noteOperations = entityOperations.filter(
          (operation) => operation.type === "note" && operation !== focusSessionOperation,
        );
        const existingNotes = noteOperations.filter((operation) =>
          Boolean(existingRecord("note", operation.entity.id)),
        );
        const promotedNotes = noteOperations.filter(
          (operation) => !existingRecord("note", operation.entity.id),
        );
        const referenceOperations = entityOperations.filter(
          (operation) => operation.type === TASK_REFERENCE_TYPE,
        );
        const statusOperations = entityOperations.filter(
          (operation) => operation.type === "status_update",
        );
        const nextTaskOperations = taskOperations.filter(
          (operation) => operation.entity.id !== focusTaskId,
        );
        const representedCount =
          1 +
          (currentTaskOperation ? 1 : 0) +
          noteOperations.length +
          referenceOperations.length +
          statusOperations.length +
          nextTaskOperations.length;
        const focusTypesAreExplicit =
          entityOperations.every(
            (operation) =>
              operation.type === "task" ||
              operation.type === "note" ||
              operation.type === TASK_REFERENCE_TYPE ||
              operation.type === "status_update",
          ) &&
          representedCount === entityOperations.length &&
          focusSessionOperations.length === 1 &&
          existingNotes.length <= 1 &&
          promotedNotes.length <= 1 &&
          referenceOperations.length <= 1 &&
          statusOperations.length <= 1 &&
          nextTaskOperations.length <= 1 &&
          !entityOperations.some(
            (operation) =>
              operation.type === "task" &&
              operation.entity.id === focusTaskId &&
              operation.entity.state !== "done",
          );
        if (
          focusTypesAreExplicit &&
          focusTaskId &&
          (!currentTaskOperation || currentTaskOperation.entity.state === "done")
        ) {
          const sessionExpected = expectedFor("note", focusSessionOperation.entity.id);
          if (!sessionExpected) throw new Error("Focus SessionがWorkspaceにありません。");
          const expectedVersions = [sessionExpected];
          if (currentTaskOperation) {
            const taskExpected = expectedFor("task", focusTaskId);
            if (!taskExpected) throw new Error("Focus SessionのTaskがWorkspaceにありません。");
            expectedVersions.push(taskExpected);
          }
          if (existingNotes[0]) {
            const noteExpected = expectedFor("note", existingNotes[0].entity.id);
            if (!noteExpected) throw new Error("Focus Sessionの選択NoteがWorkspaceにありません。");
            expectedVersions.push(noteExpected);
          }
          await executeTyped({
            commandId: uuid(),
            name: "EndFocusSession",
            payload: {
              session: focusSessionOperation.entity,
              task: currentTaskOperation?.entity || existingRecord("task", focusTaskId) || null,
              selectedNote: existingNotes[0]?.entity || null,
              promotedNote: promotedNotes[0]?.entity || null,
              promotedReference:
                referenceOperations[0]?.type === TASK_REFERENCE_TYPE
                  ? referenceOperations[0].entity
                  : null,
              nextTask: nextTaskOperations[0]?.entity || null,
              statusUpdate:
                statusOperations[0]?.type === "status_update" ? statusOperations[0].entity : null,
              completeTask: Boolean(currentTaskOperation),
            },
            actor: { kind: "user" },
            source,
            expectedVersions,
            issuedAt: new Date().toISOString(),
          });
          setToast(successMessage, "success");
          return saved;
        }
      }

      // AI Proposalは候補集合を型付きcandidateへ変換する。候補数・型に制限を
      // 設けた汎用SaveOperationの代替であり、proposal状態更新まで同じtransaction。
      const proposalOperation = entityOperations.find(
        (operation) => operation.type === "ai_proposal",
      );
      const aiCandidateOperations = entityOperations.filter(
        (operation) => operation.type !== "ai_proposal",
      );
      if (proposalOperation?.type === "ai_proposal" && aiCandidateOperations.length) {
        const candidates = aiCandidateOperations.map((operation) => ({
          type: operation.type,
          entity: operation.entity,
        })) as unknown as ApplyAiProposalCommandPayload["candidates"];
        const candidateExpected = candidates
          .map(({ type, entity }) => expectedFor(type, entity.id))
          .filter((entry): entry is ExpectedVersion => Boolean(entry));
        const proposalExpected = expectedFor("ai_proposal", proposalOperation.entity.id);
        if (!proposalExpected) throw new Error("AI ProposalがWorkspaceにありません。");
        await executeTyped({
          commandId: uuid(),
          name: "ApplyAiProposal",
          payload: { proposal: proposalOperation.entity, candidates },
          actor: { kind: "user" },
          source,
          expectedVersions: [proposalExpected, ...candidateExpected],
          issuedAt: new Date().toISOString(),
        });
        setToast(successMessage, "success");
        return saved;
      }
      if (taskOperations.length && unsupportedMixed.length) {
        throw new Error(
          "Taskの保存に未対応の混在操作が含まれています。Task Commandへ分解してから再試行してください。",
        );
      }
      const envelopes: CommandEnvelope[] = [];
      for (const taskOperation of taskOperations) {
        const task = taskOperation.entity;
        const existing = fullDomain.tasks.find((candidate) => candidate.id === task.id);
        const plan = planTaskEdit(
          { state: task.state },
          existing
            ? { state: existing.state, version: Number((existing as unknown as Entity).version || 0) }
            : null,
        );
        const scheduleOperation = operations.find(
          (operation) =>
            operation.type === "schedule" &&
            operation.entity.owner_type === "task" &&
            operation.entity.owner_id === task.id,
        );
        const existingSchedule = scheduleOperation
          ? fullDomain.schedules.find((schedule) => schedule.id === scheduleOperation.entity.id)
          : undefined;
        const references = taskReferences
          .filter(
            (operation) =>
              taskIds.has(task.id) &&
              (String(operation.entity.source_id) === task.id ||
                String(operation.entity.target_id) === task.id),
          )
          .map((operation) => operation.entity);
        const envelope: CommandEnvelope = {
          commandId: uuid(),
          name: plan.name,
          payload:
            plan.name === "CreateTask" || plan.name === "UpdateTask"
              ? {
                  task,
                  schedule: scheduleOperation?.entity || null,
                  references: references.length ? references : undefined,
                }
              : {
                  taskId: task.id,
                  task,
                  completionNote: task.completion_note as string | null,
                  schedule: scheduleOperation?.entity || null,
                  references: references.length ? references : undefined,
                },
          actor: { kind: "user" },
          source,
          expectedVersions: plan.expectedVersion !== null
            ? [
                {
                  type: "task",
                  id: task.id,
                  version: plan.expectedVersion,
                },
                ...(existingSchedule
                  ? [
                      {
                        type: "schedule" as const,
                        id: existingSchedule.id,
                        version: Number((existingSchedule as unknown as Entity).version || 0),
                      },
                    ]
                  : []),
              ]
            : [],
          issuedAt: new Date().toISOString(),
        };
        envelopes.push(envelope);
      }
      const receipts: CommandReceipt[] = envelopes.length
        ? await workspaceApi.executeCommands(envelopes)
        : [];
      for (const receipt of receipts) {
        applyCommandReceipt(receipt);
        saved = [...saved, ...receipt.changes.map(({ entity }) => entity)];
      }
      if (!taskOperations.length && remaining.length)
        saved = [...saved, ...(await saveWorkspaceEntities(remaining))];
      setToast(successMessage, "success");
      return saved;
    } catch (error) {
      setToast(`保存できませんでした。${errorMessage(error)}`, "danger");
      throw error;
    }
  };

  async function removeEntity(type: EntityType, entity: BaseRecord | { id?: string }) {
    const id = entity.id ?? "";
    if (type === "theme") {
      const name = entityTitle(type, entity as BaseRecord);
      const openTasks = fullDomain.tasks.filter(
        (task) => task.project_id === id && task.state !== "done" && task.state !== "cancelled",
      ).length;
      const openWaitings = fullDomain.waitings.filter(
        (waiting) => waiting.project_id === id && waiting.state === "waiting",
      ).length;
      const openPlanNodes = fullDomain.plan_nodes.filter(
        (node) => node.project_id === id && node.state !== "done" && node.state !== "cancelled",
      ).length;
      const notesCount = fullDomain.notes.filter((note) => note.project_id === id).length;
      const resourcesCount = fullDomain.resources.filter(
        (resource) => resource.project_id === id,
      ).length;
      const relatedCount = openTasks + openWaitings + openPlanNodes + notesCount + resourcesCount;
      const detail =
        relatedCount > 0
          ? `\n未完了/待ち/メモ/資料など関連する項目が${relatedCount}件あります。`
          : "";
      const ok = confirm(
        `「${name}」を削除しますか？${detail}\n削除後も「元に戻す」から復元できます。`,
      );
      if (!ok) return;
    }
    try {
      if (type === "task") {
        const current = fullDomain.tasks.find((task) => task.id === id);
        if (!current) throw new Error("削除対象のTaskがありません。");
        const outcome = await taskClient.delete(
          id,
          Number((current as unknown as Entity).version || 0),
          {
            commandId: uuid(),
            issuedAt: new Date().toISOString(),
          },
        );
        if (outcome.task) applyExternalSave("task", outcome.task as unknown as Entity);
      } else {
        await removeWorkspaceEntity(type, id);
      }
      lastDeleted.current = { type, id };
      drawerFormRef.current = null;
      drawerFormInitialSignature.current = "";
      drawerFormInitialChecklistSignature.current = "";
      drawerFormInitialNonChecklistSignature.current = "";
      drawerGeneration.current += 1;
      setDrawer(null);
      requestAnimationFrame(() => drawerTrigger.current?.focus?.());
      setToast(
        `${entityTitle(type, entity as BaseRecord)}を削除しました。元に戻せます。`,
        "warning",
      );
    } catch (error) {
      setToast(`削除できませんでした。${errorMessage(error)}`, "danger");
    }
  }

  async function undoDelete() {
    if (!lastDeleted.current) return;
    await restoreWorkspaceEntity(lastDeleted.current.type, lastDeleted.current.id);
    lastDeleted.current = null;
    setToast("削除を元に戻しました。", "success");
  }

  async function removeEntityQuiet(type: EntityType, id: string) {
    await removeWorkspaceEntity(type, id);
  }

  async function saveForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveFormElement(event.currentTarget);
  }

  async function saveFormElement(
    form: HTMLFormElement,
    options: { closeAfterSave?: boolean; quiet?: boolean } = {},
  ): Promise<boolean> {
    const closeAfterSave = options.closeAfterSave ?? true;
    const submittedSignature = formSignature(form);
    const finishSave = (saved?: Entity) => {
      if (drawerFormRef.current === form) {
        drawerFormInitialSignature.current = submittedSignature;
        drawerFormInitialChecklistSignature.current = formSignature(form, "checklist");
        drawerFormInitialNonChecklistSignature.current = formSignature(form, "non-checklist");
        setDrawerFormDirty(false);
      }
      if (closeAfterSave) {
        closeDrawer();
        return;
      }
      // 開いたままの自動保存: 保存後の値でdrawer.entityを更新し、フォーム内の保存状態表示を実データと一致させる。
      if (saved)
        setDrawer((current) =>
          current && drawerFormRef.current === form
            ? { ...current, entity: saved as unknown as Record<string, unknown> }
            : current,
        );
    };
    const values = new FormData(form);
    const type = form.dataset.entityType as DrawerEntityType | undefined;
    if (!type) return false;
    const named = (name: string) => form.elements.namedItem(name) as HTMLElement | null;
    const base = (drawer?.entity || {}) as Record<string, unknown>;
    let entity: Record<string, unknown> | undefined;

    const domainPlan = buildDomainDrawerFormPlan({
      type,
      values,
      base,
      data,
      domain,
      hasField: (name) => Boolean(named(name)),
    });
    if (domainPlan?.kind === "invalid") {
      if (domainPlan.field) (named(domainPlan.field) as HTMLInputElement | null)?.focus();
      setToast(domainPlan.message);
      return false;
    }
    if (domainPlan?.kind === "operations") {
      await saveEntities(domainPlan.operations, domainPlan.successMessage);
      finishSave();
      if (domainPlan.navigateTo && closeAfterSave) navigate(domainPlan.navigateTo);
      return true;
    }
    if (type === "theme") {
      const name = formText(values, "name");
      if (!name) {
        setToast("テーマ名を入力してください。");
        return false;
      }
      const { status: _status, ...rest } = base;
      entity = {
        ...rest,
        name,
        code: formText(values, "code") || null,
        description: formText(values, "description"),
        ...themeIntentFromForm(values, base),
        color: formText(values, "color") || (base.color as string) || "",
        group: formText(values, "group"),
        storage_root: formText(values, "storage_root") || null,
        // 配下EntityのAI公開既定（#294）。未設定に戻すとworkspace既定を使う。
        default_ai_visibility: themeDefaultAiVisibilityFromForm(values, base, (name) =>
          Boolean(named(name)),
        ),
      };
    } else if (type === "sketch") {
      const title = formText(values, "title");
      if (!title) {
        named("title")?.focus();
        setToast("Sketchのタイトルを入力してください。", "warning");
        return false;
      }
      entity = {
        ...base,
        title,
        project_id: canonicalThemeId(formText(values, "project_id"), { defaultPersonal: true }),
      };
    } else if (type === "note") {
      const title = formText(values, "title");
      if (!title) {
        setToast("タイトルを入力してください。");
        return false;
      }
      // 本文は Notes 中央エリアが正本。ドロワーに本文フィールドがあるときだけフォーム値を使う。
      const hasBodyField = Boolean(named("body_markdown"));
      const body = hasBodyField
        ? formText(values, "body_markdown")
        : String(base.body_markdown || "");
      if (hasBodyField && !body.trim()) {
        setToast("本文を入力してください。");
        return false;
      }
      const submittedNoteType = formText(values, "note_type", "note");
      // 旧 report_prompt を編集して Prompt のまま保存した場合は用途付き prompt に正規化する。
      const noteType = submittedNoteType === "report_prompt" ? "prompt" : submittedNoteType;
      const hasSourceUrlField = Boolean(named("source_url"));
      const publishEnabled = values.getAll("publish_enabled").map(String).includes("true");
      const hasHeadingNumberFields = Boolean(named("heading_numbers"));
      const headingNumbers =
        hasHeadingNumberFields && values.getAll("heading_numbers").map(String).includes("true");
      const headingNumberStartRaw = formText(values, "heading_number_start");
      const headingNumberStart =
        headingNumberStartRaw === "1" ||
        headingNumberStartRaw === "2" ||
        headingNumberStartRaw === "3" ||
        headingNumberStartRaw === "4"
          ? Number(headingNumberStartRaw)
          : 2;
      const headingNumberLevels = values
        .getAll("heading_number_levels")
        .map(Number)
        .filter(
          (level): level is 1 | 2 | 3 | 4 =>
            level === 1 || level === 2 || level === 3 || level === 4,
        )
        .filter((level, index, levels) => levels.indexOf(level) === index)
        .sort((left, right) => left - right);
      const hasHeadingNumberLevels = Boolean(named("heading_number_levels_present"));
      const existingPromptProperties =
        base.properties_json && typeof base.properties_json === "object"
          ? (base.properties_json as Record<string, unknown>)
          : {};
      // Promptの用途・既定・変数は画面で判断させる情報ではない。
      // 既存データは失わず、生成元が付けた分類だけを内部的に保持する。
      const promptProperties =
        noteType === "prompt"
          ? {
              prompt_purpose: formText(
                values,
                "prompt_purpose",
                str(existingPromptProperties.prompt_purpose) ||
                  (String(base.note_type) === "report_prompt" ? "report" : "other"),
              ),
              prompt_variables: formText(
                values,
                "prompt_variables",
                str(existingPromptProperties.prompt_variables),
              ),
              is_default: existingPromptProperties.is_default === true,
            }
          : {};
      const reportProperties =
        noteType === "report"
          ? {
              report_type: formText(values, "report_type", "weekly"),
              period_start: formText(values, "period_start") || null,
              period_end: formText(values, "period_end") || null,
            }
          : {};
      const headingNumberProperties = hasHeadingNumberFields
        ? {
            heading_numbers: headingNumbers,
            heading_number_start: headingNumberLevels[0] ?? headingNumberStart,
            heading_number_levels: hasHeadingNumberLevels ? headingNumberLevels : [2, 3, 4],
          }
        : {};
      const { theme_id: _legacyThemeId, ...baseWithoutLegacyTheme } = base;
      const canonicalBase = stripLineageDraftMetadata(baseWithoutLegacyTheme);
      entity = {
        ...canonicalBase,
        // Canonical document IPC requires a stable owner ID even for a new Note.
        // Allocate it before the first save so the drawer create path and the
        // later editor snapshots share the same typed owner.
        id: str(base.id) || uuid(),
        title,
        body_markdown: body,
        note_type: noteType,
        content_format: formText(values, "content_format") || "markdown",
        project_id: canonicalThemeId(formText(values, "theme_id"), { defaultPersonal: true }),
        // Note編集UIから関連タスク（item_id）を外した。フォームに無いときは既存値を保持する（#144）。
        item_id:
          noteType === "report"
            ? null
            : named("item_id")
              ? formText(values, "item_id") || null
              : ((base.item_id as string | null) ?? null),
        source_url:
          noteType === "report"
            ? ""
            : hasSourceUrlField
              ? formText(values, "source_url")
              : (base.source_url as string | undefined),
        source_record_id: formText(values, "source_record_id") || null,
        properties_json: {
          ...((base.properties_json as Record<string, unknown>) || {}),
          publish_enabled: publishEnabled,
          ...reportProperties,
          ...promptProperties,
          ...headingNumberProperties,
        },
        comments: (base.comments as Note["comments"]) || [],
      };
    } else if (type === "status_update") {
      entity = {
        ...base,
        theme_id: canonicalThemeId(formText(values, "theme_id", activeThemeId), {
          defaultPersonal: true,
        }),
        date: formText(values, "date", todayIso()),
        status: formText(values, "status", "on_track"),
        summary: formText(values, "summary"),
        progress: Number(values.get("progress") || 0),
        risks: formText(values, "risks"),
        next_actions: formText(values, "next_actions"),
      };
      if (!entity.summary) {
        setToast("現在地の概要を入力してください。");
        return false;
      }
    } else if (type === "knowledge_node") {
      const autoTarget = str(base._auto_edge_target_id);
      const autoRelation = str(base._auto_edge_relation_type);
      const entityId = str(base.id) || uuid();
      const sourceType = formText(values, "source_type") || null;
      const sourceId = formText(values, "source_id") || null;
      entity = {
        ...base,
        id: entityId,
        node_type: formText(values, "node_type", "question"),
        title: formText(values, "title"),
        body: formText(values, "body"),
        theme_id: canonicalThemeId(formText(values, "theme_id"), { defaultPersonal: true }),
        source_type: sourceType,
        source_id: sourceId,
        source_note_id:
          sourceType === "note" ? sourceId : ((base.source_note_id as string | null) ?? null),
        source_link_id:
          sourceType === "resource" ? sourceId : ((base.source_link_id as string | null) ?? null),
        source_item_id:
          sourceType === "task" || sourceType === "waiting" || sourceType === "plan_node"
            ? sourceId
            : ((base.source_item_id as string | null) ?? null),
        confidence: formText(values, "confidence", "medium"),
        status: formText(values, "status", "active"),
        ...aiMetadataFromForm(values, base, (name) => Boolean(named(name))),
      };
      if (!entity.title) {
        setToast("Knowledgeのタイトルを入力してください。");
        return false;
      }
      delete entity._auto_edge_target_id;
      delete entity._auto_edge_relation_type;
      if (autoTarget && autoRelation) {
        await saveEntities(
          [
            { action: "save", type: "knowledge_node", entity: entity as Entity },
            {
              action: "save",
              type: "knowledge_edge",
              entity: {
                id: uuid(),
                source_node_id: entityId,
                target_node_id: autoTarget,
                relation_type: autoRelation,
              } as Entity,
            },
          ],
          base.id ? "変更を保存しました。" : "Knowledgeを追加しました。",
        );
        finishSave();
        return true;
      }
    } else if (type === "knowledge_edge") {
      entity = {
        ...base,
        source_node_id: formText(values, "source_node_id"),
        target_node_id: formText(values, "target_node_id"),
        relation_type: formText(values, "relation_type", "supports"),
        description: formText(values, "description"),
      };
      if (
        !entity.source_node_id ||
        !entity.target_node_id ||
        entity.source_node_id === entity.target_node_id
      ) {
        setToast("異なる2つのKnowledgeを選択してください。");
        return false;
      }
    }

    if (!entity) return false;

    // AI共通metadata（#294）。欄があるフォームからは読み、無い保存経路では既存値を保つ。
    if (hasAiMetadataContract(type)) {
      entity = { ...entity, ...aiMetadataFromForm(values, base, (name) => Boolean(named(name))) };
    }

    // Conversation詳細からの明示作成は、Note本体とderived_fromを同じ保存単位で確定する。
    // Draft専用metadataはEntityへ残さない。
    if (type === "note" && entity.id) {
      const lineageCompanion = buildDerivedFromDocumentCompanion(base, String(entity.id));
      if (lineageCompanion) {
        const saved = await saveEntity(
          "note",
          entity,
          { reason: "created_from_conversation", quiet: options.quiet },
          undefined,
          [lineageCompanion],
        );
        finishSave(saved);
        return true;
      }
    }

    const saved = await saveEntity(type, entity, {
      reason: formText(values, "revision_reason"),
      quiet: options.quiet,
    });
    if (type === "theme" && !activeThemeId && saved) setActiveThemeId(saved.id);
    finishSave(saved);
    return true;
  }

  const dispatchNotesCommand = (command: string) => {
    window.dispatchEvent(new CustomEvent("tasken:notes-command", { detail: command }));
  };
  const toggleTodayWindow = () => {
    void workspaceApi.toggleTodayMiniWindow().catch((error) => {
      setToast(`Todayウィンドウを表示／収納できませんでした。${errorMessage(error)}`, "danger");
    });
  };
  const toggleStickyWindows = () => {
    void (async () => {
      const result = await workspaceApi.toggleMemoStickyTargetsVisibility();
      if (result.status === "empty") setToast("表示する付箋がありません。", "info");
      if (result.status === "flush_failed") {
        setToast(
          "付箋を収納できませんでした。保存エラーを解消してから再試行してください。",
          "danger",
        );
      }
    })().catch((error) => {
      setToast(`付箋を切り替えられませんでした。${errorMessage(error)}`, "danger");
    });
  };
  const recallPaletteEntries = useMemo(
    () =>
      buildRecallPaletteEntries({
        data: fullData,
        domain: fullDomain,
        themes: allThemes,
      }),
    [allThemes, fullData, fullDomain],
  );

  async function openRecallTarget(target: RecallPaletteTarget, trigger: HTMLElement | null) {
    if (!(await saveDirtyDrawerForm())) {
      throw new Error("開いている編集内容を保存してから、もう一度試してください。");
    }
    drawerGeneration.current += 1;
    if (target.kind === "theme") {
      const recalledTheme = allThemes.find((theme) => theme.id === target.entityId);
      if (!recalledTheme)
        throw new Error("Themeが見つかりません。画面を更新して、もう一度試してください。");
      const recalledGroup = recalledTheme.group || "";
      if (activeGroups.length > 0 && !activeGroups.includes(recalledGroup)) {
        setActiveGroups([...activeGroups, recalledGroup]);
      }
      setDrawer(null);
      setActiveThemeId(recalledTheme.id);
      location.hash = target.route;
      setRoute(target.route);
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(".main-area")?.focus({ preventScroll: true }),
      );
      return;
    }
    if (target.kind === "artifact") {
      setDrawer(null);
      location.hash = target.route;
      setRoute(target.route);
      openContentViewer({ type: "artifact", artifactId: target.entityId });
      return;
    }
    const collection =
      target.entityType === "capture_entry"
        ? fullDomain.capture_entries
        : target.entityType === "waiting"
          ? fullDomain.waitings
          : target.entityType === "knowledge_node"
            ? fullDomain.knowledge_nodes
            : target.entityType === "resource"
              ? fullDomain.resources
              : target.entityType === "note"
                ? fullDomain.notes
                : target.entityType === "plan_node"
                  ? fullDomain.plan_nodes
                  : target.entityType === "task"
                    ? fullDomain.tasks
                    : [];
    const entity = collection.find((entry) => entry.id === target.entityId);
    if (!entity) {
      throw new Error("検索結果を開けませんでした。画面を更新して、もう一度試してください。");
    }
    location.hash = target.route;
    setRoute(target.route);
    const projection =
      target.entityType === "task" ||
      target.entityType === "waiting" ||
      target.entityType === "plan_node"
        ? {
            ...entity,
            _schedule: fullDomain.schedules.find(
              (schedule) =>
                schedule.owner_type === target.entityType && schedule.owner_id === entity.id,
            ),
          }
        : entity;
    drawerTrigger.current = trigger;
    setDrawer({
      type: target.entityType,
      mode: target.mode,
      entity: projection as Record<string, unknown>,
      dataScope: "full",
    });
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(".drawer input, .drawer textarea, .drawer button")
        ?.focus({ preventScroll: true });
    });
  }
  const commandPaletteEntries: CommandPaletteEntry[] = [
    ...(activeFocusSession
      ? [
          {
            id: "focus:resume",
            label: `Focus Sessionを再開: ${activeFocusTask?.title || "Task"}`,
            keywords: ["集中", "再開", "focus", "session"],
            category: "Commands" as const,
            execute: () => setFocusTaskId(focusSessionTaskId(activeFocusSession)),
          },
        ]
      : []),
    {
      id: "open:daily-scratchpad",
      label: "今日のDaily Scratchpadを開く",
      keywords: ["今日", "日次", "メモ", "scratchpad", "書き散らす"],
      category: "Commands",
      execute: () => setScratchpadDate(todayIso()),
    },
    {
      id: "open:memos",
      label: "付箋を展開／収納",
      keywords: ["memo", "メモ", "付箋", "sticky", "window"],
      category: "Commands",
      execute: () => {
        void toggleStickyWindows();
      },
    },
    {
      id: "open:today-window",
      label: "今日のTaskウィンドウを表示／収納",
      keywords: ["today", "今日", "ポップアウト", "window"],
      category: "Commands",
      execute: toggleTodayWindow,
    },
    {
      id: "navigate:today",
      label: `${routeLabel("today")}へ移動`,
      keywords: ["今日", "home"],
      category: "Commands",
      execute: () => navigate("today"),
    },
    {
      id: "navigate:todo",
      label: `${routeLabel("todo")}へ移動`,
      keywords: ["task", "タスク"],
      category: "Commands",
      execute: () => navigate("todo"),
    },
    {
      id: "navigate:inbox",
      label: `${routeLabel("inbox")}へ移動`,
      keywords: ["capture", "記録"],
      category: "Commands",
      execute: () => navigate("inbox"),
    },
    {
      id: "navigate:notes",
      label: `${routeLabel("notes")}へ移動`,
      keywords: ["note", "markdown", "文書"],
      category: "Commands",
      execute: () => navigate("notes"),
    },
    {
      id: "navigate:sketch",
      label: `${routeLabel("sketch")}へ移動`,
      keywords: ["手書き", "図解", "canvas"],
      category: "Commands",
      execute: () => navigate("sketch"),
    },
    {
      id: "navigate:themes",
      label: `All ${routeLabel("themes")}へ移動`,
      keywords: ["theme", "テーマ"],
      category: "Commands",
      execute: () => navigate("themes"),
    },
    {
      id: "navigate:artifacts",
      label: `${routeLabel("artifacts")}へ移動`,
      keywords: ["file", "成果物"],
      category: "Commands",
      execute: () => navigate("artifacts"),
    },
    {
      id: "create:task",
      label: "Taskを作る",
      keywords: ["追加", "todo", "新規"],
      category: "Commands",
      execute: () =>
        openDrawer({
          type: "task",
          mode: "edit",
          commandSource: "command_palette",
          entity: { project_id: canonicalThemeId(activeTheme?.id, { defaultPersonal: true }) },
        }),
    },
    {
      id: "create:note",
      label: "Noteを作る",
      keywords: ["メモ", "追加", "新規"],
      category: "Commands",
      execute: () =>
        openDrawer({
          type: "note",
          mode: "edit",
          entity: {
            project_id: canonicalThemeId(activeTheme?.id, { defaultPersonal: true }),
            note_type: "note",
            content_format: "markdown",
          },
        }),
    },
    {
      id: "create:markdown",
      label: "Markdown文書を作る",
      keywords: ["document", "原稿", "追加", "新規"],
      category: "Commands",
      execute: () =>
        openDrawer({
          type: "note",
          mode: "edit",
          entity: {
            project_id: canonicalThemeId(activeTheme?.id, { defaultPersonal: true }),
            note_type: "note",
            content_format: "markdown",
            properties_json: { publish_enabled: true },
          },
        }),
    },
    {
      id: "create:capture",
      label: "Quick Captureを開く",
      keywords: ["inbox", "記録", "capture"],
      category: "Commands",
      shortcut: "Ctrl+Shift+N",
      execute: () =>
        openDrawer({
          type: "capture_entry",
          mode: "edit",
          entity: { state: "untriaged", captured_at: new Date().toISOString() },
        }),
    },
    ...(activeTheme
      ? [
          {
            id: "ai:context-pack",
            label: `${activeTheme.name}のContext Packを作る`,
            keywords: ["AI", "文脈", "prompt", "theme"],
            category: "Commands" as const,
            execute: () => setContextPackThemeId(activeTheme.id),
          },
        ]
      : []),
    ...(route === "notes"
      ? [
          {
            id: "notes:save",
            label: "現在の文書を保存",
            keywords: ["save", "保存"],
            category: "Commands" as const,
            shortcut: "Ctrl+S",
            execute: () => dispatchNotesCommand("save"),
          },
          {
            id: "notes:edit",
            label: "現在の文書をEditで表示",
            keywords: ["編集", "markdown"],
            category: "Commands" as const,
            execute: () => dispatchNotesCommand("edit"),
          },
          {
            id: "notes:preview",
            label: "現在の文書をPreviewで表示",
            keywords: ["表示", "render"],
            category: "Commands" as const,
            execute: () => dispatchNotesCommand("preview"),
          },
          {
            id: "notes:format",
            label: "現在のMarkdownを整形",
            keywords: ["format", "空行"],
            category: "Commands" as const,
            execute: () => dispatchNotesCommand("format"),
          },
          {
            id: "notes:pdf",
            label: "現在の文書をPDF出力",
            keywords: ["export", "出力"],
            category: "Commands" as const,
            execute: () => dispatchNotesCommand("pdf"),
          },
          {
            id: "notes:folder",
            label: "現在の文書の保存先を開く",
            keywords: ["folder", "directory", "フォルダ"],
            category: "Commands" as const,
            execute: () => dispatchNotesCommand("folder"),
          },
          // 選択しただけでtoolbarを出すのをやめたので、変換はここが正規の入口（#313）。
          {
            id: "notes:selection-task",
            label: "選択範囲からTaskを作る",
            keywords: ["選択", "切り出し", "task", "抽出"],
            category: "Commands" as const,
            execute: () => dispatchNotesCommand("selection-task"),
          },
          {
            id: "notes:selection-note",
            label: "選択範囲からNoteを作る",
            keywords: ["選択", "切り出し", "note", "抽出"],
            category: "Commands" as const,
            execute: () => dispatchNotesCommand("selection-note"),
          },
        ]
      : []),
    ...recallPaletteEntries.map((entry) => ({
      id: entry.id,
      label: entry.label,
      keywords: entry.keywords,
      searchText: entry.searchText,
      context: entry.context,
      category: entry.category,
      execute: (context?: CommandPaletteExecutionContext) =>
        openRecallTarget(entry.target, context?.trigger ?? null),
    })),
    ...domain.tasks
      .filter((task) => task.state !== "done" && task.state !== "cancelled")
      .map((task) => ({
        id: `focus:${task.id}`,
        label: `集中して作業する: ${task.title}`,
        keywords: [
          "focus",
          "session",
          "集中",
          task.title,
          themes.find((theme) => theme.id === task.project_id)?.name || "",
        ],
        category: "Commands" as const,
        execute: () => startFocusSession(task.id),
      })),
  ];

  const titleBarLauncher: TitleBarLauncherData = {
    todayWindowOpen,
    stickyWindowsShown:
      stickyMemoTargetIds.length > 0 &&
      stickyMemoTargetIds.every((memoId) => openStickyMemoIds.includes(memoId)),
    toggleStickyWindows,
    toggleTodayWindow,
  };

  const titleBar = (
    <AppTitleBar
      launcher={titleBarLauncher}
      detached={Boolean(detachedNoteId)}
      collapsed={sidebarCollapsed}
      setCollapsed={setSidebarCollapsed}
      zoomFactor={zoomFactor}
      setZoomFactor={setZoomFactor}
      themeMode={themeMode}
      setThemeMode={setThemeMode}
      openShortcuts={() => setShowShortcuts(true)}
      openCommandPalette={() => setShowCommandPalette(true)}
      openSettings={() => navigate("settings")}
    />
  );
  const frameStyle = { "--app-content-zoom": zoomFactor } as CSSProperties;

  if (loadState === "loading") {
    return (
      <div className="app-frame" style={frameStyle}>
        {titleBar}
        <div className="app-content-viewport">
          <AppState state="loading" />
        </div>
      </div>
    );
  }
  if (loadState === "error") {
    return (
      <div className="app-frame" style={frameStyle}>
        {titleBar}
        <div className="app-content-viewport">
          <AppState state="error" message={loadError} onRetry={loadWorkspace} />
        </div>
      </div>
    );
  }
  if (!workspace) return null;

  const common = {
    data,
    domain,
    themes,
    items,
    notes,
    links,
    activeTheme,
    activeThemeId,
    setActiveThemeId,
    route,
    navigate,
    detachedNoteId,
    openDrawer,
    openSketchEditor,
    openContentViewer,
    openContextPack: setContextPackThemeId,
    openDailyScratchpad: (date?: string) => setScratchpadDate(date || todayIso()),
    startFocusSession,
    saveEntity,
    saveEntities,
    executeCommand: executeTaskWorkCommand,
    createTaskFromCapture,
    removeEntity,
    removeEntityQuiet,
    setToast,
    snapshotPreview,
    setSnapshotPreview,
  };

  return (
    <div className="app-frame" style={frameStyle}>
      {titleBar}
      <div className="app-content-viewport">
        {/* 切り離しウィンドウはSidebarとContext Paneを出さず、文書編集へ集中させる（#290）。 */}
        <div
          className={`app-shell ${drawer ? "has-drawer" : ""} ${sidebarCollapsed ? "is-sidebar-collapsed" : ""} ${route === "sketch-editor" ? "is-canvas-route" : ""} ${detachedNoteId ? "is-detached-window" : ""}`}
          ref={appShellRef}
          style={{ "--sidebar-width": `${effectiveSidebarWidth}px` } as CSSProperties}
        >
          {!detachedNoteId && (
            <Sidebar
              route={route === "sketch-editor" ? "sketch" : route}
              navigate={navigate}
              collapsed={sidebarCollapsed}
              themes={themes}
              activeThemeId={activeThemeId}
              setActiveThemeId={setActiveThemeId}
              domain={domain}
              openDrawer={openDrawer}
              activeFocus={
                activeFocusTask && activeFocusSession
                  ? {
                      taskTitle: activeFocusTask.title,
                      // 開始時刻は properties_json 側が正本。共有helperを通す。
                      startedAt:
                        str(focusSessionProperties(activeFocusSession).started_at) ||
                        str(activeFocusSession.created_at),
                    }
                  : null
              }
              openActiveFocus={
                activeFocusTask ? () => setFocusTaskId(activeFocusTask.id) : undefined
              }
            />
          )}
          {!detachedNoteId && (
            <div
              className="sidebar-resize-handle"
              role="separator"
              aria-orientation="vertical"
              aria-label="サイドバーの幅"
              aria-valuemin={64}
              aria-valuemax={360}
              aria-valuenow={sidebarCollapsed ? 64 : Math.round(effectiveSidebarWidth)}
              aria-valuetext={
                sidebarCollapsed
                  ? "折りたたみ中。右へドラッグで戻せます"
                  : `${Math.round(effectiveSidebarWidth)}px`
              }
              tabIndex={0}
              onPointerDown={handleSidebarResize}
              onKeyDown={handleSidebarResizeKeyDown}
            />
          )}
          <main className="main-area" tabIndex={-1}>
            <WorkspacePageRouter
              route={route}
              common={common}
              themeMode={themeMode}
              setThemeMode={setThemeMode}
              activeGroups={activeGroups}
              setActiveGroups={setActiveGroups}
              allThemes={allThemes}
            />
          </main>
          {drawer ? (
            <EntityDrawer
              drawer={drawer}
              data={drawer.dataScope === "full" ? fullData : data}
              close={closeDrawer}
              saveForm={saveForm}
              registerEditForm={registerEditForm}
              isFormDirty={drawerFormDirty}
              removeEntity={removeEntity}
              saveEntity={saveEntity}
              saveEntities={saveEntities}
              registerChecklistSave={registerDrawerSave}
              markChecklistSaved={markChecklistSaved}
              markChecklistDraftChange={markDrawerFormDirty}
              setToast={setToast}
              executeCommand={executeTaskWorkCommand}
              openContentViewer={openContentViewer}
              startFocusSession={startFocusSession}
              navigate={navigate}
            />
          ) : route !== "sketch-editor" && !detachedNoteId ? (
            <ContextPane
              data={data}
              domain={domain}
              activeTheme={activeTheme}
              route={route}
              openDrawer={openDrawer}
              navigate={navigate}
            />
          ) : null}
          {contentViewer && (
            <ContentViewer
              target={contentViewer}
              data={data}
              onClose={closeContentViewer}
              openDrawer={openDrawer}
              setToast={setToast}
            />
          )}
          {toast && (
            <div
              className={`toast is-${toastToneValue}`}
              role={toastToneValue === "danger" ? "alert" : "status"}
              aria-live={
                toastToneValue === "danger" || toastToneValue === "warning" ? "assertive" : "polite"
              }
            >
              <span className="toast-icon" aria-hidden="true">
                {toastIcon(toastToneValue)}
              </span>
              <span className="toast-message">{toast}</span>
              {lastDeleted.current && <button onClick={undoDelete}>元に戻す</button>}
              <button onClick={() => setToast("")}>閉じる</button>
            </div>
          )}
          {showShortcuts && <ShortcutDialog close={() => setShowShortcuts(false)} />}
          <CommandPalette
            open={showCommandPalette}
            entries={commandPaletteEntries}
            close={() => setShowCommandPalette(false)}
          />
          {contextPackThemeId && themes.find((theme) => theme.id === contextPackThemeId) && (
            <ContextPackDialog
              theme={themes.find((theme) => theme.id === contextPackThemeId) as Theme}
              domain={domain}
              data={data}
              saveEntity={saveEntity}
              openDrawer={openDrawer}
              setToast={setToast}
              close={closeContextPack}
            />
          )}
          {scratchpadDate && (
            <DailyScratchpadDialog
              key={scratchpadDate}
              initialDate={scratchpadDate}
              today={todayIso()}
              notes={data.notes}
              tasks={domain.tasks}
              references={domain.references}
              saveEntity={saveEntity}
              saveEntities={saveEntities}
              openDrawer={openDrawer}
              setToast={setToast}
              close={() => setScratchpadDate(null)}
            />
          )}
          {/* 実行中Focusの表示はSidebar下部へ移した（#316）。右下floatingは目に入りにくい。 */}
          {focusTaskId && fullDomain.tasks.find((task) => task.id === focusTaskId) && (
            <FocusSessionDialog
              task={
                fullDomain.tasks.find(
                  (task) => task.id === focusTaskId,
                ) as (typeof fullDomain.tasks)[number]
              }
              session={activeFocusSession}
              data={fullData}
              domain={fullDomain}
              saveEntity={saveEntity}
              saveEntities={saveEntities}
              removeEntity={removeEntity}
              openDrawer={openDrawer}
              openContentViewer={openContentViewer}
              setToast={setToast}
              close={() => setFocusTaskId(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
