import { useState, type DragEvent } from "react";
import {
  IconCopy,
  IconExternalLink,
  IconFile,
  IconFileSpreadsheet,
  IconFileText,
  IconFileTypePdf,
  IconFileZip,
  IconFolderOpen,
  IconMarkdown,
  IconPhoto,
  IconPresentation,
  IconTrash,
} from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { Artifact, ArtifactSourceType, RemoveEntity, SaveEntities, SaveOperation } from "../types";
import { uuid } from "../lib/format";

const SPREADSHEET_TYPES = new Set(["xlsx", "xls", "csv", "tsv"]);
const IMAGE_TYPES = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
const MARKDOWN_TYPES = new Set(["md", "markdown"]);
const PRESENTATION_TYPES = new Set(["pptx", "ppt"]);
const ARCHIVE_TYPES = new Set(["zip", "7z"]);
const TEXT_TYPES = new Set(["txt", "docx", "doc", "json", "html"]);

function ArtifactFileIcon({ fileType }: { fileType?: string }) {
  const type = (fileType || "").toLowerCase();
  const size = 18;
  if (SPREADSHEET_TYPES.has(type)) return <IconFileSpreadsheet size={size} />;
  if (IMAGE_TYPES.has(type)) return <IconPhoto size={size} />;
  if (type === "pdf") return <IconFileTypePdf size={size} />;
  if (MARKDOWN_TYPES.has(type)) return <IconMarkdown size={size} />;
  if (PRESENTATION_TYPES.has(type)) return <IconPresentation size={size} />;
  if (ARCHIVE_TYPES.has(type)) return <IconFileZip size={size} />;
  if (TEXT_TYPES.has(type)) return <IconFileText size={size} />;
  return <IconFile size={size} />;
}

function formatFileSize(bytes?: number): string {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size < 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function ArtifactSection({
  sourceType,
  sourceId,
  themeId,
  artifacts,
  saveEntities,
  removeEntity,
  setToast,
}: {
  sourceType: ArtifactSourceType;
  sourceId: string;
  themeId?: string | null;
  artifacts: Artifact[];
  saveEntities: SaveEntities;
  removeEntity: RemoveEntity;
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
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

  async function importFiles(files: File[]) {
    const requestFiles = files
      .map((file) => ({ path: workspaceApi.pathForFile(file), name: file.name }))
      .filter((entry) => entry.path);
    if (!requestFiles.length) {
      setToast("ファイルの場所を取得できませんでした。エクスプローラーからファイルをドラッグしてください。", "danger");
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
      await saveEntities(operations, `${operations.length}件の成果物を添付しました。`);
    } catch (error) {
      setToast(`成果物を添付できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
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
      setToast("ファイルをドラッグしてください。テキストやリンクは添付できません。", "info");
      return;
    }
    void importFiles(files);
  }

  async function openArtifact(artifact: Artifact) {
    const result = await workspaceApi.openPath(artifact.stored_path);
    if (!result.ok) setToast(`ファイルを開けませんでした。${result.error || ""}`, "danger");
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
        <h3>成果物</h3>
        {attached.length > 0 && <span>{attached.length}件</span>}
      </div>
      {needsDirectory && (
        <div className="artifact-directory-prompt">
          <span>Artifact保存先が未設定のため、まだファイルを添付できません。</span>
          <button className="primary-button compact" onClick={chooseDirectory}>保存先を選ぶ</button>
        </div>
      )}
      {attached.length > 0 && (
        <ul className="artifact-list">
          {attached.map((artifact) => (
            <li className="artifact-row" key={artifact.id}>
              <span className="artifact-row-icon" aria-hidden="true"><ArtifactFileIcon fileType={artifact.file_type} /></span>
              <span className="artifact-row-name" title={artifact.stored_path}>
                <strong>{artifact.filename}</strong>
                <small>{[formatFileSize(artifact.file_size), artifact.created_at ? new Date(artifact.created_at).toLocaleDateString("ja-JP") : ""].filter(Boolean).join(" / ")}</small>
              </span>
              <span className="artifact-row-actions">
                <button className="text-button compact" onClick={() => openArtifact(artifact)}><IconExternalLink size={14} />開く</button>
                <button className="text-button compact" onClick={() => showInFolder(artifact)}><IconFolderOpen size={14} />フォルダ</button>
                <button className="text-button compact" onClick={() => copyPath(artifact)}><IconCopy size={14} />パス</button>
                <button className="text-button compact is-danger" onClick={() => removeEntity("artifact", artifact)}><IconTrash size={14} />削除</button>
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
