import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

import { parseCommandEnvelope, type CommandEnvelope, type CommandReceipt } from "../../shared/applicationCommand";
import type {
  AudioCaptureCommitRequest,
  AudioCaptureCommitResult,
  AudioCapturePrepared,
  InternalAudioCaptureCommitResult,
} from "../../shared/mediaCapture";
import { audioMimeTypeOf, mediaExtensionOf } from "../../shared/mediaArtifact.mjs";
import type { MediaAvailability } from "../../shared/mediaArtifact.mjs";
import { resolveUniqueArtifactFileName, safeArtifactFileName } from "./artifactStorage.mjs";
import type { Entity } from "../../shared/types/workspace";
import { writeAtomicTextFile } from "./atomicText.mjs";
import { buildThemeFolderManifest, THEME_FOLDER_MANIFEST, themeFolderManifestMatches } from "../../shared/storageResolver.mjs";
import { PERSONAL_DEFAULT_THEME_ID } from "../../shared/themeRef.mjs";

const MANIFEST_SCHEMA = "tasken-media-session/v1";
const SESSION_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH_CHUNK_SIZE = 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;

type SessionState = "prepared" | "finalizing" | "finalized" | "committed";

interface AudioSessionManifest {
  schema: typeof MANIFEST_SCHEMA;
  sessionId: string;
  state: SessionState;
  mediaKind: "audio" | "video";
  filename: string;
  mimeType: string;
  fileSize: number;
  contentHash: string;
  themeId: string | null;
  stagedFileName: string;
  createdAt: string;
  updatedAt: string;
  finalPath?: string;
  managedRootPath?: string;
  managedRootRealPath?: string;
  managedRootDevice?: string;
  managedRootInode?: string;
  durationMs?: number;
  commandIssuedAt?: string;
  command?: CommandEnvelope;
  recoveryError?: "final_file_missing" | "final_hash_mismatch" | "commit_failed";
}

interface MediaRepository {
  get(type: "artifact", id: string, includeDeleted?: boolean): Entity | null;
}

interface AudioCommandExecutor {
  executeMediaCapture(input: unknown): CommandReceipt;
}

type DirectoryResolution = { kind: "needs_directory" } | { kind: "ok"; directory: string; themeMarker?: { directory: string; themeId: string; displayName: string } };
export type MediaFileResolution =
  | { availability: Exclude<MediaAvailability, "available"> }
  | { availability: "available"; fileDescriptor: number; mimeType: string; fileSize: number };

export interface MediaCaptureServiceOptions {
  userDataPath: string;
  repository: MediaRepository;
  commands: AudioCommandExecutor;
  resolveManagedDirectory: (themeId: string | null) => DirectoryResolution;
  idFactory?: () => string;
  now?: () => string;
}

function assertSessionId(value: unknown): string {
  if (typeof value !== "string" || !SESSION_ID_PATTERN.test(value)) {
    throw new Error("音声Capture sessionが不正です。もう一度ファイルを選択してください。");
  }
  return value;
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function assertWithin(root: string, target: string, label: string): void {
  if (!isWithin(path.resolve(root), path.resolve(target))) throw new Error(`${label}が保存範囲の外です。`);
}

function hashFile(filePath: string): string {
  const hash = createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(HASH_CHUNK_SIZE);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return `sha256:${hash.digest("hex")}`;
}

function hashFileDescriptor(descriptor: number): string {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(HASH_CHUNK_SIZE);
  let position = 0;
  let bytesRead = 0;
  do {
    bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, position);
    if (bytesRead > 0) {
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } while (bytesRead > 0);
  return `sha256:${hash.digest("hex")}`;
}

function hasExpectedAudioSignature(descriptor: number, mimeType: string): boolean {
  const header = Buffer.alloc(16);
  const length = fs.readSync(descriptor, header, 0, header.length, 0);
  const bytes = header.subarray(0, length);
  if (mimeType === "audio/wav") return length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WAVE";
  if (mimeType === "audio/ogg") return length >= 4 && bytes.subarray(0, 4).toString("ascii") === "OggS";
  if (mimeType === "audio/webm") return length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (mimeType === "audio/mpeg") {
    return length >= 3 && bytes.subarray(0, 3).toString("ascii") === "ID3"
      || length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  }
  if (mimeType === "audio/mp4") return length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp";
  return false;
}

function copyVerifiedSourceToExclusiveStage(sourcePath: string, stagedPath: string, mimeType: string): { fileSize: number; contentHash: string } {
  let sourceDescriptor: number | null = null;
  let stagedDescriptor: number | null = null;
  try {
    assertNoSymlinkOrJunctionAncestors(sourcePath, "音声Capture source");
    const before = fs.lstatSync(sourcePath);
    if (before.isSymbolicLink() || !before.isFile()) {
      throw new UnsafeMediaSourceError("symlink/junctionやファイル以外は音声Captureへ取り込めません。");
    }
    if (before.size <= 0) throw new Error("空の音声ファイルは取り込めません。録音元を確認してください。");
    const noFollow = "O_NOFOLLOW" in fs.constants ? Number(fs.constants.O_NOFOLLOW) : 0;
    sourceDescriptor = fs.openSync(sourcePath, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(sourceDescriptor);
    const afterOpen = fs.lstatSync(sourcePath);
    if (
      !opened.isFile()
      || afterOpen.isSymbolicLink()
      || !afterOpen.isFile()
      || !sameFileIdentity(before, opened)
      || !sameFileIdentity(opened, afterOpen)
    ) {
      throw new UnsafeMediaSourceError("音声Capture sourceが確認中に差し替えられました。取り込みを中止しました。");
    }
    if (!hasExpectedAudioSignature(sourceDescriptor, mimeType)) {
      throw new Error("音声ファイルの内容と拡張子が一致しません。正しい音声ファイルを選択してください。");
    }
    stagedDescriptor = fs.openSync(
      stagedPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
      0o600,
    );
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(HASH_CHUNK_SIZE);
    let position = 0;
    while (position < opened.size) {
      const bytesRead = fs.readSync(sourceDescriptor, buffer, 0, Math.min(buffer.length, opened.size - position), position);
      if (bytesRead <= 0) throw new Error("音声ファイルを最後まで読み込めませんでした。元ファイルを確認してください。");
      let written = 0;
      while (written < bytesRead) {
        const bytesWritten = fs.writeSync(stagedDescriptor, buffer, written, bytesRead - written, position + written);
        if (bytesWritten <= 0) throw new Error("音声ファイルをtemporary保存へ書き込めませんでした。空き容量を確認してください。");
        written += bytesWritten;
      }
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    fs.fsyncSync(stagedDescriptor);
    const stagedStat = fs.fstatSync(stagedDescriptor);
    if (!stagedStat.isFile() || stagedStat.size !== opened.size) {
      throw new Error("音声ファイルをtemporary保存へ完全にコピーできませんでした。空き容量を確認してください。");
    }
    return { fileSize: stagedStat.size, contentHash: `sha256:${hash.digest("hex")}` };
  } finally {
    if (stagedDescriptor !== null) fs.closeSync(stagedDescriptor);
    if (sourceDescriptor !== null) fs.closeSync(sourceDescriptor);
  }
}

function existingPathSegments(target: string): string[] {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  const segments = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  const result = [parsed.root];
  let current = parsed.root;
  for (const segment of segments) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) break;
    result.push(current);
  }
  return result;
}

class UnsafeMediaSourceError extends Error {}

function assertNoSymlinkOrJunctionAncestors(target: string, label: string): void {
  for (const candidate of existingPathSegments(target)) {
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink()) throw new UnsafeMediaSourceError(`${label}の既存ancestorにsymlink/junctionは利用できません。`);
  }
}

function ensureSafeDirectory(target: string, label: string): { resolved: string; real: string; device: string; inode: string } {
  const resolved = path.resolve(target);
  assertNoSymlinkOrJunctionAncestors(resolved, label);
  fs.mkdirSync(resolved, { recursive: true });
  assertNoSymlinkOrJunctionAncestors(resolved, label);
  const own = fs.lstatSync(resolved);
  if (own.isSymbolicLink() || !own.isDirectory()) throw new Error(`${label}を安全なdirectoryとして確定できません。`);
  const real = fs.realpathSync(resolved);
  const stat = fs.statSync(real);
  return { resolved, real, device: String(stat.dev), inode: String(stat.ino) };
}

function resolveSafeExistingDirectory(target: string, label: string): { resolved: string; real: string } {
  const resolved = path.resolve(target);
  assertNoSymlinkOrJunctionAncestors(resolved, label);
  const own = fs.lstatSync(resolved);
  if (own.isSymbolicLink() || !own.isDirectory()) throw new Error(`${label}を安全なdirectoryとして解決できません。`);
  return { resolved, real: fs.realpathSync(resolved) };
}

function ensureThemeMarker(location: Extract<DirectoryResolution, { kind: "ok" }>, managedRoot: { real: string }): void {
  if (!location.themeMarker) return;
  const markerDirectory = ensureSafeDirectory(location.themeMarker.directory, "Theme Media marker保存先");
  assertWithin(markerDirectory.real, managedRoot.real, "Theme Media保存先");
  const markerPath = path.resolve(markerDirectory.real, THEME_FOLDER_MANIFEST);
  assertWithin(markerDirectory.real, markerPath, "Theme Media marker");
  if (fs.existsSync(markerPath)) {
    const stat = fs.lstatSync(markerPath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > 32 * 1024) throw new Error("Theme Media markerが不正です。");
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    if (!themeFolderManifestMatches(marker, location.themeMarker.themeId)) throw new Error("Theme Media markerのidentityが一致しません。");
    return;
  }
  const marker = buildThemeFolderManifest({ themeId: location.themeMarker.themeId, displayName: location.themeMarker.displayName });
  writeAtomicTextFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, randomUUID());
  const verified = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  if (!themeFolderManifestMatches(verified, location.themeMarker.themeId)) throw new Error("Theme Media markerを検証できませんでした。");
}

function sameFileIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino);
}

function openVerifiedMedia(
  filePath: string,
  expectedSize: number,
  expectedHash: string,
  mimeType: string,
  verificationCache?: Map<string, { dev: string; ino: string; size: number; mtimeMs: number; ctimeMs: number; contentHash: string }>,
  cacheKey = filePath,
): MediaFileResolution {
  let descriptor: number | null = null;
  try {
    assertNoSymlinkOrJunctionAncestors(filePath, "Media source");
    const before = fs.lstatSync(filePath);
    if (before.isSymbolicLink()) return { availability: "unsafe_source" };
    if (!before.isFile()) return { availability: "missing" };
    const noFollow = "O_NOFOLLOW" in fs.constants ? Number(fs.constants.O_NOFOLLOW) : 0;
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(descriptor);
    const afterOpen = fs.lstatSync(filePath);
    if (!opened.isFile() || afterOpen.isSymbolicLink() || !afterOpen.isFile() || !sameFileIdentity(before, opened) || !sameFileIdentity(opened, afterOpen)) {
      return { availability: "unsafe_source" };
    }
    const cached = verificationCache?.get(cacheKey);
    const cacheMatches = cached
      && cached.dev === String(opened.dev)
      && cached.ino === String(opened.ino)
      && cached.size === opened.size
      && cached.mtimeMs === opened.mtimeMs
      && cached.ctimeMs === opened.ctimeMs
      && cached.contentHash === expectedHash;
    const contentHash = cacheMatches ? cached.contentHash : hashFileDescriptor(descriptor);
    const afterHash = fs.fstatSync(descriptor);
    if (!sameFileIdentity(opened, afterHash) || afterHash.size !== expectedSize || contentHash !== expectedHash) {
      verificationCache?.delete(cacheKey);
      return { availability: "changed" };
    }
    if (!cacheMatches) {
      verificationCache?.set(cacheKey, {
        dev: String(afterHash.dev),
        ino: String(afterHash.ino),
        size: afterHash.size,
        mtimeMs: afterHash.mtimeMs,
        ctimeMs: afterHash.ctimeMs,
        contentHash,
      });
    }
    const result: MediaFileResolution = { availability: "available", fileDescriptor: descriptor, mimeType, fileSize: afterHash.size };
    descriptor = null;
    return result;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    return { availability: error instanceof UnsafeMediaSourceError || ["ELOOP", "EPERM", "EACCES"].includes(code) ? "unsafe_source" : "missing" };
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function baseNameWithoutExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim() || "Voice memo";
}

function validDuration(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < 0) {
    throw new Error("音声の長さを取得できませんでした。対応形式を確認して、もう一度選択してください。");
  }
  return numeric;
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unknown.length) throw new Error(`${label}に未定義fieldがあります: ${unknown.join(", ")}`);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function validateManifestCommand(value: unknown, manifest: Partial<AudioSessionManifest>): CommandEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Media Capture commandが不正です。");
  const raw = value as Record<string, unknown>;
  assertExactKeys(raw, ["commandId", "name", "payload", "actor", "source", "sessionId", "issuedAt"], "Media Capture command");
  const parsed = parseCommandEnvelope(raw);
  if (
    parsed.name !== "CommitAudioCapture"
    || parsed.actor.kind !== "user"
    || parsed.source !== "inbox"
    || parsed.sessionId !== manifest.sessionId
    || !SESSION_ID_PATTERN.test(parsed.commandId)
  ) throw new Error("Media Capture command identityが不正です。");
  const actor = raw.actor as Record<string, unknown>;
  assertExactKeys(actor, ["kind"], "Media Capture actor");
  const payload = raw.payload as Record<string, unknown>;
  assertExactKeys(payload, ["capture", "artifact"], "Media Capture payload");
  const capture = payload.capture as Record<string, unknown>;
  const artifact = payload.artifact as Record<string, unknown>;
  if (!capture || typeof capture !== "object" || Array.isArray(capture) || !artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw new Error("Media Capture entity payloadが不正です。");
  }
  assertExactKeys(capture, [
    "id", "title", "text", "kind", "content_type", "capture_method", "media_status",
    "transcription_status", "captured_at", "state", "project_id", "ai_visibility",
  ], "Voice Capture payload");
  assertExactKeys(artifact, [
    "id", "title", "filename", "file_type", "mime_type", "file_size", "stored_path", "original_path",
    "storage_mode", "copied_at", "source_type", "source_id", "theme_id", "media_kind", "duration_ms",
    "container", "content_hash", "media_availability", "ai_visibility",
  ], "Audio Artifact payload");
  for (const id of [capture.id, artifact.id]) {
    if (typeof id !== "string" || !SESSION_ID_PATTERN.test(id)) throw new Error("Media Capture entity IDが不正です。");
  }
  const expectedTitle = baseNameWithoutExtension(String(manifest.filename || ""));
  const expectedContainer = mediaExtensionOf(String(manifest.filename || ""));
  const emptyArray = (value: unknown): boolean => Array.isArray(value) && value.length === 0;
  const identityChecks: Array<[string, boolean]> = [
    ["capture.title", capture.title === expectedTitle], ["capture.text", capture.text === manifest.filename],
    ["capture.kind", capture.kind === "voice_memo"], ["capture.content_type", capture.content_type === "audio"],
    ["capture.capture_method", capture.capture_method === "audio_import"], ["capture.media_status", capture.media_status === "ready"],
    ["capture.transcription_status", capture.transcription_status === "not_requested"], ["capture.state", capture.state === "untriaged"],
    ["capture.project_id", capture.project_id === manifest.themeId], ["capture.captured_at", capture.captured_at === raw.issuedAt],
    ["capture.ai_visibility", emptyArray(capture.ai_visibility)], ["artifact.title", artifact.title === expectedTitle],
    ["artifact.filename", artifact.filename === manifest.filename], ["artifact.file_type", artifact.file_type === expectedContainer],
    ["artifact.mime_type", artifact.mime_type === manifest.mimeType], ["artifact.file_size", artifact.file_size === manifest.fileSize],
    ["artifact.stored_path", artifact.stored_path === manifest.finalPath], ["artifact.original_path", artifact.original_path === null],
    ["artifact.storage_mode", artifact.storage_mode === "managed"], ["artifact.copied_at", artifact.copied_at === raw.issuedAt],
    ["artifact.source_type", artifact.source_type === "capture_entry"], ["artifact.source_id", artifact.source_id === capture.id],
    ["artifact.theme_id", artifact.theme_id === manifest.themeId], ["artifact.media_kind", artifact.media_kind === "audio"],
    ["artifact.duration_ms", artifact.duration_ms === manifest.durationMs], ["artifact.container", artifact.container === expectedContainer],
    ["artifact.content_hash", artifact.content_hash === manifest.contentHash], ["artifact.media_availability", artifact.media_availability === "available"],
    ["artifact.ai_visibility", emptyArray(artifact.ai_visibility)], ["command.issuedAt", raw.issuedAt === manifest.commandIssuedAt],
  ];
  const mismatchedIdentity = identityChecks.find(([, matches]) => !matches)?.[0];
  if (
    capture.title !== expectedTitle
    || capture.text !== manifest.filename
    || capture.kind !== "voice_memo"
    || capture.content_type !== "audio"
    || capture.capture_method !== "audio_import"
    || capture.media_status !== "ready"
    || capture.transcription_status !== "not_requested"
    || capture.state !== "untriaged"
    || capture.project_id !== manifest.themeId
    || capture.captured_at !== raw.issuedAt
    || !emptyArray(capture.ai_visibility)
    || artifact.title !== expectedTitle
    || artifact.filename !== manifest.filename
    || artifact.file_type !== expectedContainer
    || artifact.mime_type !== manifest.mimeType
    || artifact.file_size !== manifest.fileSize
    || artifact.stored_path !== manifest.finalPath
    || artifact.original_path !== null
    || artifact.storage_mode !== "managed"
    || artifact.copied_at !== raw.issuedAt
    || artifact.source_type !== "capture_entry"
    || artifact.source_id !== capture.id
    || artifact.theme_id !== manifest.themeId
    || artifact.media_kind !== "audio"
    || artifact.duration_ms !== manifest.durationMs
    || artifact.container !== expectedContainer
    || artifact.content_hash !== manifest.contentHash
    || artifact.media_availability !== "available"
    || !emptyArray(artifact.ai_visibility)
    || raw.issuedAt !== manifest.commandIssuedAt
  ) {
    throw new Error(`Media Capture commandがmanifest identityと一致しません: ${mismatchedIdentity || "unknown"}`);
  }
  // parseCommandEnvelope は optional fieldをundefinedで補うため、その返却値を
  // manifestへ戻すとallowlist外のown keyが増える。検証済みの原形を正本にする。
  return value as CommandEnvelope;
}

function validateManifest(value: unknown, expectedSessionId: string): AudioSessionManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Media Capture manifestが不正です。");
  const manifest = value as Record<string, unknown>;
  assertExactKeys(manifest, [
    "schema", "sessionId", "state", "mediaKind", "filename", "mimeType", "fileSize", "contentHash",
    "themeId", "stagedFileName", "createdAt", "updatedAt", "finalPath", "managedRootPath",
    "managedRootRealPath", "managedRootDevice", "managedRootInode", "durationMs", "commandIssuedAt", "command", "recoveryError",
  ], "Media Capture manifest");
  if (manifest.schema !== MANIFEST_SCHEMA || manifest.sessionId !== expectedSessionId || !SESSION_ID_PATTERN.test(expectedSessionId)) {
    throw new Error("Media Capture manifest identityが不正です。");
  }
  if (!["prepared", "finalizing", "finalized", "committed"].includes(String(manifest.state))) throw new Error("Media Capture stateが不正です。");
  if (manifest.mediaKind !== "audio" && manifest.mediaKind !== "video") throw new Error("Media Capture kindが不正です。");
  if (typeof manifest.filename !== "string" || path.basename(manifest.filename) !== manifest.filename || !manifest.filename.trim()) throw new Error("Media filenameが不正です。");
  if (manifest.mediaKind === "audio" && audioMimeTypeOf(manifest.filename) !== manifest.mimeType) throw new Error("Media MIMEが不正です。");
  if (!Number.isInteger(manifest.fileSize) || Number(manifest.fileSize) <= 0) throw new Error("Media file sizeが不正です。");
  if (typeof manifest.contentHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(manifest.contentHash)) throw new Error("Media content hashが不正です。");
  if (
    manifest.themeId !== null
    && (typeof manifest.themeId !== "string"
      || (!SESSION_ID_PATTERN.test(manifest.themeId) && manifest.themeId !== PERSONAL_DEFAULT_THEME_ID))
  ) throw new Error("Media Theme IDが不正です。");
  if (typeof manifest.stagedFileName !== "string" || path.basename(manifest.stagedFileName) !== manifest.stagedFileName) throw new Error("Media staged filenameが不正です。");
  if (!isIsoTimestamp(manifest.createdAt) || !isIsoTimestamp(manifest.updatedAt)) throw new Error("Media timestampが不正です。");
  if (manifest.recoveryError !== undefined && !["final_file_missing", "final_hash_mismatch", "commit_failed"].includes(String(manifest.recoveryError))) {
    throw new Error("Media recovery stateが不正です。");
  }
  const state = manifest.state as SessionState;
  const finalFields = ["finalPath", "managedRootPath", "managedRootRealPath", "managedRootDevice", "managedRootInode", "durationMs", "commandIssuedAt", "command"];
  if (state === "prepared" && finalFields.some((field) => manifest[field] !== undefined)) throw new Error("prepared Media manifestにfinalize fieldがあります。");
  if (state !== "prepared" && finalFields.some((field) => manifest[field] === undefined)) throw new Error("Media manifestのfinalize fieldが不足しています。");
  if (state !== "prepared") {
    for (const field of finalFields.slice(0, 5)) {
      if (typeof manifest[field] !== "string" || !(manifest[field] as string).trim()) throw new Error("Media managed root identityが不正です。");
    }
    validDuration(manifest.durationMs);
    if (!isIsoTimestamp(manifest.commandIssuedAt)) throw new Error("Media command timestampが不正です。");
    manifest.command = validateManifestCommand(manifest.command, manifest as Partial<AudioSessionManifest>);
  }
  return manifest as unknown as AudioSessionManifest;
}

export class MediaCaptureService {
  private readonly recoveryRoot: string;
  private readonly idFactory: () => string;
  private readonly now: () => string;
  private readonly verificationCache = new Map<string, { dev: string; ino: string; size: number; mtimeMs: number; ctimeMs: number; contentHash: string }>();

  constructor(private readonly options: MediaCaptureServiceOptions) {
    this.recoveryRoot = path.resolve(options.userDataPath, "media-recovery", "sessions");
    this.idFactory = options.idFactory || randomUUID;
    this.now = options.now || (() => new Date().toISOString());
    ensureSafeDirectory(this.recoveryRoot, "Media recovery保存先");
  }

  prepareFile(sourcePathValue: unknown, themeIdValue: unknown = null): AudioCapturePrepared {
    if (typeof sourcePathValue !== "string" || !path.isAbsolute(sourcePathValue)) {
      throw new Error("音声ファイルの場所が不正です。ファイル選択からやり直してください。");
    }
    const sourcePath = path.resolve(sourcePathValue);
    assertNoSymlinkOrJunctionAncestors(sourcePath, "音声Capture source");
    const filename = safeArtifactFileName(path.basename(sourcePath));
    const mimeType = audioMimeTypeOf(filename);
    if (!mimeType) {
      throw new Error("対応していない音声形式です。MP3、WAV、WebM、Ogg/Opus、M4A/MP4を選択してください。");
    }
    const sessionId = assertSessionId(this.idFactory());
    const sessionDirectory = this.sessionDirectory(sessionId);
    ensureSafeDirectory(sessionDirectory, "Media Capture session保存先");
    const stagedFileName = `original.${mediaExtensionOf(filename)}`;
    const stagedPath = path.resolve(sessionDirectory, stagedFileName);
    assertWithin(sessionDirectory, stagedPath, "音声temporary file");
    let staged: { fileSize: number; contentHash: string };
    try {
      staged = copyVerifiedSourceToExclusiveStage(sourcePath, stagedPath, mimeType);
    } catch (error) {
      this.removeSessionDirectory(sessionDirectory);
      throw error;
    }
    const timestamp = this.now();
    const manifest: AudioSessionManifest = {
      schema: MANIFEST_SCHEMA,
      sessionId,
      state: "prepared",
      mediaKind: "audio",
      filename,
      mimeType,
      fileSize: staged.fileSize,
      contentHash: staged.contentHash,
      themeId: typeof themeIdValue === "string" && themeIdValue.trim() ? themeIdValue.trim() : null,
      stagedFileName,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.writeManifest(sessionDirectory, manifest);
    return {
      sessionId,
      filename,
      mimeType,
      fileSize: staged.fileSize,
      mediaUrl: `tasken-media://session/${sessionId}`,
      status: "ready",
      availability: "available",
      canCommit: true,
      canRetry: false,
      canDiscard: true,
    };
  }

  listPreparedAudio(): AudioCapturePrepared[] {
    const pending: Array<{ summary: AudioCapturePrepared; createdAt: string | null }> = [];
    for (const entry of fs.readdirSync(this.recoveryRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !SESSION_ID_PATTERN.test(entry.name)) continue;
      try {
        const manifest = this.readManifest(this.sessionDirectory(entry.name));
        if (manifest.state === "committed" || manifest.mediaKind !== "audio") continue;
        let resolution = this.resolveSessionMedia(manifest.sessionId);
        if (resolution.availability === "available") fs.closeSync(resolution.fileDescriptor);
        if (manifest.state === "finalizing" && resolution.availability !== "available") {
          const stagedPath = path.resolve(this.sessionDirectory(manifest.sessionId), manifest.stagedFileName);
          assertWithin(this.sessionDirectory(manifest.sessionId), stagedPath, "音声temporary file");
          const stagedResolution = openVerifiedMedia(
            stagedPath,
            manifest.fileSize,
            manifest.contentHash,
            manifest.mimeType,
            this.verificationCache,
            `session-staged:${manifest.sessionId}`,
          );
          if (stagedResolution.availability === "available") {
            fs.closeSync(stagedResolution.fileDescriptor);
            resolution = { availability: "available", fileDescriptor: -1, mimeType: stagedResolution.mimeType, fileSize: stagedResolution.fileSize };
          }
        }
        const ready = manifest.state === "prepared" && resolution.availability === "available";
        const retryable = manifest.state !== "prepared" && resolution.availability === "available";
        pending.push({ summary: {
          sessionId: manifest.sessionId,
          filename: manifest.filename,
          mimeType: manifest.mimeType,
          fileSize: manifest.fileSize,
          mediaUrl: ready ? `tasken-media://session/${manifest.sessionId}` : "",
          status: ready ? "ready" : "recovery_required",
          availability: resolution.availability,
          ...(manifest.durationMs === undefined ? {} : { durationMs: manifest.durationMs }),
          canCommit: ready,
          canRetry: retryable,
          canDiscard: manifest.state === "prepared",
          ...(ready ? {} : {
            recoveryReason: manifest.recoveryError === "commit_failed"
              ? "commit_failed" as const
              : retryable
                ? "recovery_pending" as const
                : resolution.availability === "changed"
              ? "media_changed" as const
              : resolution.availability === "unsafe_source"
                ? "unsafe_source" as const
                : resolution.availability === "unsupported_codec"
                  ? "unsupported_codec" as const
                  : "media_missing" as const,
          }),
        }, createdAt: manifest.createdAt });
      } catch {
        // 壊れたsessionも不可視orphanにしない。pathやmanifest本文はRendererへ出さず、
        // UUID directoryの安全な診断行だけを返す。stateを証明できないため破棄は許可しない。
        pending.push({ summary: {
          sessionId: entry.name,
          filename: "復旧が必要な音声",
          mimeType: "不明",
          fileSize: 0,
          mediaUrl: "",
          status: "recovery_required",
          availability: "missing",
          recoveryReason: "manifest_invalid",
          canCommit: false,
          canRetry: false,
          canDiscard: false,
        }, createdAt: null });
      }
    }
    pending.sort((left, right) => {
      if (left.createdAt && right.createdAt) {
        return right.createdAt.localeCompare(left.createdAt) || left.summary.sessionId.localeCompare(right.summary.sessionId);
      }
      if (left.createdAt) return -1;
      if (right.createdAt) return 1;
      return left.summary.sessionId.localeCompare(right.summary.sessionId);
    });
    return pending.map((entry) => entry.summary);
  }

  commit(request: AudioCaptureCommitRequest): InternalAudioCaptureCommitResult {
    const sessionId = assertSessionId(request?.sessionId);
    const durationMs = validDuration(request?.durationMs);
    const sessionDirectory = this.sessionDirectory(sessionId);
    let manifest = this.readManifest(sessionDirectory);
    if (manifest.state === "committed") {
      if (!manifest.command) throw new Error("音声Capture receiptの復元情報がありません。");
      return this.toInternalResult(manifest, this.options.commands.executeMediaCapture(manifest.command));
    }
    if (manifest.state === "prepared") manifest = this.beginFinalize(sessionDirectory, manifest, durationMs);
    manifest = this.ensureFinalized(sessionDirectory, manifest);
    if (!manifest.command) throw new Error("音声Capture commandの復元情報がありません。");
    try {
      const receipt = this.options.commands.executeMediaCapture(manifest.command);
      const committed = { ...manifest, state: "committed" as const, updatedAt: this.now(), recoveryError: undefined };
      this.writeManifest(sessionDirectory, committed);
      this.removeStagedFile(sessionDirectory, committed);
      return this.toInternalResult(committed, receipt);
    } catch (error) {
      this.writeManifest(sessionDirectory, { ...manifest, recoveryError: "commit_failed", updatedAt: this.now() });
      throw error;
    }
  }

  cancel(sessionIdValue: unknown): boolean {
    const sessionId = assertSessionId(sessionIdValue);
    const sessionDirectory = this.sessionDirectory(sessionId);
    const manifest = this.readManifest(sessionDirectory);
    if (manifest.state !== "prepared") throw new Error("保存処理を開始した音声Captureは破棄できません。再起動後の復旧を待ってください。");
    this.removeSessionDirectory(sessionDirectory);
    return true;
  }

  recoverPending(): { recovered: number; pending: number } {
    let recovered = 0;
    let pending = 0;
    for (const entry of fs.readdirSync(this.recoveryRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !SESSION_ID_PATTERN.test(entry.name)) continue;
      const sessionDirectory = this.sessionDirectory(entry.name);
      let manifest: AudioSessionManifest;
      try {
        manifest = this.readManifest(sessionDirectory);
      } catch {
        pending += 1;
        continue;
      }
      if (manifest.state === "prepared" || manifest.state === "committed") continue;
      try {
        manifest = this.ensureFinalized(sessionDirectory, manifest);
        if (!manifest.command) throw new Error("command missing");
        this.options.commands.executeMediaCapture(manifest.command);
        const committed = { ...manifest, state: "committed" as const, updatedAt: this.now(), recoveryError: undefined };
        this.writeManifest(sessionDirectory, committed);
        this.removeStagedFile(sessionDirectory, committed);
        recovered += 1;
      } catch {
        pending += 1;
      }
    }
    return { recovered, pending };
  }

  resolveSessionMedia(sessionIdValue: unknown): MediaFileResolution {
    try {
      const sessionDirectory = this.sessionDirectory(assertSessionId(sessionIdValue));
      const manifest = this.readManifest(sessionDirectory);
      const candidate = manifest.state === "prepared"
        ? path.resolve(sessionDirectory, manifest.stagedFileName)
        : manifest.finalPath ? path.resolve(manifest.finalPath) : "";
      if (!candidate) return { availability: "missing" };
      if (manifest.state === "prepared") assertWithin(sessionDirectory, candidate, "音声temporary file");
      if (manifest.state !== "prepared") {
        const location = this.options.resolveManagedDirectory(manifest.themeId);
        if (location.kind === "needs_directory") return { availability: "missing" };
        const managedRoot = resolveSafeExistingDirectory(location.directory, "managed Media保存先");
        assertWithin(managedRoot.real, candidate, "managed Media file");
      }
      if (!audioMimeTypeOf(manifest.filename)) return { availability: "unsupported_codec" };
      return openVerifiedMedia(candidate, manifest.fileSize, manifest.contentHash, manifest.mimeType, this.verificationCache, `session:${manifest.sessionId}`);
    } catch {
      return { availability: "missing" };
    }
  }

  resolveArtifactMedia(artifactIdValue: unknown): MediaFileResolution {
    if (typeof artifactIdValue !== "string" || !SESSION_ID_PATTERN.test(artifactIdValue)) return { availability: "missing" };
    const artifact = this.options.repository.get("artifact", artifactIdValue);
    if (!artifact || artifact.media_kind !== "audio") return { availability: "missing" };
    if (!audioMimeTypeOf(String(artifact.filename || "")) || String(artifact.mime_type || "") !== audioMimeTypeOf(String(artifact.filename || ""))) {
      return { availability: "unsupported_codec" };
    }
    const rawPath = artifact.storage_mode === "linked" ? artifact.target : artifact.stored_path;
    if (typeof rawPath !== "string" || !path.isAbsolute(rawPath)) return { availability: "missing" };
    const filePath = path.resolve(rawPath);
    if (artifact.storage_mode === "managed") {
      try {
        const location = this.options.resolveManagedDirectory(typeof artifact.theme_id === "string" ? artifact.theme_id : null);
        if (location.kind === "needs_directory") return { availability: "missing" };
        const managedRoot = resolveSafeExistingDirectory(location.directory, "managed Media保存先");
        assertWithin(managedRoot.real, filePath, "managed Media file");
      } catch {
        return { availability: "unsafe_source" };
      }
    }
    if (typeof artifact.content_hash !== "string" || typeof artifact.file_size !== "number") return { availability: "changed" };
    return openVerifiedMedia(filePath, artifact.file_size, artifact.content_hash, String(artifact.mime_type), this.verificationCache, `artifact:${artifactIdValue}`);
  }

  private beginFinalize(sessionDirectory: string, manifest: AudioSessionManifest, durationMs: number): AudioSessionManifest {
    const location = this.options.resolveManagedDirectory(manifest.themeId);
    if (location.kind === "needs_directory") {
      throw new Error("Artifact保存先が未設定です。Settingsで同期ストレージを選択してから、もう一度保存してください。");
    }
    const managedRoot = ensureSafeDirectory(location.directory, "managed Media保存先");
    ensureThemeMarker(location, managedRoot);
    const filename = resolveUniqueArtifactFileName(manifest.filename, (candidate: string) => fs.existsSync(path.join(managedRoot.real, candidate)));
    const finalPath = path.resolve(managedRoot.real, filename);
    assertWithin(managedRoot.real, finalPath, "managed audio file");
    const commandId = this.idFactory();
    const captureId = this.idFactory();
    const artifactId = this.idFactory();
    const timestamp = this.now();
    const title = baseNameWithoutExtension(filename);
    const capture: Entity = {
      id: captureId,
      title,
      text: filename,
      kind: "voice_memo",
      content_type: "audio",
      capture_method: "audio_import",
      media_status: "ready",
      transcription_status: "not_requested",
      captured_at: timestamp,
      state: "untriaged",
      project_id: manifest.themeId,
      ai_visibility: [],
    };
    const artifact: Entity = {
      id: artifactId,
      title,
      filename,
      file_type: mediaExtensionOf(filename),
      mime_type: manifest.mimeType,
      file_size: manifest.fileSize,
      stored_path: finalPath,
      original_path: null,
      storage_mode: "managed",
      copied_at: timestamp,
      source_type: "capture_entry",
      source_id: captureId,
      theme_id: manifest.themeId,
      media_kind: "audio",
      duration_ms: durationMs,
      container: mediaExtensionOf(filename),
      content_hash: manifest.contentHash,
      media_availability: "available",
      ai_visibility: [],
    };
    const command: CommandEnvelope = {
      commandId,
      name: "CommitAudioCapture",
      payload: { capture, artifact },
      actor: { kind: "user" },
      source: "inbox",
      sessionId: manifest.sessionId,
      issuedAt: timestamp,
    };
    const finalizing: AudioSessionManifest = {
      ...manifest,
      state: "finalizing",
      filename,
      finalPath,
      managedRootPath: managedRoot.resolved,
      managedRootRealPath: managedRoot.real,
      managedRootDevice: managedRoot.device,
      managedRootInode: managedRoot.inode,
      durationMs,
      commandIssuedAt: timestamp,
      command,
      updatedAt: timestamp,
      recoveryError: undefined,
    };
    this.writeManifest(sessionDirectory, finalizing);
    return finalizing;
  }

  private ensureFinalized(sessionDirectory: string, manifest: AudioSessionManifest): AudioSessionManifest {
    if (manifest.state === "committed") return manifest;
    if (
      (manifest.state !== "finalizing" && manifest.state !== "finalized")
      || !manifest.finalPath
      || !manifest.managedRootPath
      || !manifest.managedRootRealPath
      || !manifest.managedRootDevice
      || !manifest.managedRootInode
    ) throw new Error("音声Capture finalize状態が不正です。");
    const stagedPath = path.resolve(sessionDirectory, manifest.stagedFileName);
    assertWithin(sessionDirectory, stagedPath, "音声temporary file");
    const stagedStat = fs.lstatSync(stagedPath);
    if (stagedStat.isSymbolicLink() || !stagedStat.isFile() || stagedStat.size !== manifest.fileSize || hashFile(stagedPath) !== manifest.contentHash) {
      throw new Error("temporary原音が変更されたため、安全にfinalizeできません。原音は読み込まず復旧待ちにしました。");
    }
    const location = this.options.resolveManagedDirectory(manifest.themeId);
    if (location.kind === "needs_directory" || path.resolve(location.directory) !== path.resolve(manifest.managedRootPath)) {
      throw new Error("managed保存先がsession作成時から変更されています。原音を保持したまま復旧待ちにしました。");
    }
    const managedRoot = ensureSafeDirectory(location.directory, "managed Media保存先");
    if (
      managedRoot.real !== manifest.managedRootRealPath
      || managedRoot.device !== manifest.managedRootDevice
      || managedRoot.inode !== manifest.managedRootInode
    ) {
      throw new Error("managed保存先のidentityがsession作成時から変わっています。原音を保持したまま復旧待ちにしました。");
    }
    const finalPath = path.resolve(manifest.finalPath);
    assertWithin(managedRoot.real, finalPath, "managed audio file");
    if (path.dirname(finalPath) !== managedRoot.real || path.basename(finalPath) !== manifest.filename) {
      throw new Error("managed audio fileのmanifest identityが不正です。");
    }
    if (fs.existsSync(finalPath)) {
      const existing = fs.lstatSync(finalPath);
      if (existing.isSymbolicLink() || !existing.isFile()) {
        throw new Error("managed保存先に安全でない競合fileがあります。既存fileを変更せず復旧待ちにしました。");
      }
      if (existing.size !== manifest.fileSize || hashFile(finalPath) !== manifest.contentHash) {
        throw new Error("managed保存先に別内容の競合fileがあります。既存fileを変更せず復旧待ちにしました。");
      }
    } else if (manifest.state === "finalizing") {
      fs.copyFileSync(stagedPath, finalPath, fs.constants.COPYFILE_EXCL);
    } else {
      const failed = { ...manifest, recoveryError: "final_file_missing" as const, updatedAt: this.now() };
      this.writeManifest(sessionDirectory, failed);
      throw new Error("finalize済みのmanaged原音がありません。temporary原音を保持したまま復旧待ちにしました。");
    }
    const finalStat = fs.statSync(finalPath);
    if (finalStat.size !== manifest.fileSize || hashFile(finalPath) !== manifest.contentHash) {
      const failed = { ...manifest, recoveryError: "final_hash_mismatch" as const, updatedAt: this.now() };
      this.writeManifest(sessionDirectory, failed);
      throw new Error("managed保存した原音のhashが一致しません。temporary原音を保持したまま復旧待ちにしました。");
    }
    if (manifest.state === "finalized") return manifest;
    const finalized = { ...manifest, state: "finalized" as const, recoveryError: undefined, updatedAt: this.now() };
    this.writeManifest(sessionDirectory, finalized);
    return finalized;
  }

  private toInternalResult(manifest: AudioSessionManifest, receipt: CommandReceipt): InternalAudioCaptureCommitResult {
    const payload = manifest.command?.payload as { capture?: Entity; artifact?: Entity } | undefined;
    if (!manifest.command || !payload?.capture?.id || !payload.artifact?.id) throw new Error("音声Capture receiptのidentityが不正です。");
    const publicResult: AudioCaptureCommitResult = {
      status: receipt.status === "no_change" ? "no_change" : "applied",
      commandId: manifest.command.commandId,
      captureId: payload.capture.id,
      artifactId: payload.artifact.id,
    };
    return { publicResult, receipt };
  }

  private sessionDirectory(sessionId: string): string {
    const directory = path.resolve(this.recoveryRoot, sessionId);
    assertWithin(this.recoveryRoot, directory, "音声Capture session");
    return directory;
  }

  private manifestPath(sessionDirectory: string): string {
    const filePath = path.resolve(sessionDirectory, "session.json");
    assertWithin(sessionDirectory, filePath, "音声Capture manifest");
    return filePath;
  }

  private readManifest(sessionDirectory: string): AudioSessionManifest {
    const rootStat = fs.lstatSync(sessionDirectory);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("音声Capture sessionにsymlink/junctionは利用できません。");
    const manifestPath = this.manifestPath(sessionDirectory);
    const manifestStat = fs.lstatSync(manifestPath);
    if (manifestStat.isSymbolicLink() || !manifestStat.isFile() || manifestStat.size <= 0 || manifestStat.size > MAX_MANIFEST_BYTES) {
      throw new Error("Media Capture manifest fileが不正です。");
    }
    return validateManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")), path.basename(sessionDirectory));
  }

  private writeManifest(sessionDirectory: string, manifest: AudioSessionManifest): void {
    validateManifest(manifest, path.basename(sessionDirectory));
    writeAtomicTextFile(this.manifestPath(sessionDirectory), `${JSON.stringify(manifest, null, 2)}\n`, randomUUID());
  }

  private removeStagedFile(sessionDirectory: string, manifest: AudioSessionManifest): void {
    const stagedPath = path.resolve(sessionDirectory, manifest.stagedFileName);
    assertWithin(sessionDirectory, stagedPath, "音声temporary file");
    fs.rmSync(stagedPath, { force: true });
  }

  private removeSessionDirectory(sessionDirectory: string): void {
    assertWithin(this.recoveryRoot, sessionDirectory, "音声Capture session");
    assertNoSymlinkOrJunctionAncestors(sessionDirectory, "音声Capture session");
    const stat = fs.lstatSync(sessionDirectory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("音声Capture sessionを安全に破棄できません。");
    for (const entry of fs.readdirSync(sessionDirectory, { withFileTypes: true })) {
      const candidate = path.resolve(sessionDirectory, entry.name);
      assertWithin(sessionDirectory, candidate, "音声Capture session entry");
      const own = fs.lstatSync(candidate);
      if (own.isSymbolicLink()) {
        fs.unlinkSync(candidate);
      } else if (own.isDirectory()) {
        // session schemaは直下fileだけ。予期しないdirectoryは再帰追跡せず破棄を止める。
        throw new Error("音声Capture sessionに予期しないdirectoryがあります。手動で確認してください。");
      } else if (own.isFile()) {
        fs.unlinkSync(candidate);
      } else {
        throw new Error("音声Capture sessionに安全に破棄できないentryがあります。");
      }
    }
    fs.rmdirSync(sessionDirectory);
  }
}
