import type { EntityType } from "../shared/types/workspace";

interface MediaPersistenceRepository {
  get(type: EntityType, id: string, includeDeleted?: boolean): unknown;
}

const MEDIA_ARTIFACT_OWNED_FIELDS = [
  "filename", "file_type", "mime_type", "file_size", "stored_path", "original_path", "target",
  "storage_mode", "copied_at", "source_type", "source_id", "theme_id", "media_kind", "duration_ms", "width_px", "height_px",
  "container", "codec", "content_hash", "media_availability", "link_type", "link_status", "last_checked_at",
  "linked_source_real_path", "linked_source_device", "linked_source_inode", "ai_visibility",
] as const;
const MEDIA_CAPTURE_OWNED_FIELDS = [
  "kind", "content_type", "capture_method", "media_status", "transcription_status", "captured_at", "project_id", "ai_visibility",
] as const;

const UNAMBIGUOUS_AUDIO_EXTENSIONS = new Set(["wav", "mp3", "mpeg", "mpga", "m4a", "ogg", "opus"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mov", "webm"]);

function extensionOf(value: unknown): string {
  const match = String(value || "").trim().toLowerCase().match(/\.([^.\\/]+)$/);
  return match?.[1] || "";
}

export function isGenericAudioArtifact(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entity = value as Record<string, unknown>;
  if (entity.media_kind === "audio") return true;
  if (typeof entity.mime_type === "string" && entity.mime_type.toLowerCase().startsWith("audio/")) return true;
  return [entity.filename, entity.file_name, entity.target, entity.stored_path, entity.original_path]
    .some((candidate) => UNAMBIGUOUS_AUDIO_EXTENSIONS.has(extensionOf(candidate)));
}

export function rejectGenericAudioArtifact(value: unknown, operation = "保存"): void {
  if (isGenericAudioArtifact(value)) {
    throw new Error(`音声Artifactの${operation}はInboxの音声取り込みから実行してください。`);
  }
}

export function isGenericVideoArtifact(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entity = value as Record<string, unknown>;
  if (entity.media_kind === "video") return true;
  if (typeof entity.mime_type === "string" && entity.mime_type.toLowerCase().startsWith("video/")) return true;
  return [entity.filename, entity.file_name, entity.target, entity.stored_path, entity.original_path]
    .some((candidate) => VIDEO_EXTENSIONS.has(extensionOf(candidate)));
}

export function rejectGenericVideoArtifact(value: unknown, operation = "保存"): void {
  if (isGenericVideoArtifact(value)) {
    throw new Error(`動画Artifactの${operation}は専用の動画取り込みから実行してください。`);
  }
}

/** Rendererのgeneric saveではMain-owned Media identityを作成・変更できない。 */
export function normalizeMediaCapturePersistence(
  repository: MediaPersistenceRepository,
  type: EntityType,
  entity: unknown,
  operation = "保存",
): unknown {
  if (!entity || typeof entity !== "object" || Array.isArray(entity)) return entity;
  const value = entity as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id : "";
  const current = id ? repository.get(type, id, true) : null;
  const currentValue = current && typeof current === "object" && !Array.isArray(current) ? current as Record<string, unknown> : null;
  const currentIsMedia = (type === "capture_entry" && currentValue?.content_type === "audio")
    || (type === "artifact" && (currentValue?.media_kind === "audio" || currentValue?.media_kind === "video"));
  const incomingIsMedia = (type === "capture_entry" && value.content_type === "audio")
    || (type === "artifact" && (value.media_kind === "audio" || value.media_kind === "video"));
  if (type === "artifact" && !currentIsMedia) {
    rejectGenericAudioArtifact(value, operation);
    rejectGenericVideoArtifact(value, operation);
  }
  if (!currentIsMedia && incomingIsMedia) {
    throw new Error(`Media Captureの${operation}はMain-owned Media Capture経由で実行してください。`);
  }
  if (!currentIsMedia || !currentValue) return entity;
  const ownedFields = type === "artifact" ? MEDIA_ARTIFACT_OWNED_FIELDS : MEDIA_CAPTURE_OWNED_FIELDS;
  const normalized = { ...value };
  for (const field of ownedFields) {
    if (Object.hasOwn(currentValue, field)) normalized[field] = currentValue[field];
    else delete normalized[field];
  }
  return normalized;
}
