import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";

async function bundled(entry) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}
const {
  taskScheduleSnapshot,
  validateTaskScheduleProposal,
  buildTaskScheduleProposalCommand,
  taskScheduleProposalRequestSchema,
} = await bundled("src/shared/taskScheduleProposal.ts");
const { createCaptureOrganizerFromEnvironment } = await bundled(
  "src/main/gateway/mobile/captureOrganizer.ts",
);
const { ApplicationCommandService } = await bundled(
  "src/main/services/applicationCommandService.ts",
);
const { proposeTaskSchedule } = await bundled("src/main/services/taskScheduleProposal.ts");
const task = {
  id: "task-schedule-test",
  version: 1,
  title: "試験片の測定",
  project_id: "theme-personal-default",
  state: "todo",
  priority: "normal",
  description: "本文を保持",
  checklist_items: [{ id: "check-1", title: "温度記録", done: false, sort_order: 0 }],
  today_date: null,
  planned_start_time: "14:00",
  planned_duration_minutes: 60,
};
const schedule = {
  id: "schedule-test",
  version: 1,
  owner_type: "task",
  owner_id: task.id,
  start_date: "2026-09-11",
  end_date: "2026-09-18",
  range_semantics: null,
  date_kind: "range",
  confidence: "fixed",
  granularity: "day",
};
const current = taskScheduleSnapshot(task, schedule);
const request = {
  current,
  instruction: "時刻だけ15時に",
  inputAt: "2026-09-08T04:00:00Z",
  timeZone: "Asia/Tokyo",
};
const env = {
  TASKEN_CAPTURE_LLM_PROVIDER: "openai",
  TASKEN_CAPTURE_LLM_MODEL: "test-model",
  TASKEN_CAPTURE_LLM_API_KEY: "fake-key",
};
const fields = [
  "startDate",
  "endDate",
  "rangeSemantics",
  "todayDate",
  "plannedStartTime",
  "plannedDurationMinutes",
];
const wire = (patch, warnings = []) => ({
  changes: Object.fromEntries(
    fields.map((field) => [
      field,
      { change: Object.hasOwn(patch, field), value: patch[field] ?? null },
    ]),
  ),
  warnings,
});

test("canonical external_ai grants and versions gate transmission and returned proposals", async () => {
  let canonicalTask = { ...task, ai_visibility: [] };
  let theme = { id: task.project_id, default_ai_visibility: ["external_ai"] };
  let workspaceDefault = ["external_ai"];
  const repository = {
    get: (type) => (type === "task" ? canonicalTask : theme),
    list: () => [schedule],
    getPreference: () => workspaceDefault,
  };
  let calls = 0;
  const provider = async () => {
    calls++;
    return { patch: { plannedStartTime: "15:00" }, warnings: [] };
  };
  await assert.rejects(proposeTaskSchedule(repository, request, provider), /外部AI/);
  assert.equal(calls, 0);
  canonicalTask = { ...task, ai_visibility: null };
  theme = { ...theme, default_ai_visibility: [] };
  await assert.rejects(proposeTaskSchedule(repository, request, provider), /外部AI/);
  assert.equal(calls, 0);
  theme = { ...theme, default_ai_visibility: null };
  workspaceDefault = ["coding_agent"];
  await assert.rejects(proposeTaskSchedule(repository, request, provider), /外部AI/);
  assert.equal(calls, 0);
  canonicalTask = { ...task, ai_visibility: ["external_ai"] };
  assert.deepEqual(await proposeTaskSchedule(repository, request, provider), {
    patch: { plannedStartTime: "15:00" },
    warnings: [],
  });
  assert.equal(calls, 1);
  await assert.rejects(
    proposeTaskSchedule(
      repository,
      { ...request, current: { ...current, plannedStartTime: "01:00" } },
      provider,
    ),
    /更新/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    proposeTaskSchedule(repository, request, async () => {
      canonicalTask = { ...canonicalTask, ai_visibility: [] };
      return { patch: { plannedStartTime: "15:00" }, warnings: [] };
    }),
    /外部AI/,
  );
  canonicalTask = { ...task, ai_visibility: ["external_ai"] };
  await assert.rejects(
    proposeTaskSchedule(repository, request, async () => {
      canonicalTask = { ...canonicalTask, version: 2 };
      return { patch: { plannedStartTime: "15:00" }, warnings: [] };
    }),
    /更新/,
  );
});

test("fake provider returns only requested date/time/duration/clear patches and sends a bounded snapshot", async () => {
  for (const [instruction, patch, warnings] of [
    ["開始だけ9月14日に", { startDate: "2026-09-14" }, []],
    ["時刻だけ15時に", { plannedStartTime: "15:00" }, []],
    ["所要時間だけ30分", { plannedDurationMinutes: 30 }, []],
    ["予定時刻を解除", { plannedStartTime: null }, []],
    ["そのうち金曜かな", {}, ["日付が曖昧です。"]],
  ]) {
    let sent;
    const provider = createCaptureOrganizerFromEnvironment(env, async (_url, init) => {
      sent = JSON.parse(JSON.parse(init.body).messages[1].content);
      return new Response(
        JSON.stringify({
          choices: [
            { finish_reason: "stop", message: { content: JSON.stringify(wire(patch, warnings)) } },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      );
    });
    assert.deepEqual(await provider.proposeTaskSchedule({ ...request, instruction }), {
      patch,
      warnings,
    });
    const { calendarAnchors, ...sentRequest } = sent;
    assert.deepEqual(sentRequest, { ...request, instruction });
    assert.deepEqual(calendarAnchors[0], { date: "2026-09-08", weekday: "Tuesday" });
    assert.equal(JSON.stringify(sent).includes("本文を保持"), false);
  }
});

test("invalid provider fields, invalid dates, impossible periods, API failure and oversized input never yield an applicable patch", async () => {
  assert.throws(() =>
    validateTaskScheduleProposal({ patch: { state: "done" }, warnings: [] }, current),
  );
  assert.throws(() =>
    validateTaskScheduleProposal({ patch: { startDate: "2026-02-30" }, warnings: [] }, current),
  );
  assert.throws(() =>
    validateTaskScheduleProposal({ patch: { plannedStartTime: "25:00" }, warnings: [] }, current),
  );
  assert.throws(() =>
    taskScheduleProposalRequestSchema.parse({ ...request, instruction: "x".repeat(12001) }),
  );
  assert.throws(() => taskScheduleProposalRequestSchema.parse({ ...request, title: task.title }));
  assert.deepEqual(
    validateTaskScheduleProposal({ patch: { startDate: "2026-09-20" }, warnings: [] }, current)
      .patch,
    {},
  );
  const provider = createCaptureOrganizerFromEnvironment(env, async () => {
    throw new Error("fake secret must not surface");
  });
  await assert.rejects(provider.proposeTaskSchedule(request), /AIで整理できません/);
  assert.equal(request.instruction, "時刻だけ15時に");
});

test("confirmed schedule patches preserve other fields and replay safely after SQLite reopen", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tasken-schedule-proposal-"));
  const filename = path.join(dir, "workspace.sqlite");
  let db = new WorkspaceDatabase(filename);
  try {
    db.loadWorkspace();
    let service = new ApplicationCommandService(db);
    service.execute({
      commandId: "create-schedule-test",
      name: "CreateTask",
      actor: { kind: "user" },
      source: "main_ui",
      issuedAt: request.inputAt,
      payload: { task, schedule },
    });
    const initialTask = db.get("task", task.id);
    const initialSchedule = db.get("schedule", schedule.id);
    const proposal = {
      patch: { plannedStartTime: "15:00", plannedDurationMinutes: 30, startDate: "2026-09-14" },
      warnings: [],
    };
    const command = buildTaskScheduleProposalCommand(
      initialTask,
      initialSchedule,
      proposal,
      taskScheduleSnapshot(initialTask, initialSchedule),
      "apply-schedule-test",
      request.inputAt,
    );
    const receipt = service.execute(command);
    const saved = db.get("task", task.id);
    for (const key of [
      "title",
      "project_id",
      "checklist_items",
      "description",
      "state",
      "today_date",
    ])
      assert.deepEqual(saved[key], initialTask[key]);
    assert.equal(saved.planned_start_time, "15:00");
    assert.equal(saved.planned_duration_minutes, 30);
    assert.equal(db.get("schedule", schedule.id).start_date, "2026-09-14");
    assert.equal(db.get("schedule", schedule.id).end_date, initialSchedule.end_date);
    assert.deepEqual(service.execute(command), receipt);
    assert.equal(db.get("task", task.id).version, saved.version);
    db.db.close();
    db = new WorkspaceDatabase(filename);
    db.loadWorkspace();
    service = new ApplicationCommandService(db);
    assert.equal(db.get("task", task.id).planned_start_time, "15:00");
    assert.equal(db.get("schedule", schedule.id).start_date, "2026-09-14");
    assert.deepEqual(service.execute(command), receipt);
    assert.throws(
      () =>
        service.execute({
          ...command,
          payload: {
            ...command.payload,
            task: { ...command.payload.task, planned_start_time: "16:00" },
          },
        }),
      /同じcommandId|同じCommand|再利用|異なる/,
    );
  } finally {
    db.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Task edits, Schedule edits, and a newly created Schedule invalidate time-only proposals", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tasken-schedule-stale-"));
  const db = new WorkspaceDatabase(path.join(dir, "workspace.sqlite"));
  try {
    db.loadWorkspace();
    const service = new ApplicationCommandService(db);
    service.execute({
      commandId: "create-stale-test",
      name: "CreateTask",
      actor: { kind: "user" },
      source: "main_ui",
      issuedAt: request.inputAt,
      payload: { task, schedule },
    });
    const initialTask = db.get("task", task.id),
      initialSchedule = db.get("schedule", schedule.id);
    const make = (id) =>
      buildTaskScheduleProposalCommand(
        initialTask,
        initialSchedule,
        { patch: { plannedStartTime: "16:00" }, warnings: [] },
        taskScheduleSnapshot(initialTask, initialSchedule),
        id,
        request.inputAt,
      );
    const first = make("stale-schedule");
    db.save("schedule", { ...initialSchedule, end_date: "2026-09-19" });
    assert.throws(() => service.execute(first), /日程が更新/);
    assert.equal(db.get("task", task.id).planned_start_time, initialTask.planned_start_time);
    db.save("task", { ...initialTask, title: "別の編集" });
    assert.throws(() => service.execute(make("stale-task")), /更新済み/);
    const secondTask = { ...task, id: "no-schedule-task" };
    service.execute({
      commandId: "create-without-schedule",
      name: "CreateTask",
      actor: { kind: "user" },
      source: "main_ui",
      issuedAt: request.inputAt,
      payload: { task: secondTask },
    });
    const before = db.get("task", secondTask.id);
    const command = buildTaskScheduleProposalCommand(
      before,
      null,
      { patch: { plannedDurationMinutes: 20 }, warnings: [] },
      taskScheduleSnapshot(before),
      "new-schedule-race",
      request.inputAt,
    );
    db.save("schedule", { ...schedule, id: "other-schedule", owner_id: secondTask.id });
    assert.throws(() => service.execute(command), /日程が更新/);
  } finally {
    db.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
