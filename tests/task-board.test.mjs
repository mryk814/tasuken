import assert from "node:assert/strict";
import test from "node:test";
import { normalizeViewPreference } from "../src/shared/viewPreferenceRegistry.mjs";
import {
  taskNextTurn,
  taskWorkModel,
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
