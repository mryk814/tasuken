import { useEffect, useMemo, useRef, useState } from "react";
import { IconPlus } from "@tabler/icons-react";

import { IconLabel } from "../../components/IconLabel";
import { crossNavigation, toolNavigation } from "../../pages/routes";
import { workspaceApi } from "../../services/workspaceApi";
import { useUiStore } from "../../stores/uiStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { parseSimpleYaml, todayIso, toYaml } from "../../utils/dataFormat.js";

const DAY = 86400000;
const STATUS_LABELS = {
  inbox: "Inbox",
  todo: "未着手",
  doing: "進行中",
  waiting: "待ち",
  review: "確認待ち",
  done: "完了",
  archived: "保留",
  cancelled: "中止",
};
const SCHEDULE_LABELS = {
  unscheduled: "日程未確定",
  tentative: "仮予定",
  scheduled: "予定あり",
  fixed: "確定予定",
};
const KIND_LABELS = {
  task: "タスク",
  milestone: "マイルストーン",
  period: "期間予定",
  event: "イベント",
  waiting: "待ち",
  deliverable: "成果物",
  reminder: "備忘",
  idea: "アイデア",
};
// レベル（粒度）。Timelineに出す「大きな線」と、ToDo中心の「細かい仕事」を区別する。
// kindとは直交。period/milestoneは既定でplan、それ以外はtask。明示値があればそれを優先。
const PLAN_KINDS = ["period", "milestone"];
const LEVEL_LABELS = { plan: "計画（大きな線）", task: "タスク" };
const defaultLevel = (kind) => (PLAN_KINDS.includes(kind) ? "plan" : "task");
const itemLevel = (item) => item.level || defaultLevel(item.kind);
const ENTITY_KEYS = {
  theme: "themes",
  item: "items",
  note: "notes",
  link: "links",
  person: "people",
  dependency: "dependencys",
  view: "views",
  status_update: "status_updates",
  source_record: "source_records",
  entity_source: "entity_sources",
  relation: "relations",
  field_definition: "field_definitions",
  field_value: "field_values",
  log_entry: "log_entries",
  import_batch: "import_batchs",
};
// 横断ビュー（テーマに依存しない）。テーマ別ビューはサイドバーのテーマ一覧から切り替える。
const CROSS_NAV_ITEMS = crossNavigation;
const TOOL_NAV_ITEMS = toolNavigation;

const dateOnly = (value) => value ? String(value).slice(0, 10) : "";
const daysBetween = (from, to) => Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / DAY);
const addDays = (value, count) => {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + count);
  return date.toISOString().slice(0, 10);
};
const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(`${dateOnly(value)}T00:00:00`);
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
};
const formText = (data, key, fallback = "") => String(data.get(key) ?? fallback).trim();
const activeRecords = (records = []) => records.filter((record) => !record.deleted_at);
const uuid = () => crypto.randomUUID();

// ワークフロー状態 → 状態色トーン（tokens.css の status パレット／styles.css の .status-badge.*）。
// 能動的な状態（進行中）を前に、終端（完了・中止）を後退させる。未着手・分類タグは idle（中立）。
function statusTone(status) {
  switch (status) {
    case "done": case "completed": case "on_track": case "完了":
      return "done";
    case "doing": case "進行中":
      return "active";
    case "review": case "確認待ち":
      return "review";
    case "waiting": case "at_risk": case "paused": case "待ち": case "保留":
      return "blocked";
    case "delayed": case "open":
      return "danger"; // 遅延・未解決など明確な問題系のみ警告の赤
    case "cancelled": case "中止":
      return "dropped";
    default:
      return "idle"; // inbox / todo / 計画中 / note_type・link_type 等の分類
  }
}

function entityTitle(type, entity) {
  if (type === "theme") return entity.name;
  if (type === "status_update") return entity.summary;
  return entity.title || entity.name || "無題";
}

function relatedEntityTitle(data, type, id) {
  const keys = { item: "items", note: "notes", link: "links", source_record: "source_records" };
  const entity = (data[keys[type]] || []).find((entry) => entry.id === id);
  return entity?.title || entity?.source_title || entity?.name || id || "未設定";
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
  const [drawer, setDrawer] = useState(null);
  const toast = useUiStore((state) => state.toast);
  const setToast = useUiStore((state) => state.setToast);
  const themeMode = useUiStore((state) => state.themeMode);
  const setThemeMode = useUiStore((state) => state.setThemeMode);
  const [quickText, setQuickText] = useState("");
  const [snapshotPreview, setSnapshotPreview] = useState(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const lastDeleted = useRef(null);
  const drawerTrigger = useRef(null);

  async function loadWorkspace() {
    try {
      const loaded = await loadWorkspaceAction();
      setThemeMode(loaded.meta?.themeMode || "light");
      if (!useUiStore.getState().activeThemeId) {
        setActiveThemeId(activeRecords(loaded.themes)[0]?.id || "");
      }
    } catch {}
  }

  useEffect(() => {
    loadWorkspace();
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(location.hash.slice(1) || "home");
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    if (loadState === "success") {
      workspaceApi.setPreference("themeMode", themeMode).catch((error) => {
        setToast(`表示設定を保存できませんでした。${error.message}`);
      });
    }
  }, [themeMode, loadState]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onKey = (event) => {
      const tag = event.target?.tagName;
      const inInput = ["INPUT", "TEXTAREA", "SELECT"].includes(tag) || event.target?.isContentEditable;
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
        document.querySelector("[data-search]")?.focus();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [drawer, showShortcuts]);

  const data = useMemo(() => {
    if (!workspace) return {};
    return Object.fromEntries(Object.entries(workspace).map(([key, value]) => [
      key,
      Array.isArray(value) ? activeRecords(value) : value,
    ]));
  }, [workspace]);

  const themes = data.themes || [];
  const items = data.items || [];
  const notes = data.notes || [];
  const links = data.links || [];
  const activeTheme = themes.find((theme) => theme.id === activeThemeId) || themes[0] || null;

  function navigate(next) {
    location.hash = next;
    setRoute(next);
  }

  function openDrawer(config) {
    drawerTrigger.current = document.activeElement;
    setDrawer(config);
  }

  function closeDrawer(next = null) {
    setDrawer(next);
    if (!next) requestAnimationFrame(() => drawerTrigger.current?.focus?.());
  }

  async function saveEntity(type, entity, options = {}) {
    try {
      const saved = await saveWorkspaceEntity(type, entity, options);
      setToast(entity.id ? "変更を保存しました。" : "追加しました。");
      return saved;
    } catch (error) {
      setToast(`保存できませんでした。${error.message}`);
      throw error;
    }
  }

  async function saveEntities(operations, successMessage = "変更を保存しました。") {
    try {
      const saved = await saveWorkspaceEntities(operations);
      setToast(successMessage);
      return saved;
    } catch (error) {
      setToast(`保存できませんでした。${error.message}`);
      throw error;
    }
  }

  async function removeEntity(type, entity) {
    try {
      await removeWorkspaceEntity(type, entity.id);
      lastDeleted.current = { type, id: entity.id };
      closeDrawer();
      setToast(`${entityTitle(type, entity)}を削除しました。元に戻せます。`);
    } catch (error) {
      setToast(`削除できませんでした。${error.message}`);
    }
  }

  async function undoDelete() {
    if (!lastDeleted.current) return;
    await restoreWorkspaceEntity(lastDeleted.current.type, lastDeleted.current.id);
    lastDeleted.current = null;
    setToast("削除を元に戻しました。");
  }

  async function toggleItem(item) {
    await saveEntity("item", {
      ...item,
      status: item.status === "done" ? "todo" : "done",
      progress: item.status === "done" ? Math.min(item.progress || 0, 99) : 100,
      actual_end: item.status === "done" ? null : todayIso(),
      completed_at: item.status === "done" ? null : new Date().toISOString(),
    });
  }

  async function addQuickCapture() {
    const title = quickText.trim();
    if (!title) {
      setToast("入力が空です。記録する内容を入力してください。");
      return;
    }
    await saveEntity("item", {
      title,
      kind: "idea",
      level: "task",
      theme_id: activeThemeId || null,
      status: "inbox",
      priority: "normal",
      schedule_status: "unscheduled",
      schedule_confidence: "rough",
      date_granularity: "unknown",
      sort_order: items.length,
      progress: 0,
      description: "",
    });
    setQuickText("");
    setToast("Inboxに記録しました。");
  }

  async function saveForm(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const type = form.dataset.entityType;
    const base = drawer?.entity || {};
    let entity;

    if (type === "item") {
      const title = formText(values, "title");
      if (!title) {
        form.elements.title.focus();
        setToast("タイトルを入力してください。入力内容は保持されています。");
        return;
      }
      const scheduleStatus = formText(values, "schedule_status", "unscheduled");
      const start = formText(values, "planned_start") || null;
      const end = formText(values, "planned_end") || null;
      if (start && end && end < start) {
        form.elements.planned_end.focus();
        setToast("終了日は開始日以降にしてください。入力内容は保持されています。");
        return;
      }
      const kind = formText(values, "kind", "task");
      entity = {
        ...base,
        title,
        kind,
        level: formText(values, "level") || defaultLevel(kind),
        theme_id: formText(values, "theme_id") || null,
        status: formText(values, "status", "todo"),
        priority: formText(values, "priority", "normal"),
        parent_item_id: formText(values, "parent_item_id") || null,
        sort_order: Number(values.get("sort_order") || base.sort_order || items.length),
        planned_start: scheduleStatus === "unscheduled" ? null : start,
        planned_end: scheduleStatus === "unscheduled" ? null : end,
        due_date: formText(values, "due_date") || null,
        actual_start: formText(values, "actual_start") || null,
        actual_end: formText(values, "actual_end") || null,
        baseline_start: base.baseline_start || start,
        baseline_end: base.baseline_end || end,
        schedule_status: scheduleStatus,
        schedule_confidence: formText(values, "schedule_confidence", "rough"),
        date_granularity: formText(values, "date_granularity", "day"),
        date_text: formText(values, "date_text"),
        progress: Math.max(0, Math.min(100, Number(values.get("progress") || 0))),
        owner_person_id: formText(values, "owner_person_id") || null,
        waiting_for: formText(values, "waiting_for"),
        next_action: formText(values, "next_action"),
        is_personal_task: values.get("is_personal_task") === "on",
        description: formText(values, "description"),
        source_record_id: formText(values, "source_record_id") || null,
      };
    } else if (type === "theme") {
      const name = formText(values, "name");
      if (!name) return setToast("テーマ名を入力してください。");
      entity = {
        ...base,
        name,
        description: formText(values, "description"),
        status: formText(values, "status", "計画中"),
      };
    } else if (type === "note") {
      const title = formText(values, "title");
      const body = formText(values, "body_markdown");
      if (!title || !body) return setToast("タイトルと本文を入力してください。");
      entity = {
        ...base,
        title,
        body_markdown: body,
        note_type: formText(values, "note_type", "memo"),
        theme_id: formText(values, "theme_id") || null,
        item_id: formText(values, "item_id") || null,
        source_url: formText(values, "source_url"),
        source_record_id: formText(values, "source_record_id") || null,
        properties_json: base.properties_json || {},
        comments: base.comments || [],
      };
    } else if (type === "link") {
      const title = formText(values, "title");
      const url = formText(values, "url");
      if (!title || !url) return setToast("タイトルとURLを入力してください。");
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
      };
    } else if (type === "person") {
      const name = formText(values, "name");
      if (!name) return setToast("名前を入力してください。");
      entity = {
        ...base,
        name,
        role: formText(values, "role"),
        organization: formText(values, "organization"),
        note: formText(values, "note"),
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
      if (!entity.summary) return setToast("現在地の概要を入力してください。");
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
      if (!entity.source_title) return setToast("情報源のタイトルを入力してください。");
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
      if (!entity.name) return setToast("項目名を入力してください。");
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
      if (!entity.source_entity_id || !entity.target_entity_id) return setToast("関係元と関係先を選択してください。");
    } else if (type === "dependency") {
      entity = {
        ...base,
        source_item_id: formText(values, "source_item_id"),
        target_item_id: formText(values, "target_item_id"),
        dependency_type: "finish_to_start",
      };
      if (!entity.source_item_id || !entity.target_item_id || entity.source_item_id === entity.target_item_id) {
        return setToast("異なる2つのItemを選択してください。");
      }
    }

    let saved;
    if (type === "item") {
      const itemEntity = { ...entity, id: entity.id || uuid() };
      const definitions = (data.field_definitions || []).filter((field) =>
        field.applies_to === "item" && (!field.theme_id || field.theme_id === itemEntity.theme_id));
      const operations = [{
        action: "save",
        type: "item",
        entity: itemEntity,
        options: { reason: formText(values, "revision_reason") },
      }];
      for (const definition of definitions) {
        const rawValue = formText(values, `custom:${definition.id}`);
        const existing = (data.field_values || []).find((value) =>
          value.field_definition_id === definition.id && value.entity_type === "item" && value.entity_id === itemEntity.id);
        if (rawValue || existing) {
          operations.push({
            action: "save",
            type: "field_value",
            entity: {
              ...existing,
              id: existing?.id || uuid(),
              field_definition_id: definition.id,
              entity_type: "item",
              entity_id: itemEntity.id,
              value_text: rawValue,
              value_number: definition.field_type === "number" && rawValue ? Number(rawValue) : null,
              value_date: definition.field_type === "date" ? rawValue || null : null,
              value_json: definition.field_type === "multi_select" ? rawValue.split(",").map((value) => value.trim()).filter(Boolean) : null,
            },
          });
        }
      }
      [saved] = await saveEntities(operations, entity.id ? "変更を保存しました。" : "追加しました。");
    } else {
      saved = await saveEntity(type, entity, { reason: formText(values, "revision_reason") });
    }
    if (type === "theme" && !activeThemeId) setActiveThemeId(saved.id);
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
    removeEntity,
    toggleItem,
    setToast,
    snapshotPreview,
    setSnapshotPreview,
  };

  const pages = {
    home: <HomePage {...common} />,
    todo: <TodoPage {...common} />,
    timeline: <TimelinePage {...common} />,
    milestones: <MilestonePage {...common} />,
    themes: <ThemesPage {...common} />,
    notes: <NotesPage {...common} />,
    waiting: <WaitingPage {...common} />,
    "ai-io": <ImportExportPage {...common} />,
    settings: <SettingsPage {...common} themeMode={themeMode} setThemeMode={setThemeMode} />,
  };

  return (
    <div className={`app-shell ${drawer ? "has-drawer" : ""}`}>
      <Sidebar
        route={route}
        navigate={navigate}
        themes={themes}
        activeThemeId={activeThemeId}
        setActiveThemeId={setActiveThemeId}
        quickText={quickText}
        setQuickText={setQuickText}
        addQuickCapture={addQuickCapture}
        items={items}
        openDrawer={openDrawer}
      />
      <main className="main-area">{pages[route] || pages.home}</main>
      {drawer && (
        <EntityDrawer
          drawer={drawer}
          data={data}
          close={closeDrawer}
          saveForm={saveForm}
          removeEntity={removeEntity}
          toggleItem={toggleItem}
          saveEntity={saveEntity}
        />
      )}
      <button className="mobile-capture" onClick={() => openDrawer({ type: "item", mode: "edit", entity: {} })}><IconLabel icon={IconPlus}>項目を追加</IconLabel></button>
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

function AppState({ state, message, onRetry }) {
  return (
    <main className="standalone-state">
      <div className={`state-box ${state}`}>
        {state === "loading" ? (
          <><span className="spinner" /><strong>Workspaceを読み込んでいます</strong></>
        ) : (
          <>
            <strong>Workspaceを読み込めませんでした</strong>
            <span>{message} アプリを再起動するか、もう一度試してください。</span>
            <button className="primary-button" onClick={onRetry}>再試行する</button>
          </>
        )}
      </div>
    </main>
  );
}

function Sidebar({ route, navigate, themes, activeThemeId, setActiveThemeId, quickText, setQuickText, addQuickCapture, items, openDrawer }) {
  const inbox = items.filter((item) => item.status === "inbox").length;
  const waiting = items.filter((item) => item.status === "waiting" || item.kind === "waiting").length;
  return (
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">RD</span><div><strong>Research Desk</strong></div></div>
      <nav className="primary-nav" aria-label="横断ビュー">
        <div className="nav-heading"><span>横断</span></div>
        {CROSS_NAV_ITEMS.map(([id, label]) => (
          <button key={id} className={route === id ? "is-active" : ""} aria-current={route === id ? "page" : undefined} onClick={() => navigate(id)}>
            <span>{label}</span>
            {id === "todo" && inbox > 0 && <span className="count">{inbox}</span>}
            {id === "waiting" && waiting > 0 && <span className="count">{waiting}</span>}
          </button>
        ))}
      </nav>
      <div className="theme-nav">
        <div className="nav-heading"><span>テーマ別</span><button onClick={() => openDrawer({ type: "theme", mode: "edit", entity: {} })}>＋ 追加</button></div>
        <button className={`theme-nav-all ${route === "themes" ? "is-active" : ""}`} aria-current={route === "themes" ? "page" : undefined} onClick={() => navigate("themes")}>
          <span>すべてのテーマ</span><span className="count">{themes.length}</span>
        </button>
        {themes.map((theme) => {
          const current = route === "home" && theme.id === activeThemeId;
          return (
            <button key={theme.id} className={current ? "is-active" : ""} aria-current={current ? "page" : undefined} onClick={() => { setActiveThemeId(theme.id); navigate("home"); }}>
              <span className="theme-dot" /><span>{theme.name}</span>
            </button>
          );
        })}
      </div>
      <nav className="primary-nav utility-nav" aria-label="ツール">
        <div className="nav-heading"><span>ツール</span></div>
        {TOOL_NAV_ITEMS.map(([id, label]) => (
          <button key={id} className={route === id ? "is-active" : ""} aria-current={route === id ? "page" : undefined} onClick={() => navigate(id)}>
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="quick-capture">
        <strong>クイック記録</strong>
        <textarea value={quickText} onChange={(event) => setQuickText(event.target.value)} placeholder="タスク・メモ・アイデア" />
        <button className="primary-button" onClick={addQuickCapture}>Inboxに記録</button>
      </div>
    </aside>
  );
}

function PageHeader({ title, children }) {
  return <header className="page-header"><h1>{title}</h1><div className="header-actions">{children}</div></header>;
}

function HomePage({ data, activeTheme, items, notes, links, openDrawer, navigate }) {
  if (!activeTheme) return <EmptyState title="テーマがありません" action="テーマを追加" onAction={() => openDrawer({ type: "theme", mode: "edit", entity: {} })} />;
  const related = items.filter((item) => item.theme_id === activeTheme.id);
  const open = related.filter((item) => item.status !== "done");
  const waiting = open.filter((item) => item.kind === "waiting" || item.status === "waiting");
  const milestones = open.filter((item) => item.kind === "milestone").sort(compareDate);
  const updates = (data.status_updates || []).filter((entry) => entry.theme_id === activeTheme.id).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const latest = updates[0];
  return (
    <div className="page">
      <PageHeader title={activeTheme.name} subtitle={activeTheme.description}>
        <StatusBadge value={activeTheme.status} label={activeTheme.status} />
        <button className="secondary-button" onClick={() => openDrawer({ type: "status_update", mode: "edit", entity: { theme_id: activeTheme.id } })}>現在地を記録</button>
        <button className="primary-button" onClick={() => openDrawer({ type: "item", mode: "edit", entity: { theme_id: activeTheme.id } })}>項目を追加</button>
      </PageHeader>
      <div className="metric-grid home-metrics">
        <Metric label="未完了" value={open.length} tone="primary" />
        <Metric label="待ち" value={waiting.length} />
        <Metric label="マイルストーン" value={milestones.length} />
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="section-heading"><h2>現在地</h2><span>{latest ? formatDate(latest.date) : "未記録"}</span></div>
          {latest ? <div className="status-summary"><StatusBadge value={latest.status} label={latest.status} /><strong>{latest.summary}</strong>{latest.risks && <p>{latest.risks}</p>}{latest.next_actions && <p><b>次:</b> {latest.next_actions}</p>}</div> : <EmptyState title="現在地がまだありません" action="記録する" onAction={() => openDrawer({ type: "status_update", mode: "edit", entity: { theme_id: activeTheme.id } })} />}
        </section>
        <section className="panel">
          <div className="section-heading"><h2>近いマイルストーン</h2><button className="text-button compact" onClick={() => navigate("milestones")}>一覧を開く</button></div>
          <SimpleRows records={milestones.slice(0, 5)} onOpen={(item) => openDrawer({ type: "item", entity: item })} meta={(item) => item.date_text || formatDate(item.due_date || item.planned_end)} />
        </section>
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="section-heading"><h2>次のタスク</h2><button className="text-button compact" onClick={() => navigate("todo")}>ToDoへ</button></div>
          <SimpleRows records={open.filter((item) => item.kind === "task" || item.kind === "deliverable").sort(compareDate).slice(0, 7)} onOpen={(item) => openDrawer({ type: "item", entity: item })} meta={(item) => formatDate(item.due_date)} />
        </section>
        <section className="panel">
          <div className="section-heading"><h2>最近のメモ</h2><span>{notes.filter((note) => note.theme_id === activeTheme.id).length}件</span></div>
          <SimpleRows records={notes.filter((note) => note.theme_id === activeTheme.id).slice(0, 5)} onOpen={(note) => openDrawer({ type: "note", entity: note })} meta={(note) => note.note_type} />
        </section>
      </div>
    </div>
  );
}

function TodoPage({ themes, items, openDrawer, saveEntity, toggleItem, setToast }) {
  const [filter, setFilter] = useState("open");
  const [selected, setSelected] = useState([]);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pastePreview, setPastePreview] = useState([]);
  const [shiftDays, setShiftDays] = useState(7);
  const today = todayIso();
  const tasks = items.filter((item) => item.status === "inbox" || ["task", "deliverable", "reminder"].includes(item.kind) || item.is_personal_task);
  const counters = {
    today: tasks.filter((item) => item.status !== "done" && item.due_date === today).length,
    overdue: tasks.filter((item) => item.status !== "done" && item.due_date && item.due_date < today).length,
    inbox: tasks.filter((item) => item.status === "inbox").length,
    unscheduled: tasks.filter((item) => item.status !== "done" && item.schedule_status === "unscheduled").length,
  };
  const visible = tasks.filter((item) => {
    if (filter === "done") return item.status === "done";
    if (filter === "inbox") return item.status === "inbox";
    if (filter === "unscheduled") return item.status !== "done" && item.schedule_status === "unscheduled";
    if (filter === "overdue") return item.status !== "done" && item.due_date && item.due_date < today;
    return item.status !== "done" && item.status !== "inbox";
  }).sort(compareDate);

  async function bulkUpdate(field, value) {
    await Promise.all(selected.map((id) => {
      const item = items.find((entry) => entry.id === id);
      return item ? saveEntity("item", { ...item, [field]: value }) : null;
    }));
    setSelected([]);
    setToast(`${selected.length}件を更新しました。`);
  }

  async function shiftSelected() {
    const count = selected.length;
    await Promise.all(selected.map((id) => {
      const item = items.find((entry) => entry.id === id);
      if (!item) return null;
      return saveEntity("item", {
        ...item,
        planned_start: addDays(item.planned_start, shiftDays),
        planned_end: addDays(item.planned_end, shiftDays),
        due_date: addDays(item.due_date, shiftDays),
      }, { reason: `一括操作で${shiftDays}日シフト` });
    }));
    setSelected([]);
    setToast(`${count}件の日程を${shiftDays}日移動しました。`);
  }

  function previewPaste() {
    const rows = parseTaskTable(pasteText, themes);
    if (!rows.length) {
      setToast("貼り付け内容を読み取れませんでした。1行に1件、またはTSV/CSVの表を貼り付けてください。");
      return;
    }
    setPastePreview(rows);
  }

  async function importPaste() {
    for (const [index, row] of pastePreview.entries()) {
      await saveEntity("item", {
        title: row.title,
        kind: row.kind || "task",
        level: defaultLevel(row.kind || "task"),
        theme_id: row.theme_id,
        status: row.status || "todo",
        priority: row.priority || "normal",
        planned_start: row.planned_start,
        planned_end: row.planned_end,
        due_date: row.due_date,
        schedule_status: row.planned_start || row.planned_end || row.due_date ? "scheduled" : "unscheduled",
        schedule_confidence: "tentative",
        date_granularity: "day",
        is_personal_task: !row.theme_id,
        sort_order: items.length + index,
        progress: 0,
        description: row.description || "",
      }, { source: "pasted_table" });
    }
    setToast(`${pastePreview.length}件を追加しました。`);
    setPasteText("");
    setPastePreview([]);
    setShowPaste(false);
  }

  function copyRows() {
    const header = "タスク\t状態\tテーマ\t期限";
    const rows = visible.map((item) => `${item.title}\t${STATUS_LABELS[item.status]}\t${themes.find((theme) => theme.id === item.theme_id)?.name || "個人業務"}\t${item.due_date || "日程未確定"}`);
    workspaceApi.copyText([header, ...rows].join("\n")).then(() => setToast("ToDo一覧をコピーしました。"));
  }

  return (
    <div className="page">
      <PageHeader title="ToDo" subtitle="今日の作業と日程未確定の仕事を整理します。">
        <button className="secondary-button" onClick={copyRows}>一覧をコピー</button>
        <button className="secondary-button" onClick={() => setShowPaste((current) => !current)}>表から追加</button>
        <button className="primary-button" onClick={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "task" } })}>タスクを追加</button>
      </PageHeader>
      <div className="metric-grid todo-metrics">
        <Metric label="今日やる" value={counters.today} tone="primary" />
        <Metric label="期限超過" value={counters.overdue} tone="danger" />
        <Metric label="Inbox" value={counters.inbox} />
        <Metric label="日程未確定" value={counters.unscheduled} />
      </div>
      {showPaste && (
        <section className="panel paste-panel">
          <div className="section-heading"><h2>表から追加</h2><span>タイトル / Theme / 期限 / 状態 / 説明</span></div>
          <textarea value={pasteText} onChange={(event) => { setPasteText(event.target.value); setPastePreview([]); }} placeholder={"タイトル\tTheme\t期限\t状態\t説明\n測定条件を確認\t材料A評価\t2026-06-20\t未着手\t条件表と照合"} />
          {pastePreview.length > 0 && <div className="paste-preview">{pastePreview.map((row, index) => <div key={`${row.title}-${index}`}><strong>{row.title}</strong><span>{themes.find((theme) => theme.id === row.theme_id)?.name || "個人業務"}</span><time>{row.due_date || "日程未確定"}</time></div>)}</div>}
          <div className="form-actions"><button className="secondary-button" onClick={() => { setShowPaste(false); setPastePreview([]); }}>閉じる</button>{pastePreview.length ? <button className="primary-button" onClick={importPaste}>追加する</button> : <button className="primary-button" onClick={previewPaste}>内容を確認</button>}</div>
        </section>
      )}
      <section className="panel list-page">
        <div className="list-toolbar">
          <div className="segmented">
            {[["open", "未完了"], ["inbox", "Inbox"], ["overdue", "期限超過"], ["unscheduled", "日程未確定"], ["done", "完了"]].map(([id, label]) => <button key={id} className={filter === id ? "is-active" : ""} onClick={() => setFilter(id)}>{label}</button>)}
          </div>
          {selected.length > 0 && <div className="inline-actions bulk-actions"><span>{selected.length}件選択</span><button className="secondary-button compact" onClick={() => bulkUpdate("status", "done")}>完了にする</button><select aria-label="Themeを一括変更" onChange={(event) => event.target.value && bulkUpdate("theme_id", event.target.value)} defaultValue=""><option value="">Theme変更</option>{themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</select><input className="shift-days" aria-label="日程を移動する日数" type="number" value={shiftDays} onChange={(event) => setShiftDays(Number(event.target.value) || 0)} /><button className="secondary-button compact" onClick={shiftSelected}>日程を移動</button></div>}
        </div>
        <div className="data-table todo-table">
          <div className="table-head"><span /><span>タスク</span><span>状態</span><span>Theme</span><span>期限</span></div>
          {visible.map((item) => (
            <div className="table-row" key={item.id}>
              <input type="checkbox" checked={selected.includes(item.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} aria-label={`${item.title}を選択`} />
              <button className="row-title" onClick={() => openDrawer({ type: "item", entity: item })}>{item.title}</button>
              {item.status === "inbox"
                ? <button className="check-action" onClick={() => saveEntity("item", { ...item, status: "todo", kind: item.kind === "idea" ? "task" : item.kind })}>整理</button>
                : <button className="check-action" onClick={() => toggleItem(item)}>{item.status === "done" ? "戻す" : "完了"}</button>}
              <span>{themes.find((theme) => theme.id === item.theme_id)?.name || "個人業務"}</span>
              <span className="num">{item.date_text || formatDate(item.due_date)}</span>
            </div>
          ))}
        </div>
        {!visible.length && <EmptyState title="該当するタスクはありません" action="タスクを追加" onAction={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "task" } })} />}
      </section>
    </div>
  );
}

function TimelinePage({ data, themes, items, openDrawer, saveEntity, setToast, navigate }) {
  const [scale, setScale] = useState("quarter");
  const [themeFilter, setThemeFilter] = useState("all");
  const [showCompleted, setShowCompleted] = useState(false);
  const [showDependencies, setShowDependencies] = useState(true);
  const [showLightning, setShowLightning] = useState(false);
  const [showTasks, setShowTasks] = useState(false);
  const [collapsedThemes, setCollapsedThemes] = useState([]);
  const [collapsedItems, setCollapsedItems] = useState([]);
  const scrollRef = useRef(null);
  const today = todayIso();
  const range = ganttRange(scale, today);
  const timelineItems = items.filter((item) => {
    if (!showCompleted && item.status === "done") return false;
    if (themeFilter !== "all" && item.theme_id !== themeFilter) return false;
    return true;
  });
  const rows = buildTimelineRows({ items: timelineItems, themes, showTasks, collapsedThemes, collapsedItems });
  const groupKeys = rows.filter((row) => row.rowType === "theme").map((row) => row.groupKey);
  const days = Math.max(1, daysBetween(range.start, range.end));
  const todayLeft = (daysBetween(range.start, today) / days) * 100;

  function scrollToday() {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollLeft = Math.max(0, element.scrollWidth * todayLeft / 100 - element.clientWidth / 2);
  }

  async function moveItem(item, delta, mode = "move") {
    if (!delta || item.schedule_status === "unscheduled") return;
    const next = { ...item };
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
              return <div className="gantt-theme-row" key={`theme-${row.groupKey}`}>
                <button className="gantt-theme-toggle" onClick={() => setCollapsedThemes((current) => current.includes(row.groupKey) ? current.filter((key) => key !== row.groupKey) : [...current, row.groupKey])} aria-expanded={!collapsed}>
                  <span className="gantt-theme-caret">{collapsed ? "＋" : "−"}</span>
                  <strong>{row.theme?.name || "個人業務 / Themeなし"}</strong>
                  {row.theme && <StatusBadge value={row.theme.status} label={row.theme.status} />}
                </button>
                <span className="gantt-theme-count">計画 {row.planCount} / タスク {row.taskCount}</span>
              </div>;
            }
            const { item, depth, hasChildren } = row;
            return <div className={`gantt-table-row level-${itemLevel(item)}`} key={item.id}>
              <button className="gantt-name" style={{ paddingLeft: `calc(var(--space-2) + ${depth * 14}px)` }} onClick={() => openDrawer({ type: "item", entity: item })}>
                {hasChildren
                  ? <span onClick={(event) => { event.stopPropagation(); setCollapsedItems((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]); }}>{collapsedItems.includes(item.id) ? "＋" : "−"}</span>
                  : item.kind === "milestone" && <span className="gantt-milestone-mark">◆</span>}
                {item.title}
              </button>
              <StatusBadge value={item.status} label={STATUS_LABELS[item.status]} />
              <span className="num">{formatDate(item.planned_start)}</span>
              <span className="num">{formatDate(item.planned_end)}</span>
              <span className="num">{item.progress || 0}%</span>
            </div>;
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

function GanttItemRow({ item, range, onOpen, onMove }) {
  const rowRef = useRef(null);
  const level = itemLevel(item);
  const start = item.planned_start || item.due_date;
  const end = item.planned_end || item.due_date || start;
  const total = Math.max(1, daysBetween(range.start, range.end));
  const left = start ? Math.max(0, Math.min(100, daysBetween(range.start, start) / total * 100)) : 0;
  const width = start ? Math.max(item.kind === "milestone" ? 0.8 : 1.4, Math.min(100 - left, (daysBetween(start, end) + 1) / total * 100)) : 0;

  function beginDrag(event, mode) {
    event.preventDefault();
    event.stopPropagation();
    const initialX = event.clientX;
    const trackWidth = rowRef.current?.clientWidth || 1;
    const onUp = (upEvent) => {
      const delta = Math.round((upEvent.clientX - initialX) / trackWidth * total);
      onMove(item, delta, mode);
      removeEventListener("pointerup", onUp);
    };
    addEventListener("pointerup", onUp);
  }

  return (
    <div className={`gantt-item-row level-${level}`} ref={rowRef}>
      {item.schedule_status !== "unscheduled" && start && (
        <button
          className={`gantt-item-bar level-${level} ${item.kind === "milestone" ? "milestone" : ""} schedule-${item.schedule_status || "scheduled"} confidence-${item.schedule_confidence || "rough"}`}
          style={{ left: `${left}%`, width: `${width}%` }}
          onClick={onOpen}
          onPointerDown={(event) => beginDrag(event, "move")}
          title={`${item.title} / ${SCHEDULE_LABELS[item.schedule_status] || ""}`}
        >
          {item.kind !== "milestone" && <span className="resize-handle start" onPointerDown={(event) => beginDrag(event, "start")} />}
          <span>{item.kind === "milestone" ? "◆" : item.title}</span>
          {item.kind !== "milestone" && <span className="resize-handle end" onPointerDown={(event) => beginDrag(event, "end")} />}
        </button>
      )}
    </div>
  );
}

function TimeAxis({ start, end, scale }) {
  const blocks = [];
  let cursor = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  const step = scale === "week" ? 1 : scale === "month" ? 7 : 30;
  while (cursor <= last && blocks.length < 60) {
    blocks.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + step * DAY);
  }
  return <div className="gantt-axis" style={{ gridTemplateColumns: `repeat(${blocks.length}, 1fr)` }}>{blocks.map((value) => <span key={value}>{scale === "week" ? value.slice(5) : value.slice(0, 7)}</span>)}</div>;
}

function DependencyOverlay({ dependencies, rows, range }) {
  const total = Math.max(1, daysBetween(range.start, range.end));
  const rowIndexOf = (id) => rows.findIndex((row) => row.rowType === "item" && row.item.id === id);
  const lines = dependencies.flatMap((dependency) => {
    const sourceIndex = rowIndexOf(dependency.source_item_id);
    const targetIndex = rowIndexOf(dependency.target_item_id);
    if (sourceIndex < 0 || targetIndex < 0) return [];
    const source = rows[sourceIndex].item;
    const target = rows[targetIndex].item;
    const sourceDate = source.planned_end || source.due_date;
    const targetDate = target.planned_start || target.due_date;
    if (!sourceDate || !targetDate) return [];
    const sourceX = Math.max(0, Math.min(1000, daysBetween(range.start, sourceDate) / total * 1000));
    const targetX = Math.max(0, Math.min(1000, daysBetween(range.start, targetDate) / total * 1000));
    const sourceY = sourceIndex * 44 + 22;
    const targetY = targetIndex * 44 + 22;
    const bendX = Math.max(sourceX + 12, (sourceX + targetX) / 2);
    return [{ ...dependency, sourceX, sourceY, targetX, targetY, bendX }];
  });
  if (!lines.length) return null;
  const height = Math.max(44, rows.length * 44);
  return (
    <svg className="dependency-overlay" viewBox={`0 0 1000 ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs><marker id="dependency-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" /></marker></defs>
      {lines.map((line) => (
        <path
          key={line.id}
          d={`M ${line.sourceX} ${line.sourceY} H ${line.bendX} V ${line.targetY} H ${line.targetX}`}
          markerEnd="url(#dependency-arrow)"
        />
      ))}
    </svg>
  );
}

function LightningOverlay({ rows, range, today }) {
  const totalDays = Math.max(1, daysBetween(range.start, range.end));
  const todayX = (daysBetween(range.start, today) / totalDays) * 1000;
  const points = rows.flatMap((row, index) => {
    if (row.rowType !== "item") return [];
    const item = row.item;
    const start = item.planned_start || item.due_date;
    const end = item.planned_end || item.due_date || start;
    if (!start || !end || item.schedule_status === "unscheduled") return [];
    const duration = Math.max(1, daysBetween(start, end) + 1);
    const elapsed = Math.max(0, Math.min(duration, daysBetween(start, today) + 1));
    const plannedProgress = elapsed / duration;
    const actualProgress = Math.max(0, Math.min(1, Number(item.progress || 0) / 100));
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

function MilestonePage({ themes, items, openDrawer, setToast }) {
  const [range, setRange] = useState("90");
  const today = todayIso();
  const limit = addDays(today, Number(range));
  const records = items.filter((item) => {
    const date = item.due_date || item.planned_end;
    return (item.kind === "milestone" || (item.priority === "high" && date)) && date >= today && date <= limit;
  }).sort(compareDate);
  function copy() {
    workspaceApi.copyText(records.map((item) => `${item.due_date || item.planned_end}\t${themes.find((theme) => theme.id === item.theme_id)?.name || "—"}\t${item.title}`).join("\n")).then(() => setToast("マイルストーンをコピーしました。"));
  }
  return (
    <div className="page">
      <PageHeader title="Milestone Map" subtitle="重要な節目だけをTheme横断で確認します。"><button className="secondary-button" onClick={copy}>一覧をコピー</button><button className="primary-button" onClick={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "milestone", schedule_status: "fixed", schedule_confidence: "fixed" } })}>マイルストーンを追加</button></PageHeader>
      <div className="filter-bar panel"><div className="segmented">{[["30", "30日"], ["90", "90日"], ["180", "半期"], ["365", "年度"]].map(([id, label]) => <button key={id} className={range === id ? "is-active" : ""} onClick={() => setRange(id)}>{label}</button>)}</div><span>{records.length}件</span></div>
      <section className="panel milestone-map">{records.map((item) => <button key={item.id} className="milestone-row" onClick={() => openDrawer({ type: "item", entity: item })}><time>{formatDate(item.due_date || item.planned_end)}</time><strong>{themes.find((theme) => theme.id === item.theme_id)?.name || "Themeなし"}</strong><span>{item.title}</span><StatusBadge value={item.schedule_status} label={SCHEDULE_LABELS[item.schedule_status]} /></button>)}{!records.length && <EmptyState title="この期間のマイルストーンはありません" action="追加する" onAction={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "milestone" } })} />}</section>
    </div>
  );
}

function ThemesPage({ themes, items, data, activeThemeId, setActiveThemeId, navigate, openDrawer }) {
  return (
    <div className="page">
      <PageHeader title="Themes" subtitle="研究テーマごとの現在地と負荷を確認します。"><button className="primary-button" onClick={() => openDrawer({ type: "theme", mode: "edit", entity: {} })}>テーマを追加</button></PageHeader>
      <div className="theme-card-grid">{themes.map((theme) => {
        const related = items.filter((item) => item.theme_id === theme.id);
        const latest = (data.status_updates || []).filter((entry) => entry.theme_id === theme.id).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
        return <button className={`panel theme-card ${activeThemeId === theme.id ? "selected" : ""}`} key={theme.id} onClick={() => { setActiveThemeId(theme.id); navigate("home"); }}><StatusBadge value={theme.status} label={theme.status} /><h2>{theme.name}</h2><p>{latest?.summary || theme.description || "現在地は未記録です。"}</p><div><span><strong className="metric-value">{related.filter((item) => item.status !== "done").length}</strong> 未完了</span><span><strong className="metric-value">{related.filter((item) => item.status === "waiting").length}</strong> 待ち</span></div></button>;
      })}</div>
    </div>
  );
}

function NotesPage({ themes, notes, links, openDrawer, setToast }) {
  const [query, setQuery] = useState("");
  const records = [
    ...notes.map((note) => ({ ...note, recordType: "note" })),
    ...links
      .filter((link) => !notes.some((note) => note.source_url && note.source_url === link.url))
      .map((link) => ({ ...link, recordType: "link" })),
  ].sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  const visible = records.filter((record) =>
    `${record.title} ${record.body_markdown || record.description || ""} ${record.url || record.source_url || ""}`
      .toLowerCase()
      .includes(query.toLowerCase()));
  function copy() {
    workspaceApi.copyText(visible.map((record) => `${record.title}\t${record.recordType === "link" ? "link" : record.note_type}\t${themes.find((theme) => theme.id === record.theme_id)?.name || "—"}\t${record.url || record.source_url || ""}`).join("\n")).then(() => setToast("Notes一覧をコピーしました。"));
  }
  return <div className="page"><PageHeader title="Notes"><button className="secondary-button" onClick={copy}>一覧をコピー</button><button className="primary-button" onClick={() => openDrawer({ type: "note", mode: "edit", entity: {} })}>メモを書く</button></PageHeader><div className="filter-bar panel"><input data-search value={query} onChange={(event) => setQuery(event.target.value)} placeholder="タイトル、本文、URLを検索" /><span>{visible.length}件</span></div><section className="panel list-page">{visible.map((record) => <div className="note-row" key={`${record.recordType}-${record.id}`}><button className="note-row-main" onClick={() => openDrawer({ type: record.recordType, entity: record })}><span className="note-row-head"><StatusBadge value="neutral" label={record.recordType === "link" ? "link" : record.note_type} /><strong className="note-row-title">{record.title}</strong>{record.recordType === "note" && record.comments?.length > 0 && <span className="comment-count" aria-label={`${record.comments.length}件のコメント`}>{record.comments.length}</span>}</span><span className="note-row-body">{record.body_markdown || record.description || record.url || "本文なし"}</span></button>{(record.source_url || record.url) && <a className="secondary-button compact note-row-open" href={record.source_url || record.url} target="_blank" rel="noreferrer">開く</a>}</div>)}{!visible.length && <EmptyState title="一致するメモはありません" action="メモを書く" onAction={() => openDrawer({ type: "note", mode: "edit", entity: {} })} />}</section></div>;
}

function WaitingPage({ themes, items, openDrawer, setToast }) {
  const waiting = items.filter((item) => item.kind === "waiting" || item.status === "waiting").sort(compareDate);
  function copy() {
    workspaceApi.copyText(waiting.map((item) => `${item.title}\t${item.waiting_for || "—"}\t${item.due_date || "—"}\t${themes.find((theme) => theme.id === item.theme_id)?.name || "—"}`).join("\n")).then(() => setToast("Waiting一覧をコピーしました。"));
  }
  return <div className="page"><PageHeader title="Waiting" subtitle="誰を、何を、いつまで待っているかを確認します。"><button className="secondary-button" onClick={copy}>一覧をコピー</button><button className="primary-button" onClick={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "waiting", status: "waiting" } })}>待ちを追加</button></PageHeader><section className="panel list-page">{waiting.map((item) => <button className="waiting-row" key={item.id} onClick={() => openDrawer({ type: "item", entity: item })}><div><StatusBadge value="waiting" label="待ち" /><strong>{item.title}</strong><span>{themes.find((theme) => theme.id === item.theme_id)?.name || "—"}</span></div><div><time>{formatDate(item.due_date)}</time><small>{item.waiting_for || "待ち相手未設定"}</small></div></button>)}{!waiting.length && <EmptyState title="待ちはありません" action="追加する" onAction={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "waiting", status: "waiting" } })} />}</section></div>;
}

function ImportExportPage({ data, themes, items, activeTheme, saveEntity, setToast }) {
  const [format, setFormat] = useState("markdown");
  const [scope, setScope] = useState("all");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null);
  const exportData = useMemo(() => buildExportData({ data, themes, items, activeTheme, scope }), [data, themes, items, activeTheme, scope]);
  const exported = format === "json"
    ? JSON.stringify({ version: 2, exported_at: new Date().toISOString(), ...exportData }, null, 2)
    : format === "yaml"
      ? toYaml(exportData)
      : exportMarkdown(exportData);

  function parseImport() {
    try {
      const raw = text.trim().startsWith("{") || text.trim().startsWith("[") ? JSON.parse(text) : parseSimpleYaml(text);
      const parsed = Array.isArray(raw) ? { items: raw } : raw;
      const candidates = [
        ...(parsed.items || []).map((entry) => ({ type: "item", entry })),
        ...(parsed.tasks || []).map((entry) => ({ type: "item", entry })),
        ...(parsed.notes || []).map((entry) => ({ type: "note", entry })),
        ...(parsed.links || []).map((entry) => ({ type: "link", entry })),
      ].map(({ type, entry }) => {
        const theme = themes.find((candidate) => candidate.id === entry.theme_id || candidate.name === entry.theme);
        const collection = type === "item" ? items : type === "note" ? data.notes || [] : data.links || [];
        const duplicate = collection.find((candidate) => candidate.title?.trim().toLowerCase() === String(entry.title || "").trim().toLowerCase());
        return { type, entry, theme, duplicate, action: duplicate ? "merge" : "create" };
      });
      if (!candidates.length) throw new Error("items、notes、linksのいずれかを含めてください。");
      setPreview({ parsed, candidates });
    } catch (error) {
      setToast(`内容を解析できませんでした。${error.message}`);
    }
  }

  async function executeImport() {
    const source = {
      id: uuid(),
      source_type: text.trim().startsWith("{") ? "imported_json" : "imported_yaml",
      source_title: `AI Import ${new Date().toLocaleString("ja-JP")}`,
      captured_at: new Date().toISOString(),
      raw_text: text,
      summary: `${preview.candidates.length}件の候補`,
    };
    const operations = [{
      action: "save",
      type: "source_record",
      entity: source,
      options: { source: "imported" },
    }];
    let count = 0;
    for (const candidate of preview.candidates) {
      if (candidate.action === "ignore") continue;
      const base = candidate.action === "merge" ? candidate.duplicate : {};
      const entry = candidate.entry;
      if (candidate.type === "item") {
        operations.push({
          action: "save",
          type: "item",
          entity: {
            ...base,
            id: base.id || uuid(),
            title: entry.title || "無題",
            kind: entry.kind || base.kind || "task",
            level: entry.level || base.level || defaultLevel(entry.kind || base.kind || "task"),
            theme_id: candidate.theme?.id || base.theme_id || null,
            status: entry.status || base.status || "todo",
            priority: entry.priority || base.priority || "normal",
            planned_start: entry.planned_start || base.planned_start || null,
            planned_end: entry.planned_end || base.planned_end || entry.due_date || null,
            due_date: entry.due_date || entry.due || base.due_date || null,
            schedule_status: entry.schedule_status || (entry.due_date || entry.planned_end ? "scheduled" : "unscheduled"),
            schedule_confidence: entry.schedule_confidence || "tentative",
            date_granularity: entry.date_granularity || "day",
            progress: Number(entry.progress || base.progress || 0),
            description: entry.description || base.description || "",
            source_record_id: source.id,
          },
          options: { source: "imported" },
        });
      } else if (candidate.type === "note") {
        operations.push({
          action: "save",
          type: "note",
          entity: {
            ...base,
            id: base.id || uuid(),
            title: entry.title || "無題",
            body_markdown: entry.body_markdown || entry.body || "",
            note_type: entry.note_type || base.note_type || "memo",
            theme_id: candidate.theme?.id || base.theme_id || null,
            item_id: entry.item_id || base.item_id || null,
            source_url: entry.source_url || base.source_url || "",
            source_record_id: source.id,
          },
          options: { source: "imported" },
        });
      } else {
        operations.push({
          action: "save",
          type: "link",
          entity: {
            ...base,
            id: base.id || uuid(),
            title: entry.title || "無題",
            url: entry.url || base.url || "",
            link_type: entry.link_type || base.link_type || "other",
            theme_id: candidate.theme?.id || base.theme_id || null,
            item_id: entry.item_id || base.item_id || null,
            description: entry.description || base.description || "",
            source_record_id: source.id,
          },
          options: { source: "imported" },
        });
      }
      count += 1;
    }
    operations.push({
      action: "save",
      type: "import_batch",
      entity: {
        id: uuid(),
        source: source.source_type,
        status: "completed",
        count,
        raw_text: text,
        source_record_id: source.id,
      },
      options: { source: "imported" },
    });
    await saveEntities(operations, `${count}件を取り込みました。`);
    setPreview(null);
    setText("");
  }

  return <div className="page"><PageHeader title="AI Import / Export" subtitle="構造化データをプレビューしてから安全に取り込みます。" /><div className="io-grid"><section className="panel io-panel"><div className="section-heading"><h2>書き出す</h2><div className="inline-actions"><select aria-label="書き出す範囲" value={scope} onChange={(event) => setScope(event.target.value)}><option value="all">全体</option><option value="theme">選択中Theme</option><option value="week">今後7日</option><option value="month">今後30日</option><option value="quarter">今後90日</option><option value="open">未完了Item</option><option value="waiting">Waitingのみ</option><option value="recent_notes">直近メモ</option><option value="milestones">マイルストーン</option></select><select aria-label="書き出し形式" value={format} onChange={(event) => setFormat(event.target.value)}><option value="markdown">Markdown</option><option value="yaml">YAML</option><option value="json">JSON</option></select></div></div><textarea readOnly value={exported} /><button className="primary-button" onClick={() => workspaceApi.copyText(exported).then(() => setToast("エクスポート内容をコピーしました。"))}>コピーする</button></section><section className="panel io-panel"><div className="section-heading"><h2>読み込む</h2><span>Item / Note / Link</span></div><textarea value={text} onChange={(event) => { setText(event.target.value); setPreview(null); }} placeholder={'items:\n  - title: "測定結果を確認"\n    theme: "材料A評価"\nnotes:\n  - title: "解析方針"\n    body: "条件Bを再確認する"'} /><button className="secondary-button" onClick={parseImport}>候補を確認</button></section></div>{preview && <section className="panel import-preview"><div className="section-heading"><h2>取り込み候補</h2><span>{preview.candidates.length}件</span></div>{preview.candidates.map((candidate, index) => <div className="import-candidate" key={`${candidate.type}-${candidate.entry.title}-${index}`}><div><strong>{candidate.entry.title || "無題"}</strong><small>{candidate.type} / {candidate.theme?.name || "Theme未解決"}{candidate.duplicate ? ` / 既存候補: ${candidate.duplicate.title}` : ""}</small></div><select value={candidate.action} onChange={(event) => setPreview((current) => ({ ...current, candidates: current.candidates.map((entry, itemIndex) => itemIndex === index ? { ...entry, action: event.target.value } : entry) }))}><option value="create">新規作成</option>{candidate.duplicate && <option value="merge">既存を更新</option>}<option value="ignore">無視</option></select></div>)}<div className="form-actions"><button className="secondary-button" onClick={() => setPreview(null)}>戻る</button><button className="primary-button" onClick={executeImport}>取り込む</button></div></section>}</div>;
}

function SettingsPage({ data, themeMode, setThemeMode, openDrawer, setSnapshotPreview, snapshotPreview, setToast }) {
  const [busy, setBusy] = useState(false);
  async function exportSnapshot() {
    setBusy(true);
    try {
      const result = await workspaceApi.exportSnapshot();
      if (!result.canceled) setToast("Workspace Snapshotを書き出しました。");
    } catch (error) {
      setToast(`Snapshotを書き出せませんでした。${error.message}`);
    } finally {
      setBusy(false);
    }
  }
  async function inspectSnapshot() {
    setBusy(true);
    try {
      const result = await workspaceApi.inspectSnapshot();
      if (!result.canceled) setSnapshotPreview({ ...result, decisions: Object.fromEntries(result.changes.map((change) => [change.key, change.action])) });
    } catch (error) {
      setToast(`Snapshotを読み込めませんでした。${error.message}`);
    } finally {
      setBusy(false);
    }
  }
  async function applySnapshot() {
    setBusy(true);
    try {
      await workspaceApi.applySnapshot(snapshotPreview.token, snapshotPreview.decisions);
      await workspaceApi.reload();
    } catch (error) {
      setToast(`Snapshotを反映できませんでした。${error.message}`);
      setBusy(false);
    }
  }
  return <div className="page"><PageHeader title="Settings" /><div className="settings-grid"><section className="panel settings-form"><h2>表示</h2><label>カラーモード<select value={themeMode} onChange={(event) => setThemeMode(event.target.value)}><option value="light">ライト</option><option value="dark">ダーク</option></select></label><h2>関係者</h2><div className="settings-list">{(data.people || []).map((person) => <button className="wide-row" key={person.id} onClick={() => openDrawer({ type: "person", mode: "edit", entity: person })}><strong>{person.name}</strong><span>{person.organization || person.role ? `${person.organization || "所属未設定"} / ${person.role || "役割未設定"}` : "詳細未設定"}</span></button>)}</div><button className="secondary-button" onClick={() => openDrawer({ type: "person", mode: "edit", entity: {} })}>関係者を追加</button></section><section className="panel settings-form"><h2>バックアップ</h2><p className="field-help">端末間の移行や復元にはZIP形式のSnapshotを使います。</p><button className="secondary-button" disabled={busy} onClick={exportSnapshot}>バックアップを書き出す</button><button className="secondary-button" disabled={busy} onClick={inspectSnapshot}>バックアップを読み込む</button></section></div>{snapshotPreview && <section className="panel snapshot-preview"><div className="section-heading"><h2>Snapshot差分</h2><span>{snapshotPreview.changes.length}件</span></div>{snapshotPreview.changes.map((change) => <div className="import-candidate" key={change.key}><div><strong>{entityTitle(change.type, change.incoming)}</strong><small>{change.type} / {change.category}</small></div><select value={snapshotPreview.decisions[change.key]} onChange={(event) => setSnapshotPreview((current) => ({ ...current, decisions: { ...current.decisions, [change.key]: event.target.value } }))}><option value="ignore">無視</option><option value="create">新規作成</option><option value="update">既存を更新</option><option value="duplicate">両方残す</option></select></div>)}<div className="form-actions"><button className="secondary-button" onClick={() => setSnapshotPreview(null)}>取り消す</button><button className="primary-button" disabled={busy} onClick={applySnapshot}>選択内容を反映</button></div></section>}</div>;
}

function EntityDrawer({ drawer, data, close, saveForm, removeEntity, toggleItem, saveEntity }) {
  const entity = drawer.entity || {};
  if (drawer.mode === "edit") return <EditDrawer {...{ drawer, entity, data, close, saveForm }} />;
  const type = drawer.type;
  if (type === "item") {
    const revisions = (data.plan_revisions || []).filter((revision) => revision.item_id === entity.id);
    const source = (data.source_records || []).find((record) => record.id === entity.source_record_id);
    const relations = (data.relations || []).filter((relation) => relation.source_entity_id === entity.id || relation.target_entity_id === entity.id);
    const dependencies = (data.dependencys || []).filter((dependency) => dependency.source_item_id === entity.id || dependency.target_item_id === entity.id);
    return <aside className="drawer"><DrawerHeader title="Item詳細" close={close} /><div className="drawer-content"><div className="badge-row"><StatusBadge value={entity.status} label={STATUS_LABELS[entity.status]} /><StatusBadge value={entity.schedule_status} label={SCHEDULE_LABELS[entity.schedule_status]} /></div><h2>{entity.title}</h2><p>{entity.description || "説明なし"}</p><dl><dt>種類</dt><dd>{KIND_LABELS[entity.kind]}</dd><dt>予定</dt><dd>{entity.date_text || `${formatDate(entity.planned_start)} - ${formatDate(entity.planned_end)}`}</dd><dt>期限</dt><dd>{formatDate(entity.due_date)}</dd><dt>進捗</dt><dd>{entity.progress || 0}%</dd><dt>情報源</dt><dd>{source?.source_title || "手動入力"}</dd></dl>{(relations.length > 0 || dependencies.length > 0) && <div className="revision-list"><h3>関係</h3>{dependencies.map((dependency) => <div key={dependency.id}><span>依存: {(data.items || []).find((item) => item.id === dependency.source_item_id)?.title} → {(data.items || []).find((item) => item.id === dependency.target_item_id)?.title}</span></div>)}{relations.map((relation) => <div key={relation.id}><span>{relation.relation_type}: {relatedEntityTitle(data, relation.target_entity_type, relation.target_entity_id)}</span></div>)}</div>}{revisions.length > 0 && <div className="revision-list"><h3>予定変更履歴</h3>{revisions.slice(0, 8).map((revision) => <div key={revision.id}><time>{new Date(revision.changed_at).toLocaleString("ja-JP")}</time><span>{revision.reason || "理由未記入"}</span></div>)}</div>}<div className="drawer-actions"><button className="secondary-button" onClick={() => close({ type: "item", mode: "edit", entity })}>編集する</button><button className="secondary-button" onClick={() => close({ type: "dependency", mode: "edit", entity: { source_item_id: entity.id } })}>依存を追加</button><button className="secondary-button" onClick={() => close({ type: "relation", mode: "edit", entity: { source_entity_type: "item", source_entity_id: entity.id } })}>関係を追加</button><button className="primary-button" onClick={() => { toggleItem(entity); close(); }}>{entity.status === "done" ? "未完了に戻す" : "完了にする"}</button><button className="danger-button" onClick={() => removeEntity("item", entity)}>削除する</button></div></div></aside>;
  }
  if (type === "note") return <NoteDetailDrawer note={entity} close={close} removeEntity={removeEntity} saveEntity={saveEntity} />;
  if (type === "link") return <DetailDrawer title="リンク詳細" entity={entity} close={close} onEdit={() => close({ type: "link", mode: "edit", entity })} onDelete={() => removeEntity("link", entity)}><StatusBadge value="neutral" label={entity.link_type} /><h2>{entity.title}</h2><a href={entity.url} target="_blank" rel="noreferrer">{entity.url}</a><p>{entity.description}</p></DetailDrawer>;
  return <EditDrawer {...{ drawer: { ...drawer, mode: "edit" }, entity, data, close, saveForm, saveEntity }} />;
}

function EditDrawer({ drawer, entity, data, close, saveForm }) {
  const type = drawer.type;
  const title = `${entity.id ? "編集" : "追加"}: ${type}`;
  return <aside className="drawer"><DrawerHeader title={title} close={close} /><form className="drawer-form" data-entity-type={type} onSubmit={saveForm}>
    {type === "item" && <ItemFields entity={entity} data={data} />}
    {type === "theme" && <><Field label="テーマ名"><input name="name" autoFocus defaultValue={entity.name || ""} /></Field><Field label="概要"><textarea name="description" defaultValue={entity.description || ""} /></Field><Field label="状態"><select name="status" defaultValue={entity.status || "計画中"}><option>計画中</option><option>進行中</option><option>継続</option><option>保留</option><option>完了</option></select></Field></>}
    {type === "note" && <><Field label="タイトル"><input name="title" autoFocus defaultValue={entity.title || ""} /></Field><ThemeSelect themes={data.themes} value={entity.theme_id} /><ItemSelect items={data.items} value={entity.item_id} /><Field label="種別"><select name="note_type" defaultValue={entity.note_type || "memo"}>{["memo", "decision", "meeting", "experiment", "analysis", "ai_chat", "learning", "reflection"].map((value) => <option key={value}>{value}</option>)}</select></Field><Field label="情報源URL"><input name="source_url" type="url" defaultValue={entity.source_url || ""} /></Field><Field label="本文（Markdown）"><textarea className="large-textarea" name="body_markdown" defaultValue={entity.body_markdown || ""} /></Field></>}
    {type === "link" && <><Field label="タイトル"><input name="title" autoFocus defaultValue={entity.title || ""} /></Field><Field label="URL"><input name="url" type="url" defaultValue={entity.url || ""} /></Field><Field label="種別"><select name="link_type" defaultValue={entity.link_type || "other"}>{["sharepoint", "onedrive", "teams", "outlook", "chatgpt", "copilot", "github", "local_file", "notebook", "paper", "folder", "other"].map((value) => <option key={value}>{value}</option>)}</select></Field><ThemeSelect themes={data.themes} value={entity.theme_id} /><ItemSelect items={data.items} value={entity.item_id} /><Field label="説明"><textarea name="description" defaultValue={entity.description || ""} /></Field></>}
    {type === "person" && <><Field label="名前"><input name="name" autoFocus defaultValue={entity.name || ""} /></Field><Field label="役割"><input name="role" defaultValue={entity.role || ""} /></Field><Field label="所属"><input name="organization" defaultValue={entity.organization || ""} /></Field><Field label="メモ"><textarea name="note" defaultValue={entity.note || ""} /></Field></>}
    {type === "status_update" && <><ThemeSelect themes={data.themes} value={entity.theme_id} /><Field label="日付"><input name="date" type="date" defaultValue={entity.date || todayIso()} /></Field><Field label="状態"><select name="status" defaultValue={entity.status || "on_track"}>{["on_track", "at_risk", "delayed", "paused", "completed"].map((value) => <option key={value}>{value}</option>)}</select></Field><Field label="概要"><textarea name="summary" autoFocus defaultValue={entity.summary || ""} /></Field><Field label="進捗"><input name="progress" type="number" min="0" max="100" defaultValue={entity.progress || 0} /></Field><Field label="リスク"><textarea name="risks" defaultValue={entity.risks || ""} /></Field><Field label="次アクション"><textarea name="next_actions" defaultValue={entity.next_actions || ""} /></Field></>}
    {type === "source_record" && <><Field label="種類"><select name="source_type" defaultValue={entity.source_type || "manual"}>{["manual", "chatgpt", "copilot", "outlook", "teams", "email", "calendar", "meeting", "document", "sharepoint", "onedrive", "imported_yaml", "imported_json", "snapshot", "other"].map((value) => <option key={value}>{value}</option>)}</select></Field><Field label="タイトル"><input name="source_title" autoFocus defaultValue={entity.source_title || ""} /></Field><Field label="URL"><input name="source_url" type="url" defaultValue={entity.source_url || ""} /></Field><Field label="要約"><textarea name="summary" defaultValue={entity.summary || ""} /></Field><Field label="原文"><textarea className="large-textarea" name="raw_text" defaultValue={entity.raw_text || ""} /></Field></>}
    {type === "field_definition" && <><Field label="項目名"><input name="name" autoFocus defaultValue={entity.name || ""} /></Field><Field label="型"><select name="field_type" defaultValue={entity.field_type || "text"}>{["text", "long_text", "number", "date", "select", "multi_select", "checkbox", "url", "person", "relation"].map((value) => <option key={value}>{value}</option>)}</select></Field><Field label="対象"><select name="applies_to" defaultValue={entity.applies_to || "item"}>{["theme", "item", "note", "link"].map((value) => <option key={value}>{value}</option>)}</select></Field><ThemeSelect themes={data.themes} value={entity.theme_id} allowAll /><Field label="選択肢（カンマ区切り）"><input name="options" defaultValue={(entity.options_json || []).join(", ")} /></Field><label className="toggle"><input name="is_required" type="checkbox" defaultChecked={entity.is_required} />必須</label></>}
    {type === "dependency" && <><Field label="先行Item"><select name="source_item_id" defaultValue={entity.source_item_id || ""}><option value="">選択</option>{(data.items || []).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field><Field label="後続Item"><select name="target_item_id" defaultValue={entity.target_item_id || ""}><option value="">選択</option>{(data.items || []).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field><p className="field-help">初期実装ではfinish-to-startのみ扱います。</p></>}
    {type === "relation" && <RelationFields entity={entity} data={data} />}
    <button className="primary-button" type="submit">保存する</button>
  </form></aside>;
}

function ItemFields({ entity, data }) {
  const customDefinitions = (data.field_definitions || []).filter((field) => field.applies_to === "item" && (!field.theme_id || field.theme_id === entity.theme_id));
  return <><Field label="タイトル"><input name="title" autoFocus defaultValue={entity.title || ""} /></Field><ThemeSelect themes={data.themes} value={entity.theme_id} allowPersonal /><div className="form-grid"><Field label="種類"><select name="kind" defaultValue={entity.kind || "task"}>{Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="レベル"><select name="level" defaultValue={itemLevel(entity)}>{Object.entries(LEVEL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div><Field label="状態"><select name="status" defaultValue={entity.status || "todo"}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><ItemSelect label="親Item" items={(data.items || []).filter((item) => item.id !== entity.id)} value={entity.parent_item_id} /><Field label="日程状態"><select name="schedule_status" defaultValue={entity.schedule_status || "unscheduled"}>{Object.entries(SCHEDULE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><div className="form-grid"><Field label="予定開始"><input name="planned_start" type="date" defaultValue={dateOnly(entity.planned_start)} /></Field><Field label="予定終了"><input name="planned_end" type="date" defaultValue={dateOnly(entity.planned_end)} /></Field></div><Field label="期限"><input name="due_date" type="date" defaultValue={dateOnly(entity.due_date)} /></Field><div className="form-grid"><Field label="実績開始"><input name="actual_start" type="date" defaultValue={dateOnly(entity.actual_start)} /></Field><Field label="実績終了"><input name="actual_end" type="date" defaultValue={dateOnly(entity.actual_end)} /></Field></div><Field label="粗い日程表現"><input name="date_text" placeholder="7月上旬、下期中など" defaultValue={entity.date_text || ""} /></Field><div className="form-grid"><Field label="粒度"><select name="date_granularity" defaultValue={entity.date_granularity || "day"}>{["day", "week", "month", "quarter", "half_year", "fiscal_year", "unknown"].map((value) => <option key={value}>{value}</option>)}</select></Field><Field label="確度"><select name="schedule_confidence" defaultValue={entity.schedule_confidence || "rough"}>{["rough", "tentative", "fixed"].map((value) => <option key={value}>{value}</option>)}</select></Field></div><Field label="優先度"><select name="priority" defaultValue={entity.priority || "normal"}>{["low", "normal", "high", "decision"].map((value) => <option key={value}>{value}</option>)}</select></Field><Field label="進捗"><input name="progress" type="number" min="0" max="100" defaultValue={entity.progress || 0} /></Field><Field label="担当"><select name="owner_person_id" defaultValue={entity.owner_person_id || ""}><option value="">未設定</option>{(data.people || []).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field><Field label="待ち相手・対象"><input name="waiting_for" defaultValue={entity.waiting_for || ""} /></Field><Field label="解除後の次アクション"><textarea name="next_action" defaultValue={entity.next_action || ""} /></Field><label className="toggle"><input name="is_personal_task" type="checkbox" defaultChecked={entity.is_personal_task} />個人業務タスク</label><Field label="説明"><textarea name="description" defaultValue={entity.description || ""} /></Field>{customDefinitions.map((definition) => { const value = (data.field_values || []).find((entry) => entry.field_definition_id === definition.id && entry.entity_id === entity.id); return <Field key={definition.id} label={definition.name}><input name={`custom:${definition.id}`} type={definition.field_type === "date" ? "date" : definition.field_type === "number" ? "number" : definition.field_type === "url" ? "url" : "text"} required={definition.is_required} defaultValue={value?.value_text || ""} /></Field>; })}{entity.id && <Field label="予定変更理由（任意）"><textarea name="revision_reason" placeholder="測定結果の受領が遅れたため" /></Field>}<Field label="情報源"><select name="source_record_id" defaultValue={entity.source_record_id || ""}><option value="">手動入力</option>{(data.source_records || []).map((source) => <option key={source.id} value={source.id}>{source.source_title}</option>)}</select></Field></>;
}

function RelationFields({ entity, data }) {
  const [targetType, setTargetType] = useState(entity.target_entity_type || "item");
  const collections = {
    item: data.items || [],
    note: data.notes || [],
    link: data.links || [],
    source_record: data.source_records || [],
  };
  const targets = collections[targetType] || [];
  return <><input type="hidden" name="source_entity_type" value={entity.source_entity_type || "item"} /><input type="hidden" name="source_entity_id" value={entity.source_entity_id || ""} /><Field label="関係種別"><select name="relation_type" defaultValue={entity.relation_type || "relates_to"}>{["blocks", "blocked_by", "relates_to", "duplicated_by", "follows", "references", "created_from", "evidence_for", "caused_by", "supports"].map((value) => <option key={value}>{value}</option>)}</select></Field><Field label="関係先の種類"><select name="target_entity_type" value={targetType} onChange={(event) => setTargetType(event.target.value)}><option value="item">Item</option><option value="note">Note</option><option value="link">Link</option><option value="source_record">情報源</option></select></Field><Field label="関係先"><select name="target_entity_id" defaultValue={entity.target_entity_id || ""} key={targetType}><option value="">選択</option>{targets.map((target) => <option key={target.id} value={target.id}>{target.title || target.source_title || target.name}</option>)}</select></Field>{!targets.length && <p className="field-help">選択できる{targetType}がありません。先に対象を追加してください。</p>}<Field label="説明"><textarea name="description" defaultValue={entity.description || ""} /></Field></>;
}

function DetailDrawer({ title, entity, close, onEdit, onDelete, children }) {
  return <aside className="drawer"><DrawerHeader title={title} close={close} /><div className="drawer-content">{children}<div className="drawer-actions"><button className="primary-button" onClick={onEdit}>編集する</button><button className="danger-button" onClick={onDelete}>削除する</button></div></div></aside>;
}

function NoteDetailDrawer({ note, close, removeEntity, saveEntity }) {
  const [comment, setComment] = useState("");
  const comments = note.comments || [];

  async function addComment(event) {
    event.preventDefault();
    const body = comment.trim();
    if (!body) return;
    const saved = await saveEntity("note", {
      ...note,
      comments: [...comments, { id: uuid(), body, created_at: new Date().toISOString() }],
    });
    setComment("");
    close({ type: "note", entity: saved });
  }

  async function removeComment(commentId) {
    const saved = await saveEntity("note", {
      ...note,
      comments: comments.filter((entry) => entry.id !== commentId),
    });
    close({ type: "note", entity: saved });
  }

  return <aside className="drawer"><DrawerHeader title="メモ詳細" close={close} /><div className="drawer-content"><StatusBadge value="neutral" label={note.note_type} /><h2>{note.title}</h2>{note.source_url && <div className="link-value"><a href={note.source_url} target="_blank" rel="noreferrer">{note.source_url}</a></div>}<p className="note-body">{note.body_markdown}</p><section className="comment-thread"><h3>コメント {comments.length > 0 && `(${comments.length})`}</h3>{comments.length > 0 && <div className="comment-list">{comments.map((entry) => <div className="comment-item" key={entry.id}><div className="comment-body">{entry.body}</div><div className="comment-meta"><time>{new Date(entry.created_at).toLocaleString("ja-JP")}</time><button className="text-button compact" onClick={() => removeComment(entry.id)}>削除する</button></div></div>)}</div>}<form className="comment-input" onSubmit={addComment}><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="補足や確認事項を残す" aria-label="コメント" /><button className="secondary-button compact" type="submit">コメントする</button></form></section><div className="drawer-actions"><button className="primary-button" onClick={() => close({ type: "note", mode: "edit", entity: note })}>編集する</button><button className="danger-button" onClick={() => removeEntity("note", note)}>削除する</button></div></div></aside>;
}
function DrawerHeader({ title, close }) { return <div className="drawer-header"><strong>{title}</strong><button onClick={() => close()}>閉じる</button></div>; }
function Field({ label, children }) { return <label>{label}{children}</label>; }
function ThemeSelect({ themes = [], value, allowPersonal = false, allowAll = false }) { return <Field label="Theme"><select name="theme_id" defaultValue={value || ""}><option value="">{allowAll ? "全体共通" : allowPersonal ? "個人業務 / Themeなし" : "未設定"}</option>{themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</select></Field>; }
function ItemSelect({ items = [], value, label = "関連Item" }) { return <Field label={label}><select name={label === "親Item" ? "parent_item_id" : "item_id"} defaultValue={value || ""}><option value="">未設定</option>{items.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>; }
function StatusBadge({ value, label }) { return <span className={`status-badge ${statusTone(value)}`}>{label || value || "未設定"}</span>; }
function Metric({ label, value, tone = "" }) { return <div className={`metric-card panel ${tone}`}><span>{label}</span><strong className="metric-value">{value}</strong></div>; }
function SimpleRows({ records = [], onOpen, meta }) { return records.map((record) => <button className="wide-row" key={record.id} onClick={() => onOpen(record)}><strong>{record.title || record.name || record.summary}</strong><span>{meta(record)}</span></button>); }
function EmptyState({ title, action, onAction }) { return <div className="empty-state"><strong>{title}</strong><button className="secondary-button compact" onClick={onAction}>{action}</button></div>; }
function ShortcutDialog({ close }) { return <div className="shortcut-overlay" onClick={close}><div className="shortcut-dialog" role="dialog" aria-label="キーボードショートカット" onClick={(event) => event.stopPropagation()}><DrawerHeader title="キーボードショートカット" close={close} /><dl className="shortcut-list"><dt><kbd>?</kbd></dt><dd>この一覧を表示</dd><dt><kbd>Alt</kbd>+<kbd>N</kbd></dt><dd>Itemを追加</dd><dt><kbd>Ctrl</kbd>+<kbd>K</kbd></dt><dd>検索へ移動</dd><dt><kbd>Esc</kbd></dt><dd>パネルを閉じる</dd></dl></div></div>; }

function compareDate(a, b) {
  return String(a.due_date || a.planned_end || "9999-12-31").localeCompare(String(b.due_date || b.planned_end || "9999-12-31"));
}

function parseTaskTable(text, themes) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const delimiter = lines.some((line) => line.includes("\t")) ? "\t" : ",";
  const rows = lines.map((line) => line.split(delimiter).map((value) => value.trim()));
  const normalized = (value) => String(value || "").toLowerCase().replace(/\s/g, "");
  const knownHeaders = ["title", "タイトル", "タスク", "theme", "テーマ", "期限", "due", "状態", "status", "説明", "description"];
  const hasHeader = rows[0].some((value) => knownHeaders.includes(normalized(value)));
  const headers = hasHeader ? rows.shift().map(normalized) : ["タイトル", "theme", "期限", "状態", "説明"];
  const fieldIndex = (aliases) => headers.findIndex((header) => aliases.includes(header));
  const titleIndex = fieldIndex(["title", "タイトル", "タスク"]);
  const themeIndex = fieldIndex(["theme", "テーマ"]);
  const dueIndex = fieldIndex(["due", "due_date", "期限"]);
  const statusIndex = fieldIndex(["status", "状態"]);
  const descriptionIndex = fieldIndex(["description", "説明"]);
  const statusMap = Object.fromEntries(Object.entries(STATUS_LABELS).flatMap(([key, label]) => [[key, key], [label, key]]));
  return rows.flatMap((row) => {
    const title = row[titleIndex >= 0 ? titleIndex : 0]?.trim();
    if (!title) return [];
    const themeName = row[themeIndex] || "";
    const theme = themes.find((entry) => entry.id === themeName || entry.name === themeName);
    const due = row[dueIndex] || "";
    return [{
      title,
      theme_id: theme?.id || null,
      due_date: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
      status: statusMap[row[statusIndex]] || "todo",
      description: row[descriptionIndex] || "",
    }];
  });
}
function ganttRange(scale, today) {
  const date = new Date(`${today}T00:00:00`);
  if (scale === "year") return { start: `${date.getFullYear()}-01-01`, end: `${date.getFullYear()}-12-31` };
  const spans = { half: 183, quarter: 92, month: 31, week: 14 };
  const span = spans[scale] || 92;
  return { start: addDays(today, -Math.round(span * 0.25)), end: addDays(today, Math.round(span * 0.75)) };
}
function ganttWidth(scale) { return { year: 1100, half: 1300, quarter: 1500, month: 1900, week: 2200 }[scale] || 1500; }
// テーマ別レーンで行を組み立てる。各テーマの先頭にヘッダ行を置き、
// 既定では計画レベル（plan）のItemだけ、showTasks時は実行レベル（task）も親の下にネストする。
function buildTimelineRows({ items, themes, showTasks, collapsedThemes, collapsedItems }) {
  const themeIds = new Set(themes.map((theme) => theme.id));
  const byTheme = new Map();
  for (const item of items) {
    const key = item.theme_id && themeIds.has(item.theme_id) ? item.theme_id : null;
    byTheme.set(key, [...(byTheme.get(key) || []), item]);
  }
  const rows = [];
  const order = [...themes.map((theme) => theme.id), null];
  for (const themeId of order) {
    const pool = byTheme.get(themeId) || [];
    if (!pool.length) continue;
    const groupKey = themeId || "__none";
    const planCount = pool.filter((item) => itemLevel(item) === "plan").length;
    rows.push({
      rowType: "theme",
      groupKey,
      theme: themes.find((theme) => theme.id === themeId) || null,
      planCount,
      taskCount: pool.length - planCount,
    });
    if (collapsedThemes.includes(groupKey)) continue;
    const visiblePool = showTasks ? pool : pool.filter((item) => itemLevel(item) === "plan");
    const visibleIds = new Set(visiblePool.map((item) => item.id));
    const children = new Map();
    for (const item of visiblePool) {
      const parent = item.parent_item_id && visibleIds.has(item.parent_item_id) ? item.parent_item_id : "__root";
      children.set(parent, [...(children.get(parent) || []), item]);
    }
    children.forEach((records) => records.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));
    const visit = (parent, depth) => {
      for (const item of children.get(parent) || []) {
        const hasChildren = (children.get(item.id) || []).length > 0;
        rows.push({ rowType: "item", item, depth, hasChildren });
        if (hasChildren && !collapsedItems.includes(item.id)) visit(item.id, depth + 1);
      }
    };
    visit("__root", 0);
  }
  return rows;
}
function buildExportData({ data, themes, items, activeTheme, scope }) {
  const today = todayIso();
  const horizon = scope === "week" ? 7 : scope === "month" ? 30 : scope === "quarter" ? 90 : null;
  const inHorizon = (item) => {
    const date = item.due_date || item.planned_end || item.planned_start;
    return date && date >= today && date <= addDays(today, horizon);
  };
  let scopedItems = items;
  let scopedNotes = data.notes || [];
  let scopedLinks = data.links || [];
  let scopedThemes = themes;
  if (scope === "theme" && activeTheme) {
    scopedThemes = [activeTheme];
    scopedItems = items.filter((item) => item.theme_id === activeTheme.id);
    scopedNotes = scopedNotes.filter((note) => note.theme_id === activeTheme.id);
    scopedLinks = scopedLinks.filter((link) => link.theme_id === activeTheme.id);
  } else if (horizon) {
    scopedItems = items.filter(inHorizon);
  } else if (scope === "open") {
    scopedItems = items.filter((item) => item.status !== "done" && item.status !== "cancelled");
  } else if (scope === "waiting") {
    scopedItems = items.filter((item) => item.kind === "waiting" || item.status === "waiting");
  } else if (scope === "recent_notes") {
    scopedItems = [];
    scopedNotes = [...scopedNotes].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 20);
  } else if (scope === "milestones") {
    scopedItems = items.filter((item) => item.kind === "milestone");
  }
  const themeIds = new Set([
    ...scopedItems.map((item) => item.theme_id),
    ...scopedNotes.map((note) => note.theme_id),
    ...scopedLinks.map((link) => link.theme_id),
  ].filter(Boolean));
  if (scope !== "all" && scope !== "theme") scopedThemes = themes.filter((theme) => themeIds.has(theme.id));
  return {
    themes: scopedThemes,
    items: scopedItems,
    notes: scopedNotes,
    links: scopedLinks,
    status_updates: (data.status_updates || []).filter((entry) => !themeIds.size || themeIds.has(entry.theme_id)),
    log_entries: (data.log_entries || []).filter((entry) => !themeIds.size || themeIds.has(entry.theme_id)),
    source_records: data.source_records || [],
  };
}

function exportMarkdown(data) {
  const sections = data.themes.flatMap((theme) => {
    const items = data.items.filter((item) => item.theme_id === theme.id);
    const notes = data.notes.filter((note) => note.theme_id === theme.id);
    const updates = data.status_updates.filter((entry) => entry.theme_id === theme.id).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return [`## Theme: ${theme.name}`, theme.description || "", "", "### Current Status", updates[0]?.summary || "- 未記録", "", "### Items", ...(items.length ? items.map((item) => `- [${item.status === "done" ? "x" : " "}] ${item.due_date || item.date_text || "日程未確定"} ${item.title}`) : ["- なし"]), "", "### Notes", ...(notes.length ? notes.map((note) => `- ${note.title}: ${note.body_markdown}`) : ["- なし"]), ""];
  });
  const unscopedItems = data.items.filter((item) => !item.theme_id);
  const unscopedNotes = data.notes.filter((note) => !note.theme_id);
  if (unscopedItems.length || unscopedNotes.length || !sections.length) {
    sections.push("## Themeなし", "", "### Items", ...(unscopedItems.length ? unscopedItems.map((item) => `- [${item.status === "done" ? "x" : " "}] ${item.due_date || item.date_text || "日程未確定"} ${item.title}`) : ["- なし"]), "", "### Notes", ...(unscopedNotes.length ? unscopedNotes.map((note) => `- ${note.title}: ${note.body_markdown}`) : ["- なし"]), "");
  }
  return ["# Current Work Context", "", ...sections].join("\n");
}
