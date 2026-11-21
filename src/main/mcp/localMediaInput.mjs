import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import * as z from "zod/v4";

import {
  documentAssetMediaTypeSchema,
  noteProposalImageMediaTypeSchema,
} from "../../shared/contracts/task/public.ts";
import { TaskenCoreClientError } from "./taskenCoreClient.mjs";

const MAX_ITEM_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const MAX_BASE64_LENGTH = 16_777_216;
const SAFE_FILE_NAME_FORBIDDEN = /[<>:"/\\|?*\x00-\x1f\x7f]/;

export const NOTE_IMAGE_MEDIA_TYPES = Object.freeze(["image/png", "image/jpeg"]);
export const DOCUMENT_ASSET_MEDIA_TYPES = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
]);

const referenceIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);

const safeFileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .refine(
    (value) => value !== "." && value !== ".." && !SAFE_FILE_NAME_FORBIDDEN.test(value),
    "file_nameにはファイル名だけを指定してください。",
  );

/**
 * マジックバイトから対応形式を判定する。JPEG/PNG の厳密な構造検査や寸法検査は Core が行うため、
 * ここでは既知のシグネチャ判定だけにとどめ、壊れたファイルは Core 側の詳細な検証エラーへ渡す。
 */
export function detectMediaType(bytes, allowedMediaTypes) {
  let detected = null;
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
  ) {
    detected = "image/png";
  } else if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    detected = "image/jpeg";
  } else if (bytes.length >= 6) {
    const signature = bytes.toString("ascii", 0, 6);
    if (signature === "GIF87a" || signature === "GIF89a") detected = "image/gif";
  }
  if (
    !detected &&
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    detected = "image/webp";
  } else if (!detected && bytes.length >= 8 && bytes.toString("ascii", 4, 8) === "ftyp") {
    detected = "video/mp4";
  } else if (
    !detected &&
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    detected = "video/webm";
  }
  return detected && allowedMediaTypes.includes(detected) ? detected : null;
}

function createMediaItemSchema({ allowLocalFilePaths, mediaTypeSchema }) {
  if (!allowLocalFilePaths) {
    return z
      .object({
        reference_id: referenceIdSchema,
        file_name: safeFileNameSchema,
        media_type: mediaTypeSchema,
        data_base64: z.string().min(4).max(MAX_BASE64_LENGTH),
      })
      .strict();
  }
  return z
    .object({
      reference_id: referenceIdSchema,
      file_path: z.string().trim().min(1).max(4096).optional(),
      file_name: safeFileNameSchema.optional(),
      media_type: mediaTypeSchema.optional(),
      data_base64: z.string().min(4).max(MAX_BASE64_LENGTH).optional(),
    })
    .strict()
    .superRefine((value, context) => {
      const hasPath = value.file_path !== undefined;
      const hasBase64 = value.data_base64 !== undefined;
      if (hasPath === hasBase64) {
        context.addIssue({
          code: "custom",
          path: [hasPath ? "data_base64" : "file_path"],
          message: hasPath
            ? "file_pathとdata_base64は同時に指定できません。"
            : "file_pathまたはdata_base64のどちらかを指定してください。",
        });
        return;
      }
      if (hasBase64) {
        if (value.file_name === undefined) {
          context.addIssue({
            code: "custom",
            path: ["file_name"],
            message: "data_base64を使うときはfile_nameが必要です。",
          });
        }
        if (value.media_type === undefined) {
          context.addIssue({
            code: "custom",
            path: ["media_type"],
            message: "data_base64を使うときはmedia_typeが必要です。",
          });
        }
      }
    });
}

export function createNoteImagesSchema({ allowLocalFilePaths, description }) {
  return z
    .array(
      createMediaItemSchema({
        allowLocalFilePaths,
        mediaTypeSchema: noteProposalImageMediaTypeSchema,
      }),
    )
    .min(1)
    .max(8)
    .optional()
    .describe(description);
}

export function createDocumentAssetsSchema({ allowLocalFilePaths, description }) {
  return z
    .array(
      createMediaItemSchema({
        allowLocalFilePaths,
        mediaTypeSchema: documentAssetMediaTypeSchema,
      }),
    )
    .min(1)
    .max(8)
    .optional()
    .describe(description);
}

function validateSafeDisplayFileName(value, label, referenceId) {
  const fileName = typeof value === "string" ? value.trim() : "";
  if (
    !fileName ||
    fileName.length > 180 ||
    fileName === "." ||
    fileName === ".." ||
    SAFE_FILE_NAME_FORBIDDEN.test(fileName)
  ) {
    throw new TaskenCoreClientError(
      "VALIDATION_FAILED",
      `${label}のfile_nameに使えない文字があるか長すぎます（${referenceId}）。file_nameを明示してください。`,
    );
  }
  return fileName;
}

/**
 * ローカル stdio MCP で渡された `file_path` を、クライアントと同じ PC 上で読み取って
 * Core 契約の `{ reference_id, file_name, media_type, data_base64 }` へ正規化する（#790）。
 * HTTP 接続（`allowLocalFilePaths === false`）では NAS のローカルファイル読み出し（LFI）を防ぐため、
 * `file_path` を一切開かずに拒否する。
 */
async function resolveLocalMediaItems(items, { allowLocalFilePaths, allowedMediaTypes, label }) {
  if (!Array.isArray(items) || items.length === 0) return items;
  const resolved = [];
  // data_base64 で渡された分も含めた合計。Core・HTTP の本文上限に当たる前に、ここで断る。
  let totalBytes = 0;
  const addTotal = (bytes) => {
    totalBytes += bytes;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new TaskenCoreClientError(
        "VALIDATION_FAILED",
        `${label}の合計が24 MiBを超えています。`,
      );
    }
  };
  for (const item of items) {
    if (!item || typeof item !== "object" || item.file_path === undefined) {
      if (typeof item?.data_base64 === "string") {
        const padding = item.data_base64.endsWith("==")
          ? 2
          : item.data_base64.endsWith("=")
            ? 1
            : 0;
        addTotal(Math.max(0, Math.floor((item.data_base64.length * 3) / 4) - padding));
      }
      resolved.push(item);
      continue;
    }
    if (!allowLocalFilePaths) {
      throw new TaskenCoreClientError(
        "VALIDATION_FAILED",
        "HTTP経由の接続ではfile_pathを指定できません。クライアント側でファイルを読んでdata_base64で送ってください。",
      );
    }
    const filePath = item.file_path;
    if (filePath.includes("\0") || !path.isAbsolute(filePath)) {
      throw new TaskenCoreClientError(
        "VALIDATION_FAILED",
        `${label}のfile_pathには絶対パスを指定してください（${item.reference_id}）。`,
      );
    }
    // ネットワーク上の場所（\\host\share・//host/share）やデバイス（\\.\pipe など）は開かない。
    // 開くだけで SMB へ本人の資格情報で接続しに行くので、AI に外のホストを指させれば
    // 資格情報のハッシュが漏れる道になる。長いパスの形（\\?\C:\...）だけは手元のファイルなので通す。
    if (/^[\\/]{2}/.test(filePath) && !/^\\\\\?\\[A-Za-z]:\\/.test(filePath)) {
      throw new TaskenCoreClientError(
        "VALIDATION_FAILED",
        `${label}のfile_pathにはこのPCのドライブ上のファイルを指定してください（${item.reference_id}）。`,
      );
    }
    let bytes;
    let handle;
    try {
      // FIFO などを渡されても open() で止まらないよう、POSIX では O_NONBLOCK で開いてから種類を確かめる。
      handle = await fs.open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NONBLOCK ?? 0));
      const info = await handle.stat();
      if (!info.isFile()) {
        throw new TaskenCoreClientError(
          "VALIDATION_FAILED",
          `${label}のfile_pathは通常のファイルを指定してください（${item.reference_id}）。`,
        );
      }
      if (info.size <= 0) {
        throw new TaskenCoreClientError(
          "VALIDATION_FAILED",
          `${label}のファイルが空です（${item.reference_id}）。`,
        );
      }
      if (info.size > MAX_ITEM_BYTES) {
        throw new TaskenCoreClientError(
          "VALIDATION_FAILED",
          `${label}1点が12 MiBを超えています（${item.reference_id}）。`,
        );
      }
      // stat 後に肥大化するファイルでも、上限 +1 バイトまでしか読まない。
      const buffer = Buffer.alloc(MAX_ITEM_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      bytes = buffer.subarray(0, length);
    } catch (error) {
      if (error instanceof TaskenCoreClientError) throw error;
      const reason =
        error?.code === "ENOENT"
          ? "ファイルが見つかりません"
          : error?.code === "EACCES" || error?.code === "EPERM"
            ? "ファイルを読み取れません（権限がありません）"
            : error?.code === "EISDIR"
              ? "ディレクトリは指定できません"
              : "ファイルを読み込めませんでした";
      throw new TaskenCoreClientError(
        "VALIDATION_FAILED",
        `${label}の${reason}（${item.reference_id}）。パスを確認してください。`,
      );
    } finally {
      await handle?.close();
    }
    if (bytes.length <= 0 || bytes.length > MAX_ITEM_BYTES) {
      throw new TaskenCoreClientError(
        "VALIDATION_FAILED",
        `${label}のサイズが範囲外です（${item.reference_id}）。`,
      );
    }
    addTotal(bytes.length);
    const detected = detectMediaType(bytes, allowedMediaTypes);
    if (!detected) {
      throw new TaskenCoreClientError(
        "VALIDATION_FAILED",
        `${label}の形式が対応していません（${item.reference_id}）。対応形式: ${allowedMediaTypes.join(", ")}`,
      );
    }
    if (item.media_type && item.media_type !== detected) {
      throw new TaskenCoreClientError(
        "VALIDATION_FAILED",
        `${label}のmedia_type（${item.media_type}）がファイル内容（${detected}）と一致しません（${item.reference_id}）。`,
      );
    }
    const fileName = validateSafeDisplayFileName(
      item.file_name ?? path.basename(filePath),
      label,
      item.reference_id,
    );
    resolved.push({
      reference_id: item.reference_id,
      file_name: fileName,
      media_type: detected,
      data_base64: bytes.toString("base64"),
    });
  }
  return resolved;
}

export function resolveLocalNoteImages(images, { allowLocalFilePaths }) {
  return resolveLocalMediaItems(images, {
    allowLocalFilePaths,
    allowedMediaTypes: NOTE_IMAGE_MEDIA_TYPES,
    label: "画像",
  });
}

export function resolveLocalDocumentAssets(assets, { allowLocalFilePaths }) {
  return resolveLocalMediaItems(assets, {
    allowLocalFilePaths,
    allowedMediaTypes: DOCUMENT_ASSET_MEDIA_TYPES,
    label: "アセット",
  });
}
