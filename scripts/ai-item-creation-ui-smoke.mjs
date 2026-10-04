import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";
import { TaskenCoreClient } from "../src/main/mcp/taskenCoreClient.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-ai-create-ui-"));
const screenshots = path.resolve("artifacts", "ai-item-creation");
fs.mkdirSync(screenshots, { recursive: true });
const env = { ...process.env, TASKEN_USER_DATA_DIR: root, TASKEN_CORE_AI_ITEM_CREATE: "1" };
let app;
try {
  app = await electron.launch({
    args: [".", "--disable-gpu", "--disable-gpu-compositing", `--user-data-dir=${root}`],
    cwd: process.cwd(),
    env,
  });
  const page = await app.firstWindow();
  await page.getByText("Today", { exact: true }).first().waitFor();
  const core = new TaskenCoreClient({ env });
  const request = (kind) => ({
    kind,
    title: kind === "task" ? "会話から保存した本人タスク" : "会話から保存した思いつき",
    body: "隔離UI検証用。実データとは別の一時DBです。",
    idempotency_key: `ui-${kind}`,
    caller: "dot",
    source_app: "ui-smoke",
    source_session: "isolated",
    reason: "本人の依頼で保存",
  });
  const task = await core.createAiItem(request("task"));
  const note = await core.createAiItem(request("note"));
  await page.getByText("ToDo", { exact: true }).first().click();
  const taskRow = page.locator(".table-row", { hasText: task.entity.title }).first();
  await taskRow.waitFor();
  assert.equal(
    await taskRow
      .getByRole("button", { name: "AI作成 · 未確認。作成元を表示", exact: true })
      .count(),
    1,
  );
  assert.equal(await taskRow.locator(".ai-creation-dot").count(), 1);
  await page.screenshot({ path: path.join(screenshots, "task-list.png") });
  await taskRow.getByText(task.entity.title, { exact: true }).click();
  await page
    .locator(".drawer")
    .getByRole("button", { name: "AI作成 · 未確認。作成元を表示", exact: true })
    .click();
  const taskDetail = page.locator(".ai-creation-explanation:popover-open");
  await taskDetail.getByRole("button", { name: "見た", exact: true }).click();
  await taskDetail.getByText("AI作成 · 既読", { exact: true }).waitFor();
  const savedTask = (await core.createAiItem(request("task"))).entity;
  assert(savedTask.ai_seen_at);
  assert.deepEqual(savedTask.ai_creation, task.entity.ai_creation);
  await page.screenshot({ path: path.join(screenshots, "task-seen.png") });
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".drawer").count(), 1);
  await page.keyboard.press("Escape");
  await page.getByText("Notes", { exact: true }).first().click();
  await page.getByText(note.entity.title, { exact: true }).first().click();
  await page
    .locator(".note-preview-panel")
    .getByRole("button", { name: "AI作成 · 未確認。作成元を表示", exact: true })
    .click();
  const noteDetail = page.locator(".ai-creation-explanation:popover-open");
  await noteDetail.getByRole("button", { name: "見た", exact: true }).waitFor();
  await page.screenshot({ path: path.join(screenshots, "note-unseen.png") });
  await noteDetail.getByRole("button", { name: "見た", exact: true }).click();
  await noteDetail.getByText("AI作成 · 既読", { exact: true }).waitFor();
  const savedNote = (await core.createAiItem(request("note"))).entity;
  assert(savedNote.ai_seen_at);
  assert.deepEqual(savedNote.ai_creation, note.entity.ai_creation);
  assert.equal(savedNote.body, request("note").body);
  console.log(JSON.stringify({ ok: true, isolated: true, screenshots }));
} finally {
  await app?.close();
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith("tasken-ai-create-ui-"));
  fs.rmSync(root, { recursive: true, force: true });
}
