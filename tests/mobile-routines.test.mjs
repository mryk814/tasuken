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

test("続けることは一時停止中を除いて返し、手入れは返さない（#755 束9b）", async () => {
  const { adapter } = gateway();
  const response = await read(adapter);
  assert.equal(response.status, 200);
  assert.equal(mobileRoutinesResponseSchema.safeParse(response.body).success, true);
  const { habits } = response.body.data;
  assert.deepEqual(
    habits.map((habit) => [habit.habitId, habit.scheduleLabel, habit.todayLabel, habit.weekLabel]),
    [
      ["habit-stretch", "毎日1回", "今日0回", "今週0/7回"],
      ["habit-read", "週3回", "今日1回", "今週1/3回"],
    ],
  );
  // 手入れの記録はDBに残っていても、スマホへは渡さない（束9a のスマホは欄が無くても空として読む）。
  assert.equal(Object.hasOwn(response.body.data, "maintenances"), false);
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

test("親の保存が失敗するとHabitの実施記録もrollbackする", async () => {
  for (const [parent, entry, action] of [
    [
      "habit",
      "habit_entry",
      { name: "RecordHabitEntry", habitId: "habit-stretch", performedOn: today, sequence: 1 },
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

test("手入れの記録（RecordMaintenance）はもう受けず、手入れの記録を書き換えない（#755 束9b）", async () => {
  const { adapter, repository, saved } = gateway({ writable: true });
  const before = structuredClone(repository.get("maintenance", "maint-filter"));
  const result = await post(
    adapter,
    actionRequest({ name: "RecordMaintenance", maintenanceId: "maint-filter", performedOn: today }),
  );
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, "validation_failed");
  assert.deepEqual(saved, []);
  assert.deepEqual(repository.get("maintenance", "maint-filter"), before);
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

function append(commandId, overrides = {}) {
  return actionRequest(
    {
      name: "RecordHabitEntry",
      habitId: "habit-read",
      performedOn: today,
      sequence: 2,
      mode: "append",
      ...overrides,
    },
    commandId,
  );
}

test("今のAPKの「1回足す」は、圏外の間にPCが同じ日に記録していても1回増やし、同じcommandIdの送り直しでは増やさない", async () => {
  const { adapter, repository } = gateway({ writable: true });
  // 端末は圏外で 2 回目を記録した（Desktop の次の番号 2 を持っている）。その間に PC でも 2 回目を記録した。
  repository.save("habit_entry", {
    id: `habit-entry:habit-read:${today}:2`,
    habit_id: "habit-read",
    performed_on: today,
    sequence: 2,
    recorded_at: "2026-10-06T09:30:00.000Z",
  });

  const delivered = await post(adapter, append("command-offline"));
  assert.equal(delivered.status, 200);
  assert.equal(delivered.body.data.status, "applied");
  const stored = repository.get("habit_entry", `habit-entry:habit-read:${today}:3`);
  assert.equal(stored.source_command_id, "command-offline");
  assert.equal(stored.recorded_at, "2026-10-06T10:00:00.000Z");
  const after = (await read(adapter)).body.data.habits.find(
    (habit) => habit.habitId === "habit-read",
  );
  assert.equal(after.todayCount, 3, "端末の 1 回が PC の 2 回目と重ならずに足される");
  assert.equal(after.nextSequence, 4);

  // 応答を失った送り直し（同じ commandId）は、同じ記録を返して増やさない。
  const again = await post(adapter, append("command-offline"));
  assert.equal(again.body.data.status, "no_change");
  assert.equal(repository.list("habit_entry").length, 3);

  // 同じ commandId で別の日を送ってきたら、取り違えとして断る。
  const conflict = await post(adapter, append("command-offline", { performedOn: "2026-10-05" }));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, "idempotency_conflict");
  assert.equal(repository.list("habit_entry").length, 3);
});

test("「1回足す」は、実施日を直した記録や消した記録のIDを上書きせず、消した記録を送り直しで生き返らせない", async () => {
  const { adapter, repository } = gateway({ writable: true });
  // 2 回目は前の日へ直した（ID は元の日のまま）。3 回目は消した。
  repository.save("habit_entry", {
    id: `habit-entry:habit-read:${today}:2`,
    habit_id: "habit-read",
    performed_on: "2026-10-05",
    sequence: 2,
  });
  repository.records.push({
    type: "habit_entry",
    id: `habit-entry:habit-read:${today}:3`,
    habit_id: "habit-read",
    performed_on: today,
    sequence: 3,
    deleted_at: "2026-10-06T09:40:00.000Z",
  });

  assert.equal((await post(adapter, append("command-a"))).body.data.status, "applied");
  assert.equal(
    repository.get("habit_entry", `habit-entry:habit-read:${today}:4`).source_command_id,
    "command-a",
  );
  assert.equal(
    repository.get("habit_entry", `habit-entry:habit-read:${today}:2`).performed_on,
    "2026-10-05",
  );

  // 届いた記録を PC で消した後に、遅れた送り直しが届いても戻さない。
  const sent = repository.get("habit_entry", `habit-entry:habit-read:${today}:4`);
  sent.deleted_at = "2026-10-06T11:00:00.000Z";
  assert.equal((await post(adapter, append("command-a"))).body.data.status, "no_change");
  assert.ok(repository.get("habit_entry", `habit-entry:habit-read:${today}:4`, true).deleted_at);
  // 残っているのは、元からの 1 回目と、前の日へ直した 2 回目だけ。
  assert.equal(repository.list("habit_entry").length, 2);
});

test("古いAPKの形（modeなし）は今までどおり送られた回に保存し、commandIdを残さない", async () => {
  const { adapter, repository } = gateway({ writable: true });
  const result = await post(
    adapter,
    actionRequest({
      name: "RecordHabitEntry",
      habitId: "habit-read",
      performedOn: today,
      sequence: 2,
    }),
  );
  assert.equal(result.body.data.status, "applied");
  const stored = repository.get("habit_entry", `habit-entry:habit-read:${today}:2`);
  assert.equal(Object.hasOwn(stored, "source_command_id"), false);
  assert.equal(
    mobileRoutineActionRequestSchema.safeParse(append("command-x", { mode: "replace" })).success,
    false,
  );
});

test("遅れて届いた前の日の記録で、Habitの最後に行った日を過去へ戻さない", async () => {
  const { adapter, repository } = gateway({ writable: true });
  repository.save("habit", { ...repository.get("habit", "habit-read"), last_performed_on: today });
  const late = await post(adapter, append("command-late", { performedOn: "2026-10-04" }));
  assert.equal(late.body.data.status, "applied");
  assert.equal(repository.get("habit", "habit-read").last_performed_on, today);
});

test("「1回足す」の受領は、保存後のそのHabitの数（記録の日の数）を返し、古いAPKの形には付けない", async () => {
  const { adapter, repository } = gateway({ writable: true });
  // PC が同じ日に 2 回目を記録済み。端末の 1 回は 3 回目に入る。
  repository.save("habit_entry", {
    id: `habit-entry:habit-read:${today}:2`,
    habit_id: "habit-read",
    performed_on: today,
    sequence: 2,
  });
  const delivered = await post(adapter, append("command-counts"));
  assert.equal(mobileRoutineActionResponseSchema.safeParse(delivered.body).success, true);
  const counts = {
    habitId: "habit-read",
    date: today,
    todayCount: 3,
    weekCount: 3,
    nextSequence: 4,
  };
  assert.deepEqual(delivered.body.data.habit, counts);

  // 応答を失った送り直しも、同じ数を返す（端末は上書きするだけで +1 しない）。
  const again = await post(adapter, append("command-counts"));
  assert.equal(again.body.data.status, "no_change");
  assert.deepEqual(again.body.data.habit, counts);

  // 古いAPK（mode なし）は受領の知らない欄を読めないので、数を付けない。
  const old = await post(
    adapter,
    actionRequest({
      name: "RecordHabitEntry",
      habitId: "habit-stretch",
      performedOn: today,
      sequence: 1,
    }),
  );
  assert.equal(old.body.data.status, "applied");
  assert.equal(Object.hasOwn(old.body.data, "habit"), false);
});
