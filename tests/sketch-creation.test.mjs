import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const canvas = readFileSync("src/renderer/src/features/workspace/components/SketchCanvas.tsx", "utf8");
const page = readFileSync("src/renderer/src/features/workspace/pages/SketchPage.tsx", "utf8");

test("Sketchの自動保存は成功トーストを出さず、画面内の保存状態だけを更新する", () => {
  assert.match(page, /saveEntity\("sketch", \{[\s\S]*?document,[\s\S]*?\}, \{ quiet: true \}\)/);
  assert.match(page, /setSaveState\("自動保存済み"\)/);
  assert.match(page, /Sketchを保存できませんでした/);
});

test("Shape Arrow and Text remain active after creating an object", () => {
  const pointerUp = canvas.match(/function onPointerUp\([\s\S]*?function onPointerCancel/)?.[0] || "";
  const shapeBranch = pointerUp.match(/if \(tool === "shape"\)([\s\S]*?)if \(tool === "arrow"\)/)?.[1] || "";
  const arrowBranch = pointerUp.match(/if \(tool === "arrow"\)([\s\S]*?)function onPointerCancel/)?.[1] || "";
  const textCommit = canvas.match(/function commitText\(\)([\s\S]*?)function onPaste/)?.[1] || "";
  assert.doesNotMatch(shapeBranch, /onToolChange\("select"\)/);
  assert.doesNotMatch(arrowBranch, /onToolChange\("select"\)/);
  assert.doesNotMatch(textCommit, /onToolChange\("select"\)/);
});

test("creation tools keep creating over existing objects", () => {
  assert.doesNotMatch(canvas, /\["shape", "arrow", "text"\]\.includes\(tool\)/);
  const pointerUp = canvas.match(/function onPointerUp\([\s\S]*?function onPointerCancel/)?.[0] || "";
  const shapeBranch = pointerUp.match(/if \(tool === "shape"\)([\s\S]*?)if \(tool === "arrow"\)/)?.[1] || "";
  assert.doesNotMatch(shapeBranch, /hitTest/);
  assert.doesNotMatch(shapeBranch, /onToolChange/);
});

test("Text visibly edits in place and commits with Enter or blur", () => {
  assert.match(canvas, /className="sketch-inline-text"/);
  assert.match(canvas, /function startTextEditing/);
  assert.match(canvas, /onDoubleClick=\{onDoubleClick\}/);
  assert.match(canvas, /page\.objects\.map\(\(entry\) => entry\.id === editor\.id \? object : entry\)/);
  assert.match(canvas, /onBlur=\{commitText\}/);
  assert.match(canvas, /if \(!textEditor \|\| textCommitRef\.current\) return/);
  assert.match(canvas, /textCommitRef\.current = true/);
  assert.match(canvas, /event\.key === "Enter" && !event\.shiftKey && !event\.nativeEvent\.isComposing/);
  assert.match(canvas, /event\.preventDefault\(\);\s*commitText\(\)/);
});

test("clipboard images paste at the latest canvas pointer", () => {
  assert.match(canvas, /clipboardImageFile\(event\.clipboardData\)/);
  assert.match(canvas, /onPasteImage\(image, lastPointerRef\.current\)/);
  assert.match(canvas, /tabIndex=\{0\}/);
  assert.match(canvas, /onPaste=\{onPaste\}/);
  assert.match(page, /onPasteImage=\{\(file, point\) => void insertImage\(file, point\)\}/);
  assert.match(page, /point\.x - width \/ 2/);
});

test("canceling the image picker returns to Select", () => {
  assert.match(page, /input\.addEventListener\("cancel", handleCancel\)/);
  assert.match(page, /const handleCancel = \(\) => setTool\("select"\)/);
  assert.match(page, /if \(!file\) setTool\("select"\)/);
});
