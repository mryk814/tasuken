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
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`);
}

const notes = await importBundled("src/renderer/src/features/workspace/lib/notes.ts");

test("Notes defaults to Note and keeps deterministic date ordering", () => {
  assert.equal(notes.DEFAULT_NOTES_PREFS.scope, "note");
  const records = [
    { id: "same-b", created_at: "2026-07-01", updated_at: "2026-07-10" },
    { id: "same-a", created_at: "2026-07-01", updated_at: "2026-07-10" },
    { id: "old", created_at: "2026-07-02", updated_at: "2026-07-09" },
  ];
  assert.deepEqual(notes.sortNotesRecords(records, "updated_desc").map((record) => record.id), ["same-b", "same-a", "old"]);
  assert.deepEqual(notes.sortNotesRecords(records, "created_asc").map((record) => record.id), ["same-a", "same-b", "old"]);
});

test("Notes UI persists filter and sort preferences and exposes save-folder actions", () => {
  const source = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
  assert.match(source, /usePersistentState<NotesPreferences>\("notes:prefs:v1", DEFAULT_NOTES_PREFS\)/);
  assert.match(source, /compareNotesRecords\(a, b, sortOrder\)/);
  assert.match(source, /aria-label="Notesの並び順"/);
  assert.match(source, /openMarkdownExportDirectory/);
  assert.match(source, /exportSelectedMarkdown\(false\)/);
  assert.match(source, /保存先フォルダを開く/);
});

test("micro memo date is a labeled top-level time element", () => {
  const source = readFileSync("src/renderer/src/features/workspace/pages/InboxPage.tsx", "utf8");
  const styles = readFileSync("src/renderer/src/styles/app.css", "utf8");
  assert.match(source, /className="micro-memo-card-meta"/);
  assert.match(source, /<time dateTime=\{memo\.captured_at\}/);
  assert.match(source, />記録 \{formatDate\(memo\.captured_at\)\}</);
  assert.match(styles, /\.micro-memo-card-meta[^\n]*justify-content: flex-start/);
});
