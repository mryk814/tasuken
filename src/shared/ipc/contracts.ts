import type {
  Entity,
  EntityType,
  SaveOperation,
  SaveOptions,
  SnapshotInspectResult,
  Workspace,
  WorkspaceMeta,
} from "../types/workspace";
import type { ArtifactFileImportRequest, ArtifactFileImportResult, ArtifactProposalMaterializeRequest, ArtifactProposalMaterializeResult, MarkdownImageAttachmentRequest, MarkdownImageAttachmentResult } from "../attachments";
import type { MarkdownFileExportRequest, MarkdownFileExportResult, MarkdownPdfExportRequest, MarkdownPdfExportResult } from "../fileExport";
import type { SketchExportRequest, SketchExportResult } from "../sketchExport";
import type { ImageClipboardRequest, SlideTimelineExportRequest, SlideTimelineExportResult } from "../slideTimelineExport";
import type { AiNoteGenerateRequest, AiNoteGenerateResult, AiProviderConfig, AiProviderConfigUpdate } from "../ai";

export const IPC = {
  workspaceLoad: "workspace:load",
  workspaceBootstrap: "workspace:bootstrap",
  workspaceMeta: "workspace:meta",
  preferenceGet: "preference:get",
  preferenceSet: "preference:set",
  clipboardWriteText: "clipboard:write-text",
  clipboardWriteHtml: "clipboard:write-html",
  clipboardWriteImage: "clipboard:write-image",
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
  aiConfigGet: "ai:config-get",
  aiConfigSave: "ai:config-save",
  aiNoteGenerate: "ai:note-generate",
} as const;

export interface WorkspaceChangePayload {
  type?: EntityType;
  entity?: Entity;
  entities?: Array<{ type: EntityType; entity: Entity }>;
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
  preferences: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<boolean>;
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
  };
}
