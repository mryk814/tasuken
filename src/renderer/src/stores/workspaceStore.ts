import { create } from "zustand";

import type { Entity, EntityType, SaveOperation, SaveOptions, Workspace } from "../../../shared/types/workspace";
import { collectionKeyForEntityType } from "../../../shared/entityRegistry.mjs";
import { workspaceApi } from "../services/workspaceApi";

type LoadState = "idle" | "loading" | "success" | "error";

interface WorkspaceState {
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
}

function replaceEntity(workspace: Workspace, type: EntityType, saved: Entity): Workspace {
  const key = collectionKeyForEntityType(type) as keyof Workspace;
  const records = (workspace[key] as Entity[] | undefined) || [];
  const next = records.some((entry) => entry.id === saved.id)
    ? records.map((entry) => entry.id === saved.id ? saved : entry)
    : [saved, ...records];
  return { ...workspace, [key]: next };
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspace: null,
  loadState: "idle",
  loadError: "",
  async load() {
    set({ loadState: "loading", loadError: "" });
    try {
      const workspace = await workspaceApi.load();
      set({ workspace, loadState: "success" });
      return workspace;
    } catch (error) {
      const loadError = error instanceof Error ? error.message : String(error);
      set({ loadState: "error", loadError });
      throw error;
    }
  },
  async refresh() {
    const workspace = await workspaceApi.load();
    set({ workspace, loadState: "success", loadError: "" });
    return workspace;
  },
  async loadSample() {
    const workspace = await workspaceApi.loadSample();
    set({ workspace, loadState: "success", loadError: "" });
    return workspace;
  },
  async save(type, entity, options = {}) {
    const saved = await workspaceApi.save(type, entity, options);
    const workspace = get().workspace;
    if (workspace) set({ workspace: replaceEntity(workspace, type, saved) });
    return saved;
  },
  async saveMany(operations) {
    const saved = await workspaceApi.saveMany(operations);
    let workspace = get().workspace;
    if (workspace) {
      saved.forEach((entity, index) => {
        workspace = replaceEntity(workspace!, operations[index].type, entity);
      });
      set({ workspace });
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
    if (workspace) set({ workspace: replaceEntity(workspace, type, entity) });
  },
  applyExternalSaves(changes) {
    let workspace = get().workspace;
    if (!workspace) return;
    for (const change of changes) {
      workspace = replaceEntity(workspace, change.type, change.entity);
    }
    set({ workspace });
  },
}));
