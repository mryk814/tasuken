import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import { SharedFolderSyncService } from "../src/main/services/sharedFolderSync.mjs";

// 待ちを Task に写す（#755 束7）。起動のたびに確かめ、まだ写していない待ちだけを写す。
// 元の待ちは残し、写した Task を消せば作り直さない。複数の PC が独立に写しても同期で 1 件。

async function loadModule(entry) {
  const output = await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`
  );
}

const { runWaitingConversionOnce, planWaitingConversion, waitingTaskId, waitingScheduleId } =
  await loadModule("src/main/services/waitingRetirement.ts");
const { runWaitingRetirementExportOnce } = await loadModule(
  "src/main/services/waitingRetirementExport.ts",
);

const openDatabases = new Map();

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-waiting-retirement-"));
  openDatabases.set(root, []);
  t.after(() => {
    // Windows では開いたままの DB は消せないので、先に閉じる。
    for (const database of openDatabases.get(root)) if (database.db.open) database.db.close();
    openDatabases.delete(root);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function openDatabase(t, root, name = "first") {
  const database = new WorkspaceDatabase(path.join(root, name, "tasken.sqlite"));
  openDatabases.get(root).push(database);
  return database;
}

function waiting(id, overrides = {}) {
  return {
    id,
    title: "試料の測定結果",
    description: "条件Bの分",
    waiting_for: "分析チーム",
    next_action: "届いたらグラフにする",
    check_reminder_at: "2026-11-20T10:00",
    state: "waiting",
    created_at: "2026-10-01T09:00:00.000Z",
    ...overrides,
  };
}

function seed(database) {
  database.save("theme", { id: "theme-1", name: "材料の評価", code: "MAT" });
  database.save("task", {
    id: "task-parent",
    title: "条件Bの評価",
    state: "doing",
    priority: "normal",
    project_id: "theme-1",
  });
  database.save("waiting", waiting("waiting-1", { project_id: "theme-1", task_id: "task-parent" }));
  database.save("schedule", {
    id: "schedule-1",
    owner_type: "waiting",
    owner_id: "waiting-1",
    end_date: "2026-11-25",
    date_kind: "deadline",
    confidence: "fixed",
    granularity: "day",
  });
  database.save(
    "waiting",
    waiting("waiting-received", {
      title: "見積もり",
      state: "received",
      check_reminder_at: null,
      next_action: "",
      created_at: "2026-10-02T09:00:00.000Z",
    }),
  );
  database.save(
    "waiting",
    waiting("waiting-cancelled", {
      title: "取りやめた依頼",
      state: "cancelled",
      created_at: "2026-10-03T09:00:00.000Z",
    }),
  );
}

function backupSpy(result = true) {
  const calls = [];
  return {
    calls,
    backup: async () => {
      calls.push("backup");
      return result;
    },
  };
}

function snapshot(database, type, id) {
  return JSON.stringify(database.get(type, id, true));
}

test("待ちを 1 件ずつ Task に写し、日程は Task の期限として写す。元の待ちと日程は変えない", async (t) => {
  const database = openDatabase(t, tempRoot(t));
  seed(database);
  const before = {
    waiting: snapshot(database, "waiting", "waiting-1"),
    schedule: snapshot(database, "schedule", "schedule-1"),
  };
  const spy = backupSpy();
  const writes = [];
  const repository = {
    list: (...args) => database.list(...args),
    get: (...args) => database.get(...args),
    writeDerivedRecords: (records) => {
      writes.push(spy.calls.length);
      return database.writeDerivedRecords(records);
    },
  };

  const result = await runWaitingConversionOnce({ repository, backup: spy.backup });

  assert.deepEqual(result, { state: "done", waitings: 3, tasks: 3, schedules: 1, failed: 0 });
  // 控えは写す前に 1 度だけ。
  assert.deepEqual(spy.calls, ["backup"]);
  assert.ok(writes.every((count) => count === 1));

  const task = database.get("task", waitingTaskId("waiting-1"));
  assert.equal(task.title, "試料の測定結果");
  assert.equal(task.state, "waiting");
  assert.equal(
    task.description,
    "条件Bの分\n\n待っている相手: 分析チーム\n次にすること: 届いたらグラフにする",
  );
  assert.equal(task.project_id, "theme-1");
  assert.equal(task.parent_task_id, "task-parent");
  assert.equal(task.reminder_at, "2026-11-20T10:00");
  assert.equal(task.source, "waiting");
  assert.equal(task.created_at, "2026-10-01T09:00:00.000Z");
  assert.equal(task.version, 1);

  const schedule = database.get("schedule", waitingScheduleId("schedule-1"));
  assert.equal(schedule.owner_type, "task");
  assert.equal(schedule.owner_id, task.id);
  assert.equal(schedule.end_date, "2026-11-25");
  assert.equal(schedule.date_kind, "deadline");

  const received = database.get("task", waitingTaskId("waiting-received"));
  assert.equal(received.state, "done");
  assert.ok(received.completed_at);
  assert.equal(received.reminder_at, null);
  assert.equal(received.description, "条件Bの分\n\n待っている相手: 分析チーム");
  assert.equal(database.get("task", waitingTaskId("waiting-cancelled")).state, "cancelled");

  // 元の待ちと日程はそのまま残る（読むだけ）。
  assert.equal(snapshot(database, "waiting", "waiting-1"), before.waiting);
  assert.equal(snapshot(database, "schedule", "schedule-1"), before.schedule);
});

test("二度目の起動では写さず、控えも取らない。写した Task を消した後も作り直さない", async (t) => {
  const database = openDatabase(t, tempRoot(t));
  seed(database);
  await runWaitingConversionOnce({ repository: database, backup: backupSpy().backup });
  const taskCount = database.list("task", true).length;

  const second = backupSpy();
  assert.deepEqual(
    await runWaitingConversionOnce({ repository: database, backup: second.backup }),
    {
      state: "nothing",
    },
  );
  assert.deepEqual(second.calls, []);
  assert.equal(database.list("task", true).length, taskCount);

  // 本人が写した Task を消すと、消したまま残り、元の待ちは残る。
  database.remove("task", waitingTaskId("waiting-1"));
  const third = backupSpy();
  assert.deepEqual(await runWaitingConversionOnce({ repository: database, backup: third.backup }), {
    state: "nothing",
  });
  assert.deepEqual(third.calls, []);
  assert.ok(database.get("task", waitingTaskId("waiting-1"), true).deleted_at);
  assert.ok(database.get("waiting", "waiting-1"));
});

test("控えが取れなければ写さず、次の起動でやり直す", async (t) => {
  const database = openDatabase(t, tempRoot(t));
  seed(database);
  const failing = backupSpy(false);
  assert.deepEqual(
    await runWaitingConversionOnce({ repository: database, backup: failing.backup }),
    {
      state: "backup_failed",
      pending: 3,
    },
  );
  assert.equal(database.get("task", waitingTaskId("waiting-1"), true), null);

  const thrown = await runWaitingConversionOnce({
    repository: database,
    backup: async () => {
      throw new Error("disk full");
    },
  });
  assert.equal(thrown.state, "backup_failed");
  assert.equal(database.get("task", waitingTaskId("waiting-1"), true), null);

  const ok = await runWaitingConversionOnce({ repository: database, backup: backupSpy().backup });
  assert.equal(ok.state, "done");
  assert.ok(database.get("task", waitingTaskId("waiting-1")));
});

test("待ちが無ければ何もしない。削除した待ちは写さない", async (t) => {
  const database = openDatabase(t, tempRoot(t));
  const empty = backupSpy();
  assert.deepEqual(await runWaitingConversionOnce({ repository: database, backup: empty.backup }), {
    state: "nothing",
  });
  assert.deepEqual(empty.calls, []);

  database.save("waiting", waiting("waiting-gone"));
  database.remove("waiting", "waiting-gone");
  assert.deepEqual(planWaitingConversion(database), []);
});

test("後から届いた待ちと、写した Task に後から届いた日程は、次の起動で写す", async (t) => {
  const database = openDatabase(t, tempRoot(t));
  seed(database);
  await runWaitingConversionOnce({ repository: database, backup: backupSpy().backup });

  database.save("waiting", waiting("waiting-late", { title: "古いスマホからの待ち" }));
  database.save("schedule", {
    id: "schedule-late",
    owner_type: "waiting",
    owner_id: "waiting-received",
    start_date: "2026-12-01",
    date_kind: "point",
    confidence: "rough",
    granularity: "day",
  });
  const result = await runWaitingConversionOnce({
    repository: database,
    backup: backupSpy().backup,
  });
  assert.deepEqual(result, { state: "done", waitings: 2, tasks: 1, schedules: 1, failed: 0 });
  assert.equal(database.get("task", waitingTaskId("waiting-late")).title, "古いスマホからの待ち");
  assert.equal(
    database.get("schedule", waitingScheduleId("schedule-late")).owner_id,
    waitingTaskId("waiting-received"),
  );
});

test("消した Theme と Task は指さずに写す", async (t) => {
  const database = openDatabase(t, tempRoot(t));
  seed(database);
  database.remove("task", "task-parent");
  database.save("theme", { id: "theme-gone", name: "消すテーマ", code: "GONE" });
  database.save("waiting", waiting("waiting-orphan", { project_id: "theme-gone" }));
  database.remove("theme", "theme-gone");
  // Theme を消すと待ちの Theme は外れる（delete policy）。外れていない古い形の値でも写せる。
  const result = await runWaitingConversionOnce({
    repository: database,
    backup: backupSpy().backup,
  });
  assert.equal(result.state, "done");
  assert.equal(result.failed, 0);
  assert.equal(database.get("task", waitingTaskId("waiting-1")).parent_task_id, null);
  assert.equal(database.get("task", waitingTaskId("waiting-orphan")).project_id, null);
});

function createDevices(t, count) {
  const root = tempRoot(t);
  const shared = path.join(root, "shared");
  return {
    shared,
    devices: Array.from({ length: count }, (_, index) => {
      const name = `device-${index}`;
      const database = openDatabase(t, root, name);
      const sync = new SharedFolderSyncService(
        database,
        () => {},
        path.join(root, name, "attachments", "markdown-images"),
        path.join(root, name, "attachments", "capture-images"),
      );
      return { database, sync };
    }),
  };
}

async function syncAll(devices, rounds = 2) {
  for (let round = 0; round < rounds; round += 1)
    for (const device of devices) await device.sync.syncNow();
}

test("2 台が独立に写しても、同期で 1 件に収まり、競合にならない", async (t) => {
  const { shared, devices } = createDevices(t, 2);
  const [first, second] = devices;
  seed(first.database);
  await first.sync.configure(shared);
  await second.sync.configure(shared);
  assert.ok(second.database.get("waiting", "waiting-1"));

  // 同期の前に、両方が同じ待ちを写す。
  await runWaitingConversionOnce({ repository: first.database, backup: backupSpy().backup });
  await runWaitingConversionOnce({ repository: second.database, backup: backupSpy().backup });
  await syncAll(devices);

  for (const { database } of devices) {
    assert.equal(database.syncConflictCount(), 0);
    const converted = database.list("task", true).filter((task) => task.source === "waiting");
    assert.equal(converted.length, 3);
    assert.equal(
      database.list("schedule", true).filter((schedule) => schedule.owner_type === "task").length,
      1,
    );
  }

  // その後の編集は相手に届く。
  const taskId = waitingTaskId("waiting-1");
  second.database.save("task", { ...second.database.get("task", taskId), state: "done" });
  await syncAll(devices);
  assert.equal(first.database.get("task", taskId).state, "done");
  assert.equal(first.database.syncConflictCount(), 0);
});

test("写した Task を編集した後に、別の端末の写しが届いても競合にならない（3 台）", async (t) => {
  const { shared, devices } = createDevices(t, 3);
  const [first, second, third] = devices;
  seed(first.database);
  await first.sync.configure(shared);
  await second.sync.configure(shared);
  await third.sync.configure(shared);

  const taskId = waitingTaskId("waiting-1");
  // first が写して題を直し、それが third に届く。second は同期の前に独立に写す。
  await runWaitingConversionOnce({ repository: first.database, backup: backupSpy().backup });
  first.database.save("task", { ...first.database.get("task", taskId), title: "直した題" });
  await first.sync.syncNow();
  await third.sync.syncNow();
  assert.equal(third.database.get("task", taskId).title, "直した題");
  await runWaitingConversionOnce({ repository: second.database, backup: backupSpy().backup });
  await syncAll(devices, 3);

  for (const { database } of devices) {
    assert.equal(database.syncConflictCount(), 0);
    assert.equal(database.get("task", taskId).title, "直した題");
    assert.equal(database.list("task", true).filter((task) => task.id === taskId).length, 1);
  }
});

test("写した Task を消した後に、別の端末の写しが届いても生き返らない", async (t) => {
  const { shared, devices } = createDevices(t, 2);
  const [first, second] = devices;
  seed(first.database);
  await first.sync.configure(shared);
  await second.sync.configure(shared);

  const taskId = waitingTaskId("waiting-1");
  await runWaitingConversionOnce({ repository: first.database, backup: backupSpy().backup });
  first.database.remove("task", taskId);
  await runWaitingConversionOnce({ repository: second.database, backup: backupSpy().backup });
  await syncAll(devices);

  for (const { database } of devices) {
    assert.equal(database.syncConflictCount(), 0);
    assert.ok(database.get("task", taskId, true).deleted_at);
    assert.ok(database.get("waiting", "waiting-1"));
  }
  // 次の起動でも作り直さない。
  for (const { database } of devices)
    assert.equal(
      (await runWaitingConversionOnce({ repository: database, backup: backupSpy().backup })).state,
      "nothing",
    );
});

test("待ちを 1 つの Markdown にして userData と同期ルートへ書き、0 件なら書かない", async (t) => {
  const root = tempRoot(t);
  const database = openDatabase(t, root);
  const userData = path.join(root, "userData");
  const syncRoot = path.join(root, "sync");
  const exports = path.join(userData, "Exports", "retired", "waitings");
  const syncExports = path.join(syncRoot, "Exports", "retired", "waitings");
  const run = () =>
    runWaitingRetirementExportOnce({
      repository: database,
      userDataDirectory: userData,
      syncRoot,
      now: () => "2030-01-02T00:00:00.000Z",
    });

  assert.deepEqual(run(), { state: "nothing" });
  assert.equal(fs.existsSync(exports), false);

  seed(database);
  const result = run();
  assert.equal(result.state, "done");
  const markdown = fs.readFileSync(path.join(exports, "待ち.md"), "utf8");
  assert.equal(fs.readFileSync(path.join(syncExports, "待ち.md"), "utf8"), markdown);
  assert.match(markdown, /^# 待ち\n/u);
  assert.match(markdown, /- 件数: 3 件/u);
  assert.match(
    markdown,
    /## 試料の測定結果\n\n- 状態: 待ち\n- 待っている相手: 分析チーム\n- 次にすること: 届いたらグラフにする\n- 確認の時刻: 2026-11-20T10:00\n- 日程: 2026-11-25\n- Theme: 材料の評価（theme-1）\n- 関係する Task: 条件Bの評価（task-parent）\n/u,
  );
  assert.match(markdown, new RegExp(`- 写した Task の ID: ${waitingTaskId("waiting-1")}`, "u"));
  // 待ち、受領、中止の順。
  assert.ok(markdown.indexOf("## 試料の測定結果") < markdown.indexOf("## 見積もり"));
  assert.ok(markdown.indexOf("## 見積もり") < markdown.indexOf("## 取りやめた依頼"));
  // 書き出した時刻は中身に入れない。
  assert.doesNotMatch(markdown, /2030-01-02/u);

  // 変わっていなければ書き直さない。待ちが届けば書き出し直す（前のファイルは上書きしない）。
  assert.deepEqual(run(), { state: "already_done" });
  database.save(
    "waiting",
    waiting("waiting-late", { title: "後から届いた待ち", updated_at: "2026-11-17" }),
  );
  assert.equal(run().state, "done");
  assert.deepEqual(fs.readdirSync(exports).sort(), ["待ち (2).md", "待ち.md"]);
});

const { createTaskenCore } = await loadModule("src/main/infrastructure/sqlite/public.ts");

test("AI の読み取りは元の待ちを出さず、写した Task を出す。待ちの数は「待ち」の Task から数える", async (t) => {
  const database = openDatabase(t, tempRoot(t));
  seed(database);
  await runWaitingConversionOnce({ repository: database, backup: backupSpy().backup });
  const core = createTaskenCore(database);
  const taskId = waitingTaskId("waiting-1");

  const search = core.searchItems.execute({ query: "試料の測定結果", limit: 20 });
  assert.deepEqual(
    search.items.map((item) => item.id),
    [taskId],
  );
  const open = core.listOpenItems.execute({ limit: 100 }).items.map((item) => item.id);
  assert.ok(open.includes(taskId));
  assert.ok(open.every((id) => !id.startsWith("waiting-")));

  const plan = core.getPlanHealth.execute({ theme_id: "theme-1" });
  assert.equal(plan.open_waitings, 1);
  assert.deepEqual(
    plan.waiting_items.map((item) => item.id),
    [taskId],
  );

  const theme = core.getThemeContext.execute({ theme_id: "theme-1" });
  const openIds = theme.open_items.map((item) => item.id);
  assert.ok(openIds.includes(taskId));
  assert.equal(
    theme.open_items.some((item) => item.entity_type === "waiting"),
    false,
  );
});
