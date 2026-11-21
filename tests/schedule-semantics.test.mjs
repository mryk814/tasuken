import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
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
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}

const semantics = await importBundled(
  "src/renderer/src/features/workspace/domain-model/scheduleSemantics.ts",
);
const selectors = await importBundled(
  "src/renderer/src/features/workspace/domain-model/selectors.ts",
);
const labels = await importBundled("src/renderer/src/features/workspace/domain-model/labels.ts");

const TODAY = "2026-08-06";

function schedule(overrides) {
  return {
    id: `sch-${overrides.owner_id}`,
    owner_type: "task",
    owner_id: overrides.owner_id,
    date_kind: "range",
    confidence: "fixed",
    granularity: "day",
    ...overrides,
  };
}

function domain(tasks, schedules) {
  return { tasks, schedules, waitings: [], plan_nodes: [], capture_entries: [], resources: [] };
}

function task(id, state = "todo") {
  return { id, title: id, state, priority: "normal" };
}

test("日付範囲の意味はstart/endの値からは推定せず、明示された値だけで決まる（#309）", () => {
  const range = { owner_id: "a", start_date: "2026-08-01", end_date: "2026-08-31" };
  // 同じ日付でも、意味を指定しなければ未分類のまま。勝手にongoing扱いしない。
  assert.equal(semantics.getScheduleKind(schedule(range)), "unspecified_range");
  assert.equal(
    semantics.getScheduleKind(schedule({ ...range, range_semantics: "once_within_window" })),
    "execution_window",
  );
  assert.equal(
    semantics.getScheduleKind(schedule({ ...range, range_semantics: "ongoing" })),
    "ongoing_period",
  );

  // 範囲でないものは point / deadline / none のまま。
  assert.equal(
    semantics.getScheduleKind(
      schedule({ owner_id: "b", start_date: "2026-08-20", end_date: "2026-08-20" }),
    ),
    "point",
  );
  assert.equal(
    semantics.getScheduleKind(schedule({ owner_id: "c", start_date: "2026-08-20" })),
    "point",
  );
  assert.equal(
    semantics.getScheduleKind(schedule({ owner_id: "d", end_date: "2026-08-20" })),
    "deadline",
  );
  assert.equal(semantics.getScheduleKind(schedule({ owner_id: "e" })), "none");
  assert.equal(semantics.getScheduleKind(undefined), "none");
});

test("新規の日付範囲の既定は期間内に一度で、ラベル対応表がある（#309）", () => {
  assert.equal(semantics.DEFAULT_RANGE_SEMANTICS, "once_within_window");
  assert.equal(labels.SCHEDULE_RANGE_SEMANTICS_LABELS.once_within_window, "期間内に一度");
  assert.equal(labels.SCHEDULE_RANGE_SEMANTICS_LABELS.ongoing, "期間中継続");
  for (const value of ["once_within_window", "ongoing"]) {
    assert.equal(typeof labels.SCHEDULE_RANGE_SEMANTICS_HINTS[value], "string");
  }
});

test("期間内に一度やるTaskは期間中毎日「今日やること」へ出さない（#309）", () => {
  const window = schedule({
    owner_id: "t1",
    start_date: "2026-08-01",
    end_date: "2026-08-10",
    range_semantics: "once_within_window",
  });
  const world = domain([task("t1")], [window]);

  // 期間の途中は今日やることへ出さず、候補セクションから拾う。
  assert.deepEqual(
    selectors.buildTodayView(world, TODAY).map((entry) => entry.task?.id),
    [],
  );
  const candidates = selectors.buildExecutionWindowTaskView(world, TODAY);
  assert.deepEqual(
    candidates.map((row) => row.task.id),
    ["t1"],
  );
  assert.equal(candidates[0].urgency, "in_window");
  assert.equal(candidates[0].daysRemaining, 4);

  // 終了日当日は見逃さないよう今日やることへ出す。
  assert.deepEqual(
    selectors.buildTodayView(world, "2026-08-10").map((entry) => entry.task.id),
    ["t1"],
  );
  assert.equal(selectors.buildExecutionWindowTaskView(world, "2026-08-10")[0].urgency, "due_today");
  // 終了間近と超過を区別できる。
  assert.equal(selectors.buildExecutionWindowTaskView(world, "2026-08-09")[0].urgency, "due_soon");
  assert.equal(selectors.buildExecutionWindowTaskView(world, "2026-08-12")[0].urgency, "overdue");
  // 開始日前はTodayへ出さない。
  assert.deepEqual(selectors.buildExecutionWindowTaskView(world, "2026-07-31"), []);
});

test("継続Taskは継続中セクションだけに出し、今日やることへ混ぜない（#309）", () => {
  const ongoing = schedule({
    owner_id: "t2",
    start_date: "2026-08-01",
    end_date: "2026-08-31",
    range_semantics: "ongoing",
  });
  const world = domain([task("t2")], [ongoing]);

  const rows = selectors.buildOngoingPeriodTaskView(world, TODAY);
  assert.deepEqual(
    rows.map((row) => row.task.id),
    ["t2"],
  );
  assert.equal(rows[0].dayIndex, 6);
  assert.equal(rows[0].totalDays, 31);
  assert.equal(rows[0].daysRemaining, 25);
  assert.equal(rows[0].unspecified, false);
  assert.equal(rows[0].pastEnd, false);

  // 期間内に一度やるTaskは継続中に混ざらない。
  const windowWorld = domain(
    [task("t3")],
    [
      schedule({
        owner_id: "t3",
        start_date: "2026-08-01",
        end_date: "2026-08-31",
        range_semantics: "once_within_window",
      }),
    ],
  );
  assert.deepEqual(selectors.buildOngoingPeriodTaskView(windowWorld, TODAY), []);

  // 終了予定日当日も、継続Taskは今日やることへ自動で出さない。
  assert.deepEqual(
    selectors.buildTodayView(world, "2026-08-31").map((entry) => entry.task.id),
    [],
  );
  assert.deepEqual(
    selectors.buildOngoingPeriodTaskView(world, "2026-08-31").map((row) => row.task.id),
    ["t2"],
  );
});

test("終了予定日を過ぎた継続Taskは自動完了せず、確認できるよう残る（#309）", () => {
  const ongoing = schedule({
    owner_id: "t4",
    start_date: "2026-08-01",
    end_date: "2026-08-05",
    range_semantics: "ongoing",
  });
  const rows = selectors.buildOngoingPeriodTaskView(domain([task("t4")], [ongoing]), TODAY);
  assert.deepEqual(
    rows.map((row) => row.task.id),
    ["t4"],
  );
  assert.equal(rows[0].pastEnd, true);
  assert.equal(semantics.isOngoingPeriodPastEnd(ongoing, TODAY), true);
  // 完了・中止したTaskは残さない。
  assert.deepEqual(
    selectors.buildOngoingPeriodTaskView(domain([task("t4", "done")], [ongoing]), TODAY),
    [],
  );
});

test("意味未設定の既存範囲Taskは黙って分類せず、既存の表示規則を保つ（#95 / #309）", () => {
  const legacy = schedule({ owner_id: "t5", start_date: "2026-08-01", end_date: "2026-08-31" });
  const world = domain([task("t5")], [legacy]);

  const rows = selectors.buildOngoingPeriodTaskView(world, TODAY);
  assert.deepEqual(
    rows.map((row) => row.task.id),
    ["t5"],
  );
  assert.equal(rows[0].unspecified, true, "未分類として区別できる");
  // 期間内に一度やるTaskの候補には勝手に入れない。
  assert.deepEqual(selectors.buildExecutionWindowTaskView(world, TODAY), []);
  // #95のとおり、終了日当日は今日やることへ出す。
  assert.deepEqual(
    selectors.buildTodayView(world, "2026-08-31").map((entry) => entry.task.id),
    ["t5"],
  );
});

test("着手可否・期限・超過の判定を一箇所へ集約する（#309）", () => {
  const window = schedule({
    owner_id: "w",
    start_date: "2026-08-01",
    end_date: "2026-08-10",
    range_semantics: "once_within_window",
  });
  assert.equal(semantics.isScheduleAvailableOn(window, "2026-07-31"), false);
  assert.equal(semantics.isScheduleAvailableOn(window, TODAY), true);
  assert.equal(semantics.isScheduleDueOn(window, TODAY), false);
  assert.equal(semantics.isScheduleDueOn(window, "2026-08-10"), true);
  assert.equal(semantics.isScheduleOverdueOn(window, "2026-08-11"), true);
  assert.equal(semantics.isScheduleOngoingOn(window, TODAY), false, "期間内に一度は継続中ではない");

  const ongoing = schedule({
    owner_id: "o",
    start_date: "2026-08-01",
    end_date: "2026-08-31",
    range_semantics: "ongoing",
  });
  assert.equal(semantics.isScheduleOngoingOn(ongoing, TODAY), true);
  assert.equal(semantics.isExecutionWindowOpenOn(ongoing, TODAY), false);
});

test("日付境界はローカル日付で判定する（#309）", () => {
  const source = selectors.buildTodayView.toString();
  assert.doesNotMatch(source, /toISOString/);
  assert.match(semantics.todayIso(), /^\d{4}-\d{2}-\d{2}$/);
});

// --- 永続化境界（Main側のvalidate / normalize） ---
const { normalizeEntity, validateEntity } = await import("../src/main/repositories/domain.mjs");

function scheduleEntity(overrides) {
  return {
    id: "sch-1",
    owner_type: "task",
    owner_id: "task-1",
    date_kind: "range",
    confidence: "fixed",
    granularity: "day",
    ...overrides,
  };
}

test("range_semanticsは範囲scheduleにだけ保存でき、未知の値を拒否する（#309）", () => {
  const range = { start_date: "2026-08-01", end_date: "2026-08-31" };
  for (const value of ["once_within_window", "ongoing"]) {
    assert.equal(
      normalizeEntity("schedule", scheduleEntity({ ...range, range_semantics: value }))
        .range_semantics,
      value,
    );
  }
  // 未設定は未分類のまま保存する。
  assert.equal(normalizeEntity("schedule", scheduleEntity(range)).range_semantics, null);
  // 内部コード以外は受け付けない。
  assert.throws(
    () => normalizeEntity("schedule", scheduleEntity({ ...range, range_semantics: "daily" })),
    /range_semantics/,
  );
  // 単日 / 期限だけのscheduleには範囲の意味を付けられない（Import等の直接検証で弾く）。
  assert.throws(
    () =>
      validateEntity(
        "schedule",
        scheduleEntity({
          start_date: "2026-08-01",
          end_date: "2026-08-01",
          range_semantics: "ongoing",
        }),
      ),
    /開始日と終了日が異なる範囲/,
  );
});

test("範囲でなくなったscheduleに古い意味を残さない（#309）", () => {
  // 8/10〜8/15 の「期間内に一度」を 8/12 単日へ直したら、意味は消える。
  const narrowed = normalizeEntity(
    "schedule",
    scheduleEntity({
      start_date: "2026-08-12",
      end_date: "2026-08-12",
      date_kind: "point",
      range_semantics: "once_within_window",
    }),
  );
  assert.equal(narrowed.range_semantics, null);
});

test("#785 scheduleEnd は期限の日と時刻と知らせを読み、日単位でない日程と時刻の無い知らせを無いものにする", async () => {
  const shared = await importBundled("src/shared/scheduleSemantics.mjs");
  assert.equal(shared.scheduleEnd(null), null);
  assert.equal(shared.scheduleEnd({ start_date: null, end_date: null }), null);
  // 開始日だけの一日も、その日の時刻を持てる。
  assert.deepEqual(
    shared.scheduleEnd({
      start_date: "2026-11-19",
      end_date: null,
      granularity: "day",
      end_time: "09:30",
      notify_before_minutes: 10,
    }),
    {
      date: "2026-11-19",
      time: "09:30",
      notifyBeforeMinutes: 10,
    },
  );
  // 期間は終了日の時刻。
  assert.equal(
    shared.scheduleEnd({
      start_date: "2026-11-17",
      end_date: "2026-11-19",
      granularity: "day",
      end_time: "18:00",
    }).date,
    "2026-11-19",
  );
  // 月単位の日程の時刻は無いものとして読む。
  assert.deepEqual(
    shared.scheduleEnd({
      start_date: null,
      end_date: "2026-11-30",
      granularity: "month",
      end_time: "09:00",
      notify_before_minutes: 30,
    }),
    {
      date: "2026-11-30",
      time: null,
      notifyBeforeMinutes: null,
    },
  );
  // 読めない時刻・時刻の無い知らせ・範囲外の分。
  assert.equal(
    shared.scheduleEnd({ end_date: "2026-11-19", granularity: "day", end_time: "25:99" }).time,
    null,
  );
  assert.equal(
    shared.scheduleEnd({
      end_date: "2026-11-19",
      granularity: "day",
      end_time: null,
      notify_before_minutes: 30,
    }).notifyBeforeMinutes,
    null,
  );
  assert.equal(
    shared.scheduleEnd({
      end_date: "2026-11-19",
      granularity: "day",
      end_time: "09:00",
      notify_before_minutes: 10081,
    }).notifyBeforeMinutes,
    null,
  );
  assert.equal(
    shared.scheduleEndTime({ end_date: "2026-11-19", granularity: "day", end_time: "09:00" }),
    "09:00",
  );
});

test("#785 isScheduleOverdueAt は期限の日のうちでも時刻を過ぎたら超過、時刻の無い日程は日付だけで決める", async () => {
  const shared = await importBundled("src/shared/scheduleSemantics.mjs");
  const timed = {
    start_date: null,
    end_date: "2026-11-19",
    date_kind: "deadline",
    granularity: "day",
    end_time: "23:59",
  };
  assert.equal(shared.isScheduleOverdueAt(timed, "2026-11-19T23:58"), false);
  assert.equal(shared.isScheduleOverdueAt(timed, "2026-11-19T23:59"), true, "その分から超過");
  assert.equal(shared.isScheduleOverdueAt(timed, "2026-11-18T23:59"), false);
  assert.equal(shared.isScheduleOverdueAt(timed, "2026-11-20T00:00"), true);
  const untimed = { ...timed, end_time: null };
  assert.equal(shared.isScheduleOverdueAt(untimed, "2026-11-19T23:59"), false);
  assert.equal(shared.isScheduleOverdueAt(untimed, "2026-11-20T00:00"), true);
  assert.equal(
    shared.isScheduleOverdueAt({ ...timed, granularity: "month" }, "2026-11-19T23:59"),
    false,
  );
  assert.equal(shared.isScheduleOverdueAt(null, "2026-11-19T23:59"), false);
});

test("#785 normalizeScheduleEndFields は日程の無い・日単位でない時刻と、時刻の無い知らせを外し、欄を足さない", async () => {
  const shared = await importBundled("src/shared/scheduleSemantics.mjs");
  const base = { start_date: null, end_date: "2026-11-19", granularity: "day" };
  assert.deepEqual(shared.normalizeScheduleEndFields(base), base, "欄の無い日程に欄を足さない");
  assert.deepEqual(
    shared.normalizeScheduleEndFields({
      ...base,
      end_date: null,
      end_time: "09:00",
      notify_before_minutes: 30,
    }),
    { ...base, end_date: null, end_time: null, notify_before_minutes: null },
  );
  assert.deepEqual(
    shared.normalizeScheduleEndFields({ ...base, granularity: "week", end_time: "09:00" }),
    { ...base, granularity: "week", end_time: null },
  );
  assert.deepEqual(
    shared.normalizeScheduleEndFields({ ...base, end_time: null, notify_before_minutes: 30 }),
    { ...base, end_time: null, notify_before_minutes: null },
  );
  // 読めない保存値は書き換えない（日程があれば残る）。
  assert.equal(shared.normalizeScheduleEndFields({ ...base, end_time: "25:99" }).end_time, "25:99");
});
