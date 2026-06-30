import { useState, useCallback, useEffect, type JSX } from "react";
import {
  addExportVisitor$,
  addImportVisitor$,
  addLexicalNode$,
  addMdastExtension$,
  addComposerChild$,
  addSyntaxExtension$,
  addToMarkdownExtension$,
  realmPlugin,
  type LexicalExportVisitor,
  type MdastImportVisitor,
} from "@mdxeditor/editor";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $applyNodeReplacement,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getNodeByKey,
  $isElementNode,
  $isParagraphNode,
  DecoratorNode,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
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

const INLINE_MATH_PATTERN = /\$([^$\n]+)\$/g;
const BLOCK_MATH_PATTERN = /\$\$([\s\S]+?)\$\$/;

function $isMarkdownMathNode(node: LexicalNode | null | undefined): node is MarkdownMathNode {
  return node instanceof MarkdownMathNode;
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

  useEffect(() => {
    if (!editing) setDraft(expression);
  }, [expression, editing]);

  const focusInput = useCallback((el: HTMLTextAreaElement | HTMLInputElement | null) => {
    if (el) { el.focus(); el.select(); }
  }, []);

  const commit = useCallback(() => {
    setEditing(false);
    const value = draft.trim();
    if (!value) {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (node) node.remove();
      });
      return;
    }
    if (value !== expression) {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if ($isMarkdownMathNode(node)) {
          const w = node.getWritable() as MarkdownMathNode;
          w.__expression = value;
        }
      });
    }
  }, [draft, expression, nodeKey, editor]);

  const cancel = useCallback(() => {
    setEditing(false);
    setDraft(expression);
    if (!expression.trim()) {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (node) node.remove();
      });
    }
  }, [expression, nodeKey, editor]);

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
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") { e.preventDefault(); cancel(); }
              else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
            }}
            spellCheck={false}
            placeholder="数式を入力（例: x^2 + y^2 = r^2）"
          />
          {previewHtml && (
            <div className="note-editor-math-live-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          )}
          <span className="note-editor-math-hint">Ctrl+Enter で確定 · Escape でキャンセル</span>
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
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") { e.preventDefault(); cancel(); }
            else if (e.key === "Enter") { e.preventDefault(); commit(); }
          }}
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
    if (hasInlineMathDelimiter(text)) return true;
  }
  return false;
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

function transformInlineMath(paragraph: ParagraphNode): boolean {
  const text = paragraph.getTextContent();
  INLINE_MATH_PATTERN.lastIndex = 0;
  const matches = [...text.matchAll(INLINE_MATH_PATTERN)];
  if (!matches.length) return false;

  const nextNodes: LexicalNode[] = [];
  let cursor = 0;
  for (const match of matches) {
    const start = match.index ?? 0;
    const full = match[0] || "";
    const expression = (match[1] || "").trim();
    if (start > cursor) {
      nextNodes.push($createTextNode(text.slice(cursor, start)));
    }
    if (expression) {
      nextNodes.push($createMarkdownMathNode(expression, false));
    } else {
      nextNodes.push($createTextNode(full));
    }
    cursor = start + full.length;
  }
  if (cursor < text.length) {
    nextNodes.push($createTextNode(text.slice(cursor)));
  }
  paragraph.clear();
  paragraph.append(...nextNodes);
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

    if (transformInlineMath(node)) changed = true;
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
      [addComposerChild$]: MarkdownMathComposerPlugin,
      [addImportVisitor$]: MarkdownMathImportVisitor,
      [addExportVisitor$]: MarkdownMathExportVisitor,
    });
  },
});
