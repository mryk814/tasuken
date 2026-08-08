import type {
  Entity,
  EntityType,
  SaveOperation,
  SaveOptions,
  SnapshotInspectResult,
  Workspace,
  WorkspaceMeta,
} from "../types/workspace";
import type { CanonicalRootStatusMap } from "../types/workspace";
import type { ArtifactFileImportRequest, ArtifactFileImportResult, ArtifactProposalMaterializeRequest, ArtifactProposalMaterializeResult, MarkdownImageAttachmentRequest, MarkdownImageAttachmentResult } from "../attachments";
import type { MarkdownFileExportRequest, MarkdownFileExportResult, MarkdownPdfExportRequest, MarkdownPdfExportResult } from "../fileExport";
import type { SketchExportRequest, SketchExportResult } from "../sketchExport";
import type {
  MermaidPowerPointPptxExportRequest,
  MermaidPowerPointPptxExportResult,
  MermaidPowerPointSvgExportRequest,
  MermaidPowerPointSvgExportResult,
  MermaidSvgClipboardRequest,
  MermaidSvgClipboardResult,
} from "../mermaidPowerPoint";
import type { ImageClipboardRequest, SlideTimelineExportRequest, SlideTimelineExportResult } from "../slideTimelineExport";
import type { AiNoteGenerateRequest, AiNoteGenerateResult, AiProviderConfig, AiProviderConfigUpdate } from "../ai";
import type { CalendarConnectRequest, CalendarConnectionStatus, CalendarDisconnectRequest, CalendarEventsResult } from "../calendar";
import type { CommandEnvelope, CommandReceipt } from "../applicationCommand";
import type { ThemePickerOption } from "../themeRef.mjs";

export const IPC = {
  workspaceLoad: "workspace:load",
  workspaceBootstrap: "workspace:bootstrap",
  workspaceMeta: "workspace:meta",
  activityCanonicalRootStatus: "activity:canonical-root-status",
  activityOpenCanonicalRef: "activity:open-canonical-ref",
  preferenceGet: "preference:get",
  preferenceSet: "preference:set",
  viewPreferenceGet: "view-preference:get",
  viewPreferenceSet: "view-preference:set",
  viewPreferenceChanged: "view-preference:changed",
  clipboardWriteText: "clipboard:write-text",
  clipboardWriteHtml: "clipboard:write-html",
  clipboardWriteImage: "clipboard:write-image",
  clipboardWriteSvg: "clipboard:write-svg",
  fileOpen: "file:open",
  fileShowInFolder: "file:show-in-folder",
  filePathExists: "file:path-exists",
  fileReadPreview: "file:read-preview",
  dialogChooseDirectory: "dialog:choose-directory",
  dialogChooseFiles: "dialog:choose-files",
  markdownImageSave: "markdown-image:save",
  artifactFilesImport: "artifact:files-import",
  artifactProposalMaterialize: "artifact:proposal-materialize",
  appReload: "app:reload",
  appUpdateCheck: "app:update-check",
  appReleasePageOpen: "app:release-page-open",
  appTitleBarTheme: "app:titlebar-theme",
  mcpBridgeInfo: "mcp:bridge-info",
  todayMiniShow: "today-mini:show",
  todayMiniRefresh: "today-mini:refresh",
  todayMiniPinTopRight: "today-mini:pin-top-right",
  todayMiniHide: "today-mini:hide",
  todayMiniList: "today-mini:list",
  todayMiniThemes: "today-mini:themes",
  todayMiniAddTask: "today-mini:add-task",
  todayMiniToggle: "today-mini:toggle",
  todayMiniOpenTask: "today-mini:open-task",
  memoStickyOpen: "memo-sticky:open",
  memoStickyLoad: "memo-sticky:load",
  memoStickySave: "memo-sticky:save",
  memoStickyCopy: "memo-sticky:copy",
  memoStickyClose: "memo-sticky:close",
  memoStickySetAlwaysOnTop: "memo-sticky:set-always-on-top",
  memoStickyIsAlwaysOnTop: "memo-sticky:is-always-on-top",
  memoStickyOpenInMain: "memo-sticky:open-in-main",
  memoStickyArchive: "memo-sticky:archive",
  memoStickyDelete: "memo-sticky:delete",
  memoStickyOpenChanged: "memo-sticky:open-changed",
  memoStickyListOpen: "memo-sticky:list-open",
  memoStickyListTargets: "memo-sticky:list-targets",
  memoStickyShowAll: "memo-sticky:show-all",
  memoStickyCloseAll: "memo-sticky:close-all",
  satelliteWindowState: "satellite-window:state",
  entityList: "entity:list",
  entityGet: "entity:get",
  entitySave: "entity:save",
  entitySaveMany: "entity:save-many",
  entityRemove: "entity:remove",
  entityRestore: "entity:restore",
  snapshotExport: "snapshot:export",
  snapshotInspect: "snapshot:inspect",
  snapshotApply: "snapshot:apply",
  sharedSyncStatus: "shared-sync:status",
  sharedSyncConfigure: "shared-sync:configure",
  sharedSyncDisable: "shared-sync:disable",
  sharedSyncNow: "shared-sync:now",
  sharedSyncResolve: "shared-sync:resolve",
  markdownFileExport: "markdown-file:export",
  markdownPdfExport: "markdown-pdf:export",
  sketchExport: "sketch:export",
  slideTimelineExport: "slide-timeline:export",
  mermaidSvgExport: "mermaid:svg-export",
  mermaidPptxExport: "mermaid:pptx-export",
  aiConfigGet: "ai:config-get",
  aiConfigSave: "ai:config-save",
  aiNoteGenerate: "ai:note-generate",
  calendarStatus: "calendar:status",
  calendarConnect: "calendar:connect",
  calendarDisconnect: "calendar:disconnect",
  calendarEvents: "calendar:events",
  applicationCommand: "application:command",
  applicationCommandBatch: "application:command-batch",
  workspaceChanged: "workspace:changed",
  quickCaptureSave: "quick-capture:save",
  quickCapturePreviewDue: "quick-capture:preview-due",
  quickCaptureHide: "quick-capture:hide",
  quickCaptureShown: "quick-capture:shown",
  quickCaptureTheme: "quick-capture:theme",
  quickCaptureThemes: "quick-capture:themes",
  noteWindowOpen: "note-window:open",
  noteWindowListOpen: "note-window:list-open",
  noteWindowReturnToMain: "note-window:return-to-main",
  noteWindowOpenInMain: "note-window:open-in-main",
  noteWindowClose: "note-window:close",
  noteWindowOpenChanged: "note-window:open-changed",
  workspaceOpenNote: "workspace:open-note",
  workspaceOpenMemo: "workspace:open-memo",
  workspaceNavigate: "workspace:navigate",
  workspaceOpenTaskDetail: "workspace:open-task-detail",
} as const;

export interface WorkspaceChangePayload {
  type?: EntityType;
  entity?: Entity;
  entities?: Array<{ type: EntityType; entity: Entity }>;
  canonical_root_status?: CanonicalRootStatusMap;
}

export interface ViewPreferenceEnvelope {
  schemaVersion: 1;
  revision: number;
  values: Record<string, { schemaVersion: number; value: unknown }>;
}

export interface ViewPreferenceChange {
  id: string;
  scopeKey: string;
  schemaVersion: number;
  value: unknown;
  revision: number;
}

export interface TodayMiniTask {
  id: string;
  title: string;
  themeName: string;
  themeColor: string;
  scheduleLabel: string;
  hasReminder: boolean;
  priority: "normal" | "high";
  checklistDone: number;
  checklistTotal: number;
}

export type TodayMiniThemeOption = ThemePickerOption;

export interface TodayMiniAddTaskRequest {
  title: string;
  themeId?: string;
}

export interface SatelliteWindowStatePayload {
  todayOpen: boolean;
  openMemoIds: string[];
  stickyMemoIds: string[];
}

export interface AppUpdateCheckResult {
  status: "available" | "current" | "error";
  currentVersion: string;
  latestVersion?: string;
  releaseName?: string;
  releaseUrl: string;
  publishedAt?: string;
  error?: string;
}

export interface McpBridgeInfo {
  command: string;
  args: string[];
  configJson: string;
  inboxPath: string;
  pendingFileCount: number;
  packaged: boolean;
}

export interface SharedSyncConflict {
  id: string;
  entityType: EntityType;
  entityId: string;
  localRevisionId: string;
  incomingRevisionId: string;
  local: Entity;
  incoming: Entity;
  incomingDeviceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SharedSyncStatus {
  enabled: boolean;
  directory: string;
  workspaceId: string;
  deviceId: string;
  state: "off" | "idle" | "syncing" | "conflict" | "error";
  lastSyncedAt: string;
  lastError: string;
  pendingCount: number;
  conflictCount: number;
  conflicts: SharedSyncConflict[];
  markdownImageCount: number;
  lastMarkdownImagesPublished: number;
  lastMarkdownImagesReceived: number;
}

/** アプリ内ビューア用のローカルファイル読み取り結果。 */
export type FilePreviewReadResult =
  | { ok: true; kind: "image"; dataUrl: string; mimeType: string; filePath: string }
  | { ok: true; kind: "text"; text: string; mimeType: string; filePath: string }
  | { ok: false; error: string };

export interface ResearchDeskApi {
  workspace: {
    load(): Promise<Workspace>;
    bootstrap(legacy: Workspace): Promise<Workspace>;
    getMeta(): Promise<WorkspaceMeta>;
  };
  activity: {
    getCanonicalRootStatus(): Promise<CanonicalRootStatusMap>;
    openCanonicalRef(ref: Record<string, unknown>): Promise<{ ok: boolean; error?: string }>;
  };
  preferences: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<boolean>;
    getView(): Promise<ViewPreferenceEnvelope>;
    setView(id: string, scopeKey: string, value: unknown, schemaVersion: number): Promise<ViewPreferenceChange>;
    onViewChanged(callback: (change: ViewPreferenceChange) => void): () => void;
  };
  ai: {
    getConfig(): Promise<AiProviderConfig>;
    saveConfig(update: AiProviderConfigUpdate): Promise<AiProviderConfig>;
    generateNote(request: AiNoteGenerateRequest): Promise<AiNoteGenerateResult>;
  };
  clipboard: {
    writeText(text: string): Promise<boolean>;
    writeHtml(payload: { html: string; text: string }): Promise<boolean>;
    writeImage(payload: ImageClipboardRequest): Promise<boolean>;
    writeSvg(payload: MermaidSvgClipboardRequest): Promise<MermaidSvgClipboardResult>;
  };
  files: {
    openPath(filePath: string): Promise<{ ok: boolean; error?: string }>;
    showItemInFolder(filePath: string): Promise<{ ok: boolean; error?: string }>;
    pathExists(filePath: string): Promise<{ exists: boolean; kind: "url" | "path"; error?: string }>;
    /** アプリ内ビューア用。ローカル画像は data URL、Markdown/テキストは本文を返す。 */
    readPreview(filePath: string): Promise<FilePreviewReadResult>;
    // DOMのFileからOSパスを取り出す（Preloadのelectron.webUtils経由。同期）。
    pathForFile(file: File): string;
  };
  dialogs: {
    chooseDirectory(title?: string): Promise<{ canceled: boolean; path?: string }>;
    chooseFiles(title?: string): Promise<{ canceled: boolean; files?: Array<{ path: string; name: string }> }>;
  };
  attachments: {
    saveMarkdownImage(request: MarkdownImageAttachmentRequest): Promise<MarkdownImageAttachmentResult>;
    importArtifactFiles(request: ArtifactFileImportRequest): Promise<ArtifactFileImportResult>;
    materializeArtifactProposal(request: ArtifactProposalMaterializeRequest): Promise<ArtifactProposalMaterializeResult>;
  };
  app: {
    reload(): Promise<boolean>;
    checkForUpdates(): Promise<AppUpdateCheckResult>;
    openReleasePage(url?: string): Promise<boolean>;
    setTitleBarTheme(theme: "light" | "dark"): Promise<boolean>;
    getMcpBridgeInfo(): Promise<McpBridgeInfo>;
    showTodayMiniWindow(): Promise<boolean>;
    /** Memoをデスクトップ付箋として浮かせる。既に開いていれば前面へ出す（#298）。 */
    showMemoStickyWindow(memoId: string): Promise<boolean>;
    /** いま付箋として浮いているMemoのID（#298）。 */
    listOpenMemoStickies(): Promise<string[]>;
    listStickyMemoTargets(): Promise<string[]>;
    showAllMemoStickies(): Promise<number>;
    /** すべて閉じる。Memoは削除しない。 */
    closeAllMemoStickies(): Promise<number>;
    onMemoStickyOpenChanged(callback: (memoIds: string[]) => void): () => void;
    getSatelliteWindowState(): Promise<SatelliteWindowStatePayload>;
    onSatelliteWindowStateChanged(callback: (state: SatelliteWindowStatePayload) => void): () => void;
    /** Noteを別ウィンドウで開く。既に開いていれば前面へ出す（#290）。 */
    openNoteWindow(noteId: string): Promise<boolean>;
    listOpenNoteWindows(): Promise<string[]>;
    /** 切り離しウィンドウを閉じ、本体で同じNoteを開き直す。 */
    returnNoteWindowToMain(): Promise<boolean>;
    /** 切り離しウィンドウは閉じずに本体を前面へ出す。 */
    openNoteWindowInMain(route?: string): Promise<boolean>;
    onNoteWindowOpenChanged(callback: (noteIds: string[]) => void): () => void;
    onOpenNote(callback: (noteId: string) => void): () => void;
    onOpenMemo(callback: (memoId: string) => void): () => void;
    onNavigate(callback: (route: string) => void): () => void;
  onWorkspaceChanged(callback: (change?: WorkspaceChangePayload) => void): () => void;
    onOpenTaskDetail(callback: (taskId: string) => void): () => void;
  };
  entities: {
    list(type: EntityType, includeDeleted?: boolean): Promise<Entity[]>;
    get(type: EntityType, id: string): Promise<Entity | null>;
    save(type: EntityType, entity: Entity, options?: SaveOptions): Promise<Entity>;
    saveMany(operations: SaveOperation[]): Promise<Entity[]>;
    remove(type: EntityType, id: string): Promise<Entity>;
    restore(type: EntityType, id: string): Promise<Entity>;
  };
  commands: {
    execute(envelope: CommandEnvelope): Promise<CommandReceipt>;
    executeBatch(envelopes: CommandEnvelope[]): Promise<CommandReceipt[]>;
  };
  snapshots: {
    exportFile(): Promise<{ canceled: boolean; filePath?: string }>;
    inspectFile(): Promise<SnapshotInspectResult>;
    // decisionsは「change.key -> action」の対応表。配列ではなくオブジェクトで渡す。
    applyImport(token: string, decisions: Record<string, string>): Promise<Workspace>;
  };
  sharedSync: {
    status(): Promise<SharedSyncStatus>;
    configure(directory: string): Promise<SharedSyncStatus>;
    disable(): Promise<SharedSyncStatus>;
    syncNow(): Promise<SharedSyncStatus>;
    resolveConflict(conflictId: string, choice: "local" | "incoming"): Promise<{
      result: { type: EntityType; entity: Entity; revisionId: string };
      status: SharedSyncStatus;
    }>;
  };
  exports: {
    markdownFile(request: MarkdownFileExportRequest): Promise<MarkdownFileExportResult>;
    markdownPdf(request: MarkdownPdfExportRequest): Promise<MarkdownPdfExportResult>;
    sketch(request: SketchExportRequest): Promise<SketchExportResult>;
    slideTimeline(request: SlideTimelineExportRequest): Promise<SlideTimelineExportResult>;
    mermaidSvg(request: MermaidPowerPointSvgExportRequest): Promise<MermaidPowerPointSvgExportResult>;
    mermaidPptx(request: MermaidPowerPointPptxExportRequest): Promise<MermaidPowerPointPptxExportResult>;
  };
  calendar: {
    getStatus(): Promise<CalendarConnectionStatus>;
    connect(request: CalendarConnectRequest): Promise<CalendarConnectionStatus>;
    disconnect(request: CalendarDisconnectRequest): Promise<CalendarConnectionStatus>;
    getEvents(date: string): Promise<CalendarEventsResult>;
  };
}

/** デスクトップ付箋として浮かせたMemoの内容（#298）。正本は capture_entry。 */
export interface MemoStickyContent {
  id: string;
  title: string;
  text: string;
  url: string;
  capturedAt: string;
}
