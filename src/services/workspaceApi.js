import { buildBootstrapWorkspace } from "../data/workspace.js";

function desktopApi() {
  if (!window.researchDesk) {
    throw new Error("Research DeskはElectronデスクトップ版から起動してください。");
  }
  return window.researchDesk;
}

export const workspaceApi = {
  async load() {
    return desktopApi().workspace.bootstrap(buildBootstrapWorkspace());
  },
  async save(type, entity, options = {}) {
    return desktopApi().entities.save(type, entity, options);
  },
  async saveMany(operations) {
    return desktopApi().entities.saveMany(operations);
  },
  async remove(type, id) {
    return desktopApi().entities.remove(type, id);
  },
  async restore(type, id) {
    return desktopApi().entities.restore(type, id);
  },
  async setPreference(key, value) {
    return desktopApi().preferences.set(key, value);
  },
  async copyText(text) {
    return desktopApi().clipboard.writeText(text);
  },
  async reload() {
    return desktopApi().app.reload();
  },
  async exportSnapshot() {
    return desktopApi().snapshots.exportFile();
  },
  async inspectSnapshot() {
    return desktopApi().snapshots.inspectFile();
  },
  async applySnapshot(token, decisions) {
    return desktopApi().snapshots.applyImport(token, decisions);
  },
};
