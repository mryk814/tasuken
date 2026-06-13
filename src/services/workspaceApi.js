import { buildLegacyWorkspace } from "../data/workspace.js";

const STORAGE_KEY = "research-desk:workspace-v2";
const pluralKey = (type) => `${type}s`;
const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

function loadBrowserWorkspace() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persistBrowserWorkspace(workspace) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
}

function browserBootstrap() {
  const existing = loadBrowserWorkspace();
  if (existing) return existing;
  const workspace = {
    ...buildLegacyWorkspace(),
    plan_revisions: [],
    meta: { schemaVersion: 1, workspaceId: uuid(), deviceId: "browser" },
  };
  persistBrowserWorkspace(workspace);
  return workspace;
}

function browserSave(type, input, options = {}) {
  const workspace = browserBootstrap();
  const key = pluralKey(type);
  const records = workspace[key] || [];
  const index = records.findIndex((entry) => entry.id === input.id);
  const existing = index >= 0 ? records[index] : null;
  const timestamp = now();
  const entity = {
    ...existing,
    ...input,
    id: String(input.id || uuid()),
    created_at: existing?.created_at || input.created_at || timestamp,
    updated_at: timestamp,
    deleted_at: null,
    device_id: "browser",
    source: input.source || existing?.source || options.source || "manual",
    version: (existing?.version || 0) + 1,
  };
  if (type === "item" && existing) {
    const fields = ["planned_start", "planned_end", "due_date", "schedule_status", "schedule_confidence", "progress"];
    const oldValues = Object.fromEntries(fields.map((field) => [field, existing[field] ?? null]));
    const newValues = Object.fromEntries(fields.map((field) => [field, entity[field] ?? null]));
    if (JSON.stringify(oldValues) !== JSON.stringify(newValues)) {
      workspace.plan_revisions.unshift({
        id: uuid(),
        item_id: entity.id,
        changed_at: timestamp,
        changed_by_device_id: "browser",
        old: oldValues,
        next: newValues,
        reason: options.reason || "",
        created_at: timestamp,
      });
    }
  }
  if (index >= 0) records[index] = entity;
  else records.unshift(entity);
  workspace[key] = records;
  persistBrowserWorkspace(workspace);
  return entity;
}

function browserRemove(type, id) {
  const workspace = browserBootstrap();
  const key = pluralKey(type);
  const records = workspace[key] || [];
  const index = records.findIndex((entry) => entry.id === id);
  if (index < 0) return null;
  records[index] = {
    ...records[index],
    deleted_at: now(),
    updated_at: now(),
    version: (records[index].version || 0) + 1,
  };
  persistBrowserWorkspace(workspace);
  return records[index];
}

function browserRestore(type, id) {
  const workspace = browserBootstrap();
  const key = pluralKey(type);
  const records = workspace[key] || [];
  const index = records.findIndex((entry) => entry.id === id);
  if (index < 0) return null;
  records[index] = {
    ...records[index],
    deleted_at: null,
    updated_at: now(),
    version: (records[index].version || 0) + 1,
  };
  persistBrowserWorkspace(workspace);
  return records[index];
}

export const workspaceApi = {
  async load() {
    if (window.researchDesk) {
      return window.researchDesk.workspace.bootstrap(buildLegacyWorkspace());
    }
    return browserBootstrap();
  },
  async save(type, entity, options = {}) {
    return window.researchDesk
      ? window.researchDesk.entities.save(type, entity, options)
      : browserSave(type, entity, options);
  },
  async remove(type, id) {
    return window.researchDesk
      ? window.researchDesk.entities.remove(type, id)
      : browserRemove(type, id);
  },
  async restore(type, id) {
    return window.researchDesk
      ? window.researchDesk.entities.restore(type, id)
      : browserRestore(type, id);
  },
  async exportSnapshot() {
    if (!window.researchDesk) throw new Error("ZIP Snapshotはデスクトップ版で利用できます。");
    return window.researchDesk.snapshots.exportFile();
  },
  async inspectSnapshot() {
    if (!window.researchDesk) throw new Error("ZIP Snapshotはデスクトップ版で利用できます。");
    return window.researchDesk.snapshots.inspectFile();
  },
  async applySnapshot(token, decisions) {
    if (!window.researchDesk) throw new Error("ZIP Snapshotはデスクトップ版で利用できます。");
    return window.researchDesk.snapshots.applyImport(token, decisions);
  },
};
