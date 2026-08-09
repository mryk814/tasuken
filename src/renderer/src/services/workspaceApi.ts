import type {
  Entity,
  EntityType,
  DocumentSaveRequest,
  SaveOperation,
  SaveOptions,
  Workspace,
} from "../../../shared/types/workspace";
import type { ArtifactFileImportRequest, MarkdownImageAttachmentRequest } from "../../../shared/attachments";
import type { AppUpdateCheckResult, SatelliteWindowStatePayload } from "../../../shared/ipc/contracts";
import type { CommandEnvelope } from "../../../shared/applicationCommand";
import type { MarkdownFileExportRequest, MarkdownPdfExportRequest } from "../../../shared/fileExport";
import type { SketchExportRequest } from "../../../shared/sketchExport";
import type {
  MermaidPowerPointPptxExportRequest,
  MermaidPowerPointSvgExportRequest,
  MermaidSvgClipboardRequest,
} from "../../../shared/mermaidPowerPoint";
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
  getActivityCanonicalRootStatus() {
    return desktopApi().activity.getCanonicalRootStatus();
  },
  openActivityCanonicalRef(ref: Record<string, unknown>) {
    return desktopApi().activity.openCanonicalRef(ref);
  },
  getThemeAiPackStatus(themeId: string) {
    return desktopApi().themeAiPack.status(themeId);
  },
  previewThemeAiPack(themeId: string) {
    return desktopApi().themeAiPack.preview(themeId);
  },
  publishThemeAiPack(themeId: string, expectedContentHash: string) {
    return desktopApi().themeAiPack.publish({ themeId, expectedContentHash });
  },
  openThemeAiPackFolder(themeId: string) {
    return desktopApi().themeAiPack.openFolder(themeId);
  },
  onThemeAiPackChanged(callback: Parameters<Window["api"]["themeAiPack"]["onChanged"]>[0]) {
    return desktopApi().themeAiPack.onChanged(callback);
  },
  // 明示的にサンプルデータを投入する（Settingsの操作からのみ呼ぶ）。
  // Repository側のbootstrapはDBが空のときだけ登録し、データがあれば現状をそのまま返す。
  loadSample(): Promise<Workspace> {
    return desktopApi().workspace.bootstrap(buildBootstrapWorkspace() as Workspace);
  },
  save(type: EntityType, entity: Entity, options: SaveOptions = {}) {
    if (type === "task") throw new Error("Taskの保存はApplication Command経由で実行してください。");
    return desktopApi().entities.save(type, entity, options);
  },
  saveDocument(request: DocumentSaveRequest) {
    return desktopApi().documents.save(request);
  },
  get(type: EntityType, id: string) {
    return desktopApi().entities.get(type, id);
  },
  saveMany(operations: SaveOperation[]) {
    if (operations.some((operation) => operation.type === "task")) {
      throw new Error("Taskの一括保存はApplication Command経由で実行してください。");
    }
    return desktopApi().entities.saveMany(operations);
  },
  remove(type: EntityType, id: string) {
    if (type === "task") throw new Error("Taskの削除はApplication Command経由で実行してください。");
    return desktopApi().entities.remove(type, id);
  },
  restore(type: EntityType, id: string) {
    return desktopApi().entities.restore(type, id);
  },
  executeCommand(envelope: CommandEnvelope) {
    return desktopApi().commands.execute(envelope);
  },
  executeCommands(envelopes: CommandEnvelope[]) {
    return desktopApi().commands.executeBatch(envelopes);
  },
  setPreference(key: string, value: unknown) {
    return desktopApi().preferences.set(key, value);
  },
  getPreference(key: string) {
    return desktopApi().preferences.get(key);
  },
  getViewPreferences() {
    return desktopApi().preferences.getView();
  },
  setViewPreference(id: string, scopeKey: string, value: unknown, schemaVersion: number) {
    return desktopApi().preferences.setView(id, scopeKey, value, schemaVersion);
  },
  onViewPreferenceChanged(callback: Parameters<Window["api"]["preferences"]["onViewChanged"]>[0]) {
    return desktopApi().preferences.onViewChanged(callback);
  },
  getAiConfig() {
    return desktopApi().ai.getConfig();
  },
  saveAiProviderProfile(update: import("../../../shared/ai").AiProviderProfileUpdate) {
    return desktopApi().ai.saveProviderProfile(update);
  },
  deleteAiProviderProfile(id: string) {
    return desktopApi().ai.deleteProviderProfile(id);
  },
  saveAiModelProfile(update: import("../../../shared/ai").AiModelProfileUpdate) {
    return desktopApi().ai.saveModelProfile(update);
  },
  deleteAiModelProfile(id: string) {
    return desktopApi().ai.deleteModelProfile(id);
  },
  setDefaultAiProviderProfile(id: string) {
    return desktopApi().ai.setDefaultProviderProfile(id);
  },
  setDefaultAiModelProfile(id: string) {
    return desktopApi().ai.setDefaultModelProfile(id);
  },
  testAiConnection(request: import("../../../shared/ai").AiTestConnectionRequest) {
    return desktopApi().ai.testConnection(request);
  },
  getAiFeatureAvailability(feature: import("../../../shared/ai").AiFeature, providerProfileId?: string, modelProfileId?: string) {
    return desktopApi().ai.featureAvailability(feature, providerProfileId, modelProfileId);
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
  copySvg(payload: MermaidSvgClipboardRequest) {
    return desktopApi().clipboard.writeSvg(payload);
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
  listStickyMemoTargets() {
    return desktopApi().app.listStickyMemoTargets();
  },
  showAllMemoStickies() {
    return desktopApi().app.showAllMemoStickies();
  },
  closeAllMemoStickies() {
    return desktopApi().app.closeAllMemoStickies();
  },
  getSatelliteWindowState() {
    return desktopApi().app.getSatelliteWindowState();
  },
  onSatelliteWindowStateChanged(callback: (state: SatelliteWindowStatePayload) => void) {
    return desktopApi().app.onSatelliteWindowStateChanged(callback);
  },
  onAppFlushRequested(callback: (request: { requestId: string; noteId?: string }) => void) {
    return desktopApi().app.onAppFlushRequested(callback);
  },
  ackAppFlush(requestId: string, ok: boolean) {
    return desktopApi().app.ackAppFlush(requestId, ok);
  },
  onMemoStickyOpenChanged(callback: (memoIds: string[]) => void) {
    return desktopApi().app.onMemoStickyOpenChanged(callback);
  },
  openNoteWindow(noteId: string) {
    return desktopApi().app.openNoteWindow(noteId);
  },
  listOpenNoteWindows() {
    return desktopApi().app.listOpenNoteWindows();
  },
  returnNoteWindowToMain() {
    return desktopApi().app.returnNoteWindowToMain();
  },
  openNoteWindowInMain(route?: string) {
    return desktopApi().app.openNoteWindowInMain(route);
  },
  onNoteWindowOpenChanged(callback: (noteIds: string[]) => void) {
    return desktopApi().app.onNoteWindowOpenChanged(callback);
  },
  onNoteWindowFlushRequested(callback: (request: { requestId: string; noteId?: string }) => void) {
    return desktopApi().app.onNoteWindowFlushRequested(callback);
  },
  ackNoteWindowFlush(requestId: string, ok: boolean) {
    return desktopApi().app.ackNoteWindowFlush(requestId, ok);
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
  exportMermaidSvg(request: MermaidPowerPointSvgExportRequest) {
    return desktopApi().exports.mermaidSvg(request);
  },
  exportMermaidPptx(request: MermaidPowerPointPptxExportRequest) {
    return desktopApi().exports.mermaidPptx(request);
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
