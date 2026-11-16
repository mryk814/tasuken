import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const drawer = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");
const taskFields = readFileSync(
  "src/renderer/src/features/workspace/components/drawerEntityFields.tsx",
  "utf8",
);
const todo = readFileSync("src/renderer/src/features/workspace/pages/TodoPage.tsx", "utf8");
const today = [
  readFileSync("src/renderer/src/features/workspace/pages/TodayPage.tsx", "utf8"),
  // Today一覧の投影（#684）。今日やることから外す条件はここにある。
  readFileSync("src/renderer/src/features/workspace/lib/dailyPlanning.ts", "utf8"),
].join("\n");
const styles = readFileSync("src/renderer/src/styles/app.css", "utf8");
const workspaceApi = readFileSync("src/renderer/src/services/workspaceApi.ts", "utf8");

// AI Readyの切り替え（一覧の行・編集の欄）と依頼の欄は #755 束10a で外した。AIがTaskを動かすのは、
// 本人が設定で許した直接の書き込みだけ。保存済みの委任の値は、編集の隠し欄でそのまま残す。
test("AI Readyの切り替えは一覧にも編集の欄にも無く、保存済みの委任の値は残す", () => {
  assert.doesNotMatch(taskFields, /AI Ready|toggleAiReady|AI_ICON/);
  assert.match(taskFields, /name="intended_executor" value=\{intendedExecutor\}/);
  assert.match(taskFields, /name="work_state" value=\{preservedWorkState\}/);
  assert.doesNotMatch(taskFields, /担当者名/);
  assert.doesNotMatch(taskFields, /依頼者と担当を指定/);
  assert.doesNotMatch(taskFields, /開発用コンテキスト/);

  assert.doesNotMatch(todo, /toggleAiReady|AI Readyにする|AI Readyを解除/);
  assert.doesNotMatch(today, /onToggleAiReady/);
  assert.doesNotMatch(today, /async function handleToggleAiReady/);
  assert.match(today, /AI作業中のTaskはFeed側で追う/);
});

test("ToDoはAI作業中を状態の札で表示し、Today一覧からは外す", () => {
  assert.match(todo, /taskAiDelegationLabel\(/);
  assert.match(todo, /todo-ai-state-chip/);
  assert.doesNotMatch(todo, /priority-flag-button/);
  assert.doesNotMatch(styles, /\.priority-flag-button/);
  assert.doesNotMatch(today, /IconLoader2/);
  assert.doesNotMatch(today, /AIが作業中/);
});

test("Taskドロワーに依頼文のコピーとAIへの依頼の欄が無い", () => {
  assert.doesNotMatch(drawer, /依頼文をコピー|buildTaskAiRequest|TaskHandoffPanel|AIへの依頼/);
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
