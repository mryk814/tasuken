import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import os from "node:os";
import test from "node:test";

import { build } from "esbuild";

import {
  mobileRoutineActionRequestSchema,
  mobileRoutineActionResponseSchema,
  mobileRoutinesResponseSchema,
} from "../src/shared/contracts/mobile/public.ts";
import { TASKEN_MOBILE_ENDPOINTS } from "../src/shared/contracts/mobile/public.mjs";

const bundled = await build({
  stdin: {
    contents: `export { TaskenCoreRuntime } from "./src/main/composition/taskenCoreRuntime.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { TaskenCoreRuntime } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const now = "2026-10-06T09:00:00.000Z";
const today = "2026-10-06";

class MemoryRepository {
  constructor(records) {
    this.records = records;
  }
  list(type, includeDeleted = false) {
    return this.records.filter(
      (entity) => entity.type === type && (includeDeleted || !entity.deleted_at),
    );
  }
  get(type, id, includeDeleted = false) {
    const found = this.records.find((entity) => entity.type === type && entity.id === id) || null;
    return found && (includeDeleted || !found.deleted_at) ? found : null;
  }
  save(type, entity) {
    const saved = { ...entity, type, deleted_at: null };
    this.records = [...this.records.filter((e) => !(e.type === type && e.id === entity.id)), saved];
    return saved;
  }
  saveMany(operations) {
    const before = this.records;
    try {
      return operations.map(({ type, entity }) => this.save(type, entity));
    } catch (error) {
      this.records = before;
      throw error;
    }
  }
  runTransaction(callback) {
    return callback(this);
  }
}

function records() {
  return [
    {
      type: "habit",
      id: "habit-stretch",
      title: "ストレッチ",
      schedule_kind: "daily",
      state: "active",
    },
    {
      type: "habit",
      id: "habit-read",
      title: "論文を読む",
      schedule_kind: "weekly",
      weekly_target: 3,
      state: "active",
    },
    {
      type: "habit",
      id: "habit-paused",
      title: "止めている",
      schedule_kind: "daily",
      state: "paused",
    },
    {
      type: "habit_entry",
      id: `habit-entry:habit-read:${today}:1`,
      habit_id: "habit-read",
      performed_on: today,
      sequence: 1,
    },
    {
      type: "maintenance",
      id: "maint-filter",
      target: "エアコン",
      action: "フィルターを掃除する",
      interval_days: 30,
      next_due_on: "2026-10-01",
      last_performed_on: "2026-09-01",
    },
    {
      type: "maintenance",
      id: "maint-soon",
      target: "ドラフト",
      action: "点検",
      interval_days: 90,
      next_due_on: "2026-10-10",
    },
    {
      type: "maintenance",
      id: "maint-later",
      target: "pH計",
      action: "校正",
      interval_days: 180,
      next_due_on: "2026-12-01",
    },
    { type: "maintenance", id: "maint-unscheduled", target: "棚", action: "整理" },
  ];
}

function gateway({ writable = false, failType = null } = {}) {
  const repository = new MemoryRepository(records());
  const originalSave = repository.save.bind(repository);
  repository.save = (type, entity) => {
    if (type === failType) throw new Error("injected parent save failure");
    return originalSave(type, entity);
  };
  const saved = [];
  const routineWriter = writable
    ? {
        saveMany: (operations) => {
          const result = repository.saveMany(operations);
          saved.push(...operations.map(({ type, entity }) => [type, entity.id]));
          return result;
        },
      }
    : undefined;
  const runtime = new TaskenCoreRuntime(
    os.tmpdir(),
    repository,
    () => {
      throw new Error("read only");
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { routineWriter },
  );
  const adapter = runtime.createMobileGateway({
    current: () => ({ serverId: "desktop-home", serverRevision: 7, generatedAt: now }),
  });
  return { adapter, repository, saved };
}

const reader = { kind: "mobile_device", deviceId: "device-fold-7", scopes: ["mobile:read"] };
const writer = { ...reader, scopes: ["mobile:read", "mobile:capture-write"] };
const query = { apiVersion: "1", schemaVersion: "7", requestId: "request-routines", date: today };

function read(adapter, principal = reader, q = query) {
  return adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.routines,
    principal,
    query: q,
  });
}

function actionRequest(action, commandId = "command-1", overrides = {}) {
  return {
    apiVersion: 1,
    schemaVersion: 7,
    requestId: `request-${commandId}`,
    commandId,
    idempotencyKey: commandId,
    clientDeviceId: "device-fold-7",
    issuedAt: "2026-10-06T10:00:00.000Z",
    action,
    ...overrides,
  };
}

function post(adapter, body, principal = writer) {
  return adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.routineActions,
    principal,
    body,
  });
}

test("続けることは一時停止中を除き、手入れは目安が近いか過ぎた項目だけを返す", async () => {
  const { adapter } = gateway();
  const response = await read(adapter);
  assert.equal(response.status, 200);
  assert.equal(mobileRoutinesResponseSchema.safeParse(response.body).success, true);
  const { habits, maintenances } = response.body.data;
  assert.deepEqual(
    habits.map((habit) => [habit.habitId, habit.scheduleLabel, habit.todayLabel, habit.weekLabel]),
    [
      ["habit-stretch", "毎日1回", "今日0回", "今週0/7回"],
      ["habit-read", "週3回", "今日1回", "今週1/3回"],
    ],
  );
  assert.deepEqual(
    maintenances.map((item) => [item.maintenanceId, item.label, item.state, item.dueLabel]),
    [
      ["maint-filter", "エアコン / フィルターを掃除する", "overdue", "目安を5日過ぎています"],
      ["maint-soon", "ドラフト / 点検", "due_soon", "あと4日"],
    ],
  );
});

test("読み出しは読み取り権限と日付を求め、知らないqueryを拒否する", async () => {
  const { adapter } = gateway();
  assert.equal((await read(adapter, { ...reader, scopes: [] })).status, 403);
  assert.equal((await read(adapter, reader, { ...query, date: "10/06" })).status, 400);
  assert.equal((await read(adapter, reader, { ...query, cursor: "x" })).status, 400);
});

test("履歴の欠番があってもAndroidへ次のsequenceを返し、追加を重複扱いにしない", async () => {
  const { adapter, repository } = gateway({ writable: true });
  repository.records = repository.records.filter((entry) => entry.type !== "habit_entry");
  repository.save("habit_entry", {
    id: `habit-entry:habit-read:${today}:2`,
    habit_id: "habit-read",
    performed_on: today,
    sequence: 2,
  });
  const response = await read(adapter);
  const habit = response.body.data.habits.find((item) => item.habitId === "habit-read");
  assert.equal(habit.todayCount, 1);
  assert.equal(habit.nextSequence, 3);
  const result = await post(
    adapter,
    actionRequest({
      name: "RecordHabitEntry",
      habitId: habit.habitId,
      performedOn: today,
      sequence: habit.nextSequence,
    }),
  );
  assert.equal(result.body.data.status, "applied");
  assert.equal(repository.list("habit_entry").length, 2);
});

test("親の保存が失敗するとHabitとMaintenanceの実施記録もrollbackする", async () => {
  for (const [parent, entry, action] of [
    [
      "habit",
      "habit_entry",
      { name: "RecordHabitEntry", habitId: "habit-stretch", performedOn: today, sequence: 1 },
    ],
    [
      "maintenance",
      "maintenance_entry",
      { name: "RecordMaintenance", maintenanceId: "maint-filter", performedOn: today },
    ],
  ]) {
    const { adapter, repository } = gateway({ writable: true, failType: parent });
    const before = structuredClone(repository.records);
    const result = await post(adapter, actionRequest(action));
    assert.notEqual(result.status, 200);
    assert.deepEqual(repository.records, before, `${entry}だけを残さない`);
  }
});

test("Habitの1回記録はDesktopと同じEntityで保存し、同じ回の再送は増やさない", async () => {
  const { adapter, repository, saved } = gateway({ writable: true });
  const body = actionRequest({
    name: "RecordHabitEntry",
    habitId: "habit-stretch",
    performedOn: today,
    sequence: 1,
  });
  const first = await post(adapter, body);
  assert.equal(first.status, 200);
  assert.equal(mobileRoutineActionResponseSchema.safeParse(first.body).success, true);
  assert.equal(first.body.data.status, "applied");
  assert.deepEqual(saved, [
    ["habit_entry", `habit-entry:habit-stretch:${today}:1`],
    ["habit", "habit-stretch"],
  ]);
  assert.equal(repository.get("habit", "habit-stretch").last_performed_on, today);

  const again = await post(adapter, {
    ...body,
    commandId: "command-2",
    idempotencyKey: "command-2",
  });
  assert.equal(again.body.data.status, "no_change");
  assert.equal(saved.length, 2);

  const after = await read(adapter);
  assert.equal(after.body.data.habits[0].todayLabel, "今日1回");
});

test("Maintenanceの記録は次の目安を進め、同じ日の2回目は増やさない", async () => {
  const { adapter, repository, saved } = gateway({ writable: true });
  const body = actionRequest({
    name: "RecordMaintenance",
    maintenanceId: "maint-filter",
    performedOn: today,
  });
  const first = await post(adapter, body);
  assert.equal(first.status, 200);
  assert.equal(first.body.data.status, "applied");
  assert.equal(first.body.data.nextDueOn, "2026-11-05");
  const entry = repository.get("maintenance_entry", `maintenance-entry:maint-filter:${today}`);
  assert.equal(entry.previous_due_on, "2026-10-01");
  assert.equal(entry.previous_performed_on, "2026-09-01");
  assert.equal(entry.next_due_on, "2026-11-05");
  const item = repository.get("maintenance", "maint-filter");
  assert.equal(item.next_due_on, "2026-11-05");
  assert.equal(item.last_performed_on, today);

  const again = await post(adapter, {
    ...body,
    commandId: "command-2",
    idempotencyKey: "command-2",
  });
  assert.equal(again.body.data.status, "no_change");
  assert.equal(again.body.data.nextDueOn, "2026-11-05");
  assert.equal(saved.length, 2);

  // 目安が先へ進んだので、Todayの対象から外れる。
  const after = await read(adapter);
  assert.deepEqual(
    after.body.data.maintenances.map((m) => m.maintenanceId),
    ["maint-soon"],
  );
});

test("存在しない・一時停止中・権限なし・他端末の名義・書き込み口なしは拒否する", async () => {
  const { adapter } = gateway({ writable: true });
  const habit = (habitId) =>
    actionRequest({ name: "RecordHabitEntry", habitId, performedOn: today, sequence: 1 });
  assert.equal((await post(adapter, habit("habit-nope"))).status, 404);
  assert.equal((await post(adapter, habit("habit-paused"))).status, 404);
  assert.equal(
    (
      await post(
        adapter,
        actionRequest({
          name: "RecordMaintenance",
          maintenanceId: "maint-unscheduled",
          performedOn: today,
        }),
      )
    ).status,
    400,
  );
  const valid = habit("habit-stretch");
  assert.equal((await post(adapter, valid, reader)).status, 403);
  assert.equal((await post(adapter, { ...valid, clientDeviceId: "device-other" })).status, 400);
  assert.equal(
    mobileRoutineActionRequestSchema.safeParse({ ...valid, extra: true }).success,
    false,
  );
  assert.equal(
    mobileRoutineActionRequestSchema.safeParse(
      actionRequest({
        name: "RecordHabitEntry",
        habitId: "habit-stretch",
        performedOn: today,
        sequence: 0,
      }),
    ).success,
    false,
  );

  // 書き込み口を持たないCore（常時稼働node）では、読めるが書けない。
  const readOnly = gateway({ writable: false }).adapter;
  assert.equal((await read(readOnly)).status, 200);
  assert.equal((await post(readOnly, valid)).status, 409);
});
