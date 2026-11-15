import assert from "node:assert/strict";
import fs from "node:fs/promises";
import nativeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentLogSync, agentLogCandidates } from "../src/main/services/agentLogSync.ts";

// 拾うのは静かになった会話だけ（最後の動きから 60 分）。試験のログは今作るので、時計を 2 時間先に置く。
const quiet = { now: () => Date.now() + 2 * 60 * 60_000 };

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
  let sync = new AgentLogSync(path.join(root, "state"), async () => "recorded", quiet);
  await sync.configure(config, "local");
  const first = await sync.run();
  assert.match(first.errors[0], /壊れた行/);
  sync = new AgentLogSync(path.join(root, "state"), async () => "recorded", quiet);
  assert.deepEqual((await sync.run()).errors, first.errors);
  assert.equal(reads, 1);
  await fs.appendFile(file, "{changed\n");
  await sync.run();
  assert.equal(reads, 2);
  await sync.configure(config, "local");
  await sync.run();
  assert.equal(reads, 3);
  const raw = await fs.readFile(
    new URL("../fixtures/agent-work-logs/codex-rollout.jsonl", import.meta.url),
    "utf8",
  );
  await fs.writeFile(file, raw);
  assert.equal((await sync.run()).state, "idle");
  assert.equal(reads, 4);
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
  const sync = new AgentLogSync(
    path.join(root, "state"),
    async (log) => {
      submitted.push(log);
      return "recorded";
    },
    quiet,
  );
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
  const sync = new AgentLogSync(
    path.join(root, "state"),
    async (log) => {
      seen.push(log.source_session);
      if (failSubmit) {
        failSubmit = false;
        throw new Error("synthetic database conflict");
      }
      return "recorded";
    },
    quiet,
  );
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
  const sync = new AgentLogSync(
    path.join(root, "state"),
    async (log) => {
      submitted.push(log);
      return "recorded";
    },
    quiet,
  );
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

test("changed sessions, adoption deferral, cancellation and errors remain recoverable", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tasken-sync-states-"));
  const submitted = [];
  let cancelOnSubmit = false;
  const sync = new AgentLogSync(
    path.join(root, "state"),
    async (log) => {
      submitted.push(log);
      if (cancelOnSubmit) sync.cancel();
      return "recorded";
    },
    quiet,
  );
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
    await sync.run();
    assert.equal(submitted.length, 2);
    assert.equal(submitted.at(-1).summary, "changed outcome");
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
    const restored = new AgentLogSync(path.join(root, "state"), async () => "covered");
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
    async () => "recorded",
    quiet,
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
      new AgentLogSync(
        path.join(root, "state"),
        async (log) => {
          submitted.push(log);
          return "recorded";
        },
        quiet,
      );
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
    // 残すのは最初の依頼の先頭と最後の回答の先頭だけ。途中の依頼と回答・tool の入出力は残さない。
    // 作業場所（cwd）はリポジトリに直すためだけに Core へ渡す（保存しない事は agent-work-record の試験で守る）。
    assert.deepEqual(submitted[0], {
      client_kind: "codex",
      source_session: "synthetic-rollout",
      started_at: "2026-10-03T00:00:00.000Z",
      ended_at: "2026-10-03T00:03:00.000Z",
      intent: "合成デモ: Activityを確認する",
      summary: "合成デモ: 日次表示を確認した",
      cwd: "DO-NOT-IMPORT",
    });
    await sync.run();
    assert.equal(submitted.length, 1);
    sync = make();
    await sync.load();
    await sync.run();
    assert.equal(submitted.length, 1, "控えは再起動をまたぐ");
    // 静かになった後も壊れたままの最後の行は、書きかけで終わった行。捨てて読む（誤りにしない）。
    await fs.appendFile(file, '{"type":"response_item"');
    assert.equal((await sync.run()).state, "idle");
    assert.equal(submitted.length, 2);
    assert.deepEqual(submitted[1], submitted[0]);
    // 名前の変わったログは読み直して渡す。2 件にしないのは Core（読み直しで増えない）。
    await fs.rename(file, path.join(source, "rotated.jsonl"));
    await sync.run();
    assert.equal(submitted.length, 3);
    assert.equal(submitted[2].source_session, "synthetic-rollout");
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

test("拾い上げ: 動いている会話は読まず、静かになってから 1 回だけ渡す", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tasken-log-quiet-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "sessions");
  await fs.mkdir(source);
  const raw = await fs.readFile(
    new URL("../fixtures/agent-work-logs/codex-rollout.jsonl", import.meta.url),
    "utf8",
  );
  const file = path.join(source, "rollout.jsonl");
  await fs.writeFile(file, raw);
  let reads = 0;
  const original = nativeFs.createReadStream;
  t.mock.method(nativeFs, "createReadStream", (...args) => {
    reads++;
    return original(...args);
  });
  const submitted = [];
  let clock = Date.now();
  const sync = new AgentLogSync(
    path.join(root, "state"),
    async (pickup) => {
      submitted.push(pickup);
      return "recorded";
    },
    { now: () => clock },
  );
  await sync.configure(
    { service: "codex", path: source, consent: true, destination: "local" },
    "local",
  );

  // 書かれたばかりのログ（最後の動きから 60 分たっていない）は、開きもしない。
  const active = await sync.run();
  assert.equal(active.state, "idle");
  assert.deepEqual(
    [active.scanned, active.recorded, active.unchanged, active.active],
    [1, 0, 0, 1],
  );
  assert.match(active.sources[0].message, /動いている 1 件/);
  assert.equal(reads, 0);
  clock += 59 * 60_000;
  assert.equal((await sync.run()).active, 1);
  assert.equal(reads, 0);

  // 60 分たったら 1 件として渡す。もう一度見ても、読み直さない。
  clock += 2 * 60_000;
  const quietRun = await sync.run();
  assert.deepEqual([quietRun.recorded, quietRun.active], [1, 0]);
  assert.equal(submitted.length, 1);
  assert.equal(reads, 1);
  const again = await sync.run();
  assert.deepEqual([again.recorded, again.unchanged], [0, 1]);
  assert.equal(submitted.length, 1);
  assert.equal(reads, 1);

  // 会話が再開したら、また静かになるまで読まない。静かになったら渡す（続きだけにするのは Core）。
  const resumed = {
    timestamp: "2026-10-03T03:00:00Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "合成デモ: 続きを終えた" }],
    },
  };
  await fs.appendFile(file, `${JSON.stringify(resumed)}${os.EOL}`);
  clock = Date.now() + 10 * 60_000;
  assert.equal((await sync.run()).active, 1);
  assert.equal(submitted.length, 1);
  clock = Date.now() + 2 * 60 * 60_000;
  assert.equal((await sync.run()).recorded, 1);
  assert.equal(submitted.length, 2);
  assert.equal(submitted[1].summary, "合成デモ: 続きを終えた");
  assert.equal(submitted[1].ended_at, "2026-10-03T03:00:00.000Z");
});

test("拾い上げ: ファイルの更新時刻が古くても、ログの中の最後の動きが新しければ待つ", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tasken-log-inner-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "sessions");
  await fs.mkdir(source);
  const raw = await fs.readFile(
    new URL("../fixtures/agent-work-logs/codex-rollout.jsonl", import.meta.url),
    "utf8",
  );
  const file = path.join(source, "rollout.jsonl");
  await fs.writeFile(file, raw);
  const old = new Date("2026-10-01T00:00:00Z");
  await fs.utimes(file, old, old);
  const submitted = [];
  // ログの最後の動きは 2026-10-03T00:02Z。その 30 分後に見る。
  let clock = Date.parse("2026-10-03T00:32:00Z");
  const sync = new AgentLogSync(
    path.join(root, "state"),
    async (pickup) => {
      submitted.push(pickup);
      return "covered";
    },
    { now: () => clock },
  );
  await sync.configure(
    { service: "codex", path: source, consent: true, destination: "local" },
    "local",
  );
  assert.equal((await sync.run()).active, 1);
  assert.equal(submitted.length, 0);
  clock = Date.parse("2026-10-03T01:02:00Z");
  const done = await sync.run();
  // Core が「もう数えてある」と答えた会話は、拾った数に入れない。
  assert.deepEqual([done.recorded, done.unchanged, done.active], [0, 1, 0]);
  assert.equal(submitted.length, 1);
});
