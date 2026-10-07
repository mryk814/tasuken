import assert from "node:assert/strict";
import fs from "node:fs/promises";
import nativeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentLogSync, agentLogCandidates } from "../src/main/services/agentLogSync.ts";

test("unchanged format failures retain diagnostics without rereading, and change or reconfirm retries", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tasken-log-retry-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "logs");
  await fs.mkdir(source);
  const file = path.join(source, "broken.jsonl");
  await fs.writeFile(file, "{broken\n");
  let reads = 0;
  const original = nativeFs.createReadStream;
  t.mock.method(nativeFs, "createReadStream", (...args) => {
    reads++;
    return original(...args);
  });
  const config = { service: "codex", path: source, consent: true, destination: "local" };
  let sync = new AgentLogSync(path.join(root, "state"), async () => "queued");
  await sync.configure(config, "local");
  const first = await sync.run();
  assert.match(first.errors[0], /壊れた行/);
  sync = new AgentLogSync(path.join(root, "state"), async () => "queued");
  assert.deepEqual((await sync.run()).errors, first.errors);
  assert.equal(reads, 1);
  const stateFile = path.join(root, "state", "sources.json");
  const stored = JSON.parse(await fs.readFile(stateFile, "utf8"));
  for (const key of Object.keys(stored.fingerprints))
    if (/^p\d+:/.test(stored.fingerprints[key]))
      stored.fingerprints[key] = stored.fingerprints[key].replace(/^p\d+:/, "p0:");
  await fs.writeFile(stateFile, JSON.stringify(stored));
  sync = new AgentLogSync(path.join(root, "state"), async () => "queued");
  await sync.run();
  assert.equal(reads, 2, "parser version change retries even an unchanged format failure");
  await fs.appendFile(file, "{changed\n");
  await sync.run();
  assert.equal(reads, 3);
  await sync.configure(config, "local");
  await sync.run();
  assert.equal(reads, 4);
  const raw = await fs.readFile(
    new URL("../fixtures/agent-work-logs/codex-rollout.jsonl", import.meta.url),
    "utf8",
  );
  await fs.writeFile(file, raw);
  assert.equal((await sync.run()).state, "idle");
  assert.equal(reads, 5);
});

test("cached format failures do not exhaust the next scan's read budget", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tasken-log-budget-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "logs");
  await fs.mkdir(source);
  for (let index = 1; index <= 4; index++) {
    const file = path.join(source, `broken-${index}.jsonl`);
    await fs.writeFile(file, "{broken\n");
    await fs.utimes(file, new Date("2026-10-07T00:00:00Z"), new Date("2026-10-07T00:00:00Z"));
  }
  const goodFile = path.join(source, "good.jsonl");
  const raw = await fs.readFile(
    new URL("../fixtures/agent-work-logs/codex-rollout.jsonl", import.meta.url),
    "utf8",
  );
  await fs.writeFile(goodFile, raw);
  await fs.utimes(goodFile, new Date("2026-10-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z"));
  const originalStat = fs.stat;
  // 小さな合成ログを上限サイズとして数える。大きな実ファイルや実データを作らない。
  t.mock.method(fs, "stat", async (...args) => {
    const stat = await originalStat(...args);
    return String(args[0]).endsWith(".jsonl") ? { ...stat, size: 128 * 1024 * 1024 } : stat;
  });
  let reads = 0;
  const originalRead = nativeFs.createReadStream;
  t.mock.method(nativeFs, "createReadStream", (...args) => {
    reads++;
    return originalRead(...args);
  });
  const submitted = [];
  const sync = new AgentLogSync(path.join(root, "state"), async (log) => {
    submitted.push(log);
    return "queued";
  });
  await sync.configure(
    { service: "codex", path: source, consent: true, destination: "local" },
    "local",
  );
  const first = await sync.run();
  assert.equal(reads, 4);
  assert.equal(submitted.length, 0);
  assert.match(first.errors.at(-1), /512MB/);
  assert.ok(first.sources[0].lastScan);
  const next = await sync.run();
  assert.equal(reads, 5);
  assert.equal(submitted.length, 1);
  assert.equal(next.errors.length, 4);
  assert.doesNotMatch(next.errors.join("\n"), /512MB/);
});

test("new logs are read first and transient read or submit failures retry", async (t) => {
  // The scanner resolves real paths, including Windows temporary-directory aliases.
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "tasken-log-order-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "logs");
  await fs.mkdir(source);
  const raw = await fs.readFile(
    new URL("../fixtures/agent-work-logs/codex-rollout.jsonl", import.meta.url),
    "utf8",
  );
  const oldFile = path.join(source, "a-old.jsonl");
  const newFile = path.join(source, "z-new.jsonl");
  await fs.writeFile(oldFile, raw.replaceAll("synthetic-rollout", "old-session"));
  await fs.writeFile(newFile, raw.replaceAll("synthetic-rollout", "new-session"));
  await fs.utimes(oldFile, new Date("2026-08-22T00:00:00Z"), new Date("2026-08-22T00:00:00Z"));
  await fs.utimes(newFile, new Date("2026-10-07T00:00:00Z"), new Date("2026-10-07T00:00:00Z"));
  const seen = [];
  let failSubmit = true;
  let failRead = true;
  const original = nativeFs.createReadStream;
  t.mock.method(nativeFs, "createReadStream", (...args) => {
    if (args[0] === oldFile && failRead) {
      failRead = false;
      const error = new Error("synthetic denied");
      error.code = "EACCES";
      throw error;
    }
    return original(...args);
  });
  const sync = new AgentLogSync(path.join(root, "state"), async (log) => {
    seen.push(log.source_session);
    if (failSubmit) {
      failSubmit = false;
      throw new Error("synthetic database conflict");
    }
    return "queued";
  });
  await sync.configure(
    { service: "codex", path: source, consent: true, destination: "local" },
    "local",
  );
  assert.equal((await sync.run()).state, "error");
  assert.deepEqual(seen, ["new-session"]);
  assert.equal(failRead, false, "the transient read failure was injected at the resolved path");
  assert.equal((await sync.run()).state, "idle");
  assert.deepEqual(seen, ["new-session", "new-session", "old-session"]);
});

test("repeated metadata is collected once and genuinely mixed Codex sessions remain an error", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tasken-log-meta-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "sessions");
  await fs.mkdir(source);
  const raw = await fs.readFile(
    new URL("../fixtures/agent-work-logs/codex-rollout.jsonl", import.meta.url),
    "utf8",
  );
  const metadata = JSON.parse(raw.split("\n")[0]);
  metadata.timestamp = "2026-10-03T00:01:00Z";
  const file = path.join(source, "rollout.jsonl");
  await fs.writeFile(file, raw + JSON.stringify(metadata) + "\n");
  const submitted = [];
  const sync = new AgentLogSync(path.join(root, "state"), async (log) => {
    submitted.push(log);
    return "queued";
  });
  await sync.configure(
    { service: "codex", path: source, consent: true, destination: "local" },
    "local",
  );
  assert.equal((await sync.run()).state, "idle");
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].source_session, "synthetic-rollout");
  assert.equal(submitted[0].started_at, "2026-10-03T00:00:00.000Z");
  await sync.run();
  assert.equal(submitted.length, 1);
  metadata.payload.timestamp = metadata.timestamp;
  await fs.appendFile(file, JSON.stringify(metadata) + "\n");
  assert.equal((await sync.run()).state, "error");
  assert.match(sync.status().errors[0], /開始時刻/);
  assert.equal(submitted.length, 1);
  metadata.payload.id = "another-session";
  await fs.writeFile(file, raw + JSON.stringify(metadata) + "\n");
  assert.equal((await sync.run()).state, "error");
  assert.match(sync.status().errors[0], /複数Session/);
  assert.equal(submitted.length, 1);
});

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
