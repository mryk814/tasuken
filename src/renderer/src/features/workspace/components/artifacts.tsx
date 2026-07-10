import { useState, type DragEvent, type MouseEvent, type ReactNode } from "react";
import {
  IconDotsVertical,
  IconExternalLink,
  IconFile,
  IconFileSpreadsheet,
  IconFileText,
  IconFileTypePdf,
  IconFileZip,
  IconMarkdown,
  IconPhoto,
  IconPlus,
  IconPresentation,
} from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import { ARTIFACT_SOURCE_TYPE_LABELS } from "../domain-model/labels";
import type {
  Artifact,
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
  return artifact.storage_mode === "linked" ? "linked" : "managed";
}

export function artifactStorageModeLabel(artifact: Artifact): string {
  return resolveArtifactStorageMode(artifact) === "linked" ? "リンク" : "Tasken管理";
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
  const result = await workspaceApi.showItemInFolder(artifact.stored_path);
  if (!result.ok) setToast(`フォルダを開けませんでした。${result.error || ""}`, "danger");
}

export async function copyArtifactPath(
  artifact: Artifact,
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void,
): Promise<void> {
  await workspaceApi.copyText(artifact.stored_path);
  setToast("ファイルのパスをコピーしました。", "success");
}

export function ArtifactCard({
  artifact,
  data,
  openDrawer,
  removeEntity,
  setToast,
  showSource = false,
  onOpened,
}: {
  artifact: Artifact;
  data?: WorkspaceData;
  openDrawer?: OpenDrawer;
  removeEntity: RemoveEntity;
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
  showSource?: boolean;
  onOpened?: () => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const metaParts = artifactCardMetaParts(artifact, data, { includeSource: showSource });
  const pathTitle = artifact.stored_path || artifact.filename;

  function openMenu(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ x: rect.right - 8, y: rect.bottom + 4 });
  }

  const menuItems: ContextMenuItem[] = [
    {
      label: "フォルダを開く",
      onSelect: () => { void showArtifactInFolder(artifact, setToast); },
    },
    {
      label: "パスをコピー",
      onSelect: () => { void copyArtifactPath(artifact, setToast); },
    },
  ];
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
  menuItems.push({
    label: "削除",
    tone: "danger",
    onSelect: () => removeEntity("artifact", artifact),
  });

  return (
    <li className="artifact-card">
      <span className="artifact-card-icon" aria-hidden="true">
        <ArtifactFileIcon fileType={artifact.file_type} />
      </span>
      <div className="artifact-card-main">
        <div className="artifact-card-title-row">
          <strong className="artifact-card-title" title={pathTitle}>{artifact.filename}</strong>
          <span className="artifact-card-badges">
            <span className="artifact-badge artifact-badge-type">{artifactTypeBadge(artifact.file_type)}</span>
            <span className="artifact-badge artifact-badge-storage">{artifactStorageModeLabel(artifact)}</span>
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

export async function openArtifactFile(
  artifact: Artifact,
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void,
): Promise<void> {
  const result = await workspaceApi.openPath(artifact.stored_path);
  if (!result.ok) {
    setToast(`ファイルを開けませんでした。${result.error || ""}`, "danger");
    return;
  }
  markArtifactOpened(artifact.id);
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

  async function importFromPaths(requestFiles: Array<{ path: string; name: string }>) {
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
      const operations: SaveOperation[] = result.files.map((file) => ({
        action: "save",
        type: "artifact",
        entity: {
          id: uuid(),
          title: file.filename.replace(/\.[^.]+$/, ""),
          filename: file.filename,
          file_type: file.fileType,
          mime_type: file.mimeType,
          file_size: file.fileSize,
          stored_path: file.storedPath,
          original_path: file.originalPath,
          source_type: sourceType,
          source_id: sourceId,
          theme_id: themeId || null,
          description: null,
          generated_by: null,
        },
      }));
      await saveEntities(operations, `${operations.length}件の Artifact を添付しました。`);
    } catch (error) {
      setToast(`Artifact を添付できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setImporting(false);
    }
  }

  async function importFiles(files: File[]) {
    const requestFiles = files
      .map((file) => ({ path: workspaceApi.pathForFile(file), name: file.name }))
      .filter((entry) => entry.path);
    await importFromPaths(requestFiles);
  }

  async function pickFiles() {
    try {
      const result = await workspaceApi.chooseFiles("Artifact ファイルを選択");
      if (result.canceled || !result.files?.length) return;
      await importFromPaths(result.files);
    } catch (error) {
      setToast(`Artifact を選べませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) {
      setToast("ファイルをドラッグしてください。テキストやリンクは添付できません。", "info");
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
          <button type="button" className="secondary-button compact" disabled={importing} onClick={pickFiles}>
            <IconPlus size={14} />Artifact を追加
          </button>
        </div>
      </div>
      {needsDirectory && (
        <div className="artifact-directory-prompt">
          <span>Artifact保存先が未設定のため、まだファイルを添付できません。</span>
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
              setToast={setToast}
              showSource={Boolean(openDrawer && data)}
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
        {importing ? "コピー中…" : "ファイルをここにドラッグして添付（複数可）"}
      </div>
    </section>
  );
}
