/** Only synthetic proposals in a fresh temporary profile; never adopts personal records. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { _electron } from "playwright";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-selected-adoption-"));
const output = path.resolve("output/playwright/feed-selected-adoption");
fs.mkdirSync(output, { recursive: true });
const errors = [];
let app;
let page;
function seed(step) {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/run-electron-node.mjs",
      "scripts/seed-feed-audit-workspace.mjs",
      root,
      "--selected-adoption",
      step,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
async function refresh() {
  await page.getByRole("button", { name: "更新", exact: true }).click();
}
async function shot(name) {
  const toastClose = page.locator(".toast").getByRole("button", { name: "閉じる", exact: true });
  if (await toastClose.isVisible()) await toastClose.click();
  await page.screenshot({ path: path.join(output, `${name}.png`) });
}
try {
  const rejected = spawnSync(
    process.execPath,
    [
      "scripts/run-electron-node.mjs",
      "scripts/seed-feed-audit-workspace.mjs",
      process.cwd(),
      "--selected-adoption",
      "initial",
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /専用の一時userData/);
  seed("initial");
  app = await _electron.launch({
    executablePath: path.resolve(
      "node_modules/electron/dist",
      process.platform === "win32" ? "electron.exe" : "electron",
    ),
    cwd: process.cwd(),
    args: [".", `--user-data-dir=${root}`],
    env: {
      ...process.env,
      TASKEN_USER_DATA_DIR: root,
      TASKEN_DEV_USER_DATA_DIR: root,
      TASKEN_DB_PATH: path.join(root, "research-desk.sqlite"),
    },
  });
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setMinimumSize(0, 0);
    win.setContentSize(1760, 1024);
  });
  await page.getByText("Feed", { exact: true }).first().click();
  await page.getByRole("tab", { name: /対応待ち/ }).click();
  const checks = page.locator(".feed-record-check input");
  assert.equal(await checks.count(), 4);
  assert.equal(
    await page.getByRole("button", { name: "選択した記録を採用", exact: true }).isEnabled(),
    false,
  );
  await page.getByRole("button", { name: "表示中の記録をすべて選択", exact: true }).click();
  assert.equal(await checks.count(), 4);
  await page.getByText("4件選択", { exact: true }).waitFor();
  seed("arrival");
  await refresh();
  await page.getByText("4件選択", { exact: true }).waitFor();
  assert.equal(await page.locator(".feed-record-check input:checked").count(), 4);
  await page.getByRole("button", { name: "選択解除", exact: true }).click();
  await page.getByText("0件選択", { exact: true }).waitFor();
  for (const id of ["a", "b", "stale"]) {
    await page
      .locator(".feed-needs-row")
      .filter({ hasText: `合成記録 ${id}：` })
      .locator('input[type="checkbox"]')
      .check();
  }
  await shot("desktop-selected");
  await page.getByRole("button", { name: "選択した記録を採用", exact: true }).click();
  await page.getByText(/2件採用・1件失敗/).waitFor();
  await page.getByText("1件選択", { exact: true }).waitFor();
  await page.getByRole("alert").filter({ hasText: "再同期" }).waitFor();
  const sessions = await page.evaluate(() => window.api.entities.list("agent_session"));
  assert.deepEqual(sessions.map((row) => row.id).sort(), ["session-a", "session-b"]);
  assert.ok(
    sessions.every((row) => row.status === "unknown" && row.observation.coverage === "partial"),
  );
  await shot("desktop-partial-failure");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(390, 844),
  );
  await page.locator(".feed-record-adoption").scrollIntoViewIfNeeded();
  await shot("narrow-partial-failure");
  const bounds = await page.locator(".feed-record-adoption").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      width: window.innerWidth,
      overflow: element.scrollWidth > element.clientWidth + 1,
    };
  });
  assert.ok(
    bounds.left >= 0 && bounds.right <= bounds.width && !bounds.overflow,
    JSON.stringify(bounds),
  );
  // Repair only the synthetic failed proposal, then retry the retained selection.
  seed("repair");
  await refresh();
  await page.getByRole("button", { name: "選択した記録を採用", exact: true }).click();
  await page.getByText(/1件採用・0件失敗/).waitFor();
  const after = await page.evaluate(() => window.api.entities.list("agent_session"));
  assert.equal(after.length, 3);
  // Detail open/close is separate from selection, and tab navigation clears the adoption scope.
  const row = page.locator(".feed-needs-row").filter({ hasText: "合成記録 new：" });
  await row.locator(".feed-needs-select").click();
  await page.getByRole("group", { name: "選んだ対応待ち", exact: true }).waitFor();
  await shot("narrow-detail-initial");
  await page.locator(".feed-needs-detail").scrollIntoViewIfNeeded();
  await shot("narrow-detail");
  await row.locator(".feed-needs-select").click();
  assert.equal(await page.locator(".feed-needs-detail").count(), 0);
  await row.locator('input[type="checkbox"]').check();
  await page.getByRole("tab", { name: "ホーム", exact: true }).click();
  await page.getByRole("tab", { name: /対応待ち/ }).click();
  await page.getByText("0件選択", { exact: true }).waitFor();
  // Adopt the remaining synthetic sessions; the Task proposal remains pending.
  await page.getByRole("button", { name: "表示中の記録をすべて選択", exact: true }).click();
  await page.getByRole("button", { name: "選択した記録を採用", exact: true }).click();
  await page.getByText(/2件採用・0件失敗/).waitFor();
  assert.equal(await checks.count(), 0);
  assert.equal(
    (await page.evaluate(() => window.api.entities.list("ai_proposal"))).find(
      (row) => row.id === "other",
    ).status,
    "pending",
  );
  // Empty state retains the batch result after the last row disappears.
  seed("empty");
  await refresh();
  await page.getByText("いま対応する更新はありません", { exact: true }).waitFor();
  await page.getByText(/2件採用・0件失敗/).waitFor();
  await shot("narrow-empty");
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        widths: [1760, 390],
        actualUi: true,
        selectionScope: true,
        partialFailureRetry: true,
        unknownEndRetained: true,
        detailClose: true,
        tabSelectionCleared: true,
        empty: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log("selected adoption Electron smoke passed");
} catch (error) {
  if (page) await shot("failure");
  throw error;
} finally {
  if (app) await app.close();
  fs.rmSync(root, { recursive: true, force: true });
}
