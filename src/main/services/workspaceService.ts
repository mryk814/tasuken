import { app, clipboard, dialog, shell, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { MarkdownImageAttachmentRequest, MarkdownImageAttachmentResult } from "../../shared/attachments";
import type { AppUpdateCheckResult } from "../../shared/ipc/contracts";
import type { Workspace } from "../../shared/types/workspace";
import type { WordExportRequest, WordExportResult } from "../../shared/wordExport";
import { createSnapshot, readSnapshot } from "./snapshotService.mjs";
import { exportMarkdownNoteToWord } from "./wordExportService";

type SnapshotDecisions = Record<string, string>;

const MARKDOWN_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
const RELEASES_API_URL = "https://api.github.com/repos/mryk814/tasuken/releases/latest";
const RELEASES_PAGE_URL = "https://github.com/mryk814/tasuken/releases/latest";
const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
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
}

function localDateIso(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeWordExportRequest(value: unknown): WordExportRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Word出力の内容が不正です。画面を再読み込みして、もう一度試してください。");
  }
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title : "";
  const bodyMarkdown = typeof record.bodyMarkdown === "string" ? record.bodyMarkdown : "";
  if (!title.trim()) throw new Error("Word出力するNoteのタイトルがありません。");
  return {
    title,
    bodyMarkdown,
    themeName: typeof record.themeName === "string" ? record.themeName : null,
    directory: typeof record.directory === "string" ? record.directory : null,
    chooseDirectory: Boolean(record.chooseDirectory),
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

  async openPath(filePathValue: unknown): Promise<{ ok: boolean; error?: string }> {
    if (typeof filePathValue !== "string" || !filePathValue.trim()) {
      throw new Error("開くファイルの場所がありません。");
    }
    const filePath = path.resolve(filePathValue);
    if (!fs.existsSync(filePath)) {
      return { ok: false, error: "ファイルが見つかりません。出力し直すか、出力先を変更してください。" };
    }
    const error = await shell.openPath(filePath);
    return error ? { ok: false, error } : { ok: true };
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

  async exportMarkdownNoteToWord(requestValue: unknown): Promise<WordExportResult> {
    const request = normalizeWordExportRequest(requestValue);
    let directory = request.directory?.trim() || "";
    if (request.chooseDirectory || !directory) {
      const result = await dialog.showOpenDialog({
        title: "Word出力先フォルダを選択",
        defaultPath: directory || undefined,
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || !result.filePaths[0]) return { canceled: true };
      directory = result.filePaths[0];
    }
    return exportMarkdownNoteToWord(request, directory);
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
