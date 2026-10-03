import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import { SharedFolderSyncService } from "../src/main/services/sharedFolderSync.mjs";
import { TaskenCoreClient } from "../src/main/mcp/taskenCoreClient.mjs";
import { coreWriteProfile } from "../src/shared/contracts/core/public.mjs";
import { buildReport } from "../scripts/mcp-doctor.mjs";
import { buildMcpBridge } from "../scripts/build-mcp-bridge.mjs";

const bundles = fs.mkdtempSync(path.join(process.cwd(), ".ai-task-start-test-"));
after(() => fs.rmSync(bundles, { recursive: true, force: true }));
const mcpDirectory = path.join(bundles, "mcp");
await buildMcpBridge({ outDir: mcpDirectory });
await build({
  stdin: {
    contents: `
      export { startTaskenHeadlessCore } from "./src/main/headless/taskenHeadlessCore.ts";
      export { parseTaskenHeadlessCoreArgs } from "./src/main/headless/main.ts";
      export { ApplicationCommandService } from "./src/main/services/applicationCommandService.ts";
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  alias: { electron: path.resolve("src/main/headless/electronUnavailable.ts") },
  outfile: path.join(bundles, "core.mjs"),
  logLevel: "silent",
});
const { startTaskenHeadlessCore, parseTaskenHeadlessCoreArgs, ApplicationCommandService } =
  await import(pathToFileURL(path.join(bundles, "core.mjs")));

const startedAt = "2026-10-03T06:00:00.000Z";
const attempt = "12c9a3df-084a-4314-8a80-de844b512fad";
function request(version = 1, extra = {}) {
  return {
    task_id: "personal-ready",
    expected_version: version,
    idempotency_key: "start-personal-ready",
    caller: "こもり",
    started_at: startedAt,
    work_attempt_id: attempt,
    source_session: "test-conversation",
    ...extra,
  };
}
function open(dir) {
  const db = new WorkspaceDatabase(path.join(dir, "research-desk.sqlite"));
  db.loadWorkspace();
  return db;
}
function saveTask(db, id = "personal-ready", extra = {}) {
  const initial = db.save("task", {
    id,
    title: "Compare a bottom plate",
    description: "Research only. Purchase requires the owner.",
    project_id: "theme-personal-default",
    requester: "self",
    state: "todo",
    priority: "normal",
    intended_executor: "ai_agent",
    work_state: "ready_for_agent",
    ...extra,
    ...(extra.state === "done" ? { state: "todo" } : {}),
  });
  // Repository assignment normalization initially settles at AI Ready. Seed
  // later canonical states as a separate change rather than bypassing it.
  return (extra.work_state && extra.work_state !== initial.work_state) ||
    (extra.state && extra.state !== initial.state)
    ? db.save("task", { ...initial, ...extra })
    : initial;
}
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-ai-task-start-"));
  t.after(async () => {
    for (const core of t.taskenFixtureCores || []) await core.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
async function coreFixture(t, seed = (db) => saveTask(db), options = {}) {
  const dir = temp(t);
  const seedDb = open(dir);
  try {
    seed(seedDb);
  } finally {
    seedDb.db.close();
  }
  const core = await startTaskenHeadlessCore({
    userDataPath: dir,
    writeMode: "create-only",
    allowAiTaskStart: true,
    env: {},
    ...options,
  });
  t.after(() => core.stop());
  (t.taskenFixtureCores ||= []).push(core);
  return { dir, core, client: new TaskenCoreClient({ userDataPath: dir }) };
}
async function connectMcp(dir, readOnly = false) {
  const transport = new StdioClientTransport({
    command: process.env.TASKEN_NODE_EXEC_PATH || process.execPath,
    args: [path.join(mcpDirectory, "server.mjs")],
    env: {
      ...process.env,
      TASKEN_USER_DATA_DIR: dir,
      TASKEN_MCP_READ_ONLY: readOnly ? "1" : "0",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "limited-start-test", version: "1" });
  await client.connect(transport);
  return client;
}
async function assignment(client, id = "personal-ready") {
  return (await client.getTaskAssignment({ task_id: id, include_archived: true })).task;
}
function humanEnvelope(name, payload, expectedVersions) {
  return {
    commandId: randomUUID(),
    name,
    payload,
    actor: { kind: "user" },
    source: "main_ui",
    expectedVersions,
    issuedAt: "2026-10-03T07:00:00.000Z",
  };
}

test("start is an independent opt-in; defaults, read-only and legacy full stay intact", async (t) => {
  for (const mode of ["proposals", "create-only"]) {
    const { client } = await coreFixture(t, undefined, {
      writeMode: mode,
      allowAiTaskStart: false,
    });
    const status = await client.inspect();
    assert(!status.capabilities.includes("task.start_work"));
    assert(!status.capabilities.includes("task.command"));
    await assert.rejects(
      client.startAiTaskWork(request()),
      (e) => e.code === "CAPABILITY_UNAVAILABLE",
    );
    assert.equal((await assignment(client)).work_state, "ready_for_agent");
  }
  const { client, dir } = await coreFixture(t);
  const status = await client.inspect();
  assert(status.capabilities.includes("task.start_work"));
  assert(!status.capabilities.includes("task.command"));
  const writableMcp = await connectMcp(dir);
  let writes;
  try {
    const result = await writableMcp.callTool({ name: "tasken.get_capabilities", arguments: {} });
    assert(!result.isError, JSON.stringify(result));
    writes = result.structuredContent;
  } finally {
    await writableMcp.close();
  }
  assert.equal(writes.core.write_profile, "create-and-start");
  assert.equal(writes.writes.task_start, true);
  assert.equal(writes.writes.note_edit, false);
  assert.equal(writes.writes.feed_reply, false);
  assert.equal(writes.writes.note_images, false);
  assert.equal(coreWriteProfile(["task.start_work"]).profile, "start-only");
  assert.equal(
    coreWriteProfile([
      "propose_content",
      "propose_repository_task",
      "propose_task_work",
      "task.start_work",
    ]).profile,
    "proposals-and-start",
  );
  const doctor = await buildReport(client);
  assert.equal(doctor.ok, true);
  assert.equal(doctor.checks.at(-1).code, "MCP_CORE_LIMITED_START_READY");
  const mcp = await connectMcp(dir, true);
  try {
    assert(!(await mcp.listTools()).tools.some((x) => x.name === "tasken.start_task_work"));
    const result = await mcp.callTool({ name: "tasken.get_capabilities", arguments: {} });
    assert(!result.isError, JSON.stringify(result));
    assert.equal(result.structuredContent.writes.task_start, false);
  } finally {
    await mcp.close();
  }
  await assert.rejects(
    startTaskenHeadlessCore({
      userDataPath: path.join(temp(t), "never-opened"),
      writeMode: "read-only",
      allowAiTaskStart: true,
      env: {},
    }),
    (e) => e.code === "WRITE_MODE_CONFLICT",
  );
  assert.equal(
    parseTaskenHeadlessCoreArgs(["--write-mode=create-only"], {}).allowAiTaskStart,
    undefined,
  );
  assert.equal(
    parseTaskenHeadlessCoreArgs(["--write-mode=create-only", "--allow-ai-task-start"], {})
      .allowAiTaskStart,
    true,
  );
  assert.equal(
    parseTaskenHeadlessCoreArgs([], { TASKEN_CORE_AI_TASK_START: "true" }).allowAiTaskStart,
    undefined,
  );
  assert.equal(
    parseTaskenHeadlessCoreArgs([], { TASKEN_CORE_AI_TASK_START: "1" }).allowAiTaskStart,
    true,
  );
});

test("the HTTP start route authenticates and rejects actor, command, edit and path inputs", async (t) => {
  const { dir, core, client } = await coreFixture(t);
  // This token belongs only to the disposable test Core and is never printed.
  const discovery = JSON.parse(fs.readFileSync(path.join(dir, "tasken-core.json"), "utf8"));
  const unauthorized = await fetch(core.origin + "/v1/commands/start-ai-task-work", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request()),
  });
  assert.equal(unauthorized.status, 401);
  const before = await assignment(client);
  for (const name of [
    "CreateTask",
    "UpdateTask",
    "DeleteTask",
    "CompleteTask",
    "ReopenTask",
    "DelegateTaskToAgent",
    "ReassignTaskWork",
    "AcceptTaskWork",
    "ReturnTaskWork",
    "ApplyTaskWorkProposal",
    "ApplyAiProposal",
  ]) {
    const generic = await fetch(core.origin + "/v1/task/command", {
      method: "POST",
      headers: { authorization: `Bearer ${discovery.token}`, "content-type": "application/json" },
      body: JSON.stringify({ name, actor: { kind: "user" }, payload: { task_id: before.id } }),
    });
    assert.equal(generic.status, 404, name);
  }
  for (const extra of [
    { actor: { kind: "user" } },
    { source: "desktop" },
    { name: "DeleteTask" },
    { payload: { complete_task: true } },
    { title: "Changed" },
    { body: "Changed" },
    { workspace_id: "other" },
    { project_id: "other" },
    { executor_kind: "human" },
    { executor_identity: "other" },
    { state: "done" },
    { deleted_at: startedAt },
    { intended_executor: "self" },
    { complete_task: true },
    { decision: "accept" },
    { proposal_id: "other-proposal" },
    { canonical_path: "other" },
    { expected_version: 0 },
    { work_attempt_id: "not-a-uuid" },
  ]) {
    await assert.rejects(
      client.startAiTaskWork(request(1, extra)),
      (e) => e.code === "VALIDATION_FAILED",
    );
  }
  const { work_attempt_id: _attempt, ...missingAttempt } = request();
  await assert.rejects(
    client.startAiTaskWork(missingAttempt),
    (e) => e.code === "VALIDATION_FAILED",
  );
  assert.deepEqual(await assignment(client), before);
});

test("start is scoped to the connected workspace and rejects another Core's credential", async (t) => {
  const first = await coreFixture(t);
  const second = await coreFixture(t);
  const otherBefore = await assignment(second.client);
  const firstDiscovery = JSON.parse(
    fs.readFileSync(path.join(first.dir, "tasken-core.json"), "utf8"),
  );
  const crossWorkspace = await fetch(second.core.origin + "/v1/commands/start-ai-task-work", {
    method: "POST",
    headers: {
      authorization: `Bearer ${firstDiscovery.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(request(otherBefore.version)),
  });
  assert.equal(crossWorkspace.status, 401);
  const firstStart = await first.client.startAiTaskWork(
    request((await assignment(first.client)).version),
  );
  assert.equal(firstStart.ok, true);
  assert.deepEqual(await assignment(second.client), otherBefore);
  const secondStart = await second.client.startAiTaskWork(request(otherBefore.version));
  assert.equal(secondStart.ok, true);
  assert.notEqual(firstStart.value.command_id, secondStart.value.command_id);
});

test("revocation denies an already-connected MCP and preserves every existing create-only permission", async (t) => {
  const { dir, core, client } = await coreFixture(t);
  const mcp = await connectMcp(dir);
  let revoked;
  const before = await assignment(client);
  try {
    const enabled = await mcp.callTool({ name: "tasken.get_capabilities", arguments: {} });
    assert.equal(enabled.structuredContent.writes.task_start, true);
    await core.stop();
    revoked = await startTaskenHeadlessCore({
      userDataPath: dir,
      writeMode: "create-only",
      allowAiTaskStart: false,
      env: {},
    });
    const disabled = await mcp.callTool({ name: "tasken.get_capabilities", arguments: {} });
    assert.equal(disabled.structuredContent.core.write_profile, "create-only");
    assert.deepEqual(enabled.structuredContent.writes, {
      ...disabled.structuredContent.writes,
      task_start: true,
    });
    const refused = await mcp.callTool({
      name: "tasken.start_task_work",
      arguments: request(before.version),
    });
    assert.equal(refused.isError, true);
    assert.equal(refused.structuredContent.error.code, "CAPABILITY_UNAVAILABLE");
    const fresh = new TaskenCoreClient({ userDataPath: dir });
    const status = await fresh.inspect();
    assert(!status.capabilities.includes("task.command"));
    assert(!status.capabilities.includes("task.start_work"));
    assert.deepEqual(await assignment(fresh), before);
  } finally {
    await mcp.close();
    await revoked?.stop();
  }
});

test("only the owner's active personal AI Ready Tasks can be newly claimed", async (t) => {
  const { client } = await coreFixture(t, (db) => {
    db.save("theme", { id: "other-theme", name: "Project" });
    saveTask(db);
    saveTask(db, "not-personal", { project_id: "other-theme" });
    saveTask(db, "other-requester", { requester: "human" });
    saveTask(db, "not-ready", { intended_executor: "self", work_state: "not_delegated" });
    saveTask(db, "working", {
      work_state: "in_progress",
      executor_identity: "other agent",
      work_started_at: startedAt,
      work_attempt_id: randomUUID(),
    });
    saveTask(db, "reviewing", { work_state: "needs_human_review" });
    saveTask(db, "blocked", { work_state: "blocked" });
    saveTask(db, "accepted", { work_state: "accepted" });
    saveTask(db, "done", { state: "done", work_state: "accepted" });
    saveTask(db, "cancelled", { state: "cancelled" });
    saveTask(db, "archived");
    db.remove("task", "archived");
    saveTask(db, "legacy-invalid", { priority: undefined });
  });
  for (const id of [
    "not-personal",
    "other-requester",
    "not-ready",
    "working",
    "reviewing",
    "blocked",
    "accepted",
    "done",
    "cancelled",
    "archived",
  ]) {
    const before = await assignment(client, id);
    const result = await client.startAiTaskWork(
      request(before.version, { task_id: id, idempotency_key: id }),
    );
    assert.equal(result.ok, false, id);
    assert.equal(result.error.code, "INVALID_TRANSITION", id);
    assert.deepEqual(await assignment(client, id), before, id);
  }
  const missing = await client.startAiTaskWork(request(1, { task_id: "missing" }));
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "NOT_FOUND");
  const legacy = await client.startAiTaskWork(
    request(1, { task_id: "legacy-invalid", idempotency_key: "legacy-invalid" }),
  );
  assert.equal(legacy.ok, false);
  assert.equal(legacy.error.code, "INVALID_COMMAND");
  assert.equal((await assignment(client, "legacy-invalid")).work_state, "ready_for_agent");
  const stale = await client.startAiTaskWork(request(99));
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, "CONFLICT");
  assert.equal((await assignment(client)).work_state, "ready_for_agent");
});

test("start persists only work fields; retry, conflict and restart return current canonical state", async (t) => {
  const { dir, core, client } = await coreFixture(t);
  const before = await assignment(client);
  const args = request(before.version);
  const results = await Promise.all([client.startAiTaskWork(args), client.startAiTaskWork(args)]);
  assert(
    results.every((r) => r.ok),
    JSON.stringify(results),
  );
  assert.equal(results[0].value.task.version, before.version + 1);
  assert.equal(results[1].value.task.version, before.version + 1);
  const current = await assignment(client);
  for (const key of [
    "title",
    "description",
    "state",
    "project_id",
    "requester",
    "priority",
    "intended_executor",
    "deleted_at",
  ]) {
    assert.deepEqual(current[key], before[key], key);
  }
  assert.equal(current.work_state, "in_progress");
  assert.equal(current.executor_identity, "こもり");
  assert.equal(current.work_started_at, startedAt);
  assert.equal(current.work_attempt_id, attempt);
  for (const changed of [
    { caller: "another agent" },
    { started_at: "2026-10-03T06:01:00.000Z" },
    { expected_version: current.version },
    { work_attempt_id: randomUUID() },
    { source_session: "different" },
    { task_id: "different" },
  ]) {
    const conflict = await client.startAiTaskWork({ ...args, ...changed });
    assert.equal(conflict.ok, false);
    assert.equal(conflict.error.code, "CONFLICT");
    assert.equal(conflict.error.conflict_reason, "command_fingerprint_mismatch");
  }
  for (const caller of ["こもり", "another agent"]) {
    const takeover = await client.startAiTaskWork(
      request(current.version, {
        caller,
        idempotency_key: randomUUID(),
        work_attempt_id: randomUUID(),
      }),
    );
    assert.equal(takeover.ok, false);
    assert.equal(takeover.error.code, "INVALID_TRANSITION");
  }
  await core.stop();
  const db = open(dir);
  const audit = db.list("change_event").filter((e) => e.metadata?.work_action === "started");
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor_kind, "ai_agent");
  assert.equal(audit[0].actor_id, "こもり");
  assert.equal(audit[0].command_source, "mcp");
  db.save("task", { ...db.get("task", "personal-ready"), description: "Owner's later edit" });
  db.remove("task", "personal-ready");
  const archivedVersion = db.get("task", "personal-ready", true).version;
  db.db.close();
  const restarted = await startTaskenHeadlessCore({
    userDataPath: dir,
    writeMode: "create-only",
    allowAiTaskStart: true,
    env: {},
  });
  try {
    const fresh = new TaskenCoreClient({ userDataPath: dir });
    const replay = await fresh.startAiTaskWork(args);
    assert.equal(replay.ok, true);
    assert.equal(replay.value.task.description, "Owner's later edit");
    assert.equal(replay.value.task.version, archivedVersion);
    assert(replay.value.task.deleted_at);
    assert.equal(replay.value.task.work_attempt_id, attempt);
  } finally {
    await restarted.stop();
  }
  const revoked = await startTaskenHeadlessCore({
    userDataPath: dir,
    writeMode: "create-only",
    allowAiTaskStart: false,
    env: {},
  });
  try {
    const disabled = new TaskenCoreClient({ userDataPath: dir });
    await assert.rejects(
      disabled.startAiTaskWork(args),
      (e) => e.code === "CAPABILITY_UNAVAILABLE",
    );
    assert.equal((await assignment(disabled)).version, archivedVersion);
  } finally {
    await revoked.stop();
  }
});

test("the transactional application entrypoint cannot impersonate a human or bypass scope", (t) => {
  const dir = temp(t);
  const db = open(dir);
  try {
    const task = saveTask(db);
    const service = new ApplicationCommandService(db);
    const command = {
      commandId: "limited-direct-test",
      name: "StartTaskWork",
      actor: { kind: "ai_agent", id: "こもり" },
      source: "mcp",
      issuedAt: startedAt,
      expectedVersions: [{ type: "task", id: task.id, version: task.version }],
      payload: {
        taskId: task.id,
        executorKind: "ai_agent",
        executorIdentity: "こもり",
        startedAt,
        workAttemptId: attempt,
        sourceSession: "test",
      },
    };
    for (const changed of [
      { actor: { kind: "user", id: "こもり" } },
      { source: "main_ui" },
      { name: "CompleteTask" },
      { name: "DeleteTask" },
      { name: "UpdateTask", payload: { task: { ...task, description: "Changed" } } },
      { name: "ReassignTaskWork", payload: { taskId: task.id, executorIdentity: "other" } },
      { name: "DelegateTaskToAgent", payload: { taskId: task.id } },
      { name: "AcceptTaskWork", payload: { taskId: task.id, completeTask: true } },
      { name: "ReturnTaskWork", payload: { taskId: task.id, reviewNote: "Reset" } },
      { name: "ApplyTaskWorkProposal", payload: { proposalId: "other", decision: "accept" } },
      { name: "ApplyAiProposal", payload: { proposal: { id: "other" }, decision: "accept" } },
      { payload: { ...command.payload, body: "changed" } },
      { payload: { ...command.payload, executorIdentity: "other" } },
      { payload: { ...command.payload, executorKind: "human" } },
      { payload: { ...command.payload, workAttemptId: "invalid" } },
      { expectedVersions: [] },
    ]) {
      assert.throws(
        () => service.executeAiTaskStart({ ...command, ...changed }),
        (e) => ["INVALID_ENVELOPE", "INVALID_PAYLOAD"].includes(e.code),
      );
      assert.deepEqual(db.get("task", task.id), task);
    }
    const realSave = db.saveWithinTransaction.bind(db);
    db.saveWithinTransaction = (type, ...args) => {
      if (type === "change_event") throw new Error("injected persistence failure");
      return realSave(type, ...args);
    };
    assert.throws(() => service.executeAiTaskStart(command), /injected persistence failure/);
    db.saveWithinTransaction = realSave;
    assert.equal(db.get("task", task.id).work_state, "ready_for_agent");
    assert.equal(
      db.list("change_event").filter((e) => e.metadata?.work_action === "started").length,
      0,
    );
    assert.equal(service.executeAiTaskStart(command).status, "applied");
    assert.equal(service.executeAiTaskStart(command).status, "applied");
    assert.equal(
      db.list("change_event").filter((e) => e.metadata?.work_action === "started").length,
      1,
    );
  } finally {
    db.db.close();
  }
});

test("human re-delegation requires a new claim and cannot reuse a started attempt UUID", async (t) => {
  const { dir, core, client } = await coreFixture(t);
  const originalRequest = request((await assignment(client)).version);
  const first = await client.startAiTaskWork(originalRequest);
  assert.equal(first.ok, true);
  await core.stop();
  const db = open(dir);
  let prepared;
  try {
    const working = db.get("task", "personal-ready");
    const service = new ApplicationCommandService(db);
    service.execute(
      humanEnvelope(
        "ReassignTaskWork",
        {
          taskId: working.id,
          executorIdentity: "こもり",
          reason: "Owner changes the work request",
        },
        [{ type: "task", id: working.id, version: working.version }],
      ),
    );
    prepared = db.get("task", working.id);
    assert.notEqual(prepared.work_attempt_id, attempt);
    assert.equal(prepared.work_state, "ready_for_agent");
  } finally {
    db.db.close();
  }
  const restarted = await startTaskenHeadlessCore({
    userDataPath: dir,
    writeMode: "create-only",
    allowAiTaskStart: true,
    env: {},
  });
  try {
    const fresh = new TaskenCoreClient({ userDataPath: dir });
    const reused = await fresh.startAiTaskWork(
      request(prepared.version, { idempotency_key: "new-key-old-attempt" }),
    );
    assert.equal(reused.ok, false);
    assert.equal(reused.error.code, "INVALID_TRANSITION");
    assert.equal((await assignment(fresh)).work_state, "ready_for_agent");
    // A late acknowledgement of the first request returns the new assignment
    // without taking it over or reviving the first attempt.
    const acknowledgement = await fresh.startAiTaskWork(originalRequest);
    assert.equal(acknowledgement.ok, true);
    assert.equal(acknowledgement.value.task.work_attempt_id, prepared.work_attempt_id);
    assert.equal(acknowledgement.value.task.work_state, "ready_for_agent");
    const second = await fresh.startAiTaskWork(
      request(prepared.version, {
        idempotency_key: "second-attempt",
        work_attempt_id: prepared.work_attempt_id,
      }),
    );
    assert.equal(second.ok, true);
    assert.equal(second.value.task.work_attempt_id, prepared.work_attempt_id);
    assert.equal(second.value.task.work_state, "in_progress");
  } finally {
    await restarted.stop();
  }
});

test("actual MCP start syncs to Desktop; reports await human adoption and never complete the Task", async (t) => {
  const dir = temp(t);
  const desktopDir = path.join(dir, "desktop");
  const replicaDir = path.join(dir, "replica");
  const shared = path.join(dir, "shared");
  const desktop = open(desktopDir);
  const original = saveTask(desktop);
  const sync = new SharedFolderSyncService(desktop, () => {}, path.join(desktopDir, "images"));
  let core, mcp;
  try {
    await sync.configure(shared);
    await sync.syncNow();
    core = await startTaskenHeadlessCore({
      userDataPath: replicaDir,
      syncDirectory: shared,
      writeMode: "create-only",
      allowAiTaskStart: true,
      env: {},
    });
    mcp = await connectMcp(replicaDir);
    const tools = (await mcp.listTools()).tools.map((x) => x.name);
    assert(tools.includes("tasken.start_task_work"));
    assert(tools.includes("tasken.create_task"));
    assert(!tools.includes("tasken.propose_note_edit"));
    const read = new TaskenCoreClient({ userDataPath: replicaDir });
    const ready = await assignment(read);
    const selected = await read.getTaskContext({ task_id: ready.id });
    assert.equal(selected.task.id, ready.id);
    const start = await mcp.callTool({
      name: "tasken.start_task_work",
      arguments: request(ready.version),
    });
    assert(!start.isError, JSON.stringify(start));
    assert.equal(start.structuredContent.ok, true);
    const working = start.structuredContent.value.task;
    assert.equal(working.work_state, "in_progress");
    assert.equal(working.work_attempt_id, attempt);
    const retry = await mcp.callTool({
      name: "tasken.start_task_work",
      arguments: request(ready.version),
    });
    assert(!retry.isError, JSON.stringify(retry));
    assert.equal(retry.structuredContent.value.task.version, working.version);
    await core.syncNow();
    await sync.syncNow();
    assert.equal(desktop.get("task", original.id).work_state, "in_progress");
    assert.equal(desktop.get("task", original.id).work_attempt_id, attempt);
    assert.equal(desktop.get("task", original.id).description, original.description);
    const reportArgs = {
      task_id: original.id,
      expected_version: working.version,
      caller: "こもり",
      work_attempt_id: attempt,
      executor_kind: "ai_agent",
      executor_label: "こもり",
      completed_items: ["Compared materials"],
      changed_or_created_items: [],
      verification: ["Source comparison"],
      remaining_work: ["Owner chooses and purchases"],
      source_session: "test-conversation",
    };
    const progress = await mcp.callTool({
      name: "tasken.append_work_receipt",
      arguments: {
        ...reportArgs,
        idempotency_key: "progress",
        summary: "Comparison underway",
        report_sequence: 1,
        reported_at: "2026-10-03T06:30:00.000Z",
      },
    });
    const done = await mcp.callTool({
      name: "tasken.report_task_done",
      arguments: {
        ...reportArgs,
        idempotency_key: "done",
        summary: "Research finished; purchase is outstanding",
        report_sequence: 2,
        reported_at: "2026-10-03T06:45:00.000Z",
      },
    });
    assert(!progress.isError, JSON.stringify(progress));
    assert(!done.isError, JSON.stringify(done));
    const progressId = progress.structuredContent.proposal_id;
    const doneId = done.structuredContent.proposal_id;
    await core.syncNow();
    await sync.syncNow();
    assert.equal(desktop.get("ai_proposal", progressId).status, "pending");
    assert.equal(desktop.get("ai_proposal", doneId).status, "pending");
    assert.equal(desktop.list("work_receipt").length, 0);
    assert.equal(desktop.get("task", original.id).work_state, "in_progress");
    const task = desktop.get("task", original.id);
    const doneProposal = desktop.get("ai_proposal", doneId);
    const progressProposal = desktop.get("ai_proposal", progressId);
    const application = new ApplicationCommandService(desktop);
    application.execute(
      humanEnvelope(
        "ApplyTaskWorkProposal",
        { proposalId: doneId, decision: "accept", coveredProposalIds: [progressId] },
        [
          { type: "task", id: task.id, version: task.version },
          { type: "ai_proposal", id: doneId, version: doneProposal.version },
          { type: "ai_proposal", id: progressId, version: progressProposal.version },
        ],
      ),
    );
    const accepted = desktop.get("task", original.id);
    assert.equal(accepted.state, "todo");
    assert.equal(accepted.work_state, "accepted");
    assert.equal(accepted.description, original.description);
    assert.equal(desktop.get("work_receipt", doneId).work_attempt_id, attempt);
    await sync.syncNow();
    await core.syncNow();
    assert.equal((await read.getProposalStatus({ proposal_id: doneId })).status, "accepted");
    assert.equal((await assignment(read)).work_state, "accepted");
    assert.equal(desktop.listSyncConflicts().length, 0);
    // Completion still requires a distinct human command.
    application.execute(
      humanEnvelope("CompleteTask", { taskId: task.id }, [
        { type: "task", id: task.id, version: accepted.version },
      ]),
    );
    assert.equal(desktop.get("task", original.id).state, "done");
  } finally {
    await mcp?.close();
    await core?.stop();
    await sync.stop();
    desktop.db.close();
  }
});
