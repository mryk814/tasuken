import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  addDraftSnapshot,
  addSourceDraft,
  buildDraftRerequest,
  normalizeDraftWorkspace,
} from "../src/shared/draftWorkspace.mjs";

test("Draft Workspace normalizes Source and Snapshot history with bounded retention", () => {
  let workspace = normalizeDraftWorkspace(null);
  for (let index = 0; index < 14; index += 1) {
    workspace = addSourceDraft(workspace, {
      id: `source-${index}`,
      body: `# Source ${index}`,
      created_at: `2026-08-02T00:${String(index).padStart(2, "0")}:00.000Z`,
      ai_service: "ChatGPT",
    });
  }
  for (let index = 0; index < 23; index += 1) {
    workspace = addDraftSnapshot(workspace, {
      id: `snapshot-${index}`,
      label: `draft ${index}`,
      body: `working ${index}`,
      created_at: `2026-08-02T01:${String(index).padStart(2, "0")}:00.000Z`,
    });
  }
  assert.equal(workspace.sources.length, 12);
  assert.equal(workspace.sources[0].id, "source-2");
  assert.equal(workspace.active_source_id, "source-13");
  assert.equal(workspace.snapshots.length, 20);
  assert.equal(workspace.snapshots[0].id, "snapshot-3");
});

test("legacy AI rerequest contains instruction and Working Draft without owning a second body", () => {
  const workspace = addSourceDraft(null, {
    id: "source-1",
    body: "# AI draft",
    instruction: "shorten it",
    created_at: "2026-08-02T00:00:00.000Z",
  });
  assert.equal("working_body" in workspace, false);
  const prompt = buildDraftRerequest({ title: "Memo", workingBody: "# Edit\n\nDecision", source: workspace.sources[0], request: "Lead with conclusion" });
  assert.match(prompt, /shorten it/);
  assert.match(prompt, /Decision/);
  assert.match(prompt, /Lead with conclusion/);
});

test("legacy Draft data remains readable through Note AI while the duplicate UI route is gone", () => {
  const drawer = readFileSync("src/renderer/src/features/workspace/components/NoteAiDrawer.tsx", "utf8");
  const conversation = readFileSync("src/shared/noteAiConversation.mjs", "utf8");
  const notes = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
  const app = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
  const css = readFileSync("src/renderer/src/styles/app.css", "utf8");

  assert.match(conversation, /properties\.draft_workspace/);
  assert.match(conversation, /kind: "legacy_draft"/);
  assert.match(drawer, /applyMarkdownDiffHunks/);
  assert.match(drawer, /直前のAI採用を元に戻す/);
  assert.match(drawer, /buildNoteAiHistory/);
  assert.doesNotMatch(notes, /DraftWorkspaceDialog|Draft Workspace/);
  assert.doesNotMatch(app, /notes:draft-workspace/);
  assert.match(css, /\.note-ai-drawer/);
});
