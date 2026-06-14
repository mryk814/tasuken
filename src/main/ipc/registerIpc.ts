import { ipcMain } from "electron";

import { IPC } from "../../shared/ipc/contracts";
import { entityTypes, type EntityType } from "../../shared/types/workspace";
import type { WorkspaceService } from "../services/workspaceService";

interface WorkspaceRepository {
  loadWorkspace(includeDeleted?: boolean): unknown;
  bootstrap(legacy: unknown): unknown;
  getMeta(): unknown;
  getPreference(key: string): unknown;
  setPreference(key: string, value: unknown): unknown;
  list(type: EntityType, includeDeleted?: boolean): unknown;
  get(type: EntityType, id: string): unknown;
  save(type: EntityType, entity: unknown, options?: unknown): unknown;
  saveMany(operations: unknown): unknown;
  remove(type: EntityType, id: string): unknown;
  restore(type: EntityType, id: string): unknown;
}

function requireEntityType(value: unknown): EntityType {
  if (typeof value !== "string" || !entityTypes.includes(value as EntityType)) {
    throw new Error("保存対象の種類が不正です。画面を再読み込みして、もう一度試してください。");
  }
  return value as EntityType;
}

function requireId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("対象IDがありません。画面を再読み込みして、もう一度試してください。");
  }
  return value;
}

export function registerIpc(repository: WorkspaceRepository, service: WorkspaceService): void {
  ipcMain.handle(IPC.workspaceLoad, () => repository.loadWorkspace());
  ipcMain.handle(IPC.workspaceBootstrap, (_event, legacy) => repository.bootstrap(legacy));
  ipcMain.handle(IPC.workspaceMeta, () => repository.getMeta());
  ipcMain.handle(IPC.preferenceGet, (_event, key) => repository.getPreference(requireId(key)));
  ipcMain.handle(IPC.preferenceSet, (_event, key, value) => repository.setPreference(requireId(key), value));
  ipcMain.handle(IPC.clipboardWriteText, (_event, text) => service.writeClipboard(text));
  ipcMain.handle(IPC.appReload, (event) => service.reload(event.sender));
  ipcMain.handle(IPC.entityList, (_event, type, includeDeleted) =>
    repository.list(requireEntityType(type), Boolean(includeDeleted)));
  ipcMain.handle(IPC.entityGet, (_event, type, id) =>
    repository.get(requireEntityType(type), requireId(id)));
  ipcMain.handle(IPC.entitySave, (_event, type, entity, options) =>
    repository.save(requireEntityType(type), entity, options));
  ipcMain.handle(IPC.entitySaveMany, (_event, operations) => repository.saveMany(operations));
  ipcMain.handle(IPC.entityRemove, (_event, type, id) =>
    repository.remove(requireEntityType(type), requireId(id)));
  ipcMain.handle(IPC.entityRestore, (_event, type, id) =>
    repository.restore(requireEntityType(type), requireId(id)));
  ipcMain.handle(IPC.snapshotExport, () => service.exportSnapshot());
  ipcMain.handle(IPC.snapshotInspect, () => service.inspectSnapshot());
  ipcMain.handle(IPC.snapshotApply, (_event, token, decisions) =>
    service.applySnapshot(requireId(token), Array.isArray(decisions) ? decisions : []));
}
