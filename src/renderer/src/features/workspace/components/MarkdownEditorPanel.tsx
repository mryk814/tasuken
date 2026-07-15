import { type ClipboardEvent, useRef, useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import { MarkdownPreview } from "./MarkdownPreview";
import { htmlToMarkdownPaste, previewHtml, splitFrontmatter } from "../lib/markdown";

type MarkdownEditorMode = "raw" | "preview";

function clipboardImageFile(data: DataTransfer): File | null {
  for (const item of Array.from(data.items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return Array.from(data.files).find((file) => file.type.startsWith("image/")) || null;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("画像を読み取れませんでした。"));
    reader.readAsDataURL(file);
  });
}

export function MarkdownEditorPanel({
  name,
  label,
  value,
  format,
}: {
  name: string;
  label: string;
  value: string;
  format: string;
}) {
  const [body, setBody] = useState(value);
  const [mode, setMode] = useState<MarkdownEditorMode>("raw");
  const [copyState, setCopyState] = useState("");
  const [pasteState, setPasteState] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const standalonePreviewRef = useRef<HTMLDivElement | null>(null);
  const syncingScroll = useRef(false);
  const dirty = body !== value;
  const frontmatter = format === "markdown" ? splitFrontmatter(body).frontmatter : "";
  const preview = previewHtml(body, format);

  async function copyRaw() {
    await workspaceApi.copyText(body);
    setCopyState("本文をコピーしました。");
  }

  function insertMarkdown(markdown: string, selectionStart: number, selectionEnd: number) {
    setBody((current) => `${current.slice(0, selectionStart)}${markdown}${current.slice(selectionEnd)}`);
    window.setTimeout(() => {
      const position = selectionStart + markdown.length;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(position, position);
    }, 0);
  }

  async function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (format !== "markdown") return;
    const image = clipboardImageFile(event.clipboardData);
    if (!image) {
      const markdown = htmlToMarkdownPaste(event.clipboardData.getData("text/html"));
      if (!/\[[^\]\n]+\]\([^)]+\)/.test(markdown)) return;

      event.preventDefault();
      insertMarkdown(markdown, event.currentTarget.selectionStart, event.currentTarget.selectionEnd);
      if (pasteState) setPasteState("");
      setCopyState("");
      return;
    }

    event.preventDefault();
    const target = event.currentTarget;
    const selectionStart = target.selectionStart;
    const selectionEnd = target.selectionEnd;
    setPasteState("画像を保存しています。");
    setCopyState("");

    try {
      const result = await workspaceApi.saveMarkdownImageAttachment({
        fileName: image.name || "pasted-image",
        mimeType: image.type || "image/png",
        dataUrl: await readFileAsDataUrl(image),
      });
      const alt = result.fileName.replace(/\.[^.]+$/, "") || "貼り付け画像";
      insertMarkdown(`![${alt}](${result.url})`, selectionStart, selectionEnd);
      setPasteState("画像を挿入しました。");
    } catch (error) {
      setPasteState(error instanceof Error ? error.message : "画像を挿入できませんでした。");
    }
  }

  function scrollRatio(element: HTMLElement | null): number {
    if (!element) return 0;
    const scrollable = element.scrollHeight - element.clientHeight;
    return scrollable > 0 ? element.scrollTop / scrollable : 0;
  }

  function restoreScroll(element: HTMLElement | null, ratio: number) {
    if (!element) return;
    const scrollable = element.scrollHeight - element.clientHeight;
    element.scrollTop = scrollable > 0 ? ratio * scrollable : 0;
  }

  function switchMode(nextMode: MarkdownEditorMode) {
    if (nextMode === mode) return;
    const source = mode === "raw" ? textareaRef.current : standalonePreviewRef.current;
    const ratio = scrollRatio(source);
    setMode(nextMode);
    window.requestAnimationFrame(() => {
      const target = nextMode === "raw" ? textareaRef.current : standalonePreviewRef.current;
      restoreScroll(target, ratio);
    });
  }

  function syncScroll(source: HTMLElement, target: HTMLElement | null) {
    if (!target || syncingScroll.current) return;
    const sourceScrollable = source.scrollHeight - source.clientHeight;
    const targetScrollable = target.scrollHeight - target.clientHeight;
    if (sourceScrollable <= 0 || targetScrollable <= 0) return;
    syncingScroll.current = true;
    target.scrollTop = (source.scrollTop / sourceScrollable) * targetScrollable;
    window.requestAnimationFrame(() => {
      syncingScroll.current = false;
    });
  }

  return (
    <section className="markdown-editor" aria-label={label}>
      <div className="markdown-editor-heading">
        <span>{label}</span>
        <span className={`markdown-save-state ${dirty ? "is-dirty" : ""}`}>{dirty ? "未保存の変更あり" : value ? "保存済み" : "保存前"}</span>
      </div>
      <div className="markdown-editor-toolbar">
        <div className="segmented" aria-label={`${label}表示`}>
          <button type="button" className={mode === "raw" ? "is-active" : ""} onClick={() => switchMode("raw")}>Edit</button>
          <button type="button" className={mode === "preview" ? "is-active" : ""} onClick={() => switchMode("preview")}>Preview</button>
        </div>
        <div className="markdown-editor-actions">
          <button type="button" className="secondary-button compact" onClick={copyRaw}>本文をコピー</button>
        </div>
      </div>
      {(copyState || pasteState) && <p className="field-help">{pasteState || copyState}</p>}
      {frontmatter && <p className="markdown-frontmatter-note">frontmatterあり</p>}
      {mode === "raw" ? (
        <div className={format === "markdown" ? "markdown-editor-split" : ""}>
          <textarea
            ref={textareaRef}
            className="large-textarea markdown-editor-input"
            name={name}
            value={body}
            onPaste={handlePaste}
            onScroll={(event) => syncScroll(event.currentTarget, previewRef.current)}
            onChange={(event) => {
              setBody(event.target.value);
              if (copyState) setCopyState("");
              if (pasteState) setPasteState("");
            }}
          />
          {format === "markdown" && (
            <MarkdownPreview
              rootRef={previewRef}
              className="markdown-preview"
              html={preview}
              onScroll={(event) => syncScroll(event.currentTarget, textareaRef.current)}
            />
          )}
        </div>
      ) : (
        <>
          <input type="hidden" name={name} value={body} />
          <MarkdownPreview rootRef={standalonePreviewRef} className="markdown-preview" html={preview} />
        </>
      )}
    </section>
  );
}
