import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
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

const wordExport = await importBundled("src/shared/wordExport.ts");

test("word export parser keeps frontmatter and basic markdown structure", () => {
  const blocks = wordExport.markdownToWordBlocks(`---
theme: Alpha
type: note
---
# Heading

Intro text
- First
- Second

\`\`\`
code line
\`\`\``);

  assert.deepEqual(blocks.map((block) => block.type), [
    "heading",
    "code",
    "heading",
    "paragraph",
    "bullet",
    "bullet",
    "code",
  ]);
  assert.equal(blocks[1].text, "theme: Alpha\ntype: note");
  assert.equal(blocks[2].text, "Heading");
  assert.equal(blocks[6].text, "code line");
});

test("word export signature changes when markdown body changes", () => {
  const before = wordExport.noteWordExportSignature("# A\nbody");
  const after = wordExport.noteWordExportSignature("# A\nbody changed");
  assert.notEqual(before, after);
  assert.equal(before, wordExport.noteWordExportSignature("# A\nbody"));
});
