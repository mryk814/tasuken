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
  previewAiContext(request: Parameters<Window["api"]["aiContext"]["preview"]>[0]) {
    return desktopApi().aiContext.preview(request);
  },
  getDataHealth(query: Parameters<Window["api"]["dataHealth"]["get"]>[0] = {}) {
    return desktopApi().dataHealth.get(query);
  },
  setDataHealthIssueState(request: Parameters<Window["api"]["dataHealth"]["setState"]>[0]) {
    return desktopApi().dataHealth.setState(request);
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
  previewConversationContext(request: Parameters<Window["api"]["conversationContext"]["preview"]>[0]) {
    return desktopApi().conversationContext.preview(request);
  },
  publishConversationContext(request: Parameters<Window["api"]["conversationContext"]["publish"]>[0]) {
    return desktopApi().conversationContext.publish(request);
  },
  removeConversationContext(conversationId: string) {
    return desktopApi().conversationContext.remove({ conversationId });
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
  applyCanonicalNoteAiProposal(request: DocumentSaveRequest, envelope: CommandEnvelope) {
    return desktopApi().documents.applyAiProposal(request, envelope);
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
  startNoteAiStream(requestId: string, request: import("../../../shared/ai").AiNoteGenerateRequest) {
    return desktopApi().ai.startNoteStream(requestId, request);
  },
  cancelNoteAiStream(requestId: string) {
    return desktopApi().ai.cancelNoteStream(requestId);
  },
  onNoteAiStreamEvent(callback: Parameters<Window["api"]["ai"]["onNoteStreamEvent"]>[0]) {
    return desktopApi().ai.onNoteStreamEvent(callback);
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
  readWebArtifactPreview(artifactId: string) {
    return desktopApi().artifacts.readWebPreview(artifactId);
  },
  prepareAudioCapture(themeId?: string | null) {
    return desktopApi().mediaCapture.prepareAudio({ themeId });
  },
  listPreparedAudioCaptures() {
    return desktopApi().mediaCapture.listPreparedAudio();
  },
  commitAudioCapture(request: import("../../../shared/mediaCapture").AudioCaptureCommitRequest) {
    return desktopApi().mediaCapture.commitAudio(request);
  },
  cancelAudioCapture(sessionId: string) {
    return desktopApi().mediaCapture.cancelAudio({ sessionId });
  },
  startMediaRecording(request: import("../../../shared/mediaCapture").MediaRecordingStartRequest) {
    return desktopApi().mediaCapture.startRecording(request);
  },
  appendMediaRecording(request: import("../../../shared/mediaCapture").MediaRecordingAppendRequest) {
    return desktopApi().mediaCapture.appendRecording(request);
  },
  pauseMediaRecording(sessionId: string) {
    return desktopApi().mediaCapture.pauseRecording({ sessionId });
  },
  resumeMediaRecording(sessionId: string) {
    return desktopApi().mediaCapture.resumeRecording({ sessionId });
  },
  stopMediaRecording(sessionId: string) {
    return desktopApi().mediaCapture.stopRecording({ sessionId });
  },
  getScreenRecordingCapabilities() {
    return desktopApi().screenRecording.capabilities();
  },
  listScreenRecordingSources() {
    return desktopApi().screenRecording.listSources();
  },
  /** 録画中インジケータへ表示状態を送る。終了時はnullで畳む（#383）。 */
  applyRecordingIndicator(state: import("../../../shared/ipc/contracts").RecordingIndicatorState | null) {
    return desktopApi().screenRecording.applyIndicator(state);
  },
  onRecordingIndicatorCommand(callback: (command: import("../../../shared/ipc/contracts").RecordingIndicatorCommand) => void) {
    return desktopApi().screenRecording.onIndicatorCommand(callback);
  },
  armScreenRecording(request: import("../../../shared/screenRecording.mjs").ScreenRecordingArmRequest) {
    return desktopApi().screenRecording.arm(request);
  },
  selectScreenRecordingRegion(sourceToken: string) {
    return desktopApi().screenRecording.selectRegion({ sourceToken });
  },
  applyScreenRecordingRegionIndicator(region: import("../../../shared/screenRecording.mjs").ScreenRecordingRegionSelection | null) {
    return desktopApi().screenRecording.applyRegionIndicator(region);
  },
  prepareVideoImport(request: import("../../../shared/mediaCapture").VideoImportPrepareRequest) {
    return desktopApi().mediaCapture.prepareVideo(request);
  },
  listPreparedVideoImports() {
    return desktopApi().mediaCapture.listPreparedVideo();
  },
  commitVideoImport(request: import("../../../shared/mediaCapture").VideoImportCommitRequest) {
    return desktopApi().mediaCapture.commitVideo(request);
  },
  cancelVideoImport(sessionId: string) {
    return desktopApi().mediaCapture.cancelVideo({ sessionId });
  },
  openMediaArtifactExternal(artifactId: string) {
    return desktopApi().mediaCapture.openArtifactExternal({ artifactId });
  },
  inspectMediaArtifact(artifactId: string) {
    return desktopApi().mediaCapture.inspectArtifact({ artifactId });
  },
  getVideoTrimSource(artifactId: string) {
    return desktopApi().mediaCapture.getVideoTrimSource({ artifactId });
  },
  exportVideoTrim(request: import("../../../shared/mediaCapture").VideoTrimExportRequest) {
    return desktopApi().mediaCapture.exportVideoTrim(request);
  },
  previewBatchTranscription(artifactId: string) {
    return desktopApi().batchTranscription.preview({ artifactId });
  },
  getBatchTranscriptionHistory(artifactId: string) {
    return desktopApi().batchTranscription.history({ artifactId });
  },
  runBatchTranscription(request: import("../../../shared/batchTranscriptionIpc").BatchTranscriptionRunRequest) {
    return desktopApi().batchTranscription.run(request);
  },
  cancelBatchTranscription(artifactId: string, operationId: string) {
    return desktopApi().batchTranscription.cancel({ artifactId, operationId });
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
  toggleTaskenRoot() {
    return desktopApi().app.toggleTaskenRoot();
  },
  hideTaskenRoot() {
    return desktopApi().app.hideTaskenRoot();
  },
  openTaskenRootTarget(request: Parameters<Window["api"]["app"]["openTaskenRootTarget"]>[0]) {
    return desktopApi().app.openTaskenRootTarget(request);
  },
  getTaskenRootShortcut() {
    return desktopApi().app.getTaskenRootShortcut();
  },
  setTaskenRootShortcut(shortcut: string) {
    return desktopApi().app.setTaskenRootShortcut(shortcut);
  },
  onTaskenRootShown(callback: () => void) {
    return desktopApi().app.onTaskenRootShown(callback);
  },
  showTodayMiniWindow() {
    return desktopApi().app.showTodayMiniWindow();
  },
  toggleTodayMiniWindow() {
    return desktopApi().app.toggleTodayMiniWindow();
  },
  setMemoStickyTarget(memoId: string, target: boolean) {
    return desktopApi().app.setMemoStickyTarget({ memoId, target });
  },
  toggleMemoStickyTargetsVisibility() {
    return desktopApi().app.toggleMemoStickyTargetsVisibility();
  },
  setMemoStickyTheme(theme: "light" | "dark") {
    return desktopApi().app.setMemoStickyTheme({ theme });
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
  automaticSnapshotStatus() {
    return desktopApi().snapshots.automaticStatus();
  },
  configureAutomaticSnapshot(config: Parameters<Window["api"]["snapshots"]["configureAutomatic"]>[0]) {
    return desktopApi().snapshots.configureAutomatic(config);
  },
  runAutomaticSnapshot() {
    return desktopApi().snapshots.runAutomatic();
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
