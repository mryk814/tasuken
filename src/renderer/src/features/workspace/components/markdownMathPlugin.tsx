import { useState, useCallback, useEffect, type JSX } from "react";
import {
  addExportVisitor$,
  addImportVisitor$,
  addLexicalNode$,
  addMdastExtension$,
  addSyntaxExtension$,
  addToMarkdownExtension$,
  realmPlugin,
  type LexicalExportVisitor,
  type MdastImportVisitor,
} from "@mdxeditor/editor";
import {
  $applyNodeReplacement,
  $getNodeByKey,
  $isElementNode,
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
  return $applyNodeReplacement(new MarkdownMathNode(expression, displayMode));
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
      [addImportVisitor$]: MarkdownMathImportVisitor,
      [addExportVisitor$]: MarkdownMathExportVisitor,
    });
  },
});
