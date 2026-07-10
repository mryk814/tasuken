import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconAlertTriangle, IconCheck, IconInfoCircle, IconTrash } from "@tabler/icons-react";

import { workspaceApi } from "../../services/workspaceApi";
import { routeAliases } from "../../pages/routes";
import { useUiStore, type ToastTone } from "../../stores/uiStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { todayIso } from "../../utils/dataFormat.js";
import type {
  BaseRecord,
  DrawerConfig,
  DrawerEntityType,
  Entity,
  EntityType,
  Item,
  Note,
  PlanRevision,
  SaveEntities,
  SaveEntity,
  SnapshotPreview,
  Theme,
  WorkspaceData,
} from "./types";
import { entityTitle } from "./lib/domain";
import { inferChatServiceFromUrl } from "./lib/chatServices";
import { resolveSubmittedChatCapturedAt } from "./lib/chatRefs";
import { activeRecords, formText, str, uuid } from "./lib/format";
import { normalizeReminderDateTime } from "./lib/reminders";
import { listTaskSections, normalizeTaskSectionId } from "./lib/taskSections";
import { normalizeTaskShelf } from "./lib/taskShelves";
import type { SaveOperation } from "./types";
import {
  buildSaveTaskOperations,
  buildSaveWaitingOperations,
  buildSavePlanNodeOperations,
  buildSaveScheduleOperations,
  buildSaveCaptureEntryOperations,
  buildSaveResourceOperations,
} from "./domain-model/persistence";
import type { CaptureEntry, PlanNode, Resource, Schedule, Task, TaskChecklistItem, TaskRepeatRule, Waiting } from "./domain-model/types";
import { buildWorkspaceDomain } from "./domain-model/compat/legacyAdapter";
import { AppState, Sidebar, ShortcutDialog } from "./components/shell";
import { buildArtifactThemeSyncOperations } from "./components/artifacts";
import { EntityDrawer } from "./components/drawer";
import { ContextPane } from "./components/contextPane";
import { ThemePage } from "./pages/ThemePage";
import { TodoPage } from "./pages/TodoPage";
import { TimelinePage } from "./pages/TimelinePage";
import { ThemesPage } from "./pages/ThemesPage";
import { NotesPage } from "./pages/NotesPage";
import { ArtifactsPage } from "./pages/ArtifactsPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { WaitingPage } from "./pages/WaitingPage";
import { ImportExportPage } from "./pages/ImportExportPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TodayPage } from "./pages/TodayPage";
import { InboxPage } from "./pages/InboxPage";
import { ChatRefsPage } from "./pages/ChatRefsPage";

const ARRAY_KEYS: (keyof WorkspaceData)[] = [
  "themes", "items", "notes", "links", "resources", "views",
  "status_updates", "source_records", "entity_sources",
  "field_definitions", "field_values", "log_entries", "import_batchs",
  "knowledge_nodes", "ai_proposals", "plan_revisions",
  "projects", "capture_entrys", "tasks", "waitings", "plan_nodes",
  "schedules", "references", "task_dependencies", "plan_dependencies",
  "knowledge_edges", "change_events", "artifacts",
];

function normalizeRoute(route: string): string {
  return route === "micro-memos" ? "inbox" : route === "prompts" ? "notes" : route === "proposal-inbox" ? "ai-io" : routeAliases[route] || route;
}

function taskRepeatRuleFromForm(values: FormData, fallbackDay: number): TaskRepeatRule | null {
  const frequency = formText(values, "repeat_frequency");
  if (!frequency) return null;
  const interval = Math.max(1, Number(formText(values, "repeat_interval") || 1));
  const weekdays = values.getAll("repeat_weekdays")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
  const monthDay = Number(formText(values, "repeat_month_day") || fallbackDay || 1);
  return {
    frequency: frequency as TaskRepeatRule["frequency"],
    interval,
    weekdays: frequency === "weekly" ? weekdays : undefined,
    month_day: frequency === "monthly" ? monthDay : null,
    next_from: (formText(values, "repeat_next_from") || "scheduled") as TaskRepeatRule["next_from"],
    until: formText(values, "repeat_until") || null,
  };
}

function taskChecklistFromForm(values: FormData): TaskChecklistItem[] {
  const ids = values.getAll("checklist_id").map(String);
  const titles = values.getAll("checklist_title").map(String);
  return titles
    .flatMap((title, index): TaskChecklistItem[] => {
      const trimmed = title.trim();
      if (!trimmed) return [];
      const done = values.has(`checklist_done_${index}`);
      return [{
        id: ids[index] || uuid(),
        title: trimmed,
        done,
        sort_order: index,
        completed_at: done ? (formText(values, `checklist_completed_at_${index}`) || new Date().toISOString()) : null,
      }];
    });
}

function monthStart(value: string): string | null {
  return value ? `${value}-01` : null;
}

function monthEnd(value: string): string | null {
  if (!value) return null;
  const [year, month] = value.split("-").map(Number);
  const last = new Date(year, month, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
}

function normalizeChatReferenceStatus(value: string): string {
  return value === "adopted" ? "adopted" : "inbox";
}

function emptyData(): WorkspaceData {
  return Object.fromEntries(ARRAY_KEYS.map((key) => [key, []])) as unknown as WorkspaceData;
}

function projectWorkspace(workspace: Record<string, unknown> | null): WorkspaceData {
  const result = emptyData();
  if (!workspace) return result;
  for (const key of ARRAY_KEYS) {
    const value = workspace[key];
    if (Array.isArray(value)) (result[key] as BaseRecord[]) = activeRecords(value as BaseRecord[]);
  }
  result.meta = (workspace.meta as WorkspaceData["meta"]) || undefined;
  return result;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toastIcon(tone: ToastTone) {
  if (tone === "danger") return <IconAlertTriangle size={18} />;
  if (tone === "warning") return <IconTrash size={18} />;
  if (tone === "success") return <IconCheck size={18} />;
  return <IconInfoCircle size={18} />;
}

function formSignature(form: HTMLFormElement): string {
  return JSON.stringify(Array.from(new FormData(form).entries()).map(([key, value]) => [key, typeof value === "string" ? value : value.name]));
}

export function WorkspaceApp() {
  const workspace = useWorkspaceStore((state) => state.workspace);
  const loadState = useWorkspaceStore((state) => state.loadState);
  const loadError = useWorkspaceStore((state) => state.loadError);
  const loadWorkspaceAction = useWorkspaceStore((state) => state.load);
  const saveWorkspaceEntity = useWorkspaceStore((state) => state.save);
  const saveWorkspaceEntities = useWorkspaceStore((state) => state.saveMany);
  const removeWorkspaceEntity = useWorkspaceStore((state) => state.remove);
  const restoreWorkspaceEntity = useWorkspaceStore((state) => state.restore);
  const route = useUiStore((state) => normalizeRoute(state.route));
  const setRoute = useUiStore((state) => state.setRoute);
  const activeThemeId = useUiStore((state) => state.activeThemeId);
  const setActiveThemeId = useUiStore((state) => state.setActiveThemeId);
  const [drawer, setDrawer] = useState<DrawerConfig | null>(null);
  const toast = useUiStore((state) => state.toast);
  const toastToneValue = useUiStore((state) => state.toastTone);
  const setToast = useUiStore((state) => state.setToast);
  const themeMode = useUiStore((state) => state.themeMode);
  const setThemeMode = useUiStore((state) => state.setThemeMode);
  const activeGroups = useUiStore((state) => state.activeGroups);
  const setActiveGroups = useUiStore((state) => state.setActiveGroups);
  const [snapshotPreview, setSnapshotPreview] = useState<SnapshotPreview | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const lastDeleted = useRef<{ type: EntityType; id: string } | null>(null);
  const drawerTrigger = useRef<HTMLElement | null>(null);
  const drawerFormRef = useRef<HTMLFormElement | null>(null);
  const drawerFormInitialSignature = useRef("");
  const drawerAutosaving = useRef(false);
  const noteAutoSaveTimer = useRef<number | null>(null);
  const noteAutoSaveTriggerRef = useRef<() => void>(() => {});
  const updateCheckStarted = useRef(false);

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

  useEffect(() => {
    if (!window.api?.app?.onWorkspaceChanged) return;
    return window.api.app.onWorkspaceChanged((change) => {
      if (change?.entities?.length) {
        applyExternalSaves(change.entities);
        void refreshWorkspace().catch((error) => setToast(`更新を反映できませんでした。${errorMessage(error)}`, "danger"));
        return;
      }
      if (change?.type && change.entity) {
        applyExternalSave(change.type, change.entity);
        void refreshWorkspace().catch((error) => setToast(`更新を反映できませんでした。${errorMessage(error)}`, "danger"));
        return;
      }
      void refreshWorkspace();
    });
  }, [applyExternalSave, applyExternalSaves, refreshWorkspace, setToast]);

  useEffect(() => {
    const onHash = () => setRoute(normalizeRoute(location.hash.slice(1) || "today"));
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, [setRoute]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    if (loadState === "success") {
      workspaceApi.setPreference("themeMode", themeMode).catch((error) => {
        setToast(`表示設定を保存できませんでした。${errorMessage(error)}`, "danger");
      });
    }
  }, [themeMode, loadState, setToast]);

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
      workspaceApi.checkForUpdates()
        .then((result) => {
          if (!canceled && result.status === "available") {
            setToast(`Tasken ${result.latestVersion} が公開されています。Settingsで更新できます。`, "info");
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
      const inInput = ["INPUT", "TEXTAREA", "SELECT"].includes(tag ?? "") || target?.isContentEditable;
      if (event.key === "Escape") {
        if (showShortcuts) setShowShortcuts(false);
        else if (drawer) closeDrawer();
        return;
      }
      if (inInput) return;
      if (event.key === "?") {
        event.preventDefault();
        setShowShortcuts((current) => !current);
      }
      if (event.altKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        openDrawer({ type: "capture_entry", mode: "edit", entity: { state: "untriaged", captured_at: new Date().toISOString().slice(0, 10) } });
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        (document.querySelector("[data-search]") as HTMLElement | null)?.focus();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawer, showShortcuts]);

  const fullData = useMemo(() => projectWorkspace(workspace as Record<string, unknown> | null), [workspace]);
  const fullDomain = useMemo(() => buildWorkspaceDomain(fullData), [fullData]);
  const allThemes = fullData.themes;
  const themes = activeGroups.length > 0 ? allThemes.filter((t) => activeGroups.includes(t.group || "")) : allThemes;
  const groupThemeIds = useMemo(() => new Set(themes.map((t) => t.id)), [themes]);
  const hasGroupFilter = activeGroups.length > 0;

  const data = useMemo(() => {
    if (!hasGroupFilter) return fullData;
    const match = (themeId: unknown) => typeof themeId === "string" && groupThemeIds.has(themeId);
    return {
      ...fullData,
      themes,
      items: fullData.items.filter((i) => match(i.theme_id)),
      notes: fullData.notes.filter((n) => match(n.theme_id)),
      links: fullData.links.filter((l) => match(l.theme_id)),
      status_updates: fullData.status_updates.filter((u) => match(u.theme_id)),
      knowledge_nodes: fullData.knowledge_nodes.filter((k) => match(k.theme_id)),
    };
  }, [fullData, hasGroupFilter, groupThemeIds, themes]);

  const domain = useMemo(() => {
    if (!hasGroupFilter) return fullDomain;
    const match = (projectId: unknown) => typeof projectId === "string" && groupThemeIds.has(projectId);
    const tasks = fullDomain.tasks.filter((t) => match(t.project_id));
    const waitings = fullDomain.waitings.filter((w) => match(w.project_id));
    const plan_nodes = fullDomain.plan_nodes.filter((p) => match(p.project_id));
    const taskIds = new Set(tasks.map((t) => t.id));
    const waitingIds = new Set(waitings.map((w) => w.id));
    const planNodeIds = new Set(plan_nodes.map((p) => p.id));
    const ownerKey = (s: { owner_type: string; owner_id: string }) => `${s.owner_type}:${s.owner_id}`;
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
      task_dependencies: fullDomain.task_dependencies.filter((d) => taskIds.has(d.task_id) && taskIds.has(d.depends_on_task_id)),
      plan_dependencies: fullDomain.plan_dependencies.filter((d) => planNodeIds.has(d.plan_node_id) && planNodeIds.has(d.depends_on_plan_node_id)),
    };
  }, [fullDomain, hasGroupFilter, groupThemeIds]);

  const items = data.items;
  const notes = data.notes;
  const links = data.links;
  const activeTheme = themes.find((theme) => theme.id === activeThemeId) || themes[0] || null;

  const handleDrawerFormInput = useCallback(() => {
    noteAutoSaveTriggerRef.current();
  }, []);

  const registerEditForm = useCallback((form: HTMLFormElement | null) => {
    const previous = drawerFormRef.current;
    if (previous && previous !== form) previous.removeEventListener("input", handleDrawerFormInput);
    if (noteAutoSaveTimer.current) { window.clearTimeout(noteAutoSaveTimer.current); noteAutoSaveTimer.current = null; }
    drawerFormRef.current = form;
    drawerFormInitialSignature.current = form ? formSignature(form) : "";
    if (form) form.addEventListener("input", handleDrawerFormInput);
  }, [handleDrawerFormInput]);

  function isDrawerFormDirty(): boolean {
    const form = drawerFormRef.current;
    return Boolean(form && drawer && formSignature(form) !== drawerFormInitialSignature.current);
  }

  // 既存メモのメタ（タイトル・種別など）は入力が止まって1.5秒後に静かに自動保存する。
  // 本文は Notes 中央エリアの正本。新規作成中（entity.id未確定）やタイトルが空の間は対象外。
  async function autoSaveNoteDrawerForm(): Promise<void> {
    const form = drawerFormRef.current;
    if (!form || !drawer || drawer.type !== "note" || !drawer.entity?.id) return;
    if (drawerAutosaving.current || !isDrawerFormDirty()) return;
    const values = new FormData(form);
    if (!formText(values, "title")) return;
    try {
      drawerAutosaving.current = true;
      await saveFormElement(form, { closeAfterSave: false, quiet: true });
    } catch {
      // 失敗時はsaveEntity側で既にエラートーストを出しているため、ここでは自動保存を諦めるだけでよい。
    } finally {
      drawerAutosaving.current = false;
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

  useEffect(() => () => {
    if (noteAutoSaveTimer.current) window.clearTimeout(noteAutoSaveTimer.current);
  }, []);

  async function saveDirtyDrawerForm(): Promise<boolean> {
    const form = drawerFormRef.current;
    if (!form || !drawer || !isDrawerFormDirty() || drawerAutosaving.current) return true;
    if (noteAutoSaveTimer.current) { window.clearTimeout(noteAutoSaveTimer.current); noteAutoSaveTimer.current = null; }
    try {
      drawerAutosaving.current = true;
      const saved = await saveFormElement(form, { closeAfterSave: false });
      if (saved) drawerFormInitialSignature.current = formSignature(form);
      return saved;
    } catch {
      return false;
    } finally {
      drawerAutosaving.current = false;
    }
  }

  function navigate(next: string) {
    void (async () => {
      if (!(await saveDirtyDrawerForm())) return;
      const normalized = normalizeRoute(next);
      location.hash = normalized;
      setRoute(normalized);
    })();
  }

  function openDrawer(config: DrawerConfig) {
    void (async () => {
      if (!(await saveDirtyDrawerForm())) return;
      drawerTrigger.current = document.activeElement as HTMLElement | null;
      setDrawer(config);
    })();
  }

  function closeDrawer(next: DrawerConfig | null = null) {
    void (async () => {
      if (!(await saveDirtyDrawerForm())) return;
      setDrawer(next);
      if (!next) requestAnimationFrame(() => drawerTrigger.current?.focus?.());
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
      const schedule = fullDomain.schedules.find((entry) => entry.owner_type === "task" && entry.owner_id === task.id);
      location.hash = "todo";
      setRoute("todo");
      openDrawer({ type: "task", mode: "edit", entity: { ...task, _schedule: schedule } as Record<string, unknown> });
    });
  }, [fullDomain, loadState, setRoute, setToast]);

  const saveEntity: SaveEntity = async (type, entity, options = {}) => {
    try {
      const saved = await saveWorkspaceEntity(type, entity as Entity, options);
      if (!options.quiet) setToast(entity.id ? "変更を保存しました。" : "追加しました。", "success");
      return saved;
    } catch (error) {
      setToast(`保存できませんでした。${errorMessage(error)}`, "danger");
      throw error;
    }
  };

  const saveEntities: SaveEntities = async (operations, successMessage = "変更を保存しました。") => {
    try {
      const saved = await saveWorkspaceEntities(operations);
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
      const openTasks = fullDomain.tasks.filter((task) => task.project_id === id && task.state !== "done" && task.state !== "cancelled").length;
      const openWaitings = fullDomain.waitings.filter((waiting) => waiting.project_id === id && waiting.state === "waiting").length;
      const openPlanNodes = fullDomain.plan_nodes.filter((node) => node.project_id === id && node.state !== "done" && node.state !== "cancelled").length;
      const notesCount = fullDomain.notes.filter((note) => note.project_id === id).length;
      const resourcesCount = fullDomain.resources.filter((resource) => resource.project_id === id).length;
      const relatedCount = openTasks + openWaitings + openPlanNodes + notesCount + resourcesCount;
      const detail = relatedCount > 0
        ? `\n未完了/待ち/メモ/資料など関連する項目が${relatedCount}件あります。`
        : "";
      const ok = confirm(`「${name}」を削除しますか？${detail}\n削除後も「元に戻す」から復元できます。`);
      if (!ok) return;
    }
    try {
      await removeWorkspaceEntity(type, id);
      lastDeleted.current = { type, id };
      drawerFormRef.current = null;
      drawerFormInitialSignature.current = "";
      setDrawer(null);
      requestAnimationFrame(() => drawerTrigger.current?.focus?.());
      setToast(`${entityTitle(type, entity as BaseRecord)}を削除しました。元に戻せます。`, "warning");
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

  async function saveFormElement(form: HTMLFormElement, options: { closeAfterSave?: boolean; quiet?: boolean } = {}): Promise<boolean> {
    const closeAfterSave = options.closeAfterSave ?? true;
    const finishSave = (saved?: Entity) => {
      drawerFormInitialSignature.current = formSignature(form);
      if (closeAfterSave) { closeDrawer(); return; }
      // 開いたままの自動保存: 保存後の値でdrawer.entityを更新し、フォーム内の保存状態表示を実データと一致させる。
      if (saved) setDrawer((current) => (current ? { ...current, entity: saved as unknown as Record<string, unknown> } : current));
    };
    const values = new FormData(form);
    const type = form.dataset.entityType as DrawerEntityType | undefined;
    if (!type) return false;
    const named = (name: string) => form.elements.namedItem(name) as HTMLElement | null;
    const base = (drawer?.entity || {}) as Record<string, unknown>;
    let entity: Record<string, unknown> | undefined;

    // --- v2 entity types: full save cycle, then return ---
    if (type === "task") {
      const title = formText(values, "title");
      if (!title) { (named("title") as HTMLInputElement | null)?.focus(); setToast("タイトルを入力してください。"); return false; }
      const taskId = (base.id as string) || uuid();
      const projectId = formText(values, "theme_id") || null;
      const taskSections = projectId ? listTaskSections(data.views || [], projectId) : [];
      const task: Task = {
        id: taskId,
        title,
        project_id: projectId,
        section_id: normalizeTaskSectionId(formText(values, "section_id"), taskSections, projectId),
        state: (formText(values, "state") || "todo") as Task["state"],
        priority: values.has("priority_flag") ? "high" : "normal",
        planning_shelf: normalizeTaskShelf(formText(values, "planning_shelf")),
        reminder_at: normalizeReminderDateTime(formText(values, "reminder_at")),
        description: formText(values, "description") || null,
        repeat_rule: taskRepeatRuleFromForm(values, Number((formText(values, "end_date") || todayIso()).slice(-2))),
        repeat_series_id: formText(values, "repeat_frequency") ? String(base.repeat_series_id || base.id || taskId) : null,
        repeat_parent_task_id: (base.repeat_parent_task_id as string | null) ?? null,
        checklist_items: taskChecklistFromForm(values),
        legacy_item_id: (base.legacy_item_id as string | null) ?? null,
        created_at: (base.created_at as string) || new Date().toISOString(),
      };
      const ops = buildSaveTaskOperations(task);
      const startDate = formText(values, "start_date") || null;
      const endDate = formText(values, "end_date") || null;
      const scheduleId = formText(values, "_schedule_id");
      if (startDate || endDate || scheduleId) {
        const schedule: Schedule = {
          id: scheduleId || uuid(),
          owner_type: "task",
          owner_id: taskId,
          start_date: startDate,
          end_date: endDate,
          date_kind: startDate && endDate && startDate !== endDate ? "range" : endDate ? "deadline" : startDate ? "point" : "unknown",
          confidence: "fixed",
          granularity: "day",
        };
        ops.push(...buildSaveScheduleOperations(schedule));
      }
      // 親 Task の Theme に添付 Artifact を追従させる（保存先ファイルは動かさない）。
      ops.push(...buildArtifactThemeSyncOperations(data.artifacts || [], {
        sourceTypes: ["task"],
        sourceId: taskId,
        themeId: projectId,
      }));
      await saveEntities(ops, base.id ? "変更を保存しました。" : "タスクを追加しました。");
      finishSave();
      return true;
    }
    if (type === "waiting") {
      const title = formText(values, "title");
      const waitingFor = formText(values, "waiting_for");
      if (!title) { (named("title") as HTMLInputElement | null)?.focus(); setToast("タイトルを入力してください。"); return false; }
      if (!waitingFor) { (named("waiting_for") as HTMLInputElement | null)?.focus(); setToast("相手を入力してください。"); return false; }
      const waitingId = (base.id as string) || uuid();
      const waiting: Waiting = {
        id: waitingId,
        title,
        waiting_for: waitingFor,
        project_id: formText(values, "theme_id") || null,
        state: (formText(values, "state") || "waiting") as Waiting["state"],
        check_reminder_at: normalizeReminderDateTime(formText(values, "check_reminder_at")),
        next_action: formText(values, "next_action") || null,
        description: formText(values, "description") || null,
        legacy_item_id: (base.legacy_item_id as string | null) ?? null,
        created_at: (base.created_at as string) || new Date().toISOString(),
      };
      const ops = buildSaveWaitingOperations(waiting);
      const endDate = formText(values, "end_date") || null;
      const scheduleId = formText(values, "_schedule_id");
      if (endDate || scheduleId) {
        const schedule: Schedule = {
          id: scheduleId || uuid(),
          owner_type: "waiting",
          owner_id: waitingId,
          end_date: endDate,
          date_kind: endDate ? "deadline" : "unknown",
          confidence: "fixed",
          granularity: "day",
        };
        ops.push(...buildSaveScheduleOperations(schedule));
      }
      await saveEntities(ops, base.id ? "変更を保存しました。" : "待ちを追加しました。");
      finishSave();
      return true;
    }
    if (type === "plan_node") {
      const title = formText(values, "title");
      if (!title) { (named("title") as HTMLInputElement | null)?.focus(); setToast("タイトルを入力してください。"); return false; }
      const nodeId = (base.id as string) || uuid();
      let parentPlanNodeId = (base.parent_plan_node_id as string | null) ?? null;
      if (!parentPlanNodeId && base._parent_plan_node_item_id) {
        const v2data = domain;
        const parentItemId = base._parent_plan_node_item_id as string;
        const parentNode = v2data.plan_nodes.find((n) => n.legacy_item_id === parentItemId || n.id === parentItemId);
        parentPlanNodeId = parentNode?.id || parentItemId;
      }
      const planNode: PlanNode = {
        id: nodeId,
        title,
        project_id: formText(values, "theme_id") || null,
        parent_plan_node_id: parentPlanNodeId,
        type: (formText(values, "node_type") || "phase") as PlanNode["type"],
        state: (formText(values, "node_state") || "planned") as PlanNode["state"],
        sort_order: Number(base.sort_order) || 0,
        description: formText(values, "description") || null,
        legacy_item_id: (base.legacy_item_id as string | null) ?? null,
        created_at: (base.created_at as string) || new Date().toISOString(),
      };
      const ops = buildSavePlanNodeOperations(planNode);
      const inputUnit = formText(values, "schedule_input_unit") || formText(values, "schedule_granularity") || "day";
      const nodeType = planNode.type;
      const startInput = formText(values, "start_date");
      const endInput = formText(values, "end_date");
      const startDate = inputUnit === "month" ? monthStart(startInput) : (startInput || null);
      const endDate = nodeType === "milestone" ? startDate : inputUnit === "month" ? monthEnd(endInput) : (endInput || null);
      const scheduleId = formText(values, "_schedule_id");
      if (nodeType !== "phase" || startDate || endDate || scheduleId) {
        const schedule: Schedule = {
          id: scheduleId || uuid(),
          owner_type: "plan_node",
          owner_id: nodeId,
          start_date: startDate,
          end_date: endDate,
          date_kind: startDate && endDate && startDate !== endDate ? "range" : endDate ? "deadline" : startDate ? "point" : "unknown",
          confidence: inputUnit === "month" ? "tentative" : "fixed",
          granularity: inputUnit === "month" ? "month" : "day",
        };
        ops.push(...buildSaveScheduleOperations(schedule));
      }
      await saveEntities(ops, base.id ? "変更を保存しました。" : "計画ノードを追加しました。");
      finishSave();
      return true;
    }
    if (type === "capture_entry") {
      const text = formText(values, "text") || formText(values, "title");
      if (!text) { (named("title") as HTMLInputElement | null)?.focus(); setToast("内容を入力してください。"); return false; }
      const entry: CaptureEntry = {
        id: (base.id as string) || uuid(),
        text,
        title: formText(values, "title") || null,
        kind: (base.kind as string | null) ?? null,
        captured_at: formText(values, "captured_at") || (base.captured_at as string) || new Date().toISOString().slice(0, 10),
        state: (formText(values, "entry_state") || "untriaged") as CaptureEntry["state"],
        legacy_item_id: (base.legacy_item_id as string | null) ?? null,
      };
      await saveEntities(buildSaveCaptureEntryOperations(entry), base.id ? "変更を保存しました。" : "Inboxに追加しました。Inboxで整理できます。");
      finishSave();
      if (!base.id && closeAfterSave) navigate("inbox");
      return true;
    }
    if (type === "resource") {
      const title = formText(values, "title");
      const url = formText(values, "url");
      if (!title) { (named("title") as HTMLInputElement | null)?.focus(); setToast("タイトルを入力してください。"); return false; }
      if (!url) { (named("url") as HTMLInputElement | null)?.focus(); setToast("URLを入力してください。"); return false; }
      const hasLinkTypeField = Boolean(named("link_type"));
      const submittedLinkType = formText(values, "link_type");
      const inferredLinkType = inferChatServiceFromUrl(url);
      const sortOrder = Number(formText(values, "sort_order") || base.sort_order || 0);
      const hasBodyMarkdownField = Boolean(named("body_markdown"));
      const resource: Resource = {
        id: (base.id as string) || uuid(),
        title,
        url,
        project_id: formText(values, "project_id") || formText(values, "theme_id") || null,
        description: formText(values, "description") || null,
        body_markdown: hasBodyMarkdownField
          ? (formText(values, "body_markdown") || null)
          : ((base.body_markdown as string | null) ?? null),
        source_record_id: (base.source_record_id as string | null) ?? null,
        link_type: hasLinkTypeField
          ? (submittedLinkType || (inferredLinkType !== "other" ? inferredLinkType : null))
          : ((base.link_type as string | null) ?? null),
        reference_status: formText(values, "reference_status") ? normalizeChatReferenceStatus(formText(values, "reference_status")) : (base.reference_status ? normalizeChatReferenceStatus(String(base.reference_status)) : null),
        importance: formText(values, "importance") || null,
        resource_scope: (base.resource_scope as Resource["resource_scope"]) ?? null,
        captured_at: resolveSubmittedChatCapturedAt(formText(values, "captured_at"), (base.captured_at as string | null) ?? null),
        chat_group: formText(values, "chat_group") || null,
        parent_resource_id: formText(values, "parent_resource_id") || null,
        sort_order: Number.isFinite(sortOrder) && sortOrder > 0 ? sortOrder : null,
        // Archive はドロワー編集では触らず保持する（専用操作で付け外し）
        archived_at: (base.archived_at as string | null | undefined) ?? null,
      };
      const resourceOps = [
        ...buildSaveResourceOperations(resource),
        ...buildArtifactThemeSyncOperations(data.artifacts || [], {
          sourceTypes: ["chat_ref"],
          sourceId: resource.id,
          themeId: resource.project_id || null,
        }),
      ];
      await saveEntities(resourceOps, base.id ? "変更を保存しました。" : "リソースを追加しました。");
      finishSave();
      return true;
    }

    if (type === "theme") {
      const name = formText(values, "name");
      if (!name) { setToast("テーマ名を入力してください。"); return false; }
      const { status: _status, ...rest } = base;
      entity = {
        ...rest,
        name,
        code: formText(values, "code") || null,
        description: formText(values, "description"),
        color: formText(values, "color") || (base.color as string) || "",
        group: formText(values, "group"),
        storage_root: formText(values, "storage_root") || null,
      };
    } else if (type === "note") {
      const title = formText(values, "title");
      if (!title) { setToast("タイトルを入力してください。"); return false; }
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
      const headingNumbers = hasHeadingNumberFields && values.getAll("heading_numbers").map(String).includes("true");
      const headingNumberStartRaw = formText(values, "heading_number_start");
      const headingNumberStart = headingNumberStartRaw === "1" || headingNumberStartRaw === "2" || headingNumberStartRaw === "3" || headingNumberStartRaw === "4"
        ? Number(headingNumberStartRaw)
        : 2;
      const promptProperties = noteType === "prompt" ? {
        prompt_purpose: formText(values, "prompt_purpose", String(base.note_type) === "report_prompt" ? "report" : "other"),
        prompt_variables: formText(values, "prompt_variables"),
        is_default: values.getAll("prompt_is_default").map(String).includes("true"),
      } : {};
      const reportProperties = noteType === "report" ? {
        report_type: formText(values, "report_type", "weekly"),
        period_start: formText(values, "period_start") || null,
        period_end: formText(values, "period_end") || null,
      } : {};
      const headingNumberProperties = hasHeadingNumberFields
        ? { heading_numbers: headingNumbers, heading_number_start: headingNumberStart }
        : {};
      entity = {
        ...base,
        title,
        body_markdown: body,
        note_type: noteType,
        content_format: formText(values, "content_format") || "markdown",
        theme_id: formText(values, "theme_id") || null,
        // Note編集UIから関連タスク（item_id）を外した。フォームに無いときは既存値を保持する（#144）。
        item_id: noteType === "report"
          ? null
          : (named("item_id") ? (formText(values, "item_id") || null) : ((base.item_id as string | null) ?? null)),
        source_url: noteType === "report" ? "" : hasSourceUrlField ? formText(values, "source_url") : (base.source_url as string | undefined),
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
        theme_id: formText(values, "theme_id", activeThemeId),
        date: formText(values, "date", todayIso()),
        status: formText(values, "status", "on_track"),
        summary: formText(values, "summary"),
        progress: Number(values.get("progress") || 0),
        risks: formText(values, "risks"),
        next_actions: formText(values, "next_actions"),
      };
      if (!entity.summary) { setToast("現在地の概要を入力してください。"); return false; }
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
        theme_id: formText(values, "theme_id") || null,
        source_type: sourceType,
        source_id: sourceId,
        source_note_id: sourceType === "note" ? sourceId : (base.source_note_id as string | null) ?? null,
        source_link_id: sourceType === "resource" ? sourceId : (base.source_link_id as string | null) ?? null,
        source_item_id: (sourceType === "task" || sourceType === "waiting" || sourceType === "plan_node") ? sourceId : (base.source_item_id as string | null) ?? null,
        confidence: formText(values, "confidence", "medium"),
        status: formText(values, "status", "active"),
      };
      if (!entity.title) { setToast("Knowledgeのタイトルを入力してください。"); return false; }
      delete entity._auto_edge_target_id;
      delete entity._auto_edge_relation_type;
      if (autoTarget && autoRelation) {
        await saveEntities([
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
        ], base.id ? "変更を保存しました。" : "Knowledgeを追加しました。");
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
      if (!entity.source_node_id || !entity.target_node_id || entity.source_node_id === entity.target_node_id) {
        setToast("異なる2つのKnowledgeを選択してください。");
        return false;
      }
    }

    if (!entity) return false;

    // Note の Theme 変更時は添付 Artifact の theme_id も揃える（ファイルは動かさない）。
    if (type === "note" && entity.id) {
      const noteThemeId = (entity.theme_id as string | null) || null;
      const syncOps = buildArtifactThemeSyncOperations(data.artifacts || [], {
        sourceTypes: ["note", "report"],
        sourceId: String(entity.id),
        themeId: noteThemeId,
      });
      if (syncOps.length) {
        const ops: SaveOperation[] = [
          { action: "save", type: "note", entity: entity as Entity },
          ...syncOps,
        ];
        if (options.quiet) {
          await saveWorkspaceEntities(ops);
        } else {
          await saveEntities(ops, base.id ? "変更を保存しました。" : "メモを追加しました。");
        }
        finishSave(entity as Entity);
        return true;
      }
    }

    const saved = await saveEntity(type, entity, { reason: formText(values, "revision_reason"), quiet: options.quiet });
    if (type === "theme" && !activeThemeId && saved) setActiveThemeId(saved.id);
    finishSave(saved);
    return true;
  }

  if (loadState === "loading") return <AppState state="loading" />;
  if (loadState === "error") return <AppState state="error" message={loadError} onRetry={loadWorkspace} />;
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
    openDrawer,
    saveEntity,
    saveEntities,
    removeEntity,
    removeEntityQuiet,
    setToast,
    snapshotPreview,
    setSnapshotPreview,
  };

  const pages: Record<string, React.ReactNode> = {
    today: <TodayPage {...common} />,
    inbox: <InboxPage {...common} />,
    "chat-refs": <ChatRefsPage {...common} />,
    artifacts: <ArtifactsPage {...common} />,
    theme: <ThemePage {...common} />,
    todo: <TodoPage {...common} />,
    timeline: <TimelinePage {...common} />,
    themes: <ThemesPage {...common} />,
    notes: <NotesPage {...common} />,
    knowledge: <KnowledgePage {...common} />,
    waiting: <WaitingPage {...common} />,
    "ai-io": <ImportExportPage {...common} />,
    settings: <SettingsPage {...common} themeMode={themeMode} setThemeMode={setThemeMode} activeGroups={activeGroups} setActiveGroups={setActiveGroups} allThemes={allThemes} />,
  };
  return (
    <div className={`app-shell ${drawer ? "has-drawer" : ""}`}>
      <Sidebar
        route={route}
        navigate={navigate}
        themes={themes}
        activeThemeId={activeThemeId}
        setActiveThemeId={setActiveThemeId}
        domain={domain}
        openDrawer={openDrawer}
      />
      <main className="main-area">{pages[route] || pages.today}</main>
      {drawer ? (
        <EntityDrawer
          drawer={drawer}
          data={data}
          close={closeDrawer}
          saveForm={saveForm}
          registerEditForm={registerEditForm}
          removeEntity={removeEntity}
          saveEntity={saveEntity}
          saveEntities={saveEntities}
          setToast={setToast}
        />
      ) : (
        <ContextPane
          data={data}
          domain={domain}
          activeTheme={activeTheme}
          route={route}
          openDrawer={openDrawer}
          navigate={navigate}
        />
      )}
      {toast && (
        <div
          className={`toast is-${toastToneValue}`}
          role={toastToneValue === "danger" ? "alert" : "status"}
          aria-live={toastToneValue === "danger" || toastToneValue === "warning" ? "assertive" : "polite"}
        >
          <span className="toast-icon" aria-hidden="true">{toastIcon(toastToneValue)}</span>
          <span className="toast-message">{toast}</span>
          {lastDeleted.current && <button onClick={undoDelete}>元に戻す</button>}
          <button onClick={() => setToast("")}>閉じる</button>
        </div>
      )}
      {showShortcuts && <ShortcutDialog close={() => setShowShortcuts(false)} />}
    </div>
  );
}
