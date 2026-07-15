import { $isCodeBlockNode, CodeMirrorEditor, useCodeBlockEditorContext, type CodeBlockEditorDescriptor, type CodeBlockEditorProps } from "@mdxeditor/editor";
import { EditorView } from "@codemirror/view";
import { $getNodeByKey, type LexicalNode } from "lexical";
import { useCallback, type ReactNode } from "react";

import { $isMarkdownMathNode, $selectMathNode } from "./markdownMathPlugin";

type BoundaryDirection = "before" | "after";

function adjacentNode(node: LexicalNode, direction: BoundaryDirection): LexicalNode | null {
  return direction === "before" ? node.getPreviousSibling() : node.getNextSibling();
}

function moveToAdjacentBlock(
  nodeKey: string,
  direction: BoundaryDirection,
  parentEditor: ReturnType<typeof useCodeBlockEditorContext>["parentEditor"],
): void {
  parentEditor.update(() => {
    const node = $getNodeByKey(nodeKey);
    if (!$isCodeBlockNode(node)) return;

    const adjacent = adjacentNode(node, direction);
    if (!adjacent) return;
    if ($isMarkdownMathNode(adjacent)) {
      $selectMathNode(adjacent, direction === "before" ? "end" : "start");
      return;
    }
    if ($isCodeBlockNode(adjacent)) {
      adjacent.select();
      return;
    }
    if (direction === "before") node.selectPrevious();
    else node.selectNext();
  });
}

export function MarkdownCodeBlockNavigation({ nodeKey, children }: { nodeKey: string; children: ReactNode }) {
  const { parentEditor } = useCodeBlockEditorContext();

  const onKeyDownCapture = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "ArrowUp" && event.key !== "ArrowDown") return;

    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const view = EditorView.findFromDOM(target);
    if (!view) return;

    const { from, to } = view.state.selection.main;
    const atStart = from === 0 && to === 0;
    const atEnd = from === view.state.doc.length && to === view.state.doc.length;
    const direction: BoundaryDirection | null =
      ((event.key === "ArrowLeft" || event.key === "ArrowUp") && atStart) ? "before"
        : ((event.key === "ArrowRight" || event.key === "ArrowDown") && atEnd) ? "after"
          : null;
    if (!direction) return;

    const adjacent = parentEditor.getEditorState().read(() => {
      const node = $getNodeByKey(nodeKey);
      return node ? adjacentNode(node, direction) : null;
    });
    if (!adjacent) return;

    event.preventDefault();
    event.stopPropagation();
    view.contentDOM.blur();
    moveToAdjacentBlock(nodeKey, direction, parentEditor);
  }, [nodeKey, parentEditor]);

  return <div className="note-code-block-keyboard-navigation" onKeyDownCapture={onKeyDownCapture}>{children}</div>;
}

export function MarkdownCodeBlockEditor(props: CodeBlockEditorProps) {
  return (
    <MarkdownCodeBlockNavigation nodeKey={props.nodeKey}>
      <CodeMirrorEditor {...props} />
    </MarkdownCodeBlockNavigation>
  );
}

export const markdownCodeBlockDescriptor: CodeBlockEditorDescriptor = {
  // codeMirrorPlugin の標準 descriptor (priority 1) より先に、端のキー移動を捕捉する。
  priority: 2,
  match: () => true,
  Editor: MarkdownCodeBlockEditor,
};
