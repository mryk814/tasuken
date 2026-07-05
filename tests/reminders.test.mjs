import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const reminders = await importBundled("src/renderer/src/features/workspace/lib/reminders.ts");

function task(id, overrides = {}) {
  return {
    id,
    title: id,
    state: "todo",
    priority: "normal",
    reminder_at: "2026-07-05T08:30",
    ...overrides,
  };
}

function waiting(id, overrides = {}) {
  return {
    id,
    title: id,
    waiting_for: "相手",
    state: "waiting",
    check_reminder_at: "2026-07-05T08:45",
    ...overrides,
  };
}

test("reminder alerts include due tasks and waitings but skip completed states", () => {
  const alerts = reminders.buildReminderAlerts({
    tasks: [
      task("due-task"),
      task("future-task", { reminder_at: "2026-07-05T10:00" }),
      task("done-task", { state: "done" }),
      task("cancelled-task", { state: "cancelled" }),
    ],
    waitings: [
      waiting("due-waiting"),
      waiting("future-waiting", { check_reminder_at: "2026-07-05T10:00" }),
      waiting("received-waiting", { state: "received" }),
      waiting("cancelled-waiting", { state: "cancelled" }),
    ],
    settings: reminders.DEFAULT_REMINDER_SETTINGS,
    now: "2026-07-05T09:00",
    today: "2026-07-05",
  });

  assert.deepEqual(alerts.map((alert) => alert.id), ["task:due-task", "waiting:due-waiting"]);
});

test("daily operation reminders only include Activity Log and can be switched off", () => {
  const enabled = reminders.buildReminderAlerts({
    tasks: [],
    waitings: [],
    settings: {
      enabled: true,
      activity_log_time: "17:30",
    },
    now: "2026-07-05T18:00",
    today: "2026-07-05",
  });

  assert.deepEqual(enabled.map((alert) => alert.id), ["activity-log:2026-07-05"]);

  const disabled = reminders.buildReminderAlerts({
    tasks: [task("due-task")],
    waitings: [waiting("due-waiting")],
    settings: {
      enabled: false,
      activity_log_time: "17:30",
    },
    now: "2026-07-05T18:00",
    today: "2026-07-05",
  });

  assert.deepEqual(disabled, []);
});

test("reminder settings normalize persisted view data", () => {
  const record = {
    enabled: false,
    activity_log_time: "25:00",
  };

  assert.deepEqual(reminders.normalizeReminderSettings(record), {
    enabled: false,
    activity_log_time: "",
  });
});

test("task reminders stay on tasks and surface as lightweight row metadata", () => {
  const todaySource = readFileSync("src/renderer/src/features/workspace/pages/TodayPage.tsx", "utf8");
  const drawerSource = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");
  const appSource = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
  const reminderSource = readFileSync("src/renderer/src/features/workspace/lib/reminders.ts", "utf8");

  assert.doesNotMatch(todaySource, /buildReminderAlerts/);
  assert.match(todaySource, /reminderMeta/);
  assert.match(reminderSource, /daily-reminder-settings/);
  assert.doesNotMatch(todaySource, /リマインダー/);
  assert.match(drawerSource, /name="reminder_at"/);
  assert.match(drawerSource, /name="check_reminder_at"/);
  assert.match(appSource, /reminder_at: normalizeReminderDateTime\(formText\(values, "reminder_at"\)\)/);
  assert.match(appSource, /check_reminder_at: normalizeReminderDateTime\(formText\(values, "check_reminder_at"\)\)/);
});

test("due reminders are connected to native desktop notifications", () => {
  const mainSource = readFileSync("src/main/index.ts", "utf8");

  assert.match(mainSource, /Notification/);
  assert.match(mainSource, /REMINDER_CHECK_INTERVAL_MS/);
  assert.match(mainSource, /startReminderNotifications/);
  assert.match(mainSource, /showReminderNotification/);
  assert.match(mainSource, /workspaceRepository\.list\("task"\)/);
  assert.match(mainSource, /workspaceRepository\.list\("waiting"\)/);
  assert.match(mainSource, /new Notification\(/);
  assert.match(mainSource, /notification\.show\(\)/);
  assert.match(mainSource, /notifiedReminderIds/);
});
