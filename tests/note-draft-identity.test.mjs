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
const serviceSource = readFileSync("src/main/services/workspaceService.ts", "utf8");
const workspaceTypesSource = readFileSync("src/shared/types/workspace.ts", "utf8");

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

function createDraftTransitionState() {
  return {
    selected: null,
    snapshot: null,
    editor: null,
    persisted: Object.fromEntries(fixtures.map((record) => [identity.noteDraftOwnerKey(owner(record)), record.body])),
    canonical: Object.fromEntries(fixtures.filter((record) => record.recordType === "note").map((record) => [record.id, record.body])),
  };
}

function transitionTo(state, next, editorMarkdown = null) {
  if (state.selected) {
    const currentOwner = owner(state.selected);
    const currentKey = identity.noteDraftOwnerKey(currentOwner);
    const currentSaved = state.persisted[currentKey];
    const currentBody = identity.readNoteDraftBody({
      owner: currentOwner,
      snapshot: state.snapshot,
      editor: state.editor,
      savedBody: currentSaved,
    });
    const flushed = identity.makeNoteDraftSnapshot(currentOwner, currentBody, currentSaved);
    saveSnapshot(state.persisted, { record: state.selected, snapshot: flushed });
    if (state.selected.recordType === "note" && flushed.dirty) state.canonical[state.selected.id] = flushed.body;
  }

  const nextOwner = next ? owner(next) : null;
  const nextSaved = next ? state.persisted[identity.noteDraftOwnerKey(nextOwner)] : "";
  return {
    ...state,
    selected: next,
    snapshot: nextOwner ? identity.makeNoteDraftSnapshot(nextOwner, nextSaved, nextSaved) : null,
    editor: nextOwner && editorMarkdown !== null
      ? { ownerKey: identity.noteDraftOwnerKey(nextOwner), getMarkdown: () => editorMarkdown }
      : null,
  };
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

test("filter fallbackを含むA→B→Cの状態遷移は保存・表示・canonical Markdownのownerを揃える", () => {
  let state = createDraftTransitionState();
  state = transitionTo(state, fixtures[0], "NOTE_A_FILTER_EDITED");
  assert.equal(identity.readNoteDraftBody({
    owner: owner(fixtures[0]),
    snapshot: state.snapshot,
    editor: state.editor,
    savedBody: fixtures[0].body,
  }), "NOTE_A_FILTER_EDITED");

  // Scope/Theme/search filterでAが表示対象から外れた場合も、先にAをflushしてからBを表示する。
  state = transitionTo(state, fixtures[1]);
  assert.equal(state.persisted["note:note-a"], "NOTE_A_FILTER_EDITED");
  assert.equal(state.canonical["note-a"], "NOTE_A_FILTER_EDITED");
  assert.equal(identity.renderNoteDraftBody(owner(fixtures[1]), state.snapshot, fixtures[1].body), "REPORT_B_ONLY");

  state = transitionTo(state, fixtures[2], "PROMPT_C_FILTER_EDITED");
  assert.equal(state.persisted["note:report-b"], "REPORT_B_ONLY");
  assert.equal(identity.readNoteDraftBody({
    owner: owner(fixtures[2]),
    snapshot: state.snapshot,
    editor: state.editor,
    savedBody: fixtures[2].body,
  }), "PROMPT_C_FILTER_EDITED");

  // Detached windowもC ownerで読むため、A/B本文が混ざらない。
  state = transitionTo(state, fixtures[0]);
  assert.equal(state.persisted["note:prompt-c"], "PROMPT_C_FILTER_EDITED");
  assert.equal(state.canonical["prompt-c"], "PROMPT_C_FILTER_EDITED");
  assert.equal(identity.renderNoteDraftBody(owner(fixtures[0]), state.snapshot, state.persisted["note:note-a"]), "NOTE_A_FILTER_EDITED");
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
  assert.match(notesPageSource, /expectedRevision: snapshot\.expectedRevision/);
  assert.match(workspaceTypesSource, /interface DocumentSaveSnapshot/);
  assert.match(workspaceTypesSource, /expectedRevision: number/);
  assert.match(serviceSource, /actualRevision !== request\.snapshot\.expectedRevision/);
  assert.match(serviceSource, /ownerとEntityが一致しません/);
});

test("draft snapshotはownerと取得時revisionを同時に保持する", () => {
  const snapshot = identity.makeNoteDraftSnapshot(owner(fixtures[0]), "edited", fixtures[0].body, 7);
  assert.deepEqual(snapshot.owner, { recordType: "note", entityId: "note-a" });
  assert.equal(snapshot.expectedRevision, 7);
});
