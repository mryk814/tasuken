/**
 * ログからの拾い上げ（#751）を Electron の画面で確かめる。合成のフォルダーだけを使う。
 * 保存先の登録 → 静かになった会話を 1 件ずつ → 動いている会話は読まない → 続きだけ →
 * 読み直しで増えない → 再起動の後も同じ。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron } from "playwright";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-folder-sync-smoke-"));
const logs = path.join(root, "synthetic-codex", "sessions");
fs.mkdirSync(logs, { recursive: true });
const original = fs.readFileSync("fixtures/agent-work-logs/codex-rollout.jsonl", "utf8");
/** 静かになった会話にする（最後の動きから 60 分より前に書かれたログ）。 */
function quiet(target) {
  const old = new Date(Date.now() - 3 * 60 * 60_000);
  fs.utimesSync(target, old, old);
}
const file = path.join(logs, "rollout-synthetic.jsonl");
fs.writeFileSync(file, original);
quiet(file);
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
  await page.getByText("日誌", { exact: true }).first().click();
}
const collector = () => page.locator(".agent-log-sync");
const timeline = () => page.getByRole("region", { name: "AI作業ログ", exact: true });
const records = () => page.evaluate(() => window.api.entities.list("agent_work_record"));
const pickNow = () => collector().getByRole("button", { name: "今すぐ拾う", exact: true }).click();
async function selectRecord() {
  if (!(await timeline().isVisible()))
    await page.getByText("AI の週次振り返り", { exact: true }).click();
  await timeline().getByLabel("表示日").fill("2026-10-03");
  await timeline().locator(".agent-log-block").first().click();
}
try {
  await launch();
  await collector().locator(":scope > summary").click();
  // 登録するまでは、何も読まない。
  assert.equal(
    await collector().getByRole("button", { name: "今すぐ拾う", exact: true }).isEnabled(),
    false,
  );
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
  await pickNow();
  await collector()
    .getByText(/拾った 1/)
    .waitFor();
  await selectRecord();
  await page.screenshot({ path: path.join(output, "desktop-picked-up.png") });
  // 取り込みの入口と、採る・採らないの操作は無い。
  assert.equal(
    await timeline()
      .getByRole("button", { name: /取込|取り込む/ })
      .count(),
    0,
  );
  const detail = timeline().getByRole("complementary", { name: "選択Sessionの詳細", exact: true });
  assert.equal(await detail.getByRole("button", { name: "採る", exact: true }).count(), 0);
  await detail.getByText("ログから拾った記録", { exact: true }).waitFor();
  const [first] = await records();
  assert.equal((await records()).length, 1);
  assert.equal(first.basis, "log_pickup");
  assert.equal(first.status, "partial");
  assert.equal(first.intent, "合成デモ: Activityを確認する");
  assert.equal(first.summary, "合成デモ: 日次表示を確認した");
  assert.deepEqual([first.changed, first.verified, first.remaining], [[], [], []]);
  assert.doesNotMatch(JSON.stringify(first), /DO-NOT-IMPORT/);
  // 案も、古い形の会話も作らない。
  assert.equal(
    await page.evaluate(async () => (await window.api.entities.list("agent_session")).length),
    0,
  );
  assert.equal(
    await page.evaluate(
      async () =>
        (await window.api.entities.list("ai_proposal")).filter(
          (proposal) => proposal.payload_type === "agent_sessions",
        ).length,
    ),
    0,
  );

  // 読み直しても増えない。
  await pickNow();
  await collector()
    .getByText(/拾った 0 · 変更なし 1/)
    .waitFor();
  assert.equal((await records()).length, 1);

  // 会話が再開した。動いている間（ファイルが書かれたばかり）は読まない。
  fs.appendFileSync(
    file,
    JSON.stringify({
      timestamp: "2026-10-03T02:00:00Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        channel: "final",
        content: [{ type: "output_text", text: "合成デモ: 続きの作業を終えた" }],
      },
    }) + "\n",
  );
  await pickNow();
  await collector()
    .getByText(/拾った 0 · 変更なし 0 · 動いている 1/)
    .waitFor();
  assert.equal((await records()).length, 1);
  // 静かになったら、続きの分だけを 1 件。前の 1 件は書き換えない。
  quiet(file);
  await pickNow();
  await collector()
    .getByText(/拾った 1 · 変更なし 0 · 動いている 0/)
    .waitFor();
  const afterResume = await records();
  assert.equal(afterResume.length, 2);
  const rest = afterResume.find((entry) => entry.id !== first.id);
  assert.equal(rest.started_at, first.ended_at);
  assert.match(rest.summary, /続きの作業/);
  assert.deepEqual(
    afterResume.find((entry) => entry.id === first.id),
    first,
  );

  // 途中で止める。止める合図が届く前に入った分は入る。「止まった時に入っていた数」と
  // 「報告された数」が合うことを見る（1 件も入っていない事は確かめない。合図と読み取りの競争なので）。
  const cancelFiles = Array.from({ length: 80 }, (_, index) =>
    path.join(logs, `cancel-synthetic-${index}.jsonl`),
  );
  for (const [index, target] of cancelFiles.entries()) {
    fs.writeFileSync(target, original.replaceAll("synthetic-rollout", `synthetic-cancel-${index}`));
    quiet(target);
  }
  const beforeCancel = (await records()).length;
  const stopped = await page.evaluate(async () => {
    const running = window.api.agentWorkLogs.sync();
    await window.api.agentWorkLogs.cancel();
    return running;
  });
  assert.ok(["cancelled", "idle"].includes(stopped.state), stopped.state);
  assert.ok(stopped.recorded <= 80);
  assert.equal((await records()).length - beforeCancel, stopped.recorded);
  if (stopped.state === "cancelled") assert.ok(stopped.scanned <= 81);
  // 止めた後にもう一度拾うと、残りが入り、同じ会話は 2 件にならない。
  await pickNow();
  await collector()
    .getByText(new RegExp(`拾った ${80 - stopped.recorded} ·`))
    .waitFor();
  assert.equal((await records()).length, beforeCancel + 80);
  for (const target of cancelFiles) fs.rmSync(target);
  // 消えたログの記録は消さない。
  await pickNow();
  await collector()
    .getByText(/見たログ 1 · 拾った 0 · 変更なし 1/)
    .waitFor();
  assert.equal((await records()).length, beforeCancel + 80);

  // subagentのthreadは親の会話の一部なので、単独では増えない。
  const subagent = original
    .replaceAll("synthetic-rollout", "synthetic-subagent")
    .replace(
      '"payload":{',
      '"payload":{"thread_source":"subagent","parent_thread_id":"synthetic-rollout",',
    );
  const subagentFile = path.join(logs, "rollout-subagent.jsonl");
  fs.writeFileSync(subagentFile, subagent);
  quiet(subagentFile);
  await pickNow();
  await collector()
    .getByText(/拾った 0 · 変更なし 2/)
    .waitFor();
  assert.equal((await records()).length, beforeCancel + 80);

  await collector().getByLabel("Tasken 起動中に5分ごとに拾う").check();
  await collector().getByLabel("Tasken 起動中に5分ごとに拾う").uncheck();
  await collector().getByText("保存先を追加・再確認", { exact: true }).click();
  await page.screenshot({ path: path.join(output, "desktop-picked-all.png") });
  await app.close();
  app = null;
  await launch();
  const persisted = await records();
  assert.equal(persisted.length, beforeCancel + 80);
  assert.ok(persisted.some((entry) => entry.id === first.id));
  await collector().locator(":scope > summary").click();
  await pickNow();
  await collector()
    .getByText(/拾った 0 · 変更なし 2/)
    .waitFor();
  assert.equal((await records()).length, beforeCancel + 80);
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
  // 登録を解いても、拾った記録は残る。
  assert.equal((await records()).length, beforeCancel + 80);
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        pickedUpOncePerConversation: true,
        activeConversationSkipped: true,
        continuationOnly: true,
        cancelRecordedBeforeStop: stopped.recorded,
        delegatedThreadSkipped: true,
        restart: true,
        widths: [1760, 390],
        privateLogsRead: false,
        errors,
      },
      null,
      2,
    ),
  );
  console.log("log pickup smoke passed");
} finally {
  if (app) await app.close();
  fs.rmSync(root, { recursive: true, force: true });
}
