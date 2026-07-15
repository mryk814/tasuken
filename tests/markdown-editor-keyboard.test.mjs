import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mathPluginSource = readFileSync("src/renderer/src/features/workspace/components/markdownMathPlugin.tsx", "utf8");
const codeBlockSource = readFileSync("src/renderer/src/features/workspace/components/markdownCodeBlockEditor.tsx", "utf8");
const notesPageSource = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");

/**
 * $shouldMoveToVerticalCell と同等の「単一行なら常に移動」規則を検証する。
 * （Lexical なしの純粋条件）
 */
function shouldMoveToVerticalCell({ blockCount, textHasNewline, atFirstBlockStart, atLastBlockEnd, direction }) {
  if (blockCount === 0) return true;
  if (blockCount === 1 && !textHasNewline) return true;
  if (direction === "up") return atFirstBlockStart;
  return atLastBlockEnd;
}

test("表上下: 単一段落・改行なしなら常にセル移動", () => {
  assert.equal(shouldMoveToVerticalCell({
    blockCount: 1,
    textHasNewline: false,
    atFirstBlockStart: false,
    atLastBlockEnd: false,
    direction: "down",
  }), true);
  assert.equal(shouldMoveToVerticalCell({
    blockCount: 1,
    textHasNewline: false,
    atFirstBlockStart: false,
    atLastBlockEnd: false,
    direction: "up",
  }), true);
});

test("表上下: 複数行は境界だけ移動", () => {
  assert.equal(shouldMoveToVerticalCell({
    blockCount: 2,
    textHasNewline: false,
    atFirstBlockStart: false,
    atLastBlockEnd: true,
    direction: "down",
  }), true);
  assert.equal(shouldMoveToVerticalCell({
    blockCount: 2,
    textHasNewline: false,
    atFirstBlockStart: false,
    atLastBlockEnd: false,
    direction: "down",
  }), false);
  assert.equal(shouldMoveToVerticalCell({
    blockCount: 2,
    textHasNewline: false,
    atFirstBlockStart: true,
    atLastBlockEnd: false,
    direction: "up",
  }), true);
});

function codeBlockBoundaryDirection({ key, from, to, docLength }) {
  const atStart = from === 0 && to === 0;
  const atEnd = from === docLength && to === docLength;
  if ((key === "ArrowLeft" || key === "ArrowUp") && atStart) return "before";
  if ((key === "ArrowRight" || key === "ArrowDown") && atEnd) return "after";
  return null;
}

test("数式・コードブロック: 上下左右の端から隣へ入る経路を維持する", () => {
  assert.match(mathPluginSource, /\$isCodeBlockNode/);
  assert.match(mathPluginSource, /isNavigableBlock/);
  assert.match(mathPluginSource, /KEY_ARROW_DOWN_COMMAND/);
  assert.match(mathPluginSource, /KEY_ARROW_LEFT_COMMAND/);
  assert.match(mathPluginSource, /KEY_ARROW_RIGHT_COMMAND/);
  assert.match(mathPluginSource, /KEY_ARROW_UP_COMMAND/);
  assert.match(codeBlockSource, /EditorView\.findFromDOM/);
  assert.match(codeBlockSource, /priority: 2/);
  assert.match(codeBlockSource, /event\.stopPropagation\(\)/);
  assert.match(notesPageSource, /codeBlockEditorDescriptors: \[mermaidCodeBlockDescriptor, markdownCodeBlockDescriptor\]/);
});

test("コードブロック内の境界判定は4方向で行き先を飛び越さない", () => {
  for (const key of ["ArrowLeft", "ArrowUp"]) {
    assert.equal(codeBlockBoundaryDirection({ key, from: 0, to: 0, docLength: 12 }), "before");
    assert.equal(codeBlockBoundaryDirection({ key, from: 3, to: 3, docLength: 12 }), null);
  }
  for (const key of ["ArrowRight", "ArrowDown"]) {
    assert.equal(codeBlockBoundaryDirection({ key, from: 12, to: 12, docLength: 12 }), "after");
    assert.equal(codeBlockBoundaryDirection({ key, from: 9, to: 9, docLength: 12 }), null);
  }
});
