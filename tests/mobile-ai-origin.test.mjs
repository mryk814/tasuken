import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createMobileOfflineGateway } from "./helpers/mobile-offline-gateway.mjs";

const bundle = await build({
  stdin: {
    contents: `export * from './src/shared/contracts/mobile/aiOrigin.ts';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { projectMobileAiOrigin } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("AI origin requires actual creation provenance and valid bounded fields", () => {
  assert.equal(projectMobileAiOrigin({ ai_authority: "ai_generated" }), undefined);
  assert.equal(projectMobileAiOrigin({ ai_creation: { schema: "other" } }), undefined);
  assert.equal(
    projectMobileAiOrigin({
      ai_creation: { schema: "tasken-ai-creation/v1", caller: "", received_at: "invalid" },
    }),
    undefined,
  );
});

test("actual HTTP/Core/SQLite keeps legacy responses and opt-in Task/Note origin through seen update and restart", async () => {
  const fixture = await createMobileOfflineGateway();
  try {
    await fixture.control({ seedAiOrigin: true });
    const read = async (endpoint, extra = {}, optIn = true) => {
      const query = new URLSearchParams({
        apiVersion: "1",
        schemaVersion: "7",
        ...(endpoint.startsWith("task-related") ? {} : { requestId: "origin-read" }),
        ...extra,
      });
      const response = await fetch(`${fixture.config.origin}/v1/${endpoint}?${query}`, {
        headers: {
          authorization: `Bearer ${fixture.config.accessToken}`,
          ...(optIn ? { "X-Tasken-Ai-Origin": "1" } : {}),
        },
      });
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      return body.data;
    };
    const todayQuery = { date: "2026-10-03", limit: "50" };
    const old = await read("today", todayQuery, false);
    assert.equal(
      Object.hasOwn(
        old.items.find((item) => item.id === "ai-origin-task"),
        "aiOrigin",
      ),
      false,
    );
    const expected = { caller: "Codex", receivedAt: "2026-10-03T08:00:00.000Z", seenAt: null };
    const today = (await read("today", todayQuery)).items.find(
      (item) => item.id === "ai-origin-task",
    );
    assert.deepEqual(today.aiOrigin, expected);
    assert.equal(today.state, "todo");
    const bootstrap = await read("bootstrap", { limit: "50" });
    assert.deepEqual(bootstrap.tasks.find((item) => item.id === today.id).aiOrigin, expected);
    const noteQuery = { taskId: today.id, type: "note", id: "ai-origin-note" };
    const listQuery = { taskId: today.id, limit: "50" };
    const oldList = await read("task-related-documents", listQuery, false);
    assert.equal(Object.hasOwn(oldList.documents[0], "aiOrigin"), false);
    const oldNote = await read("task-related-document", noteQuery, false);
    assert.equal(Object.hasOwn(oldNote.document, "aiOrigin"), false);
    assert.deepEqual(
      (await read("task-related-documents", listQuery)).documents[0].aiOrigin,
      expected,
    );
    assert.deepEqual((await read("task-related-document", noteQuery)).document.aiOrigin, expected);
    await fixture.control({ seeAiOrigin: true, restartDesktop: true });
    const sync = await read("sync", { cursor: bootstrap.nextCursor, limit: "50" });
    const task = sync.changes.find((change) => change.task?.id === today.id).task;
    assert.deepEqual(task.aiOrigin, { ...expected, seenAt: "2026-10-03T09:00:00.000Z" });
    assert.equal(task.state, "todo");
    assert.equal(task.workState, today.workState);
    assert.equal(
      (await read("task-related-document", noteQuery)).document.aiOrigin.seenAt,
      task.aiOrigin.seenAt,
    );
    const stored = fixture.snapshot().tasks.find((item) => item.id === today.id);
    assert.equal(stored.ai_creation.command_id, "fixture-ai-origin");
    assert.equal(stored.state, "todo");
  } finally {
    await fixture.close();
  }
});
