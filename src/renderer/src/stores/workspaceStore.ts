import { create } from "zustand";

import type { Entity, EntityType, SaveOperation, SaveOptions, Workspace } from "../../../shared/types/workspace";
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
}

const entityKeys: Record<EntityType, keyof Workspace> = {
  theme: "themes",
  item: "items",
  note: "notes",
  link: "links",
  resource: "resources",
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
  knowledge_node: "knowledge_nodes",
  knowledge_relation: "knowledge_relations",
  ai_proposal: "ai_proposals",
  project: "projects",
  capture_entry: "capture_entrys",
  task: "tasks",
  waiting: "waitings",
  plan_node: "plan_nodes",
  schedule: "schedules",
  reference: "references",
  task_dependency: "task_dependencys",
  plan_dependency: "plan_dependencys",
  knowledge_edge: "knowledge_edges",
  change_event: "change_events",
};

function replaceEntity(workspace: Workspace, type: EntityType, saved: Entity): Workspace {
  const key = entityKeys[type];
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
}));
