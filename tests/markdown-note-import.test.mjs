import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "esbuild";

import { isMarkdownFileName, markdownNoteFromFile } from "../src/shared/markdownNoteImport.ts";

test("indented Markdown code is kept while an initial H1 allows up to three spaces", () => {
  for (const indent of ["    ", "\t"]) {
    const body = `${indent}# shell comment\n${indent}echo ok`;
    assert.deepEqual(markdownNoteFromFile("code.md", `\n${body}`), { title: "code", body });
  }
  assert.deepEqual(markdownNoteFromFile("code.md", "\n   # 題名\n本文"), {
    title: "題名",
    body: "本文",
  });
});

test("a failed dropped file read reports retry guidance and saves no Notes", async () => {
  const source = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
  const start = source.indexOf("async function importDroppedMarkdown(");
  const end = source.indexOf("\n  function addNote", start);
  const functionSource = transformSync(source.slice(start, end), { loader: "ts" }).code;
  const toasts = [];
  let saves = 0;
  const context = vm.createContext({
    isMarkdownFileName,
    markdownNoteFromFile,
    MARKDOWN_NOTE_IMPORT_LIMITS: { files: 20, bytes: 2 * 1024 * 1024 },
    canonicalThemeId: () => "personal",
    activeTheme: null,
    uuid: () => "new-note",
    buildSaveNoteOperations: (note) => [note],
    setSelectedId: () => {},
    saveEntities: async () => {
      saves += 1;
    },
    setToast: (...args) => toasts.push(args),
  });
  vm.runInContext(`${functionSource}; globalThis.importNotes = importDroppedMarkdown`, context);
  await context.importNotes([
    {
      name: "locked.md",
      size: 1,
      text: async () => {
        throw new Error("access denied");
      },
    },
  ]);
  assert.equal(saves, 0);
  assert.equal(toasts.length, 1);
  assert.match(toasts[0][0], /読み取れませんでした/);
  assert.match(toasts[0][0], /もう一度/);
  assert.equal(toasts[0][1], "danger");
});

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
