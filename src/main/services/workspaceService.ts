import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  nativeImage,
  shell,
  type WebContents,
} from "electron";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type {
  ArtifactFileImportRequest,
  ArtifactFileImportResult,
  ArtifactProposalMaterializeRequest,
  ArtifactProposalMaterializeResult,
  ImportedArtifactFile,
  MarkdownImageAttachmentRequest,
  MarkdownImageAttachmentResult,
} from "../../shared/attachments";
import type {
  MarkdownFileExportRequest,
  MarkdownFileExportResult,
  MarkdownPdfExportRequest,
  MarkdownPdfExportResult,
} from "../../shared/fileExport";
import type {
  AppUpdateCheckResult,
  ConversationContextPreviewResult,
  ConversationContextPublishResult,
  ConversationContextRemoveResult,
  FilePreviewReadResult,
  WebArtifactPreviewResult,
  McpBridgeInfo,
  AiContextPreviewRequest,
  AiContextPreviewResult,
  DataHealthQuery,
  DataHealthQueryResult,
  DataHealthStateUpdateRequest,
  ThemeAiPackPreviewResult,
  ThemeAiPackPublishResult,
  ThemeAiPackStatusResult,
} from "../../shared/ipc/contracts";
import { createMcpBridgeInfo } from "../../shared/ipc/contracts";
import type { SketchExportRequest, SketchExportResult } from "../../shared/sketchExport";
import {
  validateMermaidPptxDiagram,
  validateOfficeSvg,
  type MermaidPowerPointPptxExportRequest,
  type MermaidPowerPointPptxExportResult,
  type MermaidPowerPointSvgExportRequest,
  type MermaidPowerPointSvgExportResult,
  type MermaidSvgClipboardRequest,
  type MermaidSvgClipboardResult,
} from "../../shared/mermaidPowerPoint";
import type {
  ImageClipboardRequest,
  SlideTimelineExportRequest,
  SlideTimelineExportResult,
} from "../../shared/slideTimelineExport";
import type {
  CanonicalNoteAiCompanion,
  DocumentSaveReferenceCompanion,
  DocumentSaveRequest,
  SaveOperation,
  SaveOptions,
  Workspace,
} from "../../shared/types/workspace";
import { referenceTargetEntityTypes } from "../../shared/entityRegistry.mjs";
import { normalizeReferenceAssertion } from "../../shared/relationAssertion.mjs";
import { reconcileStableLinkAssertions } from "../../shared/stableLinks.mjs";
import { queryActivityEvents } from "../../shared/activityProjection.mjs";
import { normalizeAiVisibility } from "../../shared/aiMetadata.mjs";
import {
  previewTaskCoding,
  previewThemeCoding,
  previewThemeM365,
} from "../../shared/aiContextPreview.mjs";
import { DataHealthEvaluator, normalizeDataHealthState } from "../../shared/dataHealth.mjs";
import {
  CONVERSATION_CONTEXT_PUBLICATION_SCHEMA,
  buildConversationContextPlan,
  normalizeConversationContextPublication,
  publicationForThemeAiPack,
  type ConversationContextPlan,
} from "../../shared/conversationContext.mjs";
import { buildThemeAiPackPlan, type ThemeAiPackPlan } from "../../shared/themeAiPack.mjs";
import {
  buildCanonicalMarkdownContent,
  canonicalMarkdownBindingFromProperties,
  markdownSignature,
  normalizeCanonicalMarkdownBinding,
  planCanonicalMarkdownWrite,
  withCanonicalMarkdownBinding,
} from "../../shared/canonicalMarkdown.mjs";
import { validateArtifactProposal } from "../../shared/proposalMedia.mjs";
import { THEME_FOLDER_MANIFEST, buildThemeFolderManifest } from "../../shared/storageResolver.mjs";
import { PERSONAL_DEFAULT_THEME_ID } from "../../shared/themeRef.mjs";
import {
  buildActivityRootRegistry,
  publicActivityRootStatus,
} from "../../shared/activityRootRegistry.mjs";
import { resolveActivityCanonicalLocalPath } from "./activityCanonicalResolver.mjs";
import {
  artifactFileTypeOf,
  artifactMimeTypeOf,
  resolveThemeContentDirectoryParts,
  resolveUniqueArtifactFileName,
} from "./artifactStorage.mjs";
import { prepareMarkdownHtmlForPdf } from "./markdownPdfImages.mjs";
import { writeAtomicTextFile } from "./atomicText.mjs";
import { bufferSignature } from "./canonicalHash.mjs";
import {
  assertConfiguredCanonicalPath,
  assertExplicitCanonicalPath,
  assertGeneratedCanonicalPath,
} from "./canonicalPath.mjs";
import { buildMermaidPptxBuffer } from "./mermaidPowerPointService";
import { createSnapshot, readSnapshot } from "./snapshotService.mjs";
import {
  THEME_AI_PACK_DIRECTORY,
  discoverThemeAiPackLocation,
  ensureThemeAiPackLocation,
  inspectThemeAiPack,
  publishThemeAiPack,
  recoverThemeAiPackOperations,
} from "./themeAiPackPublisher.mjs";
import { rejectGenericAudioArtifact, rejectGenericVideoArtifact } from "../mediaCapturePersistence";
import { artifactOpenTarget } from "../../shared/artifactLinks.mjs";
import {
  isWebArtifact,
  normalizeWebArtifactExecutionPolicy,
  webArtifactPreviewUrl,
} from "../../shared/webArtifact.mjs";
import { validateSnapshotMediaWorkspace } from "./snapshotMediaValidation";
import { logMain } from "../log";
import { measureMainPerformance } from "./performanceDiagnostics";

/**
 * Theme保存先を解決できない理由ごとに、次の操作まで書く。
 * 「Settingsを確認してください」だけでは何を直すのか分からない（#383）。
 */
function themeStorageResolutionMessage(status: string, reason: string): string {
  if (status === "needs_root")
    return "Theme保存先が未設定です。Settingsで同期ストレージを選択してください。";
  if (status === "root_unavailable")
    return "Theme保存先のフォルダへアクセスできません。同期が完了しているか、フォルダが移動・削除されていないか確認してください。";
  if (reason === "duplicate_theme_manifest")
    return "同じThemeのフォルダが保存先に複数あります。片方を移動または削除してから、もう一度保存してください。";
  if (reason === "theme_manifest_mismatch")
    return "Theme保存先に指定したフォルダを別のThemeが使っています。Settingsでこのthemeの保存先を別フォルダへ変えるか、指定を外して共通の同期先を使ってください。";
  if (reason === "theme_manifest_invalid")
    return "Theme保存先の識別ファイルを読めません。フォルダの内容を確認するか、保存先を選び直してください。";
  return "Theme保存先を確認できませんでした。Settingsで保存先を選び直してください。";
}
import {
  completeConversationContextOperation,
  inspectConversationContextFile,
  listConversationContextOperations,
  publishConversationContextFile,
  removeConversationContextFile,
} from "./conversationContextPublisher.mjs";

type SnapshotDecisions = Record<string, string>;

const MARKDOWN_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
/** アプリ内ビューア用。インフォグラフィック等の大きめ画像も許容する。 */
const PREVIEW_IMAGE_MAX_BYTES = 40 * 1024 * 1024;
const PREVIEW_TEXT_MAX_BYTES = 5 * 1024 * 1024;
const THEME_AI_PACK_CANDIDATE_TYPES = [
  "capture_entry",
  "task",
  "waiting",
  "plan_node",
  "note",
  "resource",
  "status_update",
  "work_receipt",
  "knowledge_node",
  "artifact",
  "sketch",
] as const;
const RELEASES_API_URL = "https://api.github.com/repos/mryk814/tasuken/releases/latest";
const RELEASES_PAGE_URL = "https://github.com/mryk814/tasuken/releases/latest";
const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
};
const PREVIEW_IMAGE_EXT_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};
const PREVIEW_TEXT_EXT_MIME: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
  ".html": "text/html",
  ".htm": "text/html",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
};

interface GitHubLatestRelease {
  tag_name?: string;
  name?: string;
  html_url?: string;
  published_at?: string;
}

interface WorkspaceRepository {
  loadWorkspace(includeDeleted?: boolean): unknown;
  save(type: string, entity: unknown, options?: unknown): Record<string, unknown>;
  saveMany(
    operations: Array<{ action: "save"; type: string; entity: unknown; options?: unknown }>,
  ): Array<Record<string, unknown>>;
  previewSnapshot(workspace: unknown): unknown[];
  applySnapshot(workspace: unknown, decisions: SnapshotDecisions, revisions: unknown[]): unknown;
  getPreference(key: string): unknown;
  setPreference(key: string, value: unknown): unknown;
  getDataHealthState(): unknown;
  setDataHealthState(expectedRevision: number, value: unknown): unknown;
  get(type: string, id: string, includeDeleted?: boolean): Record<string, unknown> | null;
  list(type: string, includeDeleted?: boolean): Array<Record<string, unknown>>;
  runTransaction<T>(
    callback: (repository: {
      save(type: string, entity: unknown, options?: unknown): Record<string, unknown>;
      remove(type: string, id: string): Record<string, unknown> | null;
    }) => T,
  ): T;
}

interface CanonicalFileSnapshot {
  exists: boolean;
  content: string;
  signature: string;
  size: number | null;
  mtimeMs: number | null;
  error?: string;
}

interface CanonicalTarget {
  filePath: string;
  directory: string;
  rootIdentity: string;
  configuredRoot: boolean;
}

interface CanonicalRecoveryReceipt {
  operationId: string;
  noteId: string;
  entity: Record<string, unknown>;
  filePath: string;
  content: string;
  binding: Record<string, unknown>;
  operationAt?: string;
  baseRevision?: number;
  bodySignature?: string;
  companions?: DocumentSaveReferenceCompanion[];
  noteAiCompanion?: CanonicalNoteAiCompanion;
}

type CanonicalSaveOptions = SaveOptions & { __canonicalOperationAt?: string };

function localDateIso(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function safeExportFileName(value: string, extension: "md" | "pdf"): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const fileName = (cleaned || "tasken-log").slice(0, 120);
  return fileName.toLowerCase().endsWith(`.${extension}`) ? fileName : `${fileName}.${extension}`;
}

function safeMarkdownFileName(value: string): string {
  return safeExportFileName(value, "md");
}

function safePdfFileName(value: string): string {
  return safeExportFileName(value, "pdf");
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeContextPreviewError(value: unknown): string {
  const source = objectValue(value);
  const code = typeof source.code === "string" ? source.code : "";
  if (code === "not_found")
    return "対象が見つからないか、AI公開範囲に含まれていません。元Entityのvisibilityを確認してください。";
  if (code === "unsupported_schema")
    return "保存形式を解釈できません。Taskenを更新してからもう一度お試しください。";
  return "Context Previewを作成できませんでした。元Entityの公開範囲を確認して、もう一度お試しください。";
}

function parsedRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return objectValue(value);
  try {
    return objectValue(JSON.parse(value));
  } catch {
    return {};
  }
}

function normalizeCanonicalNoteAiCompanion(
  value: unknown,
  noteId: string,
): CanonicalNoteAiCompanion | null {
  if (value === undefined || value === null) return null;
  const companion = objectValue(value);
  const proposal = objectValue(companion.proposal);
  const event = objectValue(companion.event);
  const metadata = objectValue(event.metadata);
  const marker = objectValue(metadata.note_ai_command_marker);
  const proposalPayload = parsedRecord(proposal.payload);
  const proposalNotes = Array.isArray(proposalPayload.notes)
    ? proposalPayload.notes.map(objectValue)
    : [];
  const proposalRequest = objectValue(proposal.request);
  const proposalTarget = objectValue(proposalRequest.target);
  const proposalNote = proposalNotes[0] || {};
  const isCreate = proposalNote.action === "create";
  // Pre-Core Note edit proposals did not persist an explicit action. Their
  // target identity remains authoritative during recovery.
  const isEdit = proposalNote.action === "merge" || proposalNote.target_id === noteId;
  const before = parsedRecord(event.before_json);
  const after = parsedRecord(event.after_json);
  const commandId = typeof companion.commandId === "string" ? companion.commandId : "";
  const proposalId = typeof proposal.id === "string" ? proposal.id : "";
  const valid =
    companion.schema === "tasken-note-ai-companion/v1" &&
    companion.noteId === noteId &&
    commandId.length > 0 &&
    proposalId.length > 0 &&
    proposal.payload_type === "notes" &&
    ["accepted", "partially_accepted"].includes(String(proposal.status || "")) &&
    proposalNotes.length === 1 &&
    ((isCreate && !proposalNote.target_id && !proposalTarget.type && !proposalTarget.id) ||
      (isEdit &&
        proposalNote.target_id === noteId &&
        proposalTarget.type === "note" &&
        proposalTarget.id === noteId)) &&
    typeof event.id === "string" &&
    event.id.length > 0 &&
    event.entity_type === "note" &&
    event.record_type === "note" &&
    event.entity_id === noteId &&
    event.command_id === commandId &&
    event.command_name === "ApplyAiProposal" &&
    typeof event.command_fingerprint === "string" &&
    event.command_fingerprint.length > 0 &&
    ((isCreate && !before.id) || (isEdit && before.id === noteId)) &&
    after.id === noteId &&
    marker.schema === "tasken-note-ai-command-marker/v1" &&
    marker.commandId === commandId &&
    marker.commandFingerprint === event.command_fingerprint &&
    marker.noteId === noteId &&
    marker.proposalId === proposalId &&
    Number.isInteger(marker.noteVersion) &&
    Number(marker.noteVersion) > 0 &&
    Number.isInteger(marker.proposalVersion) &&
    Number(marker.proposalVersion) > 0;
  if (!valid)
    throw new Error("canonical Note AI companionが不正です。復旧データを適用せず隔離します。");
  return {
    schema: "tasken-note-ai-companion/v1",
    noteId,
    commandId,
    proposal: proposal as CanonicalNoteAiCompanion["proposal"],
    event: event as CanonicalNoteAiCompanion["event"],
  };
}

function canonicalNoteAiOperations(companion: CanonicalNoteAiCompanion | null): SaveOperation[] {
  if (!companion) return [];
  return [
    { action: "save", type: "ai_proposal", entity: companion.proposal },
    { action: "save", type: "change_event", entity: companion.event },
  ];
}

function sameStableLinkAssertion(
  existing: Record<string, unknown> | undefined,
  desired: Record<string, unknown>,
): boolean {
  if (!existing || existing.deleted_at) return false;
  try {
    const pick = (value: Record<string, unknown>) => {
      const assertion = normalizeReferenceAssertion(value, { legacyRead: true });
      return {
        subject: assertion.subject,
        predicate: assertion.predicate,
        object: assertion.object,
        layer: assertion.layer,
        status: assertion.status,
        origin: assertion.origin,
        evidence_refs: assertion.evidence_refs,
        legacy_evidence_refs: assertion.legacy_evidence_refs || [],
        confidence: assertion.confidence,
        metadata: assertion.metadata,
        recorded_at: assertion.recorded_at,
        superseded_by_assertion_id: assertion.superseded_by_assertion_id,
      };
    };
    return JSON.stringify(pick(existing)) === JSON.stringify(pick(desired));
  } catch {
    return false;
  }
}

function isSafeThemeAiPackDirectory(themeFolder: string, packDirectory: string): boolean {
  const resolvedThemeFolder = path.resolve(themeFolder);
  const resolvedPackDirectory = path.resolve(packDirectory);
  if (
    path.dirname(resolvedPackDirectory) !== resolvedThemeFolder ||
    path.basename(resolvedPackDirectory) !== THEME_AI_PACK_DIRECTORY
  )
    return false;
  try {
    const packStat = fs.lstatSync(resolvedPackDirectory);
    return !packStat.isSymbolicLink() && packStat.isDirectory();
  } catch {
    return false;
  }
}

function normalizeDocumentSaveCompanions(
  value: unknown,
  noteId: string,
): DocumentSaveReferenceCompanion[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 4) {
    throw new Error(
      "文書保存のcompanionが不正です。画面を再読み込みして、もう一度試してください。",
    );
  }
  const targetTypes = new Set<string>(referenceTargetEntityTypes);
  return value.map((entry) => {
    const operation = objectValue(entry);
    const entity = objectValue(operation.entity);
    const options = objectValue(operation.options);
    const id = typeof entity.id === "string" ? entity.id.trim() : "";
    const sourceId = typeof entity.source_id === "string" ? entity.source_id.trim() : "";
    const targetType = typeof entity.target_type === "string" ? entity.target_type.trim() : "";
    const targetId = typeof entity.target_id === "string" ? entity.target_id.trim() : "";
    if (operation.action !== "save" || operation.type !== "reference" || !id) {
      throw new Error(
        "文書保存には型付きReferenceだけを同伴できます。画面を再読み込みして、もう一度試してください。",
      );
    }
    if (entity.source_type !== "note" || sourceId !== noteId) {
      throw new Error(
        "文書保存のReference sourceが対象Noteと一致しません。対象Noteを開き直して再試行してください。",
      );
    }
    if (!targetTypes.has(targetType) || !targetId) {
      throw new Error(
        "文書保存のReference targetが不正です。参照元を開き直して再試行してください。",
      );
    }
    if (entity.relation_type !== "derived_from") {
      throw new Error("文書保存のReference predicateはderived_fromだけを利用できます。");
    }
    const createdAt = typeof entity.created_at === "string" ? entity.created_at.trim() : "";
    if (createdAt && Number.isNaN(Date.parse(createdAt))) {
      throw new Error(
        "文書保存のReference作成日時が不正です。画面を再読み込みして、もう一度試してください。",
      );
    }
    return {
      action: "save",
      type: "reference",
      entity: {
        id,
        source_type: "note",
        source_id: sourceId,
        target_type: targetType as DocumentSaveReferenceCompanion["entity"]["target_type"],
        target_id: targetId,
        relation_type: "derived_from",
        ...(typeof entity.note === "string" ? { note: entity.note } : {}),
        ...(createdAt ? { created_at: createdAt } : {}),
      },
      options: {
        ...(typeof options.source === "string" && options.source.trim()
          ? { source: options.source.trim() }
          : {}),
        ...(typeof options.reason === "string" && options.reason.trim()
          ? { reason: options.reason.trim() }
          : {}),
      },
    };
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeDocumentSaveRequest(value: unknown): DocumentSaveRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("文書保存のrequestが不正です。画面を再読み込みして、もう一度試してください。");
  }
  const request = value as Record<string, unknown>;
  const entity = objectValue(request.entity);
  const snapshot = objectValue(request.snapshot);
  const owner = objectValue(snapshot.owner);
  const entityId = typeof owner.entityId === "string" ? owner.entityId.trim() : "";
  if (owner.recordType !== "note" || !entityId) {
    throw new Error("文書保存のownerが不正です。対象Noteを開き直して再試行してください。");
  }
  if (typeof entity.id !== "string" || entity.id !== entityId) {
    throw new Error(
      "文書保存のownerとEntityが一致しません。古い編集画面を閉じて再試行してください。",
    );
  }
  if (typeof snapshot.body !== "string") {
    throw new Error(
      "文書保存の本文snapshotがありません。編集内容を保持したまま再試行してください。",
    );
  }
  const expectedRevision = snapshot.expectedRevision;
  if (
    typeof expectedRevision !== "number" ||
    !Number.isInteger(expectedRevision) ||
    expectedRevision < 0
  ) {
    throw new Error(
      "文書保存のexpected revisionが不正です。対象Noteを開き直して再試行してください。",
    );
  }
  if (String(entity.body_markdown ?? "") !== snapshot.body) {
    throw new Error(
      "文書保存の本文snapshotとEntityが一致しません。古い編集画面を閉じて再試行してください。",
    );
  }
  return {
    entity: entity as DocumentSaveRequest["entity"],
    snapshot: {
      owner: { recordType: "note", entityId },
      body: snapshot.body,
      expectedRevision,
    },
    options: objectValue(request.options) as SaveOptions,
    companions: normalizeDocumentSaveCompanions(request.companions, entityId),
  };
}

function normalizeMarkdownFileExportRequest(value: unknown): MarkdownFileExportRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Markdown出力の内容が不正です。画面を再読み込みして、もう一度試してください。");
  }
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title : "";
  const content = typeof record.content === "string" ? record.content : "";
  if (!content.trim()) throw new Error("書き出す内容がありません。");
  return {
    title,
    content,
    directory: typeof record.directory === "string" ? record.directory : null,
    chooseDirectory: Boolean(record.chooseDirectory),
    fileName: typeof record.fileName === "string" ? record.fileName : null,
    themeId:
      typeof record.themeId === "string" && record.themeId.trim() ? record.themeId.trim() : null,
  };
}

function normalizeMarkdownPdfExportRequest(value: unknown): MarkdownPdfExportRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("PDF出力の内容が不正です。画面を再読み込みして、もう一度試してください。");
  }
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title : "";
  const html = typeof record.html === "string" ? record.html : "";
  if (!html.trim()) throw new Error("PDFに出力する内容がありません。");
  return {
    title,
    html,
    directory: typeof record.directory === "string" ? record.directory : null,
    chooseDirectory: Boolean(record.chooseDirectory),
    fileName: typeof record.fileName === "string" ? record.fileName : null,
    themeId:
      typeof record.themeId === "string" && record.themeId.trim() ? record.themeId.trim() : null,
  };
}

function parseVersion(value: string): number[] {
  const normalized = value.trim().replace(/^v/i, "");
  const [core] = normalized.split("-");
  return core
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.length, right.length, 3);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function safeReleaseUrl(value: unknown): string {
  if (typeof value !== "string") return RELEASES_PAGE_URL;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") return RELEASES_PAGE_URL;
    if (!parsed.pathname.startsWith("/mryk814/tasuken/releases")) return RELEASES_PAGE_URL;
    return parsed.toString();
  } catch {
    return RELEASES_PAGE_URL;
  }
}

function safeAttachmentName(value: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "image").slice(0, 80);
}

function normalizeArtifactFileImportRequest(value: unknown): ArtifactFileImportRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("添付するファイルの情報が不正です。もう一度ファイルをドラッグしてください。");
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.files) || !record.files.length) {
    throw new Error("添付するファイルがありません。ファイルをドラッグしてください。");
  }
  const files = record.files.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("添付するファイルの情報が不正です。もう一度ファイルをドラッグしてください。");
    }
    const fileRecord = entry as Record<string, unknown>;
    const filePath = typeof fileRecord.path === "string" ? fileRecord.path.trim() : "";
    if (!filePath) {
      throw new Error(
        "ファイルの場所を取得できませんでした。エクスプローラーからファイルをドラッグしてください。",
      );
    }
    return {
      path: filePath,
      name:
        typeof fileRecord.name === "string" && fileRecord.name.trim()
          ? fileRecord.name.trim()
          : undefined,
    };
  });
  const themeId =
    typeof record.themeId === "string" && record.themeId.trim() ? record.themeId.trim() : null;
  return { files, themeId };
}

function normalizeMarkdownImageAttachment(value: unknown): MarkdownImageAttachmentRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("画像の形式が不正です。画像をコピーし直して、もう一度貼り付けてください。");
  }
  const record = value as Record<string, unknown>;
  const fileName = typeof record.fileName === "string" ? record.fileName : "image";
  const mimeType = typeof record.mimeType === "string" ? record.mimeType.toLowerCase() : "";
  const dataUrl = typeof record.dataUrl === "string" ? record.dataUrl : "";
  if (!IMAGE_MIME_EXTENSIONS[mimeType]) {
    throw new Error("対応していない画像形式です。PNG、JPEG、GIF、WebP、BMPを貼り付けてください。");
  }
  if (!dataUrl.startsWith(`data:${mimeType};base64,`)) {
    throw new Error(
      "画像データを読み取れませんでした。コピーし直して、もう一度貼り付けてください。",
    );
  }
  return { fileName, mimeType, dataUrl };
}

export class WorkspaceService {
  private readonly pendingSnapshots = new Map<string, Workspace>();
  private readonly publishingThemeAiPacks = new Set<string>();
  private readonly canonicalRecoveryPath: string;
  private readonly canonicalRecoveryWarningPath: string;
  private readonly themeAiPackRecoveryDirectory: string;
  private readonly dataHealthEvaluator = new DataHealthEvaluator();
  private readonly conversationContextRecoveryDirectory: string;
  private readonly taskenCoreClient?: {
    getTaskContext(request: { task_id: string }): Promise<unknown>;
    getThemeContext(request: { theme_id: string }): Promise<unknown>;
    inspect?(): Promise<{ api_version: string; capabilities: string[] }>;
  };

  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly userDataPath: string,
    private readonly now: () => string = () => new Date().toISOString(),
    taskenCoreClient?: {
      getTaskContext(request: { task_id: string }): Promise<unknown>;
      getThemeContext(request: { theme_id: string }): Promise<unknown>;
      inspect?(): Promise<{ api_version: string; capabilities: string[] }>;
    },
  ) {
    this.canonicalRecoveryPath = path.join(userDataPath, "canonical-markdown-recovery.json");
    this.canonicalRecoveryWarningPath = path.join(
      userDataPath,
      "canonical-markdown-recovery-warning.json",
    );
    this.themeAiPackRecoveryDirectory = path.join(userDataPath, "theme-ai-pack-recovery");
    this.conversationContextRecoveryDirectory = path.join(
      userDataPath,
      "conversation-context-recovery",
    );
    this.taskenCoreClient = taskenCoreClient;
  }

  loadWorkspace(includeDeleted = false): unknown {
    return measureMainPerformance("workspace_load", () => {
      this.recoverConversationContextReceipts();
      this.recoverThemeAiPackReceipts();
      this.recoverCanonicalMarkdownReceipts();
      this.migrateCanonicalMarkdownBindings();
      return this.repository.loadWorkspace(includeDeleted);
    });
  }

  private writeAtomicText(filePath: string, content: string, operationId: string): string | null {
    return writeAtomicTextFile(filePath, content, operationId);
  }

  private recoverThemeAiPackReceipts(): void {
    const results = recoverThemeAiPackOperations({
      recoveryDirectory: this.themeAiPackRecoveryDirectory,
    });
    for (const result of results) {
      if (result.state === "recovery_required") {
        console.warn(
          `Theme AI Pack ${result.operationId} は自動復旧できませんでした。${result.error || ""}`,
        );
      }
    }
  }

  private buildThemeAiPack(themeIdValue: unknown): {
    theme: Record<string, unknown>;
    plan: ThemeAiPackPlan;
  } {
    const themeId = typeof themeIdValue === "string" ? themeIdValue.trim() : "";
    if (!themeId) throw new Error("Theme IDがありません。Themeを開き直してください。");
    const theme = this.repository.get("theme", themeId) || this.repository.get("project", themeId);
    if (!theme || theme.deleted_at) throw new Error("AI Packを作成するThemeが見つかりません。");
    const candidates = THEME_AI_PACK_CANDIDATE_TYPES.flatMap((type) =>
      this.repository.list(type).map((entity) => {
        const publication = type === "resource" ? publicationForThemeAiPack(entity) : null;
        return { type, entity, ...(publication ? { publication } : {}) };
      }),
    );
    const workspace = this.repository.loadWorkspace(false) as Record<string, unknown>;
    const workspaceDefault = normalizeAiVisibility(
      this.repository.getPreference("aiVisibilityDefault"),
    );
    const activity = queryActivityEvents({
      workspace,
      events: this.repository.list("change_event"),
      themeId,
      audience: "m365",
      workspaceDefault,
      roots: this.activityCanonicalRootPaths(),
      limit: 100,
    });
    const sourceRevision = markdownSignature(
      JSON.stringify(
        [
          ["theme", theme.id, theme.version, theme.updated_at],
          ...candidates.map(({ type, entity }) => [
            type,
            entity.id,
            entity.version,
            entity.updated_at,
          ]),
          ...activity.events.map((event) => [
            "change_event",
            event.id,
            event.entity_ref?.revision,
            event.occurred_at,
          ]),
        ].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
      ),
    );
    return {
      theme,
      plan: buildThemeAiPackPlan({
        theme,
        candidates,
        activity,
        workspaceDefault,
        generatedAt: this.now(),
        sourceRevision,
      }),
    };
  }

  async getAiContextPreview(requestValue: unknown): Promise<AiContextPreviewResult> {
    const request = objectValue(requestValue) as Partial<AiContextPreviewRequest>;
    const scopeValue = objectValue(request.scope);
    const scopeType =
      scopeValue.type === "theme" || scopeValue.type === "task" ? scopeValue.type : null;
    const scopeId = typeof scopeValue.id === "string" ? scopeValue.id.trim() : "";
    const audience =
      request.audience === "m365" || request.audience === "coding_agent" ? request.audience : null;
    if (!scopeType || !scopeId || !audience) {
      throw new Error("Context Previewの対象またはAudienceが不正です。画面を開き直してください。");
    }
    const requestedScope = { type: scopeType, id: scopeId } as const;
    try {
      if (audience === "m365") {
        let themeId = scopeId;
        if (scopeType === "task") {
          const task = this.repository.get("task", scopeId);
          themeId =
            typeof task?.project_id === "string" && task.project_id.trim()
              ? task.project_id.trim()
              : typeof task?.theme_id === "string"
                ? task.theme_id.trim()
                : "";
          if (!task || task.deleted_at || !themeId) {
            return {
              state: "error",
              requestedScope,
              effectiveScope: requestedScope,
              producer: "theme_ai_pack",
              preview: null,
              includedInEffectiveScope: false,
              error: "Taskまたは所属Themeが見つかりません。TaskのThemeを確認してください。",
            };
          }
        }
        const { plan } = this.buildThemeAiPack(themeId);
        const preview = previewThemeM365(plan);
        const included = scopeType === "theme" || preview.untypedIncludedIds.includes(scopeId);
        return {
          state: preview.counts.included || preview.files.length ? "ready" : "empty",
          requestedScope,
          effectiveScope: { type: "theme", id: themeId },
          producer: "theme_ai_pack",
          preview,
          includedInEffectiveScope: included,
        };
      }
      if (!this.taskenCoreClient) throw new Error("Tasken Core clientが構成されていません。");
      const response =
        scopeType === "task"
          ? await this.taskenCoreClient.getTaskContext({ task_id: scopeId })
          : await this.taskenCoreClient.getThemeContext({ theme_id: scopeId });
      const preview =
        scopeType === "task" ? previewTaskCoding(response) : previewThemeCoding(response);
      return {
        state: preview.counts.included ? "ready" : "empty",
        requestedScope,
        effectiveScope: requestedScope,
        producer: scopeType === "task" ? "mcp_task_context" : "mcp_theme_context",
        preview,
        includedInEffectiveScope: preview.included.some((entry) => entry.ref.id === scopeId),
      };
    } catch (error) {
      return {
        state: "error",
        requestedScope,
        effectiveScope: requestedScope,
        producer:
          audience === "m365"
            ? "theme_ai_pack"
            : scopeType === "task"
              ? "mcp_task_context"
              : "mcp_theme_context",
        preview: null,
        includedInEffectiveScope: null,
        error: safeContextPreviewError(error),
      };
    }
  }

  getDataHealth(queryValue: unknown = {}): DataHealthQueryResult {
    try {
      return this.evaluateDataHealth(queryValue);
    } catch {
      throw new Error(
        "Data Healthを確認できませんでした。画面を再読み込みして、もう一度お試しください。",
      );
    }
  }

  private evaluateDataHealth(queryValue: unknown = {}): DataHealthQueryResult {
    const query = objectValue(queryValue) as DataHealthQuery;
    const workspace = this.repository.loadWorkspace(false) as Workspace;
    const state = normalizeDataHealthState(this.repository.getDataHealthState());
    const themes = [
      ...((workspace.projects || []) as Array<Record<string, unknown>>),
      ...((workspace.themes || []) as Array<Record<string, unknown>>),
    ].filter((theme) => !theme.deleted_at && typeof theme.id === "string");
    const seenThemeIds = new Set<string>();
    const themeAiPackStatuses = themes.flatMap((theme) => {
      const themeId = String(theme.id);
      if (seenThemeIds.has(themeId)) return [];
      seenThemeIds.add(themeId);
      try {
        const status = this.getThemeAiPackStatus(themeId);
        return [{ themeId, state: status.state }];
      } catch {
        return [{ themeId, state: "failed_retryable" }];
      }
    });
    const evaluated = this.dataHealthEvaluator.evaluate(workspace, {
      state,
      generatedAt: this.now(),
      themeAiPackStatuses,
    });
    const stateFilter = query.state && query.state !== "all" ? query.state : "open";
    const issues = evaluated.issues.filter(
      (entry) =>
        (!query.themeId || entry.themeId === query.themeId) &&
        (!query.entityType || entry.ref.type === query.entityType) &&
        (!query.severity || entry.severity === query.severity) &&
        (!stateFilter || entry.state === stateFilter),
    );
    return { ...evaluated, issues, totalIssueCount: evaluated.issues.length };
  }

  setDataHealthIssueState(requestValue: unknown): DataHealthQueryResult {
    const request = objectValue(requestValue) as Partial<DataHealthStateUpdateRequest>;
    const issueId = typeof request.issueId === "string" ? request.issueId.trim() : "";
    const nextState = request.state;
    if (!issueId || !["open", "ignored", "resolved"].includes(String(nextState))) {
      throw new Error("Data Healthの状態変更が不正です。画面を開き直してください。");
    }
    let current;
    try {
      current = normalizeDataHealthState(this.repository.getDataHealthState());
    } catch {
      throw new Error("Data Healthの状態を読み込めませんでした。画面を再読み込みしてください。");
    }
    if (request.expectedRevision !== current.revision) {
      throw new Error(
        "Data Healthが別画面で更新されました。再読み込みしてからもう一度操作してください。",
      );
    }
    const currentResult = this.getDataHealth({ state: "all" });
    if (!currentResult.issues.some((entry) => entry.id === issueId)) {
      throw new Error("Data Health issueは解消済みです。再読み込みしてください。");
    }
    const issues = { ...current.issues };
    if (nextState === "open") delete issues[issueId];
    else {
      issues[issueId] = {
        state: nextState as "ignored" | "resolved",
        updatedAt: this.now(),
        note: typeof request.note === "string" ? request.note.trim().slice(0, 500) : "",
      };
    }
    try {
      this.repository.setDataHealthState(current.revision, {
        schema: "tasken-data-health-state/v1",
        updatedAt: this.now(),
        issues,
      });
    } catch {
      throw new Error(
        "Data Healthが別画面で更新されました。再読み込みしてからもう一度操作してください。",
      );
    }
    return this.getDataHealth({ state: "all" });
  }

  private resolveThemeAiPack(theme: Record<string, unknown>) {
    return discoverThemeAiPackLocation({
      syncRoot: String(this.repository.getPreference("artifactDirectory") || ""),
      themeStorageRoot: typeof theme.storage_root === "string" ? theme.storage_root : "",
      themeId: String(theme.id || ""),
      themeCode: typeof theme.code === "string" ? theme.code : "",
      displayName: String(theme.name || theme.title || ""),
    });
  }

  private saveConversationContextResource(
    entity: Record<string, unknown>,
  ): Record<string, unknown> {
    return this.repository.save("resource", entity, {
      __conversationContextPublicationWrite: true,
    });
  }

  private conversationContextInput(
    requestValue: unknown,
    publishedAt?: string,
  ): {
    resource: Record<string, unknown>;
    theme: Record<string, unknown>;
    plan: ConversationContextPlan;
  } {
    const request = objectValue(requestValue);
    const conversationId =
      typeof request.conversationId === "string" ? request.conversationId.trim() : "";
    if (!conversationId)
      throw new Error("Conversation IDがありません。Viewerを開き直してください。");
    const resource = this.repository.get("resource", conversationId);
    if (!resource || resource.deleted_at || resource.resource_scope !== "chat_ref") {
      throw new Error("Conversationが見つかりません。Viewerを開き直してください。");
    }
    const themeId = String(resource.theme_id || resource.project_id || "").trim();
    const theme = themeId
      ? this.repository.get("theme", themeId) || this.repository.get("project", themeId)
      : null;
    if (!theme || theme.deleted_at) {
      throw new Error("AI Contextへ保存するにはConversationへThemeを設定してください。");
    }
    const selectedMessageIndexes = Array.isArray(request.selectedMessageIndexes)
      ? request.selectedMessageIndexes
      : undefined;
    const plan = buildConversationContextPlan({
      resource,
      theme,
      workspaceDefault: normalizeAiVisibility(this.repository.getPreference("aiVisibilityDefault")),
      scope:
        request.scope === "selected_turns"
          ? "selected_turns"
          : request.scope === "full"
            ? "full"
            : undefined,
      selectedMessageIndexes,
      publishedAt,
    });
    return { resource, theme, plan };
  }

  private conversationContextLocation(
    theme: Record<string, unknown>,
    plan: ConversationContextPlan,
  ) {
    const publication = normalizeConversationContextPublication(
      this.repository.get("resource", plan.conversation_id)?.conversation_context_publication,
    );
    const bindingThemeId = publication?.status !== "removed" ? publication?.theme_id : null;
    const bindingTheme = bindingThemeId
      ? this.repository.get("theme", bindingThemeId, true) ||
        this.repository.get("project", bindingThemeId, true)
      : theme;
    if (!bindingTheme) return { location: { status: "theme_missing" as const }, storage: null };
    const location = this.resolveThemeAiPack(bindingTheme);
    if (location.status !== "ok") return { location, storage: null };
    const storage =
      publication?.status === "published"
        ? inspectConversationContextFile({
            themeFolder: location.themeFolder,
            relativePath: publication.relative_path,
            contentHash: publication.content_hash,
          })
        : null;
    return { location, storage };
  }

  getConversationContextPreview(requestValue: unknown): ConversationContextPreviewResult {
    const request = objectValue(requestValue);
    const existing =
      typeof request.conversationId === "string"
        ? this.repository.get("resource", request.conversationId.trim())
        : null;
    const publication = normalizeConversationContextPublication(
      existing?.conversation_context_publication,
    );
    const plannedPublishedAt = publication?.published_at || this.now();
    const { theme, plan } = this.conversationContextInput(request, plannedPublishedAt);
    const { location, storage } = this.conversationContextLocation(theme, plan);
    const storageDirty =
      publication?.status === "published" && (!storage?.exists || !storage.current);
    return {
      conversationId: plan.conversation_id,
      themeId: plan.theme_id,
      storageRootId:
        publication?.status !== "removed" && publication?.storage_root_id
          ? publication.storage_root_id
          : plan.storage_root_id,
      relativePath: plan.relative_path,
      plannedPublishedAt,
      scope: plan.scope,
      selectedMessageIndexes: plan.selected_message_indexes,
      messageCount: plan.message_count,
      sourceMessageCount: plan.source_message_count,
      publicationState: storageDirty ? "dirty" : plan.publication_state,
      dirty: plan.dirty || Boolean(storageDirty),
      allowed: plan.allowed && location.status === "ok",
      locationStatus: location.status,
      content: plan.content,
      contentHash: plan.content_hash,
      sourceRevision: plan.source_revision,
      exclusions: plan.exclusion_reasons,
      warnings: plan.warnings,
      blockingReasons: [
        ...plan.blocking_reasons,
        ...(location.status === "ok"
          ? []
          : ["ThemeのOneDrive保存先を利用できません。Settingsを確認してください。"]),
      ],
      sourceUrl: plan.source_url,
      theme: plan.theme,
      summary: plan.summary,
      freshness: plan.freshness,
      authority: plan.authority,
      aiVisibility: plan.ai_visibility,
    };
  }

  private publishThemeAiPackAfterConversationChange(themeId: string): {
    state: string;
    error?: string;
  } {
    try {
      const preview = this.getThemeAiPackPreview(themeId);
      const result = this.publishThemeAiPack({ themeId, expectedContentHash: preview.contentHash });
      return { state: result.state, ...(result.error ? { error: result.error } : {}) };
    } catch (error) {
      return { state: "failed_retryable", error: errorText(error) };
    }
  }

  publishConversationContext(requestValue: unknown): ConversationContextPublishResult {
    const request = objectValue(requestValue);
    const plannedPublishedAt =
      typeof request.plannedPublishedAt === "string" ? request.plannedPublishedAt.trim() : "";
    const expectedContentHash =
      typeof request.expectedContentHash === "string" ? request.expectedContentHash.trim() : "";
    if (
      !plannedPublishedAt ||
      Number.isNaN(new Date(plannedPublishedAt).getTime()) ||
      !expectedContentHash
    ) {
      throw new Error("AI Context Previewが古いため、内容を確認し直してください。");
    }
    const { resource, theme, plan } = this.conversationContextInput(request, plannedPublishedAt);
    if (plan.content_hash !== expectedContentHash) {
      return {
        conversationId: plan.conversation_id,
        themeId: plan.theme_id,
        publicationState: "stale_preview",
        dirty: true,
        written: false,
        contentHash: plan.content_hash,
        error: "ConversationがPreview後に変更されました。内容を確認し直してください。",
      };
    }
    if (!plan.allowed) {
      throw new Error(plan.blocking_reasons[0] || "M365への公開が許可されていません。");
    }
    const location = this.resolveThemeAiPack(theme);
    if (location.status !== "ok")
      throw new Error("ThemeのOneDrive保存先を利用できません。Settingsを確認してください。");
    const ensured = ensureThemeAiPackLocation(location, { operationId: randomUUID() });
    if (ensured.status !== "ok") throw new Error("ThemeのOneDrive保存先を準備できませんでした。");
    const existingPublication = normalizeConversationContextPublication(
      resource.conversation_context_publication,
    );
    if (
      existingPublication?.status !== "removed" &&
      existingPublication?.theme_id &&
      existingPublication.theme_id !== plan.theme_id
    ) {
      throw new Error(
        "以前のThemeに公開済みです。先にAI Contextから外してから、新しいThemeへ公開してください。",
      );
    }
    if (
      existingPublication?.status === "published" &&
      existingPublication.content_hash === plan.content_hash &&
      existingPublication.source_revision === plan.source_revision
    ) {
      const storage = inspectConversationContextFile({
        themeFolder: ensured.themeFolder,
        relativePath: plan.relative_path,
        contentHash: plan.content_hash,
      });
      if (storage.current) {
        return {
          conversationId: plan.conversation_id,
          themeId: plan.theme_id,
          publicationState: "published",
          dirty: false,
          written: false,
          contentHash: plan.content_hash,
          themePackState: this.getThemeAiPackStatus(plan.theme_id).state,
        };
      }
    }
    const operationId = randomUUID();
    const pendingPublication = {
      schema: CONVERSATION_CONTEXT_PUBLICATION_SCHEMA,
      status: "publishing",
      scope: plan.scope,
      selected_message_indexes: plan.selected_message_indexes,
      theme_id: plan.theme_id,
      storage_root_id: plan.storage_root_id,
      relative_path: plan.relative_path,
      content_hash: plan.content_hash,
      source_revision: plan.source_revision,
      published_at: plannedPublishedAt,
      updated_at: this.now(),
      removed_at: null,
      operation_id: operationId,
      last_error: null,
    };
    const pendingResource = this.saveConversationContextResource({
      ...resource,
      conversation_context_publication: pendingPublication,
    });
    try {
      const fileResult = publishConversationContextFile({
        themeFolder: ensured.themeFolder,
        conversationId: plan.conversation_id,
        themeId: plan.theme_id,
        relativePath: plan.relative_path,
        content: plan.content,
        contentHash: plan.content_hash,
        operationId,
        recoveryDirectory: this.conversationContextRecoveryDirectory,
      });
      this.saveConversationContextResource({
        ...pendingResource,
        conversation_context_publication: {
          ...pendingPublication,
          status: "published",
          operation_id: null,
          updated_at: this.now(),
        },
      });
      completeConversationContextOperation(this.conversationContextRecoveryDirectory, operationId);
      const pack = this.publishThemeAiPackAfterConversationChange(plan.theme_id);
      return {
        conversationId: plan.conversation_id,
        themeId: plan.theme_id,
        publicationState: "published",
        dirty: false,
        written: fileResult.written,
        contentHash: plan.content_hash,
        themePackState: pack.state,
        ...(pack.error
          ? {
              warning:
                "Conversationは公開済みですが、Theme AI Packを更新できませんでした。Theme画面から再試行してください。",
            }
          : {}),
      };
    } catch (error) {
      try {
        const recoverable = listConversationContextOperations(
          this.conversationContextRecoveryDirectory,
        ).some(
          (item) =>
            item.receipt?.operationId === operationId && item.receipt.phase === "file_written",
        );
        const current = this.repository.get("resource", plan.conversation_id);
        if (
          current &&
          normalizeConversationContextPublication(current.conversation_context_publication)
            ?.operation_id === operationId
        ) {
          this.saveConversationContextResource({
            ...current,
            conversation_context_publication: {
              ...pendingPublication,
              status: "publish_failed",
              operation_id: recoverable ? operationId : null,
              last_error: "file_or_database_write_failed",
              updated_at: this.now(),
            },
          });
        }
      } catch {
        // Receiptとpublishing stateを残し、次回起動でfile read-back後に復旧する。
      }
      throw new Error(
        "AI Contextファイルを更新できませんでした。OneDriveの同期状態と保存先を確認して再試行してください。",
      );
    }
  }

  removeConversationContext(requestValue: unknown): ConversationContextRemoveResult {
    const request = objectValue(requestValue);
    const conversationId =
      typeof request.conversationId === "string" ? request.conversationId.trim() : "";
    const resource = conversationId ? this.repository.get("resource", conversationId) : null;
    if (!resource || resource.deleted_at || resource.resource_scope !== "chat_ref")
      throw new Error("Conversationが見つかりません。");
    const publication = normalizeConversationContextPublication(
      resource.conversation_context_publication,
    );
    if (!publication || publication.status === "removed") {
      return {
        conversationId,
        themeId: String(resource.theme_id || resource.project_id || ""),
        publicationState: "removed",
        removed: false,
      };
    }
    const themeId =
      publication.theme_id || String(resource.theme_id || resource.project_id || "").trim();
    const storageRootId = publication.storage_root_id || `theme:${themeId}`;
    if (!themeId || storageRootId !== `theme:${themeId}`)
      throw new Error("Conversationの公開先bindingが不正です。再読込してから再試行してください。");
    const theme =
      this.repository.get("theme", themeId, true) || this.repository.get("project", themeId, true);
    if (!theme) throw new Error("ConversationのThemeが見つかりません。");
    const location = this.resolveThemeAiPack(theme);
    if (location.status !== "ok")
      throw new Error("ThemeのOneDrive保存先を利用できません。Settingsを確認してください。");
    const ensured = ensureThemeAiPackLocation(location, { operationId: randomUUID() });
    if (ensured.status !== "ok") throw new Error("ThemeのOneDrive保存先を準備できませんでした。");
    const operationId = randomUUID();
    const pendingPublication = {
      ...publication,
      status: "removing",
      operation_id: operationId,
      updated_at: this.now(),
      last_error: null,
    };
    const pendingResource = this.saveConversationContextResource({
      ...resource,
      conversation_context_publication: pendingPublication,
    });
    try {
      const fileResult = removeConversationContextFile({
        themeFolder: ensured.themeFolder,
        conversationId,
        themeId,
        relativePath: publication.relative_path,
        operationId,
        recoveryDirectory: this.conversationContextRecoveryDirectory,
      });
      this.saveConversationContextResource({
        ...pendingResource,
        conversation_context_publication: {
          ...pendingPublication,
          status: "removed",
          content_hash: null,
          source_revision: null,
          operation_id: null,
          removed_at: this.now(),
          updated_at: this.now(),
        },
      });
      completeConversationContextOperation(this.conversationContextRecoveryDirectory, operationId);
      const pack = this.publishThemeAiPackAfterConversationChange(themeId);
      return {
        conversationId,
        themeId,
        publicationState: "removed",
        removed: fileResult.removed,
        themePackState: pack.state,
        ...(pack.error
          ? {
              warning:
                "AI Contextから外しましたが、Theme AI Packを更新できませんでした。Theme画面から再試行してください。",
            }
          : {}),
      };
    } catch (error) {
      try {
        const recoverable = listConversationContextOperations(
          this.conversationContextRecoveryDirectory,
        ).some(
          (item) =>
            item.receipt?.operationId === operationId && item.receipt.phase === "file_removed",
        );
        const current = this.repository.get("resource", conversationId);
        if (
          current &&
          normalizeConversationContextPublication(current.conversation_context_publication)
            ?.operation_id === operationId
        ) {
          this.saveConversationContextResource({
            ...current,
            conversation_context_publication: {
              ...pendingPublication,
              status: "removal_failed",
              operation_id: recoverable ? operationId : null,
              last_error: "file_or_database_write_failed",
              updated_at: this.now(),
            },
          });
        }
      } catch {
        // Receiptとremoving stateを残し、次回起動でfile absence確認後に復旧する。
      }
      throw new Error(
        "AI Contextファイルを解除できませんでした。OneDriveの同期状態と保存先を確認して再試行してください。",
      );
    }
  }

  private recoverConversationContextReceipts(): void {
    for (const item of listConversationContextOperations(
      this.conversationContextRecoveryDirectory,
    )) {
      const receipt = item.receipt;
      if (!receipt) {
        console.warn(
          `Conversation AI Context recovery receiptを読めませんでした。${item.error || ""}`,
        );
        continue;
      }
      try {
        const resource = this.repository.get("resource", receipt.conversationId, true);
        const publication = normalizeConversationContextPublication(
          resource?.conversation_context_publication,
        );
        if (!resource || !publication || publication.operation_id !== receipt.operationId) {
          // 新しい操作が正本なら古いreceiptは再適用しない。
          completeConversationContextOperation(
            this.conversationContextRecoveryDirectory,
            receipt.operationId,
          );
          continue;
        }
        const theme =
          this.repository.get("theme", receipt.themeId, true) ||
          this.repository.get("project", receipt.themeId, true);
        if (!theme) throw new Error("Themeが見つかりません。");
        const location = this.resolveThemeAiPack(theme);
        if (location.status !== "ok")
          throw new Error(`Theme保存先を再発見できません: ${location.status}`);
        let phase = receipt.phase;
        if (phase === "planned") {
          const storage = inspectConversationContextFile({
            themeFolder: location.themeFolder,
            relativePath: receipt.relativePath,
            contentHash: receipt.contentHash,
          });
          if (receipt.action === "publish" && storage.current) phase = "file_written";
          else if (receipt.action === "remove" && !storage.exists) phase = "file_removed";
          else {
            this.saveConversationContextResource({
              ...resource,
              conversation_context_publication: {
                ...publication,
                status: receipt.action === "publish" ? "publish_failed" : "removal_failed",
                operation_id: null,
                last_error: "file_operation_incomplete",
                updated_at: this.now(),
              },
            });
            completeConversationContextOperation(
              this.conversationContextRecoveryDirectory,
              receipt.operationId,
            );
            continue;
          }
        }
        if (receipt.action === "publish" && phase === "file_written") {
          const storage = inspectConversationContextFile({
            themeFolder: location.themeFolder,
            relativePath: receipt.relativePath,
            contentHash: receipt.contentHash,
          });
          if (!storage.current) throw new Error("公開fileのread-back hashが一致しません。");
          this.saveConversationContextResource({
            ...resource,
            conversation_context_publication: {
              ...publication,
              status: "published",
              operation_id: null,
              last_error: null,
              updated_at: this.now(),
            },
          });
          completeConversationContextOperation(
            this.conversationContextRecoveryDirectory,
            receipt.operationId,
          );
          this.publishThemeAiPackAfterConversationChange(receipt.themeId);
          continue;
        }
        if (receipt.action === "remove" && phase === "file_removed") {
          const storage = inspectConversationContextFile({
            themeFolder: location.themeFolder,
            relativePath: receipt.relativePath,
            contentHash: publication.content_hash,
          });
          if (storage.exists) throw new Error("解除済みfileが残っています。");
          this.saveConversationContextResource({
            ...resource,
            conversation_context_publication: {
              ...publication,
              status: "removed",
              content_hash: null,
              source_revision: null,
              operation_id: null,
              removed_at: this.now(),
              last_error: null,
              updated_at: this.now(),
            },
          });
          completeConversationContextOperation(
            this.conversationContextRecoveryDirectory,
            receipt.operationId,
          );
          this.publishThemeAiPackAfterConversationChange(receipt.themeId);
          continue;
        }
        throw new Error("file操作が完了していないため自動確定できません。");
      } catch (error) {
        console.warn(
          `Conversation AI Context ${receipt.operationId} を自動復旧できませんでした。${errorText(error)}`,
        );
      }
    }
  }

  getThemeAiPackPreview(themeIdValue: unknown): ThemeAiPackPreviewResult {
    const { theme, plan } = this.buildThemeAiPack(themeIdValue);
    const location = this.resolveThemeAiPack(theme);
    const storage =
      location.status === "ok"
        ? inspectThemeAiPack({ plan, packDirectory: location.packDirectory })
        : { state: location.status, dirty: true };
    return {
      themeId: plan.theme_id,
      contentHash: plan.content_hash,
      plannedGeneratedAt: plan.generated_at,
      lastPublishedAt: "manifest" in storage ? String(storage.manifest?.generatedAt || "") : "",
      sourceRevision: plan.source_revision,
      state: storage.state,
      dirty: storage.dirty,
      retryPending: location.status === "needs_root" || location.status === "root_unavailable",
      locationStatus: location.status,
      canOpenFolder:
        location.status === "ok" &&
        isSafeThemeAiPackDirectory(location.themeFolder, location.packDirectory),
      files: plan.files.map((file, index) => ({
        name: file.name,
        content: file.content,
        includedCount: plan.preview.files[index]?.includedCount || 0,
        characterCount: plan.preview.files[index]?.characterCount || file.content.length,
      })),
      includedCount: plan.preview.includedCount,
      excludedCount: plan.preview.excludedCount,
      excludedReasons: plan.preview.excludedReasons,
      warnings: plan.preview.warnings,
      totalCharacterCount: plan.preview.totalCharacterCount,
    };
  }

  getThemeAiPackStatus(themeIdValue: unknown): ThemeAiPackStatusResult {
    const preview = this.getThemeAiPackPreview(themeIdValue);
    const { files, warnings, excludedReasons: _excludedReasons, ...status } = preview;
    return {
      ...status,
      fileCount: files.length,
      warningCount: warnings.length,
    };
  }

  publishThemeAiPack(requestValue: unknown): ThemeAiPackPublishResult {
    const request = objectValue(requestValue);
    const themeId = typeof request.themeId === "string" ? request.themeId.trim() : "";
    const expectedContentHash =
      typeof request.expectedContentHash === "string" ? request.expectedContentHash.trim() : "";
    if (!themeId || !expectedContentHash)
      throw new Error("AI Pack Previewが古いため、内容を確認し直してください。");
    if (this.publishingThemeAiPacks.has(themeId)) {
      return { state: "publishing", dirty: true, retryPending: false, written: false, themeId };
    }
    this.publishingThemeAiPacks.add(themeId);
    try {
      const { theme, plan } = this.buildThemeAiPack(themeId);
      if (plan.content_hash !== expectedContentHash) {
        return {
          state: "stale_preview",
          dirty: true,
          retryPending: false,
          written: false,
          themeId,
          contentHash: plan.content_hash,
        };
      }
      const location = this.resolveThemeAiPack(theme);
      if (location.status !== "ok") {
        return {
          state: location.status,
          dirty: true,
          retryPending: location.status === "needs_root" || location.status === "root_unavailable",
          written: false,
          themeId,
          contentHash: plan.content_hash,
          ...(location.status === "identity_conflict" ? { error: location.reason } : {}),
        };
      }
      const ensured = ensureThemeAiPackLocation(location, { operationId: randomUUID() });
      if (ensured.status !== "ok") throw new Error("AI Packの保存先を準備できませんでした。");
      const result = publishThemeAiPack({
        plan,
        packDirectory: ensured.packDirectory,
        recoveryDirectory: this.themeAiPackRecoveryDirectory,
      });
      return {
        ...result,
        themeId,
        contentHash: plan.content_hash,
        lastPublishedAt: result.manifest?.generatedAt || "",
      };
    } finally {
      this.publishingThemeAiPacks.delete(themeId);
    }
  }

  async openThemeAiPackFolder(themeIdValue: unknown): Promise<{ ok: boolean; error?: string }> {
    const { theme } = this.buildThemeAiPack(themeIdValue);
    const location = this.resolveThemeAiPack(theme);
    if (location.status !== "ok")
      return {
        ok: false,
        error: "AI Packの保存Rootを利用できません。Settingsを確認してください。",
      };
    const resolvedPackDirectory = path.resolve(location.packDirectory);
    if (!fs.existsSync(resolvedPackDirectory)) {
      return {
        ok: false,
        error: "AI Packはまだ生成されていません。内容を確認して更新してください。",
      };
    }
    if (!isSafeThemeAiPackDirectory(location.themeFolder, resolvedPackDirectory)) {
      return {
        ok: false,
        error: "AI Packの保存先にsymlink/junctionは利用できません。Settingsを確認してください。",
      };
    }
    const error = await shell.openPath(resolvedPackDirectory);
    return error ? { ok: false, error } : { ok: true };
  }

  private readCanonicalFile(filePath: string): CanonicalFileSnapshot {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile())
        return {
          exists: false,
          content: "",
          signature: "",
          size: null,
          mtimeMs: null,
          error: "正本Markdownが通常のファイルではありません。",
        };
      const rawContent = fs.readFileSync(filePath);
      const content = rawContent.toString("utf8");
      return {
        exists: true,
        content,
        signature: bufferSignature(rawContent),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        try {
          fs.statSync(path.dirname(filePath));
          return { exists: false, content: "", signature: "", size: null, mtimeMs: null };
        } catch (directoryError) {
          return {
            exists: false,
            content: "",
            signature: "",
            size: null,
            mtimeMs: null,
            error: errorText(directoryError),
          };
        }
      }
      return {
        exists: false,
        content: "",
        signature: "",
        size: null,
        mtimeMs: null,
        error: errorText(error),
      };
    }
  }

  private readCanonicalRecoveryReceipts(): CanonicalRecoveryReceipt[] {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(this.canonicalRecoveryPath, "utf8"));
      if (!Array.isArray(parsed)) throw new Error("recovery receiptのJSON配列が必要です。");
      const receipts = parsed.filter(
        (entry): entry is CanonicalRecoveryReceipt =>
          Boolean(entry) &&
          typeof entry === "object" &&
          typeof (entry as Record<string, unknown>).operationId === "string" &&
          typeof (entry as Record<string, unknown>).noteId === "string" &&
          typeof (entry as Record<string, unknown>).filePath === "string" &&
          typeof (entry as Record<string, unknown>).content === "string" &&
          typeof (entry as Record<string, unknown>).entity === "object" &&
          typeof (entry as Record<string, unknown>).binding === "object",
      );
      if (receipts.length !== parsed.length)
        throw new Error("recovery receiptの項目形式が不正です。");
      for (const receipt of receipts) {
        if (
          String(receipt.entity.id || "") !== receipt.noteId ||
          "additionalOperations" in receipt
        ) {
          throw new Error("recovery receiptのNoteまたは副作用schemaが不正です。");
        }
        normalizeCanonicalNoteAiCompanion(receipt.noteAiCompanion, receipt.noteId);
      }
      return receipts;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
      this.quarantineCorruptCanonicalRecovery(error);
      return [];
    }
  }

  private quarantineCorruptCanonicalRecovery(error: unknown): void {
    const corruptPath = `${this.canonicalRecoveryPath}.corrupt-${Date.now()}-${randomUUID()}.json`;
    let quarantinedPath = "";
    try {
      if (fs.existsSync(this.canonicalRecoveryPath)) {
        fs.renameSync(this.canonicalRecoveryPath, corruptPath);
        quarantinedPath = corruptPath;
      }
    } catch (quarantineError) {
      quarantinedPath = `退避失敗: ${errorText(quarantineError)}`;
    }
    const warning = {
      detectedAt: new Date().toISOString(),
      recoveryPath: this.canonicalRecoveryPath,
      quarantinedPath,
      reason: errorText(error),
    };
    try {
      this.writeAtomicText(
        this.canonicalRecoveryWarningPath,
        `${JSON.stringify(warning, null, 2)}\n`,
        randomUUID(),
      );
    } catch (warningError) {
      // JSON破損を握りつぶさないため、警告ファイルの作成失敗もMainログへ残す。
      console.warn(
        `canonical Markdown recovery receiptの警告保存に失敗しました。${errorText(warningError)}`,
      );
    }
    console.warn(`canonical Markdown recovery receiptを検証できませんでした。${errorText(error)}`);
  }

  private writeCanonicalRecoveryReceipts(receipts: CanonicalRecoveryReceipt[]): void {
    if (!receipts.length) {
      try {
        if (fs.existsSync(this.canonicalRecoveryPath)) fs.unlinkSync(this.canonicalRecoveryPath);
      } catch {
        // 復旧済みreceiptの掃除失敗は、次回起動時に再確認できるよう無視する。
      }
      return;
    }
    this.writeAtomicText(
      this.canonicalRecoveryPath,
      `${JSON.stringify(receipts, null, 2)}\n`,
      randomUUID(),
    );
  }

  private addCanonicalRecoveryReceipt(receipt: CanonicalRecoveryReceipt): void {
    const receipts = this.readCanonicalRecoveryReceipts().filter(
      (entry) => entry.operationId !== receipt.operationId,
    );
    receipts.push(receipt);
    this.writeCanonicalRecoveryReceipts(receipts);
  }

  private removeCanonicalRecoveryReceipt(operationId: string): void {
    this.writeCanonicalRecoveryReceipts(
      this.readCanonicalRecoveryReceipts().filter((entry) => entry.operationId !== operationId),
    );
  }

  private sameCanonicalBinding(
    left: ReturnType<typeof normalizeCanonicalMarkdownBinding> | null,
    right: ReturnType<typeof normalizeCanonicalMarkdownBinding> | null,
  ): boolean {
    if (!left || !right) return left === right;
    const keys: Array<keyof typeof left> = [
      "schema_version",
      "binding_id",
      "mode",
      "canonical_path",
      "directory",
      "root_identity",
      "file_name",
      "body_signature",
      "file_signature",
      "file_size",
      "file_mtime_ms",
      "last_synced_revision",
      "sync_state",
      "last_operation_id",
      "last_attempt_at",
      "last_synced_at",
      "last_error",
      "file_ahead_signature",
    ];
    return keys.every((key) => left[key] === right[key]);
  }

  private resolveCanonicalRecoveryReceiptsForSave(
    noteId: string,
    operationId: string,
    actualRevision: number,
  ): void {
    // 同じNoteの、今回の保存開始時点以前のreceiptは新しいin_sync正本で
    // supersedeされたものとして解決する。別Noteや未来のrevisionは残す。
    try {
      this.writeCanonicalRecoveryReceipts(
        this.readCanonicalRecoveryReceipts().filter(
          (receipt) =>
            receipt.noteId !== noteId ||
            (receipt.operationId !== operationId &&
              Number(receipt.baseRevision || 0) > actualRevision),
        ),
      );
    } catch (error) {
      // DB/fileの正本保存自体は成功している。receipt掃除だけ失敗した場合は
      // warningを残し、次回起動のin_sync照合で安全に解決できるようreceiptを保つ。
      console.warn(`canonical Markdown recovery receiptの解決に失敗しました。${errorText(error)}`);
    }
  }

  private recoverCanonicalMarkdownReceipts(): void {
    const receipts = this.readCanonicalRecoveryReceipts();
    if (!receipts.length) return;
    const remaining: CanonicalRecoveryReceipt[] = [];
    for (const receipt of receipts) {
      try {
        const companions = normalizeDocumentSaveCompanions(receipt.companions, receipt.noteId);
        const noteAiCompanion = normalizeCanonicalNoteAiCompanion(
          receipt.noteAiCompanion,
          receipt.noteId,
        );
        const current = this.repository.get("note", receipt.noteId, true);
        // receiptはfile write後の復旧候補であり、DBのcurrentを上書きする正本ではない。
        const snapshot = this.readCanonicalFile(receipt.filePath);
        const expectedSignature = markdownSignature(receipt.content);
        const binding = normalizeCanonicalMarkdownBinding(receipt.binding, {
          noteId: receipt.noteId,
        });
        const baseRevision = Number.isInteger(receipt.baseRevision)
          ? Number(receipt.baseRevision)
          : Number(receipt.entity.version || 0);
        const currentBody = String(current?.body_markdown || "");
        const currentBinding = current
          ? canonicalMarkdownBindingFromProperties(objectValue(current.properties_json), {
              noteId: receipt.noteId,
            })
          : null;
        const receiptBodySignature =
          receipt.bodySignature || markdownSignature(String(receipt.entity.body_markdown || ""));
        // A verification mismatch can persist the intended entity and its
        // internal_ahead binding before the process restarts. That save is
        // version base+1, but it is still this receipt's own attempt. Only an
        // exact operation/body/revision match is exempted; a later edit keeps
        // the normal currentAdvanced protection below.
        const sameReceiptAttempt = Boolean(
          current &&
          Number(current.version || 0) === baseRevision + 1 &&
          currentBinding?.last_operation_id === receipt.operationId &&
          markdownSignature(currentBody) === receiptBodySignature,
        );
        // receipt.entity is the attempted new state, so its body/title naturally
        // differ from the unchanged DB row after a file-success/DB-failure. A
        // repository save always advances the entity revision; use that typed
        // revision boundary to distinguish a later DB edit from the original
        // operation instead of treating the expected file contents as evidence
        // that the DB was edited concurrently.
        const currentAdvanced = Boolean(
          current && Number(current.version || 0) > baseRevision && !sameReceiptAttempt,
        );
        // 同じrevisionのcurrentはDB保存に失敗した元の行なので、receiptの
        // intended entityを適用する。後続revisionだけはcurrentを正本として保つ。
        const entity: Record<string, unknown> =
          currentAdvanced && current ? current : receipt.entity;
        if (currentAdvanced && current) {
          // 後続のcanonical saveがすでにin_syncへ到達していれば、この旧receiptを
          // 再度conflict化しない。本文・実ファイル署名も一致する場合だけ解決する。
          if (
            currentBinding?.sync_state === "in_sync" &&
            currentBinding.body_signature === markdownSignature(currentBody) &&
            currentBinding.file_signature === snapshot.signature &&
            snapshot.exists &&
            !snapshot.error
          ) {
            continue;
          }
          const conflict = normalizeCanonicalMarkdownBinding(
            {
              ...binding,
              ...(currentBinding || {}),
              sync_state: snapshot.error || !snapshot.exists ? "unavailable" : "conflict",
              body_signature: markdownSignature(currentBody),
              file_signature: snapshot.signature,
              file_size: snapshot.size,
              file_mtime_ms: snapshot.mtimeMs,
              last_synced_revision: null,
              file_ahead_signature: snapshot.signature,
              last_error:
                "復旧receiptより新しいDB変更があるため、旧MarkdownをDBへ戻さずconflictとして保持しています。確認してから再保存してください。",
            },
            { noteId: receipt.noteId },
          );
          if (!this.sameCanonicalBinding(currentBinding, conflict)) {
            this.repository.save(
              "note",
              {
                ...current,
                properties_json: withCanonicalMarkdownBinding(
                  objectValue(current.properties_json),
                  conflict,
                ),
              },
              { source: "canonical-recovery", __canonicalOperationAt: this.now() },
            );
          }
          remaining.push(receipt);
          continue;
        }
        if (!snapshot.exists || snapshot.error || snapshot.signature !== expectedSignature) {
          const errorMessage =
            snapshot.error ||
            (!snapshot.exists
              ? "保存したMarkdownが見つかりません。"
              : "保存したMarkdownの内容が一致しません。");
          const conflict = normalizeCanonicalMarkdownBinding(
            {
              ...binding,
              sync_state: snapshot.error ? "unavailable" : "conflict",
              file_ahead_signature: snapshot.signature,
              last_error: errorMessage,
            },
            { noteId: receipt.noteId },
          );
          if (
            !current ||
            current.body_markdown !== entity.body_markdown ||
            currentBinding?.sync_state !== conflict.sync_state ||
            currentBinding?.file_ahead_signature !== conflict.file_ahead_signature ||
            currentBinding?.last_error !== conflict.last_error
          ) {
            this.saveNoteInternally(
              entity,
              conflict,
              {
                source: "canonical-recovery",
                __canonicalOperationAt: receipt.operationAt || this.now(),
              },
              companions,
              noteAiCompanion,
            );
          }
          remaining.push(receipt);
          continue;
        }
        const synced = normalizeCanonicalMarkdownBinding(
          {
            ...binding,
            sync_state: "in_sync",
            body_signature: markdownSignature(String(entity.body_markdown || "")),
            file_signature: snapshot.signature,
            file_size: snapshot.size,
            file_mtime_ms: snapshot.mtimeMs,
            last_synced_revision: Number(current?.version || 0) + 1,
            last_synced_at: receipt.operationAt || this.now(),
            last_error: "",
            file_ahead_signature: "",
          },
          { noteId: receipt.noteId },
        );
        this.saveNoteInternally(
          entity,
          synced,
          {
            source: "canonical-recovery",
            __canonicalOperationAt: receipt.operationAt || this.now(),
          },
          companions,
          noteAiCompanion,
        );
      } catch {
        // receiptは検証とDB保存の両方が成功するまで残し、次回起動で再試行する。
        remaining.push(receipt);
      }
    }
    this.writeCanonicalRecoveryReceipts(remaining);
  }

  private resolveCanonicalTarget(
    note: Record<string, unknown>,
    binding: ReturnType<typeof normalizeCanonicalMarkdownBinding> | null,
  ): CanonicalTarget | null {
    const noteId = String(note.id || "");
    const themeId = String(note.project_id || note.theme_id || "").trim() || null;
    if (binding?.canonical_path) {
      assertExplicitCanonicalPath(binding.canonical_path);
      const filePath = path.resolve(binding.canonical_path);
      if (path.extname(filePath).toLowerCase() !== ".md") {
        throw new Error("canonical Markdownの保存先は.mdファイルにしてください。");
      }
      return {
        filePath,
        directory: path.dirname(filePath),
        rootIdentity: binding.root_identity || markdownSignature(path.dirname(filePath)),
        configuredRoot: false,
      };
    }

    const location = this.resolveThemeContentDirectory(themeId, "notes");
    if (location.kind === "needs_directory") return null;
    const directory = location.directory;
    const baseName = safeMarkdownFileName(String(note.title || noteId || "markdown-document"));
    const extension = path.extname(baseName);
    const stem = baseName.slice(0, -extension.length);
    let fileName = baseName;
    let filePath = path.join(directory, fileName);
    if (fs.existsSync(filePath)) {
      const stableSuffix = noteId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 8) || "note";
      fileName = `${stem}-${stableSuffix}${extension}`;
      filePath = path.join(directory, fileName);
      let duplicate = 2;
      while (fs.existsSync(filePath)) {
        fileName = `${stem}-${stableSuffix}-${duplicate}${extension}`;
        filePath = path.join(directory, fileName);
        duplicate += 1;
      }
    }
    assertGeneratedCanonicalPath(directory, filePath);
    return {
      filePath,
      directory,
      rootIdentity: markdownSignature(path.resolve(directory)),
      configuredRoot: true,
    };
  }

  private bindingForAttempt(
    binding: ReturnType<typeof normalizeCanonicalMarkdownBinding> | null,
    noteId: string,
    target: CanonicalTarget | null,
    operationId: string,
    attemptAt: string,
    patch: Record<string, unknown> = {},
  ): ReturnType<typeof normalizeCanonicalMarkdownBinding> {
    return normalizeCanonicalMarkdownBinding(
      {
        ...(binding || {}),
        binding_id: binding?.binding_id || `note:${noteId}`,
        canonical_path: target?.filePath || binding?.canonical_path || "",
        directory: target?.directory || binding?.directory || "",
        root_identity: target?.rootIdentity || binding?.root_identity || "",
        file_name: target ? path.basename(target.filePath) : binding?.file_name || "",
        last_operation_id: operationId,
        last_attempt_at: attemptAt,
        ...patch,
      },
      { noteId },
    );
  }

  private saveNoteInternally(
    note: Record<string, unknown>,
    binding: ReturnType<typeof normalizeCanonicalMarkdownBinding>,
    options: CanonicalSaveOptions,
    companions: DocumentSaveReferenceCompanion[] = [],
    noteAiCompanion: CanonicalNoteAiCompanion | null = null,
  ): Record<string, unknown> {
    const noteOperation = {
      action: "save" as const,
      type: "note",
      entity: {
        ...note,
        properties_json: withCanonicalMarkdownBinding(objectValue(note.properties_json), binding),
      },
      options,
    };
    const existingReferences = this.repository.list("reference", true);
    const stableLinks = reconcileStableLinkAssertions(
      { type: "note", id: String(note.id) },
      String(note.body_markdown || ""),
      existingReferences,
      { recordedAt: options.__canonicalOperationAt, origin: "user" },
    );
    const existingById = new Map(
      existingReferences.map((reference) => [String(reference.id), reference]),
    );
    const stableLinkOperations = stableLinks.upsert_assertions
      .filter((assertion) => {
        const target = assertion.object as { type: string; id: string };
        // A canonical token may already be broken. Keep the Note save usable;
        // only an endpoint that currently exists can become a new assertion.
        // An assertion whose endpoint was deleted remains untouched below and
        // is projected as a broken diagnostic.
        return (
          Boolean(this.repository.get(target.type, target.id)) &&
          !sameStableLinkAssertion(existingById.get(String(assertion.id)), assertion)
        );
      })
      .map((assertion) => ({
        action: "save" as const,
        type: "reference",
        entity: assertion,
        options: { source: "manual", reason: "stable_internal_link" },
      }));
    const staleLinkIds = stableLinks.delete_assertion_ids
      .map((id) => existingById.get(id))
      .filter((reference): reference is Record<string, unknown> =>
        Boolean(reference && !reference.deleted_at),
      )
      .map((reference) => String(reference.id));
    const relationOperations = [
      ...companions,
      ...stableLinkOperations,
      ...canonicalNoteAiOperations(noteAiCompanion),
    ];
    if (staleLinkIds.length) {
      return this.repository.runTransaction((transaction) => {
        const saved = transaction.save(noteOperation.type, noteOperation.entity, options);
        for (const operation of relationOperations) {
          transaction.save(operation.type, operation.entity, operation.options);
        }
        for (const id of staleLinkIds) transaction.remove("reference", id);
        return saved;
      });
    }
    if (!relationOperations.length)
      return this.repository.save(noteOperation.type, noteOperation.entity, options);
    return this.repository.saveMany([noteOperation, ...relationOperations])[0];
  }

  private canonicalThemeName(note: Record<string, unknown>): string {
    const themeId = String(note.project_id || note.theme_id || "").trim();
    if (!themeId) return "";
    const theme = this.repository.get("theme", themeId) || this.repository.get("project", themeId);
    return String(theme?.name || theme?.title || "");
  }

  saveCanonicalNote(requestValue: unknown, companionValue?: unknown): Record<string, unknown> {
    const request = normalizeDocumentSaveRequest(requestValue);
    const input = { ...request.entity, body_markdown: request.snapshot.body };
    const noteId = request.snapshot.owner.entityId;
    const noteAiCompanion = normalizeCanonicalNoteAiCompanion(companionValue, noteId);
    const current = this.repository.get("note", noteId, true);
    const actualRevision = Number(current?.version || 0);
    if (actualRevision !== request.snapshot.expectedRevision) {
      throw new Error(
        `Noteが更新済みです（expected revision ${request.snapshot.expectedRevision}, actual ${actualRevision}）。古い編集画面を閉じて再試行してください。`,
      );
    }
    const note: Record<string, unknown> = { ...(current || {}), ...input, id: noteId };
    const properties = objectValue(note.properties_json);
    const binding = canonicalMarkdownBindingFromProperties(properties, { noteId });
    const operationId = randomUUID();
    const attemptAt = this.now();
    const options: CanonicalSaveOptions = {
      ...(request.options || {}),
      __canonicalOperationAt: attemptAt,
    };
    const content = buildCanonicalMarkdownContent({
      title: String(note.title || ""),
      themeName: this.canonicalThemeName(note),
      updatedAt: attemptAt,
      body: String(note.body_markdown || ""),
    });
    const nextRevision = Number(current?.version || 0) + 1;
    const target = this.resolveCanonicalTarget(note, binding);
    const baseAttempt = this.bindingForAttempt(binding, noteId, target, operationId, attemptAt);

    if (!target) {
      return this.saveNoteInternally(
        note,
        baseAttempt,
        options,
        request.companions,
        noteAiCompanion,
      );
    }

    try {
      fs.mkdirSync(target.directory, { recursive: true });
      if (target.configuredRoot) {
        assertConfiguredCanonicalPath(target.directory, target.filePath);
      } else {
        assertExplicitCanonicalPath(target.filePath);
      }
    } catch (error) {
      const unavailable = this.bindingForAttempt(binding, noteId, target, operationId, attemptAt, {
        sync_state: "unavailable",
        last_error: errorText(error),
      });
      return this.saveNoteInternally(
        note,
        unavailable,
        options,
        request.companions,
        noteAiCompanion,
      );
    }
    const snapshot = this.readCanonicalFile(target.filePath);
    if (snapshot.error) {
      const unavailable = this.bindingForAttempt(binding, noteId, target, operationId, attemptAt, {
        sync_state: "unavailable",
        last_error: snapshot.error,
      });
      return this.saveNoteInternally(
        note,
        unavailable,
        options,
        request.companions,
        noteAiCompanion,
      );
    }

    const plan = planCanonicalMarkdownWrite({
      canonicalPath: target.filePath,
      nextContent: content,
      lastWrittenSignature: baseAttempt.file_signature,
      currentFileSignature: snapshot.exists ? snapshot.signature : null,
      fileExists: snapshot.exists,
      rootAvailable: true,
    });
    const overwrite = options.canonicalMarkdown === "overwrite";
    if (plan.action === "confirm" && !overwrite) {
      const conflict = this.bindingForAttempt(binding, noteId, target, operationId, attemptAt, {
        sync_state: "conflict",
        file_ahead_signature: plan.externalSignature,
        last_error: "外部で変更されたMarkdownを確認してから上書きしてください。",
      });
      return this.saveNoteInternally(note, conflict, options, request.companions, noteAiCompanion);
    }

    // overwriteは外部変更との確認を経た明示操作なので、同じ内容に見えても
    // 必ずatomic write→実ファイル再読込→in_syncの経路を通す。
    if (plan.action === "skip" && !overwrite) {
      const synced = this.bindingForAttempt(binding, noteId, target, operationId, attemptAt, {
        sync_state: "in_sync",
        body_signature: markdownSignature(String(note.body_markdown || "")),
        file_signature: snapshot.signature || markdownSignature(content),
        file_size: snapshot.size,
        file_mtime_ms: snapshot.mtimeMs,
        last_synced_revision: nextRevision,
        last_synced_at: attemptAt,
        last_error: "",
        file_ahead_signature: "",
      });
      const saved = this.saveNoteInternally(
        note,
        synced,
        options,
        request.companions,
        noteAiCompanion,
      );
      this.resolveCanonicalRecoveryReceiptsForSave(noteId, operationId, actualRevision);
      return saved;
    }

    const pending = this.bindingForAttempt(binding, noteId, target, operationId, attemptAt, {
      sync_state: "internal_ahead",
      file_signature: markdownSignature(content),
      last_synced_revision: null,
    });
    this.addCanonicalRecoveryReceipt({
      operationId,
      noteId,
      entity: {
        ...note,
        properties_json: withCanonicalMarkdownBinding(properties, pending),
      },
      filePath: target.filePath,
      content,
      binding: { ...pending },
      operationAt: attemptAt,
      baseRevision: actualRevision,
      bodySignature: markdownSignature(String(note.body_markdown || "")),
      companions: request.companions,
      noteAiCompanion: noteAiCompanion || undefined,
    });
    let writeWarning: string | null = null;
    try {
      writeWarning = this.writeAtomicText(target.filePath, content, operationId);
    } catch (error) {
      const failed = this.bindingForAttempt(binding, noteId, target, operationId, attemptAt, {
        sync_state: "internal_ahead",
        last_error: errorText(error),
      });
      this.removeCanonicalRecoveryReceipt(operationId);
      return this.saveNoteInternally(note, failed, options, request.companions, noteAiCompanion);
    }

    const written = this.readCanonicalFile(target.filePath);
    const expectedSignature = markdownSignature(content);
    if (written.error || !written.exists || written.signature !== expectedSignature) {
      const failed = this.bindingForAttempt(binding, noteId, target, operationId, attemptAt, {
        sync_state: "internal_ahead",
        body_signature: markdownSignature(String(note.body_markdown || "")),
        file_signature: expectedSignature,
        last_error:
          written.error || "書き込んだMarkdownの内容を検証できませんでした。再試行してください。",
      });
      this.saveNoteInternally(note, failed, options, request.companions, noteAiCompanion);
      // 実ファイルの再検証に成功するまでreceiptは残す。
      return this.repository.get("note", noteId, true) || note;
    }
    const synced = this.bindingForAttempt(binding, noteId, target, operationId, attemptAt, {
      sync_state: "in_sync",
      body_signature: markdownSignature(String(note.body_markdown || "")),
      file_signature: written.signature,
      file_size: written.size,
      file_mtime_ms: written.mtimeMs,
      last_synced_revision: nextRevision,
      last_synced_at: attemptAt,
      last_error: writeWarning || "",
      file_ahead_signature: "",
    });
    try {
      const saved = this.saveNoteInternally(
        note,
        synced,
        options,
        request.companions,
        noteAiCompanion,
      );
      this.resolveCanonicalRecoveryReceiptsForSave(noteId, operationId, actualRevision);
      return saved;
    } catch (error) {
      throw new Error(
        `Markdownは更新しましたが、Tasken内部への保存に失敗しました。再起動後に復旧します。${errorText(error)}`,
      );
    }
  }

  private migrateCanonicalMarkdownBindings(): void {
    const notes = this.repository.list("note");
    for (const note of notes) {
      const properties = objectValue(note.properties_json);
      if (
        properties.canonical_markdown &&
        typeof properties.canonical_markdown === "object" &&
        !Array.isArray(properties.canonical_markdown)
      )
        continue;
      const noteId = String(note.id || "");
      if (!noteId) continue;
      const legacy = canonicalMarkdownBindingFromProperties(properties, { noteId });
      const operationId = randomUUID();
      const attemptAt = this.now();
      const migrationOptions: CanonicalSaveOptions = {
        source: "canonical-migration",
        quiet: true,
        __canonicalOperationAt: attemptAt,
      };
      let target: CanonicalTarget | null;
      try {
        target = this.resolveCanonicalTarget(note, legacy);
      } catch (error) {
        const binding = this.bindingForAttempt(legacy, noteId, null, operationId, attemptAt, {
          sync_state: "unavailable",
          last_error: errorText(error),
        });
        this.saveNoteInternally(note, binding, migrationOptions);
        continue;
      }
      if (!target) {
        const binding = this.bindingForAttempt(legacy, noteId, null, operationId, attemptAt, {
          sync_state: "unavailable",
          last_error:
            "設定済みのMarkdown保存ルートがありません。Settingsで保存先を確認してください。",
        });
        this.saveNoteInternally(note, binding, migrationOptions);
        continue;
      }
      try {
        fs.mkdirSync(target.directory, { recursive: true });
        if (target.configuredRoot) {
          assertConfiguredCanonicalPath(target.directory, target.filePath);
        } else {
          assertExplicitCanonicalPath(target.filePath);
        }
      } catch (error) {
        const binding = this.bindingForAttempt(legacy, noteId, target, operationId, attemptAt, {
          sync_state: "unavailable",
          last_error: errorText(error),
        });
        this.saveNoteInternally(note, binding, migrationOptions);
        continue;
      }
      const content = buildCanonicalMarkdownContent({
        title: String(note.title || ""),
        themeName: this.canonicalThemeName(note),
        updatedAt: attemptAt,
        body: String(note.body_markdown || ""),
      });
      const expectedSignature = markdownSignature(content);
      // 既存legacy fileの照合はmigration実行時刻に依存させない。
      // 新規作成時だけoperationAtをfrontmatterへ使い、既存fileはNote保存時刻で比較する。
      const legacyContent = buildCanonicalMarkdownContent({
        title: String(note.title || ""),
        themeName: this.canonicalThemeName(note),
        updatedAt: String(note.updated_at || note.created_at || ""),
        body: String(note.body_markdown || ""),
      });
      const legacyExpectedSignature = markdownSignature(legacyContent);
      const snapshot = this.readCanonicalFile(target.filePath);
      if (snapshot.error) {
        const binding = this.bindingForAttempt(legacy, noteId, target, operationId, attemptAt, {
          sync_state: "unavailable",
          last_error: snapshot.error,
        });
        this.saveNoteInternally(note, binding, migrationOptions);
        continue;
      }
      if (snapshot.exists) {
        const knownFileSignature = legacy?.file_signature || "";
        const contentMatches = snapshot.signature === legacyExpectedSignature;
        // 既知signatureがある場合は、同じ実fileを指すこと自体が前回保存の根拠になる。
        // signatureが無いlegacyだけは、migration時刻ではなくNote保存時刻でcanonical本文を照合する。
        const externallyChanged = Boolean(
          knownFileSignature ? knownFileSignature !== snapshot.signature : !contentMatches,
        );
        const binding = this.bindingForAttempt(legacy, noteId, target, operationId, attemptAt, {
          sync_state: externallyChanged ? "conflict" : "in_sync",
          body_signature: markdownSignature(String(note.body_markdown || "")),
          file_signature: snapshot.signature,
          file_size: snapshot.size,
          file_mtime_ms: snapshot.mtimeMs,
          last_synced_revision: externallyChanged ? null : Number(note.version || 0) + 1,
          last_synced_at: externallyChanged ? "" : attemptAt,
          last_error: externallyChanged
            ? contentMatches
              ? "既存Markdownが前回保存時から外部で変更されています。確認してから上書きしてください。"
              : "既存Markdownの内容がNoteから生成したcanonical本文と一致しません。確認してから上書きしてください。"
            : "",
          file_ahead_signature: externallyChanged ? snapshot.signature : "",
        });
        this.saveNoteInternally(note, binding, migrationOptions);
        continue;
      }
      const pending = this.bindingForAttempt(legacy, noteId, target, operationId, attemptAt, {
        sync_state: "internal_ahead",
        body_signature: markdownSignature(String(note.body_markdown || "")),
        file_signature: expectedSignature,
        last_synced_revision: null,
        last_error: "既存Noteから正本Markdownへ移行中です。失敗時は次回起動で再試行します。",
      });
      this.addCanonicalRecoveryReceipt({
        operationId,
        noteId,
        entity: {
          ...note,
          properties_json: withCanonicalMarkdownBinding(properties, pending),
        },
        filePath: target.filePath,
        content,
        binding: { ...pending },
        operationAt: attemptAt,
        baseRevision: Number(note.version || 0),
        bodySignature: markdownSignature(String(note.body_markdown || "")),
      });
      let fileWriteCompleted = false;
      try {
        const writeWarning = this.writeAtomicText(target.filePath, content, operationId);
        fileWriteCompleted = true;
        const written = this.readCanonicalFile(target.filePath);
        if (written.error || !written.exists || written.signature !== expectedSignature) {
          throw new Error(
            written.error ||
              "移行したMarkdownの内容を検証できませんでした。次回起動で再試行します。",
          );
        }
        const binding = this.bindingForAttempt(legacy, noteId, target, operationId, attemptAt, {
          sync_state: "in_sync",
          body_signature: markdownSignature(String(note.body_markdown || "")),
          file_signature: written.signature,
          file_size: written.size,
          file_mtime_ms: written.mtimeMs,
          last_synced_revision: Number(note.version || 0) + 1,
          last_synced_at: attemptAt,
          last_error: writeWarning || "",
        });
        this.saveNoteInternally(note, binding, migrationOptions);
        this.removeCanonicalRecoveryReceipt(operationId);
      } catch (error) {
        const failed = this.bindingForAttempt(legacy, noteId, target, operationId, attemptAt, {
          sync_state: fileWriteCompleted ? "conflict" : "internal_ahead",
          body_signature: markdownSignature(String(note.body_markdown || "")),
          file_signature: expectedSignature,
          file_ahead_signature: fileWriteCompleted
            ? this.readCanonicalFile(target.filePath).signature
            : "",
          last_error: errorText(error),
        });
        try {
          this.saveNoteInternally(note, failed, migrationOptions);
        } catch {
          // DB自体が使用できない場合はreceiptを残し、次回起動で保存と検証を再試行する。
        }
        if (!fileWriteCompleted) this.removeCanonicalRecoveryReceipt(operationId);
      }
    }
  }

  writeClipboard(text: unknown): boolean {
    clipboard.writeText(String(text));
    return true;
  }

  writeClipboardHtml(payload: unknown): boolean {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error(
        "コピーするHTMLの形式が不正です。画面を再読み込みして、もう一度試してください。",
      );
    }
    const record = payload as Record<string, unknown>;
    const html = typeof record.html === "string" ? record.html : "";
    const text = typeof record.text === "string" ? record.text : "";
    if (!html.trim() || !text.trim()) {
      throw new Error("コピーする本文がありません。");
    }
    clipboard.write({ html, text });
    return true;
  }

  writeClipboardImage(payloadValue: unknown): boolean {
    if (!payloadValue || typeof payloadValue !== "object" || Array.isArray(payloadValue)) {
      throw new Error("コピーする画像の形式が不正です。画面を再読み込みしてください。");
    }
    const payload = payloadValue as Partial<ImageClipboardRequest>;
    if (
      typeof payload.dataUrl !== "string" ||
      !payload.dataUrl.startsWith("data:image/png;base64,")
    ) {
      throw new Error(
        "コピーするPNG画像を作成できませんでした。画面を開き直して、もう一度試してください。",
      );
    }
    const image = nativeImage.createFromDataURL(payload.dataUrl);
    if (image.isEmpty()) {
      throw new Error(
        "コピーする画像を読み取れませんでした。画面を開き直して、もう一度試してください。",
      );
    }
    clipboard.clear();
    clipboard.writeImage(image);
    const written = clipboard.readImage();
    const expectedSize = image.getSize();
    const writtenSize = written.getSize();
    if (
      written.isEmpty() ||
      writtenSize.width !== expectedSize.width ||
      writtenSize.height !== expectedSize.height
    ) {
      throw new Error(
        "Windowsのクリップボードへ画像を書き込めませんでした。クリップボードを使う別アプリを閉じて、もう一度試してください。",
      );
    }
    return true;
  }

  writeClipboardSvg(payloadValue: unknown): MermaidSvgClipboardResult {
    if (!payloadValue || typeof payloadValue !== "object" || Array.isArray(payloadValue)) {
      throw new Error("コピーするSVGの形式が不正です。画面を再読み込みしてください。");
    }
    const payload = payloadValue as Partial<MermaidSvgClipboardRequest>;
    const svg = validateOfficeSvg(payload.svg);
    clipboard.clear();
    clipboard.write({ html: svg, text: "Tasken PowerPoint SVG" });
    clipboard.writeBuffer("image/svg+xml", Buffer.from(svg, "utf8"));
    const formats = clipboard.availableFormats();
    const writtenSvg = clipboard.readBuffer("image/svg+xml").toString("utf8");
    return {
      verified: writtenSvg === svg && formats.some((format) => /svg/i.test(format)),
      formats,
    };
  }

  async openPath(filePathValue: unknown): Promise<{ ok: boolean; error?: string }> {
    if (typeof filePathValue !== "string" || !filePathValue.trim()) {
      throw new Error("開くファイルの場所がありません。");
    }
    const raw = filePathValue.trim();
    // linked Artifact の URL 参照。file プロトコルや未知のスキームは開かない。
    if (/^https?:\/\//i.test(raw)) {
      try {
        await shell.openExternal(raw);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    // UNC / ローカルパス。resolve は相対パス向けで UNC を壊しうるので存在確認を先に。
    const candidates = [raw, path.normalize(raw), path.resolve(raw)];
    const filePath = candidates.find((candidate) => {
      try {
        return fs.existsSync(candidate);
      } catch {
        return false;
      }
    });
    if (!filePath) {
      return {
        ok: false,
        error: "ファイルが見つかりません。出力し直すか、出力先を変更してください。",
      };
    }
    const error = await shell.openPath(filePath);
    return error ? { ok: false, error } : { ok: true };
  }

  private activityCanonicalRootPaths(): Record<string, string> {
    const artifactDirectory = this.repository.getPreference("artifactDirectory");
    return buildActivityRootRegistry({
      artifactDirectory: typeof artifactDirectory === "string" ? artifactDirectory : "",
      themes: this.repository.list("theme", true),
    });
  }

  getActivityCanonicalRootStatus(): Record<string, { status: "ok" | "broken" }> {
    return publicActivityRootStatus(this.activityCanonicalRootPaths(), (root: string) =>
      fs.existsSync(root),
    );
  }

  async openActivityCanonicalRef(value: unknown): Promise<{ ok: boolean; error?: string }> {
    const local = resolveActivityCanonicalLocalPath(value, this.activityCanonicalRootPaths());
    const ref = local.ref;
    if (!ref) return { ok: false, error: "Canonical参照が不正です。" };
    if (!ref.storage_root_id && ref.web_url) return this.openPath(ref.web_url);
    if (!ref.storage_root_id || !ref.relative_path) {
      return { ok: false, error: "開けるCanonical文書の場所がありません。" };
    }

    if (local.status === "outside_root")
      return { ok: false, error: "Canonical文書の参照先が保存Rootの外にあります。" };
    if (local.status === "ok") return this.openPath(local.path);
    if (ref.web_url) return this.openPath(ref.web_url);
    return { ok: false, error: "Canonical文書が見つかりません。保存先を確認してください。" };
  }

  showItemInFolder(filePathValue: unknown): { ok: boolean; error?: string } {
    if (typeof filePathValue !== "string" || !filePathValue.trim()) {
      throw new Error("表示するファイルの場所がありません。");
    }
    const raw = filePathValue.trim();
    if (/^https?:\/\//i.test(raw)) {
      return {
        ok: false,
        error:
          "URLのフォルダは開けません。パスをコピーしてブラウザやエクスプローラーから開いてください。",
      };
    }
    const candidates = [raw, path.normalize(raw), path.resolve(raw)];
    const filePath = candidates.find((candidate) => {
      try {
        return fs.existsSync(candidate);
      } catch {
        return false;
      }
    });
    if (!filePath) {
      return {
        ok: false,
        error:
          "ファイルが見つかりません。移動または削除された可能性があります。保存先をSettingsで確認してください。",
      };
    }
    shell.showItemInFolder(filePath);
    return { ok: true };
  }

  pathExists(filePathValue: unknown): { exists: boolean; kind: "url" | "path"; error?: string } {
    if (typeof filePathValue !== "string" || !filePathValue.trim()) {
      return { exists: false, kind: "path", error: "場所がありません。" };
    }
    const raw = filePathValue.trim();
    if (/^https?:\/\//i.test(raw)) {
      // URL の到達確認は権限・ネットワーク依存のため best-effort で未確認扱い。
      return { exists: false, kind: "url", error: "URLの到達確認は未対応です。" };
    }
    try {
      const candidates = [raw, path.normalize(raw), path.resolve(raw)];
      const exists = candidates.some((candidate) => {
        try {
          return fs.existsSync(candidate);
        } catch {
          return false;
        }
      });
      return { exists, kind: "path" };
    } catch (error) {
      return {
        exists: false,
        kind: "path",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * アプリ内ビューア用にローカルファイルを読む。
   * 画像は data URL、Markdown/テキストは UTF-8 本文。URL や巨大ファイルは拒否する。
   */
  readFilePreview(filePathValue: unknown): FilePreviewReadResult {
    if (typeof filePathValue !== "string" || !filePathValue.trim()) {
      return { ok: false, error: "プレビューするファイルの場所がありません。" };
    }
    const raw = filePathValue.trim();
    if (/^https?:\/\//i.test(raw)) {
      return { ok: false, error: "URLはアプリ内では直接読み込めません。外部で開いてください。" };
    }
    const candidates = [raw, path.normalize(raw), path.resolve(raw)];
    const filePath = candidates.find((candidate) => {
      try {
        return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
      } catch {
        return false;
      }
    });
    if (!filePath) {
      return {
        ok: false,
        error: "ファイルが見つかりません。移動または削除された可能性があります。",
      };
    }
    const extension = path.extname(filePath).toLowerCase();
    const imageMime = PREVIEW_IMAGE_EXT_MIME[extension];
    const textMime = PREVIEW_TEXT_EXT_MIME[extension];
    if (!imageMime && !textMime) {
      return {
        ok: false,
        error: "この形式はアプリ内プレビューに未対応です。外部アプリで開いてください。",
      };
    }
    try {
      const stat = fs.statSync(filePath);
      if (imageMime) {
        if (stat.size > PREVIEW_IMAGE_MAX_BYTES) {
          return {
            ok: false,
            error: "画像が大きすぎるためプレビューできません。外部アプリで開いてください。",
          };
        }
        const bytes = fs.readFileSync(filePath);
        const dataUrl = `data:${imageMime};base64,${bytes.toString("base64")}`;
        return { ok: true, kind: "image", dataUrl, mimeType: imageMime, filePath };
      }
      if (stat.size > PREVIEW_TEXT_MAX_BYTES) {
        return {
          ok: false,
          error: "ファイルが大きすぎるためプレビューできません。外部アプリで開いてください。",
        };
      }
      const text = fs.readFileSync(filePath, "utf8");
      return { ok: true, kind: "text", text, mimeType: textMime || "text/plain", filePath };
    } catch (error) {
      return {
        ok: false,
        error: `ファイルを読めませんでした。${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private resolveWebArtifact(
    artifactIdValue: unknown,
  ):
    | { ok: true; artifact: Record<string, unknown>; filePath: string }
    | { ok: false; error: string } {
    if (typeof artifactIdValue !== "string" || !artifactIdValue.trim()) {
      return { ok: false, error: "Web ArtifactのIDがありません。画面を再読み込みしてください。" };
    }
    const artifact = this.repository.get("artifact", artifactIdValue.trim());
    if (!artifact || artifact.deleted_at) {
      return { ok: false, error: "Web Artifactが見つかりません。削除済みの可能性があります。" };
    }
    if (!isWebArtifact(artifact)) {
      return {
        ok: false,
        error: "このArtifactはWeb Artifactとして扱えません。HTML形式を確認してください。",
      };
    }
    const target = artifactOpenTarget(artifact);
    if (!target || /^https?:\/\//i.test(target)) {
      return {
        ok: false,
        error: "外部URLのHTMLは安全なアプリ内Previewに対応していません。ブラウザで開いてください。",
      };
    }

    const candidates = [target, path.normalize(target), path.resolve(target)];
    const filePath = candidates.find((candidate) => {
      try {
        const stat = fs.lstatSync(candidate);
        return stat.isFile() && !stat.isSymbolicLink();
      } catch {
        return false;
      }
    });
    if (!filePath) {
      return { ok: false, error: "Web Artifactのファイルが見つからないか、安全に確認できません。" };
    }

    return { ok: true, artifact, filePath };
  }

  getWebArtifactPreview(artifactIdValue: unknown): WebArtifactPreviewResult {
    const resolved = this.resolveWebArtifact(artifactIdValue);
    if (!resolved.ok) return resolved;
    const executionPolicy = "sandboxed_interactive" as const;
    return {
      ok: true,
      url: webArtifactPreviewUrl(String(resolved.artifact.id), executionPolicy),
      mimeType: "text/html",
      executionPolicy,
    };
  }

  readWebArtifactPreviewDocument(
    artifactIdValue: unknown,
    policyValue: unknown = "sandboxed_interactive",
  ):
    | { ok: true; html: string; executionPolicy: "static" | "sandboxed_interactive" }
    | { ok: false; error: string } {
    const resolved = this.resolveWebArtifact(artifactIdValue);
    if (!resolved.ok) return resolved;
    const executionPolicy = normalizeWebArtifactExecutionPolicy(policyValue);

    try {
      const stat = fs.statSync(resolved.filePath);
      if (stat.size > PREVIEW_TEXT_MAX_BYTES) {
        return {
          ok: false,
          error: "HTMLが大きすぎるためPreviewできません。外部ブラウザで開いてください。",
        };
      }
      return {
        ok: true,
        html: fs.readFileSync(resolved.filePath, "utf8"),
        executionPolicy,
      };
    } catch {
      return {
        ok: false,
        error: "Web Artifactを読み込めませんでした。ファイルの変更・削除を確認してください。",
      };
    }
  }

  async chooseDirectory(titleValue: unknown): Promise<{ canceled: boolean; path?: string }> {
    const result = await dialog.showOpenDialog({
      title: typeof titleValue === "string" && titleValue.trim() ? titleValue : "フォルダを選択",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return { canceled: false, path: result.filePaths[0] };
  }

  async chooseFiles(
    titleValue: unknown,
  ): Promise<{ canceled: boolean; files?: Array<{ path: string; name: string }> }> {
    const result = await dialog.showOpenDialog({
      title:
        typeof titleValue === "string" && titleValue.trim()
          ? titleValue
          : "Artifact ファイルを選択",
      properties: ["openFile", "multiSelections"],
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    for (const filePath of result.filePaths) {
      rejectGenericAudioArtifact({ filename: filePath }, "選択");
      rejectGenericVideoArtifact({ filename: filePath }, "選択");
    }
    return {
      canceled: false,
      files: result.filePaths.map((filePath) => ({
        path: filePath,
        name: path.basename(filePath),
      })),
    };
  }

  /**
   * Theme 単位のコンテンツ保存先を解決する。
   * contentKind: artifacts | notes | exports
   */
  private resolveThemeContentDirectory(
    themeIdValue: string | null | undefined,
    contentKind: "artifacts" | "notes" | "exports",
    options: { writeThemeManifest?: boolean } = {},
  ): { kind: "needs_directory" } | { kind: "ok"; directory: string } {
    const baseDirectory = String(this.repository.getPreference("artifactDirectory") || "").trim();
    let themeStorageRoot: string | null = null;
    let themeCode: string | null = null;
    let themeId = themeIdValue ? String(themeIdValue).trim() : null;
    if (themeId) {
      const theme =
        this.repository.get("theme", themeId) || this.repository.get("project", themeId);
      if (theme) {
        themeId = String(theme.id || themeId);
        const root = typeof theme.storage_root === "string" ? theme.storage_root.trim() : "";
        themeStorageRoot = root || null;
        const code = typeof theme.code === "string" ? theme.code.trim() : "";
        themeCode = code || null;
      }
    }
    // .mjs の型推論が弱いため、純ロジック呼び出しは明示した関数型を通す。
    const location = (
      resolveThemeContentDirectoryParts as (options: {
        artifactDirectory?: string | null;
        themeId?: string | null;
        themeCode?: string | null;
        themeStorageRoot?: string | null;
        contentKind?: "artifacts" | "notes" | "exports";
      }) => { kind: "needs_directory" } | { kind: "ok"; root: string; segments: string[] }
    )({
      artifactDirectory: baseDirectory,
      themeId,
      themeCode,
      themeStorageRoot,
      contentKind,
    });
    if (location.kind === "needs_directory") return { kind: "needs_directory" };
    const directory = path.join(location.root, ...location.segments);
    // Theme名を変えてもフォルダとThemeの対応を見失わないよう、markerを置く（#306）。
    // 生成は遅延・idempotentで、失敗しても保存自体は止めない。
    if (themeId && options.writeThemeManifest !== false)
      this.writeThemeFolderManifest(location, themeId);
    return { kind: "ok", directory };
  }

  /** Main-owned Media sessionがmanaged Artifactの確定先を共有する。 */
  resolveManagedArtifactDirectory(themeId: string | null):
    | { kind: "needs_directory" }
    | {
        kind: "ok";
        directory: string;
        themeMarker?: { directory: string; themeId: string; displayName: string };
      } {
    // MediaCaptureService がancestor確認→mkdir→再確認を一つの境界で行う。
    // ここでTheme markerを先に書くと、junction越しに外部directoryを作り得る。
    if (!themeId || themeId === PERSONAL_DEFAULT_THEME_ID) {
      return this.resolveThemeContentDirectory(themeId, "artifacts", { writeThemeManifest: false });
    }
    const theme = this.repository.get("theme", themeId) || this.repository.get("project", themeId);
    if (!theme) throw new Error("音声CaptureのThemeが見つかりません。Themeを選び直してください。");
    const syncRoot = String(this.repository.getPreference("artifactDirectory") || "").trim();
    const themeStorageRoot =
      typeof theme.storage_root === "string" ? theme.storage_root.trim() : "";
    const root = themeStorageRoot || syncRoot;
    if (!root) return { kind: "needs_directory" };
    let themeFolder: string;
    if (fs.existsSync(root)) {
      const discovered = discoverThemeAiPackLocation({
        syncRoot,
        themeStorageRoot,
        themeId,
        themeCode: typeof theme.code === "string" ? theme.code : "",
        displayName: String(theme.name || theme.title || ""),
      });
      if (discovered.status !== "ok") {
        // statusとreasonを持っているのに同じ文言へ潰すと、利用者も開発者も次の操作へ到達できない。
        logMain(
          "error",
          "workspace:managed-artifact-directory",
          "Theme保存先を解決できません",
          new Error(
            `status=${discovered.status} reason=${"reason" in discovered ? discovered.reason : "-"} root=${root} themeId=${themeId}`,
          ),
        );
        throw new Error(
          themeStorageResolutionMessage(
            discovered.status,
            "reason" in discovered ? String(discovered.reason) : "",
          ),
        );
      }
      themeFolder = discovered.themeFolder;
    } else {
      const planned = this.resolveThemeContentDirectory(themeId, "artifacts", {
        writeThemeManifest: false,
      });
      if (planned.kind === "needs_directory") return planned;
      themeFolder = path.dirname(planned.directory);
    }
    return {
      kind: "ok",
      directory: path.join(themeFolder, "Artifacts"),
      themeMarker: {
        directory: themeFolder,
        themeId,
        displayName: String(theme.name || theme.title || ""),
      },
    };
  }

  /**
   * Themeフォルダの直下へ `.tasken-theme.json` を置く（#306）。
   * Theme名の変更でフォルダを黙ってrename・moveしないため、対応の正本をIDで残す。
   */
  private writeThemeFolderManifest(
    location: { root: string; segments: string[] },
    themeId: string,
  ): void {
    try {
      // Theme専用ルートはroot直下、共通ルートは Themes/<folder> がTheme単位のフォルダ。
      const themeFolder =
        location.segments[0] === "Themes"
          ? path.join(location.root, location.segments[0], location.segments[1] || "")
          : location.segments.length === 1
            ? location.root
            : "";
      if (!themeFolder) return;
      const manifestPath = path.join(themeFolder, THEME_FOLDER_MANIFEST);
      if (fs.existsSync(manifestPath)) return;
      const theme =
        this.repository.get("theme", themeId) || this.repository.get("project", themeId);
      fs.mkdirSync(themeFolder, { recursive: true });
      fs.writeFileSync(
        manifestPath,
        `${JSON.stringify(buildThemeFolderManifest({ themeId, displayName: String(theme?.name || theme?.title || "") }), null, 2)}\n`,
        "utf8",
      );
    } catch {
      // markerは対応を辿るための補助情報。書けなくても保存自体は成立させる。
    }
  }

  importArtifactFiles(requestValue: unknown): ArtifactFileImportResult {
    const request = normalizeArtifactFileImportRequest(requestValue);
    for (const file of request.files) {
      rejectGenericAudioArtifact({ filename: file.name || file.path }, "取り込み");
      rejectGenericVideoArtifact({ filename: file.name || file.path }, "取り込み");
    }
    const location = this.resolveThemeContentDirectory(request.themeId, "artifacts");
    if (location.kind === "needs_directory") return { status: "needs_directory" };
    const directory = location.directory;

    for (const file of request.files) {
      if (!fs.existsSync(file.path) || !fs.statSync(file.path).isFile()) {
        throw new Error(
          `ドロップしたファイルが見つかりません（${file.name || path.basename(file.path)}）。保存済みのファイルをドラッグしてください。`,
        );
      }
    }

    try {
      fs.mkdirSync(directory, { recursive: true });
    } catch (error) {
      throw new Error(
        `保存先フォルダを作成できませんでした（${directory}）。SettingsのArtifact保存先、またはThemeの保存ルートを書き込みできる場所に変更してください。${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const files: ImportedArtifactFile[] = [];
    const copiedAt = new Date().toISOString();
    for (const file of request.files) {
      const originalName = file.name || path.basename(file.path);
      const filename = resolveUniqueArtifactFileName(originalName, (candidate: string) =>
        fs.existsSync(path.join(directory, candidate)),
      );
      const storedPath = path.join(directory, filename);
      try {
        // COPYFILE_EXCLで既存ファイルへの上書きを防ぐ（同名回避と二重の安全策）。
        fs.copyFileSync(file.path, storedPath, fs.constants.COPYFILE_EXCL);
      } catch (error) {
        throw new Error(
          `ファイルをコピーできませんでした（${originalName}）。保存先の空き容量とアクセス権を確認して、もう一度ドラッグしてください。${error instanceof Error ? error.message : String(error)}`,
        );
      }
      files.push({
        filename,
        storedPath,
        originalPath: file.path,
        fileSize: fs.statSync(storedPath).size,
        mimeType: artifactMimeTypeOf(filename),
        fileType: artifactFileTypeOf(filename),
        copiedAt,
        storageMode: "managed",
      });
    }
    return { status: "ok", directory, files };
  }

  materializeArtifactProposal(requestValue: unknown): ArtifactProposalMaterializeResult {
    if (!requestValue || typeof requestValue !== "object" || Array.isArray(requestValue)) {
      throw new Error("Artifact Proposalの形式が不正です。Previewを開き直してください。");
    }
    const request = requestValue as Partial<ArtifactProposalMaterializeRequest>;
    const normalized = validateArtifactProposal({
      title: request.title,
      file_name: request.fileName,
      media_type: request.mediaType,
      content: request.content,
    });
    rejectGenericAudioArtifact(
      { filename: normalized.fileName, mime_type: normalized.mediaType },
      "Proposal確定",
    );
    rejectGenericVideoArtifact(
      { filename: normalized.fileName, mime_type: normalized.mediaType },
      "Proposal確定",
    );
    const location = this.resolveThemeContentDirectory(request.themeId || null, "artifacts");
    if (location.kind === "needs_directory") return { status: "needs_directory" };
    fs.mkdirSync(location.directory, { recursive: true });
    const materializationKey =
      typeof request.materializationKey === "string" ? request.materializationKey.trim() : "";
    if (materializationKey && !/^[A-Za-z0-9._-]{1,200}$/.test(materializationKey)) {
      throw new Error("Artifact materialization keyが不正です。");
    }
    const parsedName = path.parse(normalized.fileName);
    const stableSuffix = materializationKey
      ? `-${createHash("sha256").update(materializationKey).digest("hex").slice(0, 12)}`
      : "";
    const filename = materializationKey
      ? `${parsedName.name.slice(0, Math.max(1, 180 - parsedName.ext.length - stableSuffix.length))}${stableSuffix}${parsedName.ext}`
      : resolveUniqueArtifactFileName(normalized.fileName, (candidate: string) =>
          fs.existsSync(path.join(location.directory, candidate)),
        );
    const storedPath = path.join(location.directory, filename);
    const tempPath = `${storedPath}.tasken-tmp`;
    let created = false;
    if (fs.existsSync(storedPath)) {
      if (!materializationKey || fs.readFileSync(storedPath, "utf8") !== normalized.content) {
        throw new Error("Artifactの確定先が競合しています。Previewを開き直してください。");
      }
    } else {
      let descriptor: number | null = null;
      try {
        // A crashed attempt may leave only this exact, deterministic staging file.
        // The final path is never opened for writing, so a partial write cannot
        // become a durable Artifact or poison a later retry.
        fs.rmSync(tempPath, { force: true });
        descriptor = fs.openSync(
          tempPath,
          fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
          0o600,
        );
        const content = Buffer.from(normalized.content, "utf8");
        let offset = 0;
        while (offset < content.length) {
          const written = fs.writeSync(descriptor, content, offset, content.length - offset);
          if (written <= 0) throw new Error("Artifact staging write made no progress");
          offset += written;
        }
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = null;
        if (fs.existsSync(storedPath)) {
          if (!materializationKey || fs.readFileSync(storedPath, "utf8") !== normalized.content) {
            throw new Error("Artifactの確定先が競合しています。Previewを開き直してください。");
          }
          fs.rmSync(tempPath, { force: true });
        } else {
          fs.renameSync(tempPath, storedPath);
          created = true;
        }
      } catch (error) {
        if (descriptor !== null) {
          try {
            fs.closeSync(descriptor);
          } catch {
            /* cleanup continues below */
          }
        }
        fs.rmSync(tempPath, { force: true });
        if (
          error instanceof Error &&
          error.message.startsWith("Artifactの確定先が競合しています。")
        )
          throw error;
        throw new Error(
          "Artifactを確定できませんでした。保存先の空き容量とアクセス権を確認して、もう一度採用してください。",
        );
      }
    }
    const stat = fs.statSync(storedPath);
    return {
      status: "ok",
      directory: location.directory,
      created,
      file: {
        filename,
        storedPath,
        originalPath: "",
        fileSize: stat.size,
        mimeType: normalized.mediaType,
        fileType: artifactFileTypeOf(filename),
        copiedAt: stat.birthtime.toISOString(),
        storageMode: "managed",
      },
    };
  }

  rollbackMaterializedArtifactProposal(storedPath: string): void {
    fs.rmSync(storedPath, { force: true });
  }

  reload(sender: WebContents): boolean {
    sender.reload();
    return true;
  }

  async checkForUpdates(): Promise<AppUpdateCheckResult> {
    const currentVersion = app.getVersion();
    try {
      const response = await fetch(RELEASES_API_URL, {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": `Tasken/${currentVersion}`,
        },
      });
      if (!response.ok) {
        throw new Error(`GitHub Releaseを確認できませんでした。HTTP ${response.status}`);
      }

      const release = (await response.json()) as GitHubLatestRelease;
      const latestVersion = String(release.tag_name || "").replace(/^v/i, "");
      if (!latestVersion) throw new Error("最新バージョンを読み取れませんでした。");

      const releaseUrl = safeReleaseUrl(release.html_url);
      return {
        status: compareVersions(latestVersion, currentVersion) > 0 ? "available" : "current",
        currentVersion,
        latestVersion,
        releaseName: release.name,
        releaseUrl,
        publishedAt: release.published_at,
      };
    } catch (error) {
      return {
        status: "error",
        currentVersion,
        releaseUrl: RELEASES_PAGE_URL,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async openReleasePage(url?: string): Promise<boolean> {
    await shell.openExternal(safeReleaseUrl(url));
    return true;
  }

  async getMcpBridgeInfo(): Promise<McpBridgeInfo> {
    const args = app.isPackaged
      ? [path.join(process.resourcesPath, "mcp", "server.mjs")]
      : [path.join(app.getAppPath(), "scripts", "mcp-server.mjs")];
    const proposals = this.repository.list("ai_proposal").filter((proposal) => !proposal.deleted_at);
    const pendingProposalCount = proposals.filter((proposal) => proposal.status === "pending").length;
    const latestProposal = proposals.sort((a, b) => String(b.received_at || b.updated_at || b.created_at || "")
      .localeCompare(String(a.received_at || a.updated_at || a.created_at || "")))[0];
    let coreDiagnostics: Partial<McpBridgeInfo> = { coreStatus: "unknown" };
    if (this.taskenCoreClient?.inspect) {
      try {
        const inspected = await this.taskenCoreClient.inspect();
        coreDiagnostics = {
          coreStatus: "available",
          coreApiVersion: inspected.api_version,
          coreCapabilityCount: inspected.capabilities.length,
        };
      } catch (error) {
        const code = typeof error === "object" && error && "code" in error ? String(error.code) : "CORE_UNAVAILABLE";
        coreDiagnostics = {
          coreStatus: "unavailable",
          coreErrorCode: code,
          coreErrorMessage: error instanceof Error ? error.message : String(error),
          coreNextAction: code === "VERSION_MISMATCH"
            ? "TaskenとMCP bridgeを同じ最新版へ更新してください。"
            : "Taskenを起動した状態で再確認してください。",
        };
      }
    }
    return createMcpBridgeInfo({
      args,
      pendingProposalCount,
      packaged: app.isPackaged,
      ...coreDiagnostics,
      latestProposalId: latestProposal?.id ? String(latestProposal.id) : undefined,
      latestProposalAt: String(latestProposal?.received_at || latestProposal?.updated_at || latestProposal?.created_at || "") || undefined,
    });
  }

  async exportSnapshot(): Promise<{ canceled: boolean; filePath?: string }> {
    const date = localDateIso();
    const result = await dialog.showSaveDialog({
      title: "Workspace Snapshotを書き出す",
      defaultPath: `workspace_export_${date}.zip`,
      filters: [{ name: "Tasken Snapshot", extensions: ["zip"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    createSnapshot(this.repository.loadWorkspace(true)).writeZip(result.filePath);
    return { canceled: false, filePath: result.filePath };
  }

  async inspectSnapshot() {
    const result = await dialog.showOpenDialog({
      title: "Workspace Snapshotを読み込む",
      properties: ["openFile"],
      filters: [{ name: "Tasken Snapshot", extensions: ["zip"] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const parsed = readSnapshot(result.filePaths[0]) as {
      manifest: Record<string, unknown>;
      workspace: Workspace;
    };
    this.validateSnapshotMedia(parsed.workspace);
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.pendingSnapshots.set(token, parsed.workspace);
    return {
      canceled: false,
      token,
      manifest: parsed.manifest,
      changes: this.repository.previewSnapshot(parsed.workspace),
    };
  }

  async exportMarkdownFile(requestValue: unknown): Promise<MarkdownFileExportResult> {
    const request = normalizeMarkdownFileExportRequest(requestValue);
    let directory = request.directory?.trim() || "";
    // 初回など directory 未設定時は Theme の Notes/ を既定にする。
    if (!directory && !request.chooseDirectory) {
      const themeDir = this.resolveThemeContentDirectory(request.themeId, "notes");
      if (themeDir.kind === "ok") directory = themeDir.directory;
    }
    if (request.chooseDirectory || !directory) {
      const themeDefault = this.resolveThemeContentDirectory(request.themeId, "notes");
      const defaultPath =
        directory || (themeDefault.kind === "ok" ? themeDefault.directory : undefined);
      const result = await dialog.showOpenDialog({
        title: "Markdown出力先フォルダを選択",
        defaultPath: defaultPath || undefined,
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || !result.filePaths[0]) return { canceled: true };
      directory = result.filePaths[0];
    }
    fs.mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, safeMarkdownFileName(request.fileName || request.title));
    fs.writeFileSync(filePath, request.content, "utf8");
    return {
      canceled: false,
      filePath,
      directory,
      exportedAt: new Date().toISOString(),
    };
  }

  async exportMarkdownPdf(requestValue: unknown): Promise<MarkdownPdfExportResult> {
    const request = normalizeMarkdownPdfExportRequest(requestValue);
    let directory = request.directory?.trim() || "";
    // PDF は都度選択する。既定の保存先はOSのフォルダ選択ダイアログに任せる。
    if (request.chooseDirectory || !directory) {
      const defaultPath = directory || undefined;
      const result = await dialog.showOpenDialog({
        title: "PDF出力先フォルダを選択",
        defaultPath: defaultPath || undefined,
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || !result.filePaths[0]) return { canceled: true };
      directory = result.filePaths[0];
    }
    fs.mkdirSync(directory, { recursive: true });
    const filePath = path.join(
      directory,
      safePdfFileName(request.fileName || request.title || "markdown-document"),
    );

    // data: ページからは tasken-attachment を読めないため、一時 HTML + 相対パス画像で printToPDF する。
    const tempRoot = fs.mkdtempSync(path.join(app.getPath("temp"), "tasken-pdf-"));
    const assetDirectory = path.join(tempRoot, "images");
    const prepared = prepareMarkdownHtmlForPdf(
      request.html,
      path.join(this.userDataPath, "attachments", "markdown-images"),
      { assetDirectory },
    );
    const warnings = [...prepared.warnings];
    const tempHtmlPath = path.join(tempRoot, "document.html");
    fs.writeFileSync(tempHtmlPath, prepared.html, "utf8");

    const pdfWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        // 画像ロード完了待ちのため最小限の JS を許可する（node は無効）
        javascript: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });

    try {
      await pdfWindow.loadFile(tempHtmlPath);
      // 画像とフォントを待ち、印刷でスクロールできない横長要素をA4本文幅へ収める。
      const layoutReport = (await pdfWindow.webContents.executeJavaScript(`
        (async () => {
          const images = Array.from(document.images || []);
          await Promise.all(images.map((img) => {
            if (img.complete) return Promise.resolve();
            return new Promise((resolve) => {
              const done = () => resolve();
              img.addEventListener("load", done, { once: true });
              img.addEventListener("error", done, { once: true });
              setTimeout(done, 8000);
            });
          }));
          if (document.fonts?.ready) await document.fonts.ready;

          let fittedMathCount = 0;
          for (const block of document.querySelectorAll(".md-math-block")) {
            const math = block.querySelector(".katex-display > .katex");
            if (!(math instanceof HTMLElement)) continue;
            const visibleMath = math.querySelector(".katex-html");
            if (!(visibleMath instanceof HTMLElement)) continue;
            const style = getComputedStyle(block);
            const availableWidth = block.clientWidth
              - Number.parseFloat(style.paddingLeft || "0")
              - Number.parseFloat(style.paddingRight || "0");
            const bases = Array.from(visibleMath.querySelectorAll(":scope > .base"));
            if (bases.length > 1) {
              visibleMath.style.whiteSpace = "normal";
              bases.slice(1).forEach((base) => base.before(document.createElement("wbr")));
            }
            const widestBase = bases.reduce(
              (width, base) => Math.max(width, base.getBoundingClientRect().width),
              0,
            );
            if (availableWidth > 0 && widestBase > availableWidth) {
              math.style.zoom = String((availableWidth * 0.98) / widestBase);
              fittedMathCount += 1;
            }
          }

          for (const svg of document.querySelectorAll(".md-mermaid-svg svg")) {
            svg.style.width = "auto";
            svg.style.maxWidth = "100%";
            svg.style.height = "auto";
            svg.style.maxHeight = "205mm";
            svg.style.margin = "0 auto";
          }

          return {
            images: images.map((img) => ({
              ok: Boolean(img.naturalWidth > 0),
              src: String(img.currentSrc || img.src || "").slice(0, 120),
            })),
            mermaidErrorCount: document.querySelectorAll(".md-mermaid-block.has-render-error").length,
            fittedMathCount,
          };
        })()
      `)) as {
        images?: Array<{ ok: boolean; src: string }>;
        mermaidErrorCount?: number;
        fittedMathCount?: number;
      };
      for (const image of layoutReport?.images || []) {
        if (!image.ok) {
          warnings.push(`PDF内で画像を描画できませんでした: ${image.src || "(不明)"}`);
        }
      }
      if (layoutReport?.mermaidErrorCount) {
        warnings.push(
          `Mermaidを描画できない箇所が${layoutReport.mermaidErrorCount}件あります。コードを確認してください。`,
        );
      }

      const pdf = await pdfWindow.webContents.printToPDF({
        pageSize: "A4",
        printBackground: true,
      });
      fs.writeFileSync(filePath, pdf);
    } finally {
      if (!pdfWindow.isDestroyed()) {
        pdfWindow.close();
      }
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch {
        // 一時ディレクトリ掃除失敗は PDF 成果物に影響しないため握りつぶす
      }
    }

    return {
      canceled: false,
      filePath,
      directory,
      exportedAt: new Date().toISOString(),
      warnings: warnings.length ? warnings : undefined,
    };
  }

  saveMarkdownImageAttachment(requestValue: unknown): MarkdownImageAttachmentResult {
    const request = normalizeMarkdownImageAttachment(requestValue);
    const encoded = request.dataUrl.slice(`data:${request.mimeType};base64,`.length);
    const buffer = Buffer.from(encoded, "base64");
    if (!buffer.length || buffer.length > MARKDOWN_IMAGE_MAX_BYTES) {
      throw new Error("画像サイズが大きすぎます。12MB以下の画像を貼り付けてください。");
    }

    const id = randomUUID();
    const extension = IMAGE_MIME_EXTENSIONS[request.mimeType];
    const storageFileName = `${id}.${extension}`;
    const displayName = safeAttachmentName(request.fileName).replace(/\.[^.]+$/, "") || "image";
    const attachmentDirectory = path.join(this.userDataPath, "attachments", "markdown-images");
    fs.mkdirSync(attachmentDirectory, { recursive: true });
    fs.writeFileSync(path.join(attachmentDirectory, storageFileName), buffer);

    return {
      id,
      fileName: `${displayName}.${extension}`,
      mimeType: request.mimeType,
      url: `tasken-attachment://local/${encodeURIComponent(storageFileName)}/${encodeURIComponent(displayName)}`,
    };
  }

  async exportSketch(requestValue: unknown): Promise<SketchExportResult> {
    if (!requestValue || typeof requestValue !== "object" || Array.isArray(requestValue)) {
      throw new Error("Sketch出力の内容が不正です。画面を再読み込みしてください。");
    }
    const request = requestValue as Partial<SketchExportRequest>;
    if (!["png", "svg", "markdown"].includes(String(request.format))) {
      throw new Error("Sketchの出力形式が不正です。");
    }
    if (
      typeof request.dataUrl !== "string" ||
      !request.dataUrl.startsWith("data:image/png;base64,")
    ) {
      throw new Error("Sketch画像を作成できませんでした。");
    }
    if (typeof request.svg !== "string" || !request.svg.startsWith("<svg")) {
      throw new Error("SketchのSVGを作成できませんでした。");
    }
    if (typeof request.markdown !== "string" || !request.markdown.trim()) {
      throw new Error("SketchのMarkdownを作成できませんでした。");
    }

    const format = request.format as "png" | "svg" | "markdown";
    const extension = format === "markdown" ? "md" : format;
    const safeTitle = safeAttachmentName(
      typeof request.title === "string" ? request.title : "Sketch",
    );
    const location = this.resolveThemeContentDirectory(request.themeId || null, "exports");
    const directory = location.kind === "ok" ? location.directory : app.getPath("documents");
    if (location.kind === "ok") fs.mkdirSync(directory, { recursive: true });
    const result = await dialog.showSaveDialog({
      title: `Sketchを${extension.toUpperCase()}で書き出す`,
      defaultPath: path.join(directory, `${safeTitle}.${extension}`),
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };

    if (format === "png") {
      const buffer = Buffer.from(request.dataUrl.slice("data:image/png;base64,".length), "base64");
      fs.writeFileSync(result.filePath, buffer);
      return { canceled: false, filePath: result.filePath };
    }
    if (format === "svg") {
      fs.writeFileSync(result.filePath, request.svg, "utf8");
      return { canceled: false, filePath: result.filePath };
    }

    const companionFilePath = path.join(
      path.dirname(result.filePath),
      `${path.basename(result.filePath, ".md")}.png`,
    );
    const buffer = Buffer.from(request.dataUrl.slice("data:image/png;base64,".length), "base64");
    fs.writeFileSync(companionFilePath, buffer);
    const markdown = request.markdown.replace("{{SKETCH_IMAGE}}", path.basename(companionFilePath));
    fs.writeFileSync(result.filePath, markdown, "utf8");
    return { canceled: false, filePath: result.filePath, companionFilePath };
  }

  async exportSlideTimeline(requestValue: unknown): Promise<SlideTimelineExportResult> {
    if (!requestValue || typeof requestValue !== "object" || Array.isArray(requestValue)) {
      throw new Error("スライド用タイムラインの出力内容が不正です。画面を再読み込みしてください。");
    }
    const request = requestValue as Partial<SlideTimelineExportRequest>;
    if (typeof request.svg !== "string" || !request.svg.startsWith("<svg")) {
      throw new Error("タイムラインのSVGを作成できませんでした。期間と項目を確認してください。");
    }
    const safeTitle = safeAttachmentName(
      typeof request.title === "string" ? request.title : "Timeline",
    );
    const result = await dialog.showSaveDialog({
      title: "スライド用タイムラインをSVGで書き出す",
      defaultPath: path.join(app.getPath("documents"), `${safeTitle || "Timeline"}.svg`),
      filters: [{ name: "SVG", extensions: ["svg"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, request.svg, "utf8");
    return { canceled: false, filePath: result.filePath };
  }

  async exportMermaidSvg(requestValue: unknown): Promise<MermaidPowerPointSvgExportResult> {
    if (!requestValue || typeof requestValue !== "object" || Array.isArray(requestValue)) {
      throw new Error("MermaidのSVG出力内容が不正です。画面を再読み込みしてください。");
    }
    const request = requestValue as Partial<MermaidPowerPointSvgExportRequest>;
    const svg = validateOfficeSvg(request.svg);
    const safeTitle = safeAttachmentName(
      typeof request.title === "string" ? request.title : "Mermaid",
    );
    const result = await dialog.showSaveDialog({
      title: "MermaidをPowerPoint用SVGで書き出す",
      defaultPath: path.join(app.getPath("documents"), `${safeTitle || "Mermaid"}.svg`),
      filters: [{ name: "SVG", extensions: ["svg"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, svg, "utf8");
    return { canceled: false, filePath: result.filePath };
  }

  async exportMermaidPptx(requestValue: unknown): Promise<MermaidPowerPointPptxExportResult> {
    if (!requestValue || typeof requestValue !== "object" || Array.isArray(requestValue)) {
      throw new Error("MermaidのPPTX出力内容が不正です。画面を再読み込みしてください。");
    }
    const request = requestValue as Partial<MermaidPowerPointPptxExportRequest>;
    const diagram = validateMermaidPptxDiagram(request.diagram);
    const safeTitle = safeAttachmentName(
      typeof request.title === "string" ? request.title : "Mermaid",
    );
    const result = await dialog.showSaveDialog({
      title: "Mermaidを編集可能なPowerPointで書き出す",
      defaultPath: path.join(app.getPath("documents"), `${safeTitle || "Mermaid"}.pptx`),
      filters: [{ name: "PowerPoint", extensions: ["pptx"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true, warnings: diagram.warnings };
    const buffer = await buildMermaidPptxBuffer(diagram, safeTitle || "Mermaid");
    fs.writeFileSync(result.filePath, buffer);
    return { canceled: false, filePath: result.filePath, warnings: diagram.warnings };
  }

  applySnapshot(token: string, decisions: SnapshotDecisions): Workspace {
    const snapshot = this.pendingSnapshots.get(token);
    if (!snapshot) {
      throw new Error(
        "Importプレビューの有効期限が切れました。もう一度Snapshotを選択してください。",
      );
    }
    this.validateSnapshotMedia(snapshot);
    const result = this.repository.applySnapshot(
      snapshot,
      decisions,
      snapshot.plan_revisions || [],
    );
    this.pendingSnapshots.delete(token);
    return result as Workspace;
  }

  private validateSnapshotMedia(snapshot: Workspace): void {
    validateSnapshotMediaWorkspace(snapshot, {
      repository: this.repository,
      resolveManagedDirectory: (themeId, workspace) =>
        this.resolveSnapshotManagedArtifactDirectory(themeId, workspace),
    });
  }

  private resolveSnapshotManagedArtifactDirectory(
    themeId: string | null,
    snapshot: Workspace,
  ): { kind: "needs_directory" } | { kind: "ok"; directory: string } {
    if (!themeId || themeId === PERSONAL_DEFAULT_THEME_ID) {
      return this.resolveThemeContentDirectory(themeId, "artifacts", { writeThemeManifest: false });
    }
    const currentTheme =
      this.repository.get("theme", themeId) || this.repository.get("project", themeId);
    if (currentTheme) return this.resolveManagedArtifactDirectory(themeId);
    const incomingTheme = [
      ...(Array.isArray(snapshot.projects) ? snapshot.projects : []),
      ...(Array.isArray(snapshot.themes) ? snapshot.themes : []),
    ].find((theme) => theme && theme.id === themeId && !theme.deleted_at);
    if (!incomingTheme) return { kind: "needs_directory" };
    const syncRoot = String(this.repository.getPreference("artifactDirectory") || "").trim();
    const themeStorageRoot =
      typeof incomingTheme.storage_root === "string" ? incomingTheme.storage_root.trim() : "";
    const root = themeStorageRoot || syncRoot;
    if (!root) return { kind: "needs_directory" };
    if (fs.existsSync(root)) {
      const discovered = discoverThemeAiPackLocation({
        syncRoot,
        themeStorageRoot,
        themeId,
        themeCode: typeof incomingTheme.code === "string" ? incomingTheme.code : "",
        displayName: String(incomingTheme.name || incomingTheme.title || ""),
      });
      return discovered.status === "ok"
        ? { kind: "ok", directory: path.join(discovered.themeFolder, "Artifacts") }
        : { kind: "needs_directory" };
    }
    const location = (
      resolveThemeContentDirectoryParts as (options: {
        artifactDirectory?: string | null;
        themeId?: string | null;
        themeCode?: string | null;
        themeStorageRoot?: string | null;
        contentKind?: "artifacts" | "notes" | "exports";
      }) => { kind: "needs_directory" } | { kind: "ok"; root: string; segments: string[] }
    )({
      artifactDirectory: syncRoot,
      themeId,
      themeCode: typeof incomingTheme.code === "string" ? incomingTheme.code : null,
      themeStorageRoot,
      contentKind: "artifacts",
    });
    return location.kind === "ok"
      ? { kind: "ok", directory: path.join(location.root, ...location.segments) }
      : { kind: "needs_directory" };
  }
}
