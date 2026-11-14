export interface CapturedTaskFocusRequest {
  requestId: string;
  taskId: string;
}
export interface CapturedTaskSubmission {
  id: string;
  issuedAt: string;
}
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
import type { ActivityEventsQuery, CanonicalRootStatusMap } from "../types/workspace";
import type {
  MemoStickyColor,
  MemoStickyTargetRequest,
  MemoStickyThemeRequest,
} from "../memoPresentation";
import type {
  ArtifactFileImportRequest,
  ArtifactFileImportResult,
  MarkdownImageAttachmentRequest,
  MarkdownImageAttachmentResult,
} from "../attachments";
import type {
  MarkdownFileExportRequest,
  MarkdownFileExportResult,
  MarkdownPdfExportRequest,
  MarkdownPdfExportResult,
} from "../fileExport";
import type { SketchExportRequest, SketchExportResult } from "../sketchExport";
import type {
  MermaidPowerPointPptxExportRequest,
  MermaidPowerPointPptxExportResult,
  MermaidPowerPointSvgExportRequest,
  MermaidPowerPointSvgExportResult,
  MermaidSvgClipboardRequest,
  MermaidSvgClipboardResult,
} from "../mermaidPowerPoint";
import type {
  ImageClipboardRequest,
  SlideTimelineExportRequest,
  SlideTimelineExportResult,
} from "../slideTimelineExport";
import type {
  CalendarConnectRequest,
  CalendarConnectionStatus,
  CalendarDisconnectRequest,
  CalendarEventsResult,
} from "../calendar";
import type { WebArtifactExecutionPolicy } from "../webArtifact.mjs";
import type { CommandEnvelope, CommandReceipt } from "../applicationCommand";
import type { AiContextPreview } from "../aiContextPreview.mjs";
import type { DataHealthIssue, DataHealthResult, DataHealthSeverity } from "../dataHealth.mjs";
import type {
  AudioCaptureCancelRequest,
  AudioCaptureCommitRequest,
  AudioCaptureCommitResult,
  AudioCapturePrepareRequest,
  AudioCapturePrepareResult,
  AudioCapturePrepared,
  MediaArtifactInspection,
  MediaArtifactOpenRequest,
  MediaRecordingAppendRequest,
  MediaRecordingControlRequest,
  MediaRecordingProgress,
  MediaRecordingStarted,
  MediaRecordingStartRequest,
  VideoImportCommitRequest,
  VideoImportCommitResult,
  VideoImportPrepareRequest,
  VideoImportPrepareResult,
  VideoImportPrepared,
  VideoTrimExportRequest,
  VideoTrimExportResult,
  VideoTrimSourceRevision,
} from "../mediaCapture";
import type {
  BatchTranscriptionArtifactRequest,
  BatchTranscriptionHistoryResult,
} from "../batchTranscriptionIpc";
import type {
  ArmedScreenRecordingProjection,
  ScreenRecordingArmRequest,
  ScreenRecordingEnvironment,
  ScreenRecordingRegionSelection,
  ScreenRecordingSourceProjection,
} from "../screenRecording.mjs";
import { LEGACY_TASK_IPC_CHANNELS } from "../compatibility/taskIpc.ts";
import type { TaskCapability } from "../contracts/task/public.ts";
import type {
  MobileGatewayDiagnostics,
  MobileGatewayDevice,
  MobileGatewayPairingTicket,
} from "../mobileGatewayIpc.ts";

/** 録画中インジケータが表示する状態（#383）。pathやsource IDは載せない。 */
export interface RecordingIndicatorState {
  state: "recording" | "paused" | "stopping";
  targetLabel: string;
  elapsedMs: number;
  /** Tasken自身をwindow録画するときだけ、本体を最小化しない。 */
  keepMainWindowVisible?: boolean;
}

export type RecordingIndicatorCommand = "pause" | "resume" | "stop" | "discard";

export const IPC = {
  workspaceLoad: "workspace:load",
  agentWorkLogImport: "agent-work-log:import",
  agentLogSetup: "agent-log:setup",
  agentLogProbe: "agent-log:probe",
  agentLogConfigure: "agent-log:configure",
  agentLogRemove: "agent-log:remove",
  agentLogBackground: "agent-log:background",
  agentLogSync: "agent-log:sync",
  agentLogCancel: "agent-log:cancel",
  workspaceBootstrap: "workspace:bootstrap",
  workspaceMeta: "workspace:meta",
  mobileGatewayDiagnostics: "mobile-gateway:diagnostics",
  captureOrganizerGetSettings: "capture-organizer:get-settings",
  captureOrganizerSaveSettings: "capture-organizer:save-settings",
  captureOrganizerTestConnection: "capture-organizer:test-connection",
  captureOrganizerClearSettings: "capture-organizer:clear-settings",
  captureOrganizerChatGptState: "capture-organizer:chatgpt-state",
  captureOrganizerChatGptConnect: "capture-organizer:chatgpt-connect",
  captureOrganizerChatGptCancel: "capture-organizer:chatgpt-cancel",
  captureOrganizerChatGptDisconnect: "capture-organizer:chatgpt-disconnect",
  captureOrganizerChatGptModels: "capture-organizer:chatgpt-models",
  captureOrganizerOpenSaved: "capture-organizer:open-saved",
  taskSchedulePropose: "task-schedule:propose",
  mobileGatewayIssuePairing: "mobile-gateway:issue-pairing",
  mobileGatewayCancelPairing: "mobile-gateway:cancel-pairing",
  mobileGatewayRevokeDevice: "mobile-gateway:revoke-device",
  taskCommand: LEGACY_TASK_IPC_CHANNELS.command,
  taskQuery: LEGACY_TASK_IPC_CHANNELS.query,
  taskChanged: LEGACY_TASK_IPC_CHANNELS.changed,
  activityCanonicalRootStatus: "activity:canonical-root-status",
  activityEvents: "activity:events",
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
  clipboardWriteRecordCounts: "clipboard:write-record-counts",
  fileOpen: "file:open",
  fileShowInFolder: "file:show-in-folder",
  filePathExists: "file:path-exists",
  fileReadPreview: "file:read-preview",
  dialogChooseDirectory: "dialog:choose-directory",
  dialogChooseFiles: "dialog:choose-files",
  markdownImageSave: "markdown-image:save",
  artifactFilesImport: "artifact:files-import",
  artifactWebPreview: "artifact:web-preview",
  feedLinkPreview: "feed:link-preview",
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
  screenRecordingRegionIndicatorApply: "screen-recording:region-indicator-apply",
  recordingIndicatorState: "recording-indicator:state",
  recordingIndicatorRequestState: "recording-indicator:request-state",
  recordingIndicatorCommand: "recording-indicator:command",
  recordingIndicatorSetRetracted: "recording-indicator:set-retracted",
  recordingIndicatorApply: "recording-indicator:apply",
  videoImportPrepare: "video-import:prepare",
  videoImportListPrepared: "video-import:list-prepared",
  videoImportCommit: "video-import:commit",
  videoImportCancel: "video-import:cancel",
  mediaArtifactOpenExternal: "media-artifact:open-external",
  mediaArtifactInspect: "media-artifact:inspect",
  videoTrimSource: "video-trim:source",
  videoTrimExport: "video-trim:export",
  batchTranscriptionHistory: "batch-transcription:history",
  appReload: "app:reload",
  appUpdateCheck: "app:update-check",
  appReleasePageOpen: "app:release-page-open",
  appTitleBarTheme: "app:titlebar-theme",
  appFlushRequested: "app:flush-requested",
  appFlushAck: "app:flush-ack",
  appPerformanceDiagnosticsEnabled: "app:performance-diagnostics-enabled",
  appPerformanceReport: "app:performance-report",
  mcpBridgeInfo: "mcp:bridge-info",
  memoStickyLoad: "memo-sticky:load",
  memoStickyCreate: "memo-sticky:create",
  memoStickySave: "memo-sticky:save",
  memoStickyCopy: "memo-sticky:copy",
  memoStickyClose: "memo-sticky:close",
  memoStickyMinimize: "memo-sticky:minimize",
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
  aiItemSeen: "ai-item:seen",
  aiDirectUndo: "ai-direct:undo",
  documentSave: "document:save",
  workLogRecord: "work-log:record",
  entityRemove: "entity:remove",
  entityRestore: "entity:restore",
  snapshotInspect: "snapshot:inspect",
  snapshotApply: "snapshot:apply",
  automaticSnapshotStatus: "automatic-snapshot:status",
  automaticSnapshotConfigure: "automatic-snapshot:configure",
  automaticSnapshotRun: "automatic-snapshot:run",
  backupList: "backup:list",
  backupChooseFile: "backup:choose-file",
  backupPreview: "backup:preview",
  backupRestore: "backup:restore",
  backupLastRestore: "backup:last-restore",
  backupDismissLastRestore: "backup:dismiss-last-restore",
  sharedSyncStatus: "shared-sync:status",
  sharedSyncConfigure: "shared-sync:configure",
  sharedSyncDisable: "shared-sync:disable",
  sharedSyncNow: "shared-sync:now",
  sharedSyncRepublish: "shared-sync:republish",
  sharedSyncResolve: "shared-sync:resolve",
  markdownFileExport: "markdown-file:export",
  markdownPdfExport: "markdown-pdf:export",
  sketchExport: "sketch:export",
  slideTimelineExport: "slide-timeline:export",
  mermaidSvgExport: "mermaid:svg-export",
  mermaidPptxExport: "mermaid:pptx-export",
  calendarStatus: "calendar:status",
  calendarConnect: "calendar:connect",
  calendarDisconnect: "calendar:disconnect",
  calendarEvents: "calendar:events",
  applicationCommand: "application:command",
  applicationCommandBatch: "application:command-batch",
  conversationContextPreview: "conversation-context:preview",
  conversationContextPublish: "conversation-context:publish",
  conversationContextRemove: "conversation-context:remove",
  workspaceChanged: "workspace:changed",
  quickCaptureSave: "quick-capture:save",
  quickCaptureFocus: "quick-capture:focus",
  capturedTaskFocusOpen: "workspace:captured-task-focus-open",
  capturedTaskFocusResult: "workspace:captured-task-focus-result",
  quickCapturePreviewDue: "quick-capture:preview-due",
  quickCaptureOrganize: "quick-capture:organize",
  quickCaptureOpenTask: "quick-capture:open-task",
  quickCaptureExternalPrompt: "quick-capture:external-prompt",
  quickCaptureExternalImport: "quick-capture:external-import",
  quickCaptureResize: "quick-capture:resize",
  quickCaptureHide: "quick-capture:hide",
  quickCaptureShown: "quick-capture:shown",
  quickCaptureHidden: "quick-capture:hidden",
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

/** 固定kindと数値だけ。操作内容や画面の文字列は載せない（#481）。 */
export interface RendererPerformanceReport {
  kind: "long_task" | "event_loop_lag";
  duration_ms: number;
  heap_used_mb?: number;
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

export interface SatelliteWindowStatePayload {
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

export type McpCoreWriteProfile =
  | "start-only"
  | "proposals-and-start"
  | "create-and-start"
  | "full"
  | "proposals"
  | "read-only"
  | "partial"
  | "create-only"
  | "unknown";

/**
 * 本人が設定（AI & Context）で、ローカルのAI（Claude Codeなど）に直接の書き込みを許したか。
 * 既定は無効。Desktop Coreは要求のたびにこの値を読む（切り替えてもCoreを作り直さない）。
 */
export const AI_DIRECT_WRITE_PREFERENCE = "aiDirectWriteEnabled";

export interface McpBridgeInfo {
  command: string;
  args: string[];
  configJson: string;
  pendingProposalCount: number;
  transport: "stdio-core";
  packaged: boolean;
  coreStatus: "available" | "unavailable" | "unknown";
  coreApiVersion?: string;
  coreCapabilityCount?: number;
  /** Coreの書き込み公開範囲。Core停止時は unknown。 */
  coreWriteProfile?: McpCoreWriteProfile;
  coreErrorCode?: string;
  coreErrorMessage?: string;
  coreNextAction?: string;
  latestProposalId?: string;
  latestProposalAt?: string;
}

export function createMcpBridgeInfo(input: {
  args: string[];
  pendingProposalCount: number;
  packaged: boolean;
  coreStatus?: McpBridgeInfo["coreStatus"];
  coreApiVersion?: string;
  coreCapabilityCount?: number;
  coreWriteProfile?: McpCoreWriteProfile;
  coreErrorCode?: string;
  coreErrorMessage?: string;
  coreNextAction?: string;
  latestProposalId?: string;
  latestProposalAt?: string;
}): McpBridgeInfo {
  const command = "node";
  const server = {
    command,
    args: input.args,
    // Packaged settings must not inherit a development profile from the AI client.
    // An empty override keeps the config portable and lets each Windows account
    // resolve its own default `%APPDATA%/tasken` profile.
    ...(input.packaged ? { env: { TASKEN_USER_DATA_DIR: "" } } : {}),
  };
  return {
    command,
    args: [...input.args],
    configJson: JSON.stringify({ mcpServers: { tasken: server } }, null, 2),
    pendingProposalCount: input.pendingProposalCount,
    transport: "stdio-core",
    packaged: input.packaged,
    coreStatus: input.coreStatus || "unknown",
    ...(input.coreApiVersion ? { coreApiVersion: input.coreApiVersion } : {}),
    ...(input.coreCapabilityCount === undefined
      ? {}
      : { coreCapabilityCount: input.coreCapabilityCount }),
    ...(input.coreWriteProfile ? { coreWriteProfile: input.coreWriteProfile } : {}),
    ...(input.coreErrorCode ? { coreErrorCode: input.coreErrorCode } : {}),
    ...(input.coreErrorMessage ? { coreErrorMessage: input.coreErrorMessage } : {}),
    ...(input.coreNextAction ? { coreNextAction: input.coreNextAction } : {}),
    ...(input.latestProposalId ? { latestProposalId: input.latestProposalId } : {}),
    ...(input.latestProposalAt ? { latestProposalAt: input.latestProposalAt } : {}),
  };
}

export async function copyMcpBridgeConfig(
  copyText: (text: string) => Promise<boolean>,
  info: McpBridgeInfo,
): Promise<void> {
  await copyText(info.configJson);
}

export type AiContextPreviewChannel = "mcp";
export type AiContextPreviewScope = { type: "task"; id: string };

export interface AiContextPreviewRequest {
  channel: AiContextPreviewChannel;
  scope: AiContextPreviewScope;
}

export interface AiContextPreviewResult {
  state: "ready" | "empty" | "error";
  requestedScope: AiContextPreviewScope;
  effectiveScope: AiContextPreviewScope;
  producer: "mcp_task_context";
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
  waitingFor: { deviceId: string; sequence: number } | null;
  waitingImage: { deviceId: string; fileName: string } | null;
  lastAutoRepublished: number;
}

export interface SharedSyncRepublishResult {
  republished: number;
  status: SharedSyncStatus;
}

export interface AutomaticSnapshotBackupConfig {
  enabled: boolean;
  directory: string;
  generations: number;
}

export interface AutomaticSnapshotBackupStatus extends AutomaticSnapshotBackupConfig {
  lastAttemptAt: string;
  lastSuccessAt: string;
  latestFilePath: string;
  backupCount: number;
  lastError: string;
  skippedReason: string;
}

/** 保存先にある控え1つ。場所はMainが持ち、Rendererは札（token）で指す。 */
export interface WorkspaceBackupEntry {
  token: string;
  fileName: string;
  createdAt: string;
  sizeBytes: number;
  /** auto: 自動または「控えを今すぐ作る」。before-restore: 戻す前に自動で作った控え。 */
  kind: "auto" | "before-restore";
}

export interface WorkspaceBackupList {
  directory: string;
  backups: WorkspaceBackupEntry[];
}

/** 戻す前に本人へ見せる、控えの中身と今の比較。 */
export interface WorkspaceRestorePreview {
  token: string;
  filePath: string;
  createdAt: string;
  sizeBytes: number;
  entityCount: number;
  currentEntityCount: number;
  /** 別の作業台（作り直したDBや別の端末）の控えなら false。 */
  sameWorkspace: boolean;
  /** 控えの隣に画像と写真の写しがあるか。 */
  attachmentsInBackup: boolean;
  /** 今、端末間同期が有効か。戻すと止まる。 */
  syncEnabled: boolean;
}

export type WorkspaceRestoreChoice =
  { canceled: true } | { canceled: false; preview: WorkspaceRestorePreview };

/** 前回の「控えから戻す」の結果。起動し直した後に本人へ見せる。 */
export interface WorkspaceRestoreOutcome {
  status: "restored" | "failed";
  at: string;
  sourcePath: string;
  entityCount: number;
  /** 戻す前のDBの控え。空の作業台から戻した時は ""。 */
  previousBackupPath: string;
  syncStopped: boolean;
  attachmentsRestored: number;
  attachmentsInBackup: boolean;
  /** 失敗の理由（本人向け）。失敗した時、データは戻す前のまま。 */
  error: string;
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

/** Feedの外部リンクPreview。Mainが取得した派生キャッシュで、正本データではない。 */
export interface FeedLinkPreviewRequest {
  url: string;
}

/** 画像は`attachments/link-previews`配下のファイル名だけを返し、OS pathは渡さない。 */
export interface FeedLinkPreview {
  url: string;
  title: string;
  description: string;
  siteName: string;
  imageFileName: string | null;
}

export type FeedLinkPreviewResult =
  { ok: true; preview: FeedLinkPreview } | { ok: false; reason: string };

export interface ResearchDeskApi {
  openTaskCapture(mode?: "today-task" | "feed"): Promise<void>;
  captureOrganizer: {
    openSaved(captureId: string, version: number): Promise<void>;
    proposeTaskSchedule(
      input: import("../taskScheduleProposal.ts").TaskScheduleProposalRequest,
    ): Promise<import("../taskScheduleProposal.ts").TaskScheduleProposal>;
    getSettings(): Promise<import("../captureOrganizerSettings.ts").CaptureOrganizerSettingsState>;
    saveSettings(
      input: import("../captureOrganizerSettings.ts").CaptureOrganizerSettingsInput,
    ): Promise<import("../captureOrganizerSettings.ts").CaptureOrganizerSettingsState>;
    testConnection(
      input: import("../captureOrganizerSettings.ts").CaptureOrganizerSettingsInput,
    ): Promise<import("../captureOrganizerSettings.ts").CaptureOrganizerConnectionResult>;
    clearSettings(): Promise<
      import("../captureOrganizerSettings.ts").CaptureOrganizerSettingsState
    >;
    chatGptState(): Promise<import("../captureOrganizerSettings.ts").ChatGptAccountState>;
    chatGptConnect(): Promise<import("../captureOrganizerSettings.ts").ChatGptAccountState>;
    chatGptCancel(): Promise<void>;
    chatGptDisconnect(): Promise<import("../captureOrganizerSettings.ts").ChatGptAccountState>;
    chatGptModels(): Promise<import("../captureOrganizerSettings.ts").ChatGptModelOption[]>;
  };
  workspace: {
    load(): Promise<Workspace>;
    bootstrap(legacy: Workspace): Promise<Workspace>;
    getMeta(): Promise<WorkspaceMeta>;
  };
  agentWorkLogs: {
    setup(): Promise<import("../agentLogSync").AgentLogSetup>;
    probe(
      service: import("../agentLogSync").AgentLogService,
      path: string,
    ): Promise<import("../agentLogSync").AgentLogProbe>;
    configure(
      input: import("../agentLogSync").AgentLogSourceConfig,
    ): Promise<import("../agentLogSync").AgentLogSyncStatus>;
    remove(id: string): Promise<import("../agentLogSync").AgentLogSyncStatus>;
    background(enabled: boolean): Promise<import("../agentLogSync").AgentLogSyncStatus>;
    sync(): Promise<import("../agentLogSync").AgentLogSyncStatus>;
    cancel(): Promise<import("../agentLogSync").AgentLogSyncStatus>;
    import(
      raw: string,
      repositoryContextIds: string[],
    ): Promise<import("../contracts/task/public").ProposeAgentSessionResponse>;
  };
  mobileGateway: {
    diagnostics(): Promise<MobileGatewayDiagnostics>;
    issuePairing(): Promise<MobileGatewayPairingTicket>;
    cancelPairing(): Promise<boolean>;
    revokeDevice(deviceId: string): Promise<MobileGatewayDevice | null>;
  };
  task: TaskCapability;
  activity: {
    getCanonicalRootStatus(): Promise<CanonicalRootStatusMap>;
    /** 来歴を範囲で読む。workspace.load() は来歴を載せない（#755 束0b）。 */
    events(query: ActivityEventsQuery): Promise<Entity[]>;
    openCanonicalRef(ref: Record<string, unknown>): Promise<{ ok: boolean; error?: string }>;
  };
  aiContext: {
    preview(request: AiContextPreviewRequest): Promise<AiContextPreviewResult>;
  };
  dataHealth: {
    get(query?: DataHealthQuery): Promise<DataHealthQueryResult>;
    setState(request: DataHealthStateUpdateRequest): Promise<DataHealthQueryResult>;
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
    setView(
      id: string,
      scopeKey: string,
      value: unknown,
      schemaVersion: number,
    ): Promise<ViewPreferenceChange>;
    onViewChanged(callback: (change: ViewPreferenceChange) => void): () => void;
  };
  clipboard: {
    writeText(text: string): Promise<boolean>;
    writeHtml(payload: { html: string; text: string }): Promise<boolean>;
    writeImage(payload: ImageClipboardRequest): Promise<boolean>;
    writeSvg(payload: MermaidSvgClipboardRequest): Promise<MermaidSvgClipboardResult>;
    writeRecordCounts(): Promise<boolean>;
  };
  files: {
    openPath(filePath: string): Promise<{ ok: boolean; error?: string }>;
    showItemInFolder(filePath: string): Promise<{ ok: boolean; error?: string }>;
    pathExists(
      filePath: string,
    ): Promise<{ exists: boolean; kind: "url" | "path"; error?: string }>;
    /** アプリ内ビューア用。ローカル画像は data URL、Markdown/テキストは本文を返す。 */
    readPreview(filePath: string): Promise<FilePreviewReadResult>;
    // DOMのFileからOSパスを取り出す（Preloadのelectron.webUtils経由。同期）。
    pathForFile(file: File): string;
  };
  dialogs: {
    chooseDirectory(title?: string): Promise<{ canceled: boolean; path?: string }>;
    chooseFiles(
      title?: string,
    ): Promise<{ canceled: boolean; files?: Array<{ path: string; name: string }> }>;
  };
  attachments: {
    saveMarkdownImage(
      request: MarkdownImageAttachmentRequest,
    ): Promise<MarkdownImageAttachmentResult>;
    importArtifactFiles(request: ArtifactFileImportRequest): Promise<ArtifactFileImportResult>;
  };
  artifacts: {
    readWebPreview(artifactId: string): Promise<WebArtifactPreviewResult>;
  };
  feedLinkPreview: {
    fetchPreview(request: FeedLinkPreviewRequest): Promise<FeedLinkPreviewResult>;
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
    stopRecording(
      request: MediaRecordingControlRequest,
    ): Promise<AudioCapturePrepared | VideoImportPrepared>;
    prepareVideo(request: VideoImportPrepareRequest): Promise<VideoImportPrepareResult>;
    listPreparedVideo(): Promise<VideoImportPrepared[]>;
    commitVideo(request: VideoImportCommitRequest): Promise<VideoImportCommitResult>;
    cancelVideo(request: AudioCaptureCancelRequest): Promise<boolean>;
    openArtifactExternal(
      request: MediaArtifactOpenRequest,
    ): Promise<{ ok: boolean; error?: string }>;
    inspectArtifact(request: MediaArtifactOpenRequest): Promise<MediaArtifactInspection>;
    getVideoTrimSource(request: MediaArtifactOpenRequest): Promise<VideoTrimSourceRevision>;
    exportVideoTrim(request: VideoTrimExportRequest): Promise<VideoTrimExportResult>;
  };
  batchTranscription: {
    history(request: BatchTranscriptionArtifactRequest): Promise<BatchTranscriptionHistoryResult>;
  };
  screenRecording: {
    capabilities(): Promise<ScreenRecordingEnvironment>;
    listSources(): Promise<readonly Readonly<ScreenRecordingSourceProjection>[]>;
    arm(request: ScreenRecordingArmRequest): Promise<ArmedScreenRecordingProjection>;
    selectRegion(request: {
      sourceToken: string;
    }): Promise<import("../screenRecording.mjs").ScreenRecordingRegionSelection | null>;
    applyRegionIndicator(region: ScreenRecordingRegionSelection | null): Promise<boolean>;
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
    performanceDiagnosticsEnabled(): Promise<boolean>;
    reportPerformance(report: RendererPerformanceReport): void;
    getMcpBridgeInfo(): Promise<McpBridgeInfo>;
    /** A=付箋表示対象をdesired stateで保存し、B=window表示をMainで調停する（#377）。 */
    setMemoStickyTarget(request: MemoStickyTargetRequest): Promise<MemoStickyTargetResult>;
    toggleMemoStickyTargetsVisibility(): Promise<MemoStickyVisibilityResult>;
    setMemoStickyTheme(request: MemoStickyThemeRequest): Promise<boolean>;
    getSatelliteWindowState(): Promise<SatelliteWindowStatePayload>;
    onSatelliteWindowStateChanged(
      callback: (state: SatelliteWindowStatePayload) => void,
    ): () => void;
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
    onCapturedTaskFocus(callback: (request: CapturedTaskFocusRequest) => void): () => void;
    ackCapturedTaskFocus(requestId: string, ok: boolean): Promise<void>;
  };
  entities: {
    markAiItemSeen(type: "task" | "note", id: string): Promise<Entity>;
    /** AIの直接変更を、本人が画面から取り消す（#703）。 */
    undoAiChange(changeId: string): Promise<{
      undone: Array<{ change_id: string; undo_change_id: string; task_id: string }>;
      stopped: { change_id: string; code: string; message: string } | null;
    }>;
    list(type: EntityType, includeDeleted?: boolean): Promise<Entity[]>;
    get(type: EntityType, id: string): Promise<Entity | null>;
    save(type: EntityType, entity: Entity, options?: SaveOptions): Promise<Entity>;
    saveMany(operations: SaveOperation[]): Promise<Entity[]>;
    remove(type: EntityType, id: string): Promise<Entity>;
    restore(type: EntityType, id: string): Promise<Entity>;
  };
  workLog: {
    record(
      command: import("../workLog").RecordWorkLogCommand,
    ): Promise<import("../workLog").WorkLogReceipt>;
  };
  documents: {
    /** Note / Report本文の保存とcanonical Markdown更新を同じuse caseで行う。 */
    save(request: DocumentSaveRequest): Promise<Entity>;
  };
  commands: {
    execute(envelope: CommandEnvelope): Promise<CommandReceipt>;
    executeBatch(envelopes: CommandEnvelope[]): Promise<CommandReceipt[]>;
  };
  snapshots: {
    inspectFile(): Promise<SnapshotInspectResult>;
    // decisionsは「change.key -> action」の対応表。配列ではなくオブジェクトで渡す。
    applyImport(token: string, decisions: Record<string, string>): Promise<Workspace>;
    automaticStatus(): Promise<AutomaticSnapshotBackupStatus>;
    configureAutomatic(
      config: AutomaticSnapshotBackupConfig,
    ): Promise<AutomaticSnapshotBackupStatus>;
    runAutomatic(): Promise<AutomaticSnapshotBackupStatus>;
  };
  backups: {
    list(): Promise<WorkspaceBackupList>;
    chooseFile(): Promise<WorkspaceRestoreChoice>;
    preview(token: string): Promise<WorkspaceRestorePreview>;
    /** 今のデータを控え、戻す準備をして、起動し直す。 */
    restore(token: string): Promise<void>;
    lastRestore(): Promise<WorkspaceRestoreOutcome | null>;
    dismissLastRestore(): Promise<void>;
  };
  sharedSync: {
    status(): Promise<SharedSyncStatus>;
    configure(directory: string): Promise<SharedSyncStatus>;
    disable(): Promise<SharedSyncStatus>;
    syncNow(): Promise<SharedSyncStatus>;
    republish(): Promise<SharedSyncRepublishResult>;
    resolveConflict(
      conflictId: string,
      choice: "local" | "incoming",
    ): Promise<{
      result: { type: EntityType; entity: Entity; revisionId: string };
      status: SharedSyncStatus;
    }>;
  };
  exports: {
    markdownFile(request: MarkdownFileExportRequest): Promise<MarkdownFileExportResult>;
    markdownPdf(request: MarkdownPdfExportRequest): Promise<MarkdownPdfExportResult>;
    sketch(request: SketchExportRequest): Promise<SketchExportResult>;
    slideTimeline(request: SlideTimelineExportRequest): Promise<SlideTimelineExportResult>;
    mermaidSvg(
      request: MermaidPowerPointSvgExportRequest,
    ): Promise<MermaidPowerPointSvgExportResult>;
    mermaidPptx(
      request: MermaidPowerPointPptxExportRequest,
    ): Promise<MermaidPowerPointPptxExportResult>;
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

export interface MemoStickyCreateResult {
  status: "created" | "not_found" | "flush_failed";
  content: MemoStickyContent | null;
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
