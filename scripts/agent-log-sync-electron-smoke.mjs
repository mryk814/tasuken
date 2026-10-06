/** Synthetic folders only; actual source setup, direct history adoption (#629) and refresh through Electron. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron } from "playwright";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-folder-sync-smoke-"));
const logs = path.join(root, "synthetic-codex", "sessions");
fs.mkdirSync(logs, { recursive: true });
const file = path.join(logs, "rollout-synthetic.jsonl");
fs.copyFileSync("fixtures/agent-work-logs/codex-rollout.jsonl", file);
const output = path.resolve("output/playwright/agent-log-sync");
fs.mkdirSync(output, { recursive: true });
let app;
let page;
const errors = [];
async function launch() {
  app = await _electron.launch({
    executablePath: path.resolve(
      "node_modules/electron/dist",
      process.platform === "win32" ? "electron.exe" : "electron",
    ),
    cwd: process.cwd(),
    args: [".", `--user-data-dir=${root}`],
    env: {
      ...process.env,
      CODEX_HOME: path.dirname(logs),
      TASKEN_USER_DATA_DIR: root,
      TASKEN_DEV_USER_DATA_DIR: root,
      TASKEN_DB_PATH: path.join(root, "research-desk.sqlite"),
    },
  });
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setMinimumSize(0, 0);
    w.setContentSize(1760, 1024);
  });
  await page.getByText("Debrief", { exact: true }).first().click();
}
const collector = () => page.locator(".agent-log-sync");
const timeline = () => page.getByRole("region", { name: "AI作業ログ", exact: true });
async function selectSession() {
  if (!(await timeline().isVisible()))
    await page.getByText("AI の週次振り返り・ログ取り込み", { exact: true }).click();
  await timeline().getByLabel("表示日").fill("2026-10-03");
  await timeline().locator(".agent-log-block").first().click();
}
/** #629: ログ同期の記録は採用待ちにせず履歴へ入る。採用ボタンも対応待ちも出ない。 */
async function assertAdoptedWithoutReview() {
  const detail = timeline().getByRole("complementary", { name: "選択Sessionの詳細", exact: true });
  assert.equal(await detail.getByRole("button", { name: "採用", exact: true }).count(), 0);
  const pending = await page.evaluate(async () =>
    (await window.api.entities.list("ai_proposal")).filter(
      (proposal) =>
        proposal.status === "pending" && String(proposal.source_app).startsWith("tasken-log-sync:"),
    ),
  );
  assert.deepEqual(pending, []);
}
try {
  await launch();
  await collector().locator(":scope > summary").click();
  await collector().getByText("保存先を追加・再確認", { exact: true }).click();
  await collector().getByRole("button", { name: "この場所を登録", exact: true }).waitFor();
  assert.equal(
    await collector().getByRole("button", { name: "この場所を登録", exact: true }).isEnabled(),
    false,
  );
  await collector().getByRole("button", { name: "場所を確認", exact: true }).click();
  await collector().getByText("1件のログ候補", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, "desktop-source-confirm.png") });
  await collector().getByLabel("この保存内容と同期先を確認しました").check();
  await collector().getByRole("button", { name: "この場所を登録", exact: true }).click();
  await collector().getByRole("button", { name: "ログ同期", exact: true }).click();
  await collector()
    .getByText(/新規・更新 1/)
    .waitFor();
  await selectSession();
  await page.screenshot({ path: path.join(output, "desktop-sync-proposal.png") });
  await assertAdoptedWithoutReview();
  const first = await page.evaluate(
    async () => (await window.api.entities.list("agent_session"))[0],
  );
  assert.equal(first.status, "unknown");
  assert.deepEqual(
    first.request_events.map((event) => event.text),
    ["合成デモ: Activityを確認する"],
  );
  assert.deepEqual(first.response_checkpoints, []);
  fs.appendFileSync(
    file,
    JSON.stringify({
      timestamp: "2026-10-03T00:10:00Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        channel: "final",
        content: [{ type: "output_text", text: "合成デモ: 変更されたログから差分を収集した" }],
      },
    }) + "\n",
  );
  await collector().getByRole("button", { name: "ログ同期", exact: true }).click();
  await collector()
    .getByText(/新規・更新 1/)
    .waitFor();
  await selectSession();
  await assertAdoptedWithoutReview();
  const refreshed = await page.evaluate(() => window.api.entities.list("agent_session"));
  assert.equal(refreshed.length, 1);
  assert.equal(refreshed[0].id, first.id);
  assert.match(refreshed[0].outcome.summary, /差分/);
  await collector().getByRole("button", { name: "ログ同期", exact: true }).click();
  await collector()
    .getByText(/変更なし 1/)
    .waitFor();
  const cancelFiles = Array.from({ length: 80 }, (_, index) =>
    path.join(logs, `cancel-synthetic-${index}.jsonl`),
  );
  const original = fs.readFileSync("fixtures/agent-work-logs/codex-rollout.jsonl", "utf8");
  for (const [index, target] of cancelFiles.entries())
    fs.writeFileSync(target, original.replaceAll("synthetic-rollout", `synthetic-cancel-${index}`));
  await collector().getByRole("button", { name: "ログ同期", exact: true }).click();
  await collector().getByRole("button", { name: "同期を停止", exact: true }).click();
  await collector()
    .getByText(/停止しました/)
    .waitFor();
  const cancelled = await page.evaluate(() => window.api.agentWorkLogs.setup());
  assert.equal(cancelled.state, "cancelled");
  assert.ok(cancelled.queued < 80);
  for (const target of cancelFiles) fs.rmSync(target);
  await collector().getByRole("button", { name: "ログ同期", exact: true }).click();
  await collector()
    .getByText(/変更なし 1/)
    .waitFor();
  // subagentのthreadは親の会話の一部なので、単独のSessionとして増えない。
  const subagent = fs
    .readFileSync("fixtures/agent-work-logs/codex-rollout.jsonl", "utf8")
    .replaceAll("synthetic-rollout", "synthetic-subagent")
    .replace(
      '"payload":{',
      '"payload":{"thread_source":"subagent","parent_thread_id":"synthetic-rollout",',
    );
  fs.writeFileSync(path.join(logs, "rollout-subagent.jsonl"), subagent);
  await collector().getByRole("button", { name: "ログ同期", exact: true }).click();
  await collector()
    .getByText(/変更なし 2/)
    .waitFor();
  assert.equal(
    await page.evaluate(async () => (await window.api.entities.list("agent_session")).length),
    1,
  );
  // 旧版で残った採用待ち（ここでは手動取込で作る）は件数と案内だけを出し、対応待ちには並べない。
  const legacy = fs
    .readFileSync("fixtures/agent-work-logs/codex-rollout.jsonl", "utf8")
    .replaceAll("synthetic-rollout", "synthetic-legacy-pending");
  await page.evaluate((raw) => window.api.agentWorkLogs.import(raw, []), legacy);
  await collector().getByRole("button", { name: "ログ同期", exact: true }).click();
  await collector()
    .getByText(/採用待ちのまま残った記録が 1/)
    .waitFor();
  assert.equal(await page.locator(".feed-needs-row").count(), 0);
  await collector().getByRole("note").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, "desktop-legacy-pending.png") });
  await collector().getByLabel("Tasken 起動中に5分ごとに同期").check();
  await collector().getByLabel("Tasken 起動中に5分ごとに同期").uncheck();
  await collector().getByText("保存先を追加・再確認", { exact: true }).click();
  await page.screenshot({ path: path.join(output, "desktop-synced.png") });
  await app.close();
  app = null;
  await launch();
  const persisted = await page.evaluate(() => window.api.entities.list("agent_session"));
  assert.equal(persisted.length, 1);
  assert.match(persisted[0].outcome.summary, /差分/);
  await collector().locator(":scope > summary").click();
  await collector().getByRole("button", { name: "ログ同期", exact: true }).click();
  await collector()
    .getByText(/変更なし 2/)
    .waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(390, 844),
  );
  await collector().locator(":scope > summary").click();
  await page.locator(".debrief-activity-panel").getByLabel("Activity対象日").fill("2026-10-03");
  await page.locator(".debrief-activity-panel").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, "mobile-normalized-day.png") });
  await collector().locator(":scope > summary").click();
  await collector().getByText("保存先を追加・再確認", { exact: true }).click();
  await collector().getByText("場所の詳細・WSL / 別プロファイル", { exact: true }).click();
  await collector().getByLabel("ログ保存先の場所").fill(path.join(root, "synthetic-missing"));
  await collector().getByRole("button", { name: "場所を確認", exact: true }).click();
  await collector().getByText("保存先なし", { exact: true }).waitFor();
  await collector().getByText("保存先なし", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, "mobile-source-error.png") });
  await collector().getByRole("button", { name: "登録を解除", exact: true }).click();
  await collector().getByText("保存先はまだ登録されていません。", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(async () => (await window.api.entities.list("agent_session")).length),
    1,
  );
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        nativeSessions: 1,
        adoptedWithoutReview: true,
        delegatedThreadSkipped: true,
        legacyPendingNoticed: 1,
        refreshedSameId: true,
        restart: true,
        widths: [1760, 390],
        privateLogsRead: false,
        errors,
      },
      null,
      2,
    ),
  );
  console.log("folder sync smoke passed");
} finally {
  if (app) await app.close();
  fs.rmSync(root, { recursive: true, force: true });
}
