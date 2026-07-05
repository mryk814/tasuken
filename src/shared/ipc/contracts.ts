import type {
  Entity,
  EntityType,
  SaveOperation,
  SaveOptions,
  SnapshotInspectResult,
  Workspace,
  WorkspaceMeta,
} from "../types/workspace";
import type { MarkdownImageAttachmentRequest, MarkdownImageAttachmentResult } from "../attachments";
import type { MarkdownFileExportRequest, MarkdownFileExportResult, MarkdownPdfExportRequest, MarkdownPdfExportResult } from "../fileExport";
import type { WordExportRequest, WordExportResult } from "../wordExport";

export const IPC = {
  workspaceLoad: "workspace:load",
  workspaceBootstrap: "workspace:bootstrap",
  workspaceMeta: "workspace:meta",
  preferenceGet: "preference:get",
  preferenceSet: "preference:set",
  clipboardWriteText: "clipboard:write-text",
  clipboardWriteHtml: "clipboard:write-html",
  fileOpen: "file:open",
  markdownImageSave: "markdown-image:save",
  appReload: "app:reload",
  appUpdateCheck: "app:update-check",
  appReleasePageOpen: "app:release-page-open",
  entityList: "entity:list",
  entityGet: "entity:get",
  entitySave: "entity:save",
  entitySaveMany: "entity:save-many",
  entityRemove: "entity:remove",
  entityRestore: "entity:restore",
  snapshotExport: "snapshot:export",
  snapshotInspect: "snapshot:inspect",
  snapshotApply: "snapshot:apply",
  noteWordExport: "note:word-export",
  markdownFileExport: "markdown-file:export",
  markdownPdfExport: "markdown-pdf:export",
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
  clipboard: {
    writeText(text: string): Promise<boolean>;
    writeHtml(payload: { html: string; text: string }): Promise<boolean>;
  };
  files: {
    openPath(filePath: string): Promise<{ ok: boolean; error?: string }>;
  };
  attachments: {
    saveMarkdownImage(request: MarkdownImageAttachmentRequest): Promise<MarkdownImageAttachmentResult>;
  };
  app: {
    reload(): Promise<boolean>;
    checkForUpdates(): Promise<AppUpdateCheckResult>;
    openReleasePage(url?: string): Promise<boolean>;
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
  exports: {
    markdownNoteToWord(request: WordExportRequest): Promise<WordExportResult>;
    markdownFile(request: MarkdownFileExportRequest): Promise<MarkdownFileExportResult>;
    markdownPdf(request: MarkdownPdfExportRequest): Promise<MarkdownPdfExportResult>;
  };
}
