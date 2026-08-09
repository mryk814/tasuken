import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const patch = readFileSync("patches/@mdxeditor+editor+4.0.4.patch", "utf8");
const notesPage = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");

test("MDXEditor defers whole-document Markdown export while typing", () => {
  assert.match(packageJson.scripts.postinstall, /^patch-package && /);
  assert.equal(packageJson.devDependencies["patch-package"], "^8.0.1");
  assert.match(patch, /pendingEditorState = editorState/);
  assert.match(patch, /clearTimeout\(exportTimer\)/);
  assert.match(patch, /\}, 1200\)/);
});

test("MDXEditor getMarkdown still exports the current Lexical tree for immediate saves", () => {
  assert.match(patch, /editor\.getEditorState\(\)\.read/);
  assert.match(patch, /exportMarkdownFromLexical/);
  assert.match(patch, /root: \$getRoot\(\)/);
  assert.match(patch, /jsxIsAvailable: realm\.getValue\(jsxIsAvailable\$\)/);
});

test("switching notes unmounts the previous editor and cancels its pending export", () => {
  assert.match(notesPage, /<MarkdownEditorBoundary\s+key=\{selected\.id\}/);
});
