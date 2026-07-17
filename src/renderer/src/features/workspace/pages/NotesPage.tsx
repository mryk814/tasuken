import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeMirrorEditor,
  codeBlockPlugin,
  codeMirrorPlugin,
  CodeToggle,
  CreateLink,
  frontmatterPlugin,
  headingsPlugin,
  imagePlugin,
  InsertImage,
  InsertCodeBlock,
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
  type CodeBlockEditorDescriptor,
  type CodeBlockEditorProps,
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
import { MarkdownCodeBlockNavigation, markdownCodeBlockDescriptor } from "../components/markdownCodeBlockEditor";
import { MarkdownPreview } from "../components/MarkdownPreview";
import { markdownMathPlugin } from "../components/markdownMathPlugin";
import { markdownTableKeyboardPlugin } from "../components/markdownTableKeyboardPlugin";
import { isChatReference } from "../lib/chatRefs";
import { NOTES_KIND_LABELS, notesKindFromNoteType, themeColor, type NotesKind } from "../lib/domain";
import { str } from "../lib/format";
import { buildKnowledgeNodeDraftFromNote, isLongKnowledgeSource } from "../lib/knowledgeExtraction";
import { buildMarkdownDiffHunks, buildMarkdownDiffMarkers, diffMarkdownLines, findMarkdownMatches, formatMarkdown, restoreMarkdownDiffHunk, type MarkdownDiffMarker } from "../lib/markdownEditing";
import {
  applyCalloutDecorations,
  applyHeadingNumberAttributes,
  extractMarkdownHeadings,
  HEADING_NUMBER_LEVELS,
  HEADING_NUMBER_LEVEL_LABELS,
  headingNumberOptionsFromProperties,
  normalizeHeadingNumberLevels,
  insertStructuredMarkdownPaste,
  isStructuredMarkdownPaste,
  normalizeHeadingNumberStart,
  normalizeRichEditorMarkdown,
  escapeAmbiguousMarkdownComparisons,
  openSafeMarkdownLink,
  previewDocument,
  previewHtml,
  renderMarkdownPreview,
  safeMarkdownLinkUrl,
  restoreAmbiguousMarkdownComparisons,
  type HeadingNumberLevel,
  type MarkdownHeadingItem,
  type MarkdownRenderOptions,
} from "../lib/markdown";
import { PROMPT_PURPOSE_LABELS } from "../lib/prompts";
import type { BaseRecord, NoteComment, PageProps } from "../types";
import { usePersistentState } from "../../../utils/usePersistentState";
import { DEFAULT_NOTES_PREFS, compareNotesRecords, type NotesPreferences, type NotesSortOrder } from "../lib/notes";

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

function MermaidCodeBlockEditor(props: CodeBlockEditorProps) {
  const [editing, setEditing] = useState(false);
  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const rendered = useMemo(
    () => renderMarkdownPreview(`\`\`\`mermaid\n${props.code}\n\`\`\``),
    [props.code],
  );

  useEffect(() => {
    props.focusEmitter.subscribe(() => setEditing(true));
  }, [props.focusEmitter]);

  useEffect(() => {
    if (!editing) return;
    const frame = window.requestAnimationFrame(() => {
      editorRootRef.current?.querySelector<HTMLElement>(".cm-content")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editing]);

  if (editing) {
    return (
      <div
        ref={editorRootRef}
        className="note-mermaid-code-block is-editing"
        onBlurCapture={() => {
          window.requestAnimationFrame(() => {
            if (!editorRootRef.current?.contains(document.activeElement)) setEditing(false);
          });
        }}
      >
        <MarkdownCodeBlockNavigation nodeKey={props.nodeKey}>
          <CodeMirrorEditor {...props} />
        </MarkdownCodeBlockNavigation>
      </div>
    );
  }

  return (
    <div
      className="note-mermaid-code-block is-preview"
      role="button"
      tabIndex={0}
      aria-label="Mermaidを編集"
      onClick={() => setEditing(true)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        setEditing(true);
      }}
    >
      <MarkdownPreview className="note-mermaid-preview markdown-preview" html={rendered} />
    </div>
  );
}

const mermaidCodeBlockDescriptor: CodeBlockEditorDescriptor = {
  priority: 10,
  match: (language) => String(language || "").toLowerCase() === "mermaid",
  Editor: MermaidCodeBlockEditor,
};

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
  const headingNumberLevels = Array.isArray(headingNumberOptions?.headingNumberLevels)
    ? normalizeHeadingNumberLevels(headingNumberOptions.headingNumberLevels)
    : HEADING_NUMBER_LEVELS.filter((level) => level >= headingNumberStart);
  const headingNumberLevelKey = headingNumberLevels.join(",");
  const editorRef = useRef<MDXEditorMethods | null>(null);
  const editorScopeRef = useRef<HTMLDivElement | null>(null);
  const hoverHideTimerRef = useRef<number | null>(null);
  const [editorFailed, setEditorFailed] = useState(false);
  const [hoverLink, setHoverLink] = useState<HoverLinkCard | null>(null);
  const [linkEditMode, setLinkEditMode] = useState(false);
  const [linkEditUrl, setLinkEditUrl] = useState("");
  const lastInternalMarkdown = useRef(markdown);
  const mountedRef = useRef(false);
  const editorMarkdown = escapeAmbiguousMarkdownComparisons(markdown);

  useEffect(() => {
    if (!markdownSourceRef) return;
    markdownSourceRef.current = () => normalizeRichEditorMarkdown(
      restoreAmbiguousMarkdownComparisons(editorRef.current?.getMarkdown() || lastInternalMarkdown.current || editorMarkdown),
    );
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
          <InsertCodeBlock />
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
    // 表セル内の ↑↓ を視覚上の上下セル移動にする（←→ は既存の文字移動のまま）
    markdownTableKeyboardPlugin(),
    codeBlockPlugin({
      defaultCodeBlockLanguage: "text",
      codeBlockEditorDescriptors: [mermaidCodeBlockDescriptor, markdownCodeBlockDescriptor],
    }),
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
        mermaid: "Mermaid",
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
    if (editorRef.current?.getMarkdown() !== editorMarkdown) {
      editorRef.current?.setMarkdown(editorMarkdown);
    }
    lastInternalMarkdown.current = markdown;
    setEditorFailed(false);
  }, [markdown]);

  // Windows IME は contenteditable の EditContext や祖先スクロールを基準に候補位置を決める。
  // 変換開始時に従来の caret 基準へ戻し、候補が入力文字へ重ならないだけの表示領域を確保する。
  useEffect(() => {
    const root = editorScopeRef.current;
    if (!root) return;
    let frame = 0;

    const caretRect = (): DOMRect | null => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return null;
      const range = selection.getRangeAt(0).cloneRange();
      const rects = range.getClientRects();
      if (rects.length > 0) return rects[rects.length - 1] as DOMRect;

      const container = range.startContainer;
      if (container.nodeType === Node.TEXT_NODE && range.startOffset > 0) {
        range.setStart(container, range.startOffset - 1);
        const previousRect = range.getBoundingClientRect();
        if (previousRect.height > 0) return previousRect;
      }
      const rect = range.getBoundingClientRect();
      return rect.height > 0 ? rect : null;
    };

    const keepCaretClear = (editable: HTMLElement) => {
      const rect = caretRect();
      if (!rect) return;
      const scroller = editable.closest<HTMLElement>(".note-live-editor [class*='_rootContentEditableWrapper_']") || editable;
      const scrollerRect = scroller.getBoundingClientRect();
      const surface = editable.closest<HTMLElement>(".note-markdown-surface");
      const reviewPanel = surface?.querySelector<HTMLElement>(".markdown-diff-panel");
      const reviewTop = reviewPanel?.getBoundingClientRect().top;
      const visibleBottom = reviewTop == null ? scrollerRect.bottom : Math.min(scrollerRect.bottom, reviewTop);
      const topMargin = 28;
      const bottomMargin = 96;

      if (rect.bottom > visibleBottom - bottomMargin) {
        scroller.scrollTop += rect.bottom - visibleBottom + bottomMargin;
      } else if (rect.top < scrollerRect.top + topMargin) {
        scroller.scrollTop -= scrollerRect.top + topMargin - rect.top;
      }
    };

    const onComposition = (event: CompositionEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !root.contains(target)) return;
      const editable = target.closest<HTMLElement>(".note-mdx-content, [contenteditable='true']");
      if (!editable) return;

      const withEditContext = editable as HTMLElement & { editContext?: unknown };
      if (withEditContext.editContext != null) {
        try {
          withEditContext.editContext = null;
        } catch {
          // Chromium 実装が読み取り専用の場合も、caret の退避処理は続ける。
        }
      }

      keepCaretClear(editable);
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => keepCaretClear(editable));
    };

    root.addEventListener("compositionstart", onComposition, true);
    root.addEventListener("compositionupdate", onComposition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      root.removeEventListener("compositionstart", onComposition, true);
      root.removeEventListener("compositionupdate", onComposition, true);
    };
  }, []);

  // 見出し番号・Callout 装飾は DOM 属性/class のみ（Lexical の本文テキストには書き込まない）。
  useEffect(() => {
    const root = editorScopeRef.current;
    if (!root) return;
    const content = () => root.querySelector(".note-mdx-content");
    const options: MarkdownRenderOptions = {
      headingNumbers: headingNumbersEnabled,
      headingNumberStart,
      headingNumberLevels,
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
  }, [headingNumbersEnabled, headingNumberStart, headingNumberLevelKey, markdown]);

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
    const current = restoreAmbiguousMarkdownComparisons(editorRef.current?.getMarkdown() || markdown);
    const selection = window.getSelection();
    const anchorText = selection?.anchorNode?.nodeType === Node.TEXT_NODE ? selection.anchorNode.nodeValue || "" : "";
    const anchorOffset = typeof selection?.anchorOffset === "number" ? selection.anchorOffset : 0;
    const next = insertStructuredMarkdownPaste(current, text, anchorText, anchorOffset);
    lastInternalMarkdown.current = next;
    editorRef.current?.setMarkdown(escapeAmbiguousMarkdownComparisons(next));
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
        markdown={editorMarkdown}
        onChange={(value) => {
          const normalized = normalizeRichEditorMarkdown(restoreAmbiguousMarkdownComparisons(value));
          lastInternalMarkdown.current = normalized;
          if (!mountedRef.current && normalized === markdown) return;
          onChange(normalized);
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

function hasMarkdownFootnotes(value: string): boolean {
  return /(?:^|\n)\[\^[^\]\n]+\]:|\[\^[^\]\n]+\]/.test(value);
}

type MarkdownDiffScrollMetrics = {
  containerTop: number;
  containerLeft: number;
  contentTop: number;
  contentHeight: number;
  lineHeight: number;
  paddingTop: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  anchorTops: Array<number | null>;
};

function normalizeMarkdownMarkerText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLocaleLowerCase();
}

function markdownMarkerAnchorTexts(marker: MarkdownDiffMarker): string[] {
  const changedIndexes = marker.hunk.lines
    .map((line, index) => line.kind === "same" ? -1 : index)
    .filter((index) => index >= 0);
  const firstChangedIndex = changedIndexes[0] ?? 0;
  const lastChangedIndex = changedIndexes[changedIndexes.length - 1] ?? firstChangedIndex;
  const candidateLines = [
    ...marker.hunk.lines.filter((line) => line.kind === "added"),
    ...marker.hunk.lines.slice(lastChangedIndex + 1).filter((line) => line.kind === "same"),
    ...marker.hunk.lines.slice(0, firstChangedIndex).reverse().filter((line) => line.kind === "same"),
  ];

  return [...new Set(candidateLines
    .map((line) => normalizeMarkdownMarkerText(line.text))
    .filter((text) => text.length >= 2))];
}

function markdownMarkerElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(
    "h1, h2, h3, h4, h5, h6, p, li, pre, blockquote, tr, img, [data-lexical-decorator='true']",
  ));
}

function markdownMarkerElementText(element: HTMLElement): string {
  if (element instanceof HTMLImageElement) return element.alt;
  return element.textContent || "";
}

function findMarkdownMarkerAnchor(
  root: HTMLElement,
  marker: MarkdownDiffMarker,
  totalLines: number,
): HTMLElement | null {
  const elements = markdownMarkerElements(root);
  const rootRect = root.getBoundingClientRect();
  const lineRatio = Math.max(0, Math.min(1, (marker.lineNumber - 1) / Math.max(1, totalLines - 1)));
  const expectedTop = rootRect.top + lineRatio * Math.max(0, root.scrollHeight - 18);

  for (const anchorText of markdownMarkerAnchorTexts(marker)) {
    const matches = elements.filter((element) => {
      const elementText = normalizeMarkdownMarkerText(markdownMarkerElementText(element));
      return elementText === anchorText || elementText.includes(anchorText);
    });
    if (matches.length === 0) continue;
    return matches.reduce((nearest, element) => {
      const nearestDistance = Math.abs(nearest.getBoundingClientRect().top - expectedTop);
      const elementDistance = Math.abs(element.getBoundingClientRect().top - expectedTop);
      return elementDistance < nearestDistance ? element : nearest;
    });
  }
  return null;
}

function MarkdownDiffMarkerRail({
  markers,
  totalLines,
  mode,
  surfaceRef,
  onRestoreHunk,
}: {
  markers: MarkdownDiffMarker[];
  totalLines: number;
  mode: "edit" | "raw";
  surfaceRef: { current: HTMLDivElement | null };
  onRestoreHunk: (marker: MarkdownDiffMarker) => void;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(markers.length > 0 ? 0 : null);
  const [metrics, setMetrics] = useState<MarkdownDiffScrollMetrics>({
    containerTop: 0,
    containerLeft: 0,
    contentTop: 0,
    contentHeight: 0,
    lineHeight: 0,
    paddingTop: 0,
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    anchorTops: [],
  });

  useEffect(() => setActiveIndex(markers.length > 0 ? 0 : null), [markers]);

  useEffect(() => {
    let retryTimer: number | null = null;
    let frame = 0;
    let container: HTMLElement | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const findContainer = () => {
      const surface = surfaceRef.current;
      if (!surface) return null;
      if (mode === "raw") return surface.querySelector<HTMLElement>("textarea.note-main-editor-raw");
      return surface.querySelector<HTMLElement>(".note-live-editor [class*='_rootContentEditableWrapper_']");
    };
    const findContent = () => {
      if (mode === "raw") return null;
      return surfaceRef.current?.querySelector<HTMLElement>(".note-mdx-content") || null;
    };

    const measure = () => {
      const surface = surfaceRef.current;
      const nextContainer = findContainer();
      if (!surface || !nextContainer) return;
      const surfaceRect = surface.getBoundingClientRect();
      const containerRect = nextContainer.getBoundingClientRect();
      const content = findContent();
      const contentRect = content?.getBoundingClientRect();
      const containerStyle = window.getComputedStyle(nextContainer);
      const lineHeight = Number.parseFloat(containerStyle.lineHeight);
      const paddingTop = Number.parseFloat(containerStyle.paddingTop);
      const anchorTops = mode === "edit" && content
        ? markers.map((marker) => {
          const anchor = findMarkdownMarkerAnchor(content, marker, totalLines);
          if (!anchor) return null;
          const anchorRect = anchor.getBoundingClientRect();
          return anchorRect.top - surfaceRect.top + Math.min(12, anchorRect.height / 2);
        })
        : [];
      setMetrics({
        containerTop: containerRect.top - surfaceRect.top,
        containerLeft: containerRect.left - surfaceRect.left,
        contentTop: contentRect ? contentRect.top - surfaceRect.top : containerRect.top - surfaceRect.top,
        contentHeight: content ? Math.max(content.scrollHeight, contentRect?.height || 0) : nextContainer.scrollHeight,
        lineHeight: Number.isFinite(lineHeight) ? lineHeight : 0,
        paddingTop: Number.isFinite(paddingTop) ? paddingTop : 0,
        scrollTop: nextContainer.scrollTop,
        scrollHeight: nextContainer.scrollHeight,
        clientHeight: nextContainer.clientHeight,
        anchorTops,
      });
    };

    const attach = () => {
      container = findContainer();
      if (!container) {
        retryTimer = window.setTimeout(attach, 80);
        return;
      }
      container.addEventListener("scroll", measure, { passive: true });
      resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(container);
      const content = findContent();
      if (content) resizeObserver.observe(content);
      measure();
    };

    frame = window.requestAnimationFrame(attach);
    window.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      if (retryTimer != null) window.clearTimeout(retryTimer);
      container?.removeEventListener("scroll", measure);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [mode, markers.length, surfaceRef, totalLines]);

  const contentHeight = Math.max(metrics.scrollHeight, metrics.clientHeight, 1);
  const lineSpan = Math.max(1, totalLines - 1);
  const markerTop = (marker: MarkdownDiffMarker, index: number) => {
    if (mode === "raw" && metrics.lineHeight > 0) {
      return metrics.containerTop + metrics.paddingTop + (marker.lineNumber - 1) * metrics.lineHeight + metrics.lineHeight / 2 - metrics.scrollTop;
    }
    const anchoredTop = metrics.anchorTops[index];
    if (anchoredTop != null) return anchoredTop;
    const ratio = Math.max(0, Math.min(1, (marker.lineNumber - 1) / lineSpan));
    const contentTop = metrics.contentTop || metrics.containerTop;
    const measuredContentHeight = metrics.contentHeight || contentHeight;
    return contentTop + ratio * Math.max(0, measuredContentHeight - 18);
  };
  const findScrollContainer = () => {
    const surface = surfaceRef.current;
    if (!surface) return null;
    if (mode === "raw") return surface.querySelector<HTMLElement>("textarea.note-main-editor-raw");
    return surface.querySelector<HTMLElement>(".note-live-editor [class*='_rootContentEditableWrapper_']");
  };
  const scrollToMarker = (index: number) => {
    const marker = markers[index];
    const container = findScrollContainer();
    if (!marker || !container) return;
    const ratio = Math.max(0, Math.min(1, (marker.lineNumber - 1) / lineSpan));
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    let documentTop: number;
    if (mode === "raw") {
      const style = window.getComputedStyle(container);
      const lineHeight = Number.parseFloat(style.lineHeight) || 0;
      const paddingTop = Number.parseFloat(style.paddingTop) || 0;
      documentTop = paddingTop + (marker.lineNumber - 1) * lineHeight;
    } else {
      const content = surfaceRef.current?.querySelector<HTMLElement>(".note-mdx-content");
      const containerRect = container.getBoundingClientRect();
      const anchor = content ? findMarkdownMarkerAnchor(content, marker, totalLines) : null;
      if (anchor) {
        const anchorRect = anchor.getBoundingClientRect();
        documentTop = anchorRect.top - containerRect.top + container.scrollTop + Math.min(12, anchorRect.height / 2);
      } else {
        const contentRect = content?.getBoundingClientRect();
        const contentDocumentTop = contentRect ? contentRect.top - containerRect.top + container.scrollTop : 0;
        const contentHeight = content ? Math.max(content.scrollHeight, contentRect?.height || 0) : container.scrollHeight;
        documentTop = contentDocumentTop + ratio * Math.max(0, contentHeight - 18);
      }
    }
    const target = documentTop - container.clientHeight * 0.35;
    container.scrollTo({ top: Math.max(0, Math.min(maxScrollTop, target)), behavior: "smooth" });
  };
  const selectMarker = (index: number) => {
    setActiveIndex(index);
    window.requestAnimationFrame(() => scrollToMarker(index));
  };
  useEffect(() => {
    if (markers.length === 0) return undefined;
    const frame = window.requestAnimationFrame(() => scrollToMarker(0));
    return () => window.cancelAnimationFrame(frame);
  }, [markers.length, mode, metrics.clientHeight, metrics.scrollHeight]);
  const activeMarker = activeIndex == null ? null : markers[activeIndex] || null;
  const markerLeft = metrics.containerLeft + 8;

  return (
    <div className="markdown-diff-marker-rail" aria-label="Markdownの変更箇所">
      {markers.map((marker, index) => (
        <button
          key={`${marker.lineNumber}-${index}`}
          type="button"
          className={`markdown-diff-marker is-${marker.kind} ${activeIndex === index ? "is-active" : ""}`}
          style={{ top: markerTop(marker, index), left: markerLeft }}
          aria-label={`変更箇所 ${index + 1}、${marker.lineNumber}行目`}
          aria-pressed={activeIndex === index}
          onClick={() => selectMarker(index)}
        />
      ))}
      {activeMarker && (
        <section
          className="markdown-diff-panel"
          role="dialog"
          aria-label="差分レビュー"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="markdown-diff-heading">
            <div className="markdown-diff-summary">
              <strong>差分レビュー</strong>
              <span className="markdown-diff-counts" aria-label="差分件数">
                <span className="markdown-diff-count is-added">+{activeMarker.hunk.addedLines}</span>
                <span aria-hidden="true">/</span>
                <span className="markdown-diff-count is-removed">-{activeMarker.hunk.removedLines}</span>
              </span>
            </div>
            <div className="markdown-diff-navigation">
              <button type="button" className="secondary-button compact" onClick={() => selectMarker((activeIndex! - 1 + markers.length) % markers.length)}>前へ</button>
              <span aria-live="polite">{(activeIndex ?? 0) + 1} / {markers.length}</span>
              <button type="button" className="secondary-button compact" onClick={() => selectMarker(((activeIndex ?? 0) + 1) % markers.length)}>次へ</button>
              <button type="button" className="secondary-button compact" onClick={() => setActiveIndex(null)}>閉じる</button>
            </div>
          </div>
          <div className="markdown-diff-hunk-meta">
            <span>変更箇所 {activeIndex! + 1}</span>
            <div className="markdown-diff-hunk-actions">
              <span className="markdown-diff-counts" aria-label="この変更箇所の差分件数">
                <span className="markdown-diff-count is-added">+{activeMarker.hunk.addedLines}</span>
                <span aria-hidden="true">/</span>
                <span className="markdown-diff-count is-removed">-{activeMarker.hunk.removedLines}</span>
              </span>
              <button type="button" className="secondary-button compact" onClick={() => onRestoreHunk(activeMarker)}>元に戻す</button>
            </div>
          </div>
          {activeMarker.hunk.omittedBefore > 0 && <div className="markdown-diff-ellipsis">… 前に {activeMarker.hunk.omittedBefore} 行を省略 …</div>}
          <div className="markdown-diff-lines" role="list" aria-label="差分内容">
            {activeMarker.hunk.lines.map((line, index) => (
              <div key={`${line.kind}-${index}-${line.beforeLine ?? line.afterLine ?? "none"}`} className={`markdown-diff-line is-${line.kind}`} role="listitem">
                <span className="markdown-diff-line-number">{line.beforeLine ?? "·"}</span>
                <span className="markdown-diff-line-number">{line.afterLine ?? "·"}</span>
                <span className="markdown-diff-line-marker" aria-hidden="true">{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</span>
                <span className="markdown-diff-line-text">{line.text || " "}</span>
              </div>
            ))}
          </div>
          {activeMarker.hunk.omittedAfter > 0 && <div className="markdown-diff-ellipsis">… 後に {activeMarker.hunk.omittedAfter} 行を省略 …</div>}
        </section>
      )}
    </div>
  );
}

function noteDateLabel(value: unknown): string {
  const raw = str(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
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
  const [prefs, setPrefs] = usePersistentState<NotesPreferences>("notes:prefs:v1", DEFAULT_NOTES_PREFS);
  const scope = prefs.scope;
  const sortOrder = prefs.sortOrder;
  const [draftBody, setDraftBody] = useState("");
  const [draftState, setDraftState] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [diffOpen, setDiffOpen] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [markdownExporting, setMarkdownExporting] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const previewPanelRef = useRef<HTMLElement | null>(null);
  const markdownSurfaceRef = useRef<HTMLDivElement | null>(null);
  const mdxMarkdownSourceRef = useRef<(() => string) | null>(null);
  const ctxRef = useRef<{ selected: Combined | null; draftBody: string; draftDirty: boolean }>({ selected: null, draftBody: "", draftDirty: false });
  const records: Combined[] = [
    ...domain.notes.map((note) => ({ ...note, recordType: "note" as const } as Combined)),
    ...domain.resources.filter((resource) => !isChatReference(resource)).map((r) => ({ ...r, recordType: "resource" as const } as Combined)),
  ].sort((a, b) => compareNotesRecords(a, b, sortOrder));
  const visible = records.filter((record) => {
    if (scope !== "all" && recordKind(record) !== scope) return false;
    return `${str(record.title)} ${recordBody(record)} ${str(record.url || record.source_url)}`
      .toLowerCase()
      .includes(query.toLowerCase());
  });
  const workbenchRecords = visible.filter(isWorkbenchRecord);
  const selected = workbenchRecords.find((record) => record.id === selectedId) || workbenchRecords[0] || null;
  const selectedKind = selected ? recordKind(selected) : null;
  // Markdown・PDF 出力は Note と Report だけ。Resource / Prompt は出さない。
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
  const headingNumberLevels = normalizeHeadingNumberLevels(headingNumberOptions.preview.headingNumberLevels);
  const headingNumberLevelSummary = headingNumberLevels.length
    ? headingNumberLevels.map((level) => HEADING_NUMBER_LEVEL_LABELS[level as HeadingNumberLevel]).join("–")
    : "選択なし";
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
  const searchMatches = useMemo(() => findMarkdownMatches(draftBody, searchQuery), [draftBody, searchQuery]);
  const markdownDiff = useMemo(() => diffMarkdownLines(selectedBody, draftBody), [selectedBody, draftBody]);
  const markdownDiffHunks = useMemo(() => buildMarkdownDiffHunks(markdownDiff), [markdownDiff]);
  const markdownDiffMarkers = useMemo(() => buildMarkdownDiffMarkers(markdownDiff), [markdownDiff]);
  const draftLineCount = useMemo(() => draftBody.replace(/\r\n?/g, "\n").split("\n").length, [draftBody]);

  function updatePrefs(patch: Partial<NotesPreferences>) {
    setPrefs((current) => ({ ...current, ...patch }));
  }

  function focusSearchMatch(index: number) {
    const match = searchMatches[index];
    if (!match) return;
    if (previewMode === "raw") {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(match.index, match.index + match.length);
      return;
    }
    const root = previewPanelRef.current?.querySelector<HTMLElement>(".note-mdx-content");
    if (!root) return;
    const needle = searchQuery.trim().toLocaleLowerCase();
    if (!needle) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let matchIndex = 0;
    let node: Node | null = walker.nextNode();
    while (node) {
      const text = node.nodeValue || "";
      const lower = text.toLocaleLowerCase();
      let cursor = 0;
      while (cursor <= lower.length - needle.length) {
        const localIndex = lower.indexOf(needle, cursor);
        if (localIndex < 0) break;
        if (matchIndex === index) {
          const target = node.parentElement;
          target?.scrollIntoView({ block: "center", behavior: "smooth" });
          return;
        }
        matchIndex += 1;
        cursor = localIndex + needle.length;
      }
      node = walker.nextNode();
    }
  }

  function moveSearchMatch(direction: 1 | -1) {
    if (!searchMatches.length) return;
    const next = (searchIndex + direction + searchMatches.length) % searchMatches.length;
    setSearchIndex(next);
    window.requestAnimationFrame(() => focusSearchMatch(next));
  }

  function formatSelectedDraft() {
    const current = previewMode === "edit" ? mdxMarkdownSourceRef.current?.() || draftBody : draftBody;
    const formatted = formatMarkdown(current);
    if (formatted === current) {
      setDraftState("整形できる変更はありません。");
      return;
    }
    setDraftBody(formatted);
    setDraftState("Markdownを整形しました。");
  }

  function restoreMarkdownDiffMarker(marker: MarkdownDiffMarker) {
    const restored = restoreMarkdownDiffHunk(draftBody, marker.hunk);
    if (restored === draftBody) return;
    setDraftBody(restored);
    setDraftState(`変更箇所 ${marker.lineNumber}行目を元に戻しました。`);
  }

  useEffect(() => {
    const runtime = globalThis as typeof globalThis & {
      CSS?: { highlights?: { set(name: string, value: unknown): void; delete(name: string): void } };
      Highlight?: new (...ranges: Range[]) => unknown;
    };
    const registry = runtime.CSS?.highlights;
    registry?.delete("tasken-markdown-search");
    if (!searchOpen || !searchQuery.trim() || previewMode !== "edit" || !registry || !runtime.Highlight) return;
    const root = previewPanelRef.current?.querySelector<HTMLElement>(".note-mdx-content");
    if (!root) return;
    const needle = searchQuery.trim().toLocaleLowerCase();
    const ranges: Range[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.nextNode();
    while (node) {
      const text = node.nodeValue || "";
      const lower = text.toLocaleLowerCase();
      let cursor = 0;
      while (cursor <= lower.length - needle.length) {
        const index = lower.indexOf(needle, cursor);
        if (index < 0) break;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + needle.length);
        ranges.push(range);
        cursor = index + needle.length;
      }
      node = walker.nextNode();
    }
    if (ranges.length) registry.set("tasken-markdown-search", new runtime.Highlight(...ranges));
    return () => {
      registry.delete("tasken-markdown-search");
    };
  }, [searchOpen, searchQuery, previewMode, draftBody]);

  useEffect(() => {
    setDraftBody(normalizeRichEditorMarkdown(selectedBody));
    setDraftState("");
    setDiffOpen(false);
    setSearchIndex(0);
  }, [selected?.id, selectedBody]);

  ctxRef.current = { selected, draftBody, draftDirty };

  // 未保存の変更を、Markdown本文が画面から外れる時だけ自動保存する。
  // ctxRefはレンダー中に新しい選択で上書きされるため、コミット済みの値を保持する専用refを使う。
  const autosaveRef = useRef<{ selected: Combined | null; draftBody: string; draftDirty: boolean }>({ selected: null, draftBody: "", draftDirty: false });
  const saveEntityRef = useRef(saveEntity);
  const setToastRef = useRef(setToast);
  saveEntityRef.current = saveEntity;
  setToastRef.current = setToast;
  useEffect(() => {
    autosaveRef.current = { selected, draftBody, draftDirty };
  });

  async function autoSaveDraft(snapshot = autosaveRef.current): Promise<void> {
    const previous = snapshot.selected;
    const body = snapshot.draftBody;
    if (!previous || !(snapshot.draftDirty || body !== recordBody(previous))) return;
    // Note は本文必須。Resource は空メモも許す（リンクを見ながらの下書き）。
    if (previous.recordType === "note" && !body.trim()) return;
    const { recordType, ...entity } = previous;
    try {
      await saveEntityRef.current(recordType, { ...entity, body_markdown: body });
    } catch (error: unknown) {
      setToastRef.current(`自動保存に失敗しました。${error instanceof Error ? error.message : String(error)}`);
    }
  }

  useEffect(() => {
    return () => {
      void autoSaveDraft();
    };
  }, [selected?.id]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
        window.requestAnimationFrame(() => searchInputRef.current?.focus());
        return;
      }
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

  async function openMarkdownExportDirectory(directory: string) {
    const result = await workspaceApi.openPath(directory);
    if (result.ok) {
      setToast("Markdownの保存先フォルダを開きました。", "success");
      return;
    }
    setToast(result.error || "Markdownの保存先フォルダを開けませんでした。", "danger");
  }

  function modeScroller(mode: PreviewMode): HTMLElement | null {
    const panel = previewPanelRef.current;
    if (!panel) return null;
    if (mode === "raw") return panel.querySelector<HTMLElement>("textarea.note-main-editor-raw");
    if (mode === "preview") return panel.querySelector<HTMLElement>(".note-main-preview");
    // Edit: 選択ドラッグの自動スクロールが暴走しないよう、contenteditable の外枠だけをスクロールさせる。
    return panel.querySelector<HTMLElement>(".note-live-editor [class*='_rootContentEditableWrapper_']")
      || panel.querySelector<HTMLElement>(".note-mdx-content")
      || panel.querySelector<HTMLElement>("textarea.note-main-editor-raw");
  }

  function scrollRatio(element: HTMLElement | null): number {
    if (!element) return 0;
    const scrollable = element.scrollHeight - element.clientHeight;
    return scrollable > 0 ? element.scrollTop / scrollable : 0;
  }

  type ModeScrollState = {
    ratio: number;
    headingIndex: number | null;
    headingOffset: number;
  };

  function captureModeScroll(mode: PreviewMode): ModeScrollState {
    const element = modeScroller(mode);
    const state: ModeScrollState = { ratio: scrollRatio(element), headingIndex: null, headingOffset: 0 };
    if (!element || mode === "raw") return state;
    const headings = Array.from(element.querySelectorAll<HTMLElement>("h1, h2, h3, h4"));
    if (!headings.length) return state;
    const scrollTop = element.getBoundingClientRect().top;
    let headingIndex = 0;
    for (let index = 0; index < headings.length; index += 1) {
      if (headings[index].getBoundingClientRect().top - scrollTop > 8) break;
      headingIndex = index;
    }
    state.headingIndex = headingIndex;
    state.headingOffset = headings[headingIndex].getBoundingClientRect().top - scrollTop;
    return state;
  }

  // EditとPreviewではMermaid等のブロック高が異なるため、比率より見出し位置を優先して復元する。
  // MDXEditorはマウント直後に本文の高さが伸びるので、高さが安定するまで数フレーム続ける。
  function restoreModeScroll(mode: PreviewMode, state: ModeScrollState) {
    let frames = 0;
    let lastHeight = -1;
    const apply = () => {
      frames += 1;
      const target = modeScroller(mode);
      if (target) {
        const scrollable = target.scrollHeight - target.clientHeight;
        const headings = mode === "raw" ? [] : Array.from(target.querySelectorAll<HTMLElement>("h1, h2, h3, h4"));
        const anchor = state.headingIndex == null ? null : headings[state.headingIndex];
        if (anchor) {
          const offset = anchor.getBoundingClientRect().top - target.getBoundingClientRect().top;
          target.scrollTop = Math.max(0, Math.min(scrollable, target.scrollTop + offset - state.headingOffset));
        } else if (scrollable > 0) {
          target.scrollTop = state.ratio * scrollable;
        }
        if (scrollable > 0 && target.scrollHeight === lastHeight) return;
        lastHeight = target.scrollHeight;
      }
      if (frames < 20) window.requestAnimationFrame(apply);
    };
    window.requestAnimationFrame(apply);
  }

  function switchPreviewMode(nextMode: PreviewMode) {
    if (nextMode === previewMode) return;
    // Editを離れる直前にMDXから最新本文を取り込み、Preview/Rawへ最新の下書きを渡す。
    // モード切替では自動保存しない。
    if (previewMode === "edit" && nextMode !== "edit") {
      const latest = mdxMarkdownSourceRef.current?.();
      if (typeof latest === "string" && latest !== draftBody) {
        setDraftBody(latest);
      }
    }
    const scrollState = captureModeScroll(previewMode);
    setPreviewMode(nextMode);
    restoreModeScroll(nextMode, scrollState);
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

  async function updateHeadingNumberSettings(patch: { heading_numbers?: boolean; heading_number_levels?: HeadingNumberLevel[] }) {
    if (!selected || selected.recordType !== "note") return;
    try {
      const nextEnabled = patch.heading_numbers ?? headingNumbersEnabled;
      const nextLevels = patch.heading_number_levels ?? headingNumberLevels;
      await saveEntity("note", {
        ...selected,
        body_markdown: draftDirty ? draftBody : selectedBody,
        properties_json: {
          ...selectedProperties,
          heading_numbers: nextEnabled,
          heading_number_levels: nextLevels,
          // 旧版が読めるよう開始階層も併記する。表示の正本はlevels。
          heading_number_start: nextLevels[0] ?? headingNumberStart,
        },
      });
      if (patch.heading_numbers !== undefined && patch.heading_number_levels === undefined) {
        setToast(nextEnabled ? "見出し番号を表示します（Edit / Preview / PDF）。" : "見出し番号を非表示にしました。", "success");
      } else if (patch.heading_number_levels !== undefined) {
        setToast(`番号対象を${nextLevels.length ? nextLevels.map((level) => `h${level}`).join("・") : "なし"}にしました。`, "success");
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
        themeId: str(selected.project_id || selected.theme_id) || null,
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
      setToast(`Markdownを保存しました。${result.filePath || ""}`, "success");
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
        themeId: str(selected.project_id || selected.theme_id) || null,
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
            <button key={value} className={scope === value ? "is-active" : ""} onClick={() => updatePrefs({ scope: value as NoteScope })}>
              {label}
            </button>
          ))}
        </div>
        <label className="notes-sort-field">
          <span className="sr-only">Notesの並び順</span>
          <select
            value={sortOrder}
            onChange={(event) => updatePrefs({ sortOrder: event.target.value as NotesSortOrder })}
            aria-label="Notesの並び順"
          >
            <option value="updated_desc">更新日：新しい順</option>
            <option value="updated_asc">更新日：古い順</option>
            <option value="created_desc">作成日：新しい順</option>
            <option value="created_asc">作成日：古い順</option>
          </select>
        </label>
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
                  <h2>{str(selected.title) || (selectedKind === "resource" ? selectedUrl || "無題のResource" : "無題")}</h2>
                  {(selected.created_at || selected.updated_at || draftState) && (
                    <div className="note-date-meta">
                      {selected.created_at && <span>追加 {noteDateLabel(selected.created_at)}</span>}
                      {selected.updated_at && <span>更新 {noteDateLabel(selected.updated_at)}</span>}
                      {draftState && <span className="note-draft-state" role="status" aria-live="polite">{draftState}</span>}
                    </div>
                  )}
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
              <div className={`document-publish-panel document-publish-strip ${markdownExportStale && showDocumentPublish ? "needs-export" : ""}`}>
                <div className="document-publish-title">
                  {showDocumentPublish ? (
                    <>
                      {markdownExportOpenPath && (
                        <button
                          className="document-publish-open"
                          type="button"
                          title={markdownExportDirectory || markdownExportFilePath}
                          aria-label="保存先フォルダを開く"
                          onClick={() => openMarkdownExportDirectory(markdownExportDirectory || markdownExportFilePath)}
                        >
                          <IconFolder size={15} stroke={1.8} />
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
                  <button className="secondary-button compact" onClick={formatSelectedDraft} title="行末空白と過剰な空行を整えます">整形</button>
                  <button
                    className={`secondary-button compact ${diffOpen ? "is-active" : ""}`}
                    disabled={!draftDirty}
                    aria-pressed={diffOpen}
                    onClick={() => setDiffOpen((current) => !current)}
                  >
                    {markdownDiffHunks.length ? `変更 ${markdownDiffHunks.length}か所` : "変更を確認"}
                  </button>
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
                        <details className="note-heading-level-picker">
                          <summary title="番号を付ける見出しレベル">{headingNumberLevelSummary}</summary>
                          <div className="note-heading-level-menu" aria-label="番号を付ける見出し">
                            {HEADING_NUMBER_LEVELS.map((level) => (
                              <label key={level}>
                                <input
                                  type="checkbox"
                                  checked={headingNumberLevels.includes(level)}
                                  onChange={(event) => updateHeadingNumberSettings({
                                    heading_number_levels: normalizeHeadingNumberLevels(
                                      event.target.checked
                                        ? [...headingNumberLevels, level]
                                        : headingNumberLevels.filter((current) => current !== level),
                                    ),
                                  })}
                                />
                                {HEADING_NUMBER_LEVEL_LABELS[level]}
                              </label>
                            ))}
                          </div>
                        </details>
                      )}
                      <button className="primary-button compact" disabled={markdownExporting} onClick={() => exportSelectedMarkdown(false)}>
                        {markdownExporting ? "保存中" : "保存"}
                      </button>
                      {hasMarkdownExportDirectory && (
                        <button className="secondary-button compact" disabled={markdownExporting} onClick={() => exportSelectedMarkdown(true)} title="保存先フォルダを変更">
                          <IconFolder size={15} stroke={1.8} aria-hidden />
                          保存先を変更
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
              {searchOpen && (
                <div className="markdown-search-bar" role="search" aria-label="Markdown本文を検索">
                  <input
                    ref={searchInputRef}
                    value={searchQuery}
                    onChange={(event) => {
                      setSearchQuery(event.target.value);
                      setSearchIndex(0);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        moveSearchMatch(event.shiftKey ? -1 : 1);
                      }
                      if (event.key === "Escape") setSearchOpen(false);
                    }}
                    placeholder="本文を検索"
                    aria-label="本文を検索"
                  />
                  <span className="markdown-search-count" aria-live="polite">
                    {searchMatches.length ? `${searchIndex + 1}/${searchMatches.length}` : searchQuery.trim() ? "一致なし" : "検索語を入力"}
                  </span>
                  <button type="button" className="secondary-button compact" disabled={!searchMatches.length} onClick={() => moveSearchMatch(-1)}>前へ</button>
                  <button type="button" className="secondary-button compact" disabled={!searchMatches.length} onClick={() => moveSearchMatch(1)}>次へ</button>
                  <button type="button" className="secondary-button compact" onClick={() => setSearchOpen(false)}>閉じる</button>
                </div>
              )}
              <div ref={markdownSurfaceRef} className="note-markdown-surface">
                {diffOpen && previewMode !== "preview" && markdownDiffMarkers.length > 0 && (
                  <MarkdownDiffMarkerRail
                    markers={markdownDiffMarkers}
                    totalLines={draftLineCount}
                    mode={previewMode}
                    surfaceRef={markdownSurfaceRef}
                    onRestoreHunk={restoreMarkdownDiffMarker}
                  />
                )}
                <MarkdownHeadingIndex
                  headings={markdownHeadings}
                  headingNumberOptions={headingNumberOptions.preview}
                  onSelect={jumpToMarkdownHeading}
                />
                {previewMode === "edit" ? hasMarkdownFootnotes(draftBody) ? (
                  <textarea
                    ref={textareaRef}
                    className="note-main-editor note-main-editor-raw note-editor-footnotes"
                    value={draftBody}
                    onPaste={handleDraftPaste}
                    onChange={(event) => {
                      setDraftBody(event.target.value);
                      if (draftState) setDraftState("");
                    }}
                    aria-label="脚注を含むMarkdown本文"
                  />
                ) : (
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
                  <MarkdownPreview className="note-main-preview markdown-preview" html={previewHtml(draftBody, "markdown", headingNumberOptions.preview)} />
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
