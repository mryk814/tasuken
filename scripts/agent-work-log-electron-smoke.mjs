/** Real file input → IPC/Core proposal → human acceptance → persisted timeline. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron } from "playwright";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-agent-log-smoke-"));
const output = path.resolve(
  process.env.TASKEN_AGENT_LOG_SMOKE_OUTPUT_DIR || "output/playwright/agent-work-logs",
);
fs.mkdirSync(output, { recursive: true });
const errors = [];
let app;
let page;
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
      TASKEN_USER_DATA_DIR: root,
      TASKEN_DEV_USER_DATA_DIR: root,
      TASKEN_DB_PATH: path.join(root, "research-desk.sqlite"),
    },
  });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setMinimumSize(0, 0);
    window.setContentSize(1760, 1024);
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByText("Debrief", { exact: true }).first().click();
  await page.getByRole("region", { name: "AI作業ログ", exact: true }).waitFor();
}
const panel = () => page.getByRole("region", { name: "AI作業ログ", exact: true });
async function importFixture(name) {
  await panel().getByRole("button", { name: "AI作業ログを取り込む", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "AI作業ログを取り込む", exact: true });
  await dialog
    .locator('input[type="file"]')
    .setInputFiles(path.resolve(`fixtures/agent-work-logs/${name}.json`));
  await dialog.getByRole("button", { name: "確認へ進む", exact: true }).waitFor();
  await dialog.getByLabel("関連Repository").selectOption("synthetic-repository");
  await dialog.getByRole("button", { name: "確認へ進む", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  console.log(`queued ${name}`);
  const detail = panel().getByRole("complementary", { name: "選択Sessionの詳細", exact: true });
  await detail.getByRole("button", { name: "採用", exact: true }).click();
  await detail.getByRole("button", { name: "採用", exact: true }).waitFor({ state: "detached" });
  console.log(`accepted ${name}`);
}
try {
  await launch();
  await page.evaluate(() =>
    window.api.entities.save("repository_context", {
      id: "synthetic-repository",
      label: "Tasken fixture",
      remote_url: "https://example.com/fixture/tasken.git",
      provider: "generic_git",
    }),
  );
  for (const name of ["codex", "claude", "copilot", "opencode", "deepseek"])
    await importFixture(name);
  const toastClose = page.getByRole("button", { name: "閉じる", exact: true });
  if (await toastClose.count()) await toastClose.click();
  await page.evaluate(async () => {
    const sessions = await window.api.entities.list("agent_session");
    const session = sessions.find((entry) => entry.client_kind === "codex");
    await window.api.entities.save("agent_session", {
      ...session,
      agent_label: "合成デモ Agent",
      model_label: "合成デモ Model",
      outcome: {
        ...session.outcome,
        changed_items: ["合成デモ: weekly-view.tsx"],
        decisions: ["終了未確認は最終観測まで表示"],
        verification: ["合成デモ: focused tests passed"],
        remaining_work: ["合成デモ: 実機確認"],
        next_suggested_action: "合成デモ: 所有者による画面確認",
      },
    });
    const receipt = await window.api.commands.execute({
      commandId: "synthetic-calendar-task-create",
      issuedAt: new Date().toISOString(),
      name: "CreateTask",
      payload: {
        task: {
          id: "synthetic-calendar-task",
          title: "合成デモ: 週表示を確認",
          state: "review",
          project_id: "",
        },
      },
      actor: { kind: "user" },
      source: "main_ui",
      expectedVersions: [],
    });
    if (receipt.status !== "applied") throw new Error(`Demo task create: ${receipt.status}`);
    await window.api.entities.save("reference", {
      id: "synthetic-calendar-task-ref",
      subject: { type: "agent_session", id: session.id },
      object: { type: "task", id: "synthetic-calendar-task" },
      predicate: "worked_on",
      layer: "operational",
      status: "asserted",
      origin: "user",
    });
  });
  await panel().getByLabel("表示日").fill("2026-10-03");
  await page.reload();
  await page.getByText("Debrief", { exact: true }).first().click();
  await panel().getByLabel("表示日").fill("2026-10-03");
  await panel().getByRole("button", { name: "週", exact: true }).click();
  assert.equal(await panel().locator(".agent-log-block").count(), 5);
  await panel().getByLabel("Clientで絞る").selectOption("codex");
  assert.equal(await panel().locator(".agent-log-block").count(), 1);
  await panel().getByLabel("Clientで絞る").selectOption("");
  await panel().getByLabel("Repositoryで絞る").selectOption("synthetic-repository");
  assert.equal(await panel().locator(".agent-log-block").count(), 5);
  await panel().getByRole("button", { name: "次の期間", exact: true }).click();
  await panel().getByText("この期間のAI作業はありません。").waitFor();
  await page.screenshot({ path: path.join(output, "after-desktop-empty.png") });
  await panel().getByRole("button", { name: "前の期間", exact: true }).click();
  assert.equal(await panel().getByLabel("表示日").inputValue(), "2026-10-03");
  await panel().locator(".agent-log-block").filter({ hasText: "Codex" }).click();
  await panel().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, "after-desktop.png") });
  const detail = panel().getByRole("complementary", { name: "選択Sessionの詳細", exact: true });
  await detail.getByText("成果の詳細", { exact: true }).click();
  await detail.getByText("合成デモ: weekly-view.tsx", { exact: true }).waitFor();
  await detail.getByText("関連タスクと報告", { exact: true }).click();
  await detail.getByRole("button", { name: "Task: 合成デモ: 週表示を確認", exact: true }).waitFor();
  await detail.getByText("変更したもの", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, "after-desktop-outcome.png") });
  await detail.getByRole("button", { name: "Task: 合成デモ: 週表示を確認", exact: true }).click();
  const taskHeading = page.getByText("タスク詳細", { exact: true });
  await taskHeading.waitFor();
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await taskHeading.waitFor({ state: "detached" });
  await panel().locator(".agent-log-block").filter({ hasText: "Codex" }).click();
  const canonical = await page.evaluate(() => window.api.entities.list("agent_session"));
  assert.equal(canonical.length, 5);
  assert.ok(
    canonical.every(
      (session) => session.observation?.mode === "history" && session.status !== "active",
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(canonical),
    /DO-NOT-READ|DO-NOT-IMPORT|transcriptPath|reasoning/,
  );
  await panel().getByRole("button", { name: "詳細を閉じる", exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setMinimumSize(0, 0);
    window.setContentSize(390, 844);
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await panel().getByLabel("表示日").fill("2026-10-03");
  await panel().locator(".agent-log-list-entry").filter({ hasText: "Codex" }).click();
  await page.getByRole("dialog", { name: "選択Sessionの詳細", exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, "after-narrow-detail.png") });
  const narrowWidth = await page.evaluate(() => document.documentElement.clientWidth);
  // Windows fractional display scaling may round the requested content width by one pixel.
  assert.ok(Math.abs(narrowWidth - 390) <= 1, `unexpected narrow width: ${narrowWidth}`);
  await page.keyboard.press("Escape");
  await page
    .getByRole("dialog", { name: "選択Sessionの詳細", exact: true })
    .waitFor({ state: "detached" });
  await page.screenshot({ path: path.join(output, "after-narrow-timeline.png") });
  const unknown = panel().locator(".agent-log-list-entry").filter({ hasText: "OpenCode" });
  assert.match(await unknown.innerText(), /終了未確認/);
  assert.match(await unknown.innerText(), /最終観測/);
  assert.doesNotMatch(await unknown.innerText(), /\(終了\)/);
  await panel().getByRole("button", { name: "次の期間", exact: true }).click();
  await panel().getByText("この期間のAI作業はありません。").waitFor();
  await page.screenshot({ path: path.join(output, "after-narrow-empty.png") });
  await panel().getByRole("button", { name: "前の期間", exact: true }).click();
  assert.equal(await panel().getByLabel("Repositoryで絞る").inputValue(), "synthetic-repository");
  // Keyboard opens detail and native dialog returns focus after Escape.
  const block = panel().locator(".agent-log-list-entry").filter({ hasText: "Codex" });
  await block.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: "選択Sessionの詳細", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await block.evaluate((element) => element === document.activeElement), true);
  const transition = await block.evaluate(
    (element) => getComputedStyle(element).transitionDuration,
  );
  assert.ok(parseFloat(transition) <= 0.001, transition);
  // Invalid import is an inline recoverable error; no canonical row changes.
  await panel().getByRole("button", { name: "AI作業ログを取り込む", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "AI作業ログを取り込む", exact: true });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "unsupported.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"schema":"unsupported"}'),
  });
  await dialog.getByRole("alert").waitFor();
  await page.screenshot({ path: path.join(output, "after-narrow-error.png") });
  assert.equal(await dialog.getByRole("button", { name: "確認へ進む", exact: true }).count(), 0);
  await page.keyboard.press("Escape");
  await app.close();
  app = null;
  await launch();
  assert.equal((await page.evaluate(() => window.api.entities.list("agent_session"))).length, 5);
  assert.equal(errors.length, 0, errors.join("\n"));
  fs.writeFileSync(
    path.join(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        canonicalSessions: 5,
        clients: 5,
        width: narrowWidth,
        keyboard: true,
        reducedMotion: true,
        restart: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, output }));
} catch (error) {
  if (page) await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  if (page)
    fs.writeFileSync(
      path.join(output, "failure-layout.json"),
      JSON.stringify(
        await page
          .locator('[aria-label="採用"]')
          .evaluateAll((elements) =>
            elements.map((element) => {
              const ancestors = [];
              for (let current = element; current; current = current.parentElement) {
                const style = getComputedStyle(current),
                  rect = current.getBoundingClientRect();
                ancestors.push({
                  tag: current.tagName,
                  class: current.className,
                  rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
                  overflow: style.overflow,
                  display: style.display,
                  position: style.position,
                  scrollTop: current.scrollTop,
                  scrollHeight: current.scrollHeight,
                });
              }
              return ancestors;
            }),
          )
          .catch(() => []),
        null,
        2,
      ),
    );
  throw error;
} finally {
  if (app) await app.close();
  fs.rmSync(root, { recursive: true, force: true });
}
