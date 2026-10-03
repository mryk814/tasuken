import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { collectAgentHookEvent } from "../src/main/mcp/agentSessionHookCollector.mjs";
import { TaskenCoreClient } from "../src/main/mcp/taskenCoreClient.mjs";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
const bundle = await build({
  stdin: {
    contents: `
 export { createTaskenCore } from './src/main/infrastructure/sqlite/public.ts';
 export { TaskenCoreHost } from './src/main/infrastructure/http/taskenCoreHost.ts';
 export { ApplicationCommandService } from './src/main/services/applicationCommandService.ts';
`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-agent-core-bundle-"));
const bundlePath = path.join(bundleRoot, "core.mjs");
fs.writeFileSync(bundlePath, bundle.outputFiles[0].text);
test.after(() => fs.rmSync(bundleRoot, { recursive: true, force: true }));
const { createTaskenCore, TaskenCoreHost, ApplicationCommandService } = await import(
  pathToFileURL(bundlePath).href
);

test("actual collector/Core: accept, duplicate, replay, resume, interruption and reordered checkpoints survive restart", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-agent-log-core-"));
  let db = new WorkspaceDatabase(path.join(root, "workspace.sqlite3"));
  let host;
  try {
    host = new TaskenCoreHost({ userDataPath: root, ...createTaskenCore(db) });
    await host.start();
    const client = new TaskenCoreClient({ userDataPath: root });
    const options = {
      coreClient: client,
      stateDirectory: path.join(root, "observations"),
      settleDelayMs: 0,
    };
    const event = async (name, time, extra = {}) =>
      collectAgentHookEvent(
        "codex",
        { session_id: "same-native-thread", hook_event_name: name, timestamp: time, ...extra },
        options,
      );
    const accept = (result) => {
      const proposal = db.get("ai_proposal", result.proposal_id);
      const entry = proposal.payload.agent_sessions[0];
      new ApplicationCommandService(db).execute({
        commandId: `accept:${proposal.id}`,
        name: "ApplyAiProposal",
        payload: {
          proposal: { ...proposal, status: "accepted" },
          candidates: [{ type: "agent_session", entity: entry.session }],
        },
        actor: { kind: "user" },
        source: "main_ui",
        expectedVersions: [{ type: "ai_proposal", id: proposal.id, version: proposal.version }],
        issuedAt: new Date().toISOString(),
      });
      return entry.session.id;
    };
    await event("SessionStart", "2026-10-01T08:00:00Z");
    await event("Stop", "2026-10-01T08:30:00Z", { last_assistant_message: "first answer" });
    await event("UserPromptSubmit", "2026-10-01T08:05:00Z", { prompt: "first request" });
    const first = await event("SessionEnd", "2026-10-01T08:40:00Z", { reason: "completed" });
    assert.equal(first.status, "submitted");
    const firstId = accept(first);
    assert.equal(
      (await event("SessionEnd", "2026-10-01T08:40:00Z", { reason: "completed" })).status,
      "duplicate",
    );
    // Reconstruct exact sender request from observation using a second isolated collector state.
    const replayOptions = { ...options, stateDirectory: path.join(root, "replay") };
    for (const [name, time, extra] of [
      ["SessionStart", "2026-10-01T08:00:00Z", {}],
      ["UserPromptSubmit", "2026-10-01T08:05:00Z", { prompt: "first request" }],
      ["Stop", "2026-10-01T08:30:00Z", { last_assistant_message: "first answer" }],
      ["SessionEnd", "2026-10-01T08:40:00Z", { reason: "completed" }],
    ]) {
      const result = await collectAgentHookEvent(
        "codex",
        { session_id: "same-native-thread", hook_event_name: name, timestamp: time, ...extra },
        replayOptions,
      );
      if (name === "SessionEnd") assert.equal(result.submission_status, "duplicate");
    }
    await event("SessionStart", "2026-10-01T10:00:00Z");
    await event("Stop", "2026-10-01T10:20:00Z", { last_assistant_message: "resumed answer" });
    await event("UserPromptSubmit", "2026-10-01T10:05:00Z", { prompt: "resume request" });
    const resumed = await event("SessionEnd", "2026-10-01T10:30:00Z", { reason: "user_exit" });
    assert.equal(resumed.status, "submitted");
    const secondId = accept(resumed);
    assert.notEqual(firstId, secondId);
    assert.equal(db.get("agent_session", firstId).response_checkpoints[0].text, "first answer");
    assert.equal(db.get("agent_session", secondId).source_session_id, "same-native-thread");
    assert.equal(db.get("agent_session", secondId).status, "abandoned");
    assert.equal(
      (await event("Stop", "2026-10-01T08:30:00Z", { last_assistant_message: "late old answer" }))
        .status,
      "duplicate",
    );
    await event("SessionStart", "2026-10-01T12:00:00Z");
    await event("UserPromptSubmit", "2026-10-01T12:01:00Z", { prompt: "not ended" });
    assert.equal(
      db.list("agent_session").length,
      2,
      "unfinished collector does not fabricate completion",
    );
    await host.stop();
    host = null;
    db.db.close();
    db = new WorkspaceDatabase(path.join(root, "workspace.sqlite3"));
    assert.equal(db.list("agent_session").length, 2);
    assert.equal(db.get("agent_session", firstId).request_events[0].text, "first request");
  } finally {
    if (host) await host.stop();
    db.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Core keeps legacy identities safe, rejects changed-key content and exposes midnight overlaps", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-agent-legacy-"));
  const db = new WorkspaceDatabase(path.join(root, "workspace.sqlite3"));
  const core = createTaskenCore(db);
  const host = new TaskenCoreHost({ userDataPath: root, ...core });
  try {
    await host.start();
    const client = new TaskenCoreClient({ userDataPath: root });
    const common = {
      caller: "Core contract fixture",
      source: "mcp",
      source_app: "tasken-session-hook:opencode",
      source_session: "synthetic-legacy",
      actor: { kind: "ai_agent" },
      client_kind: "opencode",
      intent: { summary: "legacy request" },
      started_at: new Date(2026, 9, 1, 23, 30).toISOString(),
    };
    const started = await client.proposeAgentSession({
      ...common,
      action: "start",
      idempotency_key: "legacy-start",
    });
    const proposal = db.get("ai_proposal", started.proposal_id);
    const entry = proposal.payload.agent_sessions[0];
    new ApplicationCommandService(db).execute({
      commandId: "legacy-accept",
      name: "ApplyAiProposal",
      payload: {
        proposal: { ...proposal, status: "accepted" },
        candidates: [{ type: "agent_session", entity: entry.session }],
      },
      actor: { kind: "user" },
      source: "main_ui",
      expectedVersions: [{ type: "ai_proposal", id: proposal.id, version: proposal.version }],
      issuedAt: new Date().toISOString(),
    });
    const capture = {
      ...common,
      action: "capture",
      idempotency_key: "new-export",
      ended_at: new Date(2026, 9, 2, 1).toISOString(),
      status: "unknown",
      outcome: { summary: "observed answer" },
    };
    await assert.rejects(
      () => client.proposeAgentSession(capture),
      (error) => error.code === "SESSION_CONFLICT",
    );
    const resumed = await client.proposeAgentSession({
      ...capture,
      idempotency_key: "resumed-export",
      started_at: "2026-10-03T08:00:00Z",
      ended_at: "2026-10-03T09:00:00Z",
    });
    assert.notEqual(resumed.agent_session_id, started.agent_session_id);
    await assert.rejects(
      () =>
        client.proposeAgentSession({
          ...capture,
          idempotency_key: "resumed-export",
          started_at: "2026-10-03T08:00:00Z",
          ended_at: "2026-10-03T09:00:00Z",
          outcome: { summary: "different answer" },
        }),
      (error) => error.code === "IDEMPOTENCY_CONFLICT",
    );
    const visible = await client.getAgentSessionContext({
      client_kind: "opencode",
      date: "2026-10-02",
      source_session: "fixture-reader",
    });
    assert.ok(visible.sessions.some((session) => session.id === started.agent_session_id));
    assert.equal(db.list("agent_session").length, 1, "changed content is never silently adopted");
  } finally {
    await host.stop();
    db.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
