import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  ButtonWithTooltip,
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
  NESTED_EDITOR_UPDATED_COMMAND,
  quotePlugin,
  Separator,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  UndoRedo,
  useCodeBlockEditorContext,
  type MDXEditorMethods,
  type CodeBlockEditorDescriptor,
  type CodeBlockEditorProps,
} from "@mdxeditor/editor";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { $findMatchingParent } from "@lexical/utils";
import { IconExternalLink, IconLinkOff, IconPencil } from "@tabler/icons-react";
import {
  $getNearestNodeFromDOMNode,
  $isTextNode,
  getNearestEditorFromDOMNode,
  type LexicalEditor,
} from "lexical";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type MouseEvent,
} from "react";

import { MarkdownCodeBlockNavigation, markdownCodeBlockDescriptor } from "./markdownCodeBlockEditor";
import { clipboardImageFile } from "../lib/clipboardImage";
import { markdownMathPlugin } from "./markdownMathPlugin";
import { MarkdownPreview } from "./MarkdownPreview";
import { markdownTableKeyboardPlugin } from "./markdownTableKeyboardPlugin";
import {
  MERMAID_WIDTH_MAX,
  MERMAID_WIDTH_MIN,
  MERMAID_WIDTH_STEP,
  mermaidWidthFromMeta,
  withMermaidWidthMeta,
} from "../lib/mermaidWidth";
import {
  applyCalloutDecorations,
  applyHeadingNumberAttributes,
  CALLOUT_INPUT_PLACEHOLDER,
  HEADING_NUMBER_LEVELS,
  INSIGHT_CALLOUT_SNIPPET,
  insertStructuredMarkdownPaste,
  isStructuredMarkdownPaste,
  normalizeHeadingNumberLevels,
  normalizeHeadingNumberStart,
  normalizeRichEditorMarkdown,
  escapeAmbiguousMarkdownComparisons,
  openSafeMarkdownLink,
  renderMarkdownPreview,
  safeMarkdownLinkUrl,
  restoreAmbiguousMarkdownComparisons,
  type MarkdownRenderOptions,
} from "../lib/markdown";

type MarkdownRichEditorProps = {
  markdown: string;
  onChange: (value: string) => void;
  onImageUpload: (file: File) => Promise<string>;
  onError: (message: string) => void;
  headingNumberOptions?: MarkdownRenderOptions;
  markdownSourceRef?: { current: (() => string) | null };
};

function InsertMemoCalloutButton({ onInsert }: { onInsert: () => void }) {
  return (
    <ButtonWithTooltip title="MEMOを挿入" onClick={onInsert}>
      <span className="note-toolbar-memo-label">MEMO</span>
    </ButtonWithTooltip>
  );
}

function selectInsertedMemoPlaceholder(root: HTMLElement | null): void {
  if (!root) return;
  const quotes = Array.from(root.querySelectorAll("blockquote")).reverse();
  const quote = quotes.find((candidate) => {
    const paragraphs = candidate.querySelectorAll(":scope > p");
    if (
      paragraphs.length >= 2
      && paragraphs[0]?.textContent?.trim() === "[!INSIGHT]"
      && paragraphs[1]?.textContent === CALLOUT_INPUT_PLACEHOLDER
    ) return true;
    return candidate.textContent?.trim() === `[!INSIGHT]\n${CALLOUT_INPUT_PLACEHOLDER}`;
  });
  if (!quote) return;

  const walker = document.createTreeWalker(quote, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const start = node.nodeValue?.lastIndexOf(CALLOUT_INPUT_PLACEHOLDER) ?? -1;
    if (start < 0) continue;
    const lexicalEditor = getNearestEditorFromDOMNode(node);
    if (!lexicalEditor) return;
    lexicalEditor.update(() => {
      const lexicalNode = $getNearestNodeFromDOMNode(node);
      if ($isTextNode(lexicalNode)) {
        lexicalNode.select(start, start + CALLOUT_INPUT_PLACEHOLDER.length);
      }
    }, { discrete: true });
    lexicalEditor.focus();
    return;
  }
}

function MermaidCodeBlockEditor(props: CodeBlockEditorProps) {
  const [editing, setEditing] = useState(false);
  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const { parentEditor, setMeta } = useCodeBlockEditorContext();
  const savedWidth = mermaidWidthFromMeta(props.meta);
  const rangeWidth = savedWidth ?? MERMAID_WIDTH_MAX;
  const updateWidth = (width: number | null): void => {
    setMeta(withMermaidWidthMeta(props.meta, width));
    // MDXEditor 4.0.4 の setMeta は root の onChange を通知しないため、
    // コード本文の更新と同じ nested-editor command を明示的に送る。
    window.setTimeout(() => {
      parentEditor.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, undefined);
    }, 0);
  };
  const rendered = useMemo(
    () => renderMarkdownPreview(`\`\`\`mermaid${props.meta ? ` ${props.meta}` : ""}\n${props.code}\n\`\`\``),
    [props.code, props.meta],
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
    <div className="note-mermaid-code-block is-preview">
      <div
        className="note-mermaid-preview-frame"
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
      <div className="note-mermaid-width-control" aria-label="Mermaidの表示幅">
        <span>幅</span>
        <input
          type="range"
          min={MERMAID_WIDTH_MIN}
          max={MERMAID_WIDTH_MAX}
          step={MERMAID_WIDTH_STEP}
          value={rangeWidth}
          aria-label="Mermaidの表示幅"
          onPointerDown={() => {
            if (savedWidth === null) updateWidth(MERMAID_WIDTH_MAX);
          }}
          onChange={(event) => updateWidth(Number(event.target.value))}
        />
        <output>{savedWidth === null ? "自動" : `${savedWidth}%`}</output>
        <button
          type="button"
          disabled={savedWidth === null}
          onClick={() => updateWidth(null)}
        >
          自動
        </button>
      </div>
    </div>
  );
}

const mermaidCodeBlockDescriptor: CodeBlockEditorDescriptor = {
  priority: 10,
  match: (language) => String(language || "").toLowerCase() === "mermaid",
  Editor: MermaidCodeBlockEditor,
};

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

export const MarkdownRichEditor = memo(function MarkdownRichEditor({
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
  const onImageUploadRef = useRef(onImageUpload);
  const mountedRef = useRef(false);
  const editorMarkdown = escapeAmbiguousMarkdownComparisons(markdown);
  onImageUploadRef.current = onImageUpload;

  useEffect(() => {
    if (!markdownSourceRef) return;
    markdownSourceRef.current = () => normalizeRichEditorMarkdown(
      restoreAmbiguousMarkdownComparisons(editorRef.current?.getMarkdown() || lastInternalMarkdown.current),
    );
    return () => {
      markdownSourceRef.current = null;
    };
  }, [markdownSourceRef]);

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
          <InsertMemoCalloutButton
            onInsert={() => {
              const editor = editorRef.current;
              editor?.focus(() => {
                editor.insertMarkdown(INSIGHT_CALLOUT_SNIPPET);
                window.requestAnimationFrame(() => selectInsertedMemoPlaceholder(editorScopeRef.current));
              }, { preventScroll: true });
            }}
          />
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
      imageUploadHandler: (image) => onImageUploadRef.current(image),
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
  ], []);

  useEffect(() => {
    mountedRef.current = false;
    const timer = window.setTimeout(() => { mountedRef.current = true; }, 200);
    return () => window.clearTimeout(timer);
  }, []);

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
    // 通常の文字入力はLexicalのTextNode更新だけで、見出し番号・Callout構造は変わらない。
    // 長文で毎キー全文DOMを再走査しないよう、構造変更だけを監視する。
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      applyHeadingNumberAttributes(content(), false);
    };
  }, [headingNumbersEnabled, headingNumberStart, headingNumberLevelKey]);

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

