import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  findActiveFocusSession,
  focusDocumentDraftKey,
  focusSessionDraftKey,
  focusSessionElapsedMs,
  focusSessionProperties,
  focusSessionTaskId,
  isActiveFocusSession,
  isFocusSession,
  isPausedFocusSession,
  pauseFocusSessionProperties,
  resumeFocusSessionProperties,
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
  const app = fs.readFileSync(
    new URL("../src/renderer/src/features/workspace/WorkspaceApp.tsx", import.meta.url),
    "utf8",
  );
  const drawer = fs.readFileSync(
    new URL("../src/renderer/src/features/workspace/components/drawer.tsx", import.meta.url),
    "utf8",
  );
  const focus = fs.readFileSync(
    new URL(
      "../src/renderer/src/features/workspace/components/FocusSessionDialog.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const notes = fs.readFileSync(
    new URL("../src/renderer/src/features/workspace/pages/NotesPage.tsx", import.meta.url),
    "utf8",
  );

  assert.match(app, /Focus Sessionを再開/);
  assert.match(app, /集中して作業する:/);
  assert.match(drawer, /集中して作業する/);
  assert.match(focus, /focus_session_autosave/);
  assert.match(focus, /focus_session_document_autosave/);
  assert.match(focus, /body_markdown: body, content_format: "markdown"/);
  assert.match(focus, /body_markdown: documentBody,\s*content_format: "markdown"/);
  assert.match(focus, /ScratchpadをNoteとして残す/);
  assert.match(focus, /focus_session_summary/);
  assert.match(focus, /creating\.current = true;\s+setEnding\(true\)/);
  assert.match(focus, /buildSaveTaskOperations/);
  assert.match(focus, /buildSelectionExtractionOperations/);
  assert.match(notes, /!isFocusSession/);
});

test("一時停止していた時間を作業時間から除き、停止中は経過を止める", () => {
  const minute = 60_000;
  const at = (minutes) =>
    new Date(Date.parse("2026-10-18T09:00:00.000Z") + minutes * minute).toISOString();
  const record = (properties) => ({
    id: "s1",
    properties_json: {
      document_role: "focus_session",
      session_state: "active",
      started_at: at(0),
      ...properties,
    },
  });
  const started = focusSessionProperties(record({}));
  assert.equal(focusSessionElapsedMs(record({}), Date.parse(at(10))), 10 * minute);

  const paused = pauseFocusSessionProperties(started, at(10));
  assert.equal(isPausedFocusSession({ properties_json: paused }), true);
  assert.equal(
    pauseFocusSessionProperties(paused, at(12)),
    paused,
    "停止中の二重停止で停止時刻を動かさない",
  );
  assert.equal(focusSessionElapsedMs({ properties_json: paused }, Date.parse(at(25))), 10 * minute);

  const resumed = resumeFocusSessionProperties(paused, at(25));
  assert.equal(resumed.paused_at, null);
  assert.equal(resumed.paused_ms, 15 * minute);
  assert.equal(isPausedFocusSession({ properties_json: resumed }), false);
  assert.equal(
    focusSessionElapsedMs({ properties_json: resumed }, Date.parse(at(40))),
    25 * minute,
  );

  const pausedAgain = pauseFocusSessionProperties(resumed, at(40));
  const ended = {
    ...resumeFocusSessionProperties(pausedAgain, at(50)),
    session_state: "ended",
    ended_at: at(50),
  };
  assert.equal(ended.paused_ms, 25 * minute);
  assert.equal(focusSessionElapsedMs({ properties_json: ended }, Date.parse(at(90))), 25 * minute);
});
