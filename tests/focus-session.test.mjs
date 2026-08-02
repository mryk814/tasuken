import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  findActiveFocusSession,
  focusDocumentDraftKey,
  focusSessionDraftKey,
  focusSessionTaskId,
  isActiveFocusSession,
  isFocusSession,
} from "../src/shared/focusSession.mjs";

function session(id, taskId, state = "active", updatedAt = "2026-08-02T00:00:00.000Z") {
  return {
    id,
    title: `Focus ${taskId}`,
    updated_at: updatedAt,
    properties_json: {
      document_role: "focus_session",
      session_state: state,
      task_id: taskId,
    },
  };
}

test("通常NoteとFocus Sessionを区別し、単一active sessionを選ぶ", () => {
  const older = session("older", "task-1", "active", "2026-08-01T00:00:00.000Z");
  const latest = session("latest", "task-2", "active", "2026-08-02T00:00:00.000Z");
  const ended = session("ended", "task-3", "ended", "2026-08-03T00:00:00.000Z");
  const ordinary = { id: "note", title: "ordinary" };
  assert.equal(isFocusSession(ordinary), false);
  assert.equal(isFocusSession(ended), true);
  assert.equal(isActiveFocusSession(ended), false);
  assert.equal(findActiveFocusSession([ordinary, older, ended, latest]), latest);
  assert.equal(focusSessionTaskId(latest), "task-2");
});

test("Sessionと関連文書の同期前ドラフトを別々に退避する", () => {
  assert.notEqual(focusSessionDraftKey("session-1"), focusDocumentDraftKey("session-1"));
  assert.notEqual(focusDocumentDraftKey("note-1"), focusDocumentDraftKey("note-2"));
});

test("Task詳細・Command Palette・再開・終了整理が同じFocus実装へ接続される", () => {
  const app = fs.readFileSync(new URL("../src/renderer/src/features/workspace/WorkspaceApp.tsx", import.meta.url), "utf8");
  const drawer = fs.readFileSync(new URL("../src/renderer/src/features/workspace/components/drawer.tsx", import.meta.url), "utf8");
  const focus = fs.readFileSync(new URL("../src/renderer/src/features/workspace/components/FocusSessionDialog.tsx", import.meta.url), "utf8");
  const notes = fs.readFileSync(new URL("../src/renderer/src/features/workspace/pages/NotesPage.tsx", import.meta.url), "utf8");

  assert.match(app, /Focus Sessionを再開/);
  assert.match(app, /集中して作業する:/);
  assert.match(drawer, /集中して作業する/);
  assert.match(focus, /focus_session_autosave/);
  assert.match(focus, /focus_session_document_autosave/);
  assert.match(focus, /ScratchpadをNoteとして残す/);
  assert.match(focus, /focus_session_summary/);
  assert.match(focus, /creating\.current = true;\s+setEnding\(true\)/);
  assert.match(focus, /buildSaveTaskOperations/);
  assert.match(focus, /buildSelectionExtractionOperations/);
  assert.match(notes, /!isFocusSession/);
});
