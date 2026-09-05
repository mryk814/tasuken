import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  findTaskenUploadImagePlaceholders,
  hasTaskenUploadImageDestination,
} from "../../shared/contracts/task/public.ts";

const MAX_IMAGE_COUNT = 8;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 16_384;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_TOTAL_IMAGE_PIXELS = 80_000_000;
const REFERENCE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ATTACHMENT_FILE_PATTERN = /^[a-f0-9-]+\.(png|jpg)$/i;
const MANIFEST_KEYS = ["reference_id", "file_name", "mime_type", "size", "sha256", "url"];
const INPUT_KEYS = ["reference_id", "file_name", "media_type", "data_base64"];

const EXTENSION_BY_MIME: Record<ProposalMarkdownImageMediaType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
};

export type ProposalMarkdownImageMediaType = "image/png" | "image/jpeg";

export interface ProposalMarkdownImageDimensions {
  width: number;
  height: number;
}

export type ProposalMarkdownImageDecoder = (
  bytes: Buffer,
  mimeType: ProposalMarkdownImageMediaType,
) => ProposalMarkdownImageDimensions | null;

export interface NativeImageDecoderBoundary {
  createFromBuffer(bytes: Buffer): {
    isEmpty(): boolean;
    getSize(): ProposalMarkdownImageDimensions;
  };
}

export function createNativeImageDecoder(
  nativeImage: NativeImageDecoderBoundary,
): ProposalMarkdownImageDecoder {
  return (bytes) => {
    try {
      const image = nativeImage.createFromBuffer(bytes);
      return image.isEmpty() ? null : image.getSize();
    } catch {
      return null;
    }
  };
}

export interface ProposalMarkdownImageInput {
  reference_id: string;
  file_name: string;
  media_type: ProposalMarkdownImageMediaType;
  data_base64: string;
}

export interface ProposalMarkdownImageManifest {
  reference_id: string;
  file_name: string;
  mime_type: ProposalMarkdownImageMediaType;
  size: number;
  sha256: string;
  url: string;
}

interface PreparedProposalMarkdownImage {
  manifest: ProposalMarkdownImageManifest;
  bytes: Buffer;
}

export interface PreparedProposalMarkdownImages {
  proposalId: string;
  body: string;
  manifest: ProposalMarkdownImageManifest[];
  files: PreparedProposalMarkdownImage[];
}

export interface StagedProposalMarkdownImages {
  createdPaths: string[];
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function imageError(reason: string): Error {
  return new Error(`${reason} 画像を修正して再提案してください。`);
}

function imageErrorFrom(error: unknown, reason: string): Error {
  if (error instanceof Error && error.message.endsWith("画像を修正して再提案してください。"))
    return error;
  return imageError(reason);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isMediaType(value: unknown): value is ProposalMarkdownImageMediaType {
  return typeof value === "string" && Object.hasOwn(EXTENSION_BY_MIME, value);
}

function ensureSafeDisplayFileName(value: unknown): string {
  if (typeof value !== "string") throw imageError("画像ファイル名が文字列ではありません。");
  const fileName = value.trim();
  if (
    !fileName ||
    fileName.length > 180 ||
    fileName === "." ||
    fileName === ".." ||
    /[\\/\x00-\x1f\x7f:*?"<>|]/.test(fileName)
  ) {
    throw imageError("画像ファイル名に使えない文字が含まれています。");
  }
  return fileName;
}

function decodeStrictBase64(value: unknown): Buffer {
  if (typeof value !== "string" || !value.length || value.length % 4 !== 0) {
    throw imageError("画像データが正しいbase64形式ではありません。");
  }
  const paddingLength = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const content = value.slice(0, value.length - paddingLength);
  if (content.includes("=") || /[^A-Za-z0-9+/]/.test(content)) {
    throw imageError("画像データが正しいbase64形式ではありません。");
  }
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.toString("base64") !== value) {
    throw imageError("画像データが正しいbase64形式ではありません。");
  }
  return bytes;
}

function pngDimensions(bytes: Buffer): ProposalMarkdownImageDimensions | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(signature)) return null;
  let offset = 8;
  let dimensions: ProposalMarkdownImageDimensions | null = null;
  let sawImageData = false;
  while (offset + 12 <= bytes.length) {
    const dataLength = bytes.readUInt32BE(offset);
    const chunkEnd = offset + 12 + dataLength;
    if (chunkEnd > bytes.length) return null;
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (!dimensions) {
      if (type !== "IHDR" || dataLength !== 13) return null;
      const width = bytes.readUInt32BE(offset + 8);
      const height = bytes.readUInt32BE(offset + 12);
      if (!width || !height) return null;
      dimensions = { width, height };
    } else if (type === "IDAT") {
      sawImageData = true;
    } else if (type === "IEND") {
      return dataLength === 0 && sawImageData && chunkEnd === bytes.length ? dimensions : null;
    }
    offset = chunkEnd;
  }
  return null;
}

function jpegDimensions(bytes: Buffer): ProposalMarkdownImageDimensions | null {
  if (
    bytes.length < 14 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.length - 2] !== 0xff ||
    bytes[bytes.length - 1] !== 0xd9
  ) {
    return null;
  }
  let offset = 2;
  let dimensions: ProposalMarkdownImageDimensions | null = null;
  while (offset < bytes.length - 2) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) {
      if (segmentLength < 7) return null;
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      if (!width || !height) return null;
      dimensions = { width, height };
    }
    if (marker === 0xda) return dimensions;
    offset += segmentLength;
  }
  return null;
}

function detectImage(bytes: Buffer): {
  mimeType: ProposalMarkdownImageMediaType;
  dimensions: ProposalMarkdownImageDimensions;
} | null {
  const png = pngDimensions(bytes);
  if (png) return { mimeType: "image/png", dimensions: png };
  const jpeg = jpegDimensions(bytes);
  if (jpeg) return { mimeType: "image/jpeg", dimensions: jpeg };
  return null;
}

function requireSafeDimensions(dimensions: ProposalMarkdownImageDimensions): void {
  const { width, height } = dimensions;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw imageError("画像の縦横サイズが上限を超えているか不正です。");
  }
}

function requireDecodedImage(
  decoder: ProposalMarkdownImageDecoder,
  bytes: Buffer,
  mimeType: ProposalMarkdownImageMediaType,
): void {
  let dimensions: ProposalMarkdownImageDimensions | null = null;
  try {
    dimensions = decoder(bytes, mimeType);
  } catch {
    // Decoder failures are exposed as a stable validation error below.
  }
  if (!dimensions) throw imageError("画像をデコードできませんでした。");
  requireSafeDimensions(dimensions);
}

function parseInput(value: unknown): {
  referenceId: string;
  displayName: string;
  mimeType: ProposalMarkdownImageMediaType;
  bytes: Buffer;
  dimensions: ProposalMarkdownImageDimensions;
} {
  if (!isPlainObject(value) || !hasOnlyKeys(value, INPUT_KEYS)) {
    throw imageError(
      "画像には reference_id、file_name、media_type、data_base64 だけを指定してください。",
    );
  }
  const referenceId = typeof value.reference_id === "string" ? value.reference_id.trim() : "";
  if (!REFERENCE_ID_PATTERN.test(referenceId))
    throw imageError("画像のreference_idが安全な形式ではありません。");
  const displayName = ensureSafeDisplayFileName(value.file_name);
  const mimeType = value.media_type;
  if (!isMediaType(mimeType)) throw imageError("画像形式が対応していません。");
  const bytes = decodeStrictBase64(value.data_base64);
  if (bytes.length > MAX_IMAGE_BYTES) throw imageError("画像1枚が12 MiBを超えています。");
  const detected = detectImage(bytes);
  if (!detected || detected.mimeType !== mimeType)
    throw imageError("画像形式とファイル内容が一致していません。");
  requireSafeDimensions(detected.dimensions);
  return { referenceId, displayName, mimeType, bytes, dimensions: detected.dimensions };
}

function deterministicFileName(
  proposalId: string,
  referenceId: string,
  contentHash: string,
  mimeType: ProposalMarkdownImageMediaType,
): string {
  const fileHash = sha256(`${proposalId}\u0000${referenceId}\u0000${contentHash}`);
  const uuidLike = `${fileHash.slice(0, 8)}-${fileHash.slice(8, 12)}-${fileHash.slice(12, 16)}-${fileHash.slice(16, 20)}-${fileHash.slice(20, 32)}`;
  return `${uuidLike}.${EXTENSION_BY_MIME[mimeType]}`;
}

function encodeUrlPathSegment(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function attachmentUrl(fileName: string, displayName: string): string {
  return `tasken-attachment://local/${encodeUrlPathSegment(fileName)}/${encodeUrlPathSegment(displayName)}`;
}

function attachmentFileNamesInMarkdown(body: string): Set<string> {
  const fileNames = new Set<string>();
  for (const match of body.matchAll(
    /tasken-attachment:\/\/local\/([^/?#\s)"'<>]+)(?:\/[^?#\s)"'<>]*)?/gi,
  )) {
    try {
      const fileName = decodeURIComponent(match[1]);
      if (ATTACHMENT_FILE_PATTERN.test(fileName)) fileNames.add(fileName);
    } catch {
      // Invalid URL encoding is simply not a managed attachment reference.
    }
  }
  return fileNames;
}

function validateManifestEntry(value: unknown): ProposalMarkdownImageManifest {
  if (!isPlainObject(value) || !hasOnlyKeys(value, MANIFEST_KEYS)) {
    throw imageError("画像情報の形式が不正です。");
  }
  const referenceId = typeof value.reference_id === "string" ? value.reference_id : "";
  const fileName = typeof value.file_name === "string" ? value.file_name : "";
  const mimeType = value.mime_type;
  const size = value.size;
  const contentHash = typeof value.sha256 === "string" ? value.sha256 : "";
  const url = typeof value.url === "string" ? value.url : "";
  if (!REFERENCE_ID_PATTERN.test(referenceId))
    throw imageError("画像情報のreference_idが不正です。");
  if (!ATTACHMENT_FILE_PATTERN.test(fileName)) throw imageError("画像情報のファイル名が不正です。");
  if (
    !isMediaType(mimeType) ||
    path.extname(fileName).toLowerCase() !== `.${EXTENSION_BY_MIME[mimeType]}`
  ) {
    throw imageError("画像情報の形式が不正です。");
  }
  if (
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > MAX_IMAGE_BYTES
  ) {
    throw imageError("画像情報のサイズが不正です。");
  }
  if (!/^[a-f0-9]{64}$/i.test(contentHash)) throw imageError("画像情報のハッシュが不正です。");
  if (!url.startsWith(`tasken-attachment://local/${encodeUrlPathSegment(fileName)}/`)) {
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

function validateOwnedManifest(
  proposalId: string,
  manifest: unknown,
): ProposalMarkdownImageManifest[] {
  const cleanProposalId = typeof proposalId === "string" ? proposalId.trim() : "";
  if (!cleanProposalId) throw imageError("Proposal IDがありません。");
  if (!Array.isArray(manifest) || manifest.length > MAX_IMAGE_COUNT)
    throw imageError("画像情報が不正です。");

  const fileNames = new Set<string>();
  const referenceIds = new Set<string>();
  let totalBytes = 0;
  return manifest.map((value) => {
    const entry = validateManifestEntry(value);
    const expectedFileName = deterministicFileName(
      cleanProposalId,
      entry.reference_id,
      entry.sha256,
      entry.mime_type,
    );
    if (entry.file_name !== expectedFileName)
      throw imageError("画像情報がこのProposalに属していません。");
    if (fileNames.has(entry.file_name) || referenceIds.has(entry.reference_id))
      throw imageError("画像情報に重複があります。");
    fileNames.add(entry.file_name);
    referenceIds.add(entry.reference_id);
    totalBytes += entry.size;
    if (totalBytes > MAX_TOTAL_BYTES)
      throw imageError("画像情報の合計サイズが上限を超えています。");
    return entry;
  });
}

/**
 * Prepares proposal-only Markdown image files under the final attachment directory.
 * The raw bytes remain only in the short-lived prepared value; manifests are safe to persist.
 */
export class ProposalMarkdownImageStore {
  readonly attachmentDirectory: string;

  constructor(
    userDataPath: string,
    private readonly decoder: ProposalMarkdownImageDecoder,
  ) {
    if (typeof userDataPath !== "string" || !userDataPath.trim())
      throw imageError("画像の保存先が設定されていません。");
    if (typeof decoder !== "function") throw imageError("画像デコーダーが設定されていません。");
    this.attachmentDirectory = path.join(
      path.resolve(userDataPath),
      "attachments",
      "markdown-images",
    );
  }

  prepare(proposalId: string, body: string, images: unknown): PreparedProposalMarkdownImages {
    const cleanProposalId = typeof proposalId === "string" ? proposalId.trim() : "";
    if (!cleanProposalId) throw imageError("Proposal IDがありません。");
    if (typeof body !== "string") throw imageError("本文が文字列ではありません。");
    const placeholders = findTaskenUploadImagePlaceholders(body);
    if (images === undefined || images === null || (Array.isArray(images) && images.length === 0)) {
      if (hasTaskenUploadImageDestination(body))
        throw new Error(
          "本文の画像プレースホルダーに対応する画像データがありません。画像を添えて再提案してください。",
        );
      return { proposalId: cleanProposalId, body, manifest: [], files: [] };
    }
    if (!Array.isArray(images) || images.length > MAX_IMAGE_COUNT)
      throw imageError("画像は8枚までです。");

    const parsedImages = images.map((image) => parseInput(image));
    const referenceIds = new Set<string>();
    let totalBytes = 0;
    let totalPixels = 0;
    for (const parsed of parsedImages) {
      if (referenceIds.has(parsed.referenceId))
        throw imageError("画像のreference_idが重複しています。");
      referenceIds.add(parsed.referenceId);
      totalBytes += parsed.bytes.length;
      if (totalBytes > MAX_TOTAL_BYTES) throw imageError("画像の合計が24 MiBを超えています。");
      totalPixels += parsed.dimensions.width * parsed.dimensions.height;
      if (totalPixels > MAX_TOTAL_IMAGE_PIXELS)
        throw imageError("画像全体の画素数が上限を超えています。");
    }

    for (const { referenceId } of placeholders) {
      if (!referenceIds.has(referenceId))
        throw imageError(`本文の画像プレースホルダー ${referenceId} に対応する画像がありません。`);
    }
    for (const referenceId of referenceIds) {
      if (!placeholders.some((placeholder) => placeholder.referenceId === referenceId))
        throw imageError(`画像 ${referenceId} が本文から参照されていません。`);
    }

    const files: PreparedProposalMarkdownImage[] = [];
    for (const parsed of parsedImages) {
      requireDecodedImage(this.decoder, parsed.bytes, parsed.mimeType);
      const contentHash = sha256(parsed.bytes);
      const fileName = deterministicFileName(
        cleanProposalId,
        parsed.referenceId,
        contentHash,
        parsed.mimeType,
      );
      files.push({
        bytes: parsed.bytes,
        manifest: {
          reference_id: parsed.referenceId,
          file_name: fileName,
          mime_type: parsed.mimeType,
          size: parsed.bytes.length,
          sha256: contentHash,
          url: attachmentUrl(fileName, parsed.displayName),
        },
      });
    }

    const manifestByReference = new Map(
      files.map((file) => [file.manifest.reference_id, file.manifest]),
    );
    const rewrittenParts: string[] = [];
    let bodyCursor = 0;
    for (const placeholder of placeholders) {
      const manifest = manifestByReference.get(placeholder.referenceId);
      if (!manifest) continue;
      rewrittenParts.push(body.slice(bodyCursor, placeholder.urlStart), manifest.url);
      bodyCursor = placeholder.urlEnd;
    }
    rewrittenParts.push(body.slice(bodyCursor));
    const rewrittenBody = rewrittenParts.join("");
    if (hasTaskenUploadImageDestination(rewrittenBody)) {
      throw imageError(
        "本文に解釈できないtasken-upload画像があります。![説明](tasken-upload://reference-id)の形式にしてください。",
      );
    }
    return {
      proposalId: cleanProposalId,
      body: rewrittenBody,
      manifest: files.map((file) => file.manifest),
      files,
    };
  }

  stage(prepared: PreparedProposalMarkdownImages): StagedProposalMarkdownImages {
    if (
      !isPlainObject(prepared) ||
      !Array.isArray(prepared.files) ||
      !Array.isArray(prepared.manifest) ||
      typeof prepared.body !== "string"
    ) {
      throw imageError("画像の保存準備が不正です。");
    }
    const createdPaths: string[] = [];
    try {
      fs.mkdirSync(this.attachmentDirectory, { recursive: true });
      for (const file of prepared.files) {
        const manifest = validateManifestEntry(file?.manifest);
        if (
          !Buffer.isBuffer(file?.bytes) ||
          file.bytes.length !== manifest.size ||
          sha256(file.bytes) !== manifest.sha256
        ) {
          throw imageError("保存前の画像内容が検証結果と一致しません。");
        }
        const targetPath = path.resolve(this.attachmentDirectory, manifest.file_name);
        if (!targetPath.startsWith(`${this.attachmentDirectory}${path.sep}`))
          throw imageError("画像の保存先が不正です。");
        if (fs.existsSync(targetPath)) {
          this.verifyManifest(prepared.proposalId, [manifest]);
          continue;
        }
        const temporaryPath = path.join(
          this.attachmentDirectory,
          `.${manifest.file_name}.${randomUUID()}.tmp`,
        );
        try {
          const descriptor = fs.openSync(temporaryPath, "wx");
          try {
            fs.writeFileSync(descriptor, file.bytes);
            fs.fsyncSync(descriptor);
          } finally {
            fs.closeSync(descriptor);
          }
          fs.renameSync(temporaryPath, targetPath);
          createdPaths.push(targetPath);
        } finally {
          if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
        }
        this.verifyManifest(prepared.proposalId, [manifest]);
      }
      return { createdPaths };
    } catch (error) {
      this.rollbackCreated(createdPaths);
      throw imageErrorFrom(error, "画像の保存に失敗しました。保存先を確認してください。");
    }
  }

  rollbackCreated(paths: readonly string[]): void {
    for (const candidate of paths) {
      if (typeof candidate !== "string") continue;
      const resolvedPath = path.resolve(candidate);
      if (!resolvedPath.startsWith(`${this.attachmentDirectory}${path.sep}`)) continue;
      try {
        fs.rmSync(resolvedPath, { force: true });
      } catch {
        // Rollback is best effort; callers retain the original failure.
      }
    }
  }

  verifyManifest(proposalId: string, manifest: unknown): true {
    for (const entry of validateOwnedManifest(proposalId, manifest)) {
      const filePath = path.resolve(this.attachmentDirectory, entry.file_name);
      if (
        !filePath.startsWith(`${this.attachmentDirectory}${path.sep}`) ||
        !fs.existsSync(filePath)
      ) {
        throw imageError(`保存済み画像 ${entry.file_name} が見つかりません。`);
      }
      let bytes: Buffer;
      try {
        bytes = fs.readFileSync(filePath);
      } catch (error) {
        throw imageErrorFrom(
          error,
          `保存済み画像 ${entry.file_name} を読み込めません。保存先を確認してください。`,
        );
      }
      if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256) {
        throw imageError(`保存済み画像 ${entry.file_name} の内容が変更されています。`);
      }
      const detected = detectImage(bytes);
      if (!detected || detected.mimeType !== entry.mime_type)
        throw imageError(`保存済み画像 ${entry.file_name} の形式が不正です。`);
      requireSafeDimensions(detected.dimensions);
      requireDecodedImage(this.decoder, bytes, entry.mime_type);
    }
    return true;
  }

  discardUnreferenced(proposalId: string, manifest: unknown, finalBody: string): string[] {
    if (typeof finalBody !== "string") throw imageError("確定本文が文字列ではありません。");
    const entries = validateOwnedManifest(proposalId, manifest);
    const references = attachmentFileNamesInMarkdown(finalBody);
    const removed: string[] = [];
    try {
      for (const entry of entries) {
        if (references.has(entry.file_name)) continue;
        const filePath = path.resolve(this.attachmentDirectory, entry.file_name);
        if (!filePath.startsWith(`${this.attachmentDirectory}${path.sep}`)) continue;
        if (fs.existsSync(filePath)) {
          fs.rmSync(filePath, { force: true });
          removed.push(entry.file_name);
        }
      }
    } catch (error) {
      throw imageErrorFrom(error, "不要な画像の削除に失敗しました。保存先を確認してください。");
    }
    return removed;
  }
}

interface PortPreparedState {
  prepared: PreparedProposalMarkdownImages;
  createdPaths: string[] | null;
}

/**
 * Adapts the store to Core's opaque proposal-image port. Only files created by
 * this specific stage call can be removed through its rollback method.
 */
export function createNoteProposalImagePort(
  userDataPath: string,
  decoder: ProposalMarkdownImageDecoder,
) {
  const store = new ProposalMarkdownImageStore(userDataPath, decoder);
  return {
    prepare({
      proposalId,
      body,
      images,
    }: {
      proposalId: string;
      body: string;
      images: readonly ProposalMarkdownImageInput[];
    }) {
      const prepared = store.prepare(proposalId, body, images);
      const state: PortPreparedState = { prepared, createdPaths: null };
      return { body: prepared.body, manifest: prepared.manifest, prepared: state };
    },
    stage(prepared: unknown) {
      if (
        !isPlainObject(prepared) ||
        !isPlainObject(prepared.prepared) ||
        (!Array.isArray(prepared.createdPaths) && prepared.createdPaths !== null)
      ) {
        throw imageError("画像の保存準備が不正です。");
      }
      const state = prepared as unknown as PortPreparedState;
      if (state.createdPaths !== null) throw imageError("画像の保存準備はすでに使用されています。");
      state.createdPaths = store.stage(state.prepared).createdPaths;
    },
    rollback(prepared: unknown) {
      if (!isPlainObject(prepared) || !Array.isArray(prepared.createdPaths)) return;
      store.rollbackCreated(
        prepared.createdPaths.filter(
          (candidate): candidate is string => typeof candidate === "string",
        ),
      );
      prepared.createdPaths = [];
    },
  };
}
