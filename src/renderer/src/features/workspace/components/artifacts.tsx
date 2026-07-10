import { useState, type DragEvent, type ReactNode } from "react";
import {
  IconCopy,
  IconExternalLink,
  IconFile,
  IconFileSpreadsheet,
  IconFileText,
  IconFileTypePdf,
  IconFileZip,
  IconFolderOpen,
  IconLink,
  IconMarkdown,
  IconPhoto,
  IconPlus,
  IconPresentation,
  IconTrash,
} from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import { ARTIFACT_SOURCE_TYPE_LABELS } from "../domain-model/labels";
import type {
  Artifact,
  ArtifactSourceType,
  OpenDrawer,
  RemoveEntity,
  SaveEntities,
  SaveOperation,
  WorkspaceData,
} from "../types";
import { uuid } from "../lib/format";

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
  if (mode === "image") return "画像を開く";
  if (mode === "markdown") return "Markdownを開く";
  return "開く";
}

export function artifactOpenHint(fileType?: string): string {
  const mode = artifactFileCategory(fileType);
  if (mode === "external") return "Excel / PDF / PowerPoint などは関連付けられた外部アプリで開きます。";
  if (mode === "image") return "関連付けられたアプリで画像を開きます。";
  if (mode === "markdown") return "関連付けられたアプリで Markdown を開きます。";
  return "関連付けられたアプリで開きます。";
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

  async function showInFolder(artifact: Artifact) {
    const result = await workspaceApi.showItemInFolder(artifact.stored_path);
    if (!result.ok) setToast(`フォルダを開けませんでした。${result.error || ""}`, "danger");
  }

  async function copyPath(artifact: Artifact) {
    await workspaceApi.copyText(artifact.stored_path);
    setToast("ファイルのパスをコピーしました。", "success");
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
            <li className="artifact-row" key={artifact.id}>
              <span className="artifact-row-icon" aria-hidden="true"><ArtifactFileIcon fileType={artifact.file_type} /></span>
              <span className="artifact-row-name" title={artifact.stored_path}>
                <strong>{artifact.filename}</strong>
                <small>
                  {[
                    (artifact.file_type || "").toUpperCase(),
                    formatArtifactFileSize(artifact.file_size),
                    artifact.created_at ? new Date(artifact.created_at).toLocaleDateString("ja-JP") : "",
                    data ? themeNameOf(artifact, data) : "",
                  ].filter(Boolean).join(" / ")}
                </small>
              </span>
              <span className="artifact-row-actions">
                <button
                  type="button"
                  className="text-button compact"
                  title={artifactOpenHint(artifact.file_type)}
                  onClick={() => void openArtifactFile(artifact, setToast)}
                >
                  <IconExternalLink size={14} />{artifactOpenLabel(artifact.file_type)}
                </button>
                <button type="button" className="text-button compact" onClick={() => void showInFolder(artifact)}><IconFolderOpen size={14} />フォルダ</button>
                <button type="button" className="text-button compact" onClick={() => void copyPath(artifact)}><IconCopy size={14} />パス</button>
                {openDrawer && data && (
                  <button
                    type="button"
                    className="text-button compact"
                    title="元のChat/Task/Note/Themeへ戻る"
                    onClick={() => {
                      if (!openArtifactSource(artifact, data, openDrawer)) {
                        setToast("元の場所が見つかりませんでした。削除済みの可能性があります。", "warning");
                      }
                    }}
                  >
                    <IconLink size={14} />元へ
                  </button>
                )}
                <button type="button" className="text-button compact is-danger" onClick={() => removeEntity("artifact", artifact)}><IconTrash size={14} />削除</button>
              </span>
            </li>
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
