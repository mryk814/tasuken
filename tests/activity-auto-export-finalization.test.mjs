import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const result = await build({
  entryPoints: [path.resolve("src/renderer/src/features/workspace/lib/activityAutoExport.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { activityDatesToAutoExport, runActivityAutoExport } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

function state(overrides = {}) {
  return {
    now: new Date(2026, 8, 5, 9),
    time: "18:00",
    directory: "reports",
    lastExportDate: "2026-09-04",
    lastFinalizedDate: "2026-09-03",
    ...overrides,
  };
}

test("next morning finalizes yesterday including work after its provisional export", async () => {
  const current = state();
  const reports = new Map([["2026-09-04", "daytime work"]]);
  await runActivityAutoExport({
    dates: activityDatesToAutoExport(current),
    exportDate: async (date) => {
      reports.set(date, "daytime work + late work");
    },
    markExported: async () => {
      assert.fail("final export must not move provisional cursor");
    },
    finalization: {
      today: "2026-09-05",
      markFinalized: async (date) => {
        current.lastFinalizedDate = date;
      },
    },
  });
  assert.equal(reports.get("2026-09-04"), "daytime work + late work");
  assert.deepEqual(activityDatesToAutoExport(current), []);
  assert.deepEqual(activityDatesToAutoExport({ ...current, now: new Date(2026, 8, 5, 18) }), [
    "2026-09-05",
  ]);
});

test("missed days finalize in order before current provisional report", () => {
  assert.deepEqual(
    activityDatesToAutoExport(
      state({
        now: new Date(2026, 8, 7, 19),
      }),
    ),
    ["2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07"],
  );
});

test("migration revisits last exported day and fresh setup starts with yesterday", () => {
  assert.deepEqual(activityDatesToAutoExport(state({ lastFinalizedDate: "" })), ["2026-09-04"]);
  assert.deepEqual(
    activityDatesToAutoExport(state({ lastFinalizedDate: "", lastExportDate: "" })),
    ["2026-09-04"],
  );
});

test("failed final rewrite retains retry and stops subsequent dates", async () => {
  const current = state({ now: new Date(2026, 8, 5, 19) });
  const attempts = [];
  await assert.rejects(
    runActivityAutoExport({
      dates: activityDatesToAutoExport(current),
      exportDate: async (date) => {
        attempts.push(date);
        throw new Error("disk unavailable");
      },
      markExported: async () => {
        assert.fail("must not advance");
      },
      finalization: {
        today: "2026-09-05",
        markFinalized: async () => {
          assert.fail("must not finalize");
        },
      },
    }),
    /disk unavailable/,
  );
  assert.deepEqual(attempts, ["2026-09-04"]);
  assert.deepEqual(activityDatesToAutoExport(current), ["2026-09-04", "2026-09-05"]);
});

test("successful final and provisional exports do not repeat on same-day restart", async () => {
  const current = state({ now: new Date(2026, 8, 5, 19) });
  const writes = [];
  await runActivityAutoExport({
    dates: activityDatesToAutoExport(current),
    exportDate: async (date) => {
      writes.push(date);
    },
    markExported: async (date) => {
      current.lastExportDate = date;
    },
    finalization: {
      today: "2026-09-05",
      markFinalized: async (date) => {
        current.lastFinalizedDate = date;
      },
    },
  });
  assert.deepEqual(writes, ["2026-09-04", "2026-09-05"]);
  assert.deepEqual(activityDatesToAutoExport({ ...current }), []);
  assert.deepEqual(activityDatesToAutoExport({ ...current, now: new Date(2026, 8, 6, 8) }), [
    "2026-09-05",
  ]);
});
