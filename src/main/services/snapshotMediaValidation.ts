import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { validateAudioArtifactMetadata, validateVideoArtifactMetadata } from "../../shared/mediaArtifact.mjs";
import type { Entity, Workspace } from "../../shared/types/workspace";
import { isGenericAudioArtifact, isGenericVideoArtifact } from "../mediaCapturePersistence";

type MediaKind = "audio" | "video";
type MediaOwnerType = "task" | "note" | "capture_entry";

export type SnapshotMediaFailureReason =
  | "invalid_metadata"
  | "owner_missing"
  | "media_missing"
  | "media_changed"
  | "unsafe_source";

export class SnapshotMediaValidationError extends Error {
  constructor(readonly reason: SnapshotMediaFailureReason, message: string) {
    super(message);
    this.name = "SnapshotMediaValidationError";
  }
}

interface SnapshotMediaRepository {
  get(type: MediaOwnerType, id: string, includeDeleted?: boolean): Record<string, unknown> | null;
}

interface SnapshotMediaValidationOptions {
  repository: SnapshotMediaRepository;
  resolveManagedDirectory: (themeId: string | null, workspace: Workspace) =>
    | { kind: "needs_directory" }
    | { kind: "ok"; directory: string };
}

const OWNER_COLLECTIONS: Record<MediaOwnerType, keyof Workspace> = {
  task: "tasks",
  note: "notes",
  capture_entry: "capture_entrys",
};

function fail(reason: SnapshotMediaFailureReason, message: string): never {
  throw new SnapshotMediaValidationError(reason, message);
}

function mediaKindOf(artifact: Entity): MediaKind | null {
  if (artifact.media_kind === "audio" || artifact.media_kind === "video") return artifact.media_kind;
  if (isGenericAudioArtifact(artifact) || isGenericVideoArtifact(artifact)) {
    fail("invalid_metadata", "SnapshotのMedia Artifact種別が不正です。元の端末でSnapshotを書き出し直してください。");
  }
  return null;
}

function ownerTypeOf(artifact: Entity): MediaOwnerType {
  if (artifact.source_type === "task") return "task";
  if (artifact.source_type === "note" || artifact.source_type === "report") return "note";
  if (artifact.source_type === "capture_entry") return "capture_entry";
  return fail("owner_missing", "SnapshotのMedia Artifact添付先が不正です。元の端末で添付先を確認してください。");
}

function snapshotOwner(workspace: Workspace, type: MediaOwnerType, id: string): Entity | null | undefined {
  const records = workspace[OWNER_COLLECTIONS[type]];
  if (!Array.isArray(records)) return undefined;
  return records.find((record) => record && typeof record === "object" && record.id === id) || undefined;
}

function assertActiveOwner(workspace: Workspace, artifact: Entity, repository: SnapshotMediaRepository): void {
  if (typeof artifact.source_id !== "string" || !artifact.source_id.trim()) {
    fail("owner_missing", "SnapshotのMedia Artifact添付先がありません。元の端末で添付先を確認してください。");
  }
  const ownerType = ownerTypeOf(artifact);
  const incoming = snapshotOwner(workspace, ownerType, artifact.source_id);
  const owner = incoming === undefined ? repository.get(ownerType, artifact.source_id, true) : incoming;
  if (!owner || owner.deleted_at) {
    fail("owner_missing", "SnapshotのMedia Artifact添付先が見つからないか削除済みです。元の端末で添付先を確認してください。");
  }
  if (artifact.source_type === "report" && owner.note_type !== "report") {
    fail("owner_missing", "SnapshotのReport添付先が不正です。元の端末で添付先を確認してください。");
  }
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertNoSymlinkAncestors(target: string): void {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  const parts = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const part of parts) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      fail("unsafe_source", "SnapshotのMedia保存経路にsymlinkまたはjunctionがあります。元の端末で保存場所を確認してください。");
    }
  }
}

function hashDescriptor(descriptor: number): string {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  while (true) {
    const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, position);
    if (bytesRead <= 0) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return `sha256:${hash.digest("hex")}`;
}

function hasExpectedMediaSignature(descriptor: number, mimeType: unknown): boolean {
  const header = Buffer.alloc(16);
  const length = fs.readSync(descriptor, header, 0, header.length, 0);
  const bytes = header.subarray(0, length);
  if (mimeType === "audio/wav") return length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WAVE";
  if (mimeType === "audio/ogg") return length >= 4 && bytes.subarray(0, 4).toString("ascii") === "OggS";
  if (mimeType === "audio/webm" || mimeType === "video/webm") return length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (mimeType === "audio/mpeg") {
    return length >= 3 && bytes.subarray(0, 3).toString("ascii") === "ID3"
      || length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  }
  if (mimeType === "audio/mp4" || mimeType === "video/mp4" || mimeType === "video/quicktime") {
    return length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp";
  }
  return false;
}

function sameIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino);
}

function openVerifiedSnapshotFile(filePath: string, artifact: Entity): { descriptor: number; realPath: string; stat: fs.Stats } {
  let descriptor: number | null = null;
  try {
    assertNoSymlinkAncestors(filePath);
    const before = fs.lstatSync(filePath);
    if (before.isSymbolicLink() || !before.isFile()) {
      fail("unsafe_source", "SnapshotのMedia実体が通常ファイルではありません。元の端末で保存場所を確認してください。");
    }
    const realPath = fs.realpathSync.native(filePath);
    const noFollow = "O_NOFOLLOW" in fs.constants ? Number(fs.constants.O_NOFOLLOW) : 0;
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(descriptor);
    const after = fs.lstatSync(filePath);
    if (!opened.isFile() || after.isSymbolicLink() || !after.isFile() || !sameIdentity(before, opened) || !sameIdentity(opened, after)) {
      fail("unsafe_source", "SnapshotのMedia実体が検証中に差し替えられました。元の端末で保存場所を確認してください。");
    }
    if (!hasExpectedMediaSignature(descriptor, artifact.mime_type)) {
      fail("invalid_metadata", "SnapshotのMedia内容とMIMEが一致しません。元の端末でSnapshotを書き出し直してください。");
    }
    const contentHash = hashDescriptor(descriptor);
    const afterRead = fs.fstatSync(descriptor);
    if (
      opened.size !== artifact.file_size
      || afterRead.size !== opened.size
      || afterRead.mtimeMs !== opened.mtimeMs
      || afterRead.ctimeMs !== opened.ctimeMs
      || contentHash !== artifact.content_hash
    ) {
      fail("media_changed", "SnapshotのMedia実体が書き出し時から変更されています。元の端末でSnapshotを書き出し直してください。");
    }
    return { descriptor, realPath, stat: opened };
  } catch (error) {
    if (error instanceof SnapshotMediaValidationError) throw error;
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") {
      return fail("media_missing", "SnapshotのMedia実体が見つかりません。元の端末で保存場所を確認してください。");
    }
    return fail("unsafe_source", "SnapshotのMedia実体を安全に確認できません。元の端末で保存場所を確認してください。");
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function assertManagedArtifact(workspace: Workspace, artifact: Entity, options: SnapshotMediaValidationOptions): void {
  if (typeof artifact.stored_path !== "string" || !path.isAbsolute(artifact.stored_path)) {
    fail("unsafe_source", "Snapshotのmanaged Media保存場所が不正です。元の端末で保存場所を確認してください。");
  }
  const themeId = typeof artifact.theme_id === "string" && artifact.theme_id ? artifact.theme_id : null;
  const location = options.resolveManagedDirectory(themeId, workspace);
  if (location.kind === "needs_directory") {
    fail("unsafe_source", "Snapshotのmanaged Media保存先を確認できません。SettingsでArtifact保存先を設定してください。");
  }
  let rootReal: string;
  try {
    assertNoSymlinkAncestors(location.directory);
    const rootStat = fs.lstatSync(location.directory);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("unsafe root");
    rootReal = fs.realpathSync.native(location.directory);
  } catch {
    fail("unsafe_source", "Snapshotのmanaged Media保存先を安全に確認できません。SettingsでArtifact保存先を確認してください。");
  }
  const opened = openVerifiedSnapshotFile(path.resolve(artifact.stored_path), artifact);
  if (!isWithin(rootReal, opened.realPath)) {
    fail("unsafe_source", "Snapshotのmanaged Media実体が保存範囲の外です。元の端末で保存場所を確認してください。");
  }
}

function assertLinkedArtifact(artifact: Entity): void {
  if (typeof artifact.target !== "string" || !path.isAbsolute(artifact.target)) {
    fail("unsafe_source", "Snapshotのlinked Media参照先が不正です。元の端末で参照先を確認してください。");
  }
  if (
    typeof artifact.linked_source_real_path !== "string"
    || !path.isAbsolute(artifact.linked_source_real_path)
    || typeof artifact.linked_source_device !== "string"
    || !artifact.linked_source_device
    || typeof artifact.linked_source_inode !== "string"
    || !artifact.linked_source_inode
  ) {
    fail("invalid_metadata", "Snapshotのlinked Media identityが不足しています。元の端末でSnapshotを書き出し直してください。");
  }
  if (typeof artifact.stored_path === "string" && artifact.stored_path.trim()) {
    fail("invalid_metadata", "Snapshotのlinked Media storage contractが不正です。元の端末でSnapshotを書き出し直してください。");
  }
  const opened = openVerifiedSnapshotFile(path.resolve(artifact.target), artifact);
  if (
    opened.realPath !== path.resolve(artifact.linked_source_real_path)
    || String(opened.stat.dev) !== artifact.linked_source_device
    || String(opened.stat.ino) !== artifact.linked_source_inode
  ) {
    fail("media_changed", "Snapshotのlinked Media identityが書き出し時から変更されています。元の端末でSnapshotを書き出し直してください。");
  }
}

export function assertRendererBootstrapContainsNoMedia(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const artifacts = (value as Workspace).artifacts;
  if (!Array.isArray(artifacts)) return;
  if (artifacts.some((artifact) => isGenericAudioArtifact(artifact) || isGenericVideoArtifact(artifact))) {
    throw new Error("Sample投入ではMedia Artifactを作成できません。専用のMedia取り込みを使用してください。");
  }
}

export function validateSnapshotMediaWorkspace(workspace: Workspace, options: SnapshotMediaValidationOptions): void {
  const artifacts = Array.isArray(workspace?.artifacts) ? workspace.artifacts : [];
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact !== "object" || artifact.deleted_at) continue;
    const kind = mediaKindOf(artifact);
    if (!kind) continue;
    try {
      if (kind === "audio") validateAudioArtifactMetadata(artifact);
      else validateVideoArtifactMetadata(artifact);
    } catch {
      fail("invalid_metadata", "SnapshotのMedia metadataが不正です。元の端末でSnapshotを書き出し直してください。");
    }
    if (typeof artifact.file_size !== "number" || artifact.file_size <= 0) {
      fail("invalid_metadata", "SnapshotのMedia file sizeが不正です。元の端末でSnapshotを書き出し直してください。");
    }
    assertActiveOwner(workspace, artifact, options.repository);
    if (artifact.storage_mode === "managed") assertManagedArtifact(workspace, artifact, options);
    else if (artifact.storage_mode === "linked") assertLinkedArtifact(artifact);
    else fail("invalid_metadata", "SnapshotのMedia storage modeが不正です。元の端末でSnapshotを書き出し直してください。");
  }
}
