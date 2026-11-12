import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import { createMobileOfflineGateway } from "./helpers/mobile-offline-gateway.mjs";

// 場所のリマインダー（#727）。契約（Task の欄・AI の変更・Mobile の要約と更新）と保存の検査。
const bundle = await build({
  stdin: {
    contents: `
      export * from "./src/shared/contracts/task/model.ts";
      export { aiTaskEditSchema } from "./src/shared/contracts/task/aiTaskChange.ts";
      export { mobileTaskCommandRequestSchema, mobileTaskSummarySchema } from "./src/shared/contracts/mobile/schema.ts";
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const {
  taskPlaceReminderSchema,
  taskPatchSchema,
  aiTaskEditSchema,
  mobileTaskCommandRequestSchema,
  mobileTaskSummarySchema,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const place = {
  name: "三ノ宮",
  latitude: 34.6937,
  longitude: 135.1956,
  radius_m: 300,
  days: [1, 3],
  time_from: "17:00",
  time_to: "21:00",
};

test("入力で省いた半径は300m・曜日は毎日・時間帯は無しになり、範囲外と片方だけの時間帯は断る", () => {
  assert.deepEqual(
    taskPlaceReminderSchema.parse({ name: " 三ノ宮 ", latitude: 34.6937, longitude: 135.1956 }),
    {
      name: "三ノ宮",
      latitude: 34.6937,
      longitude: 135.1956,
      radius_m: 300,
      days: [],
      time_from: null,
      time_to: null,
    },
  );
  for (const invalid of [
    { ...place, latitude: 90.1 },
    { ...place, longitude: -180.1 },
    { ...place, radius_m: 99 },
    { ...place, radius_m: 2001 },
    { ...place, radius_m: 300.5 },
    { ...place, name: " " },
    { ...place, name: "あ".repeat(81) },
    { ...place, days: [3, 1] },
    { ...place, days: [1, 1] },
    { ...place, days: [7] },
    { ...place, time_to: null },
    { ...place, time_from: null },
    { ...place, time_from: "24:00" },
    { ...place, extra: 1 },
  ]) {
    assert.equal(
      taskPlaceReminderSchema.safeParse(invalid).success,
      false,
      JSON.stringify(invalid),
    );
  }
  // 日またぎ（from > to）は有効。
  assert.equal(
    taskPlaceReminderSchema.safeParse({ ...place, time_from: "22:00", time_to: "02:00" }).success,
    true,
  );
});

test("Task の更新・AI の変更で場所を付けて、null で外せる", () => {
  assert.equal(taskPatchSchema.parse({ place_reminder: place }).place_reminder.name, "三ノ宮");
  assert.equal(taskPatchSchema.parse({ place_reminder: null }).place_reminder, null);
  assert.equal(aiTaskEditSchema.parse({ place_reminder: place }).place_reminder.radius_m, 300);
  assert.equal(aiTaskEditSchema.parse({ place_reminder: null }).place_reminder, null);
  assert.equal(aiTaskEditSchema.safeParse({ place_reminder: { name: "x" } }).success, false);
});

test("保存の検査は object でない値だけ断り、範囲外・未知の欄を持つ先の版の形は取り込む", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tasken-place-"));
  const db = new WorkspaceDatabase(path.join(dir, "workspace.sqlite"));
  try {
    db.loadWorkspace();
    const base = { id: "place-task", title: "三ノ宮で買う", state: "todo", priority: "normal" };
    // 同期・取り込みの経路でもここを通るので、範囲外や未知のキーは断らず、object でない値だけ断る。
    // 厳しい検査はコマンド入力の schema の役目（先の版が範囲を広げても同期が止まらないように）。
    for (const tolerated of [
      { ...place, latitude: 91 },
      { ...place, radius_m: 3000, on_exit: true },
      { ...place, days: [2, 1] },
      { ...place, time_to: null },
    ])
      db.save("task", { ...base, place_reminder: tolerated });
    for (const broken of ["三ノ宮", 5, [place]])
      assert.throws(() => db.save("task", { ...base, place_reminder: broken }), /place_reminder/);
    db.save("task", { ...base, place_reminder: place });
    assert.deepEqual(db.get("task", "place-task").place_reminder, place);
    db.save("task", { ...base, place_reminder: null });
    assert.equal(db.get("task", "place-task").place_reminder, null);
    // 欄を知らない古い端末の Task（欄なし）も、欄を知っている端末の Task も保存できる。
    db.save("task", { ...base, id: "plain-task" });
    assert.equal(db.get("task", "plain-task").place_reminder, undefined);
  } finally {
    db.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Mobile の更新の patch は場所の付け外しを受け、不正な形は断る", () => {
  const envelope = (changes, base) => ({
    apiVersion: 1,
    schemaVersion: 7,
    requestId: "place-request",
    commandId: "place-command",
    idempotencyKey: "place-command",
    clientDeviceId: "device-1",
    issuedAt: "2026-11-12T00:00:00Z",
    command: {
      name: "UpdateTask",
      taskId: "task-1",
      expectedVersion: 1,
      expectedScheduleVersion: null,
      changes,
      base,
    },
  });
  const mobilePlace = {
    name: "三ノ宮",
    latitude: 34.6937,
    longitude: 135.1956,
    radiusMeters: 300,
    days: [1, 3],
    timeFrom: "17:00",
    timeTo: "21:00",
  };
  const parse = (changes, base) =>
    mobileTaskCommandRequestSchema.safeParse(envelope(changes, base)).success;
  assert.equal(parse({ placeReminder: mobilePlace }, { placeReminder: null }), true);
  assert.equal(parse({ placeReminder: null }, { placeReminder: mobilePlace }), true);
  assert.equal(
    parse({ placeReminder: { ...mobilePlace, radiusMeters: 50 } }, { placeReminder: null }),
    false,
  );
  assert.equal(
    parse({ placeReminder: { ...mobilePlace, timeTo: null } }, { placeReminder: null }),
    false,
  );
  assert.equal(parse({ placeReminder: mobilePlace, title: "x" }, { placeReminder: null }), false);
});

test("Gateway はヘッダが無ければ placeReminder を出さず、あれば付け外しが保存・要約に出る", async () => {
  const fixture = await createMobileOfflineGateway();
  try {
    const { origin, accessToken, deviceId } = fixture.config;
    let sequence = 0;
    const send = async (command) => {
      const id = `place-${++sequence}`;
      const response = await fetch(`${origin}/v1/commands`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "X-Tasken-Place-Reminder": "1",
        },
        body: JSON.stringify({
          apiVersion: 1,
          schemaVersion: 7,
          requestId: id,
          commandId: id,
          idempotencyKey: id,
          clientDeviceId: deviceId,
          issuedAt: "2026-11-12T00:00:00Z",
          command,
        }),
      });
      return { status: response.status, body: await response.json() };
    };
    const read = async (optIn) => {
      const query = new URLSearchParams({
        apiVersion: "1",
        schemaVersion: "7",
        requestId: "place-read",
        date: "2026-11-12",
        limit: "50",
      });
      const response = await fetch(`${origin}/v1/today?${query}`, {
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(optIn ? { "X-Tasken-Place-Reminder": "1" } : {}),
        },
      });
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      return body.data.items.find((item) => item.id === "place-task");
    };
    const created = await send({
      name: "CreateTask",
      task: {
        id: "place-task",
        title: "三ノ宮で買う",
        projectId: "theme-personal-default",
        state: "todo",
        priority: "normal",
        requester: "self",
        intendedExecutor: "self",
        todayDate: "2026-11-12",
      },
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal(Object.hasOwn(await read(false), "placeReminder"), false);
    assert.equal((await read(true)).placeReminder, null);

    const mobilePlace = {
      name: "三ノ宮",
      latitude: 34.6937,
      longitude: 135.1956,
      radiusMeters: 300,
      days: [1, 3],
      timeFrom: "17:00",
      timeTo: "21:00",
    };
    const attached = await send({
      name: "UpdateTask",
      taskId: "place-task",
      expectedVersion: 1,
      expectedScheduleVersion: null,
      base: { placeReminder: null },
      changes: { placeReminder: mobilePlace },
    });
    assert.equal(attached.status, 200, JSON.stringify(attached.body));
    assert.deepEqual(attached.body.data.task.placeReminder, mobilePlace);
    assert.deepEqual(fixture.snapshot().tasks[0].place_reminder, {
      name: "三ノ宮",
      latitude: 34.6937,
      longitude: 135.1956,
      radius_m: 300,
      days: [1, 3],
      time_from: "17:00",
      time_to: "21:00",
    });
    assert.deepEqual((await read(true)).placeReminder, mobilePlace);
    assert.equal(Object.hasOwn(await read(false), "placeReminder"), false);

    const detached = await send({
      name: "UpdateTask",
      taskId: "place-task",
      expectedVersion: 2,
      expectedScheduleVersion: null,
      base: { placeReminder: mobilePlace },
      changes: { placeReminder: null },
    });
    assert.equal(detached.status, 200, JSON.stringify(detached.body));
    assert.equal(detached.body.data.task.placeReminder, null);
    assert.equal(fixture.snapshot().tasks[0].place_reminder, null);
    assert.equal((await read(true)).placeReminder, null);
  } finally {
    await fixture.close();
  }
});

test("golden の要約と更新の例は schema に合い、付ける値と更新の値が一致する", async () => {
  const { readFileSync } = await import("node:fs");
  const golden = JSON.parse(
    readFileSync(
      new URL("../contracts/mobile/v1/task-place-reminder.golden.json", import.meta.url),
      "utf8",
    ),
  );
  for (const key of ["updateTaskAttach", "updateTaskDetach"])
    assert.equal(mobileTaskCommandRequestSchema.safeParse(golden[key]).success, true, key);
  assert.equal(mobileTaskSummarySchema.safeParse(golden.taskSummaryWithPlace).success, true);
  assert.equal(mobileTaskSummarySchema.safeParse(golden.taskSummaryWithoutPlace).success, true);
  assert.deepEqual(
    golden.updateTaskAttach.command.changes.placeReminder,
    golden.taskSummaryWithPlace.placeReminder,
  );
});

test("読めない場所の値を持つ Task が 1 件あっても一覧は落ちず、他の欄の更新で生の値が残る", async () => {
  const fixture = await createMobileOfflineGateway();
  try {
    const { origin, accessToken, deviceId } = fixture.config;
    let sequence = 0;
    const send = async (command) => {
      const id = `raw-${++sequence}`;
      const response = await fetch(`${origin}/v1/commands`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          apiVersion: 1,
          schemaVersion: 7,
          requestId: id,
          commandId: id,
          idempotencyKey: id,
          clientDeviceId: deviceId,
          issuedAt: "2026-11-12T00:00:00Z",
          command,
        }),
      });
      return { status: response.status, body: await response.json() };
    };
    const get = async (endpoint, extra = {}) => {
      const query = new URLSearchParams({
        apiVersion: "1",
        schemaVersion: "7",
        requestId: "raw-read",
        ...extra,
      });
      const response = await fetch(`${origin}/v1/${endpoint}?${query}`, {
        headers: { authorization: `Bearer ${accessToken}`, "X-Tasken-Place-Reminder": "1" },
      });
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      return body.data;
    };
    for (const id of ["raw-task", "ok-task"]) {
      const created = await send({
        name: "CreateTask",
        task: {
          id,
          title: id,
          projectId: "theme-personal-default",
          state: "todo",
          priority: "normal",
          requester: "self",
          intendedExecutor: "self",
          todayDate: "2026-11-12",
        },
      });
      assert.equal(created.status, 200, JSON.stringify(created.body));
    }
    // 未知のキーと範囲外の値（先の版が足した・広げた形）を、生のまま置く。
    const unreadable = { ...place, radius_m: 5000, on_exit: true };
    await fixture.control({ rawPlaceReminder: { id: "raw-task", value: unreadable } });
    const rawTask = () => fixture.snapshot().tasks.find((task) => task.id === "raw-task");
    assert.deepEqual(rawTask().place_reminder, unreadable);

    const today = await get("today", { date: "2026-11-12", limit: "50" });
    assert.equal(today.items.length, 2);
    assert.equal(today.items.find((item) => item.id === "raw-task").placeReminder, null);
    const bootstrap = await get("bootstrap", { limit: "50" });
    assert.equal(bootstrap.tasks.length, 2);
    const sync = await get("sync", { cursor: bootstrap.nextCursor, limit: "50" });
    assert.ok(Array.isArray(sync.changes));

    // 他の欄だけ変えても、生の値は保存から消えない。
    const renamed = await send({
      name: "UpdateTask",
      taskId: "raw-task",
      expectedVersion: rawTask().version,
      expectedScheduleVersion: null,
      base: { title: "raw-task" },
      changes: { title: "題名を変えた" },
    });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
    assert.equal(rawTask().title, "題名を変えた");
    assert.deepEqual(rawTask().place_reminder, unreadable);
  } finally {
    await fixture.close();
  }
});
