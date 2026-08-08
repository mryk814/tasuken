import { app, BrowserWindow, clipboard, dialog, nativeImage, shell, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { ArtifactFileImportRequest, ArtifactFileImportResult, ArtifactProposalMaterializeRequest, ArtifactProposalMaterializeResult, ImportedArtifactFile, MarkdownImageAttachmentRequest, MarkdownImageAttachmentResult } from "../../shared/attachments";
import type { MarkdownFileExportRequest, MarkdownFileExportResult, MarkdownPdfExportRequest, MarkdownPdfExportResult } from "../../shared/fileExport";
import type { AppUpdateCheckResult, FilePreviewReadResult, McpBridgeInfo } from "../../shared/ipc/contracts";
import type { SketchExportRequest, SketchExportResult } from "../../shared/sketchExport";
import {
  validateMermaidPptxDiagram,
  validateOfficeSvg,
  type MermaidPowerPointPptxExportRequest,
  type MermaidPowerPointPptxExportResult,
  type MermaidPowerPointSvgExportRequest,
  type MermaidPowerPointSvgExportResult,
  type MermaidSvgClipboardRequest,
  type MermaidSvgClipboardResult,
} from "../../shared/mermaidPowerPoint";
import type { ImageClipboardRequest, SlideTimelineExportRequest, SlideTimelineExportResult } from "../../shared/slideTimelineExport";
import type { Workspace } from "../../shared/types/workspace";
import { validateArtifactProposal } from "../../shared/proposalMedia.mjs";
import { THEME_FOLDER_MANIFEST, buildThemeFolderManifest } from "../../shared/storageResolver.mjs";
import { buildActivityRootRegistry, publicActivityRootStatus } from "../../shared/activityRootRegistry.mjs";
import { resolveActivityCanonicalLocalPath } from "./activityCanonicalResolver.mjs";
import {
  artifactFileTypeOf,
  artifactMimeTypeOf,
  resolveThemeContentDirectoryParts,
  resolveUniqueArtifactFileName,
} from "./artifactStorage.mjs";
import { prepareMarkdownHtmlForPdf } from "./markdownPdfImages.mjs";
import { buildMermaidPptxBuffer } from "./mermaidPowerPointService";
import { createSnapshot, readSnapshot } from "./snapshotService.mjs";

type SnapshotDecisions = Record<string, string>;

const MARKDOWN_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
/** アプリ内ビューア用。インフォグラフィック等の大きめ画像も許容する。 */
const PREVIEW_IMAGE_MAX_BYTES = 40 * 1024 * 1024;
const PREVIEW_TEXT_MAX_BYTES = 5 * 1024 * 1024;
const RELEASES_API_URL = "https://api.github.com/repos/mryk814/tasuken/releases/latest";
const RELEASES_PAGE_URL = "https://github.com/mryk814/tasuken/releases/latest";
const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
};
const PREVIEW_IMAGE_EXT_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};
const PREVIEW_TEXT_EXT_MIME: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
  ".html": "text/html",
  ".htm": "text/html",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
};

interface GitHubLatestRelease {
  tag_name?: string;
  name?: string;
  html_url?: string;
  published_at?: string;
}

interface WorkspaceRepository {
  loadWorkspace(includeDeleted?: boolean): unknown;
  previewSnapshot(workspace: unknown): unknown[];
  applySnapshot(workspace: unknown, decisions: SnapshotDecisions, revisions: unknown[]): unknown;
  getPreference(key: string): unknown;
  get(type: string, id: string, includeDeleted?: boolean): Record<string, unknown> | null;
  list(type: string, includeDeleted?: boolean): Array<Record<string, unknown>>;
}

function localDateIso(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function safeExportFileName(value: string, extension: "md" | "pdf"): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const fileName = (cleaned || "tasken-log").slice(0, 120);
  return fileName.toLowerCase().endsWith(`.${extension}`) ? fileName : `${fileName}.${extension}`;
}

function safeMarkdownFileName(value: string): string {
  return safeExportFileName(value, "md");
}

function safePdfFileName(value: string): string {
  return safeExportFileName(value, "pdf");
}

function normalizeMarkdownFileExportRequest(value: unknown): MarkdownFileExportRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Markdown出力の内容が不正です。画面を再読み込みして、もう一度試してください。");
  }
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title : "";
  const content = typeof record.content === "string" ? record.content : "";
  if (!content.trim()) throw new Error("書き出す内容がありません。");
  return {
    title,
    content,
    directory: typeof record.directory === "string" ? record.directory : null,
    chooseDirectory: Boolean(record.chooseDirectory),
    fileName: typeof record.fileName === "string" ? record.fileName : null,
    themeId: typeof record.themeId === "string" && record.themeId.trim() ? record.themeId.trim() : null,
  };
}

function normalizeMarkdownPdfExportRequest(value: unknown): MarkdownPdfExportRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("PDF出力の内容が不正です。画面を再読み込みして、もう一度試してください。");
  }
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title : "";
  const html = typeof record.html === "string" ? record.html : "";
  if (!html.trim()) throw new Error("PDFに出力する内容がありません。");
  return {
    title,
    html,
    directory: typeof record.directory === "string" ? record.directory : null,
    chooseDirectory: Boolean(record.chooseDirectory),
    fileName: typeof record.fileName === "string" ? record.fileName : null,
    themeId: typeof record.themeId === "string" && record.themeId.trim() ? record.themeId.trim() : null,
  };
}

function parseVersion(value: string): number[] {
  const normalized = value.trim().replace(/^v/i, "");
  const [core] = normalized.split("-");
  return core
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.length, right.length, 3);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function safeReleaseUrl(value: unknown): string {
  if (typeof value !== "string") return RELEASES_PAGE_URL;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") return RELEASES_PAGE_URL;
    if (!parsed.pathname.startsWith("/mryk814/tasuken/releases")) return RELEASES_PAGE_URL;
    return parsed.toString();
  } catch {
    return RELEASES_PAGE_URL;
  }
}

function safeAttachmentName(value: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "image").slice(0, 80);
}

function normalizeArtifactFileImportRequest(value: unknown): ArtifactFileImportRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("添付するファイルの情報が不正です。もう一度ファイルをドラッグしてください。");
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.files) || !record.files.length) {
    throw new Error("添付するファイルがありません。ファイルをドラッグしてください。");
  }
  const files = record.files.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("添付するファイルの情報が不正です。もう一度ファイルをドラッグしてください。");
    }
    const fileRecord = entry as Record<string, unknown>;
    const filePath = typeof fileRecord.path === "string" ? fileRecord.path.trim() : "";
    if (!filePath) {
      throw new Error("ファイルの場所を取得できませんでした。エクスプローラーからファイルをドラッグしてください。");
    }
    return {
      path: filePath,
      name: typeof fileRecord.name === "string" && fileRecord.name.trim() ? fileRecord.name.trim() : undefined,
    };
  });
  const themeId = typeof record.themeId === "string" && record.themeId.trim()
    ? record.themeId.trim()
    : null;
  return { files, themeId };
}

function normalizeMarkdownImageAttachment(value: unknown): MarkdownImageAttachmentRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("画像の形式が不正です。画像をコピーし直して、もう一度貼り付けてください。");
  }
  const record = value as Record<string, unknown>;
  const fileName = typeof record.fileName === "string" ? record.fileName : "image";
  const mimeType = typeof record.mimeType === "string" ? record.mimeType.toLowerCase() : "";
  const dataUrl = typeof record.dataUrl === "string" ? record.dataUrl : "";
  if (!IMAGE_MIME_EXTENSIONS[mimeType]) {
    throw new Error("対応していない画像形式です。PNG、JPEG、GIF、WebP、BMPを貼り付けてください。");
  }
  if (!dataUrl.startsWith(`data:${mimeType};base64,`)) {
    throw new Error("画像データを読み取れませんでした。コピーし直して、もう一度貼り付けてください。");
  }
  return { fileName, mimeType, dataUrl };
}

export class WorkspaceService {
  private readonly pendingSnapshots = new Map<string, Workspace>();

  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly userDataPath: string,
  ) {}

  writeClipboard(text: unknown): boolean {
    clipboard.writeText(String(text));
    return true;
  }

  writeClipboardHtml(payload: unknown): boolean {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("コピーするHTMLの形式が不正です。画面を再読み込みして、もう一度試してください。");
    }
    const record = payload as Record<string, unknown>;
    const html = typeof record.html === "string" ? record.html : "";
    const text = typeof record.text === "string" ? record.text : "";
    if (!html.trim() || !text.trim()) {
      throw new Error("コピーする本文がありません。");
    }
    clipboard.write({ html, text });
    return true;
  }

  writeClipboardImage(payloadValue: unknown): boolean {
    if (!payloadValue || typeof payloadValue !== "object" || Array.isArray(payloadValue)) {
      throw new Error("コピーする画像の形式が不正です。画面を再読み込みしてください。");
    }
    const payload = payloadValue as Partial<ImageClipboardRequest>;
    if (typeof payload.dataUrl !== "string" || !payload.dataUrl.startsWith("data:image/png;base64,")) {
      throw new Error("コピーするPNG画像を作成できませんでした。画面を開き直して、もう一度試してください。");
    }
    const image = nativeImage.createFromDataURL(payload.dataUrl);
    if (image.isEmpty()) {
      throw new Error("コピーする画像を読み取れませんでした。画面を開き直して、もう一度試してください。");
    }
    clipboard.clear();
    clipboard.writeImage(image);
    const written = clipboard.readImage();
    const expectedSize = image.getSize();
    const writtenSize = written.getSize();
    if (
      written.isEmpty()
      || writtenSize.width !== expectedSize.width
      || writtenSize.height !== expectedSize.height
    ) {
      throw new Error("Windowsのクリップボードへ画像を書き込めませんでした。クリップボードを使う別アプリを閉じて、もう一度試してください。");
    }
    return true;
  }

  writeClipboardSvg(payloadValue: unknown): MermaidSvgClipboardResult {
    if (!payloadValue || typeof payloadValue !== "object" || Array.isArray(payloadValue)) {
      throw new Error("コピーするSVGの形式が不正です。画面を再読み込みしてください。");
    }
    const payload = payloadValue as Partial<MermaidSvgClipboardRequest>;
    const svg = validateOfficeSvg(payload.svg);
    clipboard.clear();
    clipboard.write({ html: svg, text: "Tasken PowerPoint SVG" });
    clipboard.writeBuffer("image/svg+xml", Buffer.from(svg, "utf8"));
    const formats = clipboard.availableFormats();
    const writtenSvg = clipboard.readBuffer("image/svg+xml").toString("utf8");
    return {
      verified: writtenSvg === svg && formats.some((format) => /svg/i.test(format)),
      formats,
    };
  }

  async openPath(filePathValue: unknown): Promise<{ ok: boolean; error?: string }> {
    if (typeof filePathValue !== "string" || !filePathValue.trim()) {
      throw new Error("開くファイルの場所がありません。");
    }
    const raw = filePathValue.trim();
    // linked Artifact の URL 参照。file プロトコルや未知のスキームは開かない。
    if (/^https?:\/\//i.test(raw)) {
      try {
        await shell.openExternal(raw);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    // UNC / ローカルパス。resolve は相対パス向けで UNC を壊しうるので存在確認を先に。
    const candidates = [raw, path.normalize(raw), path.resolve(raw)];
    const filePath = candidates.find((candidate) => {
      try {
        return fs.existsSync(candidate);
      } catch {
        return false;
      }
    });
    if (!filePath) {
      return { ok: false, error: "ファイルが見つかりません。出力し直すか、出力先を変更してください。" };
    }
    const error = await shell.openPath(filePath);
    return error ? { ok: false, error } : { ok: true };
  }

  private activityCanonicalRootPaths(): Record<string, string> {
    const artifactDirectory = this.repository.getPreference("artifactDirectory");
    return buildActivityRootRegistry({
      artifactDirectory: typeof artifactDirectory === "string" ? artifactDirectory : "",
      themes: this.repository.list("theme", true),
    });
  }

  getActivityCanonicalRootStatus(): Record<string, { status: "ok" | "broken" }> {
    return publicActivityRootStatus(this.activityCanonicalRootPaths(), (root: string) => fs.existsSync(root));
  }

  async openActivityCanonicalRef(value: unknown): Promise<{ ok: boolean; error?: string }> {
    const local = resolveActivityCanonicalLocalPath(value, this.activityCanonicalRootPaths());
    const ref = local.ref;
    if (!ref) return { ok: false, error: "Canonical参照が不正です。" };
    if (!ref.storage_root_id && ref.web_url) return this.openPath(ref.web_url);
    if (!ref.storage_root_id || !ref.relative_path) {
      return { ok: false, error: "開けるCanonical文書の場所がありません。" };
    }

    if (local.status === "outside_root") return { ok: false, error: "Canonical文書の参照先が保存Rootの外にあります。" };
    if (local.status === "ok") return this.openPath(local.path);
    if (ref.web_url) return this.openPath(ref.web_url);
    return { ok: false, error: "Canonical文書が見つかりません。保存先を確認してください。" };
  }

  showItemInFolder(filePathValue: unknown): { ok: boolean; error?: string } {
    if (typeof filePathValue !== "string" || !filePathValue.trim()) {
      throw new Error("表示するファイルの場所がありません。");
    }
    const raw = filePathValue.trim();
    if (/^https?:\/\//i.test(raw)) {
      return { ok: false, error: "URLのフォルダは開けません。パスをコピーしてブラウザやエクスプローラーから開いてください。" };
    }
    const candidates = [raw, path.normalize(raw), path.resolve(raw)];
    const filePath = candidates.find((candidate) => {
      try {
        return fs.existsSync(candidate);
      } catch {
        return false;
      }
    });
    if (!filePath) {
      return { ok: false, error: "ファイルが見つかりません。移動または削除された可能性があります。保存先をSettingsで確認してください。" };
    }
    shell.showItemInFolder(filePath);
    return { ok: true };
  }

  pathExists(filePathValue: unknown): { exists: boolean; kind: "url" | "path"; error?: string } {
    if (typeof filePathValue !== "string" || !filePathValue.trim()) {
      return { exists: false, kind: "path", error: "場所がありません。" };
    }
    const raw = filePathValue.trim();
    if (/^https?:\/\//i.test(raw)) {
      // URL の到達確認は権限・ネットワーク依存のため best-effort で未確認扱い。
      return { exists: false, kind: "url", error: "URLの到達確認は未対応です。" };
    }
    try {
      const candidates = [raw, path.normalize(raw), path.resolve(raw)];
      const exists = candidates.some((candidate) => {
        try {
          return fs.existsSync(candidate);
        } catch {
          return false;
        }
      });
      return { exists, kind: "path" };
    } catch (error) {
      return { exists: false, kind: "path", error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * アプリ内ビューア用にローカルファイルを読む。
   * 画像は data URL、Markdown/テキストは UTF-8 本文。URL や巨大ファイルは拒否する。
   */
  readFilePreview(filePathValue: unknown): FilePreviewReadResult {
    if (typeof filePathValue !== "string" || !filePathValue.trim()) {
      return { ok: false, error: "プレビューするファイルの場所がありません。" };
    }
    const raw = filePathValue.trim();
    if (/^https?:\/\//i.test(raw)) {
      return { ok: false, error: "URLはアプリ内では直接読み込めません。外部で開いてください。" };
    }
    const candidates = [raw, path.normalize(raw), path.resolve(raw)];
    const filePath = candidates.find((candidate) => {
      try {
        return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
      } catch {
        return false;
      }
    });
    if (!filePath) {
      return { ok: false, error: "ファイルが見つかりません。移動または削除された可能性があります。" };
    }
    const extension = path.extname(filePath).toLowerCase();
    const imageMime = PREVIEW_IMAGE_EXT_MIME[extension];
    const textMime = PREVIEW_TEXT_EXT_MIME[extension];
    if (!imageMime && !textMime) {
      return { ok: false, error: "この形式はアプリ内プレビューに未対応です。外部アプリで開いてください。" };
    }
    try {
      const stat = fs.statSync(filePath);
      if (imageMime) {
        if (stat.size > PREVIEW_IMAGE_MAX_BYTES) {
          return { ok: false, error: "画像が大きすぎるためプレビューできません。外部アプリで開いてください。" };
        }
        const bytes = fs.readFileSync(filePath);
        const dataUrl = `data:${imageMime};base64,${bytes.toString("base64")}`;
        return { ok: true, kind: "image", dataUrl, mimeType: imageMime, filePath };
      }
      if (stat.size > PREVIEW_TEXT_MAX_BYTES) {
        return { ok: false, error: "ファイルが大きすぎるためプレビューできません。外部アプリで開いてください。" };
      }
      const text = fs.readFileSync(filePath, "utf8");
      return { ok: true, kind: "text", text, mimeType: textMime || "text/plain", filePath };
    } catch (error) {
      return {
        ok: false,
        error: `ファイルを読めませんでした。${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async chooseDirectory(titleValue: unknown): Promise<{ canceled: boolean; path?: string }> {
    const result = await dialog.showOpenDialog({
      title: typeof titleValue === "string" && titleValue.trim() ? titleValue : "フォルダを選択",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return { canceled: false, path: result.filePaths[0] };
  }

  async chooseFiles(titleValue: unknown): Promise<{ canceled: boolean; files?: Array<{ path: string; name: string }> }> {
    const result = await dialog.showOpenDialog({
      title: typeof titleValue === "string" && titleValue.trim() ? titleValue : "Artifact ファイルを選択",
      properties: ["openFile", "multiSelections"],
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    return {
      canceled: false,
      files: result.filePaths.map((filePath) => ({
        path: filePath,
        name: path.basename(filePath),
      })),
    };
  }

  /**
   * Theme 単位のコンテンツ保存先を解決する。
   * contentKind: artifacts | notes | exports
   */
  private resolveThemeContentDirectory(
    themeIdValue: string | null | undefined,
    contentKind: "artifacts" | "notes" | "exports",
  ): { kind: "needs_directory" } | { kind: "ok"; directory: string } {
    const baseDirectory = String(this.repository.getPreference("artifactDirectory") || "").trim();
    let themeStorageRoot: string | null = null;
    let themeCode: string | null = null;
    let themeId = themeIdValue ? String(themeIdValue).trim() : null;
    if (themeId) {
      const theme = this.repository.get("theme", themeId) || this.repository.get("project", themeId);
      if (theme) {
        themeId = String(theme.id || themeId);
        const root = typeof theme.storage_root === "string" ? theme.storage_root.trim() : "";
        themeStorageRoot = root || null;
        const code = typeof theme.code === "string" ? theme.code.trim() : "";
        themeCode = code || null;
      }
    }
    // .mjs の型推論が弱いため、純ロジック呼び出しは明示した関数型を通す。
    const location = (resolveThemeContentDirectoryParts as (options: {
      artifactDirectory?: string | null;
      themeId?: string | null;
      themeCode?: string | null;
      themeStorageRoot?: string | null;
      contentKind?: "artifacts" | "notes" | "exports";
    }) => { kind: "needs_directory" } | { kind: "ok"; root: string; segments: string[] })({
      artifactDirectory: baseDirectory,
      themeId,
      themeCode,
      themeStorageRoot,
      contentKind,
    });
    if (location.kind === "needs_directory") return { kind: "needs_directory" };
    const directory = path.join(location.root, ...location.segments);
    // Theme名を変えてもフォルダとThemeの対応を見失わないよう、markerを置く（#306）。
    // 生成は遅延・idempotentで、失敗しても保存自体は止めない。
    if (themeId) this.writeThemeFolderManifest(location, themeId);
    return { kind: "ok", directory };
  }

  /**
   * Themeフォルダの直下へ `.tasken-theme.json` を置く（#306）。
   * Theme名の変更でフォルダを黙ってrename・moveしないため、対応の正本をIDで残す。
   */
  private writeThemeFolderManifest(
    location: { root: string; segments: string[] },
    themeId: string,
  ): void {
    try {
      // Theme専用ルートはroot直下、共通ルートは Themes/<folder> がTheme単位のフォルダ。
      const themeFolder = location.segments[0] === "Themes"
        ? path.join(location.root, location.segments[0], location.segments[1] || "")
        : location.segments.length === 1
          ? location.root
          : "";
      if (!themeFolder) return;
      const manifestPath = path.join(themeFolder, THEME_FOLDER_MANIFEST);
      if (fs.existsSync(manifestPath)) return;
      const theme = this.repository.get("theme", themeId) || this.repository.get("project", themeId);
      fs.mkdirSync(themeFolder, { recursive: true });
      fs.writeFileSync(
        manifestPath,
        `${JSON.stringify(buildThemeFolderManifest({ themeId, displayName: String(theme?.name || theme?.title || "") }), null, 2)}\n`,
        "utf8",
      );
    } catch {
      // markerは対応を辿るための補助情報。書けなくても保存自体は成立させる。
    }
  }

  importArtifactFiles(requestValue: unknown): ArtifactFileImportResult {
    const request = normalizeArtifactFileImportRequest(requestValue);
    const location = this.resolveThemeContentDirectory(request.themeId, "artifacts");
    if (location.kind === "needs_directory") return { status: "needs_directory" };
    const directory = location.directory;

    for (const file of request.files) {
      if (!fs.existsSync(file.path) || !fs.statSync(file.path).isFile()) {
        throw new Error(`ドロップしたファイルが見つかりません（${file.name || path.basename(file.path)}）。保存済みのファイルをドラッグしてください。`);
      }
    }

    try {
      fs.mkdirSync(directory, { recursive: true });
    } catch (error) {
      throw new Error(`保存先フォルダを作成できませんでした（${directory}）。SettingsのArtifact保存先、またはThemeの保存ルートを書き込みできる場所に変更してください。${error instanceof Error ? error.message : String(error)}`);
    }

    const files: ImportedArtifactFile[] = [];
    const copiedAt = new Date().toISOString();
    for (const file of request.files) {
      const originalName = file.name || path.basename(file.path);
      const filename = resolveUniqueArtifactFileName(originalName, (candidate: string) => fs.existsSync(path.join(directory, candidate)));
      const storedPath = path.join(directory, filename);
      try {
        // COPYFILE_EXCLで既存ファイルへの上書きを防ぐ（同名回避と二重の安全策）。
        fs.copyFileSync(file.path, storedPath, fs.constants.COPYFILE_EXCL);
      } catch (error) {
        throw new Error(`ファイルをコピーできませんでした（${originalName}）。保存先の空き容量とアクセス権を確認して、もう一度ドラッグしてください。${error instanceof Error ? error.message : String(error)}`);
      }
      files.push({
        filename,
        storedPath,
        originalPath: file.path,
        fileSize: fs.statSync(storedPath).size,
        mimeType: artifactMimeTypeOf(filename),
        fileType: artifactFileTypeOf(filename),
        copiedAt,
        storageMode: "managed",
      });
    }
    return { status: "ok", directory, files };
  }

  materializeArtifactProposal(requestValue: unknown): ArtifactProposalMaterializeResult {
    if (!requestValue || typeof requestValue !== "object" || Array.isArray(requestValue)) {
      throw new Error("Artifact Proposalの形式が不正です。Previewを開き直してください。");
    }
    const request = requestValue as Partial<ArtifactProposalMaterializeRequest>;
    const normalized = validateArtifactProposal({
      title: request.title,
      file_name: request.fileName,
      media_type: request.mediaType,
      content: request.content,
    });
    const location = this.resolveThemeContentDirectory(request.themeId || null, "artifacts");
    if (location.kind === "needs_directory") return { status: "needs_directory" };
    fs.mkdirSync(location.directory, { recursive: true });
    const filename = resolveUniqueArtifactFileName(
      normalized.fileName,
      (candidate: string) => fs.existsSync(path.join(location.directory, candidate)),
    );
    const storedPath = path.join(location.directory, filename);
    fs.writeFileSync(storedPath, normalized.content, { encoding: "utf8", flag: "wx" });
    return {
      status: "ok",
      directory: location.directory,
      file: {
        filename,
        storedPath,
        originalPath: "",
        fileSize: fs.statSync(storedPath).size,
        mimeType: normalized.mediaType,
        fileType: artifactFileTypeOf(filename),
        copiedAt: new Date().toISOString(),
        storageMode: "managed",
      },
    };
  }

  reload(sender: WebContents): boolean {
    sender.reload();
    return true;
  }

  async checkForUpdates(): Promise<AppUpdateCheckResult> {
    const currentVersion = app.getVersion();
    try {
      const response = await fetch(RELEASES_API_URL, {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": `Tasken/${currentVersion}`,
        },
      });
      if (!response.ok) {
        throw new Error(`GitHub Releaseを確認できませんでした。HTTP ${response.status}`);
      }

      const release = await response.json() as GitHubLatestRelease;
      const latestVersion = String(release.tag_name || "").replace(/^v/i, "");
      if (!latestVersion) throw new Error("最新バージョンを読み取れませんでした。");

      const releaseUrl = safeReleaseUrl(release.html_url);
      return {
        status: compareVersions(latestVersion, currentVersion) > 0 ? "available" : "current",
        currentVersion,
        latestVersion,
        releaseName: release.name,
        releaseUrl,
        publishedAt: release.published_at,
      };
    } catch (error) {
      return {
        status: "error",
        currentVersion,
        releaseUrl: RELEASES_PAGE_URL,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async openReleasePage(url?: string): Promise<boolean> {
    await shell.openExternal(safeReleaseUrl(url));
    return true;
  }

  getMcpBridgeInfo(): McpBridgeInfo {
    const inboxPath = path.join(this.userDataPath, "mcp-inbox");
    fs.mkdirSync(inboxPath, { recursive: true });
    const command = process.execPath;
    const args = app.isPackaged
      ? [path.join(process.resourcesPath, "mcp", "server.mjs")]
      : [path.join(app.getAppPath(), "scripts", "mcp-server.mjs")];
    const env = { ELECTRON_RUN_AS_NODE: "1" };
    const config = {
      mcpServers: {
        tasken: {
          command,
          args,
          env,
        },
      },
    };
    return {
      command,
      args,
      configJson: JSON.stringify(config, null, 2),
      inboxPath,
      pendingFileCount: fs.readdirSync(inboxPath).filter((name) => name.endsWith(".json")).length,
      packaged: app.isPackaged,
    };
  }

  async exportSnapshot(): Promise<{ canceled: boolean; filePath?: string }> {
    const date = localDateIso();
    const result = await dialog.showSaveDialog({
      title: "Workspace Snapshotを書き出す",
      defaultPath: `workspace_export_${date}.zip`,
      filters: [{ name: "Tasken Snapshot", extensions: ["zip"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    createSnapshot(this.repository.loadWorkspace(true)).writeZip(result.filePath);
    return { canceled: false, filePath: result.filePath };
  }

  async inspectSnapshot() {
    const result = await dialog.showOpenDialog({
      title: "Workspace Snapshotを読み込む",
      properties: ["openFile"],
      filters: [{ name: "Tasken Snapshot", extensions: ["zip"] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const parsed = readSnapshot(result.filePaths[0]) as {
      manifest: Record<string, unknown>;
      workspace: Workspace;
    };
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.pendingSnapshots.set(token, parsed.workspace);
    return {
      canceled: false,
      token,
      manifest: parsed.manifest,
      changes: this.repository.previewSnapshot(parsed.workspace),
    };
  }

  async exportMarkdownFile(requestValue: unknown): Promise<MarkdownFileExportResult> {
    const request = normalizeMarkdownFileExportRequest(requestValue);
    let directory = request.directory?.trim() || "";
    // 初回など directory 未設定時は Theme の Notes/ を既定にする。
    if (!directory && !request.chooseDirectory) {
      const themeDir = this.resolveThemeContentDirectory(request.themeId, "notes");
      if (themeDir.kind === "ok") directory = themeDir.directory;
    }
    if (request.chooseDirectory || !directory) {
      const themeDefault = this.resolveThemeContentDirectory(request.themeId, "notes");
      const defaultPath = directory || (themeDefault.kind === "ok" ? themeDefault.directory : undefined);
      const result = await dialog.showOpenDialog({
        title: "Markdown出力先フォルダを選択",
        defaultPath: defaultPath || undefined,
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || !result.filePaths[0]) return { canceled: true };
      directory = result.filePaths[0];
    }
    fs.mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, safeMarkdownFileName(request.fileName || request.title));
    fs.writeFileSync(filePath, request.content, "utf8");
    return {
      canceled: false,
      filePath,
      directory,
      exportedAt: new Date().toISOString(),
    };
  }

  async exportMarkdownPdf(requestValue: unknown): Promise<MarkdownPdfExportResult> {
    const request = normalizeMarkdownPdfExportRequest(requestValue);
    let directory = request.directory?.trim() || "";
    // PDF は都度選択する。既定の保存先はOSのフォルダ選択ダイアログに任せる。
    if (request.chooseDirectory || !directory) {
      const defaultPath = directory || undefined;
      const result = await dialog.showOpenDialog({
        title: "PDF出力先フォルダを選択",
        defaultPath: defaultPath || undefined,
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || !result.filePaths[0]) return { canceled: true };
      directory = result.filePaths[0];
    }
    fs.mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, safePdfFileName(request.fileName || request.title || "markdown-document"));

    // data: ページからは tasken-attachment を読めないため、一時 HTML + 相対パス画像で printToPDF する。
    const tempRoot = fs.mkdtempSync(path.join(app.getPath("temp"), "tasken-pdf-"));
    const assetDirectory = path.join(tempRoot, "images");
    const prepared = prepareMarkdownHtmlForPdf(
      request.html,
      path.join(this.userDataPath, "attachments", "markdown-images"),
      { assetDirectory },
    );
    const warnings = [...prepared.warnings];
    const tempHtmlPath = path.join(tempRoot, "document.html");
    fs.writeFileSync(tempHtmlPath, prepared.html, "utf8");

    const pdfWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        // 画像ロード完了待ちのため最小限の JS を許可する（node は無効）
        javascript: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });

    try {
      await pdfWindow.loadFile(tempHtmlPath);
      // 画像とフォントを待ち、印刷でスクロールできない横長要素をA4本文幅へ収める。
      const layoutReport = await pdfWindow.webContents.executeJavaScript(`
        (async () => {
          const images = Array.from(document.images || []);
          await Promise.all(images.map((img) => {
            if (img.complete) return Promise.resolve();
            return new Promise((resolve) => {
              const done = () => resolve();
              img.addEventListener("load", done, { once: true });
              img.addEventListener("error", done, { once: true });
              setTimeout(done, 8000);
            });
          }));
          if (document.fonts?.ready) await document.fonts.ready;

          let fittedMathCount = 0;
          for (const block of document.querySelectorAll(".md-math-block")) {
            const math = block.querySelector(".katex-display > .katex");
            if (!(math instanceof HTMLElement)) continue;
            const visibleMath = math.querySelector(".katex-html");
            if (!(visibleMath instanceof HTMLElement)) continue;
            const style = getComputedStyle(block);
            const availableWidth = block.clientWidth
              - Number.parseFloat(style.paddingLeft || "0")
              - Number.parseFloat(style.paddingRight || "0");
            const bases = Array.from(visibleMath.querySelectorAll(":scope > .base"));
            if (bases.length > 1) {
              visibleMath.style.whiteSpace = "normal";
              bases.slice(1).forEach((base) => base.before(document.createElement("wbr")));
            }
            const widestBase = bases.reduce(
              (width, base) => Math.max(width, base.getBoundingClientRect().width),
              0,
            );
            if (availableWidth > 0 && widestBase > availableWidth) {
              math.style.zoom = String((availableWidth * 0.98) / widestBase);
              fittedMathCount += 1;
            }
          }

          for (const svg of document.querySelectorAll(".md-mermaid-svg svg")) {
            svg.style.width = "auto";
            svg.style.maxWidth = "100%";
            svg.style.height = "auto";
            svg.style.maxHeight = "205mm";
            svg.style.margin = "0 auto";
          }

          return {
            images: images.map((img) => ({
              ok: Boolean(img.naturalWidth > 0),
              src: String(img.currentSrc || img.src || "").slice(0, 120),
            })),
            mermaidErrorCount: document.querySelectorAll(".md-mermaid-block.has-render-error").length,
            fittedMathCount,
          };
        })()
      `) as {
        images?: Array<{ ok: boolean; src: string }>;
        mermaidErrorCount?: number;
        fittedMathCount?: number;
      };
      for (const image of layoutReport?.images || []) {
        if (!image.ok) {
          warnings.push(`PDF内で画像を描画できませんでした: ${image.src || "(不明)"}`);
        }
      }
      if (layoutReport?.mermaidErrorCount) {
        warnings.push(`Mermaidを描画できない箇所が${layoutReport.mermaidErrorCount}件あります。コードを確認してください。`);
      }

      const pdf = await pdfWindow.webContents.printToPDF({
        pageSize: "A4",
        printBackground: true,
      });
      fs.writeFileSync(filePath, pdf);
    } finally {
      if (!pdfWindow.isDestroyed()) {
        pdfWindow.close();
      }
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch {
        // 一時ディレクトリ掃除失敗は PDF 成果物に影響しないため握りつぶす
      }
    }

    return {
      canceled: false,
      filePath,
      directory,
      exportedAt: new Date().toISOString(),
      warnings: warnings.length ? warnings : undefined,
    };
  }

  saveMarkdownImageAttachment(requestValue: unknown): MarkdownImageAttachmentResult {
    const request = normalizeMarkdownImageAttachment(requestValue);
    const encoded = request.dataUrl.slice(`data:${request.mimeType};base64,`.length);
    const buffer = Buffer.from(encoded, "base64");
    if (!buffer.length || buffer.length > MARKDOWN_IMAGE_MAX_BYTES) {
      throw new Error("画像サイズが大きすぎます。12MB以下の画像を貼り付けてください。");
    }

    const id = randomUUID();
    const extension = IMAGE_MIME_EXTENSIONS[request.mimeType];
    const storageFileName = `${id}.${extension}`;
    const displayName = safeAttachmentName(request.fileName).replace(/\.[^.]+$/, "") || "image";
    const attachmentDirectory = path.join(this.userDataPath, "attachments", "markdown-images");
    fs.mkdirSync(attachmentDirectory, { recursive: true });
    fs.writeFileSync(path.join(attachmentDirectory, storageFileName), buffer);

    return {
      id,
      fileName: `${displayName}.${extension}`,
      mimeType: request.mimeType,
      url: `tasken-attachment://local/${encodeURIComponent(storageFileName)}/${encodeURIComponent(displayName)}`,
    };
  }

  async exportSketch(requestValue: unknown): Promise<SketchExportResult> {
    if (!requestValue || typeof requestValue !== "object" || Array.isArray(requestValue)) {
      throw new Error("Sketch出力の内容が不正です。画面を再読み込みしてください。");
    }
    const request = requestValue as Partial<SketchExportRequest>;
    if (!["png", "svg", "markdown"].includes(String(request.format))) {
      throw new Error("Sketchの出力形式が不正です。");
    }
    if (typeof request.dataUrl !== "string" || !request.dataUrl.startsWith("data:image/png;base64,")) {
      throw new Error("Sketch画像を作成できませんでした。");
    }
    if (typeof request.svg !== "string" || !request.svg.startsWith("<svg")) {
      throw new Error("SketchのSVGを作成できませんでした。");
    }
    if (typeof request.markdown !== "string" || !request.markdown.trim()) {
      throw new Error("SketchのMarkdownを作成できませんでした。");
    }

    const format = request.format as "png" | "svg" | "markdown";
    const extension = format === "markdown" ? "md" : format;
    const safeTitle = safeAttachmentName(typeof request.title === "string" ? request.title : "Sketch");
    const location = this.resolveThemeContentDirectory(request.themeId || null, "exports");
    const directory = location.kind === "ok" ? location.directory : app.getPath("documents");
    if (location.kind === "ok") fs.mkdirSync(directory, { recursive: true });
    const result = await dialog.showSaveDialog({
      title: `Sketchを${extension.toUpperCase()}で書き出す`,
      defaultPath: path.join(directory, `${safeTitle}.${extension}`),
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };

    if (format === "png") {
      const buffer = Buffer.from(request.dataUrl.slice("data:image/png;base64,".length), "base64");
      fs.writeFileSync(result.filePath, buffer);
      return { canceled: false, filePath: result.filePath };
    }
    if (format === "svg") {
      fs.writeFileSync(result.filePath, request.svg, "utf8");
      return { canceled: false, filePath: result.filePath };
    }

    const companionFilePath = path.join(path.dirname(result.filePath), `${path.basename(result.filePath, ".md")}.png`);
    const buffer = Buffer.from(request.dataUrl.slice("data:image/png;base64,".length), "base64");
    fs.writeFileSync(companionFilePath, buffer);
    const markdown = request.markdown.replace("{{SKETCH_IMAGE}}", path.basename(companionFilePath));
    fs.writeFileSync(result.filePath, markdown, "utf8");
    return { canceled: false, filePath: result.filePath, companionFilePath };
  }

  async exportSlideTimeline(requestValue: unknown): Promise<SlideTimelineExportResult> {
    if (!requestValue || typeof requestValue !== "object" || Array.isArray(requestValue)) {
      throw new Error("スライド用タイムラインの出力内容が不正です。画面を再読み込みしてください。");
    }
    const request = requestValue as Partial<SlideTimelineExportRequest>;
    if (typeof request.svg !== "string" || !request.svg.startsWith("<svg")) {
      throw new Error("タイムラインのSVGを作成できませんでした。期間と項目を確認してください。");
    }
    const safeTitle = safeAttachmentName(typeof request.title === "string" ? request.title : "Timeline");
    const result = await dialog.showSaveDialog({
      title: "スライド用タイムラインをSVGで書き出す",
      defaultPath: path.join(app.getPath("documents"), `${safeTitle || "Timeline"}.svg`),
      filters: [{ name: "SVG", extensions: ["svg"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, request.svg, "utf8");
    return { canceled: false, filePath: result.filePath };
  }

  async exportMermaidSvg(requestValue: unknown): Promise<MermaidPowerPointSvgExportResult> {
    if (!requestValue || typeof requestValue !== "object" || Array.isArray(requestValue)) {
      throw new Error("MermaidのSVG出力内容が不正です。画面を再読み込みしてください。");
    }
    const request = requestValue as Partial<MermaidPowerPointSvgExportRequest>;
    const svg = validateOfficeSvg(request.svg);
    const safeTitle = safeAttachmentName(typeof request.title === "string" ? request.title : "Mermaid");
    const result = await dialog.showSaveDialog({
      title: "MermaidをPowerPoint用SVGで書き出す",
      defaultPath: path.join(app.getPath("documents"), `${safeTitle || "Mermaid"}.svg`),
      filters: [{ name: "SVG", extensions: ["svg"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, svg, "utf8");
    return { canceled: false, filePath: result.filePath };
  }

  async exportMermaidPptx(requestValue: unknown): Promise<MermaidPowerPointPptxExportResult> {
    if (!requestValue || typeof requestValue !== "object" || Array.isArray(requestValue)) {
      throw new Error("MermaidのPPTX出力内容が不正です。画面を再読み込みしてください。");
    }
    const request = requestValue as Partial<MermaidPowerPointPptxExportRequest>;
    const diagram = validateMermaidPptxDiagram(request.diagram);
    const safeTitle = safeAttachmentName(typeof request.title === "string" ? request.title : "Mermaid");
    const result = await dialog.showSaveDialog({
      title: "Mermaidを編集可能なPowerPointで書き出す",
      defaultPath: path.join(app.getPath("documents"), `${safeTitle || "Mermaid"}.pptx`),
      filters: [{ name: "PowerPoint", extensions: ["pptx"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true, warnings: diagram.warnings };
    const buffer = await buildMermaidPptxBuffer(diagram, safeTitle || "Mermaid");
    fs.writeFileSync(result.filePath, buffer);
    return { canceled: false, filePath: result.filePath, warnings: diagram.warnings };
  }

  applySnapshot(token: string, decisions: SnapshotDecisions): Workspace {
    const snapshot = this.pendingSnapshots.get(token);
    if (!snapshot) {
      throw new Error("Importプレビューの有効期限が切れました。もう一度Snapshotを選択してください。");
    }
    const result = this.repository.applySnapshot(snapshot, decisions, snapshot.plan_revisions || []);
    this.pendingSnapshots.delete(token);
    return result as Workspace;
  }
}
