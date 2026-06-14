import type {
  Entity,
  EntityType,
  SaveOperation,
  SaveOptions,
  SnapshotDecision,
  Workspace,
} from "../../../shared/types/workspace";
import { buildBootstrapWorkspace } from "../data/workspace.js";

function desktopApi() {
  if (!window.api) {
    throw new Error("Research DeskはElectronデスクトップ版から起動してください。");
  }
  return window.api;
}

export const workspaceApi = {
  load(): Promise<Workspace> {
    return desktopApi().workspace.bootstrap(buildBootstrapWorkspace() as Workspace);
  },
  save(type: EntityType, entity: Entity, options: SaveOptions = {}) {
    return desktopApi().entities.save(type, entity, options);
  },
  saveMany(operations: SaveOperation[]) {
    return desktopApi().entities.saveMany(operations);
  },
  remove(type: EntityType, id: string) {
    return desktopApi().entities.remove(type, id);
  },
  restore(type: EntityType, id: string) {
    return desktopApi().entities.restore(type, id);
  },
  setPreference(key: string, value: unknown) {
    return desktopApi().preferences.set(key, value);
  },
  copyText(text: string) {
    return desktopApi().clipboard.writeText(text);
  },
  reload() {
    return desktopApi().app.reload();
  },
  exportSnapshot() {
    return desktopApi().snapshots.exportFile();
  },
  inspectSnapshot() {
    return desktopApi().snapshots.inspectFile();
  },
  applySnapshot(token: string, decisions: SnapshotDecision[]) {
    return desktopApi().snapshots.applyImport(token, decisions);
  },
};
