import assert from "node:assert/strict";
import test from "node:test";
import { normalizeViewPreference } from "../src/shared/viewPreferenceRegistry.mjs";
import {
  taskNextTurn,
  taskWorkModel,
  sortBoardRows,
  moveBoardTask,
} from "../src/renderer/src/features/workspace/components/TaskBoardModel.ts";
import {
  makeTask,
  makeProposal,
  makeReceipt,
  WORK_ATTEMPT_A,
  REQUEST_MEASUREMENT,
  reassignedScenario,
} from "./fixtures/agentWorkScenarios.mjs";

test("既存ToDo設定を保ったままボード表示を保存し、不正な表示値は一覧へ戻す", () => {
  const legacy = normalizeViewPreference(
    "todo.preferences",
    { filter: "done", sortMode: "title" },
    1,
  );
  assert.equal(legacy.layout, "list");
  assert.equal(legacy.filter, "done");
  assert.equal(legacy.sortMode, "title");
  assert.equal(
    normalizeViewPreference("todo.preferences", { ...legacy, layout: "board" }, 2).layout,
    "board",
  );
  assert.equal(
    normalizeViewPreference("todo.preferences", { layout: "invalid" }, 2).layout,
    "list",
  );
});

test("ボードのTask状態とAIへの返答待ち・報告採用を分ける", () => {
  const task = makeTask({ state: "todo", work_state: "blocked", work_attempt_id: WORK_ATTEMPT_A });
  const question = makeProposal("question", {
    action: "report_blocked",
    work_attempt_id: WORK_ATTEMPT_A,
    request_id: REQUEST_MEASUREMENT,
    needed_input: ["温度は？"],
    summary: "温度を確認",
    executor_kind: "ai_agent",
    executor_label: "Codex",
  });
  const waiting = taskWorkModel(task, [question], []);
  assert.equal(task.state, "todo");
  assert.match(taskNextTurn(task, waiting), /自分.*回答/);
  const reply = makeReceipt("reply", {
    executor_kind: "human",
    receipt_kind: "human_reply",
    request_id: REQUEST_MEASUREMENT,
    work_attempt_id: WORK_ATTEMPT_A,
    summary: "25℃",
  });
  assert.match(taskNextTurn(task, taskWorkModel(task, [question], [reply])), /AI.*再開待ち/);
  const accepted = { ...task, work_state: "accepted" };
  assert.match(taskNextTurn(accepted, taskWorkModel(accepted, [], [])), /Taskは継続/);
  assert.equal(accepted.state, "todo");
});

test("過去の遅着報告はボードを成果確認へ戻さず正式完了を優先する", () => {
  const input = reassignedScenario();
  const model = taskWorkModel(input.task, input.proposals, input.receipts);
  assert.match(taskNextTurn(input.task, model), /AI.*作業中/);
  assert.equal(taskNextTurn({ ...input.task, state: "done" }, model), "Task完了");
});

const boardRow = (id, state = "todo", board_order) => ({
  task: makeTask({
    id,
    state,
    board_order,
    intended_executor: "self",
    created_at: "2026-10-08T00:00:00Z",
  }),
});

test("列の手動順序を優先し、未設定Taskは安定順で後ろに表示する", () => {
  const rows = [boardRow("z"), boardRow("b", "todo", 1), boardRow("a"), boardRow("c", "todo", 0)];
  assert.deepEqual(
    sortBoardRows(rows).map(({ task }) => task.id),
    ["c", "b", "a", "z"],
  );
  assert.equal(rows[0].task.id, "z");
});

test("非表示Taskを含む列で移動しても、他のTaskの状態と相対順を保つ", () => {
  const rows = [
    boardRow("a", "todo", 0),
    boardRow("hidden", "todo", 1),
    boardRow("b", "todo", 2),
    boardRow("other", "doing", 0),
  ];
  const updates = moveBoardTask(rows, "b", "todo", "a");
  const next = rows.map(({ task }) => ({
    task: updates.find((next) => next.id === task.id) || task,
  }));
  assert.deepEqual(
    sortBoardRows(next.filter(({ task }) => task.state === "todo")).map(({ task }) => task.id),
    ["b", "a", "hidden"],
  );
  assert.ok(!updates.some((task) => task.id === "other"));
  assert.equal(next.find(({ task }) => task.id === "hidden").task.state, "todo");
});

test("列間移動は対象だけの状態を変え、元列のTaskを変更しない", () => {
  const rows = [boardRow("a", "todo", 0), boardRow("b", "todo", 1), boardRow("c", "doing", 0)];
  const updates = moveBoardTask(rows, "b", "doing");
  assert.deepEqual(
    updates.map(({ id, state, board_order }) => ({ id, state, board_order })),
    [{ id: "b", state: "doing", board_order: 1 }],
  );
  assert.equal(rows[1].task.state, "todo");
});

test("未採用AI Taskの完了を拒否し、完了列内の並べ替えは完了日時を保つ", () => {
  const ai = boardRow("ai");
  ai.task.intended_executor = "ai_agent";
  ai.task.work_state = "working";
  assert.throws(() => moveBoardTask([ai], "ai", "done"), /報告.*採用/);
  const completed = { ...boardRow("done", "done", 0).task, completed_at: "2026-10-07T12:00:00Z" };
  const updates = moveBoardTask(
    [{ task: completed }, boardRow("first", "done", 1)],
    "done",
    "done",
  );
  assert.equal(updates.find((task) => task.id === "done").completed_at, completed.completed_at);
});

test("消えた移動対象・移動先を保存せず、同じ位置のdropを無操作にする", () => {
  const rows = [boardRow("a", "todo", 0), boardRow("b", "todo", 1)];
  assert.throws(() => moveBoardTask(rows, "missing", "todo"), /見つかりません/);
  assert.throws(() => moveBoardTask(rows, "a", "doing", "b"), /移動先/);
  assert.deepEqual(moveBoardTask(rows, "a", "todo", "a"), []);
  assert.deepEqual(moveBoardTask(rows, "a", "todo", "b"), []);
});
