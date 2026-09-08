import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
const bundled = await build({
  stdin: {
    contents: `export * from './src/main/services/dailyContextAutoPublisher.ts'; export * from './src/shared/dailyContextAuto.ts';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { DailyContextAutoPublisher, createDailyContextAutoState } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const config = {
  enabled: true,
  root: "C:/published",
  timezone: "Asia/Tokyo",
  themeId: null,
  fromDate: "2026-09-01",
  includeFullText: false,
};
function fixture(overrides = {}) {
  let state = createDailyContextAutoState();
  let clock = Date.parse("2026-09-03T00:00:00Z");
  const writes = [],
    timers = [],
    published = [];
  const options = {
    readState: () => state,
    writeState: (value) => {
      state = structuredClone(value);
      writes.push(state);
    },
    now: () => new Date(clock),
    setTimer: (callback, delay) => {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      timer.cancelled = true;
    },
    scan: (input) => ({
      dates: input.sourceHashes.source === "v1" ? [] : ["2026-09-01", "2026-09-02", "2026-09-03"],
      sourceHashes: { source: "v1" },
      checkedThrough: "2026-09-03",
      deviceObservations: [],
    }),
    publish: (date) => {
      published.push(date);
      return {
        written: true,
        generatedAt: new Date(clock).toISOString(),
        sourceRevision: "plan-v1",
      };
    },
    ...overrides,
  };
  return {
    engine: new DailyContextAutoPublisher(options),
    options,
    published,
    timers,
    writes,
    state: () => state,
    advance: (ms) => {
      clock += ms;
    },
  };
}
test("disabled default, deferred startup, bounded date queue and atomic scan checkpoint", async () => {
  const f = fixture();
  f.engine.start();
  assert.equal(f.timers.length, 0);
  assert.equal(f.engine.status().freshness.pendingCount, null);
  f.engine.configure(config);
  assert.equal(f.published.length, 0);
  assert.equal(f.timers.at(-1).delay, 250);
  await f.engine.runOnce();
  assert.deepEqual(f.published, ["2026-09-01"]);
  assert.ok(f.writes.some((s) => s.sourceHashes.source === "v1" && s.pendingDates.length === 3));
  assert.equal(f.engine.status().freshness.pendingCount, 2);
  f.engine.stop();
});
test("restart resumes queue, duplicate wake does not regenerate and unchanged configure is inert", async () => {
  const f = fixture();
  f.engine.configure(config);
  await f.engine.runOnce();
  const resumed = new DailyContextAutoPublisher(f.options);
  resumed.wake();
  resumed.wake();
  await resumed.runOnce();
  await resumed.runOnce();
  await resumed.runOnce();
  assert.deepEqual(f.published, ["2026-09-01", "2026-09-02", "2026-09-03"]);
  const count = f.writes.length;
  resumed.configure(config);
  assert.equal(f.writes.length, count);
  assert.equal(resumed.status().freshness.publishedThrough, "2026-09-03");
  assert.equal(resumed.status().freshness.sourceRevision, "plan-v1");
});
test("backfill drains without rescanning and idle timer schedules the next date check", async () => {
  const f = fixture();
  let scans = 0;
  const scan = f.options.scan;
  f.options.scan = (state) => {
    scans++;
    return scan(state);
  };
  f.engine.configure(config);
  f.engine.start();
  await f.engine.runOnce();
  await f.engine.runOnce();
  await f.engine.runOnce();
  assert.equal(scans, 1);
  const queued = f.timers.at(-1);
  queued.callback();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(scans, 2);
  f.engine.stop();
});
test("failure retains day and checkpoint, bounded retry and explicit retry", async () => {
  let failing = true;
  const f = fixture({
    publish: () => {
      if (failing) throw new Error("secret/path");
      return { written: false, generatedAt: "old", sourceRevision: "same" };
    },
  });
  f.engine.configure(config);
  await f.engine.runOnce();
  assert.equal(f.state().pendingDates.length, 3);
  assert.ok(f.state().retryAt);
  assert.doesNotMatch(JSON.stringify(f.engine.status()), /secret/);
  failing = false;
  await f.engine.runOnce();
  assert.equal(f.state().pendingDates.length, 3);
  f.advance(30_000);
  await f.engine.runOnce();
  assert.equal(f.state().pendingDates.length, 2);
  assert.equal(f.state().lastWrittenAt, null);
  f.engine.retry();
  await f.engine.runOnce();
  assert.equal(f.state().pendingDates.length, 1);
});
test("wake during publish remains pending and disabling preserves queue while root change resets last success", async () => {
  let release;
  const f = fixture({
    publish: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  f.engine.configure(config);
  const run = f.engine.runOnce();
  await Promise.resolve();
  f.engine.wake();
  release({ written: true, generatedAt: "now", sourceRevision: "v1" });
  await run;
  assert.equal(f.state().needsScan, true);
  assert.equal(f.state().pendingDates.length, 3);
  f.engine.configure({ ...config, enabled: false });
  await f.engine.runOnce();
  assert.equal(f.state().pendingDates.length, 3);
  f.engine.configure({ ...config, root: "C:/other" });
  assert.equal(f.state().lastWrittenAt, null);
  assert.deepEqual(f.state().sourceHashes, {});
});
test("scan failure reports unknown pending and stop during scan prevents publication", async () => {
  const failed = fixture({
    scan: () => {
      throw new Error("unavailable");
    },
  });
  failed.engine.configure(config);
  await failed.engine.runOnce();
  assert.equal(failed.engine.status().freshness.pendingCount, null);
  let release;
  const f = fixture({
    scan: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  f.engine.configure(config);
  const run = f.engine.runOnce();
  f.engine.stop();
  release({
    dates: ["2026-09-01"],
    sourceHashes: {},
    checkedThrough: "2026-09-03",
    deviceObservations: [],
  });
  await run;
  assert.deepEqual(f.published, []);
});

test("manifest recovery date takes priority over sorted pending dates and survives restart", async () => {
  const f = fixture({
    scan: () => ({
      dates: ["2026-09-01", "2026-09-03", "2026-09-02"],
      priorityDate: "2026-09-03",
      sourceHashes: {},
      checkedThrough: "2026-09-03",
      deviceObservations: [],
    }),
  });
  f.engine.configure(config);
  await f.engine.runOnce();
  assert.deepEqual(f.published, ["2026-09-03"]);
  assert.ok(f.writes.some((state) => state.pendingDates[0] === "2026-09-03"));
  const resumed = new DailyContextAutoPublisher(f.options);
  await resumed.runOnce();
  assert.deepEqual(f.published, ["2026-09-03", "2026-09-01"]);
});

test("timer persistence failure reports only generic warning without unhandled save errors", async () => {
  let fail = false;
  const errors = [];
  const f = fixture({ onError: (message) => errors.push(message) });
  const save = f.options.writeState;
  f.options.writeState = (state) => {
    if (fail) throw new Error("private source body");
    save(state);
  };
  f.engine.configure(config);
  f.engine.start();
  fail = true;
  f.timers.at(-1).callback();
  // Flush the timer's scan, rejected runOnce, catch and finally microtasks.
  for (let i = 0; i < 6; i++) await Promise.resolve();
  assert.deepEqual(errors, ["自動公開の更新待ち状態を保存できませんでした。"]);
  assert.deepEqual(f.published, []);
  f.engine.stop();
});
