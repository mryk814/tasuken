import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mathPlugin = readFileSync("src/renderer/src/features/workspace/components/markdownMathPlugin.tsx", "utf8");
const richEditor = readFileSync("src/renderer/src/features/workspace/components/MarkdownRichEditor.tsx", "utf8");
const codeBlockEditor = readFileSync("src/renderer/src/features/workspace/components/markdownCodeBlockEditor.tsx", "utf8");
const markdownPreview = readFileSync("src/renderer/src/features/workspace/components/MarkdownPreview.tsx", "utf8");
const mermaid = readFileSync("src/renderer/src/features/workspace/lib/mermaid.ts", "utf8");
const notesPage = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
const css = readFileSync("src/renderer/src/styles/app.css", "utf8");

test("long rich notes keep whole-document and per-decorator work off each keystroke", () => {
  assert.match(mathPlugin, /dirtyLeaves\.keys\(\)/);
  assert.match(mathPlugin, /textContainsTransformableMarkdownMath/);
  assert.match(mathPlugin, /rootに1つだけ置き/);
  assert.doesNotMatch(
    mathPlugin.match(/function MathNodeView[\s\S]+?export class MarkdownMathNode/)?.[0] || "",
    /registerUpdateListener/,
  );
  assert.match(richEditor, /LONG_DOCUMENT_SPELLCHECK_LIMIT = 20_000/);
  assert.match(css, /content-visibility:\s*auto/);
  assert.match(css, /contain-intrinsic-block-size:\s*auto 1\.6rem/);
});

test("heavy decorators activate only near or during the user's current work", () => {
  assert.match(codeBlockEditor, /note-code-block-placeholder/);
  assert.match(codeBlockEditor, /onClick=\{\(\) => setActive\(true\)\}/);
  assert.match(markdownPreview, /IntersectionObserver/);
  assert.match(markdownPreview, /rootMargin:\s*"700px 0px"/);
  assert.match(mermaid, /waitForMermaidRenderIdle/);
  assert.match(mermaid, /performance\.now\(\) - lastEditorInputAt >= 450/);
});

test("dirty state is immediate even while Markdown snapshots stay deferred", () => {
  assert.match(richEditor, /onDirty\?\.\(\)/);
  assert.match(notesPage, /richEditorDirty \|\| draftBody !== selectedBody/);
  assert.match(notesPage, /onDirty=\{markRichEditorDirty\}/);
  assert.match(notesPage, /currentDraftBody\(\)/);
});
