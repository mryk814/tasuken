import type {
  Entity,
  EntityType,
  DocumentSaveRequest,
  SaveOperation,
  SaveOptions,
  SnapshotInspectResult,
  Workspace,
  WorkspaceMeta,
} from "../types/workspace";
import type { CanonicalRootStatusMap } from "../types/workspace";
import type { MemoStickyColor, MemoStickyTargetRequest, MemoStickyThemeRequest } from "../memoPresentation";
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
import type {
  AiConnectionTestResult,
  AiFeature,
  AiFeatureAvailability,
  AiModelProfileUpdate,
  AiNoteGenerateRequest,
  AiNoteGenerateResult,
  AiStreamEvent,
  AiProviderConfig,
  AiProviderProfileUpdate,
  AiTestConnectionRequest,
} from "../ai";
import type { CalendarConnectRequest, CalendarConnectionStatus, CalendarDisconnectRequest, CalendarEventsResult } from "../calendar";
import type { WebArtifactExecutionPolicy } from "../webArtifact.mjs";
import type { CommandEnvelope, CommandReceipt } from "../applicationCommand";
import type { ThemePickerOption } from "../themeRef.mjs";
import type { AiContextPreview } from "../aiContextPreview.mjs";
import type { DataHealthIssue, DataHealthResult, DataHealthSeverity } from "../dataHealth.mjs";
import type { AudioCaptureCancelRequest, AudioCaptureCommitRequest, AudioCaptureCommitResult, AudioCapturePrepareRequest, AudioCapturePrepareResult, AudioCapturePrepared, MediaArtifactInspection, MediaArtifactOpenRequest, MediaRecordingAppendRequest, MediaRecordingControlRequest, MediaRecordingProgress, MediaRecordingStarted, MediaRecordingStartRequest, VideoImportCommitRequest, VideoImportCommitResult, VideoImportPrepareRequest, VideoImportPrepareResult, VideoImportPrepared, VideoTrimExportRequest, VideoTrimExportResult, VideoTrimSourceRevision } from "../mediaCapture";
import type { BatchTranscriptionArtifactRequest, BatchTranscriptionCancelRequest, BatchTranscriptionHistoryResult, BatchTranscriptionPreviewResult, BatchTranscriptionRunRequest, BatchTranscriptionRunResult } from "../batchTranscriptionIpc";
import type { ArmedScreenRecordingProjection, ScreenRecordingArmRequest, ScreenRecordingEnvironment, ScreenRecordingSourceProjection } from "../screenRecording.mjs";

/** 録画中インジケータが表示する状態（#383）。pathやsource IDは載せない。 */
export interface RecordingIndicatorState {
  state: "recording" | "paused" | "stopping";
  targetLabel: string;
  elapsedMs: number;
}

export type RecordingIndicatorCommand = "pause" | "resume" | "stop" | "discard";

export const IPC = {
  workspaceLoad: "workspace:load",
  workspaceBootstrap: "workspace:bootstrap",
  workspaceMeta: "workspace:meta",
  activityCanonicalRootStatus: "activity:canonical-root-status",
  activityOpenCanonicalRef: "activity:open-canonical-ref",
  aiContextPreview: "ai-context:preview",
  dataHealthGet: "data-health:get",
  dataHealthSetState: "data-health:set-state",
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
  artifactWebPreview: "artifact:web-preview",
  audioCapturePrepare: "audio-capture:prepare",
  audioCaptureListPrepared: "audio-capture:list-prepared",
  audioCaptureCommit: "audio-capture:commit",
  audioCaptureCancel: "audio-capture:cancel",
  mediaRecordingStart: "media-recording:start",
  mediaRecordingAppend: "media-recording:append",
  mediaRecordingPause: "media-recording:pause",
  mediaRecordingResume: "media-recording:resume",
  mediaRecordingStop: "media-recording:stop",
  screenRecordingCapabilities: "screen-recording:capabilities",
  screenRecordingListSources: "screen-recording:list-sources",
  screenRecordingArm: "screen-recording:arm",
  screenRecordingSelectRegion: "screen-recording:select-region",
  screenRecordingRegionResult: "screen-recording:region-result",
  recordingIndicatorState: "recording-indicator:state",
  recordingIndicatorRequestState: "recording-indicator:request-state",
  recordingIndicatorCommand: "recording-indicator:command",
  recordingIndicatorApply: "recording-indicator:apply",
  videoImportPrepare: "video-import:prepare",
  videoImportListPrepared: "video-import:list-prepared",
  videoImportCommit: "video-import:commit",
  videoImportCancel: "video-import:cancel",
  mediaArtifactOpenExternal: "media-artifact:open-external",
  mediaArtifactInspect: "media-artifact:inspect",
  videoTrimSource: "video-trim:source",
  videoTrimExport: "video-trim:export",
  batchTranscriptionPreview: "batch-transcription:preview",
  batchTranscriptionHistory: "batch-transcription:history",
  batchTranscriptionRun: "batch-transcription:run",
  batchTranscriptionCancel: "batch-transcription:cancel",
  appReload: "app:reload",
  appUpdateCheck: "app:update-check",
  appReleasePageOpen: "app:release-page-open",
  appTitleBarTheme: "app:titlebar-theme",
  appFlushRequested: "app:flush-requested",
  appFlushAck: "app:flush-ack",
  mcpBridgeInfo: "mcp:bridge-info",
  todayMiniShow: "today-mini:show",
  todayMiniToggleWindow: "today-mini:toggle-window",
  todayMiniRefresh: "today-mini:refresh",
  todayMiniPinTopRight: "today-mini:pin-top-right",
  todayMiniHide: "today-mini:hide",
  todayMiniList: "today-mini:list",
  todayMiniThemes: "today-mini:themes",
  todayMiniAddTask: "today-mini:add-task",
  todayMiniToggle: "today-mini:toggle",
  todayMiniOpenTask: "today-mini:open-task",
  memoStickyLoad: "memo-sticky:load",
  memoStickySave: "memo-sticky:save",
  memoStickyCopy: "memo-sticky:copy",
  memoStickyClose: "memo-sticky:close",
  memoStickySetTarget: "memo-sticky:set-target",
  memoStickySetColor: "memo-sticky:set-color",
  memoStickySetTheme: "memo-sticky:set-theme",
  memoStickyThemeChanged: "memo-sticky:theme-changed",
  memoStickyToggleTargetsVisibility: "memo-sticky:toggle-targets-visibility",
  memoStickySetAlwaysOnTop: "memo-sticky:set-always-on-top",
  memoStickyIsAlwaysOnTop: "memo-sticky:is-always-on-top",
  memoStickyOpenInMain: "memo-sticky:open-in-main",
  memoStickyArchive: "memo-sticky:archive",
  memoStickyDelete: "memo-sticky:delete",
  satelliteWindowState: "satellite-window:state",
  entityList: "entity:list",
  entityGet: "entity:get",
  entitySave: "entity:save",
  entitySaveMany: "entity:save-many",
  documentSave: "document:save",
  documentApplyAiProposal: "document:apply-ai-proposal",
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
  aiProviderSave: "ai:provider-save",
  aiProviderDelete: "ai:provider-delete",
  aiModelSave: "ai:model-save",
  aiModelDelete: "ai:model-delete",
  aiDefaultProvider: "ai:default-provider",
  aiDefaultModel: "ai:default-model",
  aiTestConnection: "ai:test-connection",
  aiFeatureAvailability: "ai:feature-availability",
  aiNoteStreamStart: "ai:note-stream-start",
  aiNoteStreamEvent: "ai:note-stream-event",
  aiNoteStreamCancel: "ai:note-stream-cancel",
  calendarStatus: "calendar:status",
  calendarConnect: "calendar:connect",
  calendarDisconnect: "calendar:disconnect",
  calendarEvents: "calendar:events",
  applicationCommand: "application:command",
  applicationCommandBatch: "application:command-batch",
  themeAiPackStatus: "theme-ai-pack:status",
  themeAiPackPreview: "theme-ai-pack:preview",
  themeAiPackPublish: "theme-ai-pack:publish",
  themeAiPackOpenFolder: "theme-ai-pack:open-folder",
  themeAiPackChanged: "theme-ai-pack:changed",
  conversationContextPreview: "conversation-context:preview",
  conversationContextPublish: "conversation-context:publish",
  conversationContextRemove: "conversation-context:remove",
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
  noteWindowFlushRequested: "note-window:flush-requested",
  noteWindowFlushAck: "note-window:flush-ack",
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
  /** 付箋autosaveのresponseより先に届く自己通知をrequestへ束縛する。 */
  memoStickySave?: MemoStickySaveSource;
}

export interface RendererFlushRequest {
  requestId: string;
  noteId?: string;
}

export interface RendererFlushAck {
  requestId: string;
  ok: boolean;
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
  alwaysOnTopMemoIds: string[];
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

export type ThemeAiPackState =
  | "loading"
  | "missing"
  | "dirty"
  | "current"
  | "skipped"
  | "current_with_warning"
  | "stale_preview"
  | "publishing"
  | "failed_retryable"
  | "recovery_required"
  | "needs_root"
  | "root_unavailable"
  | "identity_conflict";

export interface ThemeAiPackPreviewFile {
  name: string;
  content: string;
  includedCount: number;
  characterCount: number;
}

export interface ThemeAiPackPreviewResult {
  themeId: string;
  contentHash: string;
  plannedGeneratedAt: string;
  lastPublishedAt: string;
  sourceRevision: string | null;
  state: ThemeAiPackState;
  dirty: boolean;
  retryPending: boolean;
  locationStatus: string;
  canOpenFolder: boolean;
  files: ThemeAiPackPreviewFile[];
  includedCount: number;
  excludedCount: number;
  excludedReasons: Array<{ type: string; reason: string; count: number }>;
  warnings: Array<{ kind: "stale" | "superseded"; type: string; id: string; title: string; reason: string }>;
  totalCharacterCount: number;
  error?: string;
}

export interface ThemeAiPackStatusResult extends Omit<ThemeAiPackPreviewResult, "files" | "warnings" | "excludedReasons"> {
  fileCount: number;
  warningCount: number;
}

export interface ThemeAiPackPublishRequest {
  themeId: string;
  expectedContentHash: string;
}

export interface ThemeAiPackPublishResult {
  themeId: string;
  contentHash?: string;
  state: ThemeAiPackState;
  dirty: boolean;
  retryPending: boolean;
  written: boolean;
  lastPublishedAt?: string;
  error?: string;
  warning?: string;
}

export interface ThemeAiPackChangedPayload {
  themeId: string;
  contentHash?: string;
  state: ThemeAiPackState;
  dirty: boolean;
}

export type AiContextPreviewAudience = "m365" | "coding_agent";
export type AiContextPreviewScope = { type: "theme" | "task"; id: string };

export interface AiContextPreviewRequest {
  audience: AiContextPreviewAudience;
  scope: AiContextPreviewScope;
}

export interface AiContextPreviewResult {
  state: "ready" | "empty" | "error";
  requestedScope: AiContextPreviewScope;
  effectiveScope: AiContextPreviewScope;
  producer: "theme_ai_pack" | "mcp_task_context" | "mcp_theme_context";
  preview: AiContextPreview | null;
  includedInEffectiveScope: boolean | null;
  error?: string;
}

export interface DataHealthQuery {
  themeId?: string;
  entityType?: string;
  severity?: DataHealthSeverity;
  state?: "open" | "ignored" | "resolved" | "all";
}

export interface DataHealthQueryResult extends Omit<DataHealthResult, "issues"> {
  issues: DataHealthIssue[];
  totalIssueCount: number;
}

export interface DataHealthStateUpdateRequest {
  issueId: string;
  state: "open" | "ignored" | "resolved";
  expectedRevision: number;
  note?: string;
}

export type ConversationContextScope = "full" | "selected_turns";

export interface ConversationContextPreviewRequest {
  conversationId: string;
  scope?: ConversationContextScope;
  selectedMessageIndexes?: number[];
}

export interface ConversationContextPreviewResult {
  conversationId: string;
  themeId: string;
  storageRootId: string;
  relativePath: string;
  plannedPublishedAt: string;
  scope: ConversationContextScope;
  selectedMessageIndexes: number[];
  messageCount: number;
  sourceMessageCount: number;
  publicationState: string;
  dirty: boolean;
  allowed: boolean;
  locationStatus: string;
  content: string;
  contentHash: string;
  sourceRevision: string;
  exclusions: Array<{ kind: string; message_index: number; role: string }>;
  warnings: string[];
  blockingReasons: string[];
  sourceUrl: string;
  theme: { id: string; title: string };
  summary: string;
  freshness: string;
  authority: string;
  aiVisibility: string[];
}

export interface ConversationContextPublishRequest extends ConversationContextPreviewRequest {
  scope: ConversationContextScope;
  selectedMessageIndexes: number[];
  expectedContentHash: string;
  plannedPublishedAt: string;
}

export interface ConversationContextPublishResult {
  conversationId: string;
  themeId: string;
  publicationState: string;
  dirty: boolean;
  written: boolean;
  contentHash?: string;
  themePackState?: string;
  error?: string;
  warning?: string;
}

export interface ConversationContextRemoveRequest {
  conversationId: string;
}

export interface ConversationContextRemoveResult {
  conversationId: string;
  themeId: string;
  publicationState: string;
  removed: boolean;
  themePackState?: string;
  warning?: string;
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

/** Web Artifact専用。RendererへOS pathを返さず、Artifact IDで本文だけを読む。 */
export type WebArtifactPreviewResult =
  | { ok: true; url: string; mimeType: "text/html"; executionPolicy: WebArtifactExecutionPolicy }
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
  aiContext: {
    preview(request: AiContextPreviewRequest): Promise<AiContextPreviewResult>;
  };
  dataHealth: {
    get(query?: DataHealthQuery): Promise<DataHealthQueryResult>;
    setState(request: DataHealthStateUpdateRequest): Promise<DataHealthQueryResult>;
  };
  themeAiPack: {
    status(themeId: string): Promise<ThemeAiPackStatusResult>;
    preview(themeId: string): Promise<ThemeAiPackPreviewResult>;
    publish(request: ThemeAiPackPublishRequest): Promise<ThemeAiPackPublishResult>;
    openFolder(themeId: string): Promise<{ ok: boolean; error?: string }>;
    onChanged(callback: (change: ThemeAiPackChangedPayload) => void): () => void;
  };
  conversationContext: {
    preview(request: ConversationContextPreviewRequest): Promise<ConversationContextPreviewResult>;
    publish(request: ConversationContextPublishRequest): Promise<ConversationContextPublishResult>;
    remove(request: ConversationContextRemoveRequest): Promise<ConversationContextRemoveResult>;
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
    saveProviderProfile(update: AiProviderProfileUpdate): Promise<AiProviderConfig>;
    deleteProviderProfile(id: string): Promise<AiProviderConfig>;
    saveModelProfile(update: AiModelProfileUpdate): Promise<AiProviderConfig>;
    deleteModelProfile(id: string): Promise<AiProviderConfig>;
    setDefaultProviderProfile(id: string): Promise<AiProviderConfig>;
    setDefaultModelProfile(id: string): Promise<AiProviderConfig>;
    testConnection(request: AiTestConnectionRequest): Promise<AiConnectionTestResult>;
    featureAvailability(feature: AiFeature, providerProfileId?: string, modelProfileId?: string): Promise<AiFeatureAvailability>;
    startNoteStream(requestId: string, request: AiNoteGenerateRequest): Promise<AiNoteGenerateResult>;
    cancelNoteStream(requestId: string): Promise<boolean>;
    onNoteStreamEvent(callback: (requestId: string, event: AiStreamEvent) => void): () => void;
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
  artifacts: {
    readWebPreview(artifactId: string): Promise<WebArtifactPreviewResult>;
  };
  mediaCapture: {
    prepareAudio(request: AudioCapturePrepareRequest): Promise<AudioCapturePrepareResult>;
    listPreparedAudio(): Promise<AudioCapturePrepared[]>;
    commitAudio(request: AudioCaptureCommitRequest): Promise<AudioCaptureCommitResult>;
    cancelAudio(request: AudioCaptureCancelRequest): Promise<boolean>;
    startRecording(request: MediaRecordingStartRequest): Promise<MediaRecordingStarted>;
    appendRecording(request: MediaRecordingAppendRequest): Promise<MediaRecordingProgress>;
    pauseRecording(request: MediaRecordingControlRequest): Promise<MediaRecordingProgress>;
    resumeRecording(request: MediaRecordingControlRequest): Promise<MediaRecordingProgress>;
    stopRecording(request: MediaRecordingControlRequest): Promise<AudioCapturePrepared | VideoImportPrepared>;
    prepareVideo(request: VideoImportPrepareRequest): Promise<VideoImportPrepareResult>;
    listPreparedVideo(): Promise<VideoImportPrepared[]>;
    commitVideo(request: VideoImportCommitRequest): Promise<VideoImportCommitResult>;
    cancelVideo(request: AudioCaptureCancelRequest): Promise<boolean>;
    openArtifactExternal(request: MediaArtifactOpenRequest): Promise<{ ok: boolean; error?: string }>;
    inspectArtifact(request: MediaArtifactOpenRequest): Promise<MediaArtifactInspection>;
    getVideoTrimSource(request: MediaArtifactOpenRequest): Promise<VideoTrimSourceRevision>;
    exportVideoTrim(request: VideoTrimExportRequest): Promise<VideoTrimExportResult>;
  };
  batchTranscription: {
    preview(request: BatchTranscriptionArtifactRequest): Promise<BatchTranscriptionPreviewResult>;
    history(request: BatchTranscriptionArtifactRequest): Promise<BatchTranscriptionHistoryResult>;
    run(request: BatchTranscriptionRunRequest): Promise<BatchTranscriptionRunResult>;
    cancel(request: BatchTranscriptionCancelRequest): Promise<BatchTranscriptionRunResult>;
  };
  screenRecording: {
    capabilities(): Promise<ScreenRecordingEnvironment>;
    listSources(): Promise<readonly Readonly<ScreenRecordingSourceProjection>[]>;
    arm(request: ScreenRecordingArmRequest): Promise<ArmedScreenRecordingProjection>;
    selectRegion(request: { sourceToken: string }): Promise<import("../screenRecording.mjs").ScreenRecordingRegionSelection | null>;
    applyIndicator(state: RecordingIndicatorState | null): Promise<boolean>;
    onIndicatorCommand(callback: (command: RecordingIndicatorCommand) => void): () => void;
  };
  app: {
    reload(): Promise<boolean>;
    checkForUpdates(): Promise<AppUpdateCheckResult>;
    openReleasePage(url?: string): Promise<boolean>;
    setTitleBarTheme(theme: "light" | "dark"): Promise<boolean>;
    onAppFlushRequested(callback: (request: RendererFlushRequest) => void): () => void;
    ackAppFlush(requestId: string, ok: boolean): Promise<boolean>;
    getMcpBridgeInfo(): Promise<McpBridgeInfo>;
    showTodayMiniWindow(): Promise<boolean>;
    toggleTodayMiniWindow(): Promise<boolean>;
    /** A=付箋表示対象をdesired stateで保存し、B=window表示をMainで調停する（#377）。 */
    setMemoStickyTarget(request: MemoStickyTargetRequest): Promise<MemoStickyTargetResult>;
    toggleMemoStickyTargetsVisibility(): Promise<MemoStickyVisibilityResult>;
    setMemoStickyTheme(request: MemoStickyThemeRequest): Promise<boolean>;
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
    onNoteWindowFlushRequested(callback: (request: RendererFlushRequest) => void): () => void;
    ackNoteWindowFlush(requestId: string, ok: boolean): Promise<boolean>;
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
  documents: {
    /** Note / Report本文の保存とcanonical Markdown更新を同じuse caseで行う。 */
    save(request: DocumentSaveRequest): Promise<Entity>;
    applyAiProposal(request: DocumentSaveRequest, envelope: CommandEnvelope): Promise<CommandReceipt>;
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
  version: number;
  target: boolean;
  color: MemoStickyColor;
  theme: "light" | "dark";
}

export interface MemoStickyTargetResult {
  status: "applied" | "not_found" | "flush_failed";
  target: boolean;
  visible: boolean;
  content: MemoStickyContent | null;
}

export interface MemoStickyVisibilityResult {
  status: "shown" | "hidden" | "empty" | "flush_failed";
  targetCount: number;
  visibleCount: number;
}

export interface MemoStickyColorResult {
  status: "applied" | "not_found" | "flush_failed";
  content: MemoStickyContent | null;
}

export interface MemoStickySaveRequest {
  text: string;
  editRevision: number;
  expectedVersion: number;
  saveRequestId: string;
}

export interface MemoStickySaveSource {
  kind: "memo_sticky_save";
  saveRequestId: string;
  editRevision: number;
}

export type MemoStickySaveResult = {
  status: "saved" | "conflict";
  editRevision: number;
  saveRequestId: string;
  content: MemoStickyContent;
};
