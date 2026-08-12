import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconBolt,
  IconBriefcase,
  IconCheck,
  IconChevronRight,
  IconCommand,
  IconEdit,
  IconExternalLink,
  IconFile,
  IconFolder,
  IconLink,
  IconNotebook,
  IconPlayerPlay,
  IconRefresh,
  IconSearch,
  IconWindow,
  type Icon,
} from "@tabler/icons-react";

import { rankCommandEntries } from "../../../shared/commandPalette.mjs";
import type { CommandEnvelope } from "../../../shared/applicationCommand";
import type { Entity, Workspace } from "../../../shared/types/workspace";
import {
  ROOT_USAGE_PREFERENCE_KEY,
  rootActionsForTarget,
  rootPrimaryAction,
  type RootActionDefinition,
  type RootActionTarget,
  type RootTargetKind,
} from "../../../shared/taskenRoot";
import { workspaceApi } from "../services/workspaceApi";

interface RootEntry extends RootActionTarget {
  usageKey: string;
  label: string;
  keywords: string[];
  category: "Commands" | "Tasks" | "Notes / Documents" | "Themes" | "Resources / Artifacts";
  context: string;
}

interface UsageRecord {
  count: number;
  lastUsedAt: string;
}

const ICONS: Record<string, Icon> = {
  open: IconChevronRight,
  command: IconCommand,
  focus: IconPlayerPlay,
  complete: IconCheck,
  reopen: IconRefresh,
  edit: IconEdit,
  window: IconWindow,
  external: IconExternalLink,
  folder: IconFolder,
  link: IconLink,
};

const COMMANDS: RootEntry[] = [
  { id: "navigate:today", usageKey: "command:navigate:today", kind: "command", label: "Todayへ移動", keywords: ["今日", "home"], category: "Commands", context: "Tasken Command" },
  { id: "navigate:todo", usageKey: "command:navigate:todo", kind: "command", label: "Todoへ移動", keywords: ["task", "タスク"], category: "Commands", context: "Tasken Command" },
  { id: "navigate:inbox", usageKey: "command:navigate:inbox", kind: "command", label: "Inboxへ移動", keywords: ["capture", "記録"], category: "Commands", context: "Tasken Command" },
  { id: "navigate:notes", usageKey: "command:navigate:notes", kind: "command", label: "Notesへ移動", keywords: ["note", "文書"], category: "Commands", context: "Tasken Command" },
  { id: "navigate:themes", usageKey: "command:navigate:themes", kind: "command", label: "Themesへ移動", keywords: ["theme", "テーマ"], category: "Commands", context: "Tasken Command" },
  { id: "navigate:artifacts", usageKey: "command:navigate:artifacts", kind: "command", label: "Artifactsへ移動", keywords: ["artifact", "成果物"], category: "Commands", context: "Tasken Command" },
  { id: "create:capture", usageKey: "command:create:capture", kind: "command", label: "Quick Captureを開く", keywords: ["quick", "記録", "capture"], category: "Commands", context: "Tasken Command · Ctrl+Shift+N" },
];

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function entityEntries(workspace: Workspace): RootEntry[] {
  const themes = new Map((workspace.themes || []).map((theme) => [theme.id, text(theme.name || theme.title)]));
  const live = (entities: Entity[] | undefined) => (entities || []).filter((entity) => !entity.deleted_at);
  return [
    ...live(workspace.tasks).map((task): RootEntry => ({
      id: task.id,
      usageKey: `task:${task.id}`,
      kind: "task",
      entity: task,
      label: text(task.title) || "無題のTask",
      keywords: ["task", "タスク", themes.get(text(task.project_id)) || "", text(task.state)],
      category: "Tasks",
      context: `Task · ${themes.get(text(task.project_id)) || "Theme未設定"} · ${text(task.state) || "状態未設定"}`,
    })),
    ...live(workspace.notes).map((note): RootEntry => ({
      id: note.id,
      usageKey: `note:${note.id}`,
      kind: "note",
      entity: note,
      label: text(note.title) || "無題のNote",
      keywords: ["note", "文書", themes.get(text(note.project_id)) || "", text(note.note_type)],
      category: "Notes / Documents",
      context: `${text(note.note_type) || "Note"} · ${themes.get(text(note.project_id)) || "Theme未設定"}`,
    })),
    ...live(workspace.themes).map((theme): RootEntry => ({
      id: theme.id,
      usageKey: `theme:${theme.id}`,
      kind: "theme",
      entity: theme,
      label: text(theme.name || theme.title) || "無題のTheme",
      keywords: ["theme", "テーマ", text(theme.code), text(theme.description)],
      category: "Themes",
      context: `Theme · ${text(theme.status) || "状態未設定"}`,
    })),
    ...live(workspace.resources).map((resource): RootEntry => ({
      id: resource.id,
      usageKey: `resource:${resource.id}`,
      kind: "resource",
      entity: resource,
      label: text(resource.title) || "無題のResource",
      keywords: ["resource", "資料", text(resource.url), text(resource.description)],
      category: "Resources / Artifacts",
      context: "Resource",
    })),
    ...live(workspace.artifacts).map((artifact): RootEntry => ({
      id: artifact.id,
      usageKey: `artifact:${artifact.id}`,
      kind: "artifact",
      entity: artifact,
      label: text(artifact.title || artifact.file_name) || "Artifact",
      keywords: ["artifact", "成果物", "ファイル", text(artifact.media_kind), text(artifact.file_path)],
      category: "Resources / Artifacts",
      context: `Artifact · ${text(artifact.media_kind || artifact.kind) || "file"}`,
    })),
  ];
}

function entryIcon(kind: RootTargetKind): Icon {
  if (kind === "task") return IconCheck;
  if (kind === "note") return IconNotebook;
  if (kind === "theme") return IconBriefcase;
  if (kind === "artifact" || kind === "resource") return IconFile;
  return IconBolt;
}

function uuid(): string {
  return crypto.randomUUID();
}

export function TaskenRootApp() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [status, setStatus] = useState<{ state: "loading" | "success" | "error"; message?: string }>({ state: "loading" });
  const [busyAction, setBusyAction] = useState("");
  const [usage, setUsage] = useState<Record<string, UsageRecord>>({});
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setStatus({ state: "loading" });
    try {
      const [loaded, storedUsage] = await Promise.all([
        workspaceApi.load(),
        workspaceApi.getPreference(ROOT_USAGE_PREFERENCE_KEY),
      ]);
      setWorkspace(loaded);
      setUsage(storedUsage && typeof storedUsage === "object" ? storedUsage as Record<string, UsageRecord> : {});
      setStatus({ state: "success" });
    } catch (error) {
      setStatus({ state: "error", message: `検索対象を読み込めませんでした。${error instanceof Error ? error.message : String(error)}` });
    }
  }, []);

  useEffect(() => {
    void load();
    const offChange = window.api.app.onWorkspaceChanged(() => { void load(); });
    const offShown = workspaceApi.onTaskenRootShown(() => {
      setQuery("");
      setSelectedIndex(0);
      setPanelOpen(false);
      void load();
      requestAnimationFrame(() => inputRef.current?.focus());
    });
    return () => { offChange(); offShown(); };
  }, [load]);

  const entries = useMemo(() => [...COMMANDS, ...(workspace ? entityEntries(workspace) : [])], [workspace]);
  const matches = useMemo(() => rankCommandEntries(entries, query, usage) as RootEntry[], [entries, query, usage]);
  const selected = matches[selectedIndex] || matches[0];
  const actions = useMemo(() => selected ? rootActionsForTarget(selected) : [], [selected]);

  useEffect(() => {
    setSelectedIndex(0);
    setPanelOpen(false);
  }, [query]);

  async function recordUsage(entry: RootEntry, actionId: string) {
    const key = `${entry.usageKey}:${actionId}`;
    const next = {
      ...usage,
      [entry.usageKey]: { count: (usage[entry.usageKey]?.count || 0) + 1, lastUsedAt: new Date().toISOString() },
      [key]: { count: (usage[key]?.count || 0) + 1, lastUsedAt: new Date().toISOString() },
    };
    setUsage(next);
    await workspaceApi.setPreference(ROOT_USAGE_PREFERENCE_KEY, next);
  }

  async function executeAction(entry: RootEntry, action: RootActionDefinition) {
    const availability = action.availability?.(entry) || { available: true };
    if (!availability.available) return;
    setBusyAction(action.id);
    try {
      if (action.id === "execute" || action.id === "open" || action.id === "edit" || action.id === "focus") {
        await workspaceApi.openTaskenRootTarget({ kind: entry.kind, id: entry.id, action: action.id === "execute" ? "open" : action.id });
      } else if ((action.id === "complete" || action.id === "reopen") && entry.entity) {
        const task = { ...entry.entity, state: action.id === "complete" ? "done" : "todo" };
        const envelope: CommandEnvelope = {
          commandId: uuid(),
          name: action.id === "complete" ? "CompleteTask" : "ReopenTask",
          payload: { taskId: entry.id, task },
          actor: { kind: "user" },
          source: "tasken_root",
          expectedVersions: [{ type: "task", id: entry.id, version: Number(entry.entity.version || 0) }],
          issuedAt: new Date().toISOString(),
        };
        await workspaceApi.executeCommand(envelope);
        await load();
      } else if (action.id === "open-window" && entry.kind === "note") {
        await window.api.app.openNoteWindow(entry.id);
        await workspaceApi.hideTaskenRoot();
      } else if (action.id === "open-external" && entry.kind === "artifact") {
        const result = await window.api.mediaCapture.openArtifactExternal({ artifactId: entry.id });
        if (!result.ok) throw new Error(result.error || "外部で開けませんでした。");
      } else if (action.id === "show-folder") {
        const filePath = text(entry.entity?.file_path || entry.entity?.managed_path);
        if (!filePath) throw new Error("Artifactの保存場所がありません。");
        const result = await window.api.files.showItemInFolder(filePath);
        if (!result.ok) throw new Error(result.error || "フォルダを開けませんでした。");
      } else if (action.id === "copy-link") {
        await workspaceApi.copyText(`tasken://${entry.kind}/${entry.id}`);
      }
      await recordUsage(entry, action.id);
      setPanelOpen(false);
    } catch (error) {
      setStatus({ state: "error", message: `操作できませんでした。${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setBusyAction("");
    }
  }

  function runPrimary() {
    if (!selected) return;
    const primary = rootPrimaryAction(selected);
    if (primary) void executeAction(selected, primary);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (panelOpen) setPanelOpen(false);
      else void workspaceApi.hideTaskenRoot();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (selected) setPanelOpen((current) => !current);
      return;
    }
    if (panelOpen) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((current) => Math.min(matches.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      runPrimary();
    }
  }

  return (
    <main className="tasken-root" onKeyDown={onKeyDown}>
      <header className="tasken-root-search">
        <IconSearch size={20} aria-hidden="true" />
        <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Taskenを検索" aria-label="Taskenを検索" autoFocus />
        <kbd>Esc</kbd>
      </header>
      {status.state === "loading" ? <div className="tasken-root-state">読み込んでいます…</div> : null}
      {status.state === "error" ? <div className="tasken-root-state is-error" role="alert">{status.message}<button type="button" onClick={() => void load()}>再試行</button></div> : null}
      {status.state === "success" && matches.length === 0 ? <div className="tasken-root-state">一致する項目がありません。検索語を変えてください。</div> : null}
      <div className="tasken-root-results" role="listbox" aria-label="検索結果">
        {matches.map((entry, index) => {
          const EntryIcon = entryIcon(entry.kind);
          return (
            <button
              type="button"
              key={`${entry.kind}:${entry.id}`}
              className={index === selectedIndex ? "is-selected" : ""}
              role="option"
              aria-selected={index === selectedIndex}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => { setSelectedIndex(index); const primary = rootPrimaryAction(entry); if (primary) void executeAction(entry, primary); }}
            >
              <span className="tasken-root-entry-icon"><EntryIcon size={19} aria-hidden="true" /></span>
              <span className="tasken-root-entry-copy"><strong>{entry.label}</strong><small>{entry.context}</small></span>
              <span className="tasken-root-entry-action">開く <kbd>↵</kbd></span>
            </button>
          );
        })}
      </div>
      <footer className="tasken-root-footer"><span>{matches.length}件</span><span>Action Panel <kbd>Ctrl K</kbd></span></footer>
      {panelOpen && selected ? (
        <aside className="tasken-root-actions" aria-label={`${selected.label}のAction`}>
          <div className="tasken-root-actions-heading"><div><small>{selected.context}</small><h2>{selected.label}</h2></div><button type="button" aria-label="Action Panelを閉じる" onClick={() => setPanelOpen(false)}>Esc</button></div>
          <div className="tasken-root-action-list">
            {actions.map((action) => {
              const ActionIcon = ICONS[action.icon] || IconCommand;
              const availability = action.availability?.(selected) || { available: true };
              return (
                <button type="button" key={action.id} disabled={!availability.available || Boolean(busyAction)} className={action.role === "danger" ? "is-danger" : ""} onClick={() => void executeAction(selected, action)}>
                  <ActionIcon size={18} aria-hidden="true" />
                  <span><strong>{action.label}</strong>{!availability.available && <small>{availability.reason}</small>}</span>
                  {action.shortcut && <kbd>{action.shortcut}</kbd>}
                </button>
              );
            })}
          </div>
        </aside>
      ) : null}
    </main>
  );
}
