import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

// 採る・見送るを 5 秒持ってから押した順に 1 件ずつ送る列（#774）。時計は試験の中で進める。
const result = await build({
  entryPoints: ["src/renderer/src/features/workspace/lib/heldDecisions.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createHeldQueue } = await import(
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

function memoryStorage(initial = []) {
  let saved = structuredClone(initial);
  return {
    read: () => structuredClone(saved),
    write: (items) => {
      saved = structuredClone(items);
    },
    saved: () => saved,
  };
}

/** 送る相手。答えは試験が返す（遅い応答・断り）。 */
function receiver() {
  const received = [];
  const waiting = new Map();
  return {
    received,
    send(item) {
      received.push(item.id);
      return new Promise((resolve, reject) => waiting.set(item.id, { resolve, reject }));
    },
    answer(id) {
      waiting.get(id).resolve();
    },
    refuse(id, message) {
      waiting.get(id).reject(new Error(message));
    },
  };
}

function setup({ storage = memoryStorage(), timeoutMs = 20_000 } = {}) {
  const clock = fakeClock();
  const peer = receiver();
  const events = [];
  const queue = createHeldQueue({
    storage,
    send: peer.send,
    onSent: (item) => events.push(["sent", item.id]),
    onRefused: (item, message) => events.push(["refused", item.id, message]),
    onDelayed: (item) => events.push(["delayed", item.id]),
    holdMs: 5_000,
    timeoutMs,
    retryMs: 30_000,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { clock, peer, events, queue, storage };
}

test("押した物はすぐ端末に書き、5 秒たつまで送らない", async () => {
  const { clock, peer, queue, storage } = setup();
  queue.hold({ id: "a", pressedAt: 0 });
  assert.deepEqual(
    storage.saved().map((item) => item.id),
    ["a"],
  );
  await clock.advance(4_999);
  assert.deepEqual(peer.received, []);
  await clock.advance(1);
  assert.deepEqual(peer.received, ["a"]);
  // 答えが来るまでは端末に残す。
  assert.deepEqual(
    storage.saved().map((item) => item.id),
    ["a"],
  );
  peer.answer("a");
  await clock.settle();
  assert.deepEqual(storage.saved(), []);
});

test("5 秒の間に取り消すと、何も送らない", async () => {
  const { clock, peer, queue, storage, events } = setup();
  queue.hold({ id: "a", pressedAt: 0 });
  await clock.advance(4_000);
  assert.equal(queue.cancel("a"), true);
  await clock.advance(60_000);
  assert.deepEqual(peer.received, []);
  assert.deepEqual(storage.saved(), []);
  assert.deepEqual(events, []);
});

test("押した順に、前の答えが来てから 1 件ずつ送る（遅い応答でも追い越さない）", async () => {
  const { clock, peer, queue, events } = setup();
  queue.hold({ id: "a", pressedAt: 0 });
  await clock.advance(100);
  queue.hold({ id: "b", pressedAt: 100 });
  await clock.advance(100);
  queue.hold({ id: "c", pressedAt: 200 });
  await clock.advance(5_000);
  assert.deepEqual(peer.received, ["a"]);
  // 上限より短い遅い応答の間、b と c は待つ。
  await clock.advance(15_000);
  assert.deepEqual(peer.received, ["a"]);
  assert.equal(queue.cancel("a"), false, "送っている最中の物は取り消せない");
  peer.answer("a");
  await clock.settle();
  assert.deepEqual(peer.received, ["a", "b"]);
  peer.answer("b");
  await clock.settle();
  assert.deepEqual(peer.received, ["a", "b", "c"]);
  peer.answer("c");
  await clock.settle();
  assert.deepEqual(events, [
    ["sent", "a"],
    ["sent", "b"],
    ["sent", "c"],
  ]);
});

test("断られた 1 件は知らせて外し、後ろの物は続けて送る", async () => {
  const { clock, peer, queue, events, storage } = setup();
  queue.hold({ id: "a", pressedAt: 0 });
  queue.hold({ id: "b", pressedAt: 0 });
  await clock.advance(5_000);
  peer.refuse("a", "版が違います");
  await clock.settle();
  assert.deepEqual(peer.received, ["a", "b"]);
  peer.answer("b");
  await clock.settle();
  assert.deepEqual(events, [
    ["refused", "a", "版が違います"],
    ["sent", "b"],
  ]);
  assert.deepEqual(storage.saved(), []);
});

test("時間の上限を越えた 1 件は捨てずに後ろへ回し、後ろの物を先に送る", async () => {
  const { clock, peer, queue, events, storage } = setup({ timeoutMs: 20_000 });
  queue.hold({ id: "a", pressedAt: 0 });
  queue.hold({ id: "b", pressedAt: 0 });
  await clock.advance(5_000 + 20_000);
  assert.deepEqual(events, [["delayed", "a"]]);
  assert.deepEqual(peer.received, ["a", "b"]);
  assert.deepEqual(
    storage.saved().map((item) => item.id),
    ["b", "a"],
    "時間切れの物も端末に残す",
  );
  peer.answer("b");
  await clock.advance(30_000);
  assert.deepEqual(peer.received, ["a", "b", "a"]);
  peer.answer("a");
  await clock.settle();
  assert.deepEqual(events, [
    ["delayed", "a"],
    ["sent", "b"],
    ["sent", "a"],
  ]);
  assert.deepEqual(storage.saved(), []);
});

test("前の起動で送れずに残った物は、次の起動ですぐ押した順に送る", async () => {
  const storage = memoryStorage([
    { id: "later", pressedAt: 2_000 },
    { id: "earlier", pressedAt: 1_000 },
  ]);
  const { clock, peer, queue, events } = setup({ storage });
  queue.start();
  await clock.settle();
  assert.deepEqual(peer.received, ["earlier"]);
  peer.answer("earlier");
  await clock.settle();
  peer.answer("later");
  await clock.settle();
  assert.deepEqual(events, [
    ["sent", "earlier"],
    ["sent", "later"],
  ]);
  assert.deepEqual(storage.saved(), []);
});

test("壊れた端末の中身でも始められる", async () => {
  const storage = {
    read() {
      throw new SyntaxError("Unexpected token");
    },
    write() {},
  };
  const { queue } = setup({ storage });
  assert.doesNotThrow(() => queue.start());
  assert.deepEqual(queue.items(), []);
});
