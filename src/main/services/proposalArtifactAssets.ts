import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  findTaskenUploadAssetReferences,
  hasTaskenUploadAssetReference,
} from "../../shared/proposalMedia.mjs";
import type {
  ArtifactProposalAsset,
  ArtifactProposalAssetMediaType,
} from "../../shared/contracts/task/public.ts";
import type {
  ArtifactProposalAssetManifestEntry,
  PreparedArtifactProposalAssets,
} from "../core/ports/artifactProposalAssetPort.ts";

// HTML Artifact提案に同梱される画像・動画の検証と保存（#789）。
// note画像（proposalMarkdownImages.ts）と同じ規律で、受け側ノードの
// attachments/artifact-assets へ決定的な名前で置く。画像デコーダーは使わない：
// Taskenはアセットを解釈せず、採用時にdata URIとして埋め込むだけなので、
// 形式の一致はマジックバイトで確かめ、リスクはサイズ上限で抑える。

const MAX_ASSET_COUNT = 8;
const MAX_ASSET_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const REFERENCE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const INPUT_KEYS = ["reference_id", "file_name", "media_type", "data_base64"];

const EXTENSION_BY_MIME: Record<ArtifactProposalAssetMediaType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export type ProposalArtifactAssetMediaType = ArtifactProposalAssetMediaType;

export interface PreparedProposalArtifactAsset {
  manifest: ArtifactProposalAssetManifestEntry;
  bytes: Buffer;
}

export interface PreparedProposalArtifactAssetsInternal {
  proposalId: string;
  manifest: ArtifactProposalAssetManifestEntry[];
  files: PreparedProposalArtifactAsset[];
}

export interface StagedProposalArtifactAssets {
  createdPaths: string[];
}

export function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function assetError(reason: string): Error {
  return new Error(`${reason} アセットを修正して再提案してください。`);
}

function assetErrorFrom(error: unknown, reason: string): Error {
  if (error instanceof Error && error.message.endsWith("アセットを修正して再提案してください。"))
    return error;
  return assetError(reason);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isMediaType(value: unknown): value is ProposalArtifactAssetMediaType {
  return typeof value === "string" && Object.hasOwn(EXTENSION_BY_MIME, value);
}

function ensureSafeDisplayFileName(value: unknown): string {
  if (typeof value !== "string") throw assetError("アセットのファイル名が文字列ではありません。");
  const fileName = value.trim();
  if (
    !fileName ||
    fileName.length > 180 ||
    fileName === "." ||
    fileName === ".." ||
    /[\\/\x00-\x1f\x7f:*?"<>|]/.test(fileName)
  ) {
    throw assetError("アセットのファイル名に使えない文字が含まれています。");
  }
  return fileName;
}

function decodeStrictBase64(value: unknown): Buffer {
  if (typeof value !== "string" || !value.length || value.length % 4 !== 0) {
    throw assetError("アセットのデータが正しいbase64形式ではありません。");
  }
  const paddingLength = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const content = value.slice(0, value.length - paddingLength);
  if (content.includes("=") || /[^A-Za-z0-9+/]/.test(content)) {
    throw assetError("アセットのデータが正しいbase64形式ではありません。");
  }
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.toString("base64") !== value) {
    throw assetError("アセットのデータが正しいbase64形式ではありません。");
  }
  return bytes;
}

/** マジックバイトだけで形式を判定する。デコードはしない。 */
export function detectAssetFormat(bytes: Buffer): ProposalArtifactAssetMediaType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return "image/png";
  if (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9
  )
    return "image/jpeg";
  if (bytes.length >= 6) {
    const signature = bytes.toString("ascii", 0, 6);
    if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (bytes.length >= 8 && bytes.toString("ascii", 4, 8) === "ftyp") return "video/mp4";
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  )
    return "video/webm";
  return null;
}

export function parseAssetInput(value: unknown): {
  referenceId: string;
  mimeType: ProposalArtifactAssetMediaType;
  bytes: Buffer;
} {
  if (!isPlainObject(value) || !hasOnlyKeys(value, INPUT_KEYS)) {
    throw assetError(
      "アセットには reference_id、file_name、media_type、data_base64 だけを指定してください。",
    );
  }
  const referenceId = typeof value.reference_id === "string" ? value.reference_id.trim() : "";
  if (!REFERENCE_ID_PATTERN.test(referenceId))
    throw assetError("アセットのreference_idが安全な形式ではありません。");
  ensureSafeDisplayFileName(value.file_name);
  const mimeType = value.media_type;
  if (!isMediaType(mimeType)) throw assetError("アセットの形式が対応していません。");
  const bytes = decodeStrictBase64(value.data_base64);
  if (bytes.length > MAX_ASSET_BYTES) throw assetError("アセット1点が12 MiBを超えています。");
  const detected = detectAssetFormat(bytes);
  if (detected !== mimeType) throw assetError("アセットの形式とファイル内容が一致していません。");
  return { referenceId, mimeType, bytes };
}

export function findAssetPlaceholders(content: string): string[] {
  try {
    return findTaskenUploadAssetReferences(content);
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : "アセット参照の形式が不正です。"} アセットを修正して再提案してください。`,
    );
  }
}

export function hasAssetPlaceholder(content: string): boolean {
  return hasTaskenUploadAssetReference(content);
}

function deterministicAssetFileName(
  proposalId: string,
  referenceId: string,
  contentHash: string,
  mimeType: ProposalArtifactAssetMediaType,
): string {
  const fileHash = createHash("sha256")
    .update(`${proposalId}\u0000${referenceId}\u0000${contentHash}`)
    .digest("hex");
  const uuidLike = `${fileHash.slice(0, 8)}-${fileHash.slice(8, 12)}-${fileHash.slice(12, 16)}-${fileHash.slice(16, 20)}-${fileHash.slice(20, 32)}`;
  return `${uuidLike}.${EXTENSION_BY_MIME[mimeType]}`;
}

function validateAssetManifestEntry(value: unknown): ArtifactProposalAssetManifestEntry {
  if (!isPlainObject(value)) throw assetError("アセット情報が不正です。");
  const referenceId = typeof value.reference_id === "string" ? value.reference_id : "";
  const fileName = typeof value.file_name === "string" ? value.file_name : "";
  const mimeType = value.mime_type;
  const size = value.size;
  const sha256 = value.sha256;
  if (!REFERENCE_ID_PATTERN.test(referenceId))
    throw assetError("アセット情報のreference_idが不正です。");
  if (!isMediaType(mimeType)) throw assetError("アセット情報の形式が不正です。");
  if (!/^[a-f0-9-]+\.(png|jpg|gif|webp|mp4|webm)$/i.test(fileName))
    throw assetError("アセット情報のファイル名が不正です。");
  if (!Number.isSafeInteger(size) || (size as number) <= 0 || (size as number) > MAX_ASSET_BYTES)
    throw assetError("アセット情報のサイズが不正です。");
  if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256))
    throw assetError("アセット情報のハッシュが不正です。");
  return {
    reference_id: referenceId,
    file_name: fileName,
    mime_type: mimeType,
    size: size as number,
    sha256,
  };
}

function validateOwnedAssetManifest(
  proposalId: string,
  manifest: unknown,
): ArtifactProposalAssetManifestEntry[] {
  const cleanProposalId = typeof proposalId === "string" ? proposalId.trim() : "";
  if (!cleanProposalId) throw assetError("Proposal IDがありません。");
  if (!Array.isArray(manifest) || manifest.length > MAX_ASSET_COUNT)
    throw assetError("アセット情報が不正です。");
  const fileNames = new Set<string>();
  const referenceIds = new Set<string>();
  let totalBytes = 0;
  return manifest.map((value) => {
    const entry = validateAssetManifestEntry(value);
    const expectedFileName = deterministicAssetFileName(
      cleanProposalId,
      entry.reference_id,
      entry.sha256,
      entry.mime_type,
    );
    if (entry.file_name !== expectedFileName)
      throw assetError("アセット情報がこのProposalに属していません。");
    if (fileNames.has(entry.file_name) || referenceIds.has(entry.reference_id))
      throw assetError("アセット情報に重複があります。");
    fileNames.add(entry.file_name);
    referenceIds.add(entry.reference_id);
    totalBytes += entry.size;
    if (totalBytes > MAX_TOTAL_BYTES)
      throw assetError("アセット情報の合計サイズが上限を超えています。");
    return entry;
  });
}

export class ProposalArtifactAssetStore {
  readonly assetDirectory: string;

  constructor(userDataPath: string) {
    if (typeof userDataPath !== "string" || !userDataPath.trim())
      throw assetError("アセットの保存先が設定されていません。");
    this.assetDirectory = path.join(path.resolve(userDataPath), "attachments", "artifact-assets");
  }

  prepare(
    proposalId: string,
    content: string,
    assets: unknown,
  ): PreparedProposalArtifactAssetsInternal {
    const cleanProposalId = typeof proposalId === "string" ? proposalId.trim() : "";
    if (!cleanProposalId) throw assetError("Proposal IDがありません。");
    if (typeof content !== "string") throw assetError("HTML本文が文字列ではありません。");
    if (assets === undefined || assets === null || (Array.isArray(assets) && assets.length === 0)) {
      if (hasAssetPlaceholder(content))
        throw new Error(
          "本文のアセット参照に対応するデータがありません。アセットを添えて再提案してください。",
        );
      return { proposalId: cleanProposalId, manifest: [], files: [] };
    }
    if (!Array.isArray(assets) || assets.length > MAX_ASSET_COUNT)
      throw assetError("アセットは8点までです。");

    const parsedAssets = assets.map((asset) => parseAssetInput(asset));
    const referenceIds = new Set<string>();
    let totalBytes = 0;
    for (const parsed of parsedAssets) {
      if (referenceIds.has(parsed.referenceId))
        throw assetError("アセットのreference_idが重複しています。");
      referenceIds.add(parsed.referenceId);
      totalBytes += parsed.bytes.length;
      if (totalBytes > MAX_TOTAL_BYTES) throw assetError("アセットの合計が24 MiBを超えています。");
    }

    const placeholders = findAssetPlaceholders(content);
    for (const referenceId of placeholders) {
      if (!referenceIds.has(referenceId))
        throw assetError(`本文のアセット参照 ${referenceId} に対応するアセットがありません。`);
    }
    for (const referenceId of referenceIds) {
      if (!placeholders.includes(referenceId))
        throw assetError(`アセット ${referenceId} が本文から参照されていません。`);
    }

    const files = parsedAssets.map((parsed) => {
      const contentHash = sha256Hex(parsed.bytes);
      return {
        bytes: parsed.bytes,
        manifest: {
          reference_id: parsed.referenceId,
          file_name: deterministicAssetFileName(
            cleanProposalId,
            parsed.referenceId,
            contentHash,
            parsed.mimeType,
          ),
          mime_type: parsed.mimeType,
          size: parsed.bytes.length,
          sha256: contentHash,
        },
      };
    });
    return {
      proposalId: cleanProposalId,
      manifest: files.map((file) => file.manifest),
      files,
    };
  }

  stage(prepared: PreparedProposalArtifactAssetsInternal): StagedProposalArtifactAssets {
    if (
      !isPlainObject(prepared) ||
      !Array.isArray(prepared.files) ||
      !Array.isArray(prepared.manifest)
    ) {
      throw assetError("アセットの保存準備が不正です。");
    }
    const createdPaths: string[] = [];
    try {
      fs.mkdirSync(this.assetDirectory, { recursive: true });
      for (const file of prepared.files) {
        const manifest = validateAssetManifestEntry(file?.manifest);
        if (
          !Buffer.isBuffer(file?.bytes) ||
          file.bytes.length !== manifest.size ||
          sha256Hex(file.bytes) !== manifest.sha256
        ) {
          throw assetError("保存前のアセット内容が検証結果と一致しません。");
        }
        const targetPath = path.resolve(this.assetDirectory, manifest.file_name);
        if (!targetPath.startsWith(`${this.assetDirectory}${path.sep}`))
          throw assetError("アセットの保存先が不正です。");
        if (fs.existsSync(targetPath)) {
          this.verifyManifest(prepared.proposalId, [manifest]);
          continue;
        }
        const temporaryPath = path.join(
          this.assetDirectory,
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
      throw assetErrorFrom(error, "アセットの保存に失敗しました。保存先を確認してください。");
    }
  }

  rollbackCreated(paths: readonly string[]): void {
    for (const candidate of paths) {
      if (typeof candidate !== "string") continue;
      const resolvedPath = path.resolve(candidate);
      if (!resolvedPath.startsWith(`${this.assetDirectory}${path.sep}`)) continue;
      try {
        fs.rmSync(resolvedPath, { force: true });
      } catch {
        // Rollback is best effort; callers retain the original failure.
      }
    }
  }

  verifyManifest(proposalId: string, manifest: unknown): true {
    for (const entry of validateOwnedAssetManifest(proposalId, manifest)) {
      const filePath = path.resolve(this.assetDirectory, entry.file_name);
      if (!filePath.startsWith(`${this.assetDirectory}${path.sep}`) || !fs.existsSync(filePath)) {
        throw assetError(`保存済みアセット ${entry.file_name} が見つかりません。`);
      }
      let bytes: Buffer;
      try {
        bytes = fs.readFileSync(filePath);
      } catch (error) {
        throw assetErrorFrom(
          error,
          `保存済みアセット ${entry.file_name} を読み込めません。保存先を確認してください。`,
        );
      }
      if (bytes.length !== entry.size || sha256Hex(bytes) !== entry.sha256) {
        throw assetError(`保存済みアセット ${entry.file_name} の内容が変更されています。`);
      }
      if (detectAssetFormat(bytes) !== entry.mime_type)
        throw assetError(`保存済みアセット ${entry.file_name} の形式が不正です。`);
    }
    return true;
  }

  /**
   * 採用時の仕上げ：検証済みアセットをdata URIへ差し替え、自己完結した
   * HTML本文を返す。元のアセットファイルは呼び出し側がreceipt後に破棄する。
   */
  inlineAssets(proposalId: string, manifest: unknown, content: string): string {
    const entries = validateOwnedAssetManifest(proposalId, manifest);
    this.verifyManifest(proposalId, entries);
    let result = content;
    for (const entry of entries) {
      const bytes = fs.readFileSync(path.resolve(this.assetDirectory, entry.file_name));
      const dataUri = `data:${entry.mime_type};base64,${bytes.toString("base64")}`;
      result = result.split(`tasken-upload://${entry.reference_id}`).join(dataUri);
    }
    if (hasAssetPlaceholder(result))
      throw assetError("本文に差し替えできないアセット参照が残っています。");
    return result;
  }

  /** receipt確定後にステージ済みアセットを片付ける。無くても失敗にしない。 */
  discard(proposalId: string, manifest: unknown): string[] {
    const entries = validateOwnedAssetManifest(proposalId, manifest);
    const removed: string[] = [];
    for (const entry of entries) {
      const filePath = path.resolve(this.assetDirectory, entry.file_name);
      if (!filePath.startsWith(`${this.assetDirectory}${path.sep}`)) continue;
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
        removed.push(entry.file_name);
      }
    }
    return removed;
  }
}

interface PortPreparedState {
  prepared: PreparedProposalArtifactAssetsInternal;
  createdPaths: string[] | null;
}

/**
 * Adapts the store to Core's opaque artifact-asset port. Only files created by
 * this specific stage call can be removed through its rollback method.
 */
export function createArtifactProposalAssetPort(userDataPath: string) {
  const store = new ProposalArtifactAssetStore(userDataPath);
  return {
    prepare({
      proposalId,
      content,
      assets,
    }: {
      proposalId: string;
      content: string;
      assets: readonly ArtifactProposalAsset[];
    }): PreparedArtifactProposalAssets {
      const prepared = store.prepare(proposalId, content, assets);
      const state: PortPreparedState = { prepared, createdPaths: null };
      return { manifest: prepared.manifest, prepared: state };
    },
    stage(prepared: unknown) {
      if (
        !isPlainObject(prepared) ||
        !isPlainObject(prepared.prepared) ||
        (!Array.isArray(prepared.createdPaths) && prepared.createdPaths !== null)
      ) {
        throw assetError("アセットの保存準備が不正です。");
      }
      const state = prepared as unknown as PortPreparedState;
      if (state.createdPaths !== null)
        throw assetError("アセットの保存準備はすでに使用されています。");
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
