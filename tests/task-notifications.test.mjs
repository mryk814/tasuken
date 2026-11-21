import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import {
  dueTaskNotices,
  localMinute,
  normalizeDueNotificationTimes,
  normalizeReminderDateTime,
  pruneFiredNotices,
  scheduleDueDate,
  snoozedReminderAt,
  suggestedSecondDueTime,
  unfiredNotices,
} from "../src/shared/taskNotifications.ts";
import { createMobileOfflineGateway } from "./helpers/mobile-offline-gateway.mjs";

// 時刻と期限の知らせ（#753）。時刻の決まり（単体）と、設定の保存・AI の欄・Mobile の要約と更新（境界）。
const bundle = await build({
  stdin: {
    contents: `
      export { taskPatchSchema } from "./src/shared/contracts/task/model.ts";
      export { aiTaskCreationFields } from "./src/shared/contracts/task/aiItemCreation.ts";
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
  taskPatchSchema,
  aiTaskCreationFields,
  aiTaskEditSchema,
  mobileTaskCommandRequestSchema,
  mobileTaskSummarySchema,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** 現地時刻で Date を作る（試験を動かす端末の時差によらない）。 */
const local = (year, month, day, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute);

test("時差なしの時刻は現地の時刻として、時差つきの時刻は瞬間として読む", () => {
  assert.equal(normalizeReminderDateTime("2026-11-16T09:00"), "2026-11-16T09:00");
  assert.equal(normalizeReminderDateTime("2026-11-16 9:05"), "2026-11-16T09:05");
  // 時差つきは、数字を拾うのでなく瞬間として現地に直す（Z の値が時差の分ずれて鳴らない）。
  for (const value of [
    "2026-11-16T00:00:00Z",
    "2026-11-16T09:00:00+09:00",
    "2026-11-15T19:30:00.000-05:00",
  ])
    assert.equal(normalizeReminderDateTime(value), localMinute(new Date(value)), value);
  // 同じ瞬間は、書き方が違っても同じ現地時刻になる。
  assert.equal(
    normalizeReminderDateTime("2026-11-16T00:00:00Z"),
    normalizeReminderDateTime("2026-11-16T09:00:00+09:00"),
  );
  for (const broken of ["", "あした", "2026-11-16", "2026-11-16T24:00", "2026-11-16T09:60", 5])
    assert.equal(normalizeReminderDateTime(broken), "", String(broken));
});

test("期限の日の時刻は既定が 09:00 の 1 回で、2 回目まで足せる", () => {
  assert.deepEqual(normalizeDueNotificationTimes(undefined), ["09:00"]);
  assert.deepEqual(normalizeDueNotificationTimes([]), ["09:00"]);
  assert.deepEqual(normalizeDueNotificationTimes(["07:30"]), ["07:30"]);
  assert.deepEqual(normalizeDueNotificationTimes(["09:00", "17:00"]), ["09:00", "17:00"]);
  // 重複・読めない値・3 つ目は落とす。
  assert.deepEqual(normalizeDueNotificationTimes(["09:00", "09:00", "25:00", "12:00", "18:00"]), [
    "09:00",
    "12:00",
  ]);
});

test("期限の日は終了日、無ければ開始日", () => {
  assert.equal(scheduleDueDate({ start_date: null, end_date: "2026-11-20" }), "2026-11-20");
  assert.equal(scheduleDueDate({ start_date: "2026-11-18", end_date: "2026-11-20" }), "2026-11-20");
  assert.equal(scheduleDueDate({ start_date: "2026-11-18", end_date: null }), "2026-11-18");
  assert.equal(scheduleDueDate({ start_date: null, end_date: null }), "");
  assert.equal(scheduleDueDate(null), "");
});

test("期限の日は決めた時刻を過ぎたら知らせ、前の日・次の日には知らせない", () => {
  const tasks = [{ id: "due", title: "書類を出す", state: "todo" }];
  const dueDates = new Map([["due", "2026-11-16"]]);
  const at = (now, dueTimes = ["09:00"]) =>
    dueTaskNotices({ tasks, dueDates, dueTimes, now }).map((notice) => notice.key);
  assert.deepEqual(at(local(2026, 11, 15, 23, 59)), []);
  assert.deepEqual(at(local(2026, 11, 16, 8, 59)), []);
  assert.deepEqual(at(local(2026, 11, 16, 9, 0)), ["due:due:2026-11-16T09:00"]);
  // 9 時に端末が眠っていても、その日のうちなら後から知らせる。
  assert.deepEqual(at(local(2026, 11, 16, 23, 59)), ["due:due:2026-11-16T09:00"]);
  // 日付が変わったら、きのうの期限は知らせない。
  assert.deepEqual(at(local(2026, 11, 17, 0, 0)), []);
  // 2 回目を足すと、その時刻にもう 1 度。
  assert.deepEqual(at(local(2026, 11, 16, 12, 0), ["09:00", "17:00"]), [
    "due:due:2026-11-16T09:00",
  ]);
  assert.deepEqual(at(local(2026, 11, 16, 17, 0), ["09:00", "17:00"]), [
    "due:due:2026-11-16T09:00",
    "due:due:2026-11-16T17:00",
  ]);
});

test("時刻を付けた Task はその時刻に知らせ、逃した時刻は 24 時間まで後から出す", () => {
  const tasks = [
    { id: "timed", title: "電話する", state: "todo", reminder_at: "2026-11-16T14:30" },
  ];
  const at = (now, list = tasks) =>
    dueTaskNotices({ tasks: list, dueDates: new Map(), dueTimes: ["09:00"], now });
  assert.deepEqual(at(local(2026, 11, 16, 14, 29)), []);
  assert.deepEqual(at(local(2026, 11, 16, 14, 30)), [
    {
      key: "time:timed:2026-11-16T14:30",
      kind: "time",
      taskId: "timed",
      title: "電話する",
      at: "2026-11-16T14:30",
    },
  ]);
  // 日付をまたいでも 24 時間までは出す（夜の時刻を、朝に起こした端末が知らせる）。
  assert.equal(at(local(2026, 11, 17, 14, 29)).length, 1);
  assert.equal(at(local(2026, 11, 17, 14, 30)).length, 0);
  // 時差つきの値は、その瞬間に知らせる。
  const instant = new Date("2026-11-16T05:30:00Z");
  const zoned = [{ id: "zoned", title: "x", state: "todo", reminder_at: "2026-11-16T05:30:00Z" }];
  assert.equal(at(new Date(instant.getTime() - 60_000), zoned).length, 0);
  assert.equal(at(instant, zoned).length, 1);
});

test("完了・中止・削除した Task は知らせず、時刻と期限は別々に知らせる", () => {
  const now = local(2026, 11, 16, 10, 0);
  const closed = ["done", "cancelled"].map((state) => ({
    id: state,
    title: state,
    state,
    reminder_at: "2026-11-16T09:30",
  }));
  const deleted = {
    id: "deleted",
    title: "x",
    state: "todo",
    reminder_at: "2026-11-16T09:30",
    deleted_at: "2026-11-16T00:00:00Z",
  };
  const both = { id: "both", title: "両方", state: "todo", reminder_at: "2026-11-16T09:30" };
  const dueDates = new Map(
    ["done", "cancelled", "deleted", "both"].map((id) => [id, "2026-11-16"]),
  );
  assert.deepEqual(
    dueTaskNotices({ tasks: [...closed, deleted, both], dueDates, dueTimes: ["09:00"], now }).map(
      (notice) => notice.key,
    ),
    ["due:both:2026-11-16T09:00", "time:both:2026-11-16T09:30"],
  );
});

test("後で: 1 時間後は日付をまたぎ、明日は期限の知らせの最初の時刻になる", () => {
  assert.equal(snoozedReminderAt("hour", local(2026, 11, 16, 14, 30)), "2026-11-16T15:30");
  assert.equal(snoozedReminderAt("hour", local(2026, 12, 31, 23, 30)), "2027-01-01T00:30");
  assert.equal(snoozedReminderAt("tomorrow", local(2026, 11, 16, 14, 30)), "2026-11-17T09:00");
  assert.equal(snoozedReminderAt("tomorrow", local(2026, 11, 30, 23, 59)), "2026-12-01T09:00");
  assert.equal(
    snoozedReminderAt("tomorrow", local(2026, 11, 16, 14, 30), ["18:00", "07:30"]),
    "2026-11-17T07:30",
  );
});

test("出した知らせの控えは 2 日より前のものを落とす", () => {
  assert.deepEqual(
    pruneFiredNotices(
      { old: "2026-11-13", edge: "2026-11-14", today: "2026-11-16", broken: 5 },
      local(2026, 11, 16, 9, 0),
    ),
    { edge: "2026-11-14", today: "2026-11-16" },
  );
});

test("期限の日の時刻と出した知らせの控えは、端末の設定として保存される", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tasken-notify-"));
  const db = new WorkspaceDatabase(path.join(dir, "workspace.sqlite"));
  try {
    db.loadWorkspace();
    assert.deepEqual(db.getPreference("dueNotificationTimes"), ["09:00"]);
    assert.deepEqual(db.setPreference("dueNotificationTimes", ["08:00", "20:00"]), [
      "08:00",
      "20:00",
    ]);
    assert.deepEqual(db.getPreference("dueNotificationTimes"), ["08:00", "20:00"]);
    // 読めない値を渡されたら、既定に戻す（知らせが止まらないように）。
    assert.deepEqual(db.setPreference("dueNotificationTimes", "9時"), ["09:00"]);
    assert.deepEqual(db.getPreference("taskNotificationsFired"), {});
    db.setPreference("taskNotificationsFired", { "due:a:2026-11-16T09:00": "2026-11-16" });
    assert.deepEqual(db.getPreference("taskNotificationsFired"), {
      "due:a:2026-11-16T09:00": "2026-11-16",
    });
  } finally {
    db.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Task の欄は時差つきと現地時刻の両方を受け、AI には時差つきだけを受ける", () => {
  for (const value of ["2026-11-16T09:00:00+09:00", "2026-11-16T00:00:00Z", "2026-11-16T09:00"])
    assert.equal(taskPatchSchema.safeParse({ reminder_at: value }).success, true, value);
  assert.equal(taskPatchSchema.parse({ reminder_at: null }).reminder_at, null);
  for (const broken of ["2026-11-16", "2026-11-16T24:00", "9時"])
    assert.equal(taskPatchSchema.safeParse({ reminder_at: broken }).success, false, broken);
  // AI は時刻をどの時差で言ったかを必ず添える（現地時刻だけだと、どの端末の現地か決まらない）。
  assert.equal(
    aiTaskCreationFields.reminder_at.safeParse("2026-11-16T09:00:00+09:00").success,
    true,
  );
  assert.equal(aiTaskCreationFields.reminder_at.safeParse("2026-11-16T09:00").success, false);
  assert.equal(aiTaskEditSchema.safeParse({ reminder_at: "2026-11-16T09:00:00Z" }).success, true);
  assert.equal(aiTaskEditSchema.safeParse({ reminder_at: null }).success, true);
  assert.equal(aiTaskEditSchema.safeParse({ reminder_at: "2026-11-16T09:00" }).success, false);
});

test("Gateway はヘッダが無ければ reminderAt を出さず、あれば付け外しが保存・要約に出る", async () => {
  const fixture = await createMobileOfflineGateway();
  try {
    const { origin, accessToken, deviceId } = fixture.config;
    let sequence = 0;
    const send = async (command) => {
      const id = `remind-${++sequence}`;
      const response = await fetch(`${origin}/v1/commands`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "X-Tasken-Reminder-At": "1",
        },
        body: JSON.stringify({
          apiVersion: 1,
          schemaVersion: 7,
          requestId: id,
          commandId: id,
          idempotencyKey: id,
          clientDeviceId: deviceId,
          issuedAt: "2026-11-15T00:00:00Z",
          command,
        }),
      });
      return { status: response.status, body: await response.json() };
    };
    const read = async (optIn) => {
      const query = new URLSearchParams({
        apiVersion: "1",
        schemaVersion: "7",
        requestId: "remind-read",
        date: "2026-11-15",
        limit: "50",
      });
      const response = await fetch(`${origin}/v1/today?${query}`, {
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(optIn ? { "X-Tasken-Reminder-At": "1" } : {}),
        },
      });
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      return body.data.items.find((item) => item.id === "remind-task");
    };
    const created = await send({
      name: "CreateTask",
      task: {
        id: "remind-task",
        title: "電話する",
        projectId: "theme-personal-default",
        state: "todo",
        priority: "normal",
        requester: "self",
        intendedExecutor: "self",
        todayDate: "2026-11-15",
      },
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal(Object.hasOwn(await read(false), "reminderAt"), false);
    assert.equal((await read(true)).reminderAt, null);

    // 通知の「1 時間後」: スマホは時差つきで送る。
    const snoozed = await send({
      name: "UpdateTask",
      taskId: "remind-task",
      expectedVersion: 1,
      expectedScheduleVersion: null,
      base: { reminderAt: null },
      changes: { reminderAt: "2026-11-15T15:30:00+09:00" },
    });
    assert.equal(snoozed.status, 200, JSON.stringify(snoozed.body));
    assert.equal(snoozed.body.data.task.reminderAt, "2026-11-15T15:30:00+09:00");
    assert.equal(fixture.snapshot().tasks[0].reminder_at, "2026-11-15T15:30:00+09:00");
    assert.equal((await read(true)).reminderAt, "2026-11-15T15:30:00+09:00");
    assert.equal(Object.hasOwn(await read(false), "reminderAt"), false);

    // 写しが古くても（版が進んでいても）、時刻の欄が写しのままなら「後で」は通る。
    const renamed = await send({
      name: "UpdateTask",
      taskId: "remind-task",
      expectedVersion: 2,
      expectedScheduleVersion: null,
      base: { title: "電話する" },
      changes: { title: "折り返し電話する" },
    });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
    const stale = await send({
      name: "UpdateTask",
      taskId: "remind-task",
      expectedVersion: 2,
      expectedScheduleVersion: null,
      base: { reminderAt: "2026-11-15T15:30:00+09:00" },
      changes: { reminderAt: "2026-11-16T09:00:00+09:00" },
    });
    assert.equal(stale.status, 200, JSON.stringify(stale.body));
    assert.equal(stale.body.data.task.title, "折り返し電話する");
    assert.equal(stale.body.data.task.reminderAt, "2026-11-16T09:00:00+09:00");

    // ほかの端末が時刻を変えていたら、黙って上書きせずに競合として返す。
    const conflicted = await send({
      name: "UpdateTask",
      taskId: "remind-task",
      expectedVersion: 2,
      expectedScheduleVersion: null,
      base: { reminderAt: "2026-11-15T15:30:00+09:00" },
      changes: { reminderAt: "2026-11-20T09:00:00+09:00" },
    });
    assert.notEqual(conflicted.status, 200, JSON.stringify(conflicted.body));
    assert.equal(fixture.snapshot().tasks[0].reminder_at, "2026-11-16T09:00:00+09:00");

    const cleared = await send({
      name: "UpdateTask",
      taskId: "remind-task",
      expectedVersion: 4,
      expectedScheduleVersion: null,
      base: { reminderAt: "2026-11-16T09:00:00+09:00" },
      changes: { reminderAt: null },
    });
    assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
    assert.equal((await read(true)).reminderAt, null);
  } finally {
    await fixture.close();
  }
});

test("Desktop の画面が書いた時差なしの時刻も要約に出て、写しのままの「後で」が通る", async () => {
  const fixture = await createMobileOfflineGateway();
  try {
    const { origin, accessToken, deviceId } = fixture.config;
    const headers = {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "X-Tasken-Reminder-At": "1",
    };
    const send = async (id, command) => {
      const response = await fetch(`${origin}/v1/commands`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          apiVersion: 1,
          schemaVersion: 7,
          requestId: id,
          commandId: id,
          idempotencyKey: id,
          clientDeviceId: deviceId,
          issuedAt: "2026-11-15T00:00:00Z",
          command,
        }),
      });
      return { status: response.status, body: await response.json() };
    };
    const created = await send("floating-create", {
      name: "CreateTask",
      task: {
        id: "floating-task",
        title: "薬を飲む",
        projectId: "theme-personal-default",
        state: "todo",
        priority: "normal",
        requester: "self",
        intendedExecutor: "self",
        todayDate: "2026-11-15",
      },
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    // Desktop の画面と同じ形（時差なしの現地時刻）を置く。
    const seeded = await send("floating-seed", {
      name: "UpdateTask",
      taskId: "floating-task",
      expectedVersion: 1,
      expectedScheduleVersion: null,
      base: { reminderAt: null },
      changes: { reminderAt: "2026-11-15T21:00" },
    });
    assert.equal(seeded.status, 200, JSON.stringify(seeded.body));
    assert.equal(fixture.snapshot().tasks[0].reminder_at, "2026-11-15T21:00");
    assert.equal(seeded.body.data.task.reminderAt, "2026-11-15T21:00");
    const snoozed = await send("floating-snooze", {
      name: "UpdateTask",
      taskId: "floating-task",
      expectedVersion: 2,
      expectedScheduleVersion: null,
      base: { reminderAt: "2026-11-15T21:00" },
      changes: { reminderAt: "2026-11-15T22:00:00+09:00" },
    });
    assert.equal(snoozed.status, 200, JSON.stringify(snoozed.body));
    assert.equal(snoozed.body.data.task.reminderAt, "2026-11-15T22:00:00+09:00");
  } finally {
    await fixture.close();
  }
});

test("golden の要約と更新の例は schema に合う", () => {
  const golden = JSON.parse(
    readFileSync(
      new URL("../contracts/mobile/v1/task-reminder-at.golden.json", import.meta.url),
      "utf8",
    ),
  );
  for (const key of ["updateTaskSnooze", "updateTaskClear"])
    assert.equal(mobileTaskCommandRequestSchema.safeParse(golden[key]).success, true, key);
  for (const key of ["taskSummaryWithReminder", "taskSummaryFloating", "taskSummaryWithout"])
    assert.equal(mobileTaskSummarySchema.safeParse(golden[key]).success, true, key);
  assert.equal(
    golden.updateTaskSnooze.command.base.reminderAt,
    golden.taskSummaryWithReminder.reminderAt,
  );
  assert.equal(
    mobileTaskCommandRequestSchema.safeParse({
      ...golden.updateTaskSnooze,
      command: {
        ...golden.updateTaskSnooze.command,
        changes: { reminderAt: "あした" },
      },
    }).success,
    false,
  );
});

test("小数秒が何桁でも時差つきの時刻を読む（AI の入口が受ける範囲と同じ）", () => {
  for (const value of [
    "2026-11-16T09:00:00.1+09:00",
    "2026-11-16T09:00:00.123456+09:00",
    "2026-11-16T00:00:00.123456789Z",
  ]) {
    // AI の入口が受ける値は、Desktop も読める（読めないと、引き出しの保存がこの欄を空にする）。
    assert.equal(aiTaskEditSchema.safeParse({ reminder_at: value }).success, true, value);
    assert.equal(normalizeReminderDateTime(value), localMinute(new Date(value)), value);
    assert.notEqual(normalizeReminderDateTime(value), "", value);
  }
});

test("2 回目の最初の時刻は、1 回目より後で重ならない", () => {
  assert.equal(suggestedSecondDueTime("09:00"), "15:00");
  assert.equal(suggestedSecondDueTime("15:00"), "21:00");
  assert.equal(suggestedSecondDueTime("21:00"), "23:59");
  assert.equal(suggestedSecondDueTime("22:30"), "23:59");
  assert.equal(suggestedSecondDueTime("23:59"), null);
});

test("控えを使い始める最初の回は、今より前の知らせを鳴らさずに控え、次からは新しい知らせだけ出す", () => {
  const now = local(2026, 11, 16, 10, 0);
  const tasks = [
    { id: "due", title: "書類を出す", state: "todo" },
    { id: "timed", title: "電話する", state: "todo", reminder_at: "2026-11-15T20:00" },
    { id: "later", title: "あとで", state: "todo", reminder_at: "2026-11-16T10:30" },
  ];
  const dueDates = new Map([["due", "2026-11-16"]]);
  const noticesAt = (at) => dueTaskNotices({ tasks, dueDates, dueTimes: ["09:00"], now: at });
  // 更新の直後: きのうの夜の時刻と今朝の期限が残っているが、まとめて鳴らさない。
  const first = unfiredNotices({}, noticesAt(now), now);
  assert.deepEqual(first.fresh, []);
  assert.equal(first.started, true);
  assert.deepEqual(Object.keys(first.fired).sort(), [
    "due:due:2026-11-16T09:00",
    "started",
    "time:timed:2026-11-15T20:00",
  ]);
  // その後に来る時刻は、ふつうに知らせる。
  const later = local(2026, 11, 16, 10, 30);
  const second = unfiredNotices(first.fired, noticesAt(later), later);
  assert.equal(second.started, false);
  assert.deepEqual(
    second.fresh.map((notice) => notice.key),
    ["time:later:2026-11-16T10:30"],
  );
  // 印は古くなっても落とさない（落とすと、また「最初の回」になって知らせを飲み込む）。
  const nextWeek = local(2026, 11, 23, 9, 0);
  assert.equal(pruneFiredNotices(first.fired, nextWeek).started, "2026-11-16");
  assert.equal(unfiredNotices(first.fired, [], nextWeek).started, false);
});

test("#785 期限の時刻の N 分前に知らせ、逃した分は 24 時間まで出し、日付・時刻・分を変えるともう一度知らせる", async () => {
  const { endNoticeTitle, dueNoticeLine } = await import("../src/shared/taskNotifications.ts");
  const tasks = [{ id: "kabu", title: "株の申込み", state: "todo" }];
  const end = (overrides = {}) =>
    new Map([
      ["kabu", { date: "2026-11-19", time: "02:00", notifyBeforeMinutes: 30, ...overrides }],
    ]);
  const endKeys = (dueDates, now) =>
    dueTaskNotices({ tasks, dueDates, dueTimes: ["09:00"], now })
      .filter((notice) => notice.kind === "end")
      .map((notice) => notice.key);
  // 30 分前（日をまたいで前の日の 01:30 ではなく、当日 01:30）。
  assert.deepEqual(endKeys(end(), local(2026, 11, 19, 1, 29)), []);
  assert.deepEqual(endKeys(end(), local(2026, 11, 19, 1, 30)), ["end:kabu:2026-11-19T02:00:30"]);
  // 逃した分は 24 時間まで。
  assert.deepEqual(endKeys(end(), local(2026, 11, 20, 1, 29)), ["end:kabu:2026-11-19T02:00:30"]);
  assert.deepEqual(endKeys(end(), local(2026, 11, 20, 1, 30)), []);
  // 日をまたぐ前の知らせ（1日前）と、ちょうど（0）。
  assert.deepEqual(endKeys(end({ notifyBeforeMinutes: 1440 }), local(2026, 11, 18, 2, 0)), [
    "end:kabu:2026-11-19T02:00:1440",
  ]);
  assert.deepEqual(endKeys(end({ notifyBeforeMinutes: 0 }), local(2026, 11, 19, 2, 0)), [
    "end:kabu:2026-11-19T02:00:0",
  ]);
  // 知らせの無い時刻・時刻の無い期限は end を出さない。
  assert.deepEqual(endKeys(end({ notifyBeforeMinutes: null }), local(2026, 11, 19, 1, 45)), []);
  assert.deepEqual(endKeys(end({ time: null }), local(2026, 11, 19, 1, 45)), []);
  // 変えると鍵が変わる（もう一度知らせる）。
  assert.notDeepEqual(
    endKeys(end({ time: "01:50" }), local(2026, 11, 19, 1, 45)),
    endKeys(end(), local(2026, 11, 19, 1, 45)),
  );
  // 見出しは出す時の時刻で決め、本文の先頭に時刻を付ける。
  const notice = { endAt: "2026-11-19T02:00", title: "株の申込み" };
  assert.equal(endNoticeTitle(notice, local(2026, 11, 19, 1, 30)), "あと30分で期限");
  assert.equal(endNoticeTitle(notice, local(2026, 11, 19, 1, 59)), "まもなく期限");
  assert.equal(endNoticeTitle(notice, local(2026, 11, 19, 2, 0)), "期限を過ぎました");
  assert.equal(endNoticeTitle(notice, local(2026, 11, 19, 1, 0)), "あと1時間で期限");
  assert.equal(endNoticeTitle(notice, local(2026, 11, 18, 2, 0)), "あと1日で期限");
  assert.equal(dueNoticeLine(notice), "02:00 株の申込み");
  assert.equal(dueNoticeLine({ title: "書類を出す" }), "書類を出す");
});

test("#785 期限の日の知らせ: 時刻が決まった時刻より後なら当日、そうでなければ前の日に「明日が期限」で出す", () => {
  const tasks = [{ id: "a", title: "提出", state: "todo" }];
  const dues = (time, now, dueTimes = ["09:00"]) =>
    dueTaskNotices({
      tasks,
      dueDates: new Map([["a", { date: "2026-11-19", time, notifyBeforeMinutes: null }]]),
      dueTimes,
      now,
    })
      .filter((notice) => notice.kind === "due")
      .map((notice) => [notice.key, notice.dueDay]);
  // 23:59 の期限: 当日 09:00。
  assert.deepEqual(dues("23:59", local(2026, 11, 19, 9, 0)), [["due:a:2026-11-19T09:00", "today"]]);
  assert.deepEqual(dues("23:59", local(2026, 11, 18, 9, 0)), []);
  // 02:00 の期限: 前の日の 09:00 に「明日が期限」。当日 09:00（過ぎた後）には出さない。
  assert.deepEqual(dues("02:00", local(2026, 11, 18, 9, 0)), [
    ["due:a:2026-11-18T09:00", "tomorrow"],
  ]);
  assert.deepEqual(dues("02:00", local(2026, 11, 19, 9, 0)), []);
  // ちょうど同じ時刻も前の日（時刻ちょうどに「今日が期限」は遅い）。
  assert.deepEqual(dues("09:00", local(2026, 11, 18, 9, 0)), [
    ["due:a:2026-11-18T09:00", "tomorrow"],
  ]);
  // 2 回目の時刻は、それぞれで決める。
  assert.deepEqual(dues("12:00", local(2026, 11, 19, 18, 0), ["09:00", "17:00"]), [
    ["due:a:2026-11-19T09:00", "today"],
  ]);
  assert.deepEqual(dues("12:00", local(2026, 11, 18, 18, 0), ["09:00", "17:00"]), [
    ["due:a:2026-11-18T17:00", "tomorrow"],
  ]);
  // 時刻の無い期限は今までどおり（文字列の日付を渡しても、時刻なしの組を渡しても同じ）。
  assert.deepEqual(dues(null, local(2026, 11, 19, 9, 0)), [["due:a:2026-11-19T09:00", "today"]]);
  assert.deepEqual(
    dueTaskNotices({
      tasks,
      dueDates: new Map([["a", "2026-11-19"]]),
      dueTimes: ["09:00"],
      now: local(2026, 11, 19, 9, 0),
    }).map((notice) => notice.key),
    ["due:a:2026-11-19T09:00"],
  );
});

test("#785 Gateway はヘッダが無ければ日程の時刻を出さず、あれば付け・知らせの変更・外しが保存と要約に出て、古い形の日付だけの変更は時刻を残す", async () => {
  const fixture = await createMobileOfflineGateway();
  try {
    const { origin, accessToken, deviceId } = fixture.config;
    let sequence = 0;
    const send = async (command, optIn = true) => {
      const id = `end-time-${++sequence}`;
      const response = await fetch(`${origin}/v1/commands`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          ...(optIn ? { "X-Tasken-Schedule-Time": "1" } : {}),
        },
        body: JSON.stringify({
          apiVersion: 1,
          schemaVersion: 7,
          requestId: id,
          commandId: id,
          idempotencyKey: id,
          clientDeviceId: deviceId,
          issuedAt: "2026-11-18T00:00:00Z",
          command,
        }),
      });
      return { status: response.status, body: await response.json() };
    };
    const read = async (optIn) => {
      const query = new URLSearchParams({
        apiVersion: "1",
        schemaVersion: "7",
        requestId: "end-time-read",
        date: "2026-11-18",
        limit: "50",
      });
      const response = await fetch(`${origin}/v1/today?${query}`, {
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(optIn ? { "X-Tasken-Schedule-Time": "1" } : {}),
        },
      });
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      return body.data.items.find((item) => item.id === "end-time-task");
    };
    const stored = () => fixture.snapshot().schedules.find((s) => s.owner_id === "end-time-task");
    const dates = (endDate) => ({ startDate: null, endDate, rangeSemantics: null });

    const created = await send({
      name: "CreateTask",
      task: {
        id: "end-time-task",
        title: "株の申込み",
        projectId: "theme-personal-default",
        state: "todo",
        priority: "normal",
        requester: "self",
        intendedExecutor: "self",
        todayDate: "2026-11-18",
      },
      schedule: dates("2026-11-19"),
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const without = await read(false);
    assert.equal(Object.hasOwn(without.schedule, "endTime"), false);
    assert.equal(Object.hasOwn(without.schedule, "notifyBeforeMinutes"), false);
    const withHeader = await read(true);
    assert.equal(withHeader.schedule.endTime, null);
    assert.equal(withHeader.schedule.notifyBeforeMinutes, null);

    // 付ける（base は時刻の無い形でもよい）。
    const set = await send({
      name: "UpdateTask",
      taskId: "end-time-task",
      expectedVersion: withHeader.version,
      expectedScheduleVersion: withHeader.schedule.version,
      changes: { schedule: { ...dates("2026-11-19"), endTime: "02:00", notifyBeforeMinutes: 30 } },
      base: { schedule: dates("2026-11-19") },
    });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.equal(set.body.data.task.schedule.endTime, "02:00");
    assert.equal(set.body.data.task.schedule.notifyBeforeMinutes, 30);
    assert.equal(stored().end_time, "02:00");
    assert.equal(stored().notify_before_minutes, 30);
    assert.equal(mobileTaskSummarySchema.safeParse(set.body.data.task).success, true);

    // 欄を知らない古い APK の日付だけの変更（ヘッダも無い）は、時刻と知らせを残す。
    let current = await read(true);
    const moved = await send(
      {
        name: "UpdateTask",
        taskId: "end-time-task",
        expectedVersion: current.version,
        expectedScheduleVersion: current.schedule.version,
        changes: { schedule: dates("2026-11-20") },
        base: { schedule: dates("2026-11-19") },
      },
      false,
    );
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(Object.hasOwn(moved.body.data.task.schedule, "endTime"), false);
    assert.equal(stored().end_date, "2026-11-20");
    assert.equal(stored().end_time, "02:00");
    assert.equal(stored().notify_before_minutes, 30);

    // 知らせだけ変える。
    current = await read(true);
    const lead = await send({
      name: "UpdateTask",
      taskId: "end-time-task",
      expectedVersion: current.version,
      expectedScheduleVersion: current.schedule.version,
      changes: {
        schedule: { ...dates("2026-11-20"), endTime: "02:00", notifyBeforeMinutes: 1440 },
      },
      base: { schedule: { ...dates("2026-11-20"), endTime: "02:00", notifyBeforeMinutes: 30 } },
    });
    assert.equal(lead.status, 200, JSON.stringify(lead.body));
    assert.equal(stored().notify_before_minutes, 1440);

    // 外す。
    current = await read(true);
    const cleared = await send({
      name: "UpdateTask",
      taskId: "end-time-task",
      expectedVersion: current.version,
      expectedScheduleVersion: current.schedule.version,
      changes: { schedule: { ...dates("2026-11-20"), endTime: null, notifyBeforeMinutes: null } },
      base: { schedule: { ...dates("2026-11-20"), endTime: "02:00", notifyBeforeMinutes: 1440 } },
    });
    assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
    assert.equal((await read(true)).schedule.endTime, null);
    assert.equal(stored().end_time, null);
    assert.equal(stored().notify_before_minutes, null);

    // 時刻を外して知らせだけ、は入口で断る（Core に届かない）。
    current = await read(true);
    const broken = await send({
      name: "UpdateTask",
      taskId: "end-time-task",
      expectedVersion: current.version,
      expectedScheduleVersion: current.schedule.version,
      changes: { schedule: { ...dates("2026-11-20"), endTime: null, notifyBeforeMinutes: 30 } },
      base: { schedule: dates("2026-11-20") },
    });
    assert.notEqual(broken.status, 200);

    // golden の要約の欄の形は、実際の応答と同じ。
    const golden = JSON.parse(
      readFileSync(
        new URL("../contracts/mobile/v1/task-schedule-end-time.golden.json", import.meta.url),
        "utf8",
      ),
    );
    assert.deepEqual(
      Object.keys(set.body.data.task.schedule).sort(),
      Object.keys(golden.taskSummaryWithTime.schedule).sort(),
    );
  } finally {
    await fixture.close();
  }
});

test("#785 golden の要約と更新の例は schema に合い、時刻だけの知らせは断る", () => {
  const golden = JSON.parse(
    readFileSync(
      new URL("../contracts/mobile/v1/task-schedule-end-time.golden.json", import.meta.url),
      "utf8",
    ),
  );
  for (const key of [
    "updateTaskSetTime",
    "updateTaskChangeLead",
    "updateTaskClearTime",
    "updateTaskOldShapeDateOnly",
  ])
    assert.equal(mobileTaskCommandRequestSchema.safeParse(golden[key]).success, true, key);
  for (const key of ["taskSummaryWithTime", "taskSummaryWithoutTime"])
    assert.equal(mobileTaskSummarySchema.safeParse(golden[key]).success, true, key);
  const withBadLead = structuredClone(golden.updateTaskSetTime);
  withBadLead.command.changes.schedule.endTime = null;
  assert.equal(mobileTaskCommandRequestSchema.safeParse(withBadLead).success, false);
  const withBadTime = structuredClone(golden.updateTaskSetTime);
  withBadTime.command.changes.schedule.endTime = "24:00";
  assert.equal(mobileTaskCommandRequestSchema.safeParse(withBadTime).success, false);
});
