import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { build } from "esbuild";
import { validateEntity } from "../src/main/repositories/domain.mjs";

const bundle = await build({
  stdin: {
    contents: `
      export { taskDraftSchema, taskPatchSchema } from "./src/shared/contracts/task/model.ts";
      export { projectTaskDraft } from "./src/renderer/src/features/task/api/taskClient.ts";
      export { projectTaskReadModel } from "./src/main/modules/task/application/taskCapabilityService.ts";
      export { duplicateTask } from "./src/renderer/src/features/workspace/domain-model/taskDuplication.ts";
      export { buildCompleteTaskOperations } from "./src/renderer/src/features/workspace/domain-model/taskRecurrence.ts";
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
  taskDraftSchema,
  taskPatchSchema,
  projectTaskDraft,
  projectTaskReadModel,
  duplicateTask,
  buildCompleteTaskOperations,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("new duplicated and recurring Tasks do not inherit another Task or column's board order", () => {
  for (const state of ["todo", "doing", "done"]) {
    const original = task({ state, board_order: 0 });
    const copy = duplicateTask(original).task;
    assert.equal(copy.state, "todo");
    assert.equal(copy.board_order, undefined);
    assert.equal(original.board_order, 0);
  }
  const original = task({
    board_order: 2,
    repeat_rule: { frequency: "daily", interval: 1, next_from: "completed", weekdays: [] },
  });
  const tasks = buildCompleteTaskOperations(original, undefined, {
    now: "2026-10-08T12:00:00.000Z",
  })
    .filter((operation) => operation.type === "task")
    .map((operation) => operation.entity);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].state, "done");
  assert.equal(tasks[0].board_order, 2);
  assert.equal(tasks[1].state, "todo");
  assert.equal(tasks[1].board_order, undefined);
});
const task = (extra = {}) => ({
  id: "board-task",
  title: "Ordered task",
  state: "todo",
  priority: "normal",
  ...extra,
});

test("board order crosses Task DTO projections and accepts only optional nonnegative safe integers", () => {
  for (const board_order of [0, 4, Number.MAX_SAFE_INTEGER]) {
    const value = task({ board_order });
    assert.equal(taskDraftSchema.parse(value).board_order, board_order);
    assert.equal(taskPatchSchema.parse({ board_order }).board_order, board_order);
    assert.equal(projectTaskDraft(value).board_order, board_order);
    assert.equal(
      projectTaskReadModel(
        {
          ...value,
          version: 1,
          source: "manual",
          created_at: "2026-10-08T00:00:00.000Z",
          updated_at: "2026-10-08T00:00:00.000Z",
        },
        null,
      ).board_order,
      board_order,
    );
    assert.doesNotThrow(() => validateEntity("task", value));
  }
  assert.equal(taskDraftSchema.parse(task()).board_order, undefined);
  assert.doesNotThrow(() => validateEntity("task", task()));
  for (const board_order of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null]) {
    assert.equal(taskDraftSchema.safeParse(task({ board_order })).success, false);
    assert.throws(() => validateEntity("task", task({ board_order })), /board_order/);
  }
});

// AIへの新しい委任の入口は外した（#755 束10a）。複製と繰り返しの次の回が、元のTaskの委任を写して
// 新しい委任を作らない。元のTask（完了にした回）の委任の値はそのまま残す。
test("duplicated and recurring copies do not create a new delegation to an AI", () => {
  const delegated = task({
    intended_executor: "ai_agent",
    executor_identity: "Codex",
    work_state: "in_progress",
    work_attempt_id: "12c9a3df-084a-4314-8a80-de844b512fad",
    handoff_instruction: "資料を直す",
    repeat_rule: { frequency: "daily", interval: 1, next_from: "completed", weekdays: [] },
  });
  const copy = duplicateTask(delegated).task;
  const [completed, next] = buildCompleteTaskOperations(delegated, undefined, {
    now: "2026-11-16T12:00:00.000Z",
  })
    .filter((operation) => operation.type === "task")
    .map((operation) => operation.entity);
  for (const entity of [copy, next]) {
    assert.equal(entity.intended_executor, "self");
    assert.equal(entity.work_state, "not_delegated");
    assert.equal(entity.executor_identity, null);
    assert.equal(entity.work_attempt_id, null);
    assert.equal(entity.handoff_instruction, null);
  }
  assert.equal(completed.intended_executor, "ai_agent");
  assert.equal(completed.handoff_instruction, "資料を直す");
});
