import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  markdownHeadingBeforeOffset,
  selectionExcerpt,
  selectionTitleCandidate,
} from "../src/shared/selectionExtraction.mjs";

test("選択範囲の先頭行からMarkdown記号を除いたタイトル候補を作る", () => {
  assert.equal(selectionTitleCandidate("\n## 次に確認すること\n詳細"), "次に確認すること");
  assert.equal(selectionTitleCandidate("- [ ] 実験条件を確認する\n補足"), "実験条件を確認する");
  assert.equal(selectionTitleCandidate(""), "選択範囲からのメモ");
  assert.ok(selectionTitleCandidate("a".repeat(120)).endsWith("…"));
  assert.ok(selectionTitleCandidate("a".repeat(120)).length <= 80);
});

test("元文書の見出しと短い引用を参照情報に残せる", () => {
  const markdown = "# はじめに\n本文\n\n## 実験条件\n選択する文章\n\n```md\n# コード内\n```\n";
  const selectedAt = markdown.indexOf("選択する文章");
  assert.equal(markdownHeadingBeforeOffset(markdown, selectedAt), "実験条件");
  assert.equal(selectionExcerpt("  一行目\n  二行目  "), "一行目 二行目");
  assert.ok(selectionExcerpt("長文".repeat(200)).length <= 280);
});

test("Notesの選択ツールバーはTask・Noteとderived_from参照を同じ保存経路へ接続する", () => {
  const editor = fs.readFileSync(new URL("../src/renderer/src/features/workspace/components/MarkdownRichEditor.tsx", import.meta.url), "utf8");
  const page = fs.readFileSync(new URL("../src/renderer/src/features/workspace/pages/NotesPage.tsx", import.meta.url), "utf8");
  const extraction = fs.readFileSync(new URL("../src/renderer/src/features/workspace/lib/selectionExtraction.ts", import.meta.url), "utf8");
  const drawer = fs.readFileSync(new URL("../src/renderer/src/features/workspace/components/drawer.tsx", import.meta.url), "utf8");

  assert.match(editor, /選択範囲から/);
  assert.match(editor, /beginSelectionExtraction\("task"\)/);
  assert.match(editor, /beginSelectionExtraction\("note"\)/);
  assert.match(page, /onExtractSelection=\{selected\.recordType === "note"/);
  assert.match(page, /await saveEntities\(\s*result\.operations/);
  assert.match(extraction, /relation_type:\s*"derived_from"/);
  assert.match(extraction, /source_heading:/);
  assert.match(extraction, /source_excerpt:/);
  assert.match(drawer, /DerivedSourceReference/);
  assert.match(drawer, /元の文書/);
});
