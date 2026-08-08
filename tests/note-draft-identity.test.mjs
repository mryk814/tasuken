import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
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

const identity = await importBundled("src/renderer/src/features/workspace/lib/noteDraftIdentity.ts");
const notesPageSource = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
const editorSource = readFileSync("src/renderer/src/features/workspace/components/MarkdownRichEditor.tsx", "utf8");

const fixtures = [
  { recordType: "note", id: "note-a", body: "NOTE_A_ONLY", theme: "theme-a" },
  { recordType: "note", id: "report-b", body: "REPORT_B_ONLY", theme: "theme-b", noteType: "report" },
  { recordType: "note", id: "prompt-c", body: "PROMPT_C_ONLY", theme: "theme-c", noteType: "prompt" },
  { recordType: "resource", id: "resource-d", body: "RESOURCE_D_ONLY", theme: "theme-d" },
];

function owner(record) {
  return identity.noteDraftOwner(record.recordType, record.id);
}

function saveSnapshot(saved, request) {
  const key = identity.noteDraftOwnerKey(request.snapshot.owner);
  assert.equal(key, identity.noteDraftOwnerKey(owner(request.record)), "Entityと本文のownerは同一であること");
  if (request.snapshot.dirty) saved[key] = request.snapshot.body;
}

test("owner不一致のlive Editor本文はsnapshotや保存済み本文へフォールバックし、別文書へ混入しない", () => {
  const a = fixtures[0];
  const b = fixtures[1];
  const aOwner = owner(a);
  const bOwner = owner(b);
  const aSnapshot = identity.makeNoteDraftSnapshot(aOwner, "NOTE_A_EDITED", a.body);

  assert.equal(
    identity.readNoteDraftBody({
      owner: aOwner,
      snapshot: aSnapshot,
      editor: { ownerKey: identity.noteDraftOwnerKey(bOwner), getMarkdown: () => "REPORT_B_EDITOR" },
      savedBody: a.body,
    }),
    "NOTE_A_EDITED",
  );
  assert.equal(
    identity.renderNoteDraftBody(bOwner, aSnapshot, b.body),
    "REPORT_B_ONLY",
    "selected BのrenderへAのsnapshotを渡さない",
  );
});

test("NOTE_A_ONLY → REPORT_B_ONLY → PROMPT_C_ONLYの高速切替は各本文とcanonical fileを交差させない", () => {
  const persisted = Object.fromEntries(fixtures.map((record) => [identity.noteDraftOwnerKey(owner(record)), record.body]));
  const canonical = Object.fromEntries(fixtures.filter((record) => record.recordType === "note").map((record) => [record.id, record.body]));
  const edits = ["NOTE_A_EDITED", "REPORT_B_EDITED", "PROMPT_C_EDITED"];

  for (let index = 0; index < edits.length; index += 1) {
    const record = fixtures[index];
    const snapshot = identity.makeNoteDraftSnapshot(owner(record), edits[index], record.body);
    const request = { record, snapshot };
    saveSnapshot(persisted, request);
    if (record.recordType === "note") canonical[record.id] = snapshot.body;
  }

  assert.deepEqual(persisted, {
    "note:note-a": "NOTE_A_EDITED",
    "note:report-b": "REPORT_B_EDITED",
    "note:prompt-c": "PROMPT_C_EDITED",
    "resource:resource-d": "RESOURCE_D_ONLY",
  });
  assert.deepEqual(canonical, {
    "note-a": "NOTE_A_EDITED",
    "report-b": "REPORT_B_EDITED",
    "prompt-c": "PROMPT_C_EDITED",
  });
});

test("scope / Theme / search fallback and Edit / Preview / Raw / detached window share the same owner contract", () => {
  const a = fixtures[0];
  const b = fixtures[1];
  const aSnapshot = identity.makeNoteDraftSnapshot(owner(a), "NOTE_A_FILTER_EDITED", a.body);
  const bBody = identity.renderNoteDraftBody(owner(b), aSnapshot, b.body);

  for (const mode of ["edit", "preview", "raw"]) {
    assert.equal(identity.renderNoteDraftBody(owner(b), aSnapshot, b.body), b.body, `${mode}で前文書を渡さない`);
  }

  const detachedEditor = { ownerKey: identity.noteDraftOwnerKey(owner(b)), getMarkdown: () => "REPORT_B_DETACHED_EDITED" };
  assert.equal(identity.readNoteDraftBody({ owner: owner(a), snapshot: aSnapshot, editor: detachedEditor, savedBody: a.body }), aSnapshot.body);
  assert.equal(identity.readNoteDraftBody({ owner: owner(b), snapshot: aSnapshot, editor: detachedEditor, savedBody: bBody }), "REPORT_B_DETACHED_EDITED");
});

test("NotesPageの全保存経路はowner付きsnapshotを使い、current Editor refをEntityと混ぜない", () => {
  assert.match(notesPageSource, /type NoteDraftSnapshot|NoteDraftSnapshot/);
  assert.match(notesPageSource, /readNoteDraftBody\(/);
  assert.match(notesPageSource, /persistDraftSnapshot\(/);
  assert.match(notesPageSource, /sameNoteDraftOwner\(/);
  assert.match(notesPageSource, /ownerKey=\{selectedOwnerKey \|\| ""\}/);
  assert.match(notesPageSource, /key=\{selected\.id\}/);
  assert.doesNotMatch(notesPageSource, /mdxMarkdownSourceRef\.current\?\.\(\)/);
  assert.match(editorSource, /ownerKey: string/);
  assert.match(editorSource, /markdownSourceRef\.current = \{\s*ownerKey/);
});
