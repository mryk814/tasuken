import { useEffect, useMemo, useRef, useState } from "react";

import { workspaceApi } from "../../services/workspaceApi";
import { useUiStore } from "../../stores/uiStore";
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
import { activeRecords, formText, uuid } from "./lib/format";
import type { SaveOperation } from "./types";
import {
  buildSaveTaskOperations,
  buildSaveWaitingOperations,
  buildSavePlanNodeOperations,
  buildSaveScheduleOperations,
  buildSaveCaptureEntryOperations,
  buildSaveResourceOperations,
} from "./domain-model/persistence";
import type { CaptureEntry, PlanNode, Resource, Schedule, Task, Waiting } from "./domain-model/types";
import { buildWorkspaceDomain } from "./domain-model/compat/legacyAdapter";
import { AppState, Sidebar, ShortcutDialog } from "./components/shell";
import { EntityDrawer } from "./components/drawer";
import { ContextPane } from "./components/contextPane";
import { HomePage } from "./pages/HomePage";
import { TodoPage } from "./pages/TodoPage";
import { TimelinePage } from "./pages/TimelinePage";
import { ThemesPage } from "./pages/ThemesPage";
import { NotesPage } from "./pages/NotesPage";
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
  "knowledge_edges", "change_events",
];

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

export function WorkspaceApp() {
  const workspace = useWorkspaceStore((state) => state.workspace);
  const loadState = useWorkspaceStore((state) => state.loadState);
  const loadError = useWorkspaceStore((state) => state.loadError);
  const loadWorkspaceAction = useWorkspaceStore((state) => state.load);
  const saveWorkspaceEntity = useWorkspaceStore((state) => state.save);
  const saveWorkspaceEntities = useWorkspaceStore((state) => state.saveMany);
  const removeWorkspaceEntity = useWorkspaceStore((state) => state.remove);
  const restoreWorkspaceEntity = useWorkspaceStore((state) => state.restore);
  const route = useUiStore((state) => state.route);
  const setRoute = useUiStore((state) => state.setRoute);
  const activeThemeId = useUiStore((state) => state.activeThemeId);
  const setActiveThemeId = useUiStore((state) => state.setActiveThemeId);
  const [drawer, setDrawer] = useState<DrawerConfig | null>(null);
  const toast = useUiStore((state) => state.toast);
  const setToast = useUiStore((state) => state.setToast);
  const themeMode = useUiStore((state) => state.themeMode);
  const setThemeMode = useUiStore((state) => state.setThemeMode);
  const activeGroups = useUiStore((state) => state.activeGroups);
  const setActiveGroups = useUiStore((state) => state.setActiveGroups);
  const [snapshotPreview, setSnapshotPreview] = useState<SnapshotPreview | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const lastDeleted = useRef<{ type: EntityType; id: string } | null>(null);
  const drawerTrigger = useRef<HTMLElement | null>(null);

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
        void refreshWorkspace().catch((error) => setToast(`更新を反映できませんでした。${errorMessage(error)}`));
        return;
      }
      if (change?.type && change.entity) {
        applyExternalSave(change.type, change.entity);
        void refreshWorkspace().catch((error) => setToast(`更新を反映できませんでした。${errorMessage(error)}`));
        return;
      }
      void refreshWorkspace();
    });
  }, [applyExternalSave, applyExternalSaves, refreshWorkspace, setToast]);

  useEffect(() => {
    const onHash = () => setRoute(location.hash.slice(1) || "today");
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, [setRoute]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    if (loadState === "success") {
      workspaceApi.setPreference("themeMode", themeMode).catch((error) => {
        setToast(`表示設定を保存できませんでした。${errorMessage(error)}`);
      });
    }
  }, [themeMode, loadState, setToast]);

  useEffect(() => {
    if (loadState === "success") {
      workspaceApi.setPreference("activeGroups", activeGroups).catch(() => {});
    }
  }, [activeGroups, loadState]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(""), 6000);
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

  function navigate(next: string) {
    location.hash = next;
    setRoute(next);
  }

  function openDrawer(config: DrawerConfig) {
    drawerTrigger.current = document.activeElement as HTMLElement | null;
    setDrawer(config);
  }

  function closeDrawer(next: DrawerConfig | null = null) {
    setDrawer(next);
    if (!next) requestAnimationFrame(() => drawerTrigger.current?.focus?.());
  }

  const saveEntity: SaveEntity = async (type, entity, options = {}) => {
    try {
      const saved = await saveWorkspaceEntity(type, entity as Entity, options);
      setToast(entity.id ? "変更を保存しました。" : "追加しました。");
      return saved;
    } catch (error) {
      setToast(`保存できませんでした。${errorMessage(error)}`);
      throw error;
    }
  };

  const saveEntities: SaveEntities = async (operations, successMessage = "変更を保存しました。") => {
    try {
      const saved = await saveWorkspaceEntities(operations);
      setToast(successMessage);
      return saved;
    } catch (error) {
      setToast(`保存できませんでした。${errorMessage(error)}`);
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
      closeDrawer();
      setToast(`${entityTitle(type, entity as BaseRecord)}を削除しました。元に戻せます。`);
    } catch (error) {
      setToast(`削除できませんでした。${errorMessage(error)}`);
    }
  }

  async function undoDelete() {
    if (!lastDeleted.current) return;
    await restoreWorkspaceEntity(lastDeleted.current.type, lastDeleted.current.id);
    lastDeleted.current = null;
    setToast("削除を元に戻しました。");
  }

  async function removeEntityQuiet(type: EntityType, id: string) {
    await removeWorkspaceEntity(type, id);
  }

  async function saveForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const type = form.dataset.entityType as DrawerEntityType | undefined;
    if (!type) return;
    const named = (name: string) => form.elements.namedItem(name) as HTMLElement | null;
    const base = (drawer?.entity || {}) as Record<string, unknown>;
    let entity: Record<string, unknown> | undefined;

    // --- v2 entity types: full save cycle, then return ---
    if (type === "task") {
      const title = formText(values, "title");
      if (!title) { (named("title") as HTMLInputElement | null)?.focus(); setToast("タイトルを入力してください。"); return; }
      const taskId = (base.id as string) || uuid();
      const task: Task = {
        id: taskId,
        title,
        project_id: formText(values, "theme_id") || null,
        state: (formText(values, "state") || "todo") as Task["state"],
        priority: values.has("priority_flag") ? "high" : "normal",
        description: formText(values, "description") || null,
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
      await saveEntities(ops, base.id ? "変更を保存しました。" : "タスクを追加しました。");
      closeDrawer();
      return;
    }
    if (type === "waiting") {
      const title = formText(values, "title");
      const waitingFor = formText(values, "waiting_for");
      if (!title) { (named("title") as HTMLInputElement | null)?.focus(); setToast("タイトルを入力してください。"); return; }
      if (!waitingFor) { (named("waiting_for") as HTMLInputElement | null)?.focus(); setToast("相手を入力してください。"); return; }
      const waitingId = (base.id as string) || uuid();
      const waiting: Waiting = {
        id: waitingId,
        title,
        waiting_for: waitingFor,
        project_id: formText(values, "theme_id") || null,
        state: (formText(values, "state") || "waiting") as Waiting["state"],
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
      closeDrawer();
      return;
    }
    if (type === "plan_node") {
      const title = formText(values, "title");
      if (!title) { (named("title") as HTMLInputElement | null)?.focus(); setToast("タイトルを入力してください。"); return; }
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
        type: (formText(values, "node_type") || "milestone") as PlanNode["type"],
        state: (formText(values, "node_state") || "planned") as PlanNode["state"],
        sort_order: Number(base.sort_order) || 0,
        description: formText(values, "description") || null,
        legacy_item_id: (base.legacy_item_id as string | null) ?? null,
        created_at: (base.created_at as string) || new Date().toISOString(),
      };
      const ops = buildSavePlanNodeOperations(planNode);
      const startDate = formText(values, "start_date") || null;
      const endDate = formText(values, "end_date") || null;
      const scheduleId = formText(values, "_schedule_id");
      if (startDate || endDate || scheduleId) {
        const schedule: Schedule = {
          id: scheduleId || uuid(),
          owner_type: "plan_node",
          owner_id: nodeId,
          start_date: startDate,
          end_date: endDate,
          date_kind: startDate && endDate && startDate !== endDate ? "range" : endDate ? "deadline" : startDate ? "point" : "unknown",
          confidence: "fixed",
          granularity: "day",
        };
        ops.push(...buildSaveScheduleOperations(schedule));
      }
      await saveEntities(ops, base.id ? "変更を保存しました。" : "計画ノードを追加しました。");
      closeDrawer();
      return;
    }
    if (type === "capture_entry") {
      const text = formText(values, "text") || formText(values, "title");
      if (!text) { (named("title") as HTMLInputElement | null)?.focus(); setToast("内容を入力してください。"); return; }
      const entry: CaptureEntry = {
        id: (base.id as string) || uuid(),
        text,
        title: formText(values, "title") || null,
        captured_at: formText(values, "captured_at") || (base.captured_at as string) || new Date().toISOString().slice(0, 10),
        state: (formText(values, "entry_state") || "untriaged") as CaptureEntry["state"],
        legacy_item_id: (base.legacy_item_id as string | null) ?? null,
      };
      await saveEntities(buildSaveCaptureEntryOperations(entry), base.id ? "変更を保存しました。" : "Inboxに追加しました。Inboxで整理できます。");
      closeDrawer();
      if (!base.id) navigate("inbox");
      return;
    }
    if (type === "resource") {
      const title = formText(values, "title");
      const url = formText(values, "url");
      if (!title) { (named("title") as HTMLInputElement | null)?.focus(); setToast("タイトルを入力してください。"); return; }
      if (!url) { (named("url") as HTMLInputElement | null)?.focus(); setToast("URLを入力してください。"); return; }
      const resource: Resource = {
        id: (base.id as string) || uuid(),
        title,
        url,
        project_id: formText(values, "project_id") || formText(values, "theme_id") || null,
        description: formText(values, "description") || null,
        source_record_id: (base.source_record_id as string | null) ?? null,
        link_type: formText(values, "link_type") || ((base.link_type as string | null) ?? null),
        reference_status: formText(values, "reference_status") || ((base.reference_status as string | null) ?? null),
        importance: values.has("importance_high") ? "high" : (formText(values, "importance") || null),
        captured_at: formText(values, "captured_at") || ((base.captured_at as string | null) ?? null),
        chat_group: formText(values, "chat_group") || null,
      };
      await saveEntities(buildSaveResourceOperations(resource), base.id ? "変更を保存しました。" : "リソースを追加しました。");
      closeDrawer();
      return;
    }

    if (type === "theme") {
      const name = formText(values, "name");
      if (!name) { setToast("テーマ名を入力してください。"); return; }
      entity = { ...base, name, description: formText(values, "description"), status: formText(values, "status", "計画中"), color: formText(values, "color") || (base.color as string) || "", group: formText(values, "group") };
    } else if (type === "note") {
      const title = formText(values, "title");
      const body = formText(values, "body_markdown");
      if (!title || !body) { setToast("タイトルと本文を入力してください。"); return; }
      entity = {
        ...base,
        title,
        body_markdown: body,
        note_type: formText(values, "note_type", "memo"),
        theme_id: formText(values, "theme_id") || null,
        item_id: formText(values, "item_id") || null,
        source_url: formText(values, "source_url"),
        source_record_id: formText(values, "source_record_id") || null,
        properties_json: (base.properties_json as Record<string, unknown>) || {},
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
      if (!entity.summary) { setToast("現在地の概要を入力してください。"); return; }
    } else if (type === "source_record") {
      entity = {
        ...base,
        source_type: formText(values, "source_type", "manual"),
        source_title: formText(values, "source_title"),
        source_url: formText(values, "source_url"),
        captured_at: formText(values, "captured_at") || new Date().toISOString(),
        raw_text: formText(values, "raw_text"),
        summary: formText(values, "summary"),
      };
      if (!entity.source_title) { setToast("情報源のタイトルを入力してください。"); return; }
    } else if (type === "field_definition") {
      entity = {
        ...base,
        name: formText(values, "name"),
        field_type: formText(values, "field_type", "text"),
        applies_to: formText(values, "applies_to", "item"),
        theme_id: formText(values, "theme_id") || null,
        options_json: formText(values, "options").split(",").map((value) => value.trim()).filter(Boolean),
        sort_order: Number(values.get("sort_order") || 0),
        is_required: values.get("is_required") === "on",
      };
      if (!entity.name) { setToast("項目名を入力してください。"); return; }
    } else if (type === "reference") {
      entity = {
        ...base,
        source_type: formText(values, "source_type", "task"),
        source_id: formText(values, "source_id"),
        target_type: formText(values, "target_type", "task"),
        target_id: formText(values, "target_id"),
        relation_type: formText(values, "relation_type", "related_to"),
        note: formText(values, "note"),
      };
      if (!entity.source_id || !entity.target_id) { setToast("参照元と参照先を選択してください。"); return; }
    } else if (type === "knowledge_node") {
      const sourceType = formText(values, "source_type") || null;
      const sourceId = formText(values, "source_id") || null;
      entity = {
        ...base,
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
      if (!entity.title) { setToast("Knowledgeのタイトルを入力してください。"); return; }
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
        return;
      }
    } else if (type === "task_dependency") {
      entity = {
        ...base,
        task_id: formText(values, "task_id"),
        depends_on_task_id: formText(values, "depends_on_task_id"),
      };
      if (!entity.task_id || !entity.depends_on_task_id || entity.task_id === entity.depends_on_task_id) {
        setToast("異なる2つのタスクを選択してください。");
        return;
      }
    }

    if (!entity) return;

    const saved = await saveEntity(type, entity, { reason: formText(values, "revision_reason") });
    if (type === "theme" && !activeThemeId && saved) setActiveThemeId(saved.id);
    closeDrawer();
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
    refreshWorkspace: async () => {
      await refreshWorkspace();
    },
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
    home: <HomePage {...common} />,
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
          removeEntity={removeEntity}
          saveEntity={saveEntity}
          saveEntities={saveEntities}
        />
      ) : (
        <ContextPane
          data={data}
          domain={domain}
          activeTheme={activeTheme}
          openDrawer={openDrawer}
          navigate={navigate}
        />
      )}
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span>{toast}</span>
          {lastDeleted.current && <button onClick={undoDelete}>元に戻す</button>}
          <button onClick={() => setToast("")}>閉じる</button>
        </div>
      )}
      {showShortcuts && <ShortcutDialog close={() => setShowShortcuts(false)} />}
    </div>
  );
}
