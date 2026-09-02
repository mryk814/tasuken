import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const drawer = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");
const taskFields = readFileSync(
  "src/renderer/src/features/workspace/components/drawerEntityFields.tsx",
  "utf8",
);
const todo = readFileSync("src/renderer/src/features/workspace/pages/TodoPage.tsx", "utf8");
const today = readFileSync("src/renderer/src/features/workspace/pages/TodayPage.tsx", "utf8");
const styles = readFileSync("src/renderer/src/styles/app.css", "utf8");
const workspaceApi = readFileSync("src/renderer/src/services/workspaceApi.ts", "utf8");

test("AI Readyだけを人間側のAI作業許可として表示する", () => {
  assert.match(taskFields, /AI_ICON/);
  assert.match(taskFields, /AI Ready/);
  assert.match(taskFields, /name="intended_executor" value=\{intendedExecutor\}/);
  assert.match(taskFields, /name="work_state" value=\{preservedWorkState\}/);
  assert.match(taskFields, /toggleAiReady\(checked: boolean\)/);
  assert.doesNotMatch(taskFields, /担当者名/);
  assert.doesNotMatch(taskFields, /依頼者と担当を指定/);
  assert.doesNotMatch(taskFields, /開発用コンテキスト/);

  assert.match(todo, /async function toggleAiReady/);
  assert.match(todo, /AI_ICON/);
  assert.match(today, /onToggleAiReady/);
  assert.match(today, /async function handleToggleAiReady/);
});

test("TodayとToDoはAI作業中を回転アイコンで表示する", () => {
  for (const source of [today, todo]) {
    assert.match(source, /in_progress/);
    assert.match(source, /IconLoader2/);
    assert.match(source, /is-working/);
    assert.match(source, /AIが作業中/);
  }
  assert.match(styles, /\.priority-flag-button\.is-working svg[\s\S]*animation: spin/);
});

test("Desktopは依頼文コピーを残し、直接AIを起動する導線を持たない", () => {
  assert.match(drawer, /依頼文をコピー/);
  assert.match(drawer, /tasken\.get_task_context に task_id=/);
  assert.doesNotMatch(drawer, /AIを起動して渡す/);
  assert.doesNotMatch(drawer, /AIへ渡る内容を確認/);
  assert.doesNotMatch(drawer, /AIへ依頼を準備/);
  assert.doesNotMatch(drawer, /StartTaskWork/);
  assert.doesNotMatch(workspaceApi, /getTaskAgentLaunchOptions/);
  assert.doesNotMatch(workspaceApi, /launchTaskAgent/);
});

test("Work Receiptの受入は完了を明示して承認する", () => {
  assert.match(drawer, /"AcceptTaskWork",\s*\{ taskId: task\.id, completeTask: true \}/);
  assert.match(drawer, /承認して完了/);
});
