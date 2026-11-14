import { create } from "zustand";

import type {
  Entity,
  EntityType,
  SaveOperation,
  SaveOptions,
  Workspace,
} from "../../../shared/types/workspace";
import type { CommandReceipt } from "../../../shared/applicationCommand";
import { collectionKeyForEntityType } from "../../../shared/entityRegistry.mjs";
import { workspaceApi } from "../services/workspaceApi";

type LoadState = "idle" | "loading" | "success" | "error";

interface WorkspaceState {
  recordWorkLog(
    command: import("../../../shared/workLog").RecordWorkLogCommand,
  ): Promise<import("../../../shared/workLog").WorkLogReceipt>;
  workspace: Workspace | null;
  loadState: LoadState;
  loadError: string;
  load(): Promise<Workspace>;
  loadSample(): Promise<Workspace>;
  save(type: EntityType, entity: Entity, options?: SaveOptions): Promise<Entity>;
  saveMany(operations: SaveOperation[]): Promise<Entity[]>;
  remove(type: EntityType, id: string): Promise<Entity>;
  restore(type: EntityType, id: string): Promise<Entity>;
  refresh(): Promise<Workspace>;
  applyExternalSave(type: EntityType, entity: Entity): void;
  applyExternalSaves(changes: Array<{ type: EntityType; entity: Entity }>): void;
  applyCommandReceipt(receipt: CommandReceipt): void;
  /**
   * 来歴（change_event）が増えた・読み直した回数。Workspaceは来歴を持たない（#755 束0b）ので、
   * 来歴を表示する画面はこの値が変わった時に、開いている範囲を読み直す（useActivityEvents）。
   */
  activityRevision: number;
}

function replaceEntity(workspace: Workspace, type: EntityType, saved: Entity): Workspace {
  // 来歴は画面の Workspace に溜めない。表示する画面が activityRevision を見て範囲で読み直す。
  if (type === "change_event") return workspace;
  const key = collectionKeyForEntityType(type) as keyof Workspace;
  const records = (workspace[key] as Entity[] | undefined) || [];
  const next = records.some((entry) => entry.id === saved.id)
    ? records.map((entry) => (entry.id === saved.id ? saved : entry))
    : [saved, ...records];
  return { ...workspace, [key]: next };
}

function replaceIfNewer(workspace: Workspace, type: EntityType, saved: Entity): Workspace {
  const key = collectionKeyForEntityType(type) as keyof Workspace;
  const current = ((workspace[key] as Entity[] | undefined) || []).find(
    (entry) => entry.id === saved.id,
  );
  if (current && Number(current.version || 0) >= Number(saved.version || 0)) return workspace;
  return replaceEntity(workspace, type, saved);
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  async recordWorkLog(command) {
    const receipt = await workspaceApi.recordWorkLog(command);
    try {
      await get().refresh();
    } catch (error) {
      set({
        loadError: error instanceof Error ? error.message : String(error),
        loadState: "error",
      });
    }
    return receipt;
  },
  workspace: null,
  loadState: "idle",
  loadError: "",
  activityRevision: 0,
  async load() {
    set({ loadState: "loading", loadError: "" });
    try {
      const workspace = await workspaceApi.load();
      set({ workspace, loadState: "success", activityRevision: get().activityRevision + 1 });
      return workspace;
    } catch (error) {
      const loadError = error instanceof Error ? error.message : String(error);
      set({ loadState: "error", loadError });
      throw error;
    }
  },
  async refresh() {
    const workspace = await workspaceApi.load();
    set({
      workspace,
      loadState: "success",
      loadError: "",
      activityRevision: get().activityRevision + 1,
    });
    return workspace;
  },
  async loadSample() {
    const workspace = await workspaceApi.loadSample();
    set({
      workspace,
      loadState: "success",
      loadError: "",
      activityRevision: get().activityRevision + 1,
    });
    return workspace;
  },
  async save(type, entity, options = {}) {
    const saved = await workspaceApi.save(type, entity, options);
    const workspace = get().workspace;
    if (workspace)
      set({
        workspace: replaceEntity(workspace, type, saved),
        ...nextActivityRevision(get().activityRevision, [type]),
      });
    return saved;
  },
  async saveMany(operations) {
    const saved = await workspaceApi.saveMany(operations);
    let workspace = get().workspace;
    if (workspace) {
      saved.forEach((entity, index) => {
        workspace = replaceEntity(workspace!, operations[index].type, entity);
      });
      set({
        workspace,
        ...nextActivityRevision(
          get().activityRevision,
          operations.map((operation) => operation.type),
        ),
      });
    }
    return saved;
  },
  async remove(type, id) {
    const removed = await workspaceApi.remove(type, id);
    await get().refresh();
    return removed;
  },
  async restore(type, id) {
    const restored = await workspaceApi.restore(type, id);
    await get().refresh();
    return restored;
  },
  applyExternalSave(type, entity) {
    const workspace = get().workspace;
    if (workspace)
      set({
        workspace: replaceEntity(workspace, type, entity),
        ...nextActivityRevision(get().activityRevision, [type]),
      });
  },
  applyExternalSaves(changes) {
    let workspace = get().workspace;
    if (!workspace) return;
    for (const change of changes) {
      workspace = replaceIfNewer(workspace, change.type, change.entity);
    }
    set({
      workspace,
      ...nextActivityRevision(
        get().activityRevision,
        changes.map((change) => change.type),
      ),
    });
  },
  applyCommandReceipt(receipt) {
    const changes = [...receipt.changes, ...(receipt.eventChanges || [])];
    if (!changes.length) return;
    let workspace = get().workspace;
    if (!workspace) return;
    for (const change of changes) workspace = replaceIfNewer(workspace, change.type, change.entity);
    set({
      workspace,
      ...nextActivityRevision(
        get().activityRevision,
        changes.map((change) => change.type),
      ),
    });
  },
}));

function nextActivityRevision(current: number, types: EntityType[]): { activityRevision?: number } {
  return types.includes("change_event") ? { activityRevision: current + 1 } : {};
}
