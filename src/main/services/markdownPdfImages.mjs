import fs from "node:fs";
import path from "node:path";

const ATTACHMENT_SRC_RE = /(?:src|href)\s*=\s*(["'])(tasken-attachment:\/\/local\/[^"']+)\1/gi;
const ATTACHMENT_URL_RE = /^tasken-attachment:\/\/local\/([^/?#]+)(?:\/[^?#]*)?/i;
const SAFE_ATTACHMENT_FILE = /^[a-f0-9-]+\.(png|jpg|jpeg|gif|webp|bmp)$/i;

const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

/**
 * tasken-attachment URL から保存ファイル名を取り出す。
 * @param {string} url
 * @returns {string}
 */
export function attachmentFileNameFromUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.protocol !== "tasken-attachment:" || parsed.hostname !== "local") return "";
    const fileName = decodeURIComponent(parsed.pathname.split("/").filter(Boolean)[0] || "");
    return SAFE_ATTACHMENT_FILE.test(fileName) ? fileName : "";
  } catch {
    const match = String(url || "").match(ATTACHMENT_URL_RE);
    if (!match) return "";
    try {
      const fileName = decodeURIComponent(match[1]);
      return SAFE_ATTACHMENT_FILE.test(fileName) ? fileName : "";
    } catch {
      return "";
    }
  }
}

/**
 * @param {string} fileName
 * @returns {string}
 */
export function attachmentMimeType(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  return MIME_BY_EXT[extension] || "application/octet-stream";
}

/**
 * HTML 内の tasken-attachment 参照を列挙する。
 * @param {string} html
 * @returns {string[]}
 */
export function listTaskenAttachmentUrls(html) {
  const found = new Set();
  const source = String(html || "");
  for (const match of source.matchAll(ATTACHMENT_SRC_RE)) {
    found.add(match[2]);
  }
  for (const match of source.matchAll(/tasken-attachment:\/\/local\/[^\s"'<>]+/gi)) {
    found.add(match[0]);
  }
  return [...found];
}

/**
 * PDF 用にローカル添付画像を解決する。
 * - assetDirectory を渡す: 画像をコピーし相対パス（./images/...）へ置換（大きな画像向け・既定）
 * - 渡さない: data URI へインライン化（単体テスト向け）
 * lazy 読込を外し、見つからない添付は欠落プレースホルダにする。
 *
 * @param {string} html
 * @param {string} attachmentDirectory userData/attachments/markdown-images
 * @param {{ assetDirectory?: string }} [options]
 * @returns {{ html: string, warnings: string[], inlinedCount: number, missingCount: number }}
 */
export function prepareMarkdownHtmlForPdf(html, attachmentDirectory, options = {}) {
  const warnings = [];
  let inlinedCount = 0;
  let missingCount = 0;
  const root = path.resolve(attachmentDirectory || "");
  const assetDirectory = options.assetDirectory ? path.resolve(options.assetDirectory) : "";
  const cache = new Map();

  function resolveReplacementSrc(fileName) {
    if (cache.has(fileName)) return cache.get(fileName);
    const filePath = path.resolve(root, fileName);
    if (!root || !filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath)) {
      cache.set(fileName, null);
      return null;
    }
    const bytes = fs.readFileSync(filePath);
    if (!bytes.length) {
      cache.set(fileName, null);
      return null;
    }

    if (assetDirectory) {
      fs.mkdirSync(assetDirectory, { recursive: true });
      const targetPath = path.join(assetDirectory, fileName);
      if (!fs.existsSync(targetPath)) fs.copyFileSync(filePath, targetPath);
      const relative = `./images/${fileName}`.replace(/\\/g, "/");
      cache.set(fileName, relative);
      return relative;
    }

    const dataUrl = `data:${attachmentMimeType(fileName)};base64,${bytes.toString("base64")}`;
    cache.set(fileName, dataUrl);
    return dataUrl;
  }

  function missingPlaceholder(label) {
    missingCount += 1;
    const safe = String(label || "画像").replace(/[<>&"]/g, "");
    warnings.push(`画像を読み込めませんでした: ${safe}`);
    return `<figure class="md-image md-image-missing"><figcaption>画像を読み込めませんでした: ${safe}</figcaption></figure>`;
  }

  let next = String(html || "");

  next = next.replace(
    /<figure\b([^>]*)>\s*<img\b([^>]*)>\s*((?:<figcaption\b[^>]*>[\s\S]*?<\/figcaption>)?)\s*<\/figure>/gi,
    (full, figureAttrs, imgAttrs, captionHtml = "") => {
      const srcMatch = String(imgAttrs).match(/\ssrc\s*=\s*(["'])(tasken-attachment:\/\/local\/[^"']+)\1/i);
      if (!srcMatch) return full;
      const fileName = attachmentFileNameFromUrl(srcMatch[2]);
      if (!fileName) return missingPlaceholder(srcMatch[2]);
      const replacement = resolveReplacementSrc(fileName);
      if (!replacement) return missingPlaceholder(fileName);
      inlinedCount += 1;
      const rewrittenImg = String(imgAttrs)
        .replace(/\ssrc\s*=\s*(["'])tasken-attachment:\/\/local\/[^"']+\1/i, ` src="${replacement}"`)
        .replace(/\sloading\s*=\s*(["'])lazy\1/i, "");
      return `<figure${figureAttrs}><img${rewrittenImg}>${captionHtml || ""}</figure>`;
    },
  );

  next = next.replace(ATTACHMENT_SRC_RE, (full, quote, url) => {
    const fileName = attachmentFileNameFromUrl(url);
    if (!fileName) {
      warnings.push(`不正な画像参照です: ${url}`);
      return full;
    }
    const replacement = resolveReplacementSrc(fileName);
    if (!replacement) {
      warnings.push(`画像を読み込めませんでした: ${fileName}`);
      missingCount += 1;
      return `src=${quote}${quote}`;
    }
    inlinedCount += 1;
    return `src=${quote}${replacement}${quote}`;
  });

  // PDF では遅延読込しない（printToPDF 前に描画させる）
  next = next.replace(/\sloading\s*=\s*(["'])lazy\1/gi, "");

  return { html: next, warnings, inlinedCount, missingCount };
}
