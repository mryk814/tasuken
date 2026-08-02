import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const notes = read("src/renderer/src/features/workspace/pages/NotesPage.tsx");
const editor = read("src/renderer/src/features/workspace/pages/SketchPage.tsx");
const richEditor = read("src/renderer/src/features/workspace/components/MarkdownRichEditor.tsx");
const markdown = read("src/renderer/src/features/workspace/lib/markdown.ts");
const embed = read("src/renderer/src/features/workspace/lib/sketchEmbed.ts");

test("Note owns Sketch insertion at the current editor position", () => {
  assert.match(notes, /Sketchを挿入/);
  assert.match(notes, /sketchEmbedMarkdown\(sketch, page\)/);
  assert.match(notes, /mdxMarkdownInsertRef\.current\(markdown\)/);
  assert.match(notes, /insertDraftMarkdown\(markdown, start, end\)/);
  assert.doesNotMatch(editor, /Noteへ挿入|insertIntoNote|targetNoteId/);
});

test("Sketch embed keeps canonical Sketch and page ids", () => {
  assert.match(embed, /tasken-sketch:/);
  assert.match(embed, /sketchEmbedKey\(sketchId, pageId\)/);
  assert.match(embed, /sketchEmbedUrl\(sketch\.id, page\.id\)/);
  assert.match(notes, /pickerSketchId/);
  assert.match(notes, /pickerPageId/);
});

test("Edit Preview and PDF resolve the latest Sketch preview", () => {
  assert.match(richEditor, /imagePreviewHandler:/);
  assert.match(notes, /onImagePreview=\{previewSketchImage\}/);
  assert.match(notes, /renderSketchPageToDataUrl\(page\)/);
  assert.match(notes, /previewHtml\(draftBody, "markdown", previewRenderOptions\)/);
  assert.match(notes, /previewDocument\(content, "markdown", publishRenderOptions\)/);
});

test("Preview reopens the exact Sketch page and missing references remain visible", () => {
  assert.match(markdown, /data-sketch-id=/);
  assert.match(markdown, /data-sketch-page-id=/);
  assert.match(markdown, /参照先のSketchまたはページが見つかりません/);
  assert.match(notes, /localStorage\.setItem\(ACTIVE_SKETCH_ID_KEY, sketchId\)/);
  assert.match(notes, /localStorage\.setItem\(ACTIVE_SKETCH_PAGE_KEY, pageId\)/);
  assert.match(editor, /localStorage\.getItem\(ACTIVE_SKETCH_PAGE_KEY\)/);
});
