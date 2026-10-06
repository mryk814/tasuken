import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentLogSync, agentLogCandidates } from "../src/main/services/agentLogSync.ts";

test("renaming a completed Codex thread updates its title without modifying its rollout", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tasken-log-rename-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "sessions");
  await fs.mkdir(source);
  const raw = await fs.readFile(
    new URL("../fixtures/agent-work-logs/codex-rollout.jsonl", import.meta.url),
    "utf8",
  );
  await fs.writeFile(path.join(source, "rollout.jsonl"), raw);
  const index = path.join(root, "session_index.jsonl");
  const writeTitle = (title) =>
    fs.writeFile(index, JSON.stringify({ id: "synthetic-rollout", thread_name: title }) + "\n");
  await writeTitle("変更前");
  const submitted = [];
  const make = () =>
    new AgentLogSync(path.join(root, "state"), async (log) => {
      submitted.push(log);
      return "queued";
    });
  let sync = make();
  await sync.configure(
    { service: "codex", path: source, consent: true, destination: "local" },
    "local",
  );
  await sync.run();
  assert.equal(submitted[0].intent.title, "変更前");
  await writeTitle("変更後");
  sync = make();
  await sync.load();
  await sync.run();
  assert.equal(submitted.length, 2);
  assert.equal(submitted[1].intent.title, "変更後");
  await sync.run();
  assert.equal(submitted.length, 2);
});

test("changed sessions, adoption deferral, cancellation and errors remain recoverable", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tasken-sync-states-"));
  const submitted = [];
  let defer = false;
  let cancelOnSubmit = false;
  const sync = new AgentLogSync(path.join(root, "state"), async (log) => {
    submitted.push(log);
    if (cancelOnSubmit) sync.cancel();
    return defer ? "deferred" : "queued";
  });
  try {
    const folder = path.join(root, "claude");
    await fs.mkdir(folder);
    assert.equal((await sync.probe("claude_code", folder)).state, "empty");
    const file = path.join(folder, "session.jsonl");
    const raw = await fs.readFile(
      new URL("../fixtures/agent-work-logs/claude-transcript.jsonl", import.meta.url),
      "utf8",
    );
    await fs.writeFile(file, raw);
    await sync.configure(
      { service: "claude_code", path: folder, consent: true, destination: "local" },
      "local",
    );
    await sync.run();
    const extra = JSON.stringify({
      type: "assistant",
      sessionId: "synthetic-claude",
      uuid: "changed-answer",
      timestamp: "2026-10-03T00:10:00Z",
      message: { role: "assistant", content: "changed outcome" },
    });
    await fs.appendFile(file, "\n" + extra + "\n");
    defer = true;
    await sync.run();
    assert.equal(sync.status().deferred, 1);
    defer = false;
    await sync.run();
    assert.equal(submitted.at(-1).outcome.summary, "changed outcome");
    assert.equal(submitted[0].source_session, submitted.at(-1).source_session);
    await fs.writeFile(path.join(folder, "unsupported.jsonl"), '{"other":"not a session"}\n');
    await sync.run();
    assert.equal(sync.status().state, "error");
    assert.match(sync.status().errors[0], /Session/);
    await fs.rm(path.join(folder, "unsupported.jsonl"));
    const broken = path.join(folder, "broken.jsonl");
    await fs.writeFile(broken, "{DO-NOT-IMPORT-secret\n");
    await sync.run();
    assert.doesNotMatch(JSON.stringify(sync.status()), /DO-NOT-IMPORT/);
    await fs.rm(broken);
    const huge = path.join(folder, "huge.jsonl");
    await fs.writeFile(huge, "");
    await fs.truncate(huge, 130 * 1024 * 1024);
    await sync.run();
    assert.match(sync.status().errors[0], /128MB/);
    await fs.rm(huge);
    await fs.writeFile(
      path.join(folder, "second.jsonl"),
      raw.replaceAll("synthetic-claude", "synthetic-second"),
    );
    await fs.writeFile(
      path.join(folder, "third.jsonl"),
      raw.replaceAll("synthetic-claude", "synthetic-third"),
    );
    cancelOnSubmit = true;
    await sync.run();
    assert.equal(sync.status().state, "cancelled");
    cancelOnSubmit = false;
    await sync.run();
    assert.equal(sync.status().state, "idle");
    const stateDirectory = path.join(root, "state");
    const stateBackup = path.join(root, "state-backup");
    await fs.rename(stateDirectory, stateBackup);
    await fs.writeFile(stateDirectory, "synthetic blocker");
    assert.equal((await sync.run()).state, "error");
    assert.match(sync.status().errors.at(-1), /保存に失敗/);
    await fs.rm(stateDirectory);
    await fs.rename(stateBackup, stateDirectory);
    assert.equal((await sync.probe("codex", path.join(folder, "missing"))).state, "missing");
    await sync.background(true);
    await Promise.all([sync.background(false), sync.background(true)]);
    sync.stop();
    const restored = new AgentLogSync(path.join(root, "state"), async () => "duplicate");
    await restored.load();
    assert.equal(restored.status().background, true);
    restored.stop();
  } finally {
    sync.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("permission failures differ from an empty or unsupported location", async (t) => {
  const sync = new AgentLogSync(
    path.join(os.tmpdir(), "unused-synthetic-state"),
    async () => "queued",
  );
  t.mock.method(fs, "opendir", async () => {
    const error = new Error("synthetic denied");
    error.code = "EACCES";
    throw error;
  });
  // realpath is also stubbed, so no real directory is inspected.
  t.mock.method(fs, "realpath", async (value) => value);
  assert.equal(
    (await sync.probe("codex", path.join(os.tmpdir(), "synthetic-denied"))).state,
    "denied",
  );
});

test("discovery proposes environment-specific paths without reading them", () => {
  const portable = path.join(os.tmpdir(), "synthetic-portable-codex");
  const candidates = agentLogCandidates("codex", path.join(os.tmpdir(), "synthetic-home"), {
    CODEX_HOME: portable,
  });
  assert.equal(candidates[0].path, path.resolve(portable, "sessions"));
  assert.match(candidates[0].label, /CODEX_HOME/);
  assert.equal(
    agentLogCandidates("claude_code", "/synthetic", {})[0].path,
    path.resolve("/synthetic/.claude/projects"),
  );
});

test("streaming difference sync preserves privacy, retries incomplete writes, survives restart and rotation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tasken-log-sync-test-"));
  try {
    const source = path.join(root, "logs");
    await fs.mkdir(source);
    const file = path.join(source, "rollout-fixture.jsonl");
    const raw = await fs.readFile(
      new URL("../fixtures/agent-work-logs/codex-rollout.jsonl", import.meta.url),
      "utf8",
    );
    // A normal large log must not be subject to the manual import's 2MB limit.
    await fs.writeFile(
      file,
      raw +
        (
          JSON.stringify({
            type: "ignored",
            timestamp: "2026-10-03T00:03:00Z",
            secret: "DO-NOT-IMPORT".repeat(1000),
          }) + "\n"
        ).repeat(200),
    );
    const submitted = [];
    const make = () =>
      new AgentLogSync(path.join(root, "state"), async (log) => {
        submitted.push(log);
        return "queued";
      });
    let sync = make();
    const probe = await sync.probe("codex", source);
    assert.equal(probe.state, "ready");
    assert.equal(probe.count, 1);
    await sync.configure(
      { service: "codex", path: source, consent: true, destination: "local" },
      "local",
    );
    await sync.run();
    assert.equal(submitted.length, 1);
    assert.equal(submitted[0].status, "unknown");
    // #629: 依頼は短い抜粋（最大5件×200文字）だけを残し、回答の途中経過は残さない。
    assert.deepEqual(
      submitted[0].request_events.map((event) => event.text),
      ["合成デモ: Activityを確認する"],
    );
    assert.deepEqual(submitted[0].response_checkpoints, []);
    assert.doesNotMatch(JSON.stringify(submitted), /DO-NOT-IMPORT|cwd|reasoning/);
    await sync.run();
    assert.equal(submitted.length, 1);
    sync = make();
    await sync.load();
    await sync.run();
    assert.equal(submitted.length, 1);
    await fs.appendFile(file, '{"type":"response_item"');
    await sync.run();
    assert.equal(submitted.length, 1);
    assert.match(sync.status().sources[0].message, /書き込み途中/);
    await fs.rename(file, path.join(source, "rotated.jsonl"));
    await sync.run();
    assert.equal(submitted.length, 1);
    assert.equal((await sync.probe("claude_code", path.join(root, "missing"))).state, "missing");
    await assert.rejects(
      sync.configure(
        { service: "codex", path: source, consent: true, destination: "wrong" },
        "local",
      ),
      /保存先/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
