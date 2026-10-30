import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

import { selectTodayTasks, TODAY_TASK_POLICY } from "../src/shared/todayTasks.mjs";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}

const localDate = await importBundled(
  "src/renderer/src/features/workspace/lib/currentLocalDate.ts",
);
const projection = await importBundled("src/renderer/src/features/workspace/lib/dailyPlanning.ts");

/** 時計・timer・前面復帰を手で動かせる環境。実時間を待たない。 */
function fakeEnvironment(start) {
  const env = {
    time: new Date(start),
    intervals: new Map(),
    wakeListeners: new Set(),
    nextHandle: 1,
    now: () => new Date(env.time),
    setInterval(callback, ms) {
      const handle = env.nextHandle++;
      env.intervals.set(handle, { callback, ms });
      return handle;
    },
    clearInterval(handle) {
      env.intervals.delete(handle);
    },
    subscribeWake(callback) {
      env.wakeListeners.add(callback);
      return () => env.wakeListeners.delete(callback);
    },
    tick() {
      for (const { callback } of [...env.intervals.values()]) callback();
    },
    wake() {
      for (const callback of [...env.wakeListeners]) callback();
    },
  };
  return env;
}

test("開きっぱなしで0時を跨ぐと、操作なしで翌日の日付を通知する（#685）", () => {
  const env = fakeEnvironment(new Date(2026, 9, 29, 23, 59));
  const store = localDate.createLocalDateStore(env);
  let notified = 0;
  const unsubscribe = store.subscribe(() => notified++);
  assert.equal(store.getSnapshot(), "2026-10-29");
  assert.equal([...env.intervals.values()][0].ms, localDate.LOCAL_DATE_CHECK_INTERVAL_MS);

  env.tick();
  assert.equal(notified, 0, "同じ日付のままなら再描画させない");

  env.time = new Date(2026, 9, 30, 0, 1);
  env.tick();
  assert.equal(store.getSnapshot(), "2026-10-30");
  assert.equal(notified, 1);

  env.tick();
  assert.equal(notified, 1, "日付が変わった後も同じ日付では通知しない");
  unsubscribe();
});

test("スリープ中にtimerが走らなくても、復帰・focusで当日へ揃える（#685）", () => {
  const env = fakeEnvironment(new Date(2026, 9, 29, 18, 0));
  const store = localDate.createLocalDateStore(env);
  let notified = 0;
  const unsubscribe = store.subscribe(() => notified++);

  // 一晩スリープ。intervalは一度も呼ばれず、翌朝の復帰（focus / visibilitychange）だけが届く。
  env.time = new Date(2026, 9, 30, 8, 30);
  env.wake();
  assert.equal(store.getSnapshot(), "2026-10-30");
  assert.equal(notified, 1);
  unsubscribe();
});

test("購読者が複数でもtimerは一つで、全員が外れたら止める（#685）", () => {
  const env = fakeEnvironment(new Date(2026, 9, 29, 12, 0));
  const store = localDate.createLocalDateStore(env);
  const first = store.subscribe(() => {});
  const second = store.subscribe(() => {});
  assert.equal(env.intervals.size, 1);
  assert.equal(env.wakeListeners.size, 1);
  first();
  assert.equal(env.intervals.size, 1);
  second();
  assert.equal(env.intervals.size, 0);
  assert.equal(env.wakeListeners.size, 0);

  // 購読がない間に日付が変わっても、次の購読時点の日付を返す。
  env.time = new Date(2026, 9, 31, 9, 0);
  assert.equal(store.getSnapshot(), "2026-10-31");
});

function domainFixture() {
  const tasks = [
    { id: "due-tomorrow", title: "明日締切", state: "todo", priority: "normal" },
    { id: "due-today", title: "今日締切", state: "todo", priority: "normal" },
    {
      id: "picked-today",
      title: "今日扱う",
      state: "todo",
      priority: "normal",
      today_date: "2026-10-29",
    },
    { id: "done-tomorrow", title: "完了済み", state: "done", priority: "normal" },
    {
      id: "ai-running",
      title: "AI作業中",
      state: "todo",
      priority: "normal",
      intended_executor: "ai_agent",
      work_state: "in_progress",
    },
  ];
  const schedule = (ownerId, endDate) => ({
    id: `schedule-${ownerId}`,
    owner_type: "task",
    owner_id: ownerId,
    end_date: endDate,
    date_kind: "deadline",
    confidence: "fixed",
    granularity: "day",
  });
  return {
    tasks,
    schedules: [
      schedule("due-tomorrow", "2026-10-30"),
      schedule("due-today", "2026-10-29"),
      schedule("done-tomorrow", "2026-10-30"),
      schedule("ai-running", "2026-10-30"),
    ],
    waitings: [],
    plan_nodes: [],
    capture_entrys: [],
  };
}

const taskIds = (rows) => rows.map((row) => row.v2?.task?.id ?? row.task?.id ?? row.id);

test("締切が今日になったTaskは、正本を変えずに今日やること・件数・候補棚へ揃って移る（#685）", () => {
  const domain = domainFixture();
  const before = JSON.stringify(domain);

  const evening = projection.buildTodayPageProjection(domain, "2026-10-29");
  assert.deepEqual(taskIds(evening.todayRows).sort(), ["due-today", "picked-today"]);
  assert.ok(taskIds(evening.dailyCandidates.thisWeek).includes("due-tomorrow"));
  assert.deepEqual(evening.progress, { done: 0, total: 2 });

  const morning = projection.buildTodayPageProjection(domain, "2026-10-30");
  assert.deepEqual(taskIds(morning.todayRows), ["due-tomorrow"]);
  assert.ok(!taskIds(morning.dailyCandidates.thisWeek).includes("due-tomorrow"));
  // 昨日締切の未完了は今日やることへ無条件に入れず、期限切れへ回す。
  assert.ok(taskIds(morning.overdue).includes("due-today"));
  assert.ok(taskIds(morning.dailyCandidates.overdue).includes("due-today"));
  // 昨日だけ扱うと決めたTaskは、翌日の今日やることに残さない。
  assert.ok(!taskIds(morning.todayRows).includes("picked-today"));
  assert.deepEqual(morning.progress, { done: 1, total: 3 });

  assert.equal(JSON.stringify(domain), before, "日付切替で today_date や Schedule を書き換えない");
});

test("本体Todayとミニウィンドウ・Sidebarは同じ選び方で同じTask集合になる（#685）", () => {
  const domain = domainFixture();
  for (const date of ["2026-10-29", "2026-10-30"]) {
    const page = projection.buildTodayPageProjection(domain, date);
    const mini = selectTodayTasks(domain.tasks, domain.schedules, date, TODAY_TASK_POLICY).map(
      (row) => row.task.id,
    );
    const pageTasks = taskIds(page.todayRows);
    // AI作業中のTaskだけは本体Todayの「今日やること」から外し、Feed側で追う既存仕様。
    assert.deepEqual(
      pageTasks,
      mini.filter((id) => id !== "ai-running"),
    );
    const progressIds = selectTodayTasks(domain.tasks, domain.schedules, date, {
      ...TODAY_TASK_POLICY,
      includeCompleted: true,
    }).length;
    assert.equal(page.progress.total, progressIds);
  }
});

test("TodayとSidebarは日付を購読し、一覧はDomainと日付が変わったときだけ作り直す（#684/#685）", () => {
  const todayPage = readFileSync("src/renderer/src/features/workspace/pages/TodayPage.tsx", "utf8");
  const shell = readFileSync("src/renderer/src/features/workspace/components/shell.tsx", "utf8");
  assert.doesNotMatch(todayPage, /todayIso\(/);
  assert.doesNotMatch(shell, /todayIso\(/);
  assert.match(todayPage, /const today = useCurrentLocalDate\(\);/);
  assert.match(shell, /const today = useCurrentLocalDate\(\);/);
  assert.match(
    todayPage,
    /useMemo\(\(\) => buildTodayPageProjection\(v2, today\), \[v2, today\]\)/,
  );
  // render中に全Taskを走査する旧計算を残さない。
  const pageBody = todayPage.slice(todayPage.indexOf("export function TodayPage("));
  assert.doesNotMatch(
    pageBody,
    /buildTodayView\(|buildDailyPlanningCandidates\(|todayTaskProgress\(/,
  );
  assert.match(
    shell,
    /useMemo\(\(\) => \{[\s\S]*todayTaskProgress\(domain, today\)[\s\S]*\}, \[domain, today\]\)/,
  );
});

test("Todayの保存操作は押した直後に処理中を示し、確定まで同じ行の再操作を止める（#684）", () => {
  const todayPage = readFileSync("src/renderer/src/features/workspace/pages/TodayPage.tsx", "utf8");
  assert.match(todayPage, /async function runPending\(id: string, action: \(\) => Promise<void>\)/);
  assert.match(todayPage, /if \(pendingRef\.current\.has\(id\)\) return;/);
  for (const handler of [
    "handleToggleComplete",
    "handleToggleChecklistItem",
    "handleChangeTodayDate",
    "handleToggleToday",
    "handleMoveCandidateTaskToday",
    "handleCompleteExecutionWindow",
    "handleFinishOngoingPeriod",
  ]) {
    assert.match(todayPage, new RegExp(`const ${handler} = \\([^)]*\\) =>\\s*runPending\\(`));
  }
  // 保存前に完了済みの見た目へ切り替えない。完了表示は保存後のDomainから決める。
  assert.match(
    todayPage,
    /todo-check-circle \$\{done \? "is-done" : ""\}\$\{pending \? " is-pending" : ""\}/,
  );
  assert.match(todayPage, /aria-busy=\{pending \|\| undefined\}/);
});
