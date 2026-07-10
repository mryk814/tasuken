import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import {
  IconDotsVertical,
  IconExternalLink,
  IconFile,
  IconFileSpreadsheet,
  IconFileText,
  IconFileTypePdf,
  IconFileZip,
  IconLink,
  IconMarkdown,
  IconPhoto,
  IconPlus,
  IconPresentation,
} from "@tabler/icons-react";

import {
  artifactCanPromoteToManaged,
  artifactCanShowInFolder,
  artifactCopyTarget,
  artifactFileTypeFromName,
  artifactFolderPath,
  artifactOpenTarget,
  displayNameFromTarget,
  extractHttpUrls,
  extractUrlsFromDataTransfer,
  inferArtifactLinkType,
  isHttpUrl,
  resolveArtifactStorageMode as resolveStorageModeShared,
} from "../../../../../shared/artifactLinks.mjs";
import { workspaceApi } from "../../../services/workspaceApi";
import {
  ARTIFACT_LINK_STATUS_LABELS,
  ARTIFACT_LINK_TYPE_LABELS,
  ARTIFACT_SOURCE_TYPE_LABELS,
  ARTIFACT_STORAGE_MODE_LABELS,
} from "../domain-model/labels";
import type {
  Artifact,
  ArtifactLinkStatus,
  ArtifactLinkType,
  ArtifactSourceType,
  ArtifactStorageMode,
  OpenDrawer,
  RemoveEntity,
  SaveEntities,
  SaveOperation,
  WorkspaceData,
} from "../types";
import { uuid } from "../lib/format";
import { ContextMenu, type ContextMenuItem } from "./common";

const SPREADSHEET_TYPES = new Set(["xlsx", "xls", "csv", "tsv"]);
const IMAGE_TYPES = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
const MARKDOWN_TYPES = new Set(["md", "markdown"]);
const PRESENTATION_TYPES = new Set(["pptx", "ppt"]);
const ARCHIVE_TYPES = new Set(["zip", "7z"]);
const TEXT_TYPES = new Set(["txt", "docx", "doc", "json", "html"]);
const PDF_TYPES = new Set(["pdf"]);

export type ArtifactOpenMode = "external" | "image" | "markdown" | "file";

export function artifactFileCategory(fileType?: string): ArtifactOpenMode {
  const type = (fileType || "").toLowerCase();
  if (IMAGE_TYPES.has(type)) return "image";
  if (MARKDOWN_TYPES.has(type)) return "markdown";
  if (SPREADSHEET_TYPES.has(type) || PDF_TYPES.has(type) || PRESENTATION_TYPES.has(type)) return "external";
  return "file";
}

export function artifactOpenLabel(fileType?: string): string {
  const mode = artifactFileCategory(fileType);
  if (mode === "external") return "外部で開く";
  if (mode === "image" || mode === "markdown") return "プレビュー";
  return "開く";
}

export function artifactOpenHint(fileType?: string): string {
  const mode = artifactFileCategory(fileType);
  if (mode === "external") return "Excel / PDF / PowerPoint などは関連付けられた外部アプリで開きます。";
  if (mode === "image") return "画像を確認します（現状は関連付けアプリで開きます。アプリ内ビューアは #130）。";
  if (mode === "markdown") return "Markdownを確認します（現状は関連付けアプリで開きます。アプリ内ビューアは #130）。";
  return "関連付けられたアプリで開きます。";
}

export function resolveArtifactStorageMode(artifact: Artifact): ArtifactStorageMode {
  return resolveStorageModeShared(artifact.storage_mode);
}

export function artifactStorageModeLabel(artifact: Artifact): string {
  return ARTIFACT_STORAGE_MODE_LABELS[resolveArtifactStorageMode(artifact)] || "Tasken管理";
}

export function artifactTypeBadge(fileType?: string): string {
  const type = (fileType || "file").toUpperCase();
  return type.slice(0, 8);
}

export function ArtifactFileIcon({ fileType }: { fileType?: string }) {
  const type = (fileType || "").toLowerCase();
  const size = 18;
  if (SPREADSHEET_TYPES.has(type)) return <IconFileSpreadsheet size={size} />;
  if (IMAGE_TYPES.has(type)) return <IconPhoto size={size} />;
  if (PDF_TYPES.has(type)) return <IconFileTypePdf size={size} />;
  if (MARKDOWN_TYPES.has(type)) return <IconMarkdown size={size} />;
  if (PRESENTATION_TYPES.has(type)) return <IconPresentation size={size} />;
  if (ARCHIVE_TYPES.has(type)) return <IconFileZip size={size} />;
  if (TEXT_TYPES.has(type)) return <IconFileText size={size} />;
  return <IconFile size={size} />;
}

export function formatArtifactFileSize(bytes?: number): string {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size < 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function resolveArtifactSourceLabel(artifact: Artifact, data: WorkspaceData): string {
  const sourceType = artifact.source_type;
  const sourceId = artifact.source_id;
  if (sourceType === "task") {
    const task = (data.tasks || []).find((entry) => entry.id === sourceId);
    return task ? String(task.title || "タスク") : ARTIFACT_SOURCE_TYPE_LABELS.task;
  }
  if (sourceType === "note" || sourceType === "report") {
    const note = (data.notes || []).find((entry) => entry.id === sourceId);
    return note ? String(note.title || "メモ") : ARTIFACT_SOURCE_TYPE_LABELS[sourceType];
  }
  if (sourceType === "chat_ref") {
    const resource = [...(data.resources || []), ...(data.links || [])].find((entry) => entry.id === sourceId);
    return resource ? String(resource.title || resource.url || "Chat参照") : ARTIFACT_SOURCE_TYPE_LABELS.chat_ref;
  }
  if (sourceType === "theme") {
    const theme = (data.themes || []).find((entry) => entry.id === sourceId);
    return theme ? String(theme.name || "Theme") : ARTIFACT_SOURCE_TYPE_LABELS.theme;
  }
  return ARTIFACT_SOURCE_TYPE_LABELS[sourceType] || sourceType;
}

export function openArtifactSource(artifact: Artifact, data: WorkspaceData, openDrawer: OpenDrawer): boolean {
  const sourceType = artifact.source_type;
  const sourceId = artifact.source_id;
  if (sourceType === "task") {
    const task = (data.tasks || []).find((entry) => entry.id === sourceId);
    if (!task) return false;
    const schedule = (data.schedules || []).find((entry) => entry.owner_type === "task" && entry.owner_id === sourceId);
    openDrawer({ type: "task", entity: { ...task, _schedule: schedule } as Record<string, unknown> });
    return true;
  }
  if (sourceType === "note" || sourceType === "report") {
    const note = (data.notes || []).find((entry) => entry.id === sourceId);
    if (!note) return false;
    openDrawer({ type: "note", entity: note });
    return true;
  }
  if (sourceType === "chat_ref") {
    const resource = [...(data.resources || []), ...(data.links || [])].find((entry) => entry.id === sourceId);
    if (!resource) return false;
    openDrawer({ type: "resource", entity: resource });
    return true;
  }
  if (sourceType === "theme") {
    const theme = (data.themes || []).find((entry) => entry.id === sourceId);
    if (!theme) return false;
    openDrawer({ type: "theme", mode: "edit", entity: theme });
    return true;
  }
  return false;
}

export function themeNameOf(artifact: Artifact, data: WorkspaceData): string {
  if (!artifact.theme_id) return "未設定";
  return (data.themes || []).find((theme) => theme.id === artifact.theme_id)?.name || "未設定";
}

/** 2行目メタ。空・未設定は出さない。 */
export function artifactCardMetaParts(artifact: Artifact, data?: WorkspaceData, options?: { includeSource?: boolean }): string[] {
  const parts: string[] = [];
  const size = formatArtifactFileSize(artifact.file_size);
  if (size) parts.push(size);
  if (resolveArtifactStorageMode(artifact) === "linked" && artifact.link_type) {
    const linkLabel = ARTIFACT_LINK_TYPE_LABELS[artifact.link_type] || artifact.link_type;
    if (linkLabel) parts.push(linkLabel);
  }
  if (data) {
    const theme = themeNameOf(artifact, data);
    if (theme && theme !== "未設定") parts.push(theme);
  }
  if (options?.includeSource && data) {
    const sourceLabel = resolveArtifactSourceLabel(artifact, data);
    const sourceType = ARTIFACT_SOURCE_TYPE_LABELS[artifact.source_type] || artifact.source_type;
    if (sourceLabel) parts.push(`${sourceType}: ${sourceLabel}`);
  }
  return parts;
}

export async function showArtifactInFolder(
  artifact: Artifact,
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void,
): Promise<void> {
  if (!artifactCanShowInFolder(artifact)) {
    setToast("この Artifact ではフォルダを開けません。URL の場合はパス/URLをコピーしてください。", "info");
    return;
  }
  const result = await workspaceApi.showItemInFolder(artifactFolderPath(artifact));
  if (!result.ok) setToast(`フォルダを開けませんでした。${result.error || ""}`, "danger");
}

export async function copyArtifactPath(
  artifact: Artifact,
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void,
): Promise<void> {
  const target = artifactCopyTarget(artifact);
  if (!target) {
    setToast("コピーできるパス/URLがありません。", "warning");
    return;
  }
  await workspaceApi.copyText(target);
  setToast(isHttpUrl(target) ? "URLをコピーしました。" : "パスをコピーしました。", "success");
}

export async function openArtifactFile(
  artifact: Artifact,
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void,
): Promise<void> {
  const target = artifactOpenTarget(artifact);
  if (!target) {
    setToast("開く場所がありません。参照先を確認してください。", "danger");
    return;
  }
  const result = await workspaceApi.openPath(target);
  if (!result.ok) {
    setToast(`ファイルを開けませんでした。${result.error || ""}`, "danger");
    return;
  }
  markArtifactOpened(artifact.id);
}

export async function checkArtifactLink(
  artifact: Artifact,
  saveEntities: SaveEntities,
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void,
): Promise<void> {
  if (resolveArtifactStorageMode(artifact) !== "linked") {
    setToast("リンク確認は linked Artifact 向けです。", "info");
    return;
  }
  const target = artifactOpenTarget(artifact);
  if (!target) {
    setToast("参照先が空です。", "warning");
    return;
  }
  const checkedAt = new Date().toISOString();
  if (isHttpUrl(target)) {
    // URL は権限・ネットワーク依存のため自動到達確認しない。
    await saveEntities([{
      action: "save",
      type: "artifact",
      entity: {
        ...artifact,
        link_status: "unknown" as ArtifactLinkStatus,
        last_checked_at: checkedAt,
      },
    }], "URLの到達確認は未対応のため、状態を未確認にしました。");
    return;
  }
  const result = await workspaceApi.pathExists(target);
  const status: ArtifactLinkStatus = result.exists ? "ok" : "broken";
  await saveEntities([{
    action: "save",
    type: "artifact",
    entity: {
      ...artifact,
      link_status: status,
      last_checked_at: checkedAt,
    },
  }], result.exists ? "参照先に到達できました。" : "参照先が見つかりませんでした（リンク切れ）。");
}

export async function promoteArtifactToManaged(
  artifact: Artifact,
  saveEntities: SaveEntities,
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void,
  onNeedsDirectory?: () => void,
): Promise<void> {
  if (!artifactCanPromoteToManaged(artifact)) {
    setToast("URLリンクは自動コピーできません。ファイルを入手してから管理に追加してください。", "info");
    return;
  }
  const target = String(artifact.target || "").trim();
  try {
    const result = await workspaceApi.importArtifactFiles({
      files: [{ path: target, name: artifact.filename }],
    });
    if (result.status === "needs_directory") {
      onNeedsDirectory?.();
      setToast("Artifact保存先が未設定です。「保存先を選ぶ」から設定してください。", "info");
      return;
    }
    const file = result.files[0];
    if (!file) {
      setToast("コピー結果を取得できませんでした。", "danger");
      return;
    }
    await saveEntities([{
      action: "save",
      type: "artifact",
      entity: {
        ...artifact,
        storage_mode: "managed",
        stored_path: file.storedPath,
        original_path: target,
        copied_at: file.copiedAt || new Date().toISOString(),
        filename: file.filename,
        file_type: file.fileType,
        mime_type: file.mimeType,
        file_size: file.fileSize,
        link_type: null,
        target: null,
        link_status: null,
        last_checked_at: null,
      },
    }], "Tasken管理フォルダへコピーしました。");
  } catch (error) {
    setToast(`Tasken管理へコピーできませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
  }
}

export function isPathLikeArtifactLink(artifact: Artifact): boolean {
  const currentType = (artifact.link_type || inferArtifactLinkType(String(artifact.target || ""))) as ArtifactLinkType;
  return currentType === "local_path" || currentType === "shared_path"
    || (currentType === "onedrive" && !isHttpUrl(String(artifact.target || "")));
}

export async function applyLinkedArtifactTarget(
  artifact: Artifact,
  nextTarget: string,
  saveEntities: SaveEntities,
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void,
  options?: { displayName?: string },
): Promise<boolean> {
  const target = nextTarget.trim();
  if (!target) {
    setToast("参照先が空です。", "warning");
    return false;
  }
  if (isHttpUrl(target) === false && !target.includes("\\") && !target.includes("/")) {
    setToast("URL またはファイルパスを指定してください。", "warning");
    return false;
  }
  const nextName = options?.displayName || displayNameFromTarget(target, artifact.filename);
  const linkType = inferArtifactLinkType(target) as ArtifactLinkType;
  const fileType = artifactFileTypeFromName(nextName);
  try {
    await saveEntities([{
      action: "save",
      type: "artifact",
      entity: {
        ...artifact,
        target,
        link_type: linkType,
        filename: nextName,
        title: nextName.replace(/\.[^.]+$/, "") || artifact.title,
        file_type: fileType,
        link_status: "unknown",
        last_checked_at: null,
      },
    }], "参照先を更新しました。");
    return true;
  } catch (error) {
    setToast(`参照先を変更できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    return false;
  }
}

export async function retargetLinkedArtifact(
  artifact: Artifact,
  saveEntities: SaveEntities,
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void,
  options?: { onNeedUrlInput?: (artifact: Artifact) => void },
): Promise<void> {
  if (resolveArtifactStorageMode(artifact) !== "linked") {
    setToast("参照先の変更は linked Artifact 向けです。", "info");
    return;
  }
  // Electron では OS のプロンプトダイアログが使えない。URL 系はインライン入力へ。
  if (!isPathLikeArtifactLink(artifact)) {
    options?.onNeedUrlInput?.(artifact);
    return;
  }
  try {
    const picked = await workspaceApi.chooseFiles("新しい参照ファイルを選択");
    if (picked.canceled || !picked.files?.length) return;
    const nextTarget = picked.files[0].path;
    const nextName = picked.files[0].name || displayNameFromTarget(nextTarget, artifact.filename);
    await applyLinkedArtifactTarget(artifact, nextTarget, saveEntities, setToast, { displayName: nextName });
  } catch (error) {
    setToast(`参照先を変更できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
  }
}

export function ArtifactCard({
  artifact,
  data,
  openDrawer,
  removeEntity,
  saveEntities,
  setToast,
  showSource = false,
  onOpened,
  onNeedsDirectory,
}: {
  artifact: Artifact;
  data?: WorkspaceData;
  openDrawer?: OpenDrawer;
  removeEntity: RemoveEntity;
  saveEntities?: SaveEntities;
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
  showSource?: boolean;
  onOpened?: () => void;
  onNeedsDirectory?: () => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [urlEdit, setUrlEdit] = useState<string | null>(null);
  const urlEditRef = useRef<HTMLInputElement | null>(null);
  const metaParts = artifactCardMetaParts(artifact, data, { includeSource: showSource });
  const mode = resolveArtifactStorageMode(artifact);
  const pathTitle = artifactOpenTarget(artifact) || artifact.filename;
  const linkStatus = artifact.link_status;
  const showLinkStatus = mode === "linked" && linkStatus && linkStatus !== "unknown" && linkStatus !== "ok";

  useEffect(() => {
    if (urlEdit != null) urlEditRef.current?.focus();
  }, [urlEdit != null]);

  function openMenu(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ x: rect.right - 8, y: rect.bottom + 4 });
  }

  const menuItems: ContextMenuItem[] = [];
  if (artifactCanShowInFolder(artifact)) {
    menuItems.push({
      label: "フォルダを開く",
      onSelect: () => { void showArtifactInFolder(artifact, setToast); },
    });
  }
  menuItems.push({
    label: isHttpUrl(artifactCopyTarget(artifact)) ? "URLをコピー" : "パスをコピー",
    onSelect: () => { void copyArtifactPath(artifact, setToast); },
  });
  if (showSource && openDrawer && data) {
    menuItems.push({
      label: "元の場所へ",
      onSelect: () => {
        if (!openArtifactSource(artifact, data, openDrawer)) {
          setToast("元の場所が見つかりませんでした。削除済みの可能性があります。", "warning");
        }
      },
    });
  }
  if (mode === "linked" && saveEntities) {
    menuItems.push({
      label: "リンクを確認",
      onSelect: () => { void checkArtifactLink(artifact, saveEntities, setToast); },
    });
    menuItems.push({
      label: "参照先を変更",
      onSelect: () => {
        void retargetLinkedArtifact(artifact, saveEntities, setToast, {
          onNeedUrlInput: (entry) => setUrlEdit(String(entry.target || "")),
        });
      },
    });
    if (artifactCanPromoteToManaged(artifact)) {
      menuItems.push({
        label: "Tasken管理へコピー",
        onSelect: () => { void promoteArtifactToManaged(artifact, saveEntities, setToast, onNeedsDirectory); },
      });
    }
  }
  menuItems.push({
    label: "削除",
    tone: "danger",
    onSelect: () => removeEntity("artifact", artifact),
  });

  async function submitUrlEdit(event?: FormEvent) {
    event?.preventDefault();
    if (!saveEntities || urlEdit == null) return;
    const next = urlEdit.trim();
    if (!isHttpUrl(next)) {
      setToast("http または https のURLを指定してください。", "warning");
      return;
    }
    const ok = await applyLinkedArtifactTarget(artifact, next, saveEntities, setToast);
    if (ok) setUrlEdit(null);
  }

  return (
    <li className={`artifact-card ${mode === "linked" ? "is-linked" : "is-managed"}`}>
      <span className="artifact-card-icon" aria-hidden="true">
        {mode === "linked" ? <IconLink size={18} /> : <ArtifactFileIcon fileType={artifact.file_type} />}
      </span>
      <div className="artifact-card-main">
        <div className="artifact-card-title-row">
          <strong className="artifact-card-title" title={pathTitle}>{artifact.filename}</strong>
          <span className="artifact-card-badges">
            <span className="artifact-badge artifact-badge-type">{artifactTypeBadge(artifact.file_type)}</span>
            <span className={`artifact-badge artifact-badge-storage ${mode === "linked" ? "is-linked" : ""}`}>
              {artifactStorageModeLabel(artifact)}
            </span>
            {showLinkStatus && (
              <span className="artifact-badge artifact-badge-status is-warning">
                {ARTIFACT_LINK_STATUS_LABELS[linkStatus] || linkStatus}
              </span>
            )}
          </span>
        </div>
        {metaParts.length > 0 && (
          <small className="artifact-card-meta">{metaParts.join(" · ")}</small>
        )}
        {urlEdit != null && (
          <form className="artifact-url-form artifact-url-form-inline" onSubmit={(event) => { void submitUrlEdit(event); }}>
            <input
              ref={urlEditRef}
              type="url"
              value={urlEdit}
              onChange={(event) => setUrlEdit(event.target.value)}
              placeholder="https://..."
              aria-label="新しいURL"
              onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setUrlEdit(null);
                }
              }}
            />
            <button type="submit" className="primary-button compact" disabled={!urlEdit.trim()}>更新</button>
            <button type="button" className="text-button compact" onClick={() => setUrlEdit(null)}>取消</button>
          </form>
        )}
      </div>
      <span className="artifact-card-actions">
        <button
          type="button"
          className="secondary-button compact artifact-card-open"
          title={artifactOpenHint(artifact.file_type)}
          onClick={() => {
            void openArtifactFile(artifact, setToast).then(() => onOpened?.());
          }}
        >
          <IconExternalLink size={14} />{artifactOpenLabel(artifact.file_type)}
        </button>
        <button
          type="button"
          className="artifact-card-menu"
          aria-label="その他の操作"
          aria-haspopup="menu"
          aria-expanded={Boolean(menu)}
          onClick={openMenu}
        >
          <IconDotsVertical size={16} />
        </button>
      </span>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
    </li>
  );
}

const RECENT_KEY = "artifacts:recent-opened";
const RECENT_LIMIT = 40;

export function readRecentArtifactIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function markArtifactOpened(id: string): void {
  const next = [id, ...readRecentArtifactIds().filter((entry) => entry !== id)].slice(0, RECENT_LIMIT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // localStorage が使えない環境では最近開いた順を諦める。
  }
}

function buildManagedEntities(
  files: Array<{ filename: string; storedPath: string; originalPath: string; fileSize: number; mimeType: string; fileType: string; copiedAt?: string }>,
  sourceType: ArtifactSourceType,
  sourceId: string,
  themeId?: string | null,
): SaveOperation[] {
  const now = new Date().toISOString();
  return files.map((file) => ({
    action: "save" as const,
    type: "artifact" as const,
    entity: {
      id: uuid(),
      title: file.filename.replace(/\.[^.]+$/, ""),
      filename: file.filename,
      file_type: file.fileType,
      mime_type: file.mimeType,
      file_size: file.fileSize,
      stored_path: file.storedPath,
      original_path: file.originalPath,
      storage_mode: "managed",
      copied_at: file.copiedAt || now,
      source_type: sourceType,
      source_id: sourceId,
      theme_id: themeId || null,
      description: null,
      generated_by: null,
      link_type: null,
      target: null,
      link_status: null,
      last_checked_at: null,
    },
  }));
}

function buildLinkedEntitiesFromPaths(
  files: Array<{ path: string; name: string }>,
  sourceType: ArtifactSourceType,
  sourceId: string,
  themeId?: string | null,
): SaveOperation[] {
  return files.map((file) => {
    const target = file.path;
    const filename = file.name || displayNameFromTarget(target, "file");
    const linkType = inferArtifactLinkType(target) as ArtifactLinkType;
    const fileType = artifactFileTypeFromName(filename);
    return {
      action: "save" as const,
      type: "artifact" as const,
      entity: {
        id: uuid(),
        title: filename.replace(/\.[^.]+$/, ""),
        filename,
        file_type: fileType,
        mime_type: undefined,
        file_size: undefined,
        stored_path: "",
        original_path: null,
        storage_mode: "linked",
        copied_at: null,
        link_type: linkType,
        target,
        link_status: "unknown" as ArtifactLinkStatus,
        last_checked_at: null,
        source_type: sourceType,
        source_id: sourceId,
        theme_id: themeId || null,
        description: null,
        generated_by: null,
      },
    };
  });
}

function buildLinkedEntityFromUrl(
  url: string,
  sourceType: ArtifactSourceType,
  sourceId: string,
  themeId?: string | null,
): SaveOperation {
  const target = url.trim();
  const filename = displayNameFromTarget(target, "link");
  const linkType = inferArtifactLinkType(target) as ArtifactLinkType;
  return {
    action: "save",
    type: "artifact",
    entity: {
      id: uuid(),
      title: filename.replace(/\.[^.]+$/, "") || "リンク",
      filename,
      file_type: artifactFileTypeFromName(filename),
      stored_path: "",
      original_path: null,
      storage_mode: "linked",
      copied_at: null,
      link_type: linkType,
      target,
      link_status: "unknown",
      last_checked_at: null,
      source_type: sourceType,
      source_id: sourceId,
      theme_id: themeId || null,
      description: null,
      generated_by: null,
    },
  };
}

export function ArtifactSection({
  sourceType,
  sourceId,
  themeId,
  artifacts,
  data,
  openDrawer,
  saveEntities,
  removeEntity,
  setToast,
  headingExtra,
}: {
  sourceType: ArtifactSourceType;
  sourceId: string;
  themeId?: string | null;
  artifacts: Artifact[];
  data?: WorkspaceData;
  openDrawer?: OpenDrawer;
  saveEntities: SaveEntities;
  removeEntity: RemoveEntity;
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
  headingExtra?: ReactNode;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [needsDirectory, setNeedsDirectory] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const [urlFormOpen, setUrlFormOpen] = useState(false);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const attached = artifacts
    .filter((entry) => entry.source_type === sourceType && entry.source_id === sourceId)
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

  useEffect(() => {
    if (urlFormOpen) urlInputRef.current?.focus();
  }, [urlFormOpen]);

  async function chooseDirectory() {
    try {
      const result = await workspaceApi.chooseDirectory("Artifact保存先フォルダを選択");
      if (result.canceled || !result.path) return;
      await workspaceApi.setPreference("artifactDirectory", result.path);
      setNeedsDirectory(false);
      setToast(`Artifact保存先を設定しました。${result.path}`, "success");
    } catch (error) {
      setToast(`保存先を設定できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    }
  }

  async function importManagedFromPaths(requestFiles: Array<{ path: string; name: string }>) {
    if (!requestFiles.length) {
      setToast("ファイルの場所を取得できませんでした。エクスプローラーからファイルを選んでください。", "danger");
      return;
    }
    setImporting(true);
    try {
      const result = await workspaceApi.importArtifactFiles({ files: requestFiles });
      if (result.status === "needs_directory") {
        setNeedsDirectory(true);
        setToast("Artifact保存先が未設定です。「保存先を選ぶ」から設定してください。", "info");
        return;
      }
      const operations = buildManagedEntities(result.files, sourceType, sourceId, themeId);
      await saveEntities(operations, `${operations.length}件の Artifact を添付しました。`);
    } catch (error) {
      setToast(`Artifact を添付できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setImporting(false);
    }
  }

  async function importLinkedFromPaths(requestFiles: Array<{ path: string; name: string }>) {
    if (!requestFiles.length) {
      setToast("ファイルの場所を取得できませんでした。エクスプローラーからファイルを選んでください。", "danger");
      return;
    }
    setImporting(true);
    try {
      const operations = buildLinkedEntitiesFromPaths(requestFiles, sourceType, sourceId, themeId);
      await saveEntities(operations, `${operations.length}件の参照をリンクしました。`);
    } catch (error) {
      setToast(`リンクを追加できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setImporting(false);
    }
  }

  async function importFiles(files: File[]) {
    const requestFiles = files
      .map((file) => ({ path: workspaceApi.pathForFile(file), name: file.name }))
      .filter((entry) => entry.path);
    // ファイルは既定で managed（コピー）。URL は別経路。
    await importManagedFromPaths(requestFiles);
  }

  async function pickManagedFiles() {
    try {
      const result = await workspaceApi.chooseFiles("Artifact ファイルを選択");
      if (result.canceled || !result.files?.length) return;
      await importManagedFromPaths(result.files);
    } catch (error) {
      setToast(`Artifact を選べませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    }
  }

  async function pickLinkedFiles() {
    try {
      const result = await workspaceApi.chooseFiles("参照リンクするファイルを選択");
      if (result.canceled || !result.files?.length) return;
      await importLinkedFromPaths(result.files);
    } catch (error) {
      setToast(`参照リンクを選べませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    }
  }

  function openUrlForm() {
    setUrlFormOpen(true);
  }

  async function linkUrls(urls: string[]) {
    const unique = [...new Set(urls.map((url) => url.trim()).filter((url) => isHttpUrl(url)))];
    if (!unique.length) {
      setToast("http または https のURLを指定してください。", "warning");
      return;
    }
    setImporting(true);
    try {
      const operations = unique.map((url) => buildLinkedEntityFromUrl(url, sourceType, sourceId, themeId));
      await saveEntities(
        operations,
        unique.length === 1 ? "URLをリンクしました。" : `${unique.length}件のURLをリンクしました。`,
      );
      setUrlDraft("");
      setUrlFormOpen(false);
    } catch (error) {
      setToast(`URLをリンクできませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setImporting(false);
    }
  }

  async function submitUrlForm(event?: FormEvent) {
    event?.preventDefault();
    const urls = extractHttpUrls(urlDraft);
    if (!urls.length && isHttpUrl(urlDraft.trim())) {
      await linkUrls([urlDraft.trim()]);
      return;
    }
    if (!urls.length) {
      setToast("http または https のURLを貼り付けてください。", "warning");
      return;
    }
    await linkUrls(urls);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length) {
      void importFiles(files);
      return;
    }
    const urls = extractUrlsFromDataTransfer(event.dataTransfer);
    if (urls.length) {
      void linkUrls(urls);
      return;
    }
    setToast(
      "ファイルまたはURLをドロップしてください。ブラウザのリンクをそのまま落とせます。",
      "info",
    );
  }

  function onPasteUrl(event: ClipboardEvent<HTMLDivElement | HTMLInputElement>) {
    const text = event.clipboardData.getData("text/plain");
    const urls = extractHttpUrls(text);
    if (!urls.length) return;
    // 入力欄にフォーカス中は通常の貼り付けに任せる。
    if (event.currentTarget instanceof HTMLInputElement && event.currentTarget === urlInputRef.current) {
      return;
    }
    event.preventDefault();
    void linkUrls(urls);
  }

  return (
    <section className="artifact-section">
      <div className="section-heading artifact-section-heading">
        <h3>
          Artifacts
          {attached.length > 0 && <span className="artifact-section-count">{attached.length}</span>}
        </h3>
        <div className="inline-actions artifact-section-actions">
          {headingExtra}
          <button
            type="button"
            className="secondary-button compact"
            disabled={importing}
            onClick={pickManagedFiles}
            title="ファイルをコピーして追加"
            aria-label="Artifactを追加"
          >
            <IconPlus size={14} />Artifact
          </button>
          <button
            type="button"
            className="secondary-button compact"
            disabled={importing}
            onClick={openUrlForm}
            title="URLをリンク"
            aria-label="URLをリンク"
          >
            <IconLink size={14} />URL
          </button>
        </div>
      </div>

      {urlFormOpen && (
        <form className="artifact-url-form" onSubmit={(event) => { void submitUrlForm(event); }}>
          <input
            ref={urlInputRef}
            type="url"
            value={urlDraft}
            onChange={(event) => setUrlDraft(event.target.value)}
            placeholder="https://..."
            aria-label="リンクするURL"
            disabled={importing}
            onPaste={(event) => {
              const text = event.clipboardData.getData("text/plain");
              const urls = extractHttpUrls(text);
              if (urls.length > 1 || (urls.length === 1 && text.trim() !== urls[0])) {
                event.preventDefault();
                void linkUrls(urls);
              }
            }}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setUrlFormOpen(false);
                setUrlDraft("");
              }
            }}
          />
          <button type="submit" className="primary-button compact" disabled={importing || !urlDraft.trim()}>
            追加
          </button>
          <button
            type="button"
            className="text-button compact"
            onClick={() => {
              setUrlFormOpen(false);
              setUrlDraft("");
            }}
          >
            閉じる
          </button>
        </form>
      )}

      {needsDirectory && (
        <div className="artifact-directory-prompt">
          <span>Artifact保存先が未設定のため、まだファイルをコピーできません。</span>
          <button type="button" className="primary-button compact" onClick={chooseDirectory}>保存先を選ぶ</button>
        </div>
      )}
      {attached.length > 0 && (
        <ul className="artifact-list">
          {attached.map((artifact) => (
            <ArtifactCard
              key={artifact.id}
              artifact={artifact}
              data={data}
              openDrawer={openDrawer}
              removeEntity={removeEntity}
              saveEntities={saveEntities}
              setToast={setToast}
              showSource={Boolean(openDrawer && data)}
              onNeedsDirectory={() => setNeedsDirectory(true)}
            />
          ))}
        </ul>
      )}
      <div
        className={`artifact-dropzone ${dragOver ? "is-dragover" : ""} ${importing ? "is-busy" : ""}`}
        tabIndex={0}
        role="region"
        aria-label="Artifactのドロップ領域。ファイルはコピー、URLはリンク"
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onPaste={onPasteUrl}
      >
        {importing ? "処理中…" : "ファイルまたはURLをドロップ"}
      </div>
      <div className="artifact-attach-secondary">
        <button
          type="button"
          className="text-button compact"
          disabled={importing}
          onClick={pickLinkedFiles}
          title="ファイルをコピーせず、場所だけ参照する"
        >
          参照のみ
        </button>
      </div>
    </section>
  );
}
