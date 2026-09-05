import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import test from "node:test";

const bundled = await build({
  entryPoints: ["src/renderer/src/features/workspace/lib/taskAiRequest.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { buildTaskAiRequest, copyNewAiReadyRequests } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const task = {
  id: "task-a",
  title: "動作確認",
  intended_executor: "self",
  work_state: "not_delegated",
  state: "todo",
};
const ready = { ...task, intended_executor: "ai_agent", work_state: "ready_for_agent" };

test("新規AI Readyの正式保存後に共通依頼文をコピーする", async () => {
  const copied = [];
  const result = await copyNewAiReadyRequests([task], [ready], async (text) => copied.push(text));
  assert.equal(result.tone, "success");
  assert.deepEqual(copied, [buildTaskAiRequest([ready])]);
  for (const text of [
    "Task ID: task-a",
    "tasken.get_task_context",
    "tasken.start_task_work",
    "最新のTask version",
    "tasken.report_task_done",
    "tasken.report_task_blocked",
    "人がAI Inboxで採用",
  ]) {
    assert.ok(copied[0].includes(text), text);
  }
});

test("解除・既存Ready編集・作業中・完了・保存結果なしではコピーしない", async () => {
  for (const [previous, saved] of [
    [[ready], [task]],
    [[ready], [{ ...ready, title: "編集" }]],
    [[task], [{ ...ready, work_state: "in_progress" }]],
    [[task], [{ ...ready, state: "done" }]],
    [[task], []],
    [[{ ...ready, work_state: undefined }], [ready]],
  ]) {
    assert.equal(
      await copyNewAiReadyRequests(previous, saved, async () =>
        assert.fail("unexpected clipboard copy"),
      ),
      null,
    );
  }
});

test("コピー失敗は保存成功を維持して手動再コピーを案内する", async () => {
  const result = await copyNewAiReadyRequests([task], [ready], async () => {
    throw new Error("clipboard unavailable");
  });
  assert.equal(result.tone, "warning");
  assert.match(result.message, /AI Readyは保存しました/);
  assert.match(result.message, /タスク詳細の「依頼文をコピー」/);
});

test("新規作成や複数のReady保存は一つの依頼文へまとめる", async () => {
  const other = { ...ready, id: "task-b" };
  const copied = [];
  await copyNewAiReadyRequests([], [ready, other], async (text) => copied.push(text));
  assert.deepEqual(copied, [buildTaskAiRequest([ready, other])]);
});

test("保存経路はcommand成功後にコピーし、失敗した保存からは呼ばない", () => {
  const source = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
  const save = source.slice(
    source.indexOf("const saveEntities: SaveEntities"),
    source.indexOf("async function removeEntity"),
  );
  assert.ok(
    save.indexOf("await workspaceApi.executeCommands(envelopes)") <
      save.indexOf("await copyNewAiReadyRequests("),
  );
  assert.match(save, /receipt\.changes\.filter\(\(change\) => change\.type === "task"\)/);
  assert.match(
    save,
    /setToast\(aiRequestCopy\?\.message \|\| successMessage, aiRequestCopy\?\.tone \|\| "success"\)/,
  );
});
