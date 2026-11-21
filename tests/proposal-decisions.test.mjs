import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";

// 提案の採否を 5 秒持つ列と、送り先・画面の状態をつなぐ所（#774。lib/proposalDecisions.ts）。
const result = await build({
  entryPoints: ["src/renderer/src/features/workspace/lib/proposalDecisions.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProposalDecisions, hiddenProposalIds } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

function fakeClock() {
  let time = 0;
  let timers = [];
  const settle = async () => {
    for (let index = 0; index < 10; index += 1) await new Promise((done) => setImmediate(done));
  };
  return {
    now: () => time,
    setTimer(run, ms) {
      const timer = { at: time + ms, run };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) {
      timers = timers.filter((entry) => entry !== timer);
    },
    settle,
    async advance(ms) {
      const until = time + ms;
      for (;;) {
        await settle();
        const next = timers
          .filter((timer) => timer.at <= until)
          .sort((left, right) => left.at - right.at)[0];
        if (!next) break;
        timers = timers.filter((timer) => timer !== next);
        time = next.at;
        next.run();
      }
      time = until;
      await settle();
    },
  };
}

function memoryStorage() {
  let saved = [];
  let broken = false;
  return {
    read: () => structuredClone(saved),
    write(items) {
      if (broken) throw new Error("QuotaExceededError");
      saved = structuredClone(items);
    },
    saved: () => saved,
    breakWrites: () => (broken = true),
  };
}

const receipt = (tasks = []) => ({
  status: "applied",
  saved: tasks.map(([id, version]) => ({ type: "task", id, version })),
  changes: tasks.map(([id, version]) => ({ type: "task", entity: { id, version } })),
  events: [],
});

/** 送り先。answer(command) が receipt を返すか投げる。 */
function setup(answer = () => receipt()) {
  const clock = fakeClock();
  const storage = memoryStorage();
  const sent = [];
  const decisions = createProposalDecisions({
    storage,
    execute: async (command) => {
      sent.push(structuredClone(command));
      return answer(command);
    },
    queue: { now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer },
  });
  return { clock, storage, sent, decisions, state: () => decisions.store.getState() };
}

const workCommand = (proposalId, taskVersion, extra = []) => ({
  commandId: `${proposalId}:accept`,
  name: "ApplyTaskWorkProposal",
  payload: { proposalId, decision: "accept" },
  actor: { kind: "user" },
  source: "main_ui",
  expectedVersions: [
    { type: "task", id: "task-t", version: taskVersion },
    ...extra,
    { type: "ai_proposal", id: proposalId, version: 1 },
  ],
  issuedAt: "2026-11-21T00:00:00.000Z",
});

const hold = (decisions, proposalId, commands, extra = {}) =>
  decisions.hold({
    proposalId,
    kind: "adopt",
    failure: "作業報告を採れませんでした。",
    commands,
    ...extra,
  });

test("断られた決定はカードを戻し、理由を帯とは別の知らせに残す", async () => {
  const { clock, decisions, state } = setup(() => {
    // Electron の IPC が付ける頭は外して見せる。
    throw new Error(
      "Error invoking remote method 'application:command': Error: Taskが更新されています。",
    );
  });
  const held = hold(decisions, "p1", [workCommand("p1", 3)]);
  assert.equal(held.ok, true);
  decisions.setLeaving("p1", false);
  assert.deepEqual([...hiddenProposalIds(state())], ["p1"]);
  await clock.advance(5_000);
  assert.deepEqual(state().held, []);
  assert.deepEqual(state().returning, [{ proposalId: "p1", kind: "adopt" }]);
  assert.deepEqual(
    state().notices.map((notice) => [notice.tone, notice.message]),
    [["danger", "作業報告を採れませんでした。Taskが更新されています。"]],
  );
});

test("採れて完了だけ断られた時は、カードを戻さず、完了の版は採った答えから決める", async () => {
  const { clock, decisions, sent, state } = setup((command) => {
    if (command.name === "AcceptTaskWork") throw new Error("完了できません。");
    return receipt([["task-t", 8]]);
  });
  hold(decisions, "p1", [workCommand("p1", 7)], {
    completeTask: {
      taskId: "task-t",
      command: {
        commandId: "p1:accept:complete",
        name: "AcceptTaskWork",
        payload: { taskId: "task-t", receiptId: "p1", completeTask: true },
        actor: { kind: "user" },
        source: "main_ui",
        expectedVersions: [],
        issuedAt: "2026-11-21T00:00:00.000Z",
      },
    },
  });
  await clock.advance(5_000);
  assert.deepEqual(
    sent.map((command) => command.name),
    ["ApplyTaskWorkProposal", "AcceptTaskWork"],
  );
  assert.deepEqual(sent[1].expectedVersions, [{ type: "task", id: "task-t", version: 8 }]);
  assert.deepEqual(state().returning, []);
  assert.match(state().notices[0].message, /^作業報告は採りましたが、Taskを完了できませんでした。/);
});

test("送り始めた後の取り消しは断り、そう知らせる", async () => {
  let release;
  const { clock, decisions, state } = setup(
    () => new Promise((done) => (release = () => done(receipt()))),
  );
  const held = hold(decisions, "p1", [workCommand("p1", 3)]);
  await clock.advance(5_000);
  assert.equal(decisions.undo(held.id), false);
  assert.match(state().notices.at(-1).message, /もう送ったので取り消せませんでした/);
  release();
  await clock.settle();
  assert.deepEqual(state().returning, []);
});

test("5 秒の間に取り消すと何も送らず、カードが戻る", async () => {
  const { clock, decisions, sent, state, storage } = setup();
  const held = hold(decisions, "p1", [workCommand("p1", 3)]);
  assert.equal(decisions.undo(held.id), true);
  assert.equal(held.signal.cancelled, true);
  await clock.advance(10_000);
  assert.deepEqual(sent, []);
  assert.deepEqual(storage.saved(), []);
  assert.deepEqual(state().returning, [{ proposalId: "p1", kind: "adopt" }]);
});

test("同じ Task を変える決定が続いた時、後ろの予想の版を前の答えの分だけ進める", async () => {
  let version = 3;
  const { clock, decisions, sent } = setup((command) => {
    const expected = command.expectedVersions.find((entry) => entry.type === "task");
    if (expected.version !== version) throw new Error("CONFLICT");
    version += 1;
    return receipt([["task-t", version]]);
  });
  hold(decisions, "a", [workCommand("a", 3)]);
  hold(decisions, "b", [workCommand("b", 3)]);
  // 押した時の版が違う（間に本人の手の変更を見ていた）物は進めない。
  hold(decisions, "c", [workCommand("c", 2)]);
  await clock.advance(5_000);
  const taskVersion = (command) =>
    command.expectedVersions.find((entry) => entry.type === "task").version;
  assert.deepEqual(
    sent.map((command) => [command.payload.proposalId, taskVersion(command)]),
    [
      ["a", 3],
      ["b", 4],
      ["c", 2],
    ],
  );
  // 提案そのものの版は進めない。
  assert.deepEqual(
    sent[1].expectedVersions.find((entry) => entry.type === "ai_proposal"),
    { type: "ai_proposal", id: "b", version: 1 },
  );
});

test("中身ごと送る記録の版は進めない（前の決定の変更を上書きしない）", async () => {
  const { clock, decisions, sent } = setup(() => receipt([["task-t", 4]]));
  hold(decisions, "a", [workCommand("a", 3)]);
  hold(decisions, "b", [
    {
      ...workCommand("b", 3),
      name: "ApplyAiProposal",
      payload: { candidates: [{ type: "task", entity: { id: "task-t", version: 3 } }] },
    },
  ]);
  await clock.advance(5_000);
  assert.equal(sent[1].expectedVersions[0].version, 3);
});

test("端末に書けない時は持たず、カードもそのまま", async () => {
  const { clock, decisions, sent, state, storage } = setup();
  storage.breakWrites();
  const held = hold(decisions, "p1", [workCommand("p1", 3)]);
  assert.deepEqual(held, { ok: false, reason: "unsaved" });
  assert.deepEqual(state().leaving, []);
  assert.deepEqual(state().held, []);
  await clock.advance(10_000);
  assert.deepEqual(sent, []);
});

test("提案の採る・見送るは、その場で送らずに必ず列を通る", () => {
  const source = readFileSync(
    "src/renderer/src/features/workspace/components/AiProposalPanel.tsx",
    "utf8",
  );
  const block = (name, end) => {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
    assert.ok(start >= 0, name);
    return source.slice(start, source.indexOf(end, start));
  };
  const accept = block("acceptProposal", "  if (!preview) {");
  const reject = block("rejectProposal", "async function quarantineProposal");
  const holdBody = block("holdDecision", "function rejectProposal");
  for (const body of [accept, reject]) {
    assert.match(body, /holdDecision\(/);
    assert.doesNotMatch(body, /executeCommand\(/);
  }
  assert.match(holdBody, /holdProposalDecision\(/);
  assert.doesNotMatch(holdBody, /executeCommand\(/);
});
