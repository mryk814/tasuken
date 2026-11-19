import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`
  );
}

const library = await importBundled("src/renderer/src/features/workspace/lib/documentLibrary.ts");

const tasks = [
  { id: "task-1", title: "設計タスク" },
  { id: "task-2", title: "買い物メモ" },
];
const documents = [
  {
    id: "doc-b",
    title: "比較表",
    filename: "compare.html",
    task_id: "task-2",
    theme_id: "theme-1",
    created_at: "2026-11-18T10:00:00.000Z",
  },
  {
    id: "doc-a",
    title: "設計メモ",
    filename: "design.html",
    task_id: "task-1",
    theme_id: null,
    created_at: "2026-11-19T09:00:00.000Z",
  },
  {
    id: "doc-c",
    title: "迷子の文書",
    filename: "lost.html",
    task_id: "task-missing",
    created_at: "2026-11-19T12:00:00.000Z",
  },
  {
    id: "doc-d",
    title: "単独文書",
    filename: "solo.html",
    task_id: null,
    theme_id: "theme-1",
    created_at: "2026-11-17T10:00:00.000Z",
  },
];

test("文書はタスク横断で新しい順に並び、属するタスクのタイトルが付く", () => {
  const entries = library.buildDocumentLibraryEntries(documents, tasks);
  assert.deepEqual(
    entries.map((entry) => entry.document.id),
    ["doc-c", "doc-a", "doc-b", "doc-d"],
  );
  assert.equal(entries[1].taskTitle, "設計タスク");
  assert.equal(entries[1].taskMissing, false);
  assert.equal(entries[2].taskTitle, "買い物メモ");
});

test("タスクが見つからない文書は taskMissing、task_id が無い文書はどちらでもない", () => {
  const entries = library.buildDocumentLibraryEntries(documents, tasks);
  const lost = entries.find((entry) => entry.document.id === "doc-c");
  assert.equal(lost.taskTitle, null);
  assert.equal(lost.taskMissing, true);
  const solo = entries.find((entry) => entry.document.id === "doc-d");
  assert.equal(solo.taskTitle, null);
  assert.equal(solo.taskMissing, false);
});

test("検索はタイトル・ファイル名・タスクタイトルに当たる", () => {
  const byTitle = library.buildDocumentLibraryEntries(documents, tasks, { query: "設計" });
  assert.deepEqual(
    byTitle.map((entry) => entry.document.id),
    ["doc-a"],
  );
  const byFilename = library.buildDocumentLibraryEntries(documents, tasks, {
    query: "COMPARE",
  });
  assert.deepEqual(
    byFilename.map((entry) => entry.document.id),
    ["doc-b"],
  );
  const byTask = library.buildDocumentLibraryEntries(documents, tasks, { query: "買い物" });
  assert.deepEqual(
    byTask.map((entry) => entry.document.id),
    ["doc-b"],
  );
});

test("Theme絞り込みはNotesPageのNote一覧と同じ意味（all / 未設定 / 指定）", () => {
  const all = library.buildDocumentLibraryEntries(documents, tasks, { themeId: "all" });
  assert.equal(all.length, 4);
  const unset = library.buildDocumentLibraryEntries(documents, tasks, { themeId: "" });
  assert.deepEqual(
    unset.map((entry) => entry.document.id),
    ["doc-c", "doc-a"],
  );
  const specified = library.buildDocumentLibraryEntries(documents, tasks, {
    themeId: "theme-1",
  });
  assert.deepEqual(
    specified.map((entry) => entry.document.id),
    ["doc-b", "doc-d"],
  );
});

test("入力が無くても空の一覧を返す", () => {
  assert.deepEqual(library.buildDocumentLibraryEntries(undefined, undefined), []);
  assert.deepEqual(library.buildDocumentLibraryEntries([], []), []);
});

test("NotesPageの一覧に文書セクションが配線されている", () => {
  const notesPage = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
  assert.match(notesPage, /buildDocumentLibraryEntries\(data\.documents, data\.tasks/);
  assert.match(notesPage, /<DocumentLibrarySection/);
  assert.match(notesPage, /openContentViewer=\{openContentViewer\}/);
});

test("文書セクションはAI印と既存Previewの開き方を共有する", () => {
  const documentsSource = readFileSync(
    "src/renderer/src/features/workspace/components/documents.tsx",
    "utf8",
  );
  assert.match(documentsSource, /export function DocumentSection/);
  assert.match(documentsSource, /export function DocumentLibrarySection/);
  assert.match(documentsSource, /<AiCreationMark entity=\{document\} detail type="document" \/>/);
  assert.match(
    documentsSource,
    /openContentViewer\?\.\(\{ type: "document", documentId: document\.id \}\)/,
  );
});
