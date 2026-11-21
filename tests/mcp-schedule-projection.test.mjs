import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import { build } from "esbuild";

// #804: the MCP read projections must carry the saved schedule and
// reminder_at, so a value written by change_task can be read back and
// checked (#784/#786 were unverifiable from the AI side without them).

async function importTs(relativePath, names) {
  const bundled = await build({
    stdin: {
      contents: names.map((n) => `export { ${n} } from "./${relativePath}";`).join("\n"),
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
  );
}

const now = "2026-11-20T00:00:00.000Z";

function fakeTask(id, extra = {}) {
  return {
    id,
    title: `task ${id}`,
    state: "todo",
    priority: "normal",
    project_id: null,
    description: "",
    created_at: now,
    updated_at: now,
    deleted_at: null,
    ...extra,
  };
}

test("list_open_items: planned dates and reminder_at ride the projection", async () => {
  const { ItemQueryService } = await importTs("src/main/core/services/itemQueryService.ts", [
    "ItemQueryService",
  ]);
  const snapshot = {
    items: [],
    tasks: [fakeTask("t-set", { reminder_at: "2026-11-24T11:00:00+09:00" }), fakeTask("t-unset")],
    planNodes: [],
    schedules: [
      {
        id: "s-1",
        owner_type: "task",
        owner_id: "t-set",
        start_date: "2026-11-24",
        end_date: "2026-11-24",
      },
    ],
    themes: [],
  };
  const service = new ItemQueryService({ readItemQuerySnapshot: () => snapshot });
  const byId = new Map(service.listOpenItems({}).items.map((i) => [i.id, i]));
  const set = byId.get("t-set");
  assert.equal(set.planned_start, "2026-11-24");
  assert.equal(set.planned_end, "2026-11-24");
  assert.equal(set.reminder_at, "2026-11-24T11:00:00+09:00");
  const unset = byId.get("t-unset");
  assert.equal(unset.planned_end, null);
  assert.equal(unset.reminder_at, null, "no reminder reads back as null, not missing");
});

test("get_task_context: the task carries its schedule and reminder_at", async () => {
  const { TaskContextQueryService } = await importTs(
    "src/main/core/services/taskContextQueryService.ts",
    ["TaskContextQueryService"],
  );
  const task = fakeTask("task-1", {
    title: "Nemorium 更新キット適用",
    project_id: "theme-1",
    requester: "self",
    intended_executor: "self",
    version: 3,
    reminder_at: "2026-11-24T20:00:00+09:00",
  });
  const bare = fakeTask("task-2", { title: "日付なし", version: 1 });
  const workspace = {
    themes: [{ id: "theme-1", name: "個人業務", updated_at: now }],
    tasks: [task, bare],
    schedules: [
      {
        id: "s-1",
        owner_type: "task",
        owner_id: "task-1",
        start_date: "2026-11-24",
        end_date: "2026-11-24",
      },
    ],
  };
  const service = new TaskContextQueryService({
    loadTaskContextWorkspace: () => workspace,
    loadTaskContextThemes: () => workspace.themes,
  });
  const got = service.execute({ task_id: "task-1" });
  // #785: the time and its notice lead always ride along (null when unset).
  assert.deepEqual(got.task.schedule, {
    start_date: "2026-11-24",
    end_date: "2026-11-24",
    end_time: null,
    notify_before_minutes: null,
  });
  assert.equal(got.task.reminder_at, "2026-11-24T20:00:00+09:00");
  const gotBare = service.execute({ task_id: "task-2" });
  assert.equal(gotBare.task.schedule, null, "no schedule reads back as null");
  assert.equal(gotBare.task.reminder_at, null, "no reminder reads back as null");
});

test("#785: the end time and its notice lead ride the read projections", async () => {
  const { ItemQueryService } = await importTs("src/main/core/services/itemQueryService.ts", [
    "ItemQueryService",
  ]);
  const { TaskContextQueryService } = await importTs(
    "src/main/core/services/taskContextQueryService.ts",
    ["TaskContextQueryService"],
  );
  const timedSchedule = {
    id: "s-timed",
    owner_type: "task",
    owner_id: "t-timed",
    start_date: null,
    end_date: "2026-11-19",
    granularity: "day",
    end_time: "02:00",
    notify_before_minutes: 30,
  };
  const brokenSchedule = {
    id: "s-broken",
    owner_type: "task",
    owner_id: "t-broken",
    start_date: null,
    end_date: "2026-11-19",
    granularity: "day",
    end_time: "25:99",
  };
  const snapshot = {
    items: [],
    tasks: [fakeTask("t-timed"), fakeTask("t-broken")],
    planNodes: [],
    schedules: [timedSchedule, brokenSchedule],
    themes: [],
  };
  const items = new ItemQueryService({ readItemQuerySnapshot: () => snapshot });
  const byId = new Map(items.listOpenItems({}).items.map((i) => [i.id, i]));
  assert.equal(byId.get("t-timed").planned_end_time, "02:00");
  assert.equal(byId.get("t-broken").planned_end_time, null, "unreadable value reads as null");

  const workspace = {
    themes: [],
    tasks: [fakeTask("t-timed", { version: 1 })],
    schedules: [timedSchedule],
  };
  const context = new TaskContextQueryService({
    loadTaskContextWorkspace: () => workspace,
    loadTaskContextThemes: () => [],
  });
  const got = context.execute({ task_id: "t-timed" });
  assert.equal(got.task.schedule.end_time, "02:00");
  assert.equal(got.task.schedule.notify_before_minutes, 30);
});
