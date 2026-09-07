import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  attachmentUrl,
  deterministicFileName,
  parseInput,
  sha256,
  validateManifestEntry,
  type ProposalMarkdownImageDecoder,
  type ProposalMarkdownImageManifest,
} from "./proposalMarkdownImages.ts";
import type { CaptureImagePort } from "../core/ports/captureImagePort";

/**
 * Mobile Capture に添付された撮影画像の保存契約。
 *
 * Note Proposal の画像管轄（ProposalMarkdownImageStore）と上限・検証を揃え、
 * 所有スコープだけを captureId に替える。base64 は Gateway/Composition 層で
 * ここへ stage され、Core へ渡るのは manifest だけ（DB 肥大を避ける）。
 */

export const CAPTURE_IMAGE_MAX_COUNT = 8;
export const CAPTURE_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
export const CAPTURE_IMAGE_MAX_TOTAL_BYTES = 24 * 1024 * 1024;
export const CAPTURE_IMAGE_DIRECTORY = "capture-images";

export type CaptureImageManifest = ProposalMarkdownImageManifest;

export interface StagedCaptureImageFiles {
  manifest: CaptureImageManifest[];
  createdPaths: string[];
}

function captureImageError(reason: string): Error {
  return new Error(`${reason} 画像を確認して再送信してください。`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * stage 済み manifest がこの所有者（Capture/Task）に属し、保存済みファイルと
 * 一致することを fs なしで検証する。Core が使う純粋関数。
 */
export function validateStagedImageManifest(
  ownerId: string,
  images: unknown,
): CaptureImageManifest[] {
  const cleanOwnerId = typeof ownerId === "string" ? ownerId.trim() : "";
  if (!cleanOwnerId) throw captureImageError("所有IDがありません。");
  if (!Array.isArray(images) || images.length === 0 || images.length > CAPTURE_IMAGE_MAX_COUNT) {
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
    if (totalBytes > CAPTURE_IMAGE_MAX_TOTAL_BYTES)
      throw captureImageError("画像の合計サイズが上限を超えています。");
    return entry;
  });
}

export class CaptureImageStore {
  readonly attachmentDirectory: string;
  private readonly decoder: ProposalMarkdownImageDecoder;

  constructor(userDataPath: string, decoder: ProposalMarkdownImageDecoder) {
    if (typeof userDataPath !== "string" || !userDataPath.trim())
      throw captureImageError("画像の保存先が設定されていません。");
    if (typeof decoder !== "function")
      throw captureImageError("画像デコーダーが設定されていません。");
    this.decoder = decoder;
    this.attachmentDirectory = path.join(
      path.resolve(userDataPath),
      "attachments",
      CAPTURE_IMAGE_DIRECTORY,
    );
  }

  /**
   * base64 画像を検証・保存し、manifest を返す。ファイル名は
   * (captureId, reference_id, sha256) から決定的に付くため、同一コマンドの
   * 再送は既存ファイルを再利用し、失敗時は作成分だけ rollback する。
   */
  stage(captureId: string, images: unknown): StagedCaptureImageFiles {
    const cleanCaptureId = typeof captureId === "string" ? captureId.trim() : "";
    if (!cleanCaptureId) throw captureImageError("Capture IDがありません。");
    if (!Array.isArray(images) || images.length === 0 || images.length > CAPTURE_IMAGE_MAX_COUNT) {
      throw captureImageError("画像は1〜8枚で指定してください。");
    }
    const parsedImages = images.map((image) => parseInput(image));
    const referenceIds = new Set<string>();
    let totalBytes = 0;
    for (const parsed of parsedImages) {
      if (referenceIds.has(parsed.referenceId))
        throw captureImageError("画像のreference_idが重複しています。");
      referenceIds.add(parsed.referenceId);
      totalBytes += parsed.bytes.length;
      if (totalBytes > CAPTURE_IMAGE_MAX_TOTAL_BYTES)
        throw captureImageError("画像の合計が24 MiBを超えています。");
      this.requireDecoder(parsed.bytes, parsed.mimeType);
    }
    const manifest: CaptureImageManifest[] = parsedImages.map((parsed) => {
      const contentHash = sha256(parsed.bytes);
      const fileName = deterministicFileName(
        cleanCaptureId,
        parsed.referenceId,
        contentHash,
        parsed.mimeType,
      );
      return {
        reference_id: parsed.referenceId,
        file_name: fileName,
        mime_type: parsed.mimeType,
        size: parsed.bytes.length,
        sha256: contentHash,
        url: attachmentUrl(fileName, parsed.displayName),
      };
    });
    // Core 側と同じ所有検証を通してから保存する。
    validateStagedImageManifest(cleanCaptureId, manifest);
    const createdPaths: string[] = [];
    try {
      fs.mkdirSync(this.attachmentDirectory, { recursive: true });
      for (const [index, entry] of manifest.entries()) {
        const bytes = parsedImages[index].bytes;
        const targetPath = path.resolve(this.attachmentDirectory, entry.file_name);
        if (!targetPath.startsWith(`${this.attachmentDirectory}${path.sep}`))
          throw captureImageError("画像の保存先が不正です。");
        if (fs.existsSync(targetPath)) {
          this.verifyStored(entry);
          continue;
        }
        const temporaryPath = path.join(
          this.attachmentDirectory,
          `.${entry.file_name}.${randomUUID()}.tmp`,
        );
        try {
          const descriptor = fs.openSync(temporaryPath, "wx");
          try {
            fs.writeFileSync(descriptor, bytes);
            fs.fsyncSync(descriptor);
          } finally {
            fs.closeSync(descriptor);
          }
          fs.renameSync(temporaryPath, targetPath);
          createdPaths.push(targetPath);
        } finally {
          if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
        }
        this.verifyStored(entry);
      }
      return { manifest, createdPaths };
    } catch (error) {
      this.rollbackCreated(createdPaths);
      if (error instanceof Error && error.message.endsWith("再送信してください。")) throw error;
      throw captureImageError("画像の保存に失敗しました。保存先を確認してください。");
    }
  }

  /** MCP 画像ツールが LLM へ渡すバイトを読む。保存外パスは拒否する。 */
  read(fileName: string): Buffer {
    if (typeof fileName !== "string" || !fileName)
      throw captureImageError("画像ファイル名が不正です。");
    const targetPath = path.resolve(this.attachmentDirectory, fileName);
    if (!targetPath.startsWith(`${this.attachmentDirectory}${path.sep}`))
      throw captureImageError("画像の保存先が不正です。");
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(targetPath);
    } catch {
      throw captureImageError("保存済み画像が見つかりません。");
    }
    return bytes;
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

  private verifyStored(entry: CaptureImageManifest): void {
    const filePath = path.resolve(this.attachmentDirectory, entry.file_name);
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(filePath);
    } catch {
      throw captureImageError(`保存済み画像 ${entry.file_name} を読み込めません。`);
    }
    if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256) {
      throw captureImageError(`保存済み画像 ${entry.file_name} の内容が一致しません。`);
    }
  }

  private requireDecoder(bytes: Buffer, mimeType: "image/png" | "image/jpeg"): void {
    let dimensions = null;
    try {
      dimensions = this.decoder(bytes, mimeType);
    } catch {
      // Decoder failures are exposed as a stable validation error below.
    }
    if (!dimensions) throw captureImageError("画像をデコードできませんでした。");
  }
}

/**
 * Adapts the store to Core's opaque capture-image port. Only files created by
 * this specific stage call can be removed through its rollback method.
 */
export function createCaptureImagePort(
  userDataPath: string,
  decoder: ProposalMarkdownImageDecoder,
): CaptureImagePort {
  const store = new CaptureImageStore(userDataPath, decoder);
  return {
    stage({ ownerId, images }) {
      const staged = store.stage(ownerId, images);
      const state: { createdPaths: string[] | null } = { createdPaths: staged.createdPaths };
      return {
        manifest: staged.manifest.map((entry) => ({
          reference_id: entry.reference_id,
          file_name: entry.file_name,
          mime_type: entry.mime_type,
          size: entry.size,
          sha256: entry.sha256,
          url: entry.url,
        })),
        staged: state,
      };
    },
    rollback(staged: unknown) {
      if (!isPlainObject(staged) || !Array.isArray(staged.createdPaths)) return;
      store.rollbackCreated(
        staged.createdPaths.filter(
          (candidate): candidate is string => typeof candidate === "string",
        ),
      );
      staged.createdPaths = [];
    },
    read(fileName: string) {
      return store.read(fileName);
    },
  };
}
