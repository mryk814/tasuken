import { useState, useCallback, useEffect, useRef, type JSX, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  addExportVisitor$,
  addImportVisitor$,
  addLexicalNode$,
  addMdastExtension$,
  addComposerChild$,
  addSyntaxExtension$,
  addToMarkdownExtension$,
  realmPlugin,
  $isCodeBlockNode,
  type LexicalExportVisitor,
  type MdastImportVisitor,
  type CodeBlockNode,
} from "@mdxeditor/editor";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  $applyNodeReplacement,
  $createNodeSelection,
  $createParagraphNode,
  $createTextNode,
  $getAdjacentNode,
  $getRoot,
  $getNodeByKey,
  $getSelection,
  $isElementNode,
  $isNodeSelection,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  DecoratorNode,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ARROW_UP_COMMAND,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
  type TextNode,
} from "lexical";
import { mathFromMarkdown, mathToMarkdown, type InlineMath as InlineMathMdastNode, type Math as MathMdastNode } from "mdast-util-math";
import { math } from "micromark-extension-math";

import { normalizeMathExpression, renderMathExpression } from "../lib/markdown";

type SerializedMarkdownMathNode = Spread<{
  expression: string;
  displayMode: boolean;
  type: "markdown-math";
  version: 1;
}, SerializedLexicalNode>;

type MarkdownMathMdastNode = MathMdastNode | InlineMathMdastNode;
type ParagraphNode = ReturnType<typeof import("lexical").$createParagraphNode>;

// renderMarkdownPreview のインライン数式規約と揃える（開き$直後・閉じ$直前は空白不可、閉じ$直後に数字を続けない）。
const INLINE_MATH_PATTERN = /\$([^\s$](?:[^$\n]*[^\s$])?)\$(?!\d)/g;
const BLOCK_MATH_PATTERN = /\$\$([\s\S]+?)\$\$/;

export function $isMarkdownMathNode(node: LexicalNode | null | undefined): node is MarkdownMathNode {
  return node instanceof MarkdownMathNode;
}

const MATH_AUTOSAVE_MS = 350;

/** 矢印で数式へ入るときのキャレット位置（キー → start/end） */
const pendingMathEntryCaret = new Map<NodeKey, "start" | "end" | "all">();

export function $selectMathNode(node: MarkdownMathNode, caret: "start" | "end" | "all" = "all"): void {
  pendingMathEntryCaret.set(node.getKey(), caret);
  const selection = $createNodeSelection();
  selection.add(node.getKey());
  $setSelection(selection);
}

/**
 * 数式の直前/直後へ折りたたみキャレットを置く。
 * selectNext() 無引数は次 Text の「末尾」に飛ぶ（Lexical 既定）ため使わない。
 */
function $placeCaretBesideMath(node: MarkdownMathNode, side: "before" | "after"): void {
  if (side === "after") {
    const next = node.getNextSibling();
    if ($isTextNode(next)) {
      next.select(0, 0);
      return;
    }
    if (next === null) {
      // 末尾に空テキストを足して、段落全体 select を避ける
      const spacer = $createTextNode("");
      node.insertAfter(spacer);
      spacer.select(0, 0);
      return;
    }
    if ($isElementNode(next)) {
      next.selectStart();
      return;
    }
    // 別 decorator 等: そのノードの直前（親 offset）
    const parent = node.getParentOrThrow();
    const index = next.getIndexWithinParent();
    parent.select(index, index);
    return;
  }

  const prev = node.getPreviousSibling();
  if ($isTextNode(prev)) {
    const size = prev.getTextContentSize();
    prev.select(size, size);
    return;
  }
  if (prev === null) {
    const spacer = $createTextNode("");
    node.insertBefore(spacer);
    spacer.select(0, 0);
    return;
  }
  if ($isElementNode(prev)) {
    prev.selectEnd();
    return;
  }
  const parent = node.getParentOrThrow();
  const index = node.getIndexWithinParent();
  parent.select(index, index);
}

function $isAtBlockEdge(direction: "start" | "end"): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
  const anchor = selection.anchor;
  const node = anchor.getNode();
  const top = node.getTopLevelElement();
  if (!top) return false;

  if (direction === "start") {
    const first = top.getFirstDescendant();
    if (!first) return true;
    if (node.getKey() !== first.getKey()) return false;
    return anchor.offset === 0;
  }

  const last = top.getLastDescendant();
  if (!last) return true;
  if (node.getKey() !== last.getKey()) return false;
  if ($isTextNode(node)) return anchor.offset === node.getTextContentSize();
  if ($isElementNode(node)) return anchor.offset === node.getChildrenSize();
  return true;
}

function MarkdownMathKeyboardPlugin() {
  const [editor] = useLexicalComposerContext();

  const isNavigableBlock = (node: LexicalNode | null | undefined): node is MarkdownMathNode | CodeBlockNode => {
    return $isMarkdownMathNode(node) || $isCodeBlockNode(node);
  };

  const enterNavigableBlock = (node: MarkdownMathNode | CodeBlockNode, caret: "start" | "end"): void => {
    if ($isCodeBlockNode(node)) {
      node.select();
      return;
    }
    $selectMathNode(node, caret);
  };

  useEffect(() => {
    const enterAdjacentBlock = (
      event: globalThis.KeyboardEvent,
      backward: boolean,
      caret: "start" | "end",
    ): boolean => {
      if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false;
      if (event.isComposing || editor.isComposing()) return false;

      const selection = $getSelection();
      if ($isNodeSelection(selection)) {
        const nodes = selection.getNodes();
        if (nodes.length === 1 && isNavigableBlock(nodes[0])) {
          // すでにブロックが選ばれている → 編集へ。
          event.preventDefault();
          enterNavigableBlock(nodes[0], caret);
          return true;
        }
      }
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;

      const adjacent = $getAdjacentNode(selection.focus, backward);
      if (isNavigableBlock(adjacent)) {
        event.preventDefault();
        enterNavigableBlock(adjacent, caret);
        return true;
      }
      return false;
    };

    return mergeRegister(
      editor.registerCommand(
        KEY_ARROW_RIGHT_COMMAND,
        (event) => enterAdjacentBlock(event, false, "start"),
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ARROW_LEFT_COMMAND,
        (event) => enterAdjacentBlock(event, true, "end"),
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (event) => {
          if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false;
          if (event.isComposing || editor.isComposing()) return false;
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
          if (!$isAtBlockEdge("end")) return false;
          const top = selection.anchor.getNode().getTopLevelElement();
          const next = top?.getNextSibling();
          if (!isNavigableBlock(next) || ($isMarkdownMathNode(next) && !next.getDisplayMode())) return false;
          event.preventDefault();
          enterNavigableBlock(next, "start");
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        (event) => {
          if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false;
          if (event.isComposing || editor.isComposing()) return false;
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
          if (!$isAtBlockEdge("start")) return false;
          const top = selection.anchor.getNode().getTopLevelElement();
          const prev = top?.getPreviousSibling();
          if (!isNavigableBlock(prev) || ($isMarkdownMathNode(prev) && !prev.getDisplayMode())) return false;
          event.preventDefault();
          enterNavigableBlock(prev, "end");
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    );
  }, [editor]);

  return null;
}

function MathNodeView({
  expression,
  displayMode,
  nodeKey,
  editor,
}: {
  expression: string;
  displayMode: boolean;
  nodeKey: NodeKey;
  editor: LexicalEditor;
}) {
  const [editing, setEditing] = useState(() => !expression.trim());
  const [draft, setDraft] = useState(expression);
  /** キーボードで入ったとき、キャレットを先頭/末尾のどちらに置くか */
  const [entryCaret, setEntryCaret] = useState<"start" | "end" | "all">("all");
  /** blur と Arrow 退出で finish が二重に走らないようにする */
  const closingRef = useRef(false);

  useEffect(() => {
    // 編集中はローカル draft を正本にし、自動保存で expression が変わっても入力を潰さない。
    if (!editing) setDraft(expression);
  }, [expression, editing]);

  // NodeSelection（矢印で数式に到達）したら編集モードへ。
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isNodeSelection(selection) || !selection.has(nodeKey)) return;
        const caret = pendingMathEntryCaret.get(nodeKey) ?? "all";
        pendingMathEntryCaret.delete(nodeKey);
        closingRef.current = false;
        setDraft(expression);
        setEntryCaret(caret);
        setEditing(true);
      });
    });
  }, [editor, expression, nodeKey]);

  const focusInput = useCallback((el: HTMLTextAreaElement | HTMLInputElement | null) => {
    if (!el) return;
    el.focus();
    const len = el.value.length;
    if (entryCaret === "start") el.setSelectionRange(0, 0);
    else if (entryCaret === "end") el.setSelectionRange(len, len);
    else el.select();
  }, [entryCaret]);

  const writeExpression = useCallback((value: string) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isMarkdownMathNode(node)) {
        const w = node.getWritable() as MarkdownMathNode;
        w.__expression = value;
      }
    });
  }, [nodeKey, editor]);

  const removeNode = useCallback(() => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node) node.remove();
    });
  }, [nodeKey, editor]);

  // 入力中も debounce でノードへ反映 → ノート全体の自動保存に載せる。
  useEffect(() => {
    if (!editing) return;
    const value = draft.trim();
    if (!value || value === expression) return;
    const timer = window.setTimeout(() => {
      writeExpression(normalizeMathExpression(value));
    }, MATH_AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, editing, expression, writeExpression]);

  const finish = useCallback((exit: "before" | "after" | "none" = "none") => {
    if (closingRef.current) return;
    closingRef.current = true;
    setEditing(false);
    const value = draft.trim();
    if (!value) {
      removeNode();
      return;
    }
    const normalized = normalizeMathExpression(value);
    // 式の書き込みとキャレット配置を同一 update にまとめ、selectNext の末尾ジャンプを避ける
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (!$isMarkdownMathNode(node)) return;
      if (normalized !== expression) {
        const writable = node.getWritable() as MarkdownMathNode;
        writable.__expression = normalized;
      }
      if (exit === "none") return;
      const latest = $getNodeByKey(nodeKey);
      if ($isMarkdownMathNode(latest)) {
        $placeCaretBesideMath(latest, exit === "before" ? "before" : "after");
      }
    }, {
      onUpdate: () => {
        if (exit === "none") return;
        editor.focus();
      },
    });
  }, [draft, expression, editor, nodeKey, removeNode]);

  const cancel = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setEditing(false);
    setDraft(expression);
    if (!expression.trim()) {
      removeNode();
      return;
    }
    queueMicrotask(() => {
      editor.focus();
    });
  }, [editor, expression, removeNode]);

  const onMathKeyDown = useCallback((e: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.stopPropagation();
    if (e.nativeEvent.isComposing) return;

    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
      return;
    }

    const target = e.currentTarget;
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? 0;
    const atStart = start === 0 && end === 0;
    const atEnd = start === target.value.length && end === target.value.length;

    if (e.key === "ArrowLeft" && atStart && !e.shiftKey) {
      e.preventDefault();
      finish("before");
      return;
    }
    if (e.key === "ArrowRight" && atEnd && !e.shiftKey) {
      e.preventDefault();
      finish("after");
      return;
    }
    // ブロック数式: 先頭行で↑ / 最終行で↓ も本文へ戻す
    if (displayMode && e.key === "ArrowUp" && atStart && !e.shiftKey) {
      e.preventDefault();
      finish("before");
      return;
    }
    if (displayMode && e.key === "ArrowDown" && atEnd && !e.shiftKey) {
      e.preventDefault();
      finish("after");
      return;
    }

    if (displayMode) {
      // Enter は改行用。確定は自動保存 + フォーカスを外す（Ctrl/Cmd+Enter でも閉じる）。
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        finish("after");
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      finish("after");
    }
  }, [cancel, displayMode, finish]);

  if (editing) {
    const previewHtml = draft.trim()
      ? renderMathExpression(normalizeMathExpression(draft.trim()), displayMode)
      : "";

    if (displayMode) {
      return (
        <div className="note-editor-math-block note-editor-math-editing" contentEditable={false}>
          <textarea
            ref={focusInput}
            className="note-editor-math-input"
            value={draft}
            rows={Math.max(2, draft.split("\n").length + 1)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => finish("none")}
            onKeyDown={onMathKeyDown}
            spellCheck={false}
            placeholder="数式を入力（例: x^2 + y^2 = r^2）"
          />
          {previewHtml && (
            <div className="note-editor-math-live-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          )}
          <span className="note-editor-math-hint">入力は自動で保存されます · Escape でキャンセル</span>
        </div>
      );
    }

    return (
      <span className="note-editor-math-inline note-editor-math-editing" contentEditable={false}>
        <input
          ref={focusInput}
          className="note-editor-math-input"
          type="text"
          value={draft}
          size={Math.max(8, draft.length + 2)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => finish("none")}
          onKeyDown={onMathKeyDown}
          spellCheck={false}
          placeholder="数式"
        />
      </span>
    );
  }

  const Tag = displayMode ? "div" : "span";
  return (
    <Tag
      className={`${displayMode ? "note-editor-math-block" : "note-editor-math-inline"} note-editor-math-clickable`}
      title={`${expression}\nクリックして編集`}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        setDraft(expression);
        setEntryCaret("all");
        setEditing(true);
      }}
      dangerouslySetInnerHTML={{ __html: renderMathExpression(expression, displayMode) }}
    />
  );
}

export class MarkdownMathNode extends DecoratorNode<JSX.Element> {
  __expression: string;
  __displayMode: boolean;

  static getType(): string {
    return "markdown-math";
  }

  static clone(node: MarkdownMathNode): MarkdownMathNode {
    return new MarkdownMathNode(node.__expression, node.__displayMode, node.__key);
  }

  static importJSON(serializedNode: SerializedMarkdownMathNode): MarkdownMathNode {
    return $createMarkdownMathNode(serializedNode.expression, serializedNode.displayMode);
  }

  constructor(expression: string, displayMode: boolean, key?: NodeKey) {
    super(key);
    this.__expression = expression;
    this.__displayMode = displayMode;
  }

  exportJSON(): SerializedMarkdownMathNode {
    return {
      expression: this.__expression,
      displayMode: this.__displayMode,
      type: "markdown-math",
      version: 1,
    };
  }

  createDOM(_config: EditorConfig, _editor: LexicalEditor): HTMLElement {
    return document.createElement(this.__displayMode ? "div" : "span");
  }

  updateDOM(): false {
    return false;
  }

  isInline(): boolean {
    return !this.__displayMode;
  }

  getExpression(): string {
    return this.__expression;
  }

  getDisplayMode(): boolean {
    return this.__displayMode;
  }

  decorate(editor: LexicalEditor, _config: EditorConfig): JSX.Element {
    return (
      <MathNodeView
        expression={this.__expression}
        displayMode={this.__displayMode}
        nodeKey={this.__key}
        editor={editor}
      />
    );
  }
}

function $createMarkdownMathNode(expression: string, displayMode: boolean): MarkdownMathNode {
  return $applyNodeReplacement(new MarkdownMathNode(normalizeMathExpression(expression), displayMode));
}

function isPlainTextParagraph(node: LexicalNode): node is ParagraphNode {
  return $isParagraphNode(node) && node.getChildren().every((child) => {
    const type = child.getType();
    return type === "text" || type === "linebreak";
  });
}

function hasInlineMathDelimiter(text: string): boolean {
  INLINE_MATH_PATTERN.lastIndex = 0;
  return INLINE_MATH_PATTERN.test(text);
}

// リスト項目・引用など、通常段落以外のテキストも対象にするため、ツリー全体からインライン数式候補を集める。
// $$を含むテキストはブロック数式の変換に任せる。インラインコードは数式に変換しない。
function $collectInlineMathTextNodes(node: LexicalNode, out: TextNode[]): void {
  if ($isTextNode(node)) {
    const text = node.getTextContent();
    if (!node.hasFormat("code") && !text.includes("$$") && hasInlineMathDelimiter(text)) {
      out.push(node);
    }
    return;
  }
  if ($isElementNode(node)) {
    for (const child of node.getChildren()) {
      $collectInlineMathTextNodes(child, out);
    }
  }
}

function hasTransformableMarkdownMath(): boolean {
  const children = $getRoot().getChildren();
  let openBlockIndex = -1;
  for (let index = 0; index < children.length; index += 1) {
    const node = children[index];
    if (!isPlainTextParagraph(node)) continue;
    const text = node.getTextContent();
    const trimmed = text.trim();
    if (BLOCK_MATH_PATTERN.test(text)) return true;
    if (trimmed === "$$") {
      if (openBlockIndex >= 0) return true;
      openBlockIndex = index;
      continue;
    }
  }
  const inlineTargets: TextNode[] = [];
  $collectInlineMathTextNodes($getRoot(), inlineTargets);
  return inlineTargets.length > 0;
}

function createPlainParagraphs(text: string): ParagraphNode[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode(line));
      return paragraph;
    });
}

function transformBlockMathInParagraph(paragraph: ParagraphNode): boolean {
  const text = paragraph.getTextContent();
  const match = text.match(BLOCK_MATH_PATTERN);
  if (!match) return false;

  const full = match[0] || "";
  const expression = (match[1] || "").trim();
  const start = match.index ?? 0;
  if (!expression) return false;

  const before = text.slice(0, start);
  const after = text.slice(start + full.length);
  const nextNodes: LexicalNode[] = [
    ...createPlainParagraphs(before),
    $createMarkdownMathNode(expression, true),
    ...createPlainParagraphs(after),
  ];
  for (const nextNode of nextNodes) {
    paragraph.insertBefore(nextNode);
  }
  paragraph.remove();
  return true;
}

function transformInlineMathInTextNode(textNode: TextNode): boolean {
  const text = textNode.getTextContent();
  INLINE_MATH_PATTERN.lastIndex = 0;
  const matches = [...text.matchAll(INLINE_MATH_PATTERN)];
  if (!matches.length) return false;

  const format = textNode.getFormat();
  const plainText = (value: string) => {
    const node = $createTextNode(value);
    node.setFormat(format);
    return node;
  };
  const nextNodes: LexicalNode[] = [];
  let cursor = 0;
  for (const match of matches) {
    const start = match.index ?? 0;
    const full = match[0] || "";
    const expression = (match[1] || "").trim();
    if (start > cursor) {
      nextNodes.push(plainText(text.slice(cursor, start)));
    }
    if (expression) {
      nextNodes.push($createMarkdownMathNode(expression, false));
    } else {
      nextNodes.push(plainText(full));
    }
    cursor = start + full.length;
  }
  if (cursor < text.length) {
    nextNodes.push(plainText(text.slice(cursor)));
  }

  const selection = $getSelection();
  const hadCaretInNode = $isRangeSelection(selection)
    && (selection.anchor.getNode().getKey() === textNode.getKey() || selection.focus.getNode().getKey() === textNode.getKey());
  let caretTarget = nextNodes[nextNodes.length - 1];
  if (hadCaretInNode && !$isTextNode(caretTarget)) {
    caretTarget = plainText("");
    nextNodes.push(caretTarget);
  }
  for (const nextNode of nextNodes) {
    textNode.insertBefore(nextNode);
  }
  textNode.remove();
  if (hadCaretInNode && $isTextNode(caretTarget)) {
    caretTarget.select();
  }
  return true;
}

function transformMarkdownMathDelimiters(): boolean {
  const children = $getRoot().getChildren();
  let changed = false;

  for (let index = 0; index < children.length; index += 1) {
    const node = children[index];
    if (!isPlainTextParagraph(node)) continue;

    if (transformBlockMathInParagraph(node)) {
      changed = true;
      continue;
    }

    if (node.getTextContent().trim() === "$$") {
      let endIndex = -1;
      const expressionLines: string[] = [];
      for (let cursor = index + 1; cursor < children.length; cursor += 1) {
        const candidate = children[cursor];
        if (!isPlainTextParagraph(candidate)) break;
        const text = candidate.getTextContent();
        if (text.trim() === "$$") {
          endIndex = cursor;
          break;
        }
        expressionLines.push(text);
      }
      const expression = expressionLines.join("\n").trim();
      if (endIndex > index && expression) {
        node.insertBefore($createMarkdownMathNode(expression, true));
        for (let removeIndex = index; removeIndex <= endIndex; removeIndex += 1) {
          children[removeIndex].remove();
        }
        changed = true;
        index = endIndex;
      }
      continue;
    }
  }

  const inlineTargets: TextNode[] = [];
  $collectInlineMathTextNodes($getRoot(), inlineTargets);
  for (const target of inlineTargets) {
    if (transformInlineMathInTextNode(target)) changed = true;
  }

  return changed;
}

function MarkdownMathComposerPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    let transforming = false;
    let pendingFrame: number | null = null;

    function transformIfNeeded() {
      pendingFrame = null;
      if (transforming) return;
      let shouldTransform = false;
      editor.getEditorState().read(() => {
        shouldTransform = hasTransformableMarkdownMath();
      });
      if (!shouldTransform) return;
      transforming = true;
      editor.update(() => {
        transformMarkdownMathDelimiters();
      });
      transforming = false;
    }

    function scheduleTransform() {
      if (pendingFrame !== null) return;
      pendingFrame = window.requestAnimationFrame(transformIfNeeded);
    }

    scheduleTransform();
    const unregister = editor.registerUpdateListener(scheduleTransform);
    return () => {
      unregister();
      if (pendingFrame !== null) {
        window.cancelAnimationFrame(pendingFrame);
      }
    };
  }, [editor]);

  return null;
}

const MarkdownMathImportVisitor: MdastImportVisitor<MarkdownMathMdastNode> = {
  testNode: (node) => node.type === "math" || node.type === "inlineMath",
  visitNode({ mdastNode, lexicalParent }) {
    if ($isElementNode(lexicalParent)) {
      lexicalParent.append($createMarkdownMathNode(String(mdastNode.value || ""), mdastNode.type === "math"));
    }
  },
  priority: 20,
};

const MarkdownMathExportVisitor: LexicalExportVisitor<MarkdownMathNode, MarkdownMathMdastNode> = {
  testLexicalNode: $isMarkdownMathNode,
  visitLexicalNode({ lexicalNode, mdastParent, actions }) {
    actions.appendToParent(mdastParent, {
      type: lexicalNode.getDisplayMode() ? "math" : "inlineMath",
      value: lexicalNode.getExpression(),
    } as never);
  },
};

export const markdownMathPlugin = realmPlugin({
  init(realm) {
    realm.pubIn({
      [addSyntaxExtension$]: math({ singleDollarTextMath: true }),
      [addMdastExtension$]: mathFromMarkdown(),
      [addToMarkdownExtension$]: mathToMarkdown({ singleDollarTextMath: true }),
      [addLexicalNode$]: MarkdownMathNode,
      [addComposerChild$]: [MarkdownMathComposerPlugin, MarkdownMathKeyboardPlugin],
      [addImportVisitor$]: MarkdownMathImportVisitor,
      [addExportVisitor$]: MarkdownMathExportVisitor,
    });
  },
});
