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
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const fileExport = await importBundled("src/shared/fileExport.ts");

test("document publish signature changes when markdown body changes", () => {
  const before = fileExport.noteExportSignature("# A\nbody");
  const after = fileExport.noteExportSignature("# A\nbody changed");
  assert.notEqual(before, after);
  assert.equal(before, fileExport.noteExportSignature("# A\nbody"));
});

test("document publish uses Markdown as primary output and removes Word", () => {
  const importExportSource = readFileSync("src/renderer/src/features/workspace/pages/ImportExportPage.tsx", "utf8");
  const drawerSource = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");
  const notesSource = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
  const contractsSource = readFileSync("src/shared/ipc/contracts.ts", "utf8");
  const workspaceApiSource = readFileSync("src/renderer/src/services/workspaceApi.ts", "utf8");

  assert.match(importExportSource, /publishMarkdownTargets/);
  assert.match(importExportSource, /publishPdfTargets/);
  assert.match(importExportSource, />Markdown</);
  assert.match(importExportSource, />PDF</);
  assert.match(importExportSource, /markdown_export/);
  assert.doesNotMatch(importExportSource, /publishWordTargets|Word出力|exportMarkdownNoteToWord|word_export|AI向け|固定表示/);

  assert.match(drawerSource, /Document Publish/);
  assert.match(drawerSource, /exportMarkdown\(/);
  assert.match(drawerSource, /document-publish-open|IconLink/);
  assert.match(drawerSource, /markdown_export/);
  assert.match(drawerSource, /出力先を選ぶ|>Markdown</);
  assert.doesNotMatch(drawerSource, /Word出力|exportWord|word_export|exportMarkdownNoteToWord/);

  assert.match(notesSource, /Document Publish/);
  assert.match(notesSource, /exportSelectedMarkdown/);
  assert.match(notesSource, /document-publish-open|IconLink/);
  assert.match(notesSource, /markdown_export/);
  assert.match(notesSource, /primary-button compact.*exportSelectedMarkdown|exportSelectedMarkdown[\s\S]*primary-button/);
  assert.doesNotMatch(notesSource, /Word出力|exportSelectedWord|word_export|exportMarkdownNoteToWord|Markdown=AI|document-publish-inline-meta/);

  assert.doesNotMatch(contractsSource, /noteWordExport|WordExport|markdownNoteToWord/);
  assert.doesNotMatch(workspaceApiSource, /exportMarkdownNoteToWord|WordExport|wordExport/);
});
