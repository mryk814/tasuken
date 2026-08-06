import type {
  Entity,
  EntityType,
  SaveOperation,
  SaveOptions,
  Workspace,
} from "../../../shared/types/workspace";
import type { ArtifactFileImportRequest, MarkdownImageAttachmentRequest } from "../../../shared/attachments";
import type { AppUpdateCheckResult } from "../../../shared/ipc/contracts";
import type { MarkdownFileExportRequest, MarkdownPdfExportRequest } from "../../../shared/fileExport";
import type { SketchExportRequest } from "../../../shared/sketchExport";
import type { ImageClipboardRequest, SlideTimelineExportRequest } from "../../../shared/slideTimelineExport";
import type { CalendarConnectRequest, CalendarDisconnectRequest } from "../../../shared/calendar";
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
  getPreference(key: string) {
    return desktopApi().preferences.get(key);
  },
  getAiConfig() {
    return desktopApi().ai.getConfig();
  },
  saveAiConfig(update: import("../../../shared/ai").AiProviderConfigUpdate) {
    return desktopApi().ai.saveConfig(update);
  },
  generateNoteWithAi(request: import("../../../shared/ai").AiNoteGenerateRequest) {
    return desktopApi().ai.generateNote(request);
  },
  copyText(text: string) {
    return desktopApi().clipboard.writeText(text);
  },
  copyHtml(html: string, text: string) {
    return desktopApi().clipboard.writeHtml({ html, text });
  },
  copyImage(payload: ImageClipboardRequest) {
    return desktopApi().clipboard.writeImage(payload);
  },
  openPath(filePath: string) {
    return desktopApi().files.openPath(filePath);
  },
  showItemInFolder(filePath: string) {
    return desktopApi().files.showItemInFolder(filePath);
  },
  pathExists(filePath: string) {
    return desktopApi().files.pathExists(filePath);
  },
  readFilePreview(filePath: string) {
    return desktopApi().files.readPreview(filePath);
  },
  pathForFile(file: File) {
    return desktopApi().files.pathForFile(file);
  },
  chooseDirectory(title?: string) {
    return desktopApi().dialogs.chooseDirectory(title);
  },
  chooseFiles(title?: string) {
    return desktopApi().dialogs.chooseFiles(title);
  },
  saveMarkdownImageAttachment(request: MarkdownImageAttachmentRequest) {
    return desktopApi().attachments.saveMarkdownImage(request);
  },
  importArtifactFiles(request: ArtifactFileImportRequest) {
    return desktopApi().attachments.importArtifactFiles(request);
  },
  materializeArtifactProposal(request: import("../../../shared/attachments").ArtifactProposalMaterializeRequest) {
    return desktopApi().attachments.materializeArtifactProposal(request);
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
  setTitleBarTheme(theme: "light" | "dark") {
    return desktopApi().app.setTitleBarTheme(theme);
  },
  getMcpBridgeInfo() {
    return desktopApi().app.getMcpBridgeInfo();
  },
  showTodayMiniWindow() {
    return desktopApi().app.showTodayMiniWindow();
  },
  showMemoStickyWindow(memoId: string) {
    return desktopApi().app.showMemoStickyWindow(memoId);
  },
  listOpenMemoStickies() {
    return desktopApi().app.listOpenMemoStickies();
  },
  showAllMemoStickies() {
    return desktopApi().app.showAllMemoStickies();
  },
  closeAllMemoStickies() {
    return desktopApi().app.closeAllMemoStickies();
  },
  onMemoStickyOpenChanged(callback: (memoIds: string[]) => void) {
    return desktopApi().app.onMemoStickyOpenChanged(callback);
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
  sharedSyncStatus() {
    return desktopApi().sharedSync.status();
  },
  configureSharedSync(directory: string) {
    return desktopApi().sharedSync.configure(directory);
  },
  disableSharedSync() {
    return desktopApi().sharedSync.disable();
  },
  runSharedSync() {
    return desktopApi().sharedSync.syncNow();
  },
  resolveSharedSyncConflict(conflictId: string, choice: "local" | "incoming") {
    return desktopApi().sharedSync.resolveConflict(conflictId, choice);
  },
  exportMarkdownFile(request: MarkdownFileExportRequest) {
    return desktopApi().exports.markdownFile(request);
  },
  exportMarkdownPdf(request: MarkdownPdfExportRequest) {
    return desktopApi().exports.markdownPdf(request);
  },
  exportSketch(request: SketchExportRequest) {
    return desktopApi().exports.sketch(request);
  },
  exportSlideTimeline(request: SlideTimelineExportRequest) {
    return desktopApi().exports.slideTimeline(request);
  },
  calendarStatus() {
    return desktopApi().calendar.getStatus();
  },
  calendarConnect(request: CalendarConnectRequest) {
    return desktopApi().calendar.connect(request);
  },
  calendarDisconnect(request: CalendarDisconnectRequest) {
    return desktopApi().calendar.disconnect(request);
  },
  calendarEvents(date: string) {
    return desktopApi().calendar.getEvents(date);
  },
};
