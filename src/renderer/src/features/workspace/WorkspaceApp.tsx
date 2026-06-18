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
import { defaultLevel, entityTitle } from "./lib/domain";
import { activeRecords, formText, uuid } from "./lib/format";
import type { SaveOperation } from "./types";
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
  "themes", "items", "notes", "links", "dependencys", "views",
  "status_updates", "source_records", "entity_sources", "relations",
  "field_definitions", "field_values", "log_entries", "import_batchs",
  "knowledge_nodes", "knowledge_relations", "ai_proposals", "plan_revisions",
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
  const loadSampleAction = useWorkspaceStore((state) => state.loadSample);
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
  const activeGroup = useUiStore((state) => state.activeGroup);
  const setActiveGroup = useUiStore((state) => state.setActiveGroup);
  const [snapshotPreview, setSnapshotPreview] = useState<SnapshotPreview | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const lastDeleted = useRef<{ type: EntityType; id: string } | null>(null);
  const drawerTrigger = useRef<HTMLElement | null>(null);

  async function loadWorkspace() {
    try {
      const loaded = await loadWorkspaceAction();
      setThemeMode((loaded.meta?.themeMode as "light" | "dark") || "light");
      setActiveGroup((loaded.meta?.activeGroup as string) || "");
      if (!useUiStore.getState().activeThemeId) {
        setActiveThemeId(activeRecords((loaded.themes as Theme[]) || [])[0]?.id || "");
      }
    } catch {
      // loadStateにerrorが入るので画面側で再試行導線を出す。
    }
  }

  const refreshWorkspace = useWorkspaceStore((state) => state.refresh);

  useEffect(() => {
    void loadWorkspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!window.api?.app?.onWorkspaceChanged) return;
    return window.api.app.onWorkspaceChanged(() => { void refreshWorkspace(); });
  }, [refreshWorkspace]);

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
      workspaceApi.setPreference("activeGroup", activeGroup).catch(() => {});
    }
  }, [activeGroup, loadState]);

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
        openDrawer({ type: "item", mode: "edit", entity: {} });
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

  const data = useMemo(() => projectWorkspace(workspace as Record<string, unknown> | null), [workspace]);
  const allThemes = data.themes;
  const themes = activeGroup ? allThemes.filter((t) => t.group === activeGroup) : allThemes;
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

  async function toggleItem(item: Item) {
    await saveEntity("item", {
      ...item,
      status: item.status === "done" ? "todo" : "done",
      completed_at: item.status === "done" ? null : new Date().toISOString(),
    });
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

    if (type === "item") {
      const title = formText(values, "title");
      if (!title) {
        (named("title") as HTMLInputElement | null)?.focus();
        setToast("タイトルを入力してください。入力内容は保持されています。");
        return;
      }
      const start = formText(values, "planned_start") || null;
      const end = formText(values, "planned_end") || null;
      if (start && end && end < start) {
        (named("planned_end") as HTMLInputElement | null)?.focus();
        setToast("終了日は開始日以降にしてください。入力内容は保持されています。");
        return;
      }
      const rawKind = formText(values, "kind") || (base.kind as string) || "task";
      const status = formText(values, "status", "todo");
      const kind = rawKind === "idea" && status !== "inbox" ? "task" : rawKind;
      entity = {
        ...base,
        title,
        kind,
        level: formText(values, "level") || (base.level as string) || defaultLevel(kind),
        theme_id: formText(values, "theme_id") || null,
        status,
        priority: values.has("priority_flag") ? "high" : "normal",
        parent_item_id: formText(values, "parent_item_id") || null,
        sort_order: Number(values.get("sort_order") || (base.sort_order as number) || items.length),
        planned_start: start,
        planned_end: end,
        due_date: null,
        actual_start: null,
        actual_end: null,
        baseline_start: start || null,
        baseline_end: end || null,
        schedule_confidence: "fixed",
        date_granularity: "day",
        date_text: "",
        waiting_for: "",
        next_action: "",
        is_personal_task: !formText(values, "theme_id"),
        description: formText(values, "description"),
        source_record_id: null,
      };
    } else if (type === "theme") {
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
    } else if (type === "link") {
      const title = formText(values, "title");
      const url = formText(values, "url");
      if (!title || !url) { setToast("タイトルとURLを入力してください。"); return; }
      entity = {
        ...base,
        title,
        url,
        link_type: formText(values, "link_type", "other"),
        theme_id: formText(values, "theme_id") || null,
        item_id: formText(values, "item_id") || null,
        note_id: formText(values, "note_id") || null,
        description: formText(values, "description"),
        source_record_id: formText(values, "source_record_id") || null,
        reference_status: formText(values, "reference_status", "keep"),
        importance: values.has("importance_high") ? "high" : "normal",
        captured_at: formText(values, "captured_at") || (base.captured_at as string) || new Date().toISOString().slice(0, 10),
        chat_group: formText(values, "chat_group") || null,
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
    } else if (type === "relation") {
      entity = {
        ...base,
        source_entity_type: formText(values, "source_entity_type", "item"),
        source_entity_id: formText(values, "source_entity_id"),
        target_entity_type: formText(values, "target_entity_type", "item"),
        target_entity_id: formText(values, "target_entity_id"),
        relation_type: formText(values, "relation_type", "relates_to"),
        description: formText(values, "description"),
      };
      if (!entity.source_entity_id || !entity.target_entity_id) { setToast("関係元と関係先を選択してください。"); return; }
    } else if (type === "knowledge_node") {
      entity = {
        ...base,
        node_type: formText(values, "node_type", "insight"),
        title: formText(values, "title"),
        body: formText(values, "body"),
        theme_id: formText(values, "theme_id") || null,
        source_note_id: formText(values, "source_note_id") || null,
        source_link_id: formText(values, "source_link_id") || null,
        source_item_id: formText(values, "source_item_id") || null,
        confidence: formText(values, "confidence", "medium"),
        status: formText(values, "status", "active"),
      };
      if (!entity.title) { setToast("Knowledgeのタイトルを入力してください。"); return; }
    } else if (type === "knowledge_relation") {
      entity = {
        ...base,
        source_node_id: formText(values, "source_node_id"),
        target_node_id: formText(values, "target_node_id"),
        relation_type: formText(values, "relation_type", "supports"),
        description: formText(values, "description"),
        confidence: formText(values, "confidence", "medium"),
      };
      if (!entity.source_node_id || !entity.target_node_id || entity.source_node_id === entity.target_node_id) {
        setToast("異なる2つのKnowledgeを選択してください。");
        return;
      }
    } else if (type === "dependency") {
      entity = {
        ...base,
        source_item_id: formText(values, "source_item_id"),
        target_item_id: formText(values, "target_item_id"),
        dependency_type: "finish_to_start",
      };
      if (!entity.source_item_id || !entity.target_item_id || entity.source_item_id === entity.target_item_id) {
        setToast("異なる2つのタスクを選択してください。");
        return;
      }
    }

    if (!entity) return;

    let saved: Entity;
    if (type === "item") {
      const id = (entity.id as string) || uuid();
      const itemEntity = { ...entity, id };
      const itemThemeId = entity.theme_id;
      const definitions = (data.field_definitions || []).filter((field) =>
        field.applies_to === "item" && (!field.theme_id || field.theme_id === itemThemeId));
      const operations: SaveOperation[] = [{
        action: "save",
        type: "item",
        entity: itemEntity as Entity,
        options: { reason: formText(values, "revision_reason") },
      }];
      for (const definition of definitions) {
        const rawValue = formText(values, `custom:${definition.id}`);
        const existing = (data.field_values || []).find((value) =>
          value.field_definition_id === definition.id && value.entity_type === "item" && value.entity_id === id);
        if (rawValue || existing) {
          operations.push({
            action: "save",
            type: "field_value",
            entity: {
              ...existing,
              id: existing?.id || uuid(),
              field_definition_id: definition.id,
              entity_type: "item",
              entity_id: id,
              value_text: rawValue,
              value_number: definition.field_type === "number" && rawValue ? Number(rawValue) : null,
              value_date: definition.field_type === "date" ? rawValue || null : null,
              value_json: definition.field_type === "multi_select" ? rawValue.split(",").map((value) => value.trim()).filter(Boolean) : null,
            } as Entity,
          });
        }
      }
      [saved] = await saveEntities(operations, entity.id ? "変更を保存しました。" : "追加しました。");
    } else {
      saved = await saveEntity(type, entity, { reason: formText(values, "revision_reason") });
    }
    if (type === "theme" && !activeThemeId && saved) setActiveThemeId(saved.id);
    closeDrawer();
  }

  if (loadState === "loading") return <AppState state="loading" />;
  if (loadState === "error") return <AppState state="error" message={loadError} onRetry={loadWorkspace} />;
  if (!workspace) return null;

  const common = {
    data,
    themes,
    items,
    notes,
    links,
    activeTheme,
    activeThemeId,
    setActiveThemeId,
    navigate,
    openDrawer,
    saveEntity,
    saveEntities,
    removeEntity,
    removeEntityQuiet,
    toggleItem,
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
    settings: <SettingsPage {...common} themeMode={themeMode} setThemeMode={setThemeMode} activeGroup={activeGroup} setActiveGroup={setActiveGroup} allThemes={allThemes} loadSample={loadSampleAction} />,
  };

  return (
    <div className={`app-shell ${drawer ? "has-drawer" : ""}`}>
      <Sidebar
        route={route}
        navigate={navigate}
        themes={themes}
        activeThemeId={activeThemeId}
        setActiveThemeId={setActiveThemeId}
        items={items}
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
          toggleItem={toggleItem}
          saveEntity={saveEntity}
        />
      ) : (
        <ContextPane
          data={data}
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
