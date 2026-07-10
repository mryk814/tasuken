import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  codeBlockPlugin,
  codeMirrorPlugin,
  CodeToggle,
  CreateLink,
  frontmatterPlugin,
  headingsPlugin,
  imagePlugin,
  InsertImage,
  InsertTable,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  ListsToggle,
  markdownShortcutPlugin,
  MDXEditor,
  quotePlugin,
  Separator,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  UndoRedo,
  type MDXEditorMethods,
} from "@mdxeditor/editor";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { $findMatchingParent } from "@lexical/utils";
import { IconExternalLink, IconFileTypePdf, IconFolder, IconLink, IconLinkOff, IconNotes, IconPencil, IconPrompt, IconReport, IconSparkles } from "@tabler/icons-react";
import { $getNearestNodeFromDOMNode, getNearestEditorFromDOMNode, type LexicalEditor } from "lexical";
import { Component, memo, useEffect, useMemo, useRef, useState, type ClipboardEvent, type ErrorInfo, type MouseEvent, type ReactNode } from "react";

import { noteExportSignature } from "../../../../../shared/fileExport";
import { workspaceApi } from "../../../services/workspaceApi";
import { ContextMenu, EmptyState, PageHeader, type ContextMenuItem } from "../components/common";
import { MarkdownHeadingIndex } from "../components/MarkdownHeadingIndex";
import { markdownMathPlugin } from "../components/markdownMathPlugin";
import { isChatReference } from "../lib/chatRefs";
import { NOTES_KIND_LABELS, notesKindFromNoteType, themeColor, type NotesKind } from "../lib/domain";
import { str } from "../lib/format";
import { buildKnowledgeNodeDraftFromNote, isLongKnowledgeSource } from "../lib/knowledgeExtraction";
import {
  applyCalloutDecorations,
  applyHeadingNumberAttributes,
  extractMarkdownHeadings,
  HEADING_NUMBER_START_LABELS,
  HEADING_NUMBER_START_LEVELS,
  headingNumberOptionsFromProperties,
  insertStructuredMarkdownPaste,
  isStructuredMarkdownPaste,
  normalizeHeadingNumberStart,
  openSafeMarkdownLink,
  previewDocument,
  previewHtml,
  safeMarkdownLinkUrl,
  type HeadingNumberStart,
  type MarkdownHeadingItem,
  type MarkdownRenderOptions,
} from "../lib/markdown";
import { PROMPT_PURPOSE_LABELS } from "../lib/prompts";
import type { BaseRecord, NoteComment, PageProps } from "../types";

type Combined = BaseRecord & { recordType: "note" | "resource" };
type PreviewMode = "edit" | "preview" | "raw";
type NoteScope = "all" | NotesKind;
type MarkdownRichEditorProps = {
  markdown: string;
  onChange: (value: string) => void;
  onImageUpload: (file: File) => Promise<string>;
  onError: (message: string) => void;
  headingNumberOptions?: MarkdownRenderOptions;
  /** Preview 切替前に最新 Markdown（画像幅含む）を確定するために使う */
  markdownSourceRef?: { current: (() => string) | null };
};
type MarkdownEditorBoundaryProps = {
  markdown: string;
  resetKey: string;
  children: ReactNode;
  onChange: (value: string) => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onError: (message: string) => void;
};
type MarkdownEditorBoundaryState = { error: string | null };

function NotesKindIcon({ kind, size = 15 }: { kind: NotesKind; size?: number }) {
  const props = { size, stroke: 1.75, "aria-hidden": true as const };
  switch (kind) {
    case "resource":
      return <IconLink {...props} />;
    case "report":
      return <IconReport {...props} />;
    case "prompt":
      return <IconPrompt {...props} />;
    default:
      return <IconNotes {...props} />;
  }
}

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


class MarkdownEditorBoundary extends Component<MarkdownEditorBoundaryProps, MarkdownEditorBoundaryState> {
  state: MarkdownEditorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): MarkdownEditorBoundaryState {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, _info: ErrorInfo): void {
    this.props.onError(error instanceof Error ? error.message : String(error));
  }

  componentDidUpdate(previousProps: MarkdownEditorBoundaryProps): void {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <textarea
          className="note-main-editor note-main-editor-raw note-editor-fallback"
          value={this.props.markdown}
          onPaste={this.props.onPaste}
          onChange={(event) => this.props.onChange(event.target.value)}
        />
      );
    }
    return this.props.children;
  }
}

function editorLinkHref(anchor: Element): string {
  if (anchor instanceof HTMLAnchorElement) {
    // getAttribute より DOM の解決済み href を優先する（Lexical が相対解決するケース対策）。
    return anchor.href || anchor.getAttribute("href") || "";
  }
  return anchor.getAttribute("href") || "";
}

function shouldOpenEditorLink(event: Pick<MouseEvent | PointerEvent | globalThis.MouseEvent, "metaKey" | "ctrlKey" | "button" | "altKey">): boolean {
  // 通常クリックは編集優先。
  // - Ctrl/Cmd+クリック
  // - 中クリック
  // - Alt+クリック
  if (event.button === 1) return true;
  if (event.button !== 0) return false;
  return Boolean(event.metaKey || event.ctrlKey || event.altKey);
}

function getLexicalEditorFromAnchor(anchor: HTMLElement): LexicalEditor | null {
  return getNearestEditorFromDOMNode(anchor);
}

function removeEditorLink(anchor: HTMLElement): boolean {
  const editor = getLexicalEditorFromAnchor(anchor);
  if (!editor) return false;
  let removed = false;
  editor.update(() => {
    const nearest = $getNearestNodeFromDOMNode(anchor);
    if (!nearest) return;
    const linkNode = $isLinkNode(nearest) ? nearest : $findMatchingParent(nearest, $isLinkNode);
    if (!linkNode || !$isLinkNode(linkNode)) return;
    linkNode.select();
    removed = true;
  });
  if (!removed) return false;
  editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
  return true;
}

function updateEditorLinkUrl(anchor: HTMLElement, nextUrl: string): boolean {
  const url = safeMarkdownLinkUrl(nextUrl);
  if (!url) return false;
  const editor = getLexicalEditorFromAnchor(anchor);
  if (!editor) return false;
  let updated = false;
  editor.update(() => {
    const nearest = $getNearestNodeFromDOMNode(anchor);
    if (!nearest) return;
    const linkNode = $isLinkNode(nearest) ? nearest : $findMatchingParent(nearest, $isLinkNode);
    if (!linkNode || !$isLinkNode(linkNode)) return;
    linkNode.setURL(url);
    updated = true;
  });
  return updated;
}

type HoverLinkCard = {
  url: string;
  top: number;
  left: number;
  anchor: HTMLAnchorElement;
};

const MarkdownRichEditor = memo(function MarkdownRichEditor({
  markdown,
  onChange,
  onImageUpload,
  onError,
  headingNumberOptions,
  markdownSourceRef,
}: MarkdownRichEditorProps) {
  const headingNumbersEnabled = headingNumberOptions?.headingNumbers === true;
  const headingNumberStart = normalizeHeadingNumberStart(headingNumberOptions?.headingNumberStart);
  const editorRef = useRef<MDXEditorMethods | null>(null);
  const editorScopeRef = useRef<HTMLDivElement | null>(null);
  const hoverHideTimerRef = useRef<number | null>(null);
  const [editorFailed, setEditorFailed] = useState(false);
  const [hoverLink, setHoverLink] = useState<HoverLinkCard | null>(null);
  const [linkEditMode, setLinkEditMode] = useState(false);
  const [linkEditUrl, setLinkEditUrl] = useState("");
  const lastInternalMarkdown = useRef(markdown);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!markdownSourceRef) return;
    markdownSourceRef.current = () => editorRef.current?.getMarkdown() || lastInternalMarkdown.current || markdown;
    return () => {
      markdownSourceRef.current = null;
    };
  }, [markdown, markdownSourceRef]);
  const plugins = useMemo(() => [
    toolbarPlugin({
      toolbarContents: () => (
        <>
          <UndoRedo />
          <Separator />
          <BlockTypeSelect />
          <Separator />
          <BoldItalicUnderlineToggles />
          <CodeToggle />
          <Separator />
          <ListsToggle />
          <CreateLink />
          <InsertImage />
          <InsertTable />
        </>
      ),
    }),
    headingsPlugin(),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    linkPlugin(),
    // CreateLink / Ctrl+K の編集フォーム用。選択位置の preview ポップオーバーは CSS で隠し、
    // ホバー時の note-link-hover-card に置き換える。
    linkDialogPlugin({
      onClickLinkCallback: (url) => {
        openSafeMarkdownLink(url);
      },
    }),
    markdownMathPlugin(),
    imagePlugin({
      imageUploadHandler: onImageUpload,
      // クリック選択 + ハンドルで幅変更。設定ダイアログでは数値指定・解除（空欄=既定）も可。
      disableImageResize: false,
      disableImageSettingsButton: false,
      allowSetImageDimensions: true,
    }),
    tablePlugin(),
    codeBlockPlugin({ defaultCodeBlockLanguage: "text" }),
    codeMirrorPlugin({
      codeBlockLanguages: {
        text: "Text",
        markdown: "Markdown",
        js: "JavaScript",
        ts: "TypeScript",
        python: "Python",
        css: "CSS",
        json: "JSON",
        sql: "SQL",
      },
    }),
    frontmatterPlugin(),
    markdownShortcutPlugin(),
  ], [onImageUpload]);

  useEffect(() => {
    mountedRef.current = false;
    const timer = window.setTimeout(() => { mountedRef.current = true; }, 200);
    return () => window.clearTimeout(timer);
  }, [markdown]);

  useEffect(() => {
    if (markdown === lastInternalMarkdown.current) return;
    if (editorRef.current?.getMarkdown() !== markdown) {
      editorRef.current?.setMarkdown(markdown);
    }
    lastInternalMarkdown.current = markdown;
    setEditorFailed(false);
  }, [markdown]);

  // 見出し番号・Callout 装飾は DOM 属性/class のみ（Lexical の本文テキストには書き込まない）。
  useEffect(() => {
    const root = editorScopeRef.current;
    if (!root) return;
    const content = () => root.querySelector(".note-mdx-content");
    const options: MarkdownRenderOptions = {
      headingNumbers: headingNumbersEnabled,
      headingNumberStart,
    };
    let frame = 0;
    const refresh = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const node = content();
        applyHeadingNumberAttributes(node, options);
        applyCalloutDecorations(node);
      });
    };
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      applyHeadingNumberAttributes(content(), false);
    };
  }, [headingNumbersEnabled, headingNumberStart, markdown]);

  // React の onClick だけでは Lexical に握られることがあるため、capture の pointerdown で拾う。
  useEffect(() => {
    const root = editorScopeRef.current;
    if (!root) return;

    const openFromEvent = (event: PointerEvent | globalThis.MouseEvent) => {
      if (!shouldOpenEditorLink(event)) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!anchor || !root.contains(anchor)) return;
      if (!openSafeMarkdownLink(editorLinkHref(anchor))) return;
      event.preventDefault();
      event.stopPropagation();
    };

    root.addEventListener("pointerdown", openFromEvent, true);
    root.addEventListener("auxclick", openFromEvent, true);
    return () => {
      root.removeEventListener("pointerdown", openFromEvent, true);
      root.removeEventListener("auxclick", openFromEvent, true);
    };
  }, []);

  // キャレット移動だけでは出さず、マウスホバー時だけリンク操作カードを出す。
  useEffect(() => {
    const root = editorScopeRef.current;
    if (!root) return;

    const clearHideTimer = () => {
      if (hoverHideTimerRef.current != null) {
        window.clearTimeout(hoverHideTimerRef.current);
        hoverHideTimerRef.current = null;
      }
    };

    const scheduleHide = () => {
      clearHideTimer();
      hoverHideTimerRef.current = window.setTimeout(() => {
        setHoverLink(null);
        setLinkEditMode(false);
        setLinkEditUrl("");
        hoverHideTimerRef.current = null;
      }, 160);
    };

    const showForAnchor = (anchor: HTMLAnchorElement) => {
      const url = safeMarkdownLinkUrl(editorLinkHref(anchor));
      if (!url || url.startsWith("#")) {
        scheduleHide();
        return;
      }
      const rootRect = root.getBoundingClientRect();
      const rect = anchor.getBoundingClientRect();
      clearHideTimer();
      setHoverLink((current) => {
        // 編集中は別リンクへ勝手に切り替えない
        if (current && linkEditMode && current.anchor !== anchor) return current;
        return {
          url,
          anchor,
          top: Math.max(0, rect.bottom - rootRect.top + root.scrollTop + 6),
          left: Math.max(0, rect.left - rootRect.left + root.scrollLeft),
        };
      });
    };

    const onMove = (event: globalThis.MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".note-link-hover-card")) {
        clearHideTimer();
        return;
      }
      if (linkEditMode) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || !root.contains(anchor)) {
        scheduleHide();
        return;
      }
      showForAnchor(anchor);
    };

    const onLeave = () => {
      if (linkEditMode) return;
      scheduleHide();
    };

    root.addEventListener("mousemove", onMove);
    root.addEventListener("mouseleave", onLeave);
    return () => {
      clearHideTimer();
      root.removeEventListener("mousemove", onMove);
      root.removeEventListener("mouseleave", onLeave);
    };
  }, [linkEditMode]);

  function handleRichEditorPaste(event: ClipboardEvent<HTMLDivElement>) {
    if (clipboardImageFile(event.clipboardData)) return;
    const text = event.clipboardData.getData("text/plain");
    if (!isStructuredMarkdownPaste(text)) return;
    event.preventDefault();
    event.stopPropagation();
    const current = editorRef.current?.getMarkdown() || markdown;
    const selection = window.getSelection();
    const anchorText = selection?.anchorNode?.nodeType === Node.TEXT_NODE ? selection.anchorNode.nodeValue || "" : "";
    const anchorOffset = typeof selection?.anchorOffset === "number" ? selection.anchorOffset : 0;
    const next = insertStructuredMarkdownPaste(current, text, anchorText, anchorOffset);
    lastInternalMarkdown.current = next;
    editorRef.current?.setMarkdown(next);
    onChange(next);
  }

  if (editorFailed) {
    return (
      <textarea
        className="note-main-editor note-main-editor-raw"
        value={markdown}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <div
      ref={editorScopeRef}
      className="note-live-editor-paste-scope"
      onPasteCapture={handleRichEditorPaste}
    >
      <MDXEditor
        ref={editorRef}
        className="note-live-editor note-mdx-editor"
        contentEditableClassName="note-mdx-content markdown-preview"
        markdown={markdown}
        onChange={(value) => {
          lastInternalMarkdown.current = value;
          if (!mountedRef.current && value === markdown) return;
          onChange(value);
        }}
        onError={({ error }) => {
          setEditorFailed(true);
          onError(error);
        }}
        plugins={plugins}
        spellCheck
      />
      {hoverLink && (
        <div
          className={`note-link-hover-card ${linkEditMode ? "is-editing" : ""}`}
          style={{ top: hoverLink.top, left: hoverLink.left }}
          onMouseEnter={() => {
            if (hoverHideTimerRef.current != null) {
              window.clearTimeout(hoverHideTimerRef.current);
              hoverHideTimerRef.current = null;
            }
          }}
          onMouseLeave={() => {
            if (linkEditMode) return;
            setHoverLink(null);
          }}
        >
          {linkEditMode ? (
            <form
              className="note-link-hover-edit"
              onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!updateEditorLinkUrl(hoverLink.anchor, linkEditUrl)) return;
                const next = safeMarkdownLinkUrl(linkEditUrl) || linkEditUrl;
                setHoverLink((current) => current ? { ...current, url: next } : current);
                setLinkEditMode(false);
              }}
            >
              <input
                className="note-link-hover-input"
                value={linkEditUrl}
                onChange={(event) => setLinkEditUrl(event.target.value)}
                aria-label="リンクURL"
                autoFocus
                placeholder="https://..."
              />
              <button type="submit" className="note-link-hover-open">保存</button>
              <button
                type="button"
                className="note-link-hover-action"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setLinkEditMode(false);
                  setLinkEditUrl(hoverLink.url);
                }}
              >
                取消
              </button>
            </form>
          ) : (
            <>
              <button
                type="button"
                className="note-link-hover-open"
                title={`${hoverLink.url} を開く`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openSafeMarkdownLink(hoverLink.url);
                }}
              >
                <IconExternalLink size={14} stroke={1.8} />
                開く
              </button>
              <button
                type="button"
                className="note-link-hover-action"
                title="リンクを編集"
                aria-label="リンクを編集"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setLinkEditUrl(hoverLink.url);
                  setLinkEditMode(true);
                }}
              >
                <IconPencil size={14} stroke={1.8} />
              </button>
              <button
                type="button"
                className="note-link-hover-action is-danger"
                title="リンクを削除"
                aria-label="リンクを削除"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (!removeEditorLink(hoverLink.anchor)) return;
                  setHoverLink(null);
                  setLinkEditMode(false);
                  setLinkEditUrl("");
                }}
              >
                <IconLinkOff size={14} stroke={1.8} />
              </button>
              <span className="note-link-hover-url" title={hoverLink.url}>{hoverLink.url}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
});

function noteProperties(record: BaseRecord): Record<string, unknown> {
  return record.properties_json && typeof record.properties_json === "object" && !Array.isArray(record.properties_json)
    ? record.properties_json as Record<string, unknown>
    : {};
}

function recordKind(record: Combined): NotesKind {
  if (record.recordType === "resource") return "resource";
  return notesKindFromNoteType(str(record.note_type));
}

function recordBody(record: Combined): string {
  if (record.recordType === "resource") {
    return str(record.body_markdown) || str(record.description);
  }
  return str(record.body_markdown);
}

function canCreateKnowledge(record: Combined): boolean {
  return record.recordType === "note" && recordKind(record) === "note";
}

function isWorkbenchRecord(record: Combined): boolean {
  if (record.recordType === "resource") return true;
  return record.recordType === "note";
}

export function NotesPage({ themes, domain, activeTheme, openDrawer, saveEntity, setToast }: PageProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("edit");
  const [scope, setScope] = useState<NoteScope>("all");
  const [draftBody, setDraftBody] = useState("");
  const [draftState, setDraftState] = useState("");
  const [pdfExporting, setPdfExporting] = useState(false);
  const [markdownExporting, setMarkdownExporting] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previewPanelRef = useRef<HTMLElement | null>(null);
  const mdxMarkdownSourceRef = useRef<(() => string) | null>(null);
  const ctxRef = useRef<{ selected: Combined | null; draftBody: string; draftDirty: boolean }>({ selected: null, draftBody: "", draftDirty: false });
  const records: Combined[] = [
    ...domain.notes.map((note) => ({ ...note, recordType: "note" as const } as Combined)),
    ...domain.resources.filter((resource) => !isChatReference(resource)).map((r) => ({ ...r, recordType: "resource" as const } as Combined)),
  ].sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  const visible = records.filter((record) => {
    if (scope !== "all" && recordKind(record) !== scope) return false;
    return `${str(record.title)} ${recordBody(record)} ${str(record.url || record.source_url)}`
      .toLowerCase()
      .includes(query.toLowerCase());
  });
  const workbenchRecords = visible.filter(isWorkbenchRecord);
  const selected = workbenchRecords.find((record) => record.id === selectedId) || workbenchRecords[0] || null;
  const selectedKind = selected ? recordKind(selected) : null;
  // Document Publish / Markdown・PDF 出力は Note と Report だけ。Resource / Prompt は出さない。
  const showDocumentPublish = selectedKind === "note" || selectedKind === "report";
  const selectedTheme = selected
    ? themes.find((theme) => theme.id === (selected.theme_id || selected.project_id))
    : null;
  const selectedBody = selected ? recordBody(selected) : "";
  const effectiveBody = previewMode === "preview" ? selectedBody : draftBody;
  const selectedUrl = selected ? str(selected.url || selected.source_url) : "";
  const selectedProperties = selected ? noteProperties(selected) : {};
  const headingNumberOptions = headingNumberOptionsFromProperties(selectedProperties);
  const headingNumbersEnabled = headingNumberOptions.preview.headingNumbers === true;
  const headingNumberStart = normalizeHeadingNumberStart(headingNumberOptions.preview.headingNumberStart);
  const markdownExport = selectedProperties.markdown_export && typeof selectedProperties.markdown_export === "object" && !Array.isArray(selectedProperties.markdown_export)
    ? selectedProperties.markdown_export as Record<string, unknown>
    : null;
  const markdownExportFilePath = str(markdownExport?.filePath);
  const markdownExportDirectory = str(markdownExport?.directory);
  const markdownExportOpenPath = markdownExportFilePath || markdownExportDirectory;
  const currentExportSignature = noteExportSignature(selectedBody);
  const markdownExportStale = Boolean(str(markdownExport?.bodySignature) && str(markdownExport?.bodySignature) !== currentExportSignature);
  const hasMarkdownExportDirectory = Boolean(str(markdownExport?.directory));
  const draftDirty = Boolean(selected && draftBody !== selectedBody);
  const markdownHeadings = useMemo(() => extractMarkdownHeadings(draftBody), [draftBody]);

  useEffect(() => {
    setDraftBody(selectedBody);
    setDraftState("");
  }, [selected?.id, selectedBody]);

  ctxRef.current = { selected, draftBody, draftDirty };

  // 未保存の変更を、別レコードへの切り替え時・Notesページからの離脱時に自動保存する。
  // ctxRefはレンダー中に新しい選択で上書きされるため、コミット済みの値を保持する専用refを使う。
  const autosaveRef = useRef<{ selected: Combined | null; draftBody: string; draftDirty: boolean }>({ selected: null, draftBody: "", draftDirty: false });
  useEffect(() => {
    autosaveRef.current = { selected, draftBody, draftDirty };
  });
  useEffect(() => {
    return () => {
      const { selected: previous, draftBody: body, draftDirty: dirty } = autosaveRef.current;
      if (!previous || !dirty) return;
      // Note は本文必須。Resource は空メモも許す（リンクを見ながらの下書き）。
      if (previous.recordType === "note" && !body.trim()) return;
      const { recordType, ...entity } = previous;
      saveEntity(recordType, { ...entity, body_markdown: body })
        .catch((error: unknown) => setToast(`自動保存に失敗しました。${error instanceof Error ? error.message : String(error)}`));
    };
  }, [selected?.id, saveEntity, setToast]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        const { selected: s, draftBody: body, draftDirty: dirty } = ctxRef.current;
        if (dirty && s) {
          if (s.recordType === "note" && !body.trim()) {
            setDraftState("本文を空にしたままでは保存できません。内容を入力してください。");
            return;
          }
          setDraftState("保存しています。");
          const { recordType, ...entity } = s;
          saveEntity(recordType, { ...entity, body_markdown: body })
            .then(() => setDraftState("保存しました。"))
            .catch((error: unknown) => setDraftState(error instanceof Error ? error.message : "保存できませんでした。"));
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [saveEntity]);

  function copy() {
    workspaceApi
      .copyText(visible.map((record) => `${str(record.title)}\t${NOTES_KIND_LABELS[recordKind(record)]}\t${themes.find((theme) => theme.id === (record.project_id || record.theme_id))?.name || "—"}\t${str(record.url || record.source_url)}`).join("\n"))
      .then(() => setToast("Notes一覧をコピーしました。"));
  }

  function addPrompt(purpose = "report") {
    openDrawer({
      type: "note",
      mode: "edit",
      entity: {
        theme_id: activeTheme?.id || null,
        note_type: "prompt",
        content_format: "markdown",
        title: `${PROMPT_PURPOSE_LABELS[purpose] || "汎用"}プロンプト`,
        properties_json: {
          prompt_purpose: purpose,
          prompt_variables: "themeName, periodStart, periodEnd",
          is_default: false,
          ai_export_enabled: true,
        },
        body_markdown: "",
      },
    });
  }

  function addNote(noteType: "note" | "report" = "note") {
    openDrawer({
      type: "note",
      mode: "edit",
      entity: {
        theme_id: activeTheme?.id || null,
        note_type: noteType,
        content_format: "markdown",
        title: noteType === "report" ? "Report" : "",
        body_markdown: "",
        ...(noteType === "report" ? { properties_json: { report_type: "weekly" } } : {}),
      },
    });
  }

  async function copySelectedRaw() {
    if (!selected) return;
    await workspaceApi.copyText(effectiveBody);
    setToast("本文をコピーしました。");
  }

  function openRecord(record: Combined) {
    // 一覧クリックは右ペイン選択 + 編集ドロワー（メタ・タイトル・種別の編集）。
    if (isWorkbenchRecord(record)) {
      setSelectedId(record.id);
      setPreviewMode("edit");
    }
    openDrawer({ type: record.recordType, mode: "edit", entity: record });
  }

  function knowledgeFromNote(record: Combined) {
    if (record.recordType !== "note") return;
    if (isLongKnowledgeSource(recordBody(record))) {
      openDrawer({ type: "note", entity: record });
      setToast("本文が長いため、Knowledge候補の抽出導線を開きました。");
      return;
    }
    openDrawer({
      type: "knowledge_node",
      mode: "edit",
      entity: buildKnowledgeNodeDraftFromNote(record),
    });
  }

  function showRecordMenu(event: MouseEvent, record: Combined, url: string) {
    event.preventDefault();
    const items: ContextMenuItem[] = [
      { label: "編集する", onSelect: () => openRecord(record) },
      { label: "本文を開く", onSelect: () => {
        if (isWorkbenchRecord(record)) {
          setSelectedId(record.id);
          setPreviewMode("edit");
        }
      } },
      { label: "タイトルをコピー", onSelect: () => workspaceApi.copyText(str(record.title)) },
    ];
    if (canCreateKnowledge(record)) items.push({ label: "学びとしてKnowledge化", onSelect: () => knowledgeFromNote(record) });
    if (url) {
      items.push(
        { label: "リンクを開く", onSelect: () => window.open(url, "_blank", "noreferrer") },
        { label: "URLをコピー", onSelect: () => workspaceApi.copyText(url) },
      );
    }
    setContextMenu({ x: event.clientX, y: event.clientY, items });
  }

  async function openMarkdownExportPath(filePath: string) {
    const result = await workspaceApi.openPath(filePath);
    if (result.ok) {
      setToast("Markdownファイルを開きました。", "success");
      return;
    }
    setToast(result.error || "Markdownファイルを開けませんでした。", "danger");
  }

  function modeScroller(mode: PreviewMode): HTMLElement | null {
    const panel = previewPanelRef.current;
    if (!panel) return null;
    if (mode === "raw") return panel.querySelector<HTMLElement>("textarea.note-main-editor-raw");
    if (mode === "preview") return panel.querySelector<HTMLElement>(".note-main-preview");
    return panel.querySelector<HTMLElement>('[class*="_rootContentEditableWrapper_"]');
  }

  function scrollRatio(element: HTMLElement | null): number {
    if (!element) return 0;
    const scrollable = element.scrollHeight - element.clientHeight;
    return scrollable > 0 ? element.scrollTop / scrollable : 0;
  }

  // MDXEditorはマウント直後に本文の高さが伸びていくため、高さが安定するまで数フレーム復元を続ける。
  function restoreModeScroll(mode: PreviewMode, ratio: number) {
    let frames = 0;
    let lastHeight = -1;
    const apply = () => {
      frames += 1;
      const target = modeScroller(mode);
      if (target) {
        const scrollable = target.scrollHeight - target.clientHeight;
        if (scrollable > 0) target.scrollTop = ratio * scrollable;
        if (scrollable > 0 && target.scrollHeight === lastHeight) return;
        lastHeight = target.scrollHeight;
      }
      if (frames < 20) window.requestAnimationFrame(apply);
    };
    window.requestAnimationFrame(apply);
  }

  function switchPreviewMode(nextMode: PreviewMode) {
    if (nextMode === previewMode) return;
    // Edit を離れる直前に MDX から最新本文を取り込み、画像 width が Preview に残るようにする
    if (previewMode === "edit" && nextMode !== "edit") {
      const latest = mdxMarkdownSourceRef.current?.();
      if (typeof latest === "string" && latest !== draftBody) {
        setDraftBody(latest);
      }
    }
    const ratio = scrollRatio(modeScroller(previewMode));
    setPreviewMode(nextMode);
    restoreModeScroll(nextMode, ratio);
  }

  function insertDraftMarkdown(markdown: string, selectionStart: number, selectionEnd: number) {
    setDraftBody((current) => `${current.slice(0, selectionStart)}${markdown}${current.slice(selectionEnd)}`);
    window.setTimeout(() => {
      const position = selectionStart + markdown.length;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(position, position);
    }, 0);
  }

  async function handleDraftPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const image = clipboardImageFile(event.clipboardData);
    if (!image) return;

    event.preventDefault();
    const target = event.currentTarget;
    const selectionStart = target.selectionStart;
    const selectionEnd = target.selectionEnd;
    setDraftState("画像を保存しています。");

    try {
      const result = await workspaceApi.saveMarkdownImageAttachment({
        fileName: image.name || "pasted-image",
        mimeType: image.type || "image/png",
        dataUrl: await readFileAsDataUrl(image),
      });
      const alt = result.fileName.replace(/\.[^.]+$/, "") || "貼り付け画像";
      insertDraftMarkdown(`![${alt}](${result.url})`, selectionStart, selectionEnd);
      setDraftState("画像を挿入しました。");
    } catch (error) {
      setDraftState(error instanceof Error ? error.message : "画像を挿入できませんでした。");
    }
  }

  async function uploadEditorImage(image: File): Promise<string> {
    setDraftState("画像を保存しています。");
    try {
      const result = await workspaceApi.saveMarkdownImageAttachment({
        fileName: image.name || "pasted-image",
        mimeType: image.type || "image/png",
        dataUrl: await readFileAsDataUrl(image),
      });
      setDraftState("画像を挿入しました。");
      return result.url;
    } catch (error) {
      const message = error instanceof Error ? error.message : "画像を挿入できませんでした。";
      setDraftState(message);
      throw new Error(message);
    }
  }

  async function saveSelectedDraft() {
    if (!selected || !draftDirty) return;
    if (selected.recordType === "note" && !draftBody.trim()) {
      setDraftState("本文を空にしたままでは保存できません。内容を入力してください。");
      return;
    }
    setDraftState("保存しています。");
    try {
      const { recordType, ...entity } = selected;
      await saveEntity(recordType, {
        ...entity,
        body_markdown: draftBody,
      });
      setDraftState("保存しました。");
    } catch (error) {
      setDraftState(error instanceof Error ? error.message : "保存できませんでした。");
    }
  }

  /** 見出しをビューポート上端から fraction の位置（既定 2/5 = やや上）に来るようスクロールする。 */
  function scrollHeadingIntoView(scrollEl: HTMLElement, target: HTMLElement, fraction = 0.4) {
    const scrollRect = scrollEl.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const topInScroll = targetRect.top - scrollRect.top + scrollEl.scrollTop;
    const maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
    const nextTop = Math.min(maxScroll, Math.max(0, topInScroll - scrollEl.clientHeight * fraction));
    scrollEl.scrollTo({ top: nextTop, behavior: "smooth" });
  }

  function jumpToMarkdownHeading(heading: MarkdownHeadingItem) {
    const panel = previewPanelRef.current;
    if (!panel) return;
    if (previewMode === "preview") {
      const scrollEl = modeScroller("preview");
      const el = panel.querySelector(`#${CSS.escape(heading.id)}`) as HTMLElement | null
        || panel.querySelector(`[data-md-heading-index="${heading.index}"]`) as HTMLElement | null;
      if (scrollEl && el) scrollHeadingIntoView(scrollEl, el);
      else el?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (previewMode === "edit") {
      const scrollEl = modeScroller("edit");
      const content = panel.querySelector(".note-mdx-content");
      const nodes = content?.querySelectorAll("h1, h2, h3, h4");
      const el = nodes?.[heading.index] as HTMLElement | undefined;
      if (scrollEl && el) scrollHeadingIntoView(scrollEl, el);
      else el?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const ta = textareaRef.current;
    if (!ta) return;
    const lines = draftBody.split(/\r?\n/);
    let inCode = false;
    let count = 0;
    let found = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].trim().startsWith("```")) {
        inCode = !inCode;
        continue;
      }
      if (inCode) continue;
      if (/^#{1,4}\s+\S/.test(lines[i])) {
        if (count === heading.index) {
          found = i;
          break;
        }
        count += 1;
      }
    }
    if (found < 0) return;
    const before = lines.slice(0, found).join("\n");
    const pos = before.length + (found > 0 ? 1 : 0);
    ta.focus();
    ta.setSelectionRange(pos, pos);
    const lineHeight = Number.parseFloat(window.getComputedStyle(ta).lineHeight) || 20;
    // 見出し行がビューポートの約 2/5 に来る位置へ
    const nextTop = Math.max(0, found * lineHeight - ta.clientHeight * 0.4);
    ta.scrollTo({ top: nextTop, behavior: "smooth" });
  }

  async function updateHeadingNumberSettings(patch: { heading_numbers?: boolean; heading_number_start?: HeadingNumberStart }) {
    if (!selected || selected.recordType !== "note") return;
    try {
      const nextEnabled = patch.heading_numbers ?? headingNumbersEnabled;
      const nextStart = patch.heading_number_start ?? headingNumberStart;
      await saveEntity("note", {
        ...selected,
        body_markdown: draftDirty ? draftBody : selectedBody,
        properties_json: {
          ...selectedProperties,
          heading_numbers: nextEnabled,
          heading_number_start: nextStart,
        },
      });
      if (patch.heading_numbers !== undefined && patch.heading_number_start === undefined) {
        setToast(nextEnabled ? "見出し番号を表示します（Edit / Preview / PDF）。" : "見出し番号を非表示にしました。", "success");
      } else if (patch.heading_number_start !== undefined) {
        setToast(`番号の開始階層を${HEADING_NUMBER_START_LABELS[nextStart]}にしました。`, "success");
      }
    } catch (error) {
      setToast(`設定を保存できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    }
  }

  function publishMarkdownContent(note: Combined, themeName: string, bodyMarkdown: string): string {
    const metadata = [
      "---",
      `title: ${JSON.stringify(str(note.title))}`,
      themeName ? `theme: ${JSON.stringify(themeName)}` : "",
      str(note.updated_at || note.created_at) ? `updated_at: ${JSON.stringify(str(note.updated_at || note.created_at))}` : "",
      "---",
      "",
    ].filter((line) => line !== "").join("\n");
    return `${metadata}${bodyMarkdown.trim()}\n`;
  }

  async function exportSelectedMarkdown(chooseDirectory: boolean) {
    if (!selected || !showDocumentPublish) return;
    setMarkdownExporting(true);
    try {
      const bodyForExport = draftBody || selectedBody;
      const content = publishMarkdownContent(selected, selectedTheme?.name || "", bodyForExport);
      const result = await workspaceApi.exportMarkdownFile({
        title: str(selected.title),
        content,
        directory: str(markdownExport?.directory) || null,
        chooseDirectory,
        fileName: `${str(selected.title) || "markdown-document"}.md`,
      });
      if (result.canceled) {
        setToast("Markdown出力をキャンセルしました。", "info");
        return;
      }
      await saveEntity("note", {
        ...selected,
        properties_json: {
          ...selectedProperties,
          markdown_export: {
            directory: result.directory,
            filePath: result.filePath,
            exportedAt: result.exportedAt,
            bodySignature: noteExportSignature(bodyForExport),
          },
        },
      });
      setToast(`Markdownを出力しました。${result.filePath || ""}`, "success");
    } catch (error) {
      setToast(`Markdown出力に失敗しました。${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setMarkdownExporting(false);
    }
  }

  async function exportSelectedPdf() {
    if (!selected || !showDocumentPublish) return;
    setPdfExporting(true);
    try {
      const content = publishMarkdownContent(selected, selectedTheme?.name || "", draftBody || selectedBody);
      const result = await workspaceApi.exportMarkdownPdf({
        title: str(selected.title),
        html: previewDocument(content, "markdown", headingNumberOptions.publish),
        chooseDirectory: true,
        fileName: `${str(selected.title) || "markdown-document"}.pdf`,
      });
      if (result.canceled) {
        setToast("PDF出力をキャンセルしました。", "info");
        return;
      }
      const warningText = result.warnings?.length ? `（注意: ${result.warnings[0]}${result.warnings.length > 1 ? ` 他${result.warnings.length - 1}件` : ""}）` : "";
      setToast(`PDFを出力しました。${result.filePath || ""}${warningText}`, result.warnings?.length ? "warning" : "success");
    } catch (error) {
      setToast(`PDF出力に失敗しました。${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setPdfExporting(false);
    }
  }

  return (
    <div className="page notes-page">
      <PageHeader title="Notes" subtitle="Note / Resource / Report / Prompt。書く・読む・リンクを見ながらメモする場所">
        <button className="secondary-button" onClick={copy}>一覧をコピー</button>
        <button className="primary-button" onClick={() => addNote("note")}>Note</button>
        <button className="primary-button" onClick={() => openDrawer({ type: "resource", mode: "edit", entity: { project_id: activeTheme?.id || null } })}>Resource</button>
        <button className="primary-button" onClick={() => addNote("report")}>Report</button>
        <button className="primary-button" onClick={() => addPrompt()}>Prompt</button>
      </PageHeader>
      <div className="filter-bar panel">
        <input data-search value={query} onChange={(event) => setQuery(event.target.value)} placeholder="タイトル、本文、URLを検索" />
        <div className="segmented" aria-label="表示する種類">
          {[
            ["all", "すべて"],
            ["note", "Note"],
            ["resource", "Resource"],
            ["report", "Report"],
            ["prompt", "Prompt"],
          ].map(([value, label]) => (
            <button key={value} className={scope === value ? "is-active" : ""} onClick={() => setScope(value as NoteScope)}>
              {label}
            </button>
          ))}
        </div>
        <span>{visible.length}件</span>
      </div>
      <div className="notes-workbench">
        <section className="panel list-page notes-list-panel">
          {visible.map((record) => {
            const comments = record.comments as NoteComment[] | undefined;
            const url = str(record.source_url || record.url);
            const kind = recordKind(record);
            const kindLabel = NOTES_KIND_LABELS[kind];
            const isSelected = selected?.id === record.id;
            const themeId = str(record.project_id || record.theme_id) || null;
            const theme = themes.find((entry) => entry.id === themeId);
            const themeIndex = Math.max(0, themes.findIndex((entry) => entry.id === themeId));
            const chipColor = `var(--color-${themeColor(theme, themeIndex)})`;
            const bodyPreview = kind === "resource"
              ? (url || recordBody(record) || "URLなし")
              : (recordBody(record) || url || "本文なし");
            return (
              <div
                className={`note-row ${isSelected ? "is-selected" : ""}`}
                key={`${record.recordType}-${record.id}`}
                style={{ "--chip-color": chipColor } as React.CSSProperties}
                onContextMenu={(event) => showRecordMenu(event, record, url)}
              >
                <span className="todo-theme-bar note-theme-bar" aria-hidden="true" />
                <button
                  className="note-row-main"
                  onClick={() => openRecord(record)}
                >
                  <span className="note-row-head">
                    <span className="note-kind" title={kindLabel} aria-label={kindLabel}>
                      <NotesKindIcon kind={kind} />
                    </span>
                    <strong className="note-row-title">{str(record.title) || (kind === "resource" ? url || "無題のResource" : "無題")}</strong>
                    {record.recordType === "note" && comments && comments.length > 0 && <span className="comment-count" aria-label={`${comments.length}件のコメント`}>{comments.length}</span>}
                  </span>
                  <span className={`note-row-body ${kind === "resource" && url ? "is-url" : ""}`}>{bodyPreview}</span>
                  <span className="note-row-meta">
                    <span className="theme-inline">
                      <span className="chip-dot" />
                      {theme?.name || "Theme未設定"}
                    </span>
                  </span>
                </button>
                {canCreateKnowledge(record) && (
                  <button
                    className="row-action-button note-row-open"
                    onClick={() => knowledgeFromNote(record)}
                    aria-label={`${str(record.title) || "Note"}をKnowledge化`}
                    title="Knowledge化"
                  >
                    <IconSparkles size={15} />
                  </button>
                )}
                {url && (
                  <a
                    className="row-action-button note-row-open"
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${str(record.title) || "リンク"}を開く`}
                    title="開く"
                  >
                    <IconExternalLink size={15} />
                  </a>
                )}
              </div>
            );
          })}
          {!visible.length && <EmptyState title="一致する項目はありません" action="Noteを書く" onAction={() => addNote("note")} />}
        </section>
        {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={() => setContextMenu(null)} />}
        <section className="panel note-preview-panel" ref={previewPanelRef}>
          {selected ? (
            <>
              <div className="note-preview-header">
                <div>
                  <span
                    className="note-preview-theme"
                    style={{
                      "--chip-color": `var(--color-${themeColor(
                        selectedTheme,
                        Math.max(0, themes.findIndex((entry) => entry.id === (selected.theme_id || selected.project_id))),
                      )})`,
                    } as React.CSSProperties}
                  >
                    {selectedKind ? (
                      <span className="note-kind" title={NOTES_KIND_LABELS[selectedKind]}>
                        <NotesKindIcon kind={selectedKind} size={14} />
                        <span className="note-kind-label">{NOTES_KIND_LABELS[selectedKind]}</span>
                      </span>
                    ) : (
                      <span className="note-kind-label">—</span>
                    )}
                    <span className="theme-inline">
                      <span className="chip-dot" />
                      {selectedTheme?.name || "Theme未設定"}
                    </span>
                  </span>
                  <h2>{str(selected.title) || (selectedKind === "resource" ? selectedUrl || "無題のResource" : "無題")}</h2>
                  {selectedUrl && (
                    <a className="note-preview-url" href={selectedUrl} target="_blank" rel="noreferrer">{selectedUrl}</a>
                  )}
                </div>
                <div className="note-preview-actions">
                  <button className="secondary-button compact" onClick={copySelectedRaw}>本文をコピー</button>
                  <button className="secondary-button compact" disabled={!draftDirty} onClick={() => {
                    setDraftBody(selectedBody);
                    setDraftState("変更を戻しました。");
                  }}>戻す</button>
                  <button className="primary-button compact" disabled={!draftDirty} onClick={saveSelectedDraft} title="Ctrl+S">保存</button>
                  {canCreateKnowledge(selected) && (
                    <button
                      className="secondary-button compact"
                      onClick={() => knowledgeFromNote(selected)}
                    >
                      Knowledge化
                    </button>
                  )}
                </div>
              </div>
              {(draftState || draftDirty) && <span className={`note-draft-state ${draftDirty ? "is-dirty" : ""}`}>{draftState || "本文変更あり"}</span>}
              <div className={`document-publish-panel document-publish-strip ${markdownExportStale && showDocumentPublish ? "needs-export" : ""}`}>
                <div className="document-publish-title">
                  {showDocumentPublish ? (
                    <>
                      <strong>Document Publish</strong>
                      {markdownExportOpenPath && (
                        <button
                          className="document-publish-open"
                          type="button"
                          title={markdownExportOpenPath}
                          aria-label="出力先を開く"
                          onClick={() => openMarkdownExportPath(markdownExportOpenPath)}
                        >
                          <IconLink size={15} stroke={1.8} />
                        </button>
                      )}
                      {markdownExportStale && <span className="save-status save-status-error">要再出力</span>}
                    </>
                  ) : selectedKind === "resource" ? (
                    <strong>リンクメモ</strong>
                  ) : selectedKind === "prompt" ? (
                    <strong>Prompt</strong>
                  ) : null}
                </div>
                <div className="document-publish-actions">
                  <div className="segmented note-editor-mode-tabs" aria-label="Markdown表示">
                    <button className={previewMode === "edit" ? "is-active" : ""} onClick={() => switchPreviewMode("edit")}>Edit</button>
                    <button className={previewMode === "preview" ? "is-active" : ""} onClick={() => switchPreviewMode("preview")}>Preview</button>
                    <button className={previewMode === "raw" ? "is-active" : ""} onClick={() => switchPreviewMode("raw")}>Raw</button>
                  </div>
                  {showDocumentPublish && (
                    <>
                      <label className="toggle note-heading-number-toggle" title="本文は書き換えず、Edit・Preview・PDF に通し番号を付けます。Markdownファイル出力には含めません">
                        <input
                          type="checkbox"
                          checked={headingNumbersEnabled}
                          onChange={(event) => updateHeadingNumberSettings({ heading_numbers: event.target.checked })}
                        />
                        見出し番号
                      </label>
                      {headingNumbersEnabled && (
                        <label className="note-heading-start-field" title="この階層から番号を付けます。より浅い見出しは番号なし">
                          <select
                            className="note-heading-start-select"
                            value={headingNumberStart}
                            onChange={(event) => updateHeadingNumberSettings({
                              heading_number_start: normalizeHeadingNumberStart(Number(event.target.value)),
                            })}
                            aria-label="番号の開始階層"
                          >
                            {HEADING_NUMBER_START_LEVELS.map((level) => (
                              <option key={level} value={level}>{HEADING_NUMBER_START_LABELS[level]}</option>
                            ))}
                          </select>
                        </label>
                      )}
                      <button className="primary-button compact" disabled={markdownExporting} onClick={() => exportSelectedMarkdown(!hasMarkdownExportDirectory)}>
                        {markdownExporting ? "出力中" : hasMarkdownExportDirectory ? "Markdown" : "出力先を選ぶ"}
                      </button>
                      {hasMarkdownExportDirectory && (
                        <button className="secondary-button compact" disabled={markdownExporting} onClick={() => exportSelectedMarkdown(true)} title="出力先フォルダを変更">
                          <IconFolder size={15} stroke={1.8} aria-hidden />
                          変更
                        </button>
                      )}
                      <button className="secondary-button compact" disabled={pdfExporting} onClick={exportSelectedPdf} title="PDFを出力">
                        <IconFileTypePdf size={15} stroke={1.8} aria-hidden />
                        {pdfExporting ? "出力中" : "PDF"}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="note-markdown-surface">
                <MarkdownHeadingIndex
                  headings={markdownHeadings}
                  headingNumberOptions={headingNumberOptions.preview}
                  onSelect={jumpToMarkdownHeading}
                />
                {previewMode === "edit" ? (
                  <MarkdownEditorBoundary
                    markdown={draftBody}
                    resetKey={selected.id}
                    onChange={(value) => {
                      setDraftBody(value);
                      if (draftState) setDraftState("");
                    }}
                    onPaste={handleDraftPaste}
                    onError={(message) => setDraftState(`Markdownを読み込めませんでした。${message}`)}
                  >
                    <MarkdownRichEditor
                      markdown={draftBody}
                      headingNumberOptions={headingNumberOptions.preview}
                      markdownSourceRef={mdxMarkdownSourceRef}
                      onChange={(value) => {
                        setDraftBody(value);
                        if (draftState) setDraftState("");
                      }}
                      onImageUpload={uploadEditorImage}
                      onError={(message) => setDraftState(`Markdownを読み込めませんでした。${message}`)}
                    />
                  </MarkdownEditorBoundary>
                ) : previewMode === "preview" ? (
                  <div className="note-main-preview markdown-preview" dangerouslySetInnerHTML={{ __html: previewHtml(draftBody, "markdown", headingNumberOptions.preview) }} />
                ) : (
                  <textarea
                    ref={textareaRef}
                    className="note-main-editor note-main-editor-raw"
                    value={draftBody}
                    onPaste={handleDraftPaste}
                    onChange={(event) => {
                      setDraftBody(event.target.value);
                      if (draftState) setDraftState("");
                    }}
                  />
                )}
              </div>
            </>
          ) : (
            <EmptyState title="項目がありません" action="Noteを書く" onAction={() => addNote("note")} />
          )}
        </section>
      </div>
    </div>
  );
}
