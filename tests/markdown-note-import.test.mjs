import assert from "node:assert/strict";
import test from "node:test";

import { isMarkdownFileName, markdownNoteFromFile } from "../src/shared/markdownNoteImport.ts";

// Notesの一覧へドラッグ&ドロップしたmdファイルの題名と本文。
test("title comes from frontmatter, then the first heading, then the file name", () => {
  assert.deepEqual(
    markdownNoteFromFile("x.md", '---\ntitle: "週次の振り返り"\ntags: [a]\n---\n\n本文です。\n'),
    { title: "週次の振り返り", body: "本文です。" },
  );
  assert.deepEqual(markdownNoteFromFile("x.md", "# 実験ノート\n\n## 条件\n- 25℃\n"), {
    title: "実験ノート",
    body: "## 条件\n- 25℃",
  });
  assert.deepEqual(markdownNoteFromFile("2026-10-06 打ち合わせ.md", "メモだけ\r\n"), {
    title: "2026-10-06 打ち合わせ",
    body: "メモだけ",
  });
});

test("a heading that differs from the frontmatter title stays in the body", () => {
  assert.deepEqual(markdownNoteFromFile("x.md", "---\ntitle: 題\n---\n# 別の見出し\n本文"), {
    title: "題",
    body: "# 別の見出し\n本文",
  });
  // 見出しが題名と同じなら重ねない。
  assert.deepEqual(markdownNoteFromFile("x.md", "---\ntitle: 題\n---\n# 題\n本文"), {
    title: "題",
    body: "本文",
  });
});

test("BOM is removed, relative links are kept, and only markdown files are accepted", () => {
  const { body } = markdownNoteFromFile("x.md", "﻿# 題\n![図](./img/a.png)\n");
  assert.equal(body, "![図](./img/a.png)");
  assert.equal(isMarkdownFileName("note.md"), true);
  assert.equal(isMarkdownFileName("NOTE.Markdown"), true);
  assert.equal(isMarkdownFileName("note.txt"), false);
  assert.equal(isMarkdownFileName("image.png"), false);
});
