import type {
  Entity,
  EntityType,
  SaveOperation,
  SaveOptions,
  Workspace,
} from "../../../shared/types/workspace";
import type { MarkdownImageAttachmentRequest } from "../../../shared/attachments";
import type { AppUpdateCheckResult } from "../../../shared/ipc/contracts";
import type { WordExportRequest } from "../../../shared/wordExport";
import { buildBootstrapWorkspace } from "../data/workspace.js";

function desktopApi() {
  if (!window.api) {
    throw new Error("TaskenはElectronデスクトップ版から起動してください。");
  }
  return window.api;
}

export const workspaceApi = {
  load(): Promise<Workspace> {
    // 初回起動でもダミーデータは入れない。空のWorkspaceで開始する。
    return desktopApi().workspace.load();
  },
  // 明示的にサンプルデータを投入する（Settingsの操作からのみ呼ぶ）。
  // Repository側のbootstrapはDBが空のときだけ登録し、データがあれば現状をそのまま返す。
  loadSample(): Promise<Workspace> {
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
  copyHtml(html: string, text: string) {
    return desktopApi().clipboard.writeHtml({ html, text });
  },
  openPath(filePath: string) {
    return desktopApi().files.openPath(filePath);
  },
  saveMarkdownImageAttachment(request: MarkdownImageAttachmentRequest) {
    return desktopApi().attachments.saveMarkdownImage(request);
  },
  reload() {
    return desktopApi().app.reload();
  },
  checkForUpdates(): Promise<AppUpdateCheckResult> {
    return desktopApi().app.checkForUpdates();
  },
  openReleasePage(url?: string) {
    return desktopApi().app.openReleasePage(url);
  },
  exportSnapshot() {
    return desktopApi().snapshots.exportFile();
  },
  inspectSnapshot() {
    return desktopApi().snapshots.inspectFile();
  },
  applySnapshot(token: string, decisions: Record<string, string>) {
    return desktopApi().snapshots.applyImport(token, decisions);
  },
  exportMarkdownNoteToWord(request: WordExportRequest) {
    return desktopApi().exports.markdownNoteToWord(request);
  },
};
