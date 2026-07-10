import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_CRITICAL,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
} from "lexical";
import { useEffect } from "react";
import { addTableCellEditorChild$, realmPlugin } from "@mdxeditor/editor";

/**
 * セル内が実質1ブロック（通常）なら常に上下セルへ。
 * 複数段落・改行があるときだけ、先頭/末尾にいる場合に限る。
 */
export function $shouldMoveToVerticalCell(direction: "up" | "down"): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;

  const root = $getRoot();
  const blocks = root.getChildren();
  if (blocks.length === 0) return true;

  // 単一段落で改行なし → 常にセル移動（MDX 表は Enter で改行できない）
  if (blocks.length === 1) {
    const only = blocks[0];
    const text = only.getTextContent();
    if (!text.includes("\n")) return true;
  }

  const anchor = selection.anchor;
  const anchorNode = anchor.getNode();
  const top = $isElementNode(anchorNode) && !anchorNode.isInline()
    ? anchorNode
    : anchorNode.getTopLevelElement();
  if (!top) return true;

  if (direction === "up") {
    const first = blocks[0];
    if (top.getKey() !== first.getKey()) return false;
    const firstLeaf = $isElementNode(first) ? (first.getFirstDescendant() ?? first) : first;
    if (anchorNode.getKey() !== firstLeaf.getKey() && anchorNode.getKey() !== first.getKey()) return false;
    return anchor.offset === 0;
  }

  const last = blocks[blocks.length - 1];
  if (top.getKey() !== last.getKey()) return false;
  const lastLeaf = $isElementNode(last) ? (last.getLastDescendant() ?? last) : last;
  if (anchorNode.getKey() !== lastLeaf.getKey() && anchorNode.getKey() !== last.getKey()) return false;
  if ($isTextNode(anchorNode)) return anchor.offset === anchorNode.getTextContentSize();
  if ($isElementNode(anchorNode)) return anchor.offset === anchorNode.getChildrenSize();
  return true;
}

function tryVerticalCellMove(
  editor: ReturnType<typeof useLexicalComposerContext>[0],
  direction: "up" | "down",
  event: KeyboardEvent,
): boolean {
  if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false;
  if (event.isComposing || editor.isComposing()) return false;

  let shouldMove = false;
  editor.getEditorState().read(() => {
    shouldMove = $shouldMoveToVerticalCell(direction);
  });
  if (!shouldMove) return false;

  event.preventDefault();
  event.stopPropagation();

  // CellEditor の KEY_ENTER（下）/ Shift+Enter（上）と同じ saveAndFocus 経路を使う
  const synthetic = new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    shiftKey: direction === "up",
    bubbles: true,
    cancelable: true,
  });
  editor.dispatchCommand(KEY_ENTER_COMMAND, synthetic);
  return true;
}

/**
 * 表セルの ↑↓ を、既存の Enter / Shift+Enter と同じ「上下セル移動」に載せる。
 * コマンドと DOM capture の両方で拾い、ネスト editor でも取りこぼしにくくする。
 */
function TableCellArrowNavigation() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const onDomKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        tryVerticalCellMove(editor, "down", event);
      } else if (event.key === "ArrowUp") {
        tryVerticalCellMove(editor, "up", event);
      }
    };

    const unregisterRoot = editor.registerRootListener((rootElement, prevRootElement) => {
      if (prevRootElement) {
        prevRootElement.removeEventListener("keydown", onDomKeyDown, true);
      }
      if (rootElement) {
        rootElement.addEventListener("keydown", onDomKeyDown, true);
      }
    });

    const unregisterUp = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (event) => tryVerticalCellMove(editor, "up", event),
      COMMAND_PRIORITY_CRITICAL,
    );
    const unregisterDown = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      (event) => tryVerticalCellMove(editor, "down", event),
      COMMAND_PRIORITY_CRITICAL,
    );

    return () => {
      unregisterRoot();
      unregisterUp();
      unregisterDown();
      const root = editor.getRootElement();
      if (root) root.removeEventListener("keydown", onDomKeyDown, true);
    };
  }, [editor]);

  return null;
}

export const markdownTableKeyboardPlugin = realmPlugin({
  init(realm) {
    realm.pubIn({
      [addTableCellEditorChild$]: TableCellArrowNavigation,
    });
  },
});
