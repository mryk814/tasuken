import assert from "node:assert/strict";
import test from "node:test";

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
