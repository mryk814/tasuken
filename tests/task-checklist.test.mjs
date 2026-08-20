import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

async function importBundled(relativePath) {
  const outDir = mkdtempSync(path.join(tmpdir(), "tasken-task-checklist-"));
  const outfile = path.join(outDir, "bundle.mjs");
  await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href);
}

const { checklistProgress } = await importBundled("src/renderer/src/features/task/model/checklistProgress.ts");

test("Task checklist progress ignores blank items and counts completed items", () => {
  assert.equal(checklistProgress(null), null);
  assert.equal(checklistProgress([{ id: "blank", title: "  ", done: false, sort_order: 0 }]), null);
  assert.deepEqual(checklistProgress([
    { id: "one", title: "準備", done: true, sort_order: 0 },
    { id: "two", title: "確認", done: false, sort_order: 1 },
    { id: "blank", title: "", done: true, sort_order: 2 },
  ]), { done: 1, total: 2 });
});
