import { useState, type DragEvent, type MouseEvent, type ReactNode } from "react";
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
export type ArtifactAttachMode = ArtifactStorageMode;

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

export async function retargetLinkedArtifact(
  artifact: Artifact,
  saveEntities: SaveEntities,
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void,
): Promise<void> {
  if (resolveArtifactStorageMode(artifact) !== "linked") {
    setToast("参照先の変更は linked Artifact 向けです。", "info");
    return;
  }
  const currentType = (artifact.link_type || inferArtifactLinkType(String(artifact.target || ""))) as ArtifactLinkType;
  const isPathLike = currentType === "local_path" || currentType === "shared_path"
    || (currentType === "onedrive" && !isHttpUrl(String(artifact.target || "")));

  try {
    let nextTarget = "";
    let nextName = artifact.filename;
    if (isPathLike) {
      const picked = await workspaceApi.chooseFiles("新しい参照ファイルを選択");
      if (picked.canceled || !picked.files?.length) return;
      nextTarget = picked.files[0].path;
      nextName = picked.files[0].name || displayNameFromTarget(nextTarget, artifact.filename);
    } else {
      const input = window.prompt("新しいURLを入力", String(artifact.target || ""));
      if (input == null) return;
      nextTarget = input.trim();
      if (!nextTarget) {
        setToast("URLが空です。", "warning");
        return;
      }
      if (!isHttpUrl(nextTarget)) {
        setToast("http または https のURLを指定してください。", "warning");
        return;
      }
      nextName = displayNameFromTarget(nextTarget, artifact.filename);
    }
    const linkType = inferArtifactLinkType(nextTarget) as ArtifactLinkType;
    const fileType = artifactFileTypeFromName(nextName);
    await saveEntities([{
      action: "save",
      type: "artifact",
      entity: {
        ...artifact,
        target: nextTarget,
        link_type: linkType,
        filename: nextName,
        title: nextName.replace(/\.[^.]+$/, "") || artifact.title,
        file_type: fileType,
        link_status: "unknown",
        last_checked_at: null,
      },
    }], "参照先を更新しました。");
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
  const metaParts = artifactCardMetaParts(artifact, data, { includeSource: showSource });
  const mode = resolveArtifactStorageMode(artifact);
  const pathTitle = artifactOpenTarget(artifact) || artifact.filename;
  const linkStatus = artifact.link_status;
  const showLinkStatus = mode === "linked" && linkStatus && linkStatus !== "unknown" && linkStatus !== "ok";

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
      onSelect: () => { void retargetLinkedArtifact(artifact, saveEntities, setToast); },
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
  const [attachMode, setAttachMode] = useState<ArtifactAttachMode>("managed");
  const attached = artifacts
    .filter((entry) => entry.source_type === sourceType && entry.source_id === sourceId)
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

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

  async function importFromPaths(requestFiles: Array<{ path: string; name: string }>) {
    if (attachMode === "linked") {
      await importLinkedFromPaths(requestFiles);
      return;
    }
    await importManagedFromPaths(requestFiles);
  }

  async function importFiles(files: File[]) {
    const requestFiles = files
      .map((file) => ({ path: workspaceApi.pathForFile(file), name: file.name }))
      .filter((entry) => entry.path);
    await importFromPaths(requestFiles);
  }

  async function pickFiles() {
    try {
      const result = await workspaceApi.chooseFiles(
        attachMode === "linked" ? "リンクするファイルを選択" : "Artifact ファイルを選択",
      );
      if (result.canceled || !result.files?.length) return;
      await importFromPaths(result.files);
    } catch (error) {
      setToast(`Artifact を選べませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    }
  }

  async function addUrlLink() {
    const input = window.prompt("リンクするURL（http/https）を入力");
    if (input == null) return;
    const url = input.trim();
    if (!url) {
      setToast("URLが空です。", "warning");
      return;
    }
    if (!isHttpUrl(url)) {
      setToast("http または https のURLを指定してください。", "warning");
      return;
    }
    setImporting(true);
    try {
      await saveEntities(
        [buildLinkedEntityFromUrl(url, sourceType, sourceId, themeId)],
        "URLをリンクしました。",
      );
    } catch (error) {
      setToast(`URLをリンクできませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setImporting(false);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) {
      setToast(
        attachMode === "linked"
          ? "ファイルをドラッグするか、「URLをリンク」からURLを追加してください。"
          : "ファイルをドラッグしてください。テキストやリンクは添付できません。",
        "info",
      );
      return;
    }
    void importFiles(files);
  }

  return (
    <section className="artifact-section">
      <div className="section-heading">
        <h3>Artifacts</h3>
        <div className="inline-actions">
          {attached.length > 0 && <span>{attached.length}件</span>}
          {headingExtra}
        </div>
      </div>

      <div className="artifact-attach-mode" role="group" aria-label="添付方式">
        <button
          type="button"
          className={attachMode === "managed" ? "is-active" : ""}
          aria-pressed={attachMode === "managed"}
          onClick={() => setAttachMode("managed")}
        >
          コピーして管理
        </button>
        <button
          type="button"
          className={attachMode === "linked" ? "is-active" : ""}
          aria-pressed={attachMode === "linked"}
          onClick={() => setAttachMode("linked")}
        >
          場所だけリンク
        </button>
      </div>

      <div className="inline-actions artifact-attach-actions">
        <button type="button" className="secondary-button compact" disabled={importing} onClick={pickFiles}>
          <IconPlus size={14} />
          {attachMode === "linked" ? "ファイルをリンク" : "Artifact を追加"}
        </button>
        {attachMode === "linked" && (
          <button type="button" className="secondary-button compact" disabled={importing} onClick={() => void addUrlLink()}>
            <IconLink size={14} />URLをリンク
          </button>
        )}
      </div>

      {needsDirectory && attachMode === "managed" && (
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
        onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {importing
          ? (attachMode === "linked" ? "リンク中…" : "コピー中…")
          : (attachMode === "linked"
            ? "ファイルをここにドラッグしてリンク（コピーしません）"
            : "ファイルをここにドラッグして添付（管理フォルダへコピー・複数可）")}
      </div>
    </section>
  );
}
