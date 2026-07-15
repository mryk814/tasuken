import {
  IconCopy,
  IconExternalLink,
  IconFolder,
  IconMaximize,
  IconPencil,
  IconX,
  IconZoomIn,
  IconZoomOut,
  IconZoomReset,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type WheelEvent } from "react";

import { artifactOpenTarget, isHttpUrl } from "../../../../../shared/artifactLinks.mjs";
import { workspaceApi } from "../../../services/workspaceApi";
import type { Artifact, ContentViewerTarget, Note, OpenContentViewer, OpenDrawer, WorkspaceData } from "../types";
import {
  headingNumberOptionsFromProperties,
  openSafeMarkdownLink,
  previewHtml,
  renderedText,
  type MarkdownRenderOptions,
} from "../lib/markdown";
import { str } from "../lib/format";
import {
  artifactFileCategory,
  canPreviewArtifactInApp,
  copyArtifactPath,
  openArtifactFile,
  showArtifactInFolder,
} from "./artifacts";
import { MarkdownPreview } from "./MarkdownPreview";

export type { ContentViewerTarget };

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      mode: "markdown";
      title: string;
      body: string;
      contentFormat: string;
      headingOptions: MarkdownRenderOptions;
      note?: Note;
      artifact?: Artifact;
      filePath?: string;
    }
  | {
      status: "ready";
      mode: "image";
      title: string;
      src: string;
      artifact?: Artifact;
      filePath?: string;
    };

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const FIT_ZOOM = 0; // 0 = 画面に合わせる

function nearestZoomIndex(value: number): number {
  let best = 0;
  let bestDiff = Infinity;
  ZOOM_STEPS.forEach((step, index) => {
    const diff = Math.abs(step - value);
    if (diff < bestDiff) {
      best = index;
      bestDiff = diff;
    }
  });
  return best;
}

function noteContentFormat(note: Note): string {
  return str(note.content_format) || (note.note_type === "artifact" ? "markdown" : "plain");
}

async function resolveTarget(target: ContentViewerTarget, data: WorkspaceData): Promise<LoadState> {
  if (target.type === "note") {
    const note = (data.notes || []).find((entry) => entry.id === target.noteId);
    if (!note) {
      return { status: "error", message: "メモが見つかりません。削除済みの可能性があります。" };
    }
    const properties = note.properties_json && typeof note.properties_json === "object"
      ? note.properties_json as Record<string, unknown>
      : {};
    const headingOptions = headingNumberOptionsFromProperties(properties).preview;
    return {
      status: "ready",
      mode: "markdown",
      title: str(note.title) || "無題のメモ",
      body: str(note.body_markdown),
      contentFormat: noteContentFormat(note),
      headingOptions,
      note,
    };
  }

  const artifact = (data.artifacts || []).find((entry) => entry.id === target.artifactId);
  if (!artifact) {
    return { status: "error", message: "Artifactが見つかりません。削除済みの可能性があります。" };
  }

  const category = artifactFileCategory(artifact.file_type);
  const openTarget = artifactOpenTarget(artifact);
  const title = str(artifact.filename) || str(artifact.title) || "Artifact";

  if (category !== "image" && category !== "markdown") {
    return {
      status: "error",
      message: "この形式はアプリ内プレビューに未対応です。外部アプリで開いてください。",
    };
  }

  if (!openTarget) {
    return { status: "error", message: "開く場所がありません。参照先を確認してください。" };
  }

  if (isHttpUrl(openTarget)) {
    if (category === "image") {
      return {
        status: "ready",
        mode: "image",
        title,
        src: openTarget,
        artifact,
        filePath: openTarget,
      };
    }
    return {
      status: "error",
      message: "URL上のMarkdownはアプリ内では直接読めません。外部で開いてください。",
    };
  }

  const result = await workspaceApi.readFilePreview(openTarget);
  if (!result.ok) {
    return { status: "error", message: result.error || "ファイルを読み込めませんでした。" };
  }

  if (category === "image") {
    if (result.kind !== "image") {
      return { status: "error", message: "画像として読み込めませんでした。" };
    }
    return {
      status: "ready",
      mode: "image",
      title,
      src: result.dataUrl,
      artifact,
      filePath: result.filePath,
    };
  }

  if (result.kind !== "text") {
    return { status: "error", message: "Markdownとして読み込めませんでした。" };
  }
  return {
    status: "ready",
    mode: "markdown",
    title,
    body: result.text,
    contentFormat: "markdown",
    headingOptions: { headingNumbers: false },
    artifact,
    filePath: result.filePath,
  };
}

export function ContentViewer({
  target,
  data,
  onClose,
  openDrawer,
  setToast,
}: {
  target: ContentViewerTarget;
  data: WorkspaceData;
  onClose: () => void;
  openDrawer: OpenDrawer;
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
}) {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [zoom, setZoom] = useState(FIT_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });
    setZoom(FIT_ZOOM);
    setPan({ x: 0, y: 0 });
    void resolveTarget(target, data).then((next) => {
      if (!cancelled) setLoad(next);
    });
    return () => {
      cancelled = true;
    };
  }, [target, data]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  const html = useMemo(() => {
    if (load.status !== "ready" || load.mode !== "markdown") return "";
    return previewHtml(load.body, load.contentFormat, load.headingOptions);
  }, [load]);

  function handlePreviewClick(event: MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as HTMLElement | null)?.closest?.("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href") || "";
    if (!href || href.startsWith("#")) return;
    event.preventDefault();
    openSafeMarkdownLink(href);
  }

  async function copyMarkdown() {
    if (load.status !== "ready" || load.mode !== "markdown") return;
    await workspaceApi.copyText(load.body);
    setToast("Markdownをコピーしました。", "success");
  }

  async function copyPreviewText() {
    if (load.status !== "ready" || load.mode !== "markdown") return;
    await workspaceApi.copyText(renderedText(load.body, load.contentFormat));
    setToast("表示テキストをコピーしました。", "success");
  }

  function editNote() {
    if (load.status !== "ready" || load.mode !== "markdown" || !load.note) return;
    onClose();
    openDrawer({ type: "note", mode: "edit", entity: load.note });
  }

  async function openExternal() {
    if (load.status !== "ready") return;
    if (load.artifact) {
      await openArtifactFile(load.artifact, setToast);
      return;
    }
    if (load.filePath) {
      const result = await workspaceApi.openPath(load.filePath);
      if (!result.ok) setToast(`ファイルを開けませんでした。${result.error || ""}`, "danger");
    }
  }

  async function openFolder() {
    if (load.status !== "ready") return;
    if (load.artifact) {
      await showArtifactInFolder(load.artifact, setToast);
      return;
    }
    if (load.filePath && !isHttpUrl(load.filePath)) {
      const result = await workspaceApi.showItemInFolder(load.filePath);
      if (!result.ok) setToast(`フォルダを開けませんでした。${result.error || ""}`, "danger");
    }
  }

  async function copyPath() {
    if (load.status !== "ready") return;
    if (load.artifact) {
      await copyArtifactPath(load.artifact, setToast);
      return;
    }
    if (load.filePath) {
      await workspaceApi.copyText(load.filePath);
      setToast(isHttpUrl(load.filePath) ? "URLをコピーしました。" : "パスをコピーしました。", "success");
    }
  }

  function zoomIn() {
    if (zoom === FIT_ZOOM) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    const next = Math.min(ZOOM_STEPS.length - 1, nearestZoomIndex(zoom) + 1);
    setZoom(ZOOM_STEPS[next]);
  }

  function zoomOut() {
    if (zoom === FIT_ZOOM) return;
    const next = Math.max(0, nearestZoomIndex(zoom) - 1);
    setZoom(ZOOM_STEPS[next]);
  }

  function fitToScreen() {
    setZoom(FIT_ZOOM);
    setPan({ x: 0, y: 0 });
  }

  function actualSize() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function onImageWheel(event: WheelEvent<HTMLDivElement>) {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    if (event.deltaY < 0) zoomIn();
    else zoomOut();
  }

  function onImagePointerDown(event: MouseEvent<HTMLDivElement>) {
    if (zoom === FIT_ZOOM || zoom <= 1) return;
    event.preventDefault();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    };
  }

  function onImagePointerMove(event: MouseEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    setPan({
      x: dragRef.current.originX + (event.clientX - dragRef.current.startX),
      y: dragRef.current.originY + (event.clientY - dragRef.current.startY),
    });
  }

  function onImagePointerUp() {
    dragRef.current = null;
  }

  const title = load.status === "ready" ? load.title : "プレビュー";
  const isImage = load.status === "ready" && load.mode === "image";
  const canOpenFolder = load.status === "ready" && Boolean(
    load.artifact
      ? !isHttpUrl(String(artifactOpenTarget(load.artifact) || ""))
      : load.filePath && !isHttpUrl(load.filePath),
  );
  const canCopyPath = load.status === "ready" && Boolean(load.filePath || load.artifact);
  const canOpenExternal = load.status === "ready" && Boolean(load.filePath || load.artifact);
  const canEditNote = load.status === "ready" && load.mode === "markdown" && Boolean(load.note);

  function trapFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className={`content-viewer-overlay ${isImage ? "is-image" : "is-markdown"}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="content-viewer-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="content-viewer-title"
        onKeyDown={trapFocus}
      >
        <header className="content-viewer-header">
          <div className="content-viewer-heading">
            <strong id="content-viewer-title" className="content-viewer-title" title={title}>{title}</strong>
            {load.status === "ready" && load.mode === "markdown" && (
              <span className="content-viewer-badge">Markdown</span>
            )}
            {load.status === "ready" && load.mode === "image" && (
              <span className="content-viewer-badge">画像</span>
            )}
          </div>
          <div className="content-viewer-actions">
            {canEditNote && (
              <button type="button" className="secondary-button compact" onClick={editNote}>
                <IconPencil size={15} />編集する
              </button>
            )}
            {load.status === "ready" && load.mode === "markdown" && (
              <>
                <button type="button" className="secondary-button compact" onClick={() => { void copyMarkdown(); }}>
                  <IconCopy size={15} />Markdownをコピー
                </button>
                <button type="button" className="text-button compact" onClick={() => { void copyPreviewText(); }}>
                  表示をコピー
                </button>
              </>
            )}
            {canOpenExternal && (
              <button type="button" className="secondary-button compact" onClick={() => { void openExternal(); }}>
                <IconExternalLink size={15} />ファイルを開く
              </button>
            )}
            {canOpenFolder && (
              <button type="button" className="secondary-button compact" onClick={() => { void openFolder(); }}>
                <IconFolder size={15} />フォルダを開く
              </button>
            )}
            {canCopyPath && (
              <button type="button" className="text-button compact" onClick={() => { void copyPath(); }}>
                パスをコピー
              </button>
            )}
            <button
              ref={closeButtonRef}
              type="button"
              className="content-viewer-close"
              aria-label="閉じる"
              onClick={onClose}
            >
              <IconX size={18} />
            </button>
          </div>
        </header>

        {isImage && load.status === "ready" && (
          <div className="content-viewer-image-toolbar" role="toolbar" aria-label="画像表示">
            <button type="button" className="secondary-button compact" onClick={zoomOut} disabled={zoom === FIT_ZOOM || zoom === ZOOM_STEPS[0]}>
              <IconZoomOut size={15} />縮小
            </button>
            <button type="button" className="secondary-button compact" onClick={zoomIn} disabled={zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]}>
              <IconZoomIn size={15} />拡大
            </button>
            <button type="button" className={`secondary-button compact ${zoom === FIT_ZOOM ? "is-active" : ""}`} onClick={fitToScreen}>
              <IconMaximize size={15} />画面に合わせる
            </button>
            <button type="button" className={`secondary-button compact ${zoom === 1 ? "is-active" : ""}`} onClick={actualSize}>
              <IconZoomReset size={15} />元サイズ
            </button>
            <span className="content-viewer-zoom-label">
              {zoom === FIT_ZOOM ? "フィット" : `${Math.round(zoom * 100)}%`}
            </span>
          </div>
        )}

        <div className="content-viewer-body">
          {load.status === "loading" && (
            <div className="content-viewer-state" role="status">読み込み中…</div>
          )}
          {load.status === "error" && (
            <div className="content-viewer-state is-error" role="alert">
              <strong>表示できませんでした</strong>
              <p>{load.message}</p>
              {target.type === "artifact" && (
                <button
                  type="button"
                  className="secondary-button compact"
                  onClick={() => {
                    const artifact = (data.artifacts || []).find((entry) => entry.id === target.artifactId);
                    if (artifact) void openArtifactFile(artifact, setToast);
                  }}
                >
                  <IconExternalLink size={15} />外部で開く
                </button>
              )}
            </div>
          )}
          {load.status === "ready" && load.mode === "markdown" && (
            <MarkdownPreview
              className="content-viewer-markdown markdown-preview"
              html={html}
              onClick={handlePreviewClick}
            />
          )}
          {load.status === "ready" && load.mode === "image" && (
            <div
              className={`content-viewer-image-stage ${zoom === FIT_ZOOM ? "is-fit" : "is-scaled"}`}
              onWheel={onImageWheel}
              onMouseDown={onImagePointerDown}
              onMouseMove={onImagePointerMove}
              onMouseUp={onImagePointerUp}
              onMouseLeave={onImagePointerUp}
            >
              <img
                src={load.src}
                alt={load.title}
                draggable={false}
                style={zoom === FIT_ZOOM ? undefined : {
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: "center center",
                  maxWidth: "none",
                  maxHeight: "none",
                  width: "auto",
                  height: "auto",
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { canPreviewArtifactInApp };

export function openArtifactInViewer(
  artifact: Artifact,
  openContentViewer: OpenContentViewer,
): boolean {
  if (!canPreviewArtifactInApp(artifact)) return false;
  openContentViewer({ type: "artifact", artifactId: artifact.id });
  return true;
}

export function openNoteInViewer(
  note: Note,
  openContentViewer: OpenContentViewer,
): void {
  openContentViewer({ type: "note", noteId: note.id });
}
