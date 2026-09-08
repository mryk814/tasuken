import { createHash } from "node:crypto";
import path from "node:path";

export interface ImageManifest {
  reference_id: string;
  file_name: string;
  mime_type: "image/png" | "image/jpeg";
  size: number;
  sha256: string;
  url: string;
}

const MANIFEST_KEYS = ["reference_id", "file_name", "mime_type", "size", "sha256", "url"];
const EXTENSION_BY_MIME = { "image/png": "png", "image/jpeg": "jpg" } as const;

function imageError(reason: string): Error {
  return new Error(`${reason} 画像を修正して再提案してください。`);
}

function captureImageError(reason: string): Error {
  return new Error(`${reason} 画像を確認して再送信してください。`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deterministicFileName(
  ownerId: string,
  referenceId: string,
  contentHash: string,
  mimeType: ImageManifest["mime_type"],
): string {
  const fileHash = createHash("sha256")
    .update(`${ownerId}\u0000${referenceId}\u0000${contentHash}`)
    .digest("hex");
  const uuidLike = `${fileHash.slice(0, 8)}-${fileHash.slice(8, 12)}-${fileHash.slice(12, 16)}-${fileHash.slice(16, 20)}-${fileHash.slice(20, 32)}`;
  return `${uuidLike}.${EXTENSION_BY_MIME[mimeType]}`;
}

export function validateManifestEntry(value: unknown): ImageManifest {
  if (
    !isPlainObject(value) ||
    Object.keys(value).length !== MANIFEST_KEYS.length ||
    !MANIFEST_KEYS.every((key) => Object.hasOwn(value, key))
  ) {
    throw imageError("画像情報の形式が不正です。");
  }
  const referenceId = typeof value.reference_id === "string" ? value.reference_id : "";
  const fileName = typeof value.file_name === "string" ? value.file_name : "";
  const mimeType = value.mime_type;
  const size = value.size;
  const contentHash = typeof value.sha256 === "string" ? value.sha256 : "";
  const url = typeof value.url === "string" ? value.url : "";
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(referenceId))
    throw imageError("画像情報のreference_idが不正です。");
  if (!/^[a-f0-9-]+\.(png|jpg)$/i.test(fileName))
    throw imageError("画像情報のファイル名が不正です。");
  if (
    (mimeType !== "image/png" && mimeType !== "image/jpeg") ||
    path.extname(fileName).toLowerCase() !== `.${EXTENSION_BY_MIME[mimeType]}`
  ) {
    throw imageError("画像情報の形式が不正です。");
  }
  if (
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > 12 * 1024 * 1024
  ) {
    throw imageError("画像情報のサイズが不正です。");
  }
  if (!/^[a-f0-9]{64}$/i.test(contentHash)) throw imageError("画像情報のハッシュが不正です。");
  if (!url.startsWith(`tasken-attachment://local/${encodeURIComponent(fileName)}/`)) {
    throw imageError("画像情報のURLが不正です。");
  }
  return {
    reference_id: referenceId,
    file_name: fileName,
    mime_type: mimeType,
    size,
    sha256: contentHash.toLowerCase(),
    url,
  };
}

/** Validate staged Capture/Task ownership without reading or writing image files. */
export function validateStagedImageManifest(ownerId: string, images: unknown): ImageManifest[] {
  const cleanOwnerId = typeof ownerId === "string" ? ownerId.trim() : "";
  if (!cleanOwnerId) throw captureImageError("所有IDがありません。");
  if (!Array.isArray(images) || images.length === 0 || images.length > 8) {
    throw captureImageError("画像は1〜8枚で指定してください。");
  }
  const fileNames = new Set<string>();
  const referenceIds = new Set<string>();
  let totalBytes = 0;
  return images.map((value) => {
    if (!isPlainObject(value)) throw captureImageError("画像情報の形式が不正です。");
    if ("data_base64" in value) throw captureImageError("画像バイトは保存層でstageしてください。");
    const entry = validateManifestEntry(value);
    const expectedFileName = deterministicFileName(
      cleanOwnerId,
      entry.reference_id,
      entry.sha256,
      entry.mime_type,
    );
    if (entry.file_name !== expectedFileName)
      throw captureImageError("画像情報がこの対象に属していません。");
    if (fileNames.has(entry.file_name) || referenceIds.has(entry.reference_id))
      throw captureImageError("画像情報に重複があります。");
    fileNames.add(entry.file_name);
    referenceIds.add(entry.reference_id);
    totalBytes += entry.size;
    if (totalBytes > 24 * 1024 * 1024)
      throw captureImageError("画像の合計サイズが上限を超えています。");
    return entry;
  });
}
