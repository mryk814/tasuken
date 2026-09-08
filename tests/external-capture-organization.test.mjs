import assert from "node:assert/strict";
import test from "node:test";
import {
  proposal,
  createQuickCaptureOrganizationFixture as fixture,
} from "./helpers/quick-capture-organization.mjs";

const result = (tasks = [proposal]) => ({
  schema: "tasken-task-drafts/v1",
  originalText: "週末に比較実験を準備する",
  tasks,
  warnings: [],
});

test("External AI clipboard prompt includes only the entered text and selected Theme", () => {
  const f = fixture(() => {
    throw new Error("network must not run");
  });
  f.call("external-prompt", {
    text: "",
    themeId: "research",
    capturedAt: "2026-09-08T02:00:00Z",
    timeZone: "Asia/Tokyo",
  });
  assert.match(globalThis.captureFixture.clipboardText, /tasken-task-drafts\/v1/);
  assert.match(globalThis.captureFixture.clipboardText, /研究/);
  assert.doesNotMatch(globalThis.captureFixture.clipboardText, /not sent/);
  assert.equal(f.commands.length, 0);
  assert.equal(f.saves.length, 0);
  assert.throws(
    () => f.handlers.get("quick-capture:external-prompt")({ sender: {} }, {}),
    /この画面/,
  );
});

test("External results preview without provider calls or saving, and use the existing confirmed batch path", () => {
  const f = fixture(() => {
    throw new Error("network must not run");
  });
  const raw = result([proposal, { ...proposal, title: "結果を共有" }]);
  const parsed = f.call("external-import", "```json\n" + JSON.stringify(raw) + "\n```");
  assert.equal(parsed.ok, true);
  assert.equal(parsed.originalText, raw.originalText);
  assert.equal(parsed.organization.tasks.length, 2);
  assert.equal(f.commands.length, 0);
  const saved = f.call("save", parsed.originalText, "today-task", "research", undefined, {
    ...parsed.organization,
    submissionId: "2dccdac3-977b-4d32-a67b-1bfa5ad4a98c",
    issuedAt: "2026-09-08T03:00:00Z",
  });
  assert.deepEqual(saved, { status: "saved", count: 2 });
  assert.equal(f.batches.length, 1);
  assert.ok(
    f.commands.every((command) => command.payload.task.description.endsWith(raw.originalText)),
  );
});

test("External malformed, oversized, unknown-field, date and Theme results cannot save", () => {
  const f = fixture();
  const invalid = [
    "{",
    " ".repeat(256 * 1024 + 1),
    ...[
      { ...result(), schema: "another-format" },
      { ...result(), originalText: "" },
      { ...result(), existingTaskId: "do-not-update" },
      result([]),
      result(Array(9).fill(proposal)),
      result([{ ...proposal, state: "done" }]),
      result([{ ...proposal, themeId: "not-in-this-workspace" }]),
      result([{ ...proposal, startDate: "2026-09-12", endDate: "2026-09-11" }]),
      result([{ ...proposal, endDate: "2026-02-30" }]),
      result([{ ...proposal, plannedStartTime: "25:00" }]),
      result([{ ...proposal, checklist: Array(21).fill("step") }]),
    ].map(JSON.stringify),
  ];
  for (const text of invalid) assert.equal(f.call("external-import", text).ok, false);
  assert.equal(f.saves.length, 0);
  assert.equal(f.commands.length, 0);
  assert.throws(
    () => f.handlers.get("quick-capture:external-import")({ sender: {} }, "{}"),
    /この画面/,
  );
});
