import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  collectAgentHookEvent,
  flushPendingAgentSessions,
  normalizeAgentHookEvent,
} from "../src/main/mcp/agentSessionHookCollector.mjs";

test("client hook payloads normalize to one lifecycle vocabulary", () => {
  const cases = [
    ["codex", { hook_event_name: "UserPromptSubmit", session_id: "codex-1", prompt: "Issue #498を進める", cwd: "C:\\private\\tasuken" }],
    ["claude_code", { hook_event_name: "UserPromptSubmit", session_id: "claude-1", prompt: "GitLab側を調べる" }],
    ["cursor", { hook_event_name: "beforeSubmitPrompt", conversation_id: "cursor-1", prompt: "UIを直す" }],
    ["github_copilot", { hook_event_name: "UserPromptSubmit", session_id: "copilot-1", prompt: "CIを確認する" }],
  ];
  for (const [client, payload] of cases) {
    const event = normalizeAgentHookEvent(client, payload, () => "2026-08-25T00:00:00.000Z");
    assert.equal(event.client_kind, client);
    assert.equal(event.kind, "intent");
    assert.ok(event.intent.length > 0);
  }
});

test("collector keeps private paths local and submits one terminal proposal", async (t) => {
  const stateDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "tasken-agent-hook-"));
  t.after(() => fs.rm(stateDirectory, { recursive: true, force: true }));
  const requests = [];
  const coreClient = {
    async getAgentSessionContext(request) {
      assert.equal(request.cwd, "C:\\private\\tasuken");
      return {
        repository_context: { id: "repo-1" },
        themes: [{ id: "theme-1" }],
        tasks: [{ id: "task-ambiguous" }],
        working_copies: [{ id: "copy-1" }],
      };
    },
    async proposeAgentSession(request) {
      requests.push(request);
      return { proposal_id: "proposal-1", status: "queued" };
    },
  };
  const options = { stateDirectory, coreClient, now: () => "2026-08-25T09:00:00.000Z", env: {} };

  await collectAgentHookEvent("codex", {
    hook_event_name: "SessionStart",
    session_id: "thread-1",
    cwd: "C:\\private\\tasuken",
    model: "gpt-test",
  }, options);
  await collectAgentHookEvent("codex", {
    hook_event_name: "UserPromptSubmit",
    session_id: "thread-1",
    prompt: "C:\\private\\tasuken の #498を進める",
  }, options);
  await collectAgentHookEvent("codex", {
    hook_event_name: "Stop",
    session_id: "thread-1",
    last_assistant_message: "修正完了 https://user:secret@example.com/a?token=secret",
  }, options);
  const result = await collectAgentHookEvent("codex", {
    hook_event_name: "SessionEnd",
    session_id: "thread-1",
    reason: "other",
  }, options);

  assert.equal(result.status, "submitted");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].action, "capture");
  assert.equal(requests[0].intent.summary, "[local path] の #498を進める");
  assert.equal(requests[0].outcome.summary, "修正完了 https://example.com/a");
  assert.deepEqual(requests[0].repository_context_ids, ["repo-1"]);
  assert.deepEqual(requests[0].working_copy_ids, ["copy-1"]);
  assert.deepEqual(requests[0].theme_ids, ["theme-1"]);
  assert.equal("task_ids" in requests[0], false);
  assert.deepEqual(await fs.readdir(stateDirectory), []);
});

test("terminal observations survive downtime and flush later", async (t) => {
  const stateDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "tasken-agent-hook-"));
  t.after(() => fs.rm(stateDirectory, { recursive: true, force: true }));
  const unavailable = {
    async getAgentSessionContext() { throw Object.assign(new Error("offline"), { code: "CORE_UNAVAILABLE" }); },
    async proposeAgentSession() { throw Object.assign(new Error("offline"), { code: "CORE_UNAVAILABLE" }); },
  };
  const pending = await collectAgentHookEvent("cursor", {
    hook_event_name: "sessionEnd",
    session_id: "cursor-1",
    reason: "window_close",
  }, { stateDirectory, coreClient: unavailable, now: () => "2026-08-25T09:00:00.000Z" });
  assert.equal(pending.status, "pending");
  assert.equal((await fs.readdir(stateDirectory)).length, 1);

  let submitted = 0;
  const recovered = {
    async getAgentSessionContext() { throw new Error("no context"); },
    async proposeAgentSession() { submitted += 1; return { proposal_id: "proposal-2", status: "queued" }; },
  };
  assert.deepEqual(await flushPendingAgentSessions({ stateDirectory, coreClient: recovered }), { submitted: 1, pending: 0 });
  assert.equal(submitted, 1);
  assert.deepEqual(await fs.readdir(stateDirectory), []);
});

test("concurrent hook processes merge by observation time without corrupting state", async (t) => {
  const stateDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "tasken-agent-hook-"));
  t.after(() => fs.rm(stateDirectory, { recursive: true, force: true }));
  const requests = [];
  const coreClient = {
    async getAgentSessionContext() { throw new Error("no context"); },
    async proposeAgentSession(request) { requests.push(request); return { proposal_id: "proposal-3", status: "queued" }; },
  };
  const base = { stateDirectory, coreClient };
  await Promise.all([
    collectAgentHookEvent("claude_code", {
      hook_event_name: "UserPromptSubmit",
      session_id: "claude-concurrent",
      timestamp: "2026-08-25T09:01:00.000Z",
      prompt: "second prompt",
    }, base),
    collectAgentHookEvent("claude_code", {
      hook_event_name: "UserPromptSubmit",
      session_id: "claude-concurrent",
      timestamp: "2026-08-25T09:00:00.000Z",
      prompt: "first prompt",
    }, base),
    collectAgentHookEvent("claude_code", {
      hook_event_name: "Stop",
      session_id: "claude-concurrent",
      timestamp: "2026-08-25T09:02:00.000Z",
      last_assistant_message: "latest outcome",
    }, base),
  ]);
  await collectAgentHookEvent("claude_code", {
    hook_event_name: "SessionEnd",
    session_id: "claude-concurrent",
    timestamp: "2026-08-25T09:03:00.000Z",
    reason: "other",
  }, base);
  assert.equal(requests[0].intent.summary, "first prompt");
  assert.equal(requests[0].outcome.summary, "latest outcome");
});

test("Stop racing SessionEnd keeps the latest outcome in the terminal observation", async (t) => {
  const stateDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "tasken-agent-hook-"));
  t.after(() => fs.rm(stateDirectory, { recursive: true, force: true }));
  const unavailable = {
    async getAgentSessionContext() { throw Object.assign(new Error("offline"), { code: "CORE_UNAVAILABLE" }); },
    async proposeAgentSession() { throw Object.assign(new Error("offline"), { code: "CORE_UNAVAILABLE" }); },
  };
  const options = { stateDirectory, coreClient: unavailable, settleDelayMs: 25 };
  await Promise.all([
    collectAgentHookEvent("codex", {
      hook_event_name: "SessionEnd",
      session_id: "codex-race",
      reason: "other",
    }, options),
    collectAgentHookEvent("codex", {
      hook_event_name: "Stop",
      session_id: "codex-race",
      last_assistant_message: "final answer survives",
    }, options),
  ]);

  const files = await fs.readdir(stateDirectory);
  assert.equal(files.length, 1);
  const state = JSON.parse(await fs.readFile(path.join(stateDirectory, files[0]), "utf8"));
  assert.equal(state.last_outcome, "final answer survives");
  assert.equal(state.status, "completed");
  assert.equal(state.last_submission_error.code, "CORE_UNAVAILABLE");
});
