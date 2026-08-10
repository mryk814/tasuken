import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

import { parseCommandEnvelope, type CommandEnvelope, type CommandReceipt } from "../../shared/applicationCommand";
import type {
  AudioCaptureCommitRequest,
  AudioCaptureCommitResult,
  AudioCapturePrepared,
  InternalAudioCaptureCommitResult,
  InternalVideoImportCommitResult,
  MediaRecordingAppendRequest,
  MediaRecordingStartRequest,
  MediaRecordingProgress,
  MediaRecordingStarted,
  VideoArtifactSourceType,
  VideoImportCommitRequest,
  VideoImportPrepared,
  VideoStorageMode,
} from "../../shared/mediaCapture";
import { audioMimeTypeOf, mediaExtensionOf, videoMimeTypeOf } from "../../shared/mediaArtifact.mjs";
import type { MediaAvailability } from "../../shared/mediaArtifact.mjs";
import { resolveUniqueArtifactFileName, safeArtifactFileName } from "./artifactStorage.mjs";
import type { Entity } from "../../shared/types/workspace";
import { writeAtomicTextFile } from "./atomicText.mjs";
import { buildThemeFolderManifest, THEME_FOLDER_MANIFEST, themeFolderManifestMatches } from "../../shared/storageResolver.mjs";

const MANIFEST_SCHEMA = "tasken-media-session/v1";
const SESSION_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH_CHUNK_SIZE = 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const EXTERNAL_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;
export const MICROPHONE_CHUNK_MAX_BYTES = 1024 * 1024;
export const MICROPHONE_RECORDING_MAX_BYTES = 512 * 1024 * 1024;
export const MICROPHONE_RECORDING_MAX_CHUNKS = 16_000;
const MICROPHONE_RECORDING_MAX_DURATION_MS = 4 * 60 * 60 * 1000;
export const MEDIA_RECORDING_CHUNK_MAX_BYTES = MICROPHONE_CHUNK_MAX_BYTES;
export const MEDIA_RECORDING_MAX_BYTES = MICROPHONE_RECORDING_MAX_BYTES;
export const MEDIA_RECORDING_MAX_CHUNKS = MICROPHONE_RECORDING_MAX_CHUNKS;
export const MEDIA_RECORDING_MAX_DURATION_MS = MICROPHONE_RECORDING_MAX_DURATION_MS;

type SessionState = "recording" | "recording_paused" | "prepared" | "finalizing" | "finalized" | "committed";

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
  storageMode?: VideoStorageMode;
  sourceType?: VideoArtifactSourceType;
  sourceId?: string;
  sourcePath?: string;
  sourceRealPath?: string;
  sourceDevice?: string;
  sourceInode?: string;
  stagedFileName: string;
  createdAt: string;
  updatedAt: string;
  finalPath?: string;
  managedRootPath?: string;
  managedRootRealPath?: string;
  managedRootDevice?: string;
  managedRootInode?: string;
  durationMs?: number;
  widthPx?: number;
  heightPx?: number;
  commandIssuedAt?: string;
  command?: CommandEnvelope;
  recoveryError?: "final_file_missing" | "final_hash_mismatch" | "commit_failed";
  captureMethod?: "audio_import" | "microphone" | "screen_recording";
  recordingNextSequence?: number;
  recordingChunkHashes?: string;
  recordingStartedAt?: string;
  recordingElapsedMs?: number;
  recordingStateStartedAt?: string;
}

interface MediaRepository {
  get(type: "artifact" | "project" | "theme" | "task" | "note" | "capture_entry", id: string, includeDeleted?: boolean): Entity | null;
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
  openPath?: (filePath: string) => Promise<string>;
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

function hasExpectedMediaSignature(descriptor: number, mimeType: string): boolean {
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
  if (mimeType === "video/mp4" || mimeType === "video/quicktime") {
    return length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp";
  }
  if (mimeType === "video/webm") return length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return false;
}

function copyVerifiedSourceToExclusiveStage(sourcePath: string, stagedPath: string, mimeType: string, mediaLabel = "音声"): { fileSize: number; contentHash: string; sourceRealPath: string; sourceDevice: string; sourceInode: string } {
  let sourceDescriptor: number | null = null;
  let stagedDescriptor: number | null = null;
  try {
    assertNoSymlinkOrJunctionAncestors(sourcePath, `${mediaLabel} source`);
    const sourceRealPath = fs.realpathSync.native(sourcePath);
    const before = fs.lstatSync(sourcePath);
    if (before.isSymbolicLink() || !before.isFile()) {
      throw new UnsafeMediaSourceError(`symlink/junctionやファイル以外は${mediaLabel}へ取り込めません。`);
    }
    if (before.size <= 0) throw new Error(`空の${mediaLabel}ファイルは取り込めません。元ファイルを確認してください。`);
    const noFollow = "O_NOFOLLOW" in fs.constants ? Number(fs.constants.O_NOFOLLOW) : 0;
    sourceDescriptor = fs.openSync(sourcePath, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(sourceDescriptor);
    const afterOpen = fs.lstatSync(sourcePath);
    const afterRealPath = fs.realpathSync.native(sourcePath);
    if (
      !opened.isFile()
      || afterOpen.isSymbolicLink()
      || !afterOpen.isFile()
      || !sameFileIdentity(before, opened)
      || !sameFileIdentity(opened, afterOpen)
      || afterRealPath !== sourceRealPath
    ) {
      throw new UnsafeMediaSourceError(`${mediaLabel} sourceが確認中に差し替えられました。取り込みを中止しました。`);
    }
    if (!hasExpectedMediaSignature(sourceDescriptor, mimeType)) {
      throw new Error(`${mediaLabel}ファイルの内容と拡張子が一致しません。正しいファイルを選択してください。`);
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
    return {
      fileSize: stagedStat.size,
      contentHash: `sha256:${hash.digest("hex")}`,
      sourceRealPath,
      sourceDevice: String(opened.dev),
      sourceInode: String(opened.ino),
    };
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
class VideoOwnerBindingError extends Error {}

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
  if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > 7 * 24 * 60 * 60 * 1000) {
    throw new Error("音声の長さを取得できませんでした。対応形式を確認して、もう一度選択してください。");
  }
  return numeric;
}

function recordingChunkFileName(sequence: number): string {
  return `chunk-${String(sequence).padStart(8, "0")}.part`;
}

function elapsedSince(startedAt: string, now: string): number {
  return Math.max(0, Date.parse(now) - Date.parse(startedAt));
}

interface DirectoryIdentity {
  dev: string;
  ino: string;
}

function captureDirectoryIdentity(directory: string, label: string): DirectoryIdentity {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${label}が安全なdirectoryではありません。`);
  return { dev: String(stat.dev), ino: String(stat.ino) };
}

function assertDirectoryIdentity(directory: string, expected: DirectoryIdentity, label: string): void {
  const current = captureDirectoryIdentity(directory, label);
  if (current.dev !== expected.dev || current.ino !== expected.ino) throw new Error(`${label}が処理中に差し替えられました。`);
}

function linkedIdentityMatches(
  filePath: string,
  descriptor: number,
  identity: { sourceRealPath?: unknown; sourceDevice?: unknown; sourceInode?: unknown },
): boolean {
  try {
    const stat = fs.fstatSync(descriptor);
    return typeof identity.sourceRealPath === "string"
      && fs.realpathSync.native(filePath) === identity.sourceRealPath
      && String(stat.dev) === identity.sourceDevice
      && String(stat.ino) === identity.sourceInode;
  } catch {
    return false;
  }
}

function publishVerifiedStageExclusive(stagedPath: string, finalPath: string, expectedSize: number, expectedHash: string): void {
  let sourceDescriptor: number | null = null;
  let finalDescriptor: number | null = null;
  let createdFinal = false;
  try {
    assertNoSymlinkOrJunctionAncestors(stagedPath, "Media temporary source");
    const before = fs.lstatSync(stagedPath);
    if (before.isSymbolicLink() || !before.isFile()) throw new UnsafeMediaSourceError("Media temporary sourceが安全な通常fileではありません。");
    const noFollow = "O_NOFOLLOW" in fs.constants ? Number(fs.constants.O_NOFOLLOW) : 0;
    sourceDescriptor = fs.openSync(stagedPath, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(sourceDescriptor);
    const afterOpen = fs.lstatSync(stagedPath);
    if (!opened.isFile() || afterOpen.isSymbolicLink() || !afterOpen.isFile() || !sameFileIdentity(before, opened) || !sameFileIdentity(opened, afterOpen) || opened.size !== expectedSize) {
      throw new UnsafeMediaSourceError("Media temporary sourceがpublish前に差し替えられました。");
    }
    if (hashFileDescriptor(sourceDescriptor) !== expectedHash) throw new Error("Media temporary sourceのhashが一致しません。");
    finalDescriptor = fs.openSync(finalPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow, 0o600);
    createdFinal = true;
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(HASH_CHUNK_SIZE);
    let position = 0;
    while (position < opened.size) {
      const bytesRead = fs.readSync(sourceDescriptor, buffer, 0, Math.min(buffer.length, opened.size - position), position);
      if (bytesRead <= 0) throw new Error("Media temporary sourceを最後までpublishできませんでした。");
      let written = 0;
      while (written < bytesRead) {
        const bytesWritten = fs.writeSync(finalDescriptor, buffer, written, bytesRead - written, position + written);
        if (bytesWritten <= 0) throw new Error("managed Media fileへ完全に書き込めませんでした。");
        written += bytesWritten;
      }
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    fs.fsyncSync(finalDescriptor);
    const finalStat = fs.fstatSync(finalDescriptor);
    if (finalStat.size !== expectedSize || `sha256:${hash.digest("hex")}` !== expectedHash) throw new Error("managed Media fileのpublish検証に失敗しました。");
  } catch (error) {
    if (finalDescriptor !== null) {
      fs.closeSync(finalDescriptor);
      finalDescriptor = null;
    }
    if (createdFinal) fs.rmSync(finalPath, { force: true });
    throw error;
  } finally {
    if (finalDescriptor !== null) fs.closeSync(finalDescriptor);
    if (sourceDescriptor !== null) fs.closeSync(sourceDescriptor);
  }
}

function copyVerifiedDescriptorToExclusiveFile(sourceDescriptor: number, finalPath: string, expectedSize: number, expectedHash: string): void {
  let finalDescriptor: number | null = null;
  let createdFinal = false;
  try {
    const opened = fs.fstatSync(sourceDescriptor);
    if (!opened.isFile() || opened.size !== expectedSize || hashFileDescriptor(sourceDescriptor) !== expectedHash) {
      throw new Error("検証済みMedia descriptorのidentityが一致しません。");
    }
    const noFollow = "O_NOFOLLOW" in fs.constants ? Number(fs.constants.O_NOFOLLOW) : 0;
    finalDescriptor = fs.openSync(finalPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow, 0o600);
    createdFinal = true;
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(HASH_CHUNK_SIZE);
    let position = 0;
    while (position < expectedSize) {
      const bytesRead = fs.readSync(sourceDescriptor, buffer, 0, Math.min(buffer.length, expectedSize - position), position);
      if (bytesRead <= 0) throw new Error("検証済みMediaをsnapshotへ完全にcopyできませんでした。");
      let written = 0;
      while (written < bytesRead) {
        const bytesWritten = fs.writeSync(finalDescriptor, buffer, written, bytesRead - written, position + written);
        if (bytesWritten <= 0) throw new Error("Media snapshotへ完全に書き込めませんでした。");
        written += bytesWritten;
      }
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    fs.fsyncSync(finalDescriptor);
    const finalStat = fs.fstatSync(finalDescriptor);
    if (finalStat.size !== expectedSize || `sha256:${hash.digest("hex")}` !== expectedHash) throw new Error("Media snapshotのpublish検証に失敗しました。");
  } catch (error) {
    if (finalDescriptor !== null) { fs.closeSync(finalDescriptor); finalDescriptor = null; }
    if (createdFinal) fs.rmSync(finalPath, { force: true });
    throw error;
  } finally {
    if (finalDescriptor !== null) fs.closeSync(finalDescriptor);
  }
}

function validVideoDimensions(widthValue: unknown, heightValue: unknown): { widthPx: number; heightPx: number } {
  const widthPx = Number(widthValue);
  const heightPx = Number(heightValue);
  if (
    !Number.isSafeInteger(widthPx)
    || !Number.isSafeInteger(heightPx)
    || widthPx <= 0
    || heightPx <= 0
    || widthPx > 16384
    || heightPx > 16384
  ) throw new Error("動画のdimensionsを取得できませんでした。対応形式を確認して、もう一度選択してください。");
  return { widthPx, heightPx };
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
    (manifest.mediaKind === "audio" ? parsed.name !== "CommitAudioCapture" : parsed.name !== "CommitVideoArtifact")
    || parsed.actor.kind !== "user"
    || (manifest.mediaKind === "audio" ? parsed.source !== "inbox" : parsed.source !== "main_ui")
    || parsed.sessionId !== manifest.sessionId
    || !SESSION_ID_PATTERN.test(parsed.commandId)
  ) throw new Error("Media Capture command identityが不正です。");
  const actor = raw.actor as Record<string, unknown>;
  assertExactKeys(actor, ["kind"], "Media Capture actor");
  const payload = raw.payload as Record<string, unknown>;
  assertExactKeys(payload, manifest.mediaKind === "audio" ? ["capture", "artifact"] : ["artifact"], "Media Capture payload");
  if (manifest.mediaKind === "video") {
    const artifact = payload.artifact as Record<string, unknown>;
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) throw new Error("Video Artifact payloadが不正です。");
    assertExactKeys(artifact, [
      "id", "title", "filename", "file_type", "mime_type", "file_size", "stored_path", "original_path", "target",
      "storage_mode", "copied_at", "link_type", "link_status", "last_checked_at", "source_type", "source_id", "theme_id",
      "linked_source_real_path", "linked_source_device", "linked_source_inode",
      "media_kind", "capture_method", "duration_ms", "width_px", "height_px", "container", "content_hash", "media_availability", "ai_visibility",
    ], "Video Artifact payload");
    if (typeof artifact.id !== "string" || !SESSION_ID_PATTERN.test(artifact.id)) throw new Error("Video Artifact IDが不正です。");
    const expectedTitle = baseNameWithoutExtension(String(manifest.filename || ""));
    const expectedContainer = mediaExtensionOf(String(manifest.filename || ""));
    const emptyArray = (value: unknown): boolean => Array.isArray(value) && value.length === 0;
    const managed = manifest.storageMode === "managed";
    const identityChecks: Array<[string, boolean]> = [
      ["artifact.title", artifact.title === expectedTitle], ["artifact.filename", artifact.filename === manifest.filename],
      ["artifact.file_type", artifact.file_type === expectedContainer], ["artifact.mime_type", artifact.mime_type === manifest.mimeType],
      ["artifact.file_size", artifact.file_size === manifest.fileSize], ["artifact.storage_mode", artifact.storage_mode === manifest.storageMode],
      ["artifact.stored_path", artifact.stored_path === (managed ? manifest.finalPath : "")],
      ["artifact.target", artifact.target === (managed ? null : manifest.finalPath)],
      ["artifact.original_path", artifact.original_path === null], ["artifact.copied_at", artifact.copied_at === (managed ? raw.issuedAt : null)],
      ["artifact.link_type", artifact.link_type === (managed ? null : "local_path")],
      ["artifact.link_status", artifact.link_status === (managed ? null : "ok")],
      ["artifact.last_checked_at", artifact.last_checked_at === (managed ? null : raw.issuedAt)],
      ["artifact.linked_source_real_path", artifact.linked_source_real_path === (managed ? null : manifest.sourceRealPath)],
      ["artifact.linked_source_device", artifact.linked_source_device === (managed ? null : manifest.sourceDevice)],
      ["artifact.linked_source_inode", artifact.linked_source_inode === (managed ? null : manifest.sourceInode)],
      ["artifact.source_type", artifact.source_type === manifest.sourceType], ["artifact.source_id", artifact.source_id === manifest.sourceId],
      ["artifact.theme_id", artifact.theme_id === manifest.themeId], ["artifact.media_kind", artifact.media_kind === "video"],
      ["artifact.capture_method", manifest.captureMethod === "screen_recording"
        ? artifact.capture_method === "screen_recording"
        : !Object.hasOwn(artifact, "capture_method")],
      ["artifact.duration_ms", artifact.duration_ms === manifest.durationMs], ["artifact.width_px", artifact.width_px === manifest.widthPx],
      ["artifact.height_px", artifact.height_px === manifest.heightPx], ["artifact.container", artifact.container === expectedContainer],
      ["artifact.content_hash", artifact.content_hash === manifest.contentHash], ["artifact.media_availability", artifact.media_availability === "available"],
      ["artifact.ai_visibility", emptyArray(artifact.ai_visibility)], ["command.issuedAt", raw.issuedAt === manifest.commandIssuedAt],
    ];
    const mismatch = identityChecks.find(([, matches]) => !matches)?.[0];
    if (mismatch) throw new Error(`Media Capture commandがmanifest identityと一致しません: ${mismatch}`);
    return value as CommandEnvelope;
  }
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
  const expectedCaptureMethod = manifest.captureMethod === "microphone" ? "microphone" : "audio_import";
  const emptyArray = (value: unknown): boolean => Array.isArray(value) && value.length === 0;
  const identityChecks: Array<[string, boolean]> = [
    ["capture.title", capture.title === expectedTitle], ["capture.text", capture.text === manifest.filename],
    ["capture.kind", capture.kind === "voice_memo"], ["capture.content_type", capture.content_type === "audio"],
    ["capture.capture_method", capture.capture_method === expectedCaptureMethod], ["capture.media_status", capture.media_status === "ready"],
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
    || capture.capture_method !== expectedCaptureMethod
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
    "themeId", "storageMode", "sourceType", "sourceId", "sourcePath", "sourceRealPath", "sourceDevice", "sourceInode", "stagedFileName", "createdAt", "updatedAt", "finalPath", "managedRootPath",
    "managedRootRealPath", "managedRootDevice", "managedRootInode", "durationMs", "widthPx", "heightPx", "commandIssuedAt", "command", "recoveryError",
    "captureMethod", "recordingNextSequence", "recordingChunkHashes", "recordingStartedAt", "recordingElapsedMs", "recordingStateStartedAt",
  ], "Media Capture manifest");
  if (manifest.schema !== MANIFEST_SCHEMA || manifest.sessionId !== expectedSessionId || !SESSION_ID_PATTERN.test(expectedSessionId)) {
    throw new Error("Media Capture manifest identityが不正です。");
  }
  if (!["recording", "recording_paused", "prepared", "finalizing", "finalized", "committed"].includes(String(manifest.state))) throw new Error("Media Capture stateが不正です。");
  if (manifest.mediaKind !== "audio" && manifest.mediaKind !== "video") throw new Error("Media Capture kindが不正です。");
  if (typeof manifest.filename !== "string" || path.basename(manifest.filename) !== manifest.filename || !manifest.filename.trim()) throw new Error("Media filenameが不正です。");
  if (manifest.mediaKind === "audio" && audioMimeTypeOf(manifest.filename) !== manifest.mimeType) throw new Error("Media MIMEが不正です。");
  if (manifest.mediaKind === "video" && videoMimeTypeOf(manifest.filename) !== manifest.mimeType) throw new Error("Media MIMEが不正です。");
  if (!Number.isSafeInteger(manifest.fileSize) || Number(manifest.fileSize) < 0 || Number(manifest.fileSize) > 1024 * 1024 * 1024 * 1024) throw new Error("Media file sizeが不正です。");
  if (typeof manifest.contentHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(manifest.contentHash)) throw new Error("Media content hashが不正です。");
  if (
    manifest.themeId !== null
    && (typeof manifest.themeId !== "string"
      || !manifest.themeId
      || manifest.themeId !== manifest.themeId.trim()
      || manifest.themeId.length > 200)
  ) throw new Error("Media Theme IDが不正です。");
  if (typeof manifest.stagedFileName !== "string" || path.basename(manifest.stagedFileName) !== manifest.stagedFileName) throw new Error("Media staged filenameが不正です。");
  if (!isIsoTimestamp(manifest.createdAt) || !isIsoTimestamp(manifest.updatedAt)) throw new Error("Media timestampが不正です。");
  if (manifest.recoveryError !== undefined && !["final_file_missing", "final_hash_mismatch", "commit_failed"].includes(String(manifest.recoveryError))) {
    throw new Error("Media recovery stateが不正です。");
  }
  const state = manifest.state as SessionState;
  const recordingState = state === "recording" || state === "recording_paused";
  if (recordingState || manifest.captureMethod === "microphone" || manifest.captureMethod === "screen_recording") {
    const isMicrophone = manifest.mediaKind === "audio" && manifest.captureMethod === "microphone";
    const isScreenRecording = manifest.mediaKind === "video" && manifest.captureMethod === "screen_recording";
    if (!isMicrophone && !isScreenRecording) throw new Error("録音session kindが不正です。");
    if (!Number.isSafeInteger(manifest.recordingNextSequence) || Number(manifest.recordingNextSequence) < 0 || Number(manifest.recordingNextSequence) > MICROPHONE_RECORDING_MAX_CHUNKS) throw new Error("録音chunk sequenceが不正です。");
    if (typeof manifest.recordingChunkHashes !== "string" || manifest.recordingChunkHashes.length !== Number(manifest.recordingNextSequence) * 64 || !/^[a-f0-9]*$/.test(manifest.recordingChunkHashes)) throw new Error("録音chunk hashが不正です。");
    if (!isIsoTimestamp(manifest.recordingStartedAt) || !Number.isSafeInteger(manifest.recordingElapsedMs) || Number(manifest.recordingElapsedMs) < 0 || Number(manifest.recordingElapsedMs) > MICROPHONE_RECORDING_MAX_DURATION_MS) throw new Error("録音経過時間が不正です。");
    if (state === "recording" && !isIsoTimestamp(manifest.recordingStateStartedAt)) throw new Error("録音開始時刻が不正です。");
    if (state !== "recording" && manifest.recordingStateStartedAt !== undefined) throw new Error("停止中の録音sessionに開始時刻があります。");
    if (Number(manifest.fileSize) > MICROPHONE_RECORDING_MAX_BYTES) throw new Error("録音sizeが上限を超えています。");
  } else if (["recordingNextSequence", "recordingChunkHashes", "recordingStartedAt", "recordingElapsedMs", "recordingStateStartedAt"].some((field) => manifest[field] !== undefined)) {
    throw new Error("Import sessionに録音fieldがあります。");
  } else if (manifest.captureMethod !== undefined && manifest.captureMethod !== "audio_import") {
    throw new Error("Audio capture methodが不正です。");
  }
  if (!recordingState && Number(manifest.fileSize) <= 0) throw new Error("Media file sizeが不正です。");
  if (manifest.mediaKind === "video") {
    if (manifest.storageMode !== "managed" && manifest.storageMode !== "linked") throw new Error("Video storage modeが不正です。");
    if (!manifest.sourceType || !["task", "note", "report", "capture_entry"].includes(String(manifest.sourceType))) throw new Error("Video source typeが不正です。");
    if (typeof manifest.sourceId !== "string" || !manifest.sourceId || manifest.sourceId !== manifest.sourceId.trim() || manifest.sourceId.length > 200) throw new Error("Video source IDが不正です。");
    if (manifest.storageMode === "linked") {
      if (typeof manifest.sourcePath !== "string" || !path.isAbsolute(manifest.sourcePath)
        || typeof manifest.sourceRealPath !== "string" || !path.isAbsolute(manifest.sourceRealPath)
        || typeof manifest.sourceDevice !== "string" || !manifest.sourceDevice
        || typeof manifest.sourceInode !== "string" || !manifest.sourceInode) throw new Error("Linked Video source identityが不正です。");
    } else if (["sourcePath", "sourceRealPath", "sourceDevice", "sourceInode"].some((field) => manifest[field] !== undefined)) {
      throw new Error("managed Video manifestにlinked source identityは保存できません。");
    }
  } else if (["storageMode", "sourceType", "sourceId", "sourcePath", "sourceRealPath", "sourceDevice", "sourceInode", "widthPx", "heightPx"].some((field) => manifest[field] !== undefined)) {
    throw new Error("Audio manifestにVideo fieldがあります。");
  }
  const finalFields = ["finalPath", "commandIssuedAt", "command"];
  const managedFields = ["managedRootPath", "managedRootRealPath", "managedRootDevice", "managedRootInode"];
  const finalizedOnlyFields = [...finalFields, ...managedFields, "widthPx", "heightPx"];
  if ((state === "prepared" || recordingState) && finalizedOnlyFields.some((field) => manifest[field] !== undefined)) throw new Error("未確定Media manifestにfinalize fieldがあります。");
  if (recordingState && manifest.durationMs !== undefined) throw new Error("録音中manifestにdurationがあります。");
  if (state === "prepared" && manifest.captureMethod !== "microphone" && manifest.captureMethod !== "screen_recording" && manifest.durationMs !== undefined) throw new Error("Import prepared manifestにdurationがあります。");
  if (state === "prepared" && (manifest.captureMethod === "microphone" || manifest.captureMethod === "screen_recording")) validDuration(manifest.durationMs);
  if (!recordingState && state !== "prepared" && finalFields.some((field) => manifest[field] === undefined)) throw new Error("Media manifestのfinalize fieldが不足しています。");
  if (!recordingState && state !== "prepared") {
    if (typeof manifest.finalPath !== "string" || !manifest.finalPath.trim()) throw new Error("Media final pathが不正です。");
    if ((manifest.storageMode || "managed") === "managed") {
      for (const field of managedFields) {
        if (typeof manifest[field] !== "string" || !(manifest[field] as string).trim()) throw new Error("Media managed root identityが不正です。");
      }
    } else if (managedFields.some((field) => manifest[field] !== undefined)) {
      throw new Error("linked Video manifestにmanaged root fieldがあります。");
    }
    validDuration(manifest.durationMs);
    if (manifest.mediaKind === "video") validVideoDimensions(manifest.widthPx, manifest.heightPx);
    if (!isIsoTimestamp(manifest.commandIssuedAt)) throw new Error("Media command timestampが不正です。");
    manifest.command = validateManifestCommand(manifest.command, manifest as Partial<AudioSessionManifest>);
  }
  return manifest as unknown as AudioSessionManifest;
}

export class MediaCaptureService {
  private readonly recoveryRoot: string;
  private readonly externalOpenRoot: string;
  private readonly idFactory: () => string;
  private readonly now: () => string;
  private readonly verificationCache = new Map<string, { dev: string; ino: string; size: number; mtimeMs: number; ctimeMs: number; contentHash: string }>();

  constructor(private readonly options: MediaCaptureServiceOptions) {
    this.recoveryRoot = path.resolve(options.userDataPath, "media-recovery", "sessions");
    this.externalOpenRoot = path.resolve(options.userDataPath, "media-external-open");
    this.idFactory = options.idFactory || randomUUID;
    this.now = options.now || (() => new Date().toISOString());
    ensureSafeDirectory(this.recoveryRoot, "Media recovery保存先");
    const externalRoot = ensureSafeDirectory(this.externalOpenRoot, "Media external-open snapshot保存先");
    let removed = 0;
    for (const entry of fs.readdirSync(externalRoot.real, { withFileTypes: true })) {
      if (removed >= 64) break;
      if (!entry.isFile() || !/^tasken-external-[0-9a-f-]{36}-[^\\/]+$/i.test(entry.name)) continue;
      try {
        const candidate = path.resolve(externalRoot.real, entry.name);
        assertWithin(externalRoot.real, candidate, "Media external-open stale snapshot");
        const stat = fs.lstatSync(candidate);
        if (
          stat.isFile()
          && !stat.isSymbolicLink()
          && Date.now() - stat.mtimeMs >= EXTERNAL_SNAPSHOT_TTL_MS
        ) {
          fs.rmSync(candidate, { force: true });
          removed += 1;
        }
      } catch (error) {
        console.warn("Media external-openの古いsnapshotを削除できませんでした。次回起動時に再試行します。", error);
      }
    }
  }

  startRecording(request: MediaRecordingStartRequest): MediaRecordingStarted {
    const isAudio = request.mediaKind === "audio";
    if ((isAudio && request.mimeType !== "audio/webm") || (!isAudio && request.mimeType !== "video/webm")) {
      throw new Error(isAudio ? "対応していない録音形式です。WebM/Opusで録音してください。" : "対応していない画面録画形式です。WebMで録画してください。");
    }
    let themeId: string | null = null;
    let videoOwner: { storageMode: "managed"; sourceType: VideoArtifactSourceType; sourceId: string } | null = null;
    if (isAudio) {
      themeId = typeof request.themeId === "string" && request.themeId.trim() ? request.themeId.trim() : null;
    } else {
      const ownerType = request.sourceType === "report" ? "note" : request.sourceType;
      const owner = this.options.repository.get(ownerType, request.sourceId);
      if (!owner || owner.deleted_at) throw new Error("画面録画の添付先が見つかりません。添付先を選び直してください。");
      themeId = typeof owner.project_id === "string" && owner.project_id
        ? owner.project_id
        : typeof owner.theme_id === "string" && owner.theme_id
          ? owner.theme_id
          : null;
      if (themeId && !this.options.repository.get("project", themeId) && !this.options.repository.get("theme", themeId)) {
        throw new Error("画面録画の添付先Themeが見つかりません。添付先を保存してからやり直してください。");
      }
      videoOwner = { storageMode: "managed", sourceType: request.sourceType, sourceId: request.sourceId };
    }
    const sessionId = assertSessionId(this.idFactory());
    const sessionDirectory = this.sessionDirectory(sessionId);
    ensureSafeDirectory(sessionDirectory, "Media recording session保存先");
    const timestamp = this.now();
    const filename = `${isAudio ? "voice-memo" : "screen-recording"}-${timestamp.replace(/\D/g, "").slice(0, 14)}.webm`;
    const manifest: AudioSessionManifest = {
      schema: MANIFEST_SCHEMA,
      sessionId,
      state: "recording",
      mediaKind: request.mediaKind,
      filename,
      mimeType: request.mimeType,
      fileSize: 0,
      contentHash: `sha256:${createHash("sha256").digest("hex")}`,
      themeId,
      ...(videoOwner || {}),
      stagedFileName: "original.webm",
      createdAt: timestamp,
      updatedAt: timestamp,
      captureMethod: isAudio ? "microphone" : "screen_recording",
      recordingNextSequence: 0,
      recordingChunkHashes: "",
      recordingStartedAt: timestamp,
      recordingElapsedMs: 0,
      recordingStateStartedAt: timestamp,
    };
    this.writeManifest(sessionDirectory, manifest);
    return {
      sessionId,
      mediaKind: request.mediaKind,
      mimeType: request.mimeType,
      maxChunkBytes: MICROPHONE_CHUNK_MAX_BYTES,
      maxRecordingBytes: MICROPHONE_RECORDING_MAX_BYTES,
      maxDurationMs: MICROPHONE_RECORDING_MAX_DURATION_MS,
    };
  }

  appendRecordingChunk(request: MediaRecordingAppendRequest): MediaRecordingProgress {
    const sessionDirectory = this.sessionDirectory(assertSessionId(request.sessionId));
    const sessionIdentity = captureDirectoryIdentity(sessionDirectory, "録音session");
    const manifest = this.readManifest(sessionDirectory);
    assertDirectoryIdentity(sessionDirectory, sessionIdentity, "録音session");
    if (manifest.state !== "recording") throw new Error("録音中ではありません。再開してから録音を続けてください。");
    const timestamp = this.now();
    if (
      !manifest.recordingStateStartedAt
      || (manifest.recordingElapsedMs || 0) + elapsedSince(manifest.recordingStateStartedAt, timestamp) > MICROPHONE_RECORDING_MAX_DURATION_MS
    ) {
      throw new Error("録音時間の上限に達しました。録音を停止して保存してください。");
    }
    const sequence = request.sequence;
    const expectedSequence = manifest.recordingNextSequence ?? -1;
    if (sequence !== expectedSequence) {
      throw new Error(sequence < expectedSequence
        ? "同じ録音chunkは追加できません。録音を停止して保存待ち音声を確認してください。"
        : "録音chunkが欠落しています。録音を停止して保存待ち音声を確認してください。");
    }
    if (expectedSequence >= MICROPHONE_RECORDING_MAX_CHUNKS) {
      throw new Error("録音chunkの件数上限に達しました。録音を停止して保存してください。");
    }
    const bytes = Buffer.from(request.chunk);
    if (bytes.byteLength <= 0 || bytes.byteLength > MICROPHONE_CHUNK_MAX_BYTES) {
      throw new Error(`録音chunkは1 byte以上${MICROPHONE_CHUNK_MAX_BYTES} byte以下で送信してください。`);
    }
    if (manifest.fileSize + bytes.byteLength > MICROPHONE_RECORDING_MAX_BYTES) {
      throw new Error("録音サイズの上限に達しました。録音を停止して保存してください。");
    }
    const chunkHash = createHash("sha256").update(bytes).digest("hex");
    const next: AudioSessionManifest = {
      ...manifest,
      fileSize: manifest.fileSize + bytes.byteLength,
      recordingNextSequence: sequence + 1,
      recordingChunkHashes: `${manifest.recordingChunkHashes || ""}${chunkHash}`,
      updatedAt: timestamp,
    };
    // chunk fileより先に次manifestのstrict schemaとserialized上限を確認する。
    this.serializeManifest(sessionDirectory, next);
    const chunkPath = path.resolve(sessionDirectory, recordingChunkFileName(sequence));
    assertWithin(sessionDirectory, chunkPath, "録音chunk");
    assertDirectoryIdentity(sessionDirectory, sessionIdentity, "録音session");
    const noFollow = "O_NOFOLLOW" in fs.constants ? Number(fs.constants.O_NOFOLLOW) : 0;
    let descriptor: number | null = null;
    try {
      descriptor = fs.openSync(chunkPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow, 0o600);
      let offset = 0;
      while (offset < bytes.byteLength) offset += fs.writeSync(descriptor, bytes, offset, bytes.byteLength - offset, null);
      fs.fsyncSync(descriptor);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code !== "EEXIST") throw error;
      let existingDescriptor: number | null = null;
      try {
        existingDescriptor = fs.openSync(chunkPath, fs.constants.O_RDONLY | noFollow);
        const existing = fs.fstatSync(existingDescriptor);
        const expectedHash = `sha256:${chunkHash}`;
        if (!existing.isFile() || existing.size !== bytes.byteLength || hashFileDescriptor(existingDescriptor) !== expectedHash) {
          throw new Error("録音chunkの保存先に別内容があります。保存待ち音声から復旧または破棄してください。");
        }
        const after = fs.lstatSync(chunkPath);
        if (after.isSymbolicLink() || !after.isFile() || String(after.dev) !== String(existing.dev) || String(after.ino) !== String(existing.ino)) {
          throw new Error("録音chunkの保存先が確認中に差し替えられました。保存待ち音声から復旧または破棄してください。");
        }
      } finally {
        if (existingDescriptor !== null) fs.closeSync(existingDescriptor);
      }
    } finally {
      if (descriptor !== null) fs.closeSync(descriptor);
    }
    assertDirectoryIdentity(sessionDirectory, sessionIdentity, "録音session");
    this.writeManifest(sessionDirectory, next);
    assertDirectoryIdentity(sessionDirectory, sessionIdentity, "録音session");
    return this.recordingProgress(next);
  }

  pauseRecording(sessionIdValue: unknown): MediaRecordingProgress {
    const sessionDirectory = this.sessionDirectory(assertSessionId(sessionIdValue));
    const sessionIdentity = captureDirectoryIdentity(sessionDirectory, "録音session");
    const manifest = this.readManifest(sessionDirectory);
    assertDirectoryIdentity(sessionDirectory, sessionIdentity, "録音session");
    if (manifest.state !== "recording" || !manifest.recordingStateStartedAt) throw new Error("録音中ではないため一時停止できません。");
    const timestamp = this.now();
    const nextElapsedMs = (manifest.recordingElapsedMs || 0) + elapsedSince(manifest.recordingStateStartedAt, timestamp);
    if (nextElapsedMs > MICROPHONE_RECORDING_MAX_DURATION_MS) {
      throw new Error("録音時間の上限を超えたため一時停止できません。録音を停止して保存してください。");
    }
    const next: AudioSessionManifest = {
      ...manifest,
      state: "recording_paused",
      recordingElapsedMs: nextElapsedMs,
      recordingStateStartedAt: undefined,
      updatedAt: timestamp,
    };
    assertDirectoryIdentity(sessionDirectory, sessionIdentity, "録音session");
    this.writeManifest(sessionDirectory, next);
    assertDirectoryIdentity(sessionDirectory, sessionIdentity, "録音session");
    return this.recordingProgress(next);
  }

  resumeRecording(sessionIdValue: unknown): MediaRecordingProgress {
    const sessionDirectory = this.sessionDirectory(assertSessionId(sessionIdValue));
    const sessionIdentity = captureDirectoryIdentity(sessionDirectory, "録音session");
    const manifest = this.readManifest(sessionDirectory);
    assertDirectoryIdentity(sessionDirectory, sessionIdentity, "録音session");
    if (manifest.state !== "recording_paused") throw new Error("一時停止中ではないため再開できません。");
    if ((manifest.recordingElapsedMs || 0) >= MICROPHONE_RECORDING_MAX_DURATION_MS) {
      throw new Error("録音時間の上限に達しているため再開できません。録音を停止して保存してください。");
    }
    const timestamp = this.now();
    const next: AudioSessionManifest = { ...manifest, state: "recording", recordingStateStartedAt: timestamp, updatedAt: timestamp };
    assertDirectoryIdentity(sessionDirectory, sessionIdentity, "録音session");
    this.writeManifest(sessionDirectory, next);
    assertDirectoryIdentity(sessionDirectory, sessionIdentity, "録音session");
    return this.recordingProgress(next);
  }

  stopRecording(sessionIdValue: unknown): AudioCapturePrepared | VideoImportPrepared {
    const sessionDirectory = this.sessionDirectory(assertSessionId(sessionIdValue));
    const sessionIdentity = captureDirectoryIdentity(sessionDirectory, "録音session");
    const manifest = this.readManifest(sessionDirectory);
    assertDirectoryIdentity(sessionDirectory, sessionIdentity, "録音session");
    if (manifest.state === "prepared" && manifest.captureMethod === "microphone") return this.toPreparedAudio(manifest);
    if (manifest.state === "prepared" && manifest.captureMethod === "screen_recording") return this.toPreparedVideo(manifest);
    if (!["microphone", "screen_recording"].includes(String(manifest.captureMethod)) || (manifest.state !== "recording" && manifest.state !== "recording_paused")) {
      throw new Error("復旧できる録音sessionがありません。保存待ちMediaを読み直してください。");
    }
    const timestamp = this.now();
    // Rendererはstop前にfinal dataavailableのappend完了を待つ。
    // そのdurable境界だけを録音時間に含め、Renderer crash後のdowntimeは加算しない。
    const activeCutoff = manifest.updatedAt;
    const durationMs = Math.min(
      MICROPHONE_RECORDING_MAX_DURATION_MS,
      (manifest.recordingElapsedMs || 0) + (manifest.state === "recording" && manifest.recordingStateStartedAt ? elapsedSince(manifest.recordingStateStartedAt, activeCutoff) : 0),
    );
    const sequenceCount = manifest.recordingNextSequence || 0;
    if (sequenceCount <= 0 || manifest.fileSize <= 0) throw new Error("録音データがありません。マイクを確認して、もう一度録音してください。");
    const stagedPath = path.resolve(sessionDirectory, manifest.stagedFileName);
    assertWithin(sessionDirectory, stagedPath, "録音temporary file");
    assertDirectoryIdentity(sessionDirectory, sessionIdentity, "録音session");
    if (fs.existsSync(stagedPath)) {
      const staged = fs.lstatSync(stagedPath);
      if (staged.isSymbolicLink() || !staged.isFile()) throw new Error("録音temporary fileを安全に復旧できません。保存待ち音声を破棄して録音し直してください。");
      fs.rmSync(stagedPath, { force: true });
    }
    const contentHash = this.assembleRecordingChunks(sessionDirectory, stagedPath, sequenceCount, manifest.fileSize, manifest.mimeType, manifest.recordingChunkHashes || "");
    assertDirectoryIdentity(sessionDirectory, sessionIdentity, "録音session");
    const prepared: AudioSessionManifest = {
      ...manifest,
      state: "prepared",
      contentHash,
      durationMs: validDuration(durationMs),
      recordingElapsedMs: durationMs,
      recordingStateStartedAt: undefined,
      updatedAt: timestamp,
    };
    this.writeManifest(sessionDirectory, prepared);
    assertDirectoryIdentity(sessionDirectory, sessionIdentity, "録音session");
    for (let sequence = 0; sequence < sequenceCount; sequence += 1) {
      assertDirectoryIdentity(sessionDirectory, sessionIdentity, "録音session");
      fs.rmSync(path.resolve(sessionDirectory, recordingChunkFileName(sequence)), { force: true });
      assertDirectoryIdentity(sessionDirectory, sessionIdentity, "録音session");
    }
    return prepared.mediaKind === "video" ? this.toPreparedVideo(prepared) : this.toPreparedAudio(prepared);
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

  prepareVideoFile(sourcePathValue: unknown, request: {
    storageMode: VideoStorageMode;
    sourceType: VideoArtifactSourceType;
    sourceId: string;
  }): VideoImportPrepared {
    if (typeof sourcePathValue !== "string" || !path.isAbsolute(sourcePathValue)) {
      throw new Error("動画ファイルの場所が不正です。ファイル選択からやり直してください。");
    }
    const ownerType = request.sourceType === "report" ? "note" : request.sourceType;
    const owner = this.options.repository.get(ownerType, request.sourceId);
    if (!owner || owner.deleted_at) {
      throw new Error("動画の添付先が見つかりません。画面を再読み込みしてください。");
    }
    const themeId = typeof owner.project_id === "string" && owner.project_id
      ? owner.project_id
      : typeof owner.theme_id === "string" && owner.theme_id
        ? owner.theme_id
        : null;
    if (themeId && !this.options.repository.get("project", themeId) && !this.options.repository.get("theme", themeId)) {
      throw new Error("動画の添付先Themeが見つかりません。添付先を保存してからやり直してください。");
    }
    const sourcePath = path.resolve(sourcePathValue);
    assertNoSymlinkOrJunctionAncestors(sourcePath, "動画 source");
    const filename = safeArtifactFileName(path.basename(sourcePath));
    const mimeType = videoMimeTypeOf(filename);
    if (!mimeType) throw new Error("対応していない動画形式です。MP4、M4V、MOV、WebMを選択してください。");
    const sessionId = assertSessionId(this.idFactory());
    const sessionDirectory = this.sessionDirectory(sessionId);
    ensureSafeDirectory(sessionDirectory, "Media Capture session保存先");
    const stagedFileName = `original.${mediaExtensionOf(filename)}`;
    const stagedPath = path.resolve(sessionDirectory, stagedFileName);
    assertWithin(sessionDirectory, stagedPath, "動画temporary file");
    let staged: { fileSize: number; contentHash: string; sourceRealPath: string; sourceDevice: string; sourceInode: string };
    try {
      staged = copyVerifiedSourceToExclusiveStage(sourcePath, stagedPath, mimeType, "動画");
    } catch (error) {
      this.removeSessionDirectory(sessionDirectory);
      throw error;
    }
    const timestamp = this.now();
    const manifest: AudioSessionManifest = {
      schema: MANIFEST_SCHEMA,
      sessionId,
      state: "prepared",
      mediaKind: "video",
      filename,
      mimeType,
      fileSize: staged.fileSize,
      contentHash: staged.contentHash,
      themeId,
      storageMode: request.storageMode,
      sourceType: request.sourceType,
      sourceId: request.sourceId,
      ...(request.storageMode === "linked" ? {
        sourcePath,
        sourceRealPath: staged.sourceRealPath,
        sourceDevice: staged.sourceDevice,
        sourceInode: staged.sourceInode,
      } : {}),
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
      storageMode: request.storageMode,
      sourceType: request.sourceType,
      sourceId: request.sourceId,
    };
  }

  listPreparedAudio(): AudioCapturePrepared[] {
    const pending: Array<{ summary: AudioCapturePrepared; createdAt: string | null }> = [];
    for (const entry of fs.readdirSync(this.recoveryRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !SESSION_ID_PATTERN.test(entry.name)) continue;
      try {
        const manifest = this.readManifest(this.sessionDirectory(entry.name));
        if (manifest.state === "committed" || manifest.mediaKind !== "audio") continue;
        if (manifest.state === "recording" || manifest.state === "recording_paused") {
          pending.push({ summary: {
            sessionId: manifest.sessionId,
            filename: manifest.filename,
            mimeType: manifest.mimeType,
            fileSize: manifest.fileSize,
            mediaUrl: "",
            status: "recovery_required",
            availability: "missing",
            recoveryReason: "recording_interrupted",
            canCommit: false,
            canRetry: false,
            canDiscard: true,
            canRecoverRecording: manifest.fileSize > 0 && (manifest.recordingNextSequence || 0) > 0,
          }, createdAt: manifest.createdAt });
          continue;
        }
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
        if (this.readManifestMediaKindLoose(this.sessionDirectory(entry.name)) === "video") continue;
        // 壊れたsessionも不可視orphanにしない。pathやmanifest本文はRendererへ出さず、
        // UUID directoryの安全な診断行だけを返す。stateを証明できないため破棄は許可しない。
        pending.push({ summary: {
          sessionId: entry.name,
          filename: "復旧が必要なMedia",
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

  listPreparedVideo(): VideoImportPrepared[] {
    const pending: Array<{ summary: VideoImportPrepared; createdAt: string | null }> = [];
    for (const entry of fs.readdirSync(this.recoveryRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !SESSION_ID_PATTERN.test(entry.name)) continue;
      try {
        const manifest = this.readManifest(this.sessionDirectory(entry.name));
        if (manifest.state === "committed" || manifest.mediaKind !== "video" || !manifest.storageMode || !manifest.sourceType || !manifest.sourceId) continue;
        if (manifest.state === "recording" || manifest.state === "recording_paused") {
          pending.push({ summary: {
            sessionId: manifest.sessionId,
            filename: manifest.filename,
            mimeType: manifest.mimeType,
            fileSize: manifest.fileSize,
            mediaUrl: "",
            status: "recovery_required",
            availability: "missing",
            recoveryReason: "recording_interrupted",
            canCommit: false,
            canRetry: false,
            canDiscard: true,
            canRecoverRecording: manifest.fileSize > 0 && (manifest.recordingNextSequence || 0) > 0,
            storageMode: manifest.storageMode,
            sourceType: manifest.sourceType,
            sourceId: manifest.sourceId,
          }, createdAt: manifest.createdAt });
          continue;
        }
        let resolution = this.resolveSessionMedia(manifest.sessionId);
        if (resolution.availability === "available") fs.closeSync(resolution.fileDescriptor);
        if (manifest.state === "finalizing" && manifest.storageMode !== "linked" && resolution.availability !== "available") {
          const stagedPath = path.resolve(this.sessionDirectory(manifest.sessionId), manifest.stagedFileName);
          assertWithin(this.sessionDirectory(manifest.sessionId), stagedPath, "動画temporary file");
          const stagedResolution = openVerifiedMedia(stagedPath, manifest.fileSize, manifest.contentHash, manifest.mimeType, this.verificationCache, `session-staged:${manifest.sessionId}`);
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
          storageMode: manifest.storageMode,
          sourceType: manifest.sourceType,
          sourceId: manifest.sourceId,
          ...(manifest.durationMs === undefined ? {} : { durationMs: manifest.durationMs }),
          ...(manifest.widthPx === undefined ? {} : { widthPx: manifest.widthPx }),
          ...(manifest.heightPx === undefined ? {} : { heightPx: manifest.heightPx }),
          canCommit: ready,
          canRetry: retryable,
          canDiscard: manifest.state === "prepared",
          ...(ready ? {} : { recoveryReason: manifest.recoveryError === "commit_failed" ? "commit_failed" as const : retryable ? "recovery_pending" as const : resolution.availability === "changed" ? "media_changed" as const : resolution.availability === "unsafe_source" ? "unsafe_source" as const : resolution.availability === "unsupported_codec" ? "unsupported_codec" as const : "media_missing" as const }),
        }, createdAt: manifest.createdAt });
      } catch {
        if (this.readManifestMediaKindLoose(this.sessionDirectory(entry.name)) !== "video") continue;
        pending.push({ summary: {
          sessionId: entry.name,
          filename: "復旧が必要な動画",
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
      if (left.createdAt && right.createdAt) return right.createdAt.localeCompare(left.createdAt) || left.summary.sessionId.localeCompare(right.summary.sessionId);
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
    if (manifest.state === "recording" || manifest.state === "recording_paused") {
      throw new Error("録音を停止してからInboxへ保存してください。");
    }
    if (manifest.captureMethod === "microphone" && manifest.durationMs !== durationMs) {
      throw new Error("録音時間がsessionと一致しません。保存待ち音声を読み直してください。");
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

  commitVideo(request: VideoImportCommitRequest): InternalVideoImportCommitResult {
    const sessionId = assertSessionId(request?.sessionId);
    const durationMs = validDuration(request?.durationMs);
    const { widthPx, heightPx } = validVideoDimensions(request?.widthPx, request?.heightPx);
    const sessionDirectory = this.sessionDirectory(sessionId);
    let manifest = this.readManifest(sessionDirectory);
    if (manifest.mediaKind !== "video") throw new Error("動画Import sessionが見つかりません。保存待ち動画を読み直してください。");
    if (manifest.state === "committed") {
      if (!manifest.command) throw new Error("動画Import receiptの復元情報がありません。");
      return this.toInternalVideoResult(manifest, this.options.commands.executeMediaCapture(manifest.command));
    }
    if (manifest.state === "prepared") {
      this.assertVideoOwnerBinding(manifest);
      manifest = this.beginFinalizeVideo(sessionDirectory, manifest, { durationMs, widthPx, heightPx });
    }
    try {
      manifest = this.ensureFinalized(sessionDirectory, manifest);
      this.assertVideoOwnerBinding(manifest);
    } catch (error) {
      if (error instanceof VideoOwnerBindingError && manifest.state !== "prepared") {
        manifest = this.resetVideoToPrepared(sessionDirectory, manifest);
      }
      throw error;
    }
    if (!manifest.command) throw new Error("動画Import commandの復元情報がありません。");
    try {
      const receipt = this.options.commands.executeMediaCapture(manifest.command);
      const committed = { ...manifest, state: "committed" as const, updatedAt: this.now(), recoveryError: undefined };
      this.writeManifest(sessionDirectory, committed);
      this.removeStagedFile(sessionDirectory, committed);
      return this.toInternalVideoResult(committed, receipt);
    } catch (error) {
      this.writeManifest(sessionDirectory, { ...manifest, recoveryError: "commit_failed", updatedAt: this.now() });
      throw error;
    }
  }

  cancel(sessionIdValue: unknown): boolean {
    const sessionId = assertSessionId(sessionIdValue);
    const sessionDirectory = this.sessionDirectory(sessionId);
    const sessionIdentity = captureDirectoryIdentity(sessionDirectory, "音声Capture session");
    const manifest = this.readManifest(sessionDirectory);
    assertDirectoryIdentity(sessionDirectory, sessionIdentity, "音声Capture session");
    if (manifest.state !== "prepared" && manifest.state !== "recording" && manifest.state !== "recording_paused") {
      throw new Error("保存処理を開始した音声Captureは破棄できません。再起動後の復旧を待ってください。");
    }
    this.removeSessionDirectory(sessionDirectory, sessionIdentity);
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
      if (manifest.state === "prepared" || manifest.state === "committed" || manifest.state === "recording" || manifest.state === "recording_paused") continue;
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
      if (manifest.state !== "prepared" && manifest.storageMode !== "linked") {
        const location = this.options.resolveManagedDirectory(manifest.themeId);
        if (location.kind === "needs_directory") return { availability: "missing" };
        const managedRoot = resolveSafeExistingDirectory(location.directory, "managed Media保存先");
        assertWithin(managedRoot.real, candidate, "managed Media file");
      }
      const expectedMime = manifest.mediaKind === "video" ? videoMimeTypeOf(manifest.filename) : audioMimeTypeOf(manifest.filename);
      if (!expectedMime || expectedMime !== manifest.mimeType) return { availability: "unsupported_codec" };
      const resolution = openVerifiedMedia(candidate, manifest.fileSize, manifest.contentHash, manifest.mimeType, this.verificationCache, `session:${manifest.sessionId}`);
      if (resolution.availability === "available" && manifest.storageMode === "linked" && !linkedIdentityMatches(candidate, resolution.fileDescriptor, manifest)) {
        fs.closeSync(resolution.fileDescriptor);
        return { availability: "changed" };
      }
      return resolution;
    } catch {
      return { availability: "missing" };
    }
  }

  resolveArtifactMedia(artifactIdValue: unknown): MediaFileResolution {
    if (typeof artifactIdValue !== "string" || !SESSION_ID_PATTERN.test(artifactIdValue)) return { availability: "missing" };
    const artifact = this.options.repository.get("artifact", artifactIdValue);
    if (!artifact || (artifact.media_kind !== "audio" && artifact.media_kind !== "video")) return { availability: "missing" };
    const expectedMime = artifact.media_kind === "video"
      ? videoMimeTypeOf(String(artifact.filename || ""))
      : audioMimeTypeOf(String(artifact.filename || ""));
    if (!expectedMime || String(artifact.mime_type || "") !== expectedMime) {
      return { availability: "unsupported_codec" };
    }
    return this.resolveArtifactBytes(artifactIdValue, artifact);
  }

  private resolveArtifactBytes(artifactId: string, artifact: Entity): MediaFileResolution {
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
    const resolution = openVerifiedMedia(filePath, artifact.file_size, artifact.content_hash, String(artifact.mime_type || "application/octet-stream"), this.verificationCache, `artifact:${artifactId}`);
    if (resolution.availability === "available" && artifact.media_kind === "video" && artifact.storage_mode === "linked" && !linkedIdentityMatches(filePath, resolution.fileDescriptor, {
      sourceRealPath: artifact.linked_source_real_path,
      sourceDevice: artifact.linked_source_device,
      sourceInode: artifact.linked_source_inode,
    })) {
      fs.closeSync(resolution.fileDescriptor);
      return { availability: "changed" };
    }
    return resolution;
  }

  async openArtifactExternally(artifactIdValue: unknown): Promise<{ ok: boolean; error?: string }> {
    if (!this.options.openPath) return { ok: false, error: "外部アプリを開けません。アプリを再起動してください。" };
    if (typeof artifactIdValue !== "string" || !SESSION_ID_PATTERN.test(artifactIdValue)) return { ok: false, error: "Media Artifact IDが不正です。" };
    const artifact = this.options.repository.get("artifact", artifactIdValue);
    const resolution = artifact && (artifact.media_kind === "audio" || artifact.media_kind === "video")
      ? this.resolveArtifactBytes(artifactIdValue, artifact)
      : { availability: "missing" as const };
    if (!artifact || resolution.availability !== "available") {
      return { ok: false, error: "動画ファイルを安全に確認できません。保存場所または内容を確認してください。" };
    }
    const snapshotRoot = ensureSafeDirectory(this.externalOpenRoot, "Media external-open snapshot保存先");
    const snapshotName = `tasken-external-${randomUUID()}-${safeArtifactFileName(String(artifact.filename || "media.bin"))}`;
    const snapshotPath = path.resolve(snapshotRoot.real, snapshotName);
    assertWithin(snapshotRoot.real, snapshotPath, "Media external-open snapshot");
    try {
      copyVerifiedDescriptorToExclusiveFile(resolution.fileDescriptor, snapshotPath, resolution.fileSize, String(artifact.content_hash));
    } finally {
      fs.closeSync(resolution.fileDescriptor);
    }
    try {
      const error = await this.options.openPath(snapshotPath);
      if (error) fs.rmSync(snapshotPath, { force: true });
      return error ? { ok: false, error: "外部アプリで動画を開けませんでした。関連付けを確認してください。" } : { ok: true };
    } catch {
      try { fs.rmSync(snapshotPath, { force: true }); } catch { /* 次回のTTL cleanupへ委ねる。 */ }
      return { ok: false, error: "外部アプリで動画を開けませんでした。関連付けを確認してください。" };
    }
  }

  inspectArtifactMedia(artifactIdValue: unknown): { availability: MediaAvailability; mimeType?: string; fileSize?: number } {
    const resolution = this.resolveArtifactMedia(artifactIdValue);
    if (resolution.availability !== "available") return { availability: resolution.availability };
    fs.closeSync(resolution.fileDescriptor);
    return { availability: "available", mimeType: resolution.mimeType, fileSize: resolution.fileSize };
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
      capture_method: manifest.captureMethod === "microphone" ? "microphone" : "audio_import",
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

  private beginFinalizeVideo(
    sessionDirectory: string,
    manifest: AudioSessionManifest,
    metadata: { durationMs: number; widthPx: number; heightPx: number },
  ): AudioSessionManifest {
    if (manifest.mediaKind !== "video" || !manifest.storageMode || !manifest.sourceType || !manifest.sourceId) {
      throw new Error("動画Import manifestが不正です。");
    }
    this.assertVideoOwnerBinding(manifest);
    let finalPath: string;
    let managedIdentity: Pick<AudioSessionManifest, "managedRootPath" | "managedRootRealPath" | "managedRootDevice" | "managedRootInode"> = {};
    let filename = manifest.filename;
    if (manifest.storageMode === "managed") {
      const location = this.options.resolveManagedDirectory(manifest.themeId);
      if (location.kind === "needs_directory") throw new Error("Artifact保存先が未設定です。Settingsで同期ストレージを選択してから、もう一度保存してください。");
      const managedRoot = ensureSafeDirectory(location.directory, "managed Media保存先");
      ensureThemeMarker(location, managedRoot);
      filename = resolveUniqueArtifactFileName(manifest.filename, (candidate: string) => fs.existsSync(path.join(managedRoot.real, candidate)));
      finalPath = path.resolve(managedRoot.real, filename);
      assertWithin(managedRoot.real, finalPath, "managed video file");
      managedIdentity = {
        managedRootPath: managedRoot.resolved,
        managedRootRealPath: managedRoot.real,
        managedRootDevice: managedRoot.device,
        managedRootInode: managedRoot.inode,
      };
    } else {
      if (!manifest.sourcePath || !path.isAbsolute(manifest.sourcePath)) throw new Error("linked動画の元ファイルが不正です。");
      finalPath = path.resolve(manifest.sourcePath);
      const linked = openVerifiedMedia(finalPath, manifest.fileSize, manifest.contentHash, manifest.mimeType, this.verificationCache, `linked-source:${manifest.sessionId}`);
      if (linked.availability !== "available") throw new Error("linked動画が変更されたため保存できません。元ファイルを確認してください。");
      if (!linkedIdentityMatches(finalPath, linked.fileDescriptor, manifest)) {
        fs.closeSync(linked.fileDescriptor);
        throw new Error("linked動画のfile identityが取り込み時から変わっています。元ファイルを戻してください。");
      }
      fs.closeSync(linked.fileDescriptor);
    }
    const commandId = this.idFactory();
    const artifactId = this.idFactory();
    const timestamp = this.now();
    const managed = manifest.storageMode === "managed";
    const artifact: Entity = {
      id: artifactId,
      title: baseNameWithoutExtension(filename),
      filename,
      file_type: mediaExtensionOf(filename),
      mime_type: manifest.mimeType,
      file_size: manifest.fileSize,
      stored_path: managed ? finalPath : "",
      original_path: null,
      target: managed ? null : finalPath,
      storage_mode: manifest.storageMode,
      copied_at: managed ? timestamp : null,
      link_type: managed ? null : "local_path",
      link_status: managed ? null : "ok",
      last_checked_at: managed ? null : timestamp,
      linked_source_real_path: managed ? null : manifest.sourceRealPath,
      linked_source_device: managed ? null : manifest.sourceDevice,
      linked_source_inode: managed ? null : manifest.sourceInode,
      source_type: manifest.sourceType,
      source_id: manifest.sourceId,
      theme_id: manifest.themeId,
      media_kind: "video",
      ...(manifest.captureMethod === "screen_recording" ? { capture_method: "screen_recording" } : {}),
      duration_ms: metadata.durationMs,
      width_px: metadata.widthPx,
      height_px: metadata.heightPx,
      container: mediaExtensionOf(filename),
      content_hash: manifest.contentHash,
      media_availability: "available",
      ai_visibility: [],
    };
    const command: CommandEnvelope = {
      commandId,
      name: "CommitVideoArtifact",
      payload: { artifact },
      actor: { kind: "user" },
      source: "main_ui",
      sessionId: manifest.sessionId,
      issuedAt: timestamp,
    };
    const finalizing: AudioSessionManifest = {
      ...manifest,
      ...managedIdentity,
      state: "finalizing",
      filename,
      finalPath,
      durationMs: metadata.durationMs,
      widthPx: metadata.widthPx,
      heightPx: metadata.heightPx,
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
      || ((manifest.storageMode || "managed") === "managed" && (
        !manifest.managedRootPath
        || !manifest.managedRootRealPath
        || !manifest.managedRootDevice
        || !manifest.managedRootInode
      ))
    ) throw new Error("音声Capture finalize状態が不正です。");
    if (manifest.mediaKind === "video") this.assertVideoOwnerBinding(manifest);
    const stagedPath = path.resolve(sessionDirectory, manifest.stagedFileName);
    assertWithin(sessionDirectory, stagedPath, "音声temporary file");
    const stagedStat = fs.lstatSync(stagedPath);
    if (stagedStat.isSymbolicLink() || !stagedStat.isFile() || stagedStat.size !== manifest.fileSize || hashFile(stagedPath) !== manifest.contentHash) {
      throw new Error("temporary原音が変更されたため、安全にfinalizeできません。原音は読み込まず復旧待ちにしました。");
    }
    if (manifest.mediaKind === "video" && manifest.storageMode === "linked") {
      const linkedPath = path.resolve(manifest.finalPath);
      if (!manifest.sourcePath || linkedPath !== path.resolve(manifest.sourcePath)) throw new Error("linked動画のmanifest identityが不正です。");
      const linked = openVerifiedMedia(linkedPath, manifest.fileSize, manifest.contentHash, manifest.mimeType, this.verificationCache, `linked-source:${manifest.sessionId}`);
      if (linked.availability !== "available") {
        throw new Error("linked動画が見つからないか変更されています。元ファイルを戻してから再試行してください。");
      }
      if (!linkedIdentityMatches(linkedPath, linked.fileDescriptor, manifest)) {
        fs.closeSync(linked.fileDescriptor);
        throw new Error("linked動画のfile identityが取り込み時から変わっています。元ファイルを戻してください。");
      }
      fs.closeSync(linked.fileDescriptor);
      if (manifest.state === "finalized") return manifest;
      const finalized = { ...manifest, state: "finalized" as const, recoveryError: undefined, updatedAt: this.now() };
      this.writeManifest(sessionDirectory, finalized);
      return finalized;
    }
    const location = this.options.resolveManagedDirectory(manifest.themeId);
    if (location.kind === "needs_directory" || path.resolve(location.directory) !== path.resolve(manifest.managedRootPath!)) {
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
      publishVerifiedStageExclusive(stagedPath, finalPath, manifest.fileSize, manifest.contentHash);
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

  private assertVideoOwnerBinding(manifest: AudioSessionManifest): void {
    if (manifest.mediaKind !== "video" || !manifest.sourceType || !manifest.sourceId) return;
    const ownerType = manifest.sourceType === "report" ? "note" : manifest.sourceType;
    const owner = this.options.repository.get(ownerType, manifest.sourceId);
    if (!owner || owner.deleted_at) {
      throw new VideoOwnerBindingError("動画の添付先が削除されています。保存待ち動画を破棄して、添付先を選び直してください。");
    }
    const currentThemeId = typeof owner.project_id === "string" && owner.project_id
      ? owner.project_id
      : typeof owner.theme_id === "string" && owner.theme_id
        ? owner.theme_id
        : null;
    if (currentThemeId !== manifest.themeId) {
      throw new VideoOwnerBindingError("動画の添付先Themeが変更されています。保存待ち動画を破棄して、選び直してください。");
    }
    if (currentThemeId && !this.options.repository.get("project", currentThemeId) && !this.options.repository.get("theme", currentThemeId)) {
      throw new VideoOwnerBindingError("動画の添付先Themeが見つかりません。保存待ち動画を破棄して、添付先を保存し直してください。");
    }
  }

  private resetVideoToPrepared(sessionDirectory: string, manifest: AudioSessionManifest): AudioSessionManifest {
    if (manifest.mediaKind !== "video") return manifest;
    if (manifest.storageMode === "managed" && manifest.finalPath && manifest.managedRootRealPath) {
      try {
        const finalPath = path.resolve(manifest.finalPath);
        assertWithin(path.resolve(manifest.managedRootRealPath), finalPath, "managed video rollback file");
        const stat = fs.lstatSync(finalPath);
        if (!stat.isSymbolicLink() && stat.isFile() && stat.size === manifest.fileSize && hashFile(finalPath) === manifest.contentHash) {
          fs.rmSync(finalPath);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const prepared = { ...manifest } as AudioSessionManifest;
    prepared.state = "prepared";
    delete prepared.finalPath;
    delete prepared.managedRootPath;
    delete prepared.managedRootRealPath;
    delete prepared.managedRootDevice;
    delete prepared.managedRootInode;
    delete prepared.durationMs;
    delete prepared.widthPx;
    delete prepared.heightPx;
    delete prepared.commandIssuedAt;
    delete prepared.command;
    delete prepared.recoveryError;
    prepared.updatedAt = this.now();
    this.writeManifest(sessionDirectory, prepared);
    return prepared;
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

  private toInternalVideoResult(manifest: AudioSessionManifest, receipt: CommandReceipt): InternalVideoImportCommitResult {
    const payload = manifest.command?.payload as { artifact?: Entity } | undefined;
    if (!manifest.command || !payload?.artifact?.id || !manifest.sourceType || !manifest.sourceId) throw new Error("動画Import receiptのidentityが不正です。");
    return {
      publicResult: {
        status: receipt.status === "no_change" ? "no_change" : "applied",
        commandId: manifest.command.commandId,
        artifactId: payload.artifact.id,
        sourceType: manifest.sourceType,
        sourceId: manifest.sourceId,
      },
      receipt,
    };
  }

  private recordingProgress(manifest: AudioSessionManifest): MediaRecordingProgress {
    return {
      sessionId: manifest.sessionId,
      nextSequence: manifest.recordingNextSequence || 0,
      fileSize: manifest.fileSize,
      state: manifest.state === "recording_paused" ? "paused" : "recording",
    };
  }

  private toPreparedAudio(manifest: AudioSessionManifest): AudioCapturePrepared {
    return {
      sessionId: manifest.sessionId,
      filename: manifest.filename,
      mimeType: manifest.mimeType,
      fileSize: manifest.fileSize,
      mediaUrl: `tasken-media://session/${manifest.sessionId}`,
      status: "ready",
      availability: "available",
      ...(manifest.durationMs === undefined ? {} : { durationMs: manifest.durationMs }),
      canCommit: true,
      canRetry: false,
      canDiscard: true,
    };
  }

  recordingCapacity(): { availableRecordingBytes: number; maxRecordingBytes: number } {
    const stats = fs.statfsSync(this.recoveryRoot);
    const available = Number(stats.bavail) * Number(stats.bsize);
    return {
      availableRecordingBytes: Number.isSafeInteger(available) && available >= 0 ? available : 0,
      maxRecordingBytes: MEDIA_RECORDING_MAX_BYTES,
    };
  }

  private toPreparedVideo(manifest: AudioSessionManifest): VideoImportPrepared {
    if (manifest.mediaKind !== "video" || !manifest.storageMode || !manifest.sourceType || !manifest.sourceId) {
      throw new Error("画面録画sessionのowner情報が不正です。");
    }
    return {
      sessionId: manifest.sessionId,
      filename: manifest.filename,
      mimeType: manifest.mimeType,
      fileSize: manifest.fileSize,
      mediaUrl: `tasken-media://session/${manifest.sessionId}`,
      status: "ready",
      availability: "available",
      ...(manifest.durationMs === undefined ? {} : { durationMs: manifest.durationMs }),
      storageMode: manifest.storageMode,
      sourceType: manifest.sourceType,
      sourceId: manifest.sourceId,
      canCommit: true,
      canRetry: false,
      canDiscard: true,
    };
  }

  private assembleRecordingChunks(
    sessionDirectory: string,
    stagedPath: string,
    sequenceCount: number,
    expectedSize: number,
    mimeType: string,
    expectedChunkHashes: string,
  ): string {
    const hash = createHash("sha256");
    let descriptor: number | null = null;
    let written = 0;
    let contentHash = "";
    try {
      const noFollow = "O_NOFOLLOW" in fs.constants ? Number(fs.constants.O_NOFOLLOW) : 0;
      descriptor = fs.openSync(stagedPath, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow, 0o600);
      for (let sequence = 0; sequence < sequenceCount; sequence += 1) {
        const chunkPath = path.resolve(sessionDirectory, recordingChunkFileName(sequence));
        assertWithin(sessionDirectory, chunkPath, "録音chunk");
        let chunkDescriptor: number | null = null;
        try {
          chunkDescriptor = fs.openSync(chunkPath, fs.constants.O_RDONLY | noFollow);
          const stat = fs.fstatSync(chunkDescriptor);
          if (!stat.isFile() || stat.size <= 0 || stat.size > MICROPHONE_CHUNK_MAX_BYTES) {
            throw new Error("録音chunkが欠落または変更されています。録音は破棄せず復旧待ちにしました。");
          }
          const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, stat.size));
          const chunkHash = createHash("sha256");
          let position = 0;
          while (position < stat.size) {
            const bytesRead = fs.readSync(chunkDescriptor, buffer, 0, Math.min(buffer.length, stat.size - position), position);
            if (bytesRead <= 0) throw new Error("録音chunkを最後まで読み取れません。録音は破棄せず復旧待ちにしました。");
            let offset = 0;
            while (offset < bytesRead) offset += fs.writeSync(descriptor, buffer, offset, bytesRead - offset, null);
            hash.update(buffer.subarray(0, bytesRead));
            chunkHash.update(buffer.subarray(0, bytesRead));
            position += bytesRead;
            written += bytesRead;
          }
          const after = fs.lstatSync(chunkPath);
          if (after.isSymbolicLink() || !after.isFile() || String(after.dev) !== String(stat.dev) || String(after.ino) !== String(stat.ino)) {
            throw new Error("録音chunkが確認中に差し替えられました。未検証bytesは使用せず復旧待ちにしました。");
          }
          const expectedChunkHash = expectedChunkHashes.slice(sequence * 64, (sequence + 1) * 64);
          if (chunkHash.digest("hex") !== expectedChunkHash) {
            throw new Error("録音chunkのhashが一致しません。未検証bytesは使用せず復旧待ちにしました。");
          }
        } finally {
          if (chunkDescriptor !== null) fs.closeSync(chunkDescriptor);
        }
      }
      fs.fsyncSync(descriptor);
      if (written !== expectedSize) {
        throw new Error("録音chunkの合計sizeが一致しません。録音は破棄せず復旧待ちにしました。");
      }
      if (!hasExpectedMediaSignature(descriptor, mimeType)) {
        throw new Error("録音データをWebM音声として確認できません。マイクを確認して、もう一度録音してください。");
      }
      contentHash = `sha256:${hash.digest("hex")}`;
    } catch (error) {
      if (descriptor !== null) { fs.closeSync(descriptor); descriptor = null; }
      fs.rmSync(stagedPath, { force: true });
      throw error;
    } finally {
      if (descriptor !== null) fs.closeSync(descriptor);
    }
    return contentHash;
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
    const sessionIdentity = captureDirectoryIdentity(sessionDirectory, "音声Capture session");
    const manifestPath = this.manifestPath(sessionDirectory);
    const noFollow = "O_NOFOLLOW" in fs.constants ? Number(fs.constants.O_NOFOLLOW) : 0;
    let descriptor: number | null = null;
    try {
      descriptor = fs.openSync(manifestPath, fs.constants.O_RDONLY | noFollow);
      const manifestStat = fs.fstatSync(descriptor);
      if (!manifestStat.isFile() || manifestStat.size <= 0 || manifestStat.size > MAX_MANIFEST_BYTES) {
        throw new Error("Media Capture manifest fileが不正です。");
      }
      const text = fs.readFileSync(descriptor, "utf8");
      const after = fs.lstatSync(manifestPath);
      if (after.isSymbolicLink() || !after.isFile() || String(after.dev) !== String(manifestStat.dev) || String(after.ino) !== String(manifestStat.ino)) {
        throw new Error("Media Capture manifestが確認中に差し替えられました。");
      }
      const manifest = validateManifest(JSON.parse(text), path.basename(sessionDirectory));
      assertDirectoryIdentity(sessionDirectory, sessionIdentity, "音声Capture session");
      this.cleanupRecordingChunks(sessionDirectory, manifest, sessionIdentity);
      return manifest;
    } finally {
      if (descriptor !== null) fs.closeSync(descriptor);
    }
  }

  private writeManifest(sessionDirectory: string, manifest: AudioSessionManifest): void {
    writeAtomicTextFile(this.manifestPath(sessionDirectory), this.serializeManifest(sessionDirectory, manifest), randomUUID());
  }

  private serializeManifest(sessionDirectory: string, manifest: AudioSessionManifest): string {
    validateManifest(manifest, path.basename(sessionDirectory));
    const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
    if (Buffer.byteLength(serialized, "utf8") <= 0 || Buffer.byteLength(serialized, "utf8") > MAX_MANIFEST_BYTES) {
      throw new Error("Media Capture manifestがsize上限を超えています。");
    }
    return serialized;
  }

  private readManifestMediaKindLoose(sessionDirectory: string): "audio" | "video" | null {
    let descriptor: number | null = null;
    try {
      const manifestPath = this.manifestPath(sessionDirectory);
      const noFollow = "O_NOFOLLOW" in fs.constants ? Number(fs.constants.O_NOFOLLOW) : 0;
      descriptor = fs.openSync(manifestPath, fs.constants.O_RDONLY | noFollow);
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_MANIFEST_BYTES) return null;
      const text = fs.readFileSync(descriptor, "utf8");
      const after = fs.lstatSync(manifestPath);
      if (after.isSymbolicLink() || !after.isFile() || String(after.dev) !== String(stat.dev) || String(after.ino) !== String(stat.ino)) return null;
      const value = JSON.parse(text) as { mediaKind?: unknown };
      return value.mediaKind === "audio" || value.mediaKind === "video" ? value.mediaKind : null;
    } catch {
      return null;
    } finally {
      if (descriptor !== null) fs.closeSync(descriptor);
    }
  }

  private cleanupRecordingChunks(sessionDirectory: string, manifest: AudioSessionManifest, sessionIdentity: DirectoryIdentity): void {
    if (
      (manifest.captureMethod !== "microphone" && manifest.captureMethod !== "screen_recording") ||
      (manifest.state !== "prepared" && manifest.state !== "committed")
    ) return;
    const sequenceCount = manifest.recordingNextSequence || 0;
    for (const entry of fs.readdirSync(sessionDirectory, { withFileTypes: true })) {
      const match = /^chunk-(\d{8})\.part$/.exec(entry.name);
      if (!match || Number(match[1]) >= sequenceCount) continue;
      assertDirectoryIdentity(sessionDirectory, sessionIdentity, "録音session cleanup");
      const candidate = path.resolve(sessionDirectory, entry.name);
      assertWithin(sessionDirectory, candidate, "録音chunk cleanup");
      const stat = fs.lstatSync(candidate);
      if (stat.isDirectory()) throw new Error("録音chunk cleanupにdirectoryがあります。");
      fs.unlinkSync(candidate);
      assertDirectoryIdentity(sessionDirectory, sessionIdentity, "録音session cleanup");
    }
  }

  private removeStagedFile(sessionDirectory: string, manifest: AudioSessionManifest): void {
    const stagedPath = path.resolve(sessionDirectory, manifest.stagedFileName);
    assertWithin(sessionDirectory, stagedPath, "音声temporary file");
    fs.rmSync(stagedPath, { force: true });
  }

  private removeSessionDirectory(sessionDirectory: string, expectedIdentity?: DirectoryIdentity): void {
    assertWithin(this.recoveryRoot, sessionDirectory, "音声Capture session");
    assertNoSymlinkOrJunctionAncestors(sessionDirectory, "音声Capture session");
    const identity = expectedIdentity || captureDirectoryIdentity(sessionDirectory, "音声Capture session");
    assertDirectoryIdentity(sessionDirectory, identity, "音声Capture session");
    const stat = fs.lstatSync(sessionDirectory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("音声Capture sessionを安全に破棄できません。");
    for (const entry of fs.readdirSync(sessionDirectory, { withFileTypes: true })) {
      assertDirectoryIdentity(sessionDirectory, identity, "音声Capture session");
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
      assertDirectoryIdentity(sessionDirectory, identity, "音声Capture session");
    }
    assertDirectoryIdentity(sessionDirectory, identity, "音声Capture session");
    fs.rmdirSync(sessionDirectory);
  }
}
