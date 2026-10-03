import assert from "node:assert/strict";
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WORK_ATTEMPT_A, REQUEST_MEASUREMENT } from "../tests/fixtures/agentWorkScenarios.mjs";
import { runIntegratedBoardChecks } from "./task-board-integration-audit.mjs";

export async function runTaskBoardAudit(WorkspaceDatabase) {
  delete process.env.ELECTRON_RUN_AS_NODE;
  const output = "output/task-board-audit";
  mkdirSync(output, { recursive: true });
  const userData = mkdtempSync(path.join(os.tmpdir(), "tasken-board-audit-"));
  const databasePath = path.join(userData, "research-desk.sqlite");
  const seed = new WorkspaceDatabase(databasePath);
  seed.loadWorkspace();
  const assigned = seed.save("task", {
    id: "board-ai-task",
    title: "比較表の条件を決める",
    state: "doing",
    project_id: "theme-personal-default",
    intended_executor: "ai_agent",
    executor_identity: "Codex",
    work_attempt_id: WORK_ATTEMPT_A,
    handoff_instruction: "25℃と40℃を比較してください",
    handoff_expected_result: "比較表と根拠",
  });
  const task = seed.save("task", { ...assigned, work_state: "blocked" });
  function proposal(id, action, version, extra = {}) {
    return {
      id,
      payload_type: "task_work",
      status: "pending",
      source: "mcp",
      source_app: "codex",
      received_at: new Date().toISOString(),
      payload: {
        task_work: [
          {
            task_id: task.id,
            expected_version: version,
            idempotency_key: id,
            caller: "Codex",
            actor: { kind: "ai_agent" },
            source: "mcp",
            work_attempt_id: WORK_ATTEMPT_A,
            action,
            executor_kind: "ai_agent",
            executor_label: "Codex",
            summary: id,
            reported_at: new Date().toISOString(),
            ...extra,
          },
        ],
      },
    };
  }
  seed.save(
    "ai_proposal",
    proposal("board-question", "report_blocked", task.version, {
      request_id: REQUEST_MEASUREMENT,
      needed_input: ["どちらの温度で進めますか？"],
      blocker: "温度を確認しています",
    }),
  );
  for (let sequence = 1; sequence <= 3; sequence++) {
    seed.save(
      "ai_proposal",
      proposal(`board-progress-${sequence}`, "append_receipt", task.version, {
        summary: `進捗 ${sequence}`,
        report_sequence: sequence,
      }),
    );
  }
  seed.save("task", {
    id: "board-self-task",
    title: "週次の振り返り",
    state: "todo",
    repeat_rule: { frequency: "weekly", interval: 1, next_from: "completed" },
    project_id: "theme-personal-default",
  });
  seed.db.close();

  const integrated = process.argv.includes("--integrated");
  let app = await electron.launch({
    args: [".", "--disable-gpu", "--disable-gpu-compositing", `--user-data-dir=${userData}`],
    env: {
      ...process.env,
      TASKEN_USER_DATA_DIR: userData,
      ...(integrated ? { TASKEN_CORE_AI_ITEM_CREATE: "1" } : {}),
    },
  });
  const checks = [];
  let page;
  async function openBoard() {
    await page.locator(".sidebar button", { hasText: "ToDo" }).first().click();
    await page.getByRole("button", { name: /^未完了/ }).click();
    await page.getByRole("button", { name: "ボード", exact: true }).click();
    await page.locator(".task-board").waitFor();
  }
  async function openTask() {
    await page.getByRole("button", { name: task.title, exact: true }).click();
    await page.locator(".task-conversation").waitFor();
  }
  async function closeTask() {
    await page
      .locator(".drawer-header")
      .getByRole("button", { name: "閉じる", exact: true })
      .click();
  }
  try {
    page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await page.waitForLoadState("domcontentloaded");
    await page.evaluate(() => localStorage.setItem("tasken:shell:zoom-factor:v1", "1"));
    await page.reload();
    await openBoard();
    await page.screenshot({ path: `${output}/board-desktop.png` });
    assert.equal(await page.locator(".task-board-card").count(), 2);
    assert.match(await page.locator(".task-board").innerText(), /次: 自分 · 回答/);
    checks.push("同じTaskのボード表示・次の担当・空列");
    const recurring = page.getByRole("combobox", { name: "週次の振り返りのTask状態" });
    await recurring.focus();
    await recurring.press("ArrowDown");
    await recurring.press("Enter");
    await page.waitForTimeout(350);
    await recurring.selectOption("todo");
    await recurring.selectOption("done");
    await page.waitForTimeout(500);
    assert.equal(await page.locator(".task-board-card", { hasText: "週次の振り返り" }).count(), 1);
    checks.push("キーボード状態変更・戻す・繰返し完了で次Taskが1件");
    await openTask();
    const conversation = page.locator(".task-conversation");
    await conversation.getByRole("textbox", { name: "質問への返答" }).fill("25℃で進めてください");
    const conflict = new WorkspaceDatabase(databasePath);
    conflict.save("task", {
      ...conflict.get("task", task.id),
      description: "別画面で更新された条件",
    });
    conflict.db.close();
    await conversation.getByRole("button", { name: "回答を送る" }).click();
    await page.waitForTimeout(600);
    assert.equal(
      await conversation.getByRole("textbox", { name: "質問への返答" }).inputValue(),
      "25℃で進めてください",
    );
    assert.match(await page.locator("body").innerText(), /保存できませんでした/);
    await page.screenshot({ path: `${output}/save-conflict.png` });
    checks.push("版競合時は返答の途中入力を保持・再表示後に再試行");
    await closeTask();
    await page.reload();
    await openBoard();
    await openTask();
    await conversation.getByRole("textbox", { name: "質問への返答" }).fill("25℃で進めてください");
    await conversation.getByRole("button", { name: "回答を送る" }).click();
    await page.waitForTimeout(600);
    assert.match(await conversation.innerText(), /再開待ち/);
    const progressDisclosure = conversation.locator("details", { hasText: "進捗報告 3件" }).first();
    assert.equal(await progressDisclosure.getAttribute("open"), null);
    await progressDisclosure.locator("summary").click();
    assert.match(await progressDisclosure.innerText(), /進捗 3/);
    await progressDisclosure.locator("summary").click();
    checks.push("進捗報告を集約して展開・人の返答は常時表示");
    await conversation
      .getByRole("textbox", { name: "課題へのコメント" })
      .fill("比較表の根拠も残してください");
    await conversation.getByRole("button", { name: "コメントを保存" }).click();
    await page.waitForTimeout(500);
    await conversation.getByRole("textbox", { name: "課題へのコメント" }).fill("確認用の追記");
    await conversation.getByRole("button", { name: "コメントを保存" }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${output}/answered.png` });
    await closeTask();
    await openTask();
    assert.match(await page.locator(".task-conversation").innerText(), /確認用の追記/);
    checks.push("質問への返答・通常コメントはFeedへ保存・閉じて再open");
    await closeTask();
    // 架空agentの再開と成果報告を隔離DBにだけ追加する。ユーザー操作の検証は画面で行う。
    const fixture = new WorkspaceDatabase(databasePath);
    const current = fixture.get("task", task.id);
    const working = fixture.save("task", { ...current, work_state: "in_progress" });
    fixture.save(
      "ai_proposal",
      proposal("board-result", "report_done", working.version, {
        summary: "比較表を作成しました",
        verification: ["25℃の比較を確認"],
        remaining_work: ["40℃は未測定"],
      }),
    );
    fixture.db.close();
    await page.reload();
    await openBoard();
    await openTask();
    await page
      .locator(".task-conversation")
      .getByRole("textbox", { name: "修正してほしい内容" })
      .fill("40℃の未測定を明記してください");
    await page
      .locator(".task-conversation")
      .getByRole("button", { name: "修正を依頼", exact: true })
      .click();
    await page.waitForTimeout(600);
    assert.match(
      await page.locator(".task-conversation").innerText(),
      /40℃の未測定を明記してください/,
    );
    await page.screenshot({ path: `${output}/revision-requested.png` });
    checks.push("未採用報告へ修正依頼を保存・Taskは継続");
    await closeTask();
    const revised = new WorkspaceDatabase(databasePath);
    const resumed = revised.save("task", {
      ...revised.get("task", task.id),
      work_state: "in_progress",
    });
    revised.save(
      "ai_proposal",
      proposal("board-result-revised", "report_done", resumed.version, {
        summary: "比較表を修正しました",
        verification: ["25℃の比較を確認"],
        remaining_work: ["40℃は未測定と明記"],
        external_references: [
          { kind: "file", url: "https://example.com/comparison", display_label: "比較表" },
        ],
      }),
    );
    revised.db.close();
    await page.reload();
    await openBoard();
    await openTask();
    await page.screenshot({ path: `${output}/review-ready.png` });
    await page
      .locator(".task-conversation")
      .getByRole("button", { name: "報告を採用", exact: true })
      .click();
    await page.waitForTimeout(700);
    assert.match(await page.locator(".task-conversation").innerText(), /Taskは継続/);
    await closeTask();
    await page.locator(".sidebar button", { hasText: "Feed" }).first().click();
    await page.locator('.app-titlebar button[aria-label^="前の画面に戻る"]').click();
    await page.locator(".task-board").waitFor();
    checks.push("別画面へ移動して戻ってもボード表示を保持");
    assert.equal(
      await page.getByRole("combobox", { name: `${task.title}のTask状態` }).inputValue(),
      "doing",
    );
    await page.getByRole("combobox", { name: `${task.title}のTask状態` }).selectOption("done");
    await page.waitForTimeout(700);
    await page.getByRole("button", { name: /^完了/ }).click();
    await openTask();
    assert.match(await page.locator(".task-conversation").innerText(), /Task完了/);
    checks.push("成果報告→報告採用はTask継続→明示Task完了");
    await page.screenshot({ path: `${output}/accepted-completed.png` });
    await closeTask();
    for (const width of [820, 420]) {
      await app.evaluate(({ BrowserWindow }, width) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.setMinimumSize(320, 400);
        win.setSize(width, 900);
      }, width);
      await page.waitForTimeout(2800);
      await page.screenshot({ path: `${output}/board-${width}.png` });
      const bounds = await page
        .locator(".task-board")
        .evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));
      assert.ok(bounds.scroll <= bounds.client + 1, JSON.stringify(bounds));
    }
    checks.push("Fold幅・スマホ幅でボード内横overflowなし");
    await page.reload();
    await page.locator(".task-board").waitFor();
    checks.push("reload後も保存状態を再表示");
    const readback = new WorkspaceDatabase(databasePath);
    assert.equal(readback.get("task", task.id).state, "done");
    assert.equal(
      readback.list("work_receipt").filter((row) => row.receipt_kind === "human_reply").length,
      1,
    );
    assert.equal(readback.list("feed_post").length, 1);
    assert.equal(readback.list("feed_reply").length, 1);
    readback.db.close();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 900));
    if (integrated) {
      const active = app;
      app = null;
      checks.push(
        ...(await runIntegratedBoardChecks({
          app: active,
          page,
          WorkspaceDatabase,
          userData,
          databasePath,
          output,
        })),
      );
    }
    writeFileSync(
      `${output}/result.json`,
      JSON.stringify({ checks, userData, databasePath }, null, 2),
    );
    console.log(JSON.stringify({ checks, userData }));
  } catch (error) {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: `${output}/failure.png` });
      console.error((await page.locator("body").innerText()).slice(-4500));
    }
    throw error;
  } finally {
    await app?.close();
  }
}
