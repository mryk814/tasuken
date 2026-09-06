import assert from "node:assert/strict";
import test from "node:test";
import {
  proposal,
  batch,
  createQuickCaptureOrganizationFixture as fixture,
} from "./helpers/quick-capture-organization.mjs";

test("Desktop organization passes only current capture and canonical Theme candidates without saving", async () => {
  let input;
  const f = fixture(async (value) => {
    input = value;
    return batch;
  });
  const request = {
    text: "来週金曜までに比較実験を準備",
    capturedAt: "2026-09-05T12:00:00.000Z",
    timeZone: "Asia/Tokyo",
    themeId: "research",
  };
  assert.deepEqual(await f.call("organize", request), proposal);
  assert.deepEqual(input, {
    ...request,
    themes: [{ id: "research", title: "研究" }],
    maxTasks: 1,
    includePlannedTime: true,
  });
  assert.equal(f.commands.length, 0);
  assert.equal(f.saves.length, 0);
  await assert.rejects(f.handlers.get("quick-capture:organize")({ sender: { id: 99 } }, request));
});

test("Desktop confirmed proposal saves original text, supplement, checklist and deadline atomically", () => {
  const f = fixture();
  const original = "  前回は条件が違った。\n" + "比較実験を準備する。".repeat(80);
  f.call("save", original, "today-task", "research", undefined, proposal);
  assert.equal(f.commands.length, 1);
  assert.equal(f.saves.length, 0);
  assert.equal(f.notifications.length, 1);
  const { task, schedule } = f.commands[0].payload;
  assert.equal(task.title, proposal.title);
  assert.equal(task.description, `# 補足\n${proposal.supplement}\n\n# 元の入力\n${original}`);
  assert.deepEqual(
    task.checklist_items.map((item) => item.title),
    proposal.checklist,
  );
  assert.equal(task.today_date, null);
  assert.equal(schedule.start_date, null);
  assert.equal(schedule.end_date, proposal.endDate);
  assert.equal(schedule.date_kind, "deadline");
  assert.equal(schedule.owner_id, task.id);
  assert.throws(() => f.call("save", original, "inbox", undefined, undefined, proposal));
  assert.throws(() =>
    f.call("save", original, "today-task", undefined, undefined, {
      ...proposal,
      startDate: "2026-09-12",
    }),
  );
  assert.equal(f.commands.length, 1);
});

test("Desktop preview keeps transcript-wide date warnings", async () => {
  const f = fixture(async () => ({ tasks: [proposal], warnings: ["日付と曜日が一致しません"] }));
  const result = await f.call("organize", {
    text: "来週金曜まで",
    capturedAt: "2026-09-05T12:00:00.000Z",
    timeZone: "Asia/Tokyo",
    themeId: null,
  });
  assert.deepEqual(result.warnings, ["日付と曜日が一致しません"]);
});

test("Desktop plain Inbox stays a raw Capture and a dateless organized Task stays unscheduled", () => {
  const f = fixture();
  f.call("save", "メモをそのまま残す", "inbox");
  assert.equal(f.commands.length, 0);
  assert.equal(f.saves[0][0], "capture_entry");
  f.call("save", "いつか比較実験", "today-task", undefined, undefined, {
    ...proposal,
    endDate: null,
  });
  assert.equal(f.commands[0].payload.schedule, undefined);
  assert.equal(f.commands[0].payload.task.today_date, null);
});

test("Desktop confirmed planned time keeps execution time separate from the deadline and accepts duration alone", () => {
  const f = fixture();
  f.call("save", "金曜まで。明日16時から90分", "today-task", undefined, undefined, {
    ...proposal,
    startDate: "2026-09-07",
    plannedStartTime: "16:00",
    plannedDurationMinutes: 90,
  });
  assert.equal(f.commands[0].payload.task.planned_start_time, "16:00");
  assert.equal(f.commands[0].payload.task.planned_duration_minutes, 90);
  assert.equal(f.commands[0].payload.schedule.start_date, "2026-09-07");
  assert.equal(f.commands[0].payload.schedule.end_date, "2026-09-11");
  f.call("save", "作業は30分", "today-task", undefined, undefined, {
    ...proposal,
    endDate: null,
    plannedDurationMinutes: 30,
  });
  assert.equal(f.commands[1].payload.schedule, undefined);
  assert.equal(f.commands[1].payload.task.planned_start_time, null);
  assert.equal(f.commands[1].payload.task.planned_duration_minutes, 30);
  for (const changes of [
    { plannedStartTime: "24:00" },
    { plannedStartTime: "9:00" },
    { plannedDurationMinutes: 0 },
    { plannedDurationMinutes: 1.5 },
    { plannedDurationMinutes: 10081 },
    { plannedDurationMinutes: NaN },
  ])
    assert.throws(() =>
      f.call("save", "保持する原文", "today-task", undefined, undefined, {
        ...proposal,
        ...changes,
      }),
    );
  assert.equal(f.commands.length, 2);
});
