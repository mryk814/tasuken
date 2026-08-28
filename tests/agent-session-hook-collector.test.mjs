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

const fixtureDirectory = path.join(import.meta.dirname, "fixtures", "agent-session-hooks");

async function readFixture(name) {
  return JSON.parse(await fs.readFile(path.join(fixtureDirectory, name), "utf8"));
}

function observationFiles(names) {
  return names.filter((name) => /^[a-f0-9]{64}(?:-[a-f0-9]{16})?\.json$/.test(name));
}

test("client hook payloads normalize to one lifecycle vocabulary", () => {
  const cases = [
    [
      "codex",
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "codex-1",
        prompt: "Issue #498を進める",
        cwd: "C:\\private\\tasuken",
      },
    ],
    [
      "claude_code",
      { hook_event_name: "UserPromptSubmit", session_id: "claude-1", prompt: "GitLab側を調べる" },
    ],
    [
      "cursor",
      { hook_event_name: "beforeSubmitPrompt", conversation_id: "cursor-1", prompt: "UIを直す" },
    ],
    [
      "github_copilot",
      { hook_event_name: "UserPromptSubmit", session_id: "copilot-1", prompt: "CIを確認する" },
    ],
  ];
  for (const [client, payload] of cases) {
    const event = normalizeAgentHookEvent(client, payload, () => "2026-08-25T00:00:00.000Z");
    assert.equal(event.client_kind, client);
    assert.equal(event.kind, "intent");
    assert.ok(event.intent.length > 0);
  }
});

test("Copilot official camelCase and VS Code compatible payloads normalize", async () => {
  const camel = await readFixture("github-copilot-camel.json");
  const vscode = await readFixture("github-copilot-vscode.json");
  const expectedKinds = ["start", "intent", "progress", "end"];
  const camelEvents = ["sessionStart", "userPromptSubmitted", "agentStop", "sessionEnd"];
  for (const [index, name] of camelEvents.entries()) {
    const normalized = normalizeAgentHookEvent(
      "github_copilot",
      camel[name],
      () => "2026-08-25T00:00:00.000Z",
      { eventName: name },
    );
    assert.equal(normalized.kind, expectedKinds[index]);
  }
  for (const [index, name] of [
    "SessionStart",
    "UserPromptSubmit",
    "Stop",
    "SessionEnd",
  ].entries()) {
    assert.equal(
      normalizeAgentHookEvent("github_copilot", vscode[name]).kind,
      expectedKinds[index],
    );
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

  await collectAgentHookEvent(
    "codex",
    {
      hook_event_name: "SessionStart",
      session_id: "thread-1",
      cwd: "C:\\private\\tasuken",
      model: "gpt-test",
    },
    options,
  );
  await collectAgentHookEvent(
    "codex",
    {
      hook_event_name: "UserPromptSubmit",
      session_id: "thread-1",
      prompt: "途中でUIの即時反映も確認する",
      timestamp: "2026-08-25T09:01:00.000Z",
    },
    options,
  );
  await collectAgentHookEvent(
    "codex",
    {
      hook_event_name: "UserPromptSubmit",
      session_id: "thread-1",
      prompt: "C:\\private\\tasuken の #498を進める",
    },
    options,
  );
  await collectAgentHookEvent(
    "codex",
    {
      hook_event_name: "Stop",
      session_id: "thread-1",
      last_assistant_message: "修正完了 https://user:secret@example.com/a?token=secret",
    },
    options,
  );
  const result = await collectAgentHookEvent(
    "codex",
    {
      hook_event_name: "SessionEnd",
      session_id: "thread-1",
      reason: "other",
    },
    options,
  );

  assert.equal(result.status, "submitted");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].action, "capture");
  assert.equal(requests[0].intent.summary, "[local path] の #498を進める");
  assert.equal(requests[0].outcome.summary, "修正完了 https://example.com/a");
  assert.deepEqual(
    requests[0].request_events.map((entry) => entry.text),
    ["[local path] の #498を進める", "途中でUIの即時反映も確認する"],
  );
  assert.deepEqual(
    requests[0].response_checkpoints.map((entry) => entry.text),
    ["修正完了 https://example.com/a"],
  );
  assert.deepEqual(requests[0].repository_context_ids, ["repo-1"]);
  assert.deepEqual(requests[0].working_copy_ids, ["copy-1"]);
  assert.deepEqual(requests[0].theme_ids, ["theme-1"]);
  assert.equal("task_ids" in requests[0], false);
  assert.deepEqual(observationFiles(await fs.readdir(stateDirectory)), []);
});

test("Copilot reverse-order hooks keep only the final root assistant result", async (t) => {
  const stateDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "tasken-copilot-hook-"));
  t.after(() => fs.rm(stateDirectory, { recursive: true, force: true }));
  const camel = await readFixture("github-copilot-camel.json");
  const transcript = path.join(fixtureDirectory, "github-copilot-transcript.jsonl");
  const requests = [];
  const coreClient = {
    async getAgentSessionContext() {
      throw new Error("no context");
    },
    async proposeAgentSession(request) {
      requests.push(request);
      return { proposal_id: "proposal-copilot", status: "queued" };
    },
  };
  const options = {
    stateDirectory,
    coreClient,
    settleDelayMs: 0,
    allowedTranscriptRoots: [fixtureDirectory],
  };

  await collectAgentHookEvent("github_copilot", camel.userPromptSubmitted, {
    ...options,
    eventName: "userPromptSubmitted",
  });
  await collectAgentHookEvent("github_copilot", camel.sessionStart, {
    ...options,
    eventName: "sessionStart",
  });
  await collectAgentHookEvent(
    "github_copilot",
    { ...camel.agentStop, transcriptPath: transcript },
    { ...options, eventName: "agentStop" },
  );

  const [pendingName] = observationFiles(await fs.readdir(stateDirectory));
  const pendingText = await fs.readFile(path.join(stateDirectory, pendingName), "utf8");
  assert.match(pendingText, /レビュー資料を作成し、残る確認事項を2件に整理しました。/);
  for (const excluded of [
    transcript,
    "transcriptPath",
    "user-private-source",
    "途中回答",
    "tool-private-result",
    "subagent-private-result",
    "parent-tool-subagent-private",
    "reasoning-private-text",
  ]) {
    assert.equal(pendingText.includes(excluded), false);
  }

  const result = await collectAgentHookEvent("github_copilot", camel.sessionEnd, {
    ...options,
    eventName: "sessionEnd",
  });
  assert.equal(result.status, "submitted");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].started_at, "2026-08-25T00:00:00.000Z");
  assert.equal(
    requests[0].outcome.summary,
    "レビュー資料を作成し、残る確認事項を2件に整理しました。",
  );
  const submittedText = JSON.stringify(requests[0]);
  assert.equal(submittedText.includes("transcript"), false);
  assert.equal(submittedText.includes("private"), false);
});

test("Copilot VS Code compatible hooks use transcript_path through the same collector", async (t) => {
  const stateDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "tasken-copilot-vscode-"));
  t.after(() => fs.rm(stateDirectory, { recursive: true, force: true }));
  const vscode = await readFixture("github-copilot-vscode.json");
  const transcript = path.join(fixtureDirectory, "github-copilot-transcript.jsonl");
  const requests = [];
  const options = {
    stateDirectory,
    settleDelayMs: 0,
    allowedTranscriptRoots: [fixtureDirectory],
    coreClient: {
      async getAgentSessionContext() {
        throw new Error("no context");
      },
      async proposeAgentSession(request) {
        requests.push(request);
        return { proposal_id: "proposal-vscode", status: "queued" };
      },
    },
  };

  for (const [name, payload] of Object.entries(vscode)) {
    await collectAgentHookEvent(
      "github_copilot",
      name === "Stop" ? { ...payload, transcript_path: transcript } : payload,
      options,
    );
  }
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].outcome.summary,
    "レビュー資料を作成し、残る確認事項を2件に整理しました。",
  );
});

test("terminal observations survive downtime and flush later", async (t) => {
  const stateDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "tasken-agent-hook-"));
  t.after(() => fs.rm(stateDirectory, { recursive: true, force: true }));
  const unavailable = {
    async getAgentSessionContext() {
      throw Object.assign(new Error("offline"), { code: "CORE_UNAVAILABLE" });
    },
    async proposeAgentSession() {
      throw Object.assign(new Error("offline"), { code: "CORE_UNAVAILABLE" });
    },
  };
  const pending = await collectAgentHookEvent(
    "cursor",
    {
      hook_event_name: "sessionEnd",
      session_id: "cursor-1",
      reason: "window_close",
    },
    { stateDirectory, coreClient: unavailable, now: () => "2026-08-25T09:00:00.000Z" },
  );
  assert.equal(pending.status, "pending");
  assert.equal((await fs.readdir(stateDirectory)).length, 1);

  let submitted = 0;
  const recovered = {
    async getAgentSessionContext() {
      throw new Error("no context");
    },
    async proposeAgentSession() {
      submitted += 1;
      return { proposal_id: "proposal-2", status: "queued" };
    },
  };
  assert.deepEqual(await flushPendingAgentSessions({ stateDirectory, coreClient: recovered }), {
    submitted: 1,
    pending: 0,
  });
  assert.equal(submitted, 1);
  assert.deepEqual(observationFiles(await fs.readdir(stateDirectory)), []);

  const duplicate = await collectAgentHookEvent(
    "cursor",
    {
      hook_event_name: "sessionEnd",
      session_id: "cursor-1",
      reason: "window_close",
    },
    { stateDirectory, coreClient: recovered, now: () => "2026-08-25T09:00:00.000Z" },
  );
  assert.equal(duplicate.status, "duplicate");
  assert.equal(submitted, 1);
});

test("resuming the same source session keeps pending and new lifecycles separate", async (t) => {
  const stateDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "tasken-hook-resume-"));
  t.after(() => fs.rm(stateDirectory, { recursive: true, force: true }));
  const unavailable = {
    async getAgentSessionContext() {
      throw Object.assign(new Error("offline"), { code: "CORE_UNAVAILABLE" });
    },
    async proposeAgentSession() {
      throw Object.assign(new Error("offline"), { code: "CORE_UNAVAILABLE" });
    },
  };
  const oldOptions = { stateDirectory, coreClient: unavailable, settleDelayMs: 0 };
  for (const payload of [
    {
      hook_event_name: "SessionStart",
      session_id: "resumed-source",
      timestamp: "2026-08-25T09:00:00.000Z",
      initial_prompt: "old lifecycle",
    },
    {
      hook_event_name: "SessionEnd",
      session_id: "resumed-source",
      timestamp: "2026-08-25T09:30:00.000Z",
      reason: "user_exit",
    },
  ]) {
    await collectAgentHookEvent("codex", payload, oldOptions);
  }

  const resumed = await collectAgentHookEvent(
    "codex",
    {
      hook_event_name: "SessionStart",
      session_id: "resumed-source",
      timestamp: "2026-08-25T10:00:00.000Z",
      initial_prompt: "new lifecycle",
    },
    oldOptions,
  );
  assert.equal(resumed.status, "observed");
  assert.equal(observationFiles(await fs.readdir(stateDirectory)).length, 2);

  const requests = [];
  const recovered = {
    async getAgentSessionContext() {
      throw new Error("no context");
    },
    async proposeAgentSession(request) {
      requests.push(request);
      return { proposal_id: `proposal-${requests.length}`, status: "queued" };
    },
  };
  const lateOldStart = await collectAgentHookEvent(
    "codex",
    {
      hook_event_name: "SessionStart",
      session_id: "resumed-source",
      timestamp: "2026-08-25T09:00:00.000Z",
      initial_prompt: "old lifecycle replay",
    },
    { stateDirectory, coreClient: recovered, settleDelayMs: 0 },
  );
  assert.equal(lateOldStart.status, "stale");
  const lateOldEnd = await collectAgentHookEvent(
    "codex",
    {
      hook_event_name: "SessionEnd",
      session_id: "resumed-source",
      timestamp: "2026-08-25T09:30:00.000Z",
      reason: "user_exit",
    },
    { stateDirectory, coreClient: recovered, settleDelayMs: 0 },
  );
  assert.equal(lateOldEnd.status, "stale");

  await collectAgentHookEvent(
    "codex",
    {
      hook_event_name: "Stop",
      session_id: "resumed-source",
      timestamp: "2026-08-25T10:20:00.000Z",
      last_assistant_message: "new lifecycle outcome",
    },
    { stateDirectory, coreClient: recovered, settleDelayMs: 0 },
  );
  const newTerminal = await collectAgentHookEvent(
    "codex",
    {
      hook_event_name: "SessionEnd",
      session_id: "resumed-source",
      timestamp: "2026-08-25T10:30:00.000Z",
      reason: "complete",
    },
    { stateDirectory, coreClient: recovered, settleDelayMs: 0 },
  );
  assert.equal(newTerminal.status, "submitted");
  assert.deepEqual(await flushPendingAgentSessions({ stateDirectory, coreClient: recovered }), {
    submitted: 1,
    pending: 0,
  });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map((request) => request.intent.summary).sort(), [
    "new lifecycle",
    "old lifecycle",
  ]);
  for (const request of requests) {
    assert.ok(request.started_at <= request.ended_at);
  }
  assert.equal(new Set(requests.map((request) => request.idempotency_key)).size, 2);
  assert.equal(
    requests.some((request) =>
      request.request_events.some((entry) => entry.text.includes("replay")),
    ),
    false,
  );
});

test("an abandoned lock owner is recovered before the next hook event", async (t) => {
  const stateDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "tasken-hook-lock-"));
  t.after(() => fs.rm(stateDirectory, { recursive: true, force: true }));
  await collectAgentHookEvent(
    "claude_code",
    {
      hook_event_name: "SessionStart",
      session_id: "stale-lock-source",
      timestamp: "2026-08-25T09:00:00.000Z",
    },
    { stateDirectory },
  );
  const [stateName] = observationFiles(await fs.readdir(stateDirectory));
  const lockPath = path.join(stateDirectory, `${stateName}.lock`);
  await fs.mkdir(lockPath);
  await fs.writeFile(
    path.join(lockPath, "owner.json"),
    `${JSON.stringify({ pid: 2_147_483_647 })}\n`,
    "utf8",
  );

  const results = await Promise.all([
    collectAgentHookEvent(
      "claude_code",
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "stale-lock-source",
        timestamp: "2026-08-25T09:01:00.000Z",
        prompt: "first lock recovery",
      },
      { stateDirectory },
    ),
    collectAgentHookEvent(
      "claude_code",
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "stale-lock-source",
        timestamp: "2026-08-25T09:02:00.000Z",
        prompt: "second lock recovery",
      },
      { stateDirectory },
    ),
  ]);
  assert.ok(results.every((result) => result.status === "observed"));
  assert.equal(
    await fs
      .stat(lockPath)
      .then(() => true)
      .catch(() => false),
    false,
  );
  const state = JSON.parse(await fs.readFile(path.join(stateDirectory, stateName), "utf8"));
  assert.deepEqual(
    state.request_events.map((entry) => entry.text),
    ["first lock recovery", "second lock recovery"],
  );
});

test("concurrent hook processes merge by observation time without corrupting state", async (t) => {
  const stateDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "tasken-agent-hook-"));
  t.after(() => fs.rm(stateDirectory, { recursive: true, force: true }));
  const requests = [];
  const coreClient = {
    async getAgentSessionContext() {
      throw new Error("no context");
    },
    async proposeAgentSession(request) {
      requests.push(request);
      return { proposal_id: "proposal-3", status: "queued" };
    },
  };
  const base = { stateDirectory, coreClient };
  await Promise.all([
    collectAgentHookEvent(
      "claude_code",
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "claude-concurrent",
        timestamp: "2026-08-25T09:01:00.000Z",
        prompt: "second prompt",
      },
      base,
    ),
    collectAgentHookEvent(
      "claude_code",
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "claude-concurrent",
        timestamp: "2026-08-25T09:00:00.000Z",
        prompt: "first prompt",
      },
      base,
    ),
    collectAgentHookEvent(
      "claude_code",
      {
        hook_event_name: "Stop",
        session_id: "claude-concurrent",
        timestamp: "2026-08-25T09:02:00.000Z",
        last_assistant_message: "latest outcome",
      },
      base,
    ),
  ]);
  await collectAgentHookEvent(
    "claude_code",
    {
      hook_event_name: "SessionEnd",
      session_id: "claude-concurrent",
      timestamp: "2026-08-25T09:03:00.000Z",
      reason: "other",
    },
    base,
  );
  assert.equal(requests[0].intent.summary, "first prompt");
  assert.equal(requests[0].outcome.summary, "latest outcome");
  assert.deepEqual(
    requests[0].request_events.map((entry) => entry.text),
    ["first prompt", "second prompt"],
  );
});

test("Stop racing SessionEnd keeps the latest outcome in the terminal observation", async (t) => {
  const stateDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "tasken-agent-hook-"));
  t.after(() => fs.rm(stateDirectory, { recursive: true, force: true }));
  const unavailable = {
    async getAgentSessionContext() {
      throw Object.assign(new Error("offline"), { code: "CORE_UNAVAILABLE" });
    },
    async proposeAgentSession() {
      throw Object.assign(new Error("offline"), { code: "CORE_UNAVAILABLE" });
    },
  };
  const options = { stateDirectory, coreClient: unavailable, settleDelayMs: 25 };
  await Promise.all([
    collectAgentHookEvent(
      "codex",
      {
        hook_event_name: "SessionEnd",
        session_id: "codex-race",
        reason: "other",
      },
      options,
    ),
    collectAgentHookEvent(
      "codex",
      {
        hook_event_name: "Stop",
        session_id: "codex-race",
        last_assistant_message: "final answer survives",
      },
      options,
    ),
  ]);

  const files = await fs.readdir(stateDirectory);
  assert.equal(files.length, 1);
  const state = JSON.parse(await fs.readFile(path.join(stateDirectory, files[0]), "utf8"));
  assert.equal(state.last_outcome, "final answer survives");
  assert.equal(state.status, "completed");
  assert.equal(state.last_submission_error.code, "CORE_UNAVAILABLE");
});
