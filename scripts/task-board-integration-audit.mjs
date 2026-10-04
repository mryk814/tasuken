import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { _electron as electron } from "playwright";
import path from "node:path";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { TaskenCoreClient } from "../src/main/mcp/taskenCoreClient.mjs";
import { SharedFolderSyncService } from "../src/main/services/sharedFolderSync.mjs";

export async function runIntegratedBoardChecks({
  app,
  page,
  WorkspaceDatabase,
  userData,
  databasePath,
  output,
}) {
  const checks = [];
  const env = { ...process.env, TASKEN_USER_DATA_DIR: userData, TASKEN_CORE_AI_ITEM_CREATE: "1" };
  const core = new TaskenCoreClient({ env });
  const request = (kind) => ({
    kind,
    title: kind === "task" ? "AI作成から同じ課題で一周" : "AI作成の統合確認メモ",
    body: "隔離統合検証。実データとは別です。",
    caller: "Codex",
    source_app: "integrated-board-audit",
    source_session: "isolated",
    idempotency_key: `board-integration-${kind}`,
    reason: "本人の思いつきを保存",
  });
  let replicaApp;
  async function board(target) {
    await target.locator(".sidebar button", { hasText: "ToDo" }).first().click();
    await target.getByRole("button", { name: /^未完了/ }).click();
    await target.getByRole("button", { name: "ボード", exact: true }).click();
    await target.locator(".task-board").waitFor();
  }
  async function closeTask(target) {
    await target
      .locator(".drawer-header")
      .getByRole("button", { name: "閉じる", exact: true })
      .click();
  }
  try {
    const task = (await core.createAiItem(request("task"))).entity;
    const note = (await core.createAiItem(request("note"))).entity;
    await page.getByRole("button", { name: /^未完了/ }).click();
    await page.getByRole("button", { name: "一覧", exact: true }).click();
    const row = page.locator(".table-row", { hasText: task.title }).first();
    await row.waitFor();
    assert.equal(
      await row.getByRole("button", { name: "AI作成 · 未確認。作成元を表示", exact: true }).count(),
      1,
    );
    assert.equal(await row.locator(".ai-creation-dot").count(), 1);
    const listTitles = await page
      .locator(".table-row .row-title > span:first-child")
      .allTextContents();
    await page.screenshot({ path: `${output}/integrated-list-unseen.png` });
    await page.getByRole("button", { name: "ボード", exact: true }).click();
    let card = page.locator(".task-board-card", { hasText: task.title });
    const originButton = card.getByRole("button", {
      name: "AI作成 · 未確認。作成元を表示",
      exact: true,
    });
    assert.equal(await originButton.count(), 1);
    assert.equal(await card.locator(".ai-creation-dot").count(), 1);
    await originButton.focus();
    await page.keyboard.press("Enter");
    await page
      .locator(".ai-creation-explanation:popover-open")
      .getByText("AI作成 · 未確認", { exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
    assert.equal(
      await originButton.evaluate((element) => element === document.activeElement),
      true,
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const width of [420, 820, 1400]) {
      await app.evaluate(
        ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 900),
        width,
      );
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${output}/ai-origin-board-${width}.png` });
      const size = await originButton.boundingBox();
      assert.ok(size.width >= 32 && size.height >= 32);
      const bounds = await page
        .locator(".task-board")
        .evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
      assert.ok(bounds.scroll <= bounds.client + 1);
    }
    await page.emulateMedia({ reducedMotion: "no-preference" });
    checks.push(
      "AI由来アイコン/未確認点、キーボードで説明→Escape focus復帰、420/820/1400幅と動きを減らす設定",
    );
    assert.equal(await page.locator(".task-board-card").count(), 2);
    assert.deepEqual(
      (await page.locator(".task-board-title").allTextContents()).sort(),
      listTitles.sort(),
    );
    await card.getByRole("button", { name: task.title, exact: true }).click();
    await page
      .locator(".drawer-content")
      .getByRole("button", { name: "AI作成 · 未確認。作成元を表示", exact: true })
      .click();
    const creation = page.locator(".ai-creation-explanation:popover-open");
    await creation.getByRole("button", { name: "見た", exact: true }).click();
    await creation.getByText("AI作成 · 既読", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".drawer").count(), 1);
    await closeTask(page);
    await page.reload();
    await board(page);
    assert.equal(await card.locator(".ai-creation-dot").count(), 0);
    const seen = (await core.createAiItem(request("task"))).entity;
    assert(seen.ai_seen_at);
    assert.deepEqual(seen.ai_creation, task.ai_creation);
    const seenStore = new WorkspaceDatabase(databasePath);
    assert.equal(seenStore.get("task", task.id).state, "todo");
    assert.equal(seenStore.get("task", task.id).work_state, "not_delegated");
    seenStore.db.close();
    checks.push("実CoreのAI Task作成→同じTaskを一覧/ボード→viewで既読、状態とAI作成由来は不変");
    await card.getByRole("button", { name: task.title, exact: true }).click();
    await page
      .locator("details", { hasText: "AIへの依頼・任せ直す" })
      .first()
      .locator("summary")
      .first()
      .click();
    const handoff = page.locator(".task-handoff");
    await handoff.getByLabel("任せる相手").selectOption("codex");
    await handoff.getByLabel("期待する成果（任意）").fill("比較表と根拠");
    await handoff.getByLabel("追加指示（任意）").fill("25℃と40℃を比較してください");
    // Keep the user's OS clipboard intact; this audit validates the saved handoff.
    await app.evaluate(({ clipboard }) => {
      clipboard.writeText = () => {};
    });
    await handoff.getByRole("button", { name: "AIへの依頼を準備", exact: true }).click();
    await handoff.getByText("開始待ち", { exact: true }).waitFor();
    await closeTask(page);
    if (process.argv.includes("--all-features")) {
      await card.getByRole("combobox", { name: `${task.title}のTask状態` }).selectOption("doing");
      const prepared = new WorkspaceDatabase(databasePath);
      const ready = prepared.get("task", task.id);
      prepared.db.close();
      await app.close();
      app = null;
      const bundlePath = path.resolve(output, "limited-start-core.mjs");
      await build({
        stdin: {
          contents:
            'export { startTaskenHeadlessCore } from "./src/main/headless/taskenHeadlessCore.ts";',
          resolveDir: process.cwd(),
        },
        bundle: true,
        platform: "node",
        format: "esm",
        packages: "external",
        alias: { electron: path.resolve("src/main/headless/electronUnavailable.ts") },
        outfile: bundlePath,
        logLevel: "silent",
      });
      const { startTaskenHeadlessCore } = await import(pathToFileURL(bundlePath).href);
      const limited = await startTaskenHeadlessCore({
        userDataPath: userData,
        writeMode: "create-only",
        allowAiTaskStart: true,
        env: {},
      });
      try {
        const client = new TaskenCoreClient({ userDataPath: userData });
        const request = {
          task_id: task.id,
          expected_version: ready.version,
          idempotency_key: "integrated-limited-start",
          caller: "Codex",
          started_at: new Date().toISOString(),
          work_attempt_id: ready.work_attempt_id || randomUUID(),
          source_session: "isolated-combined-session",
        };
        const started = await client.startAiTaskWork(request);
        assert(started.ok, JSON.stringify(started));
        assert.equal(started.value.task.work_state, "in_progress");
        assert.equal(started.value.task.work_attempt_id, request.work_attempt_id);
        assert.equal((await client.startAiTaskWork(request)).value.task.id, task.id);
        const status = await client.inspect();
        assert(status.capabilities.includes("task.start_work"));
        assert(!status.capabilities.includes("task.command"));
      } finally {
        await limited.stop();
      }
      app = await electron.launch({
        args: [".", "--disable-gpu", "--disable-gpu-compositing", `--user-data-dir=${userData}`],
        env,
      });
      page = await app.firstWindow();
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.setMinimumSize(0, 0);
        window.setContentSize(1400, 900);
      });
      await board(page);
      card = page.locator(".task-board-card", { hasText: task.title });
      checks.push(
        "人のAI Ready依頼→独立opt-in開始専用Core→同一attemptの再送→ボード再起動、汎用Task権限は非公開",
      );
    }
    const fixture = new WorkspaceDatabase(databasePath);
    const assigned = fixture.get("task", task.id);
    assert.equal(assigned.handoff_instruction, "25℃と40℃を比較してください");
    const working = process.argv.includes("--all-features")
      ? assigned
      : fixture.save("task", {
          ...assigned,
          state: "doing",
          work_state: "in_progress",
        });
    function report(id, action, current, extra = {}) {
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
              expected_version: current.version,
              idempotency_key: id,
              caller: "Codex",
              actor: { kind: "ai_agent" },
              source: "mcp",
              work_attempt_id: current.work_attempt_id,
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
    fixture.save(
      "ai_proposal",
      report("integration-question", "report_blocked", working, {
        request_id: randomUUID(),
        needed_input: ["温度を指定してください"],
        blocker: "温度の確認待ち",
      }),
    );
    fixture.db.close();
    await page.reload();
    await board(page);
    await card.getByRole("button", { name: task.title, exact: true }).click();
    const conversation = page.locator(".task-conversation");
    await conversation.getByRole("textbox", { name: "質問への返答" }).fill("25℃で進めてください");
    const conflict = new WorkspaceDatabase(databasePath);
    conflict.save("task", { ...conflict.get("task", task.id), description: "別端末の更新" });
    conflict.db.close();
    await conversation.getByRole("button", { name: "回答を送る" }).click();
    await page
      .getByText(/保存できませんでした/)
      .first()
      .waitFor();
    assert.equal(
      await conversation.getByRole("textbox", { name: "質問への返答" }).inputValue(),
      "25℃で進めてください",
    );
    await closeTask(page);
    await page.reload();
    await board(page);
    await card.getByRole("button", { name: task.title, exact: true }).click();
    await conversation.getByRole("textbox", { name: "質問への返答" }).fill("25℃で進めてください");
    await conversation.getByRole("button", { name: "回答を送る" }).click();
    await conversation.getByText("25℃で進めてください", { exact: true }).waitFor();
    assert.equal(await conversation.getByRole("textbox", { name: "質問への返答" }).count(), 0);
    // in_progress stays working; answered_resume_waiting is derived only from blocked.
    assert.match(await conversation.innerText(), /次: AI · 作業中/);
    await conversation
      .getByRole("textbox", { name: "課題へのコメント" })
      .fill("比較表の根拠も記載してください");
    await conversation.getByRole("button", { name: "コメントを保存" }).click();
    await conversation.getByText("比較表の根拠も記載してください", { exact: true }).waitFor();
    await closeTask(page);
    const result = new WorkspaceDatabase(databasePath);
    const resumed = result.save("task", {
      ...result.get("task", task.id),
      work_state: "in_progress",
    });
    result.save(
      "ai_proposal",
      report("integration-result", "report_done", resumed, {
        summary: "比較表を作成しました",
        verification: ["25℃の根拠を確認"],
        remaining_work: ["40℃は未測定"],
      }),
    );
    result.db.close();
    await page.reload();
    await board(page);
    await card.getByRole("button", { name: task.title, exact: true }).click();
    assert.equal(
      await conversation.getByRole("button", { name: "Taskを完了", exact: true }).count(),
      0,
    );
    await conversation.getByRole("button", { name: "報告を採用", exact: true }).click();
    await conversation
      .getByText(/Taskは継続/)
      .first()
      .waitFor();
    await conversation.getByRole("button", { name: "Taskを完了", exact: true }).waitFor();
    await page.screenshot({ path: `${output}/integrated-conversation.png` });
    const accepted = new WorkspaceDatabase(databasePath);
    assert.equal(accepted.get("task", task.id).state, "doing");
    assert.equal(accepted.get("task", task.id).work_state, "accepted");
    assert.deepEqual(accepted.get("task", task.id).ai_creation, task.ai_creation);
    assert(accepted.get("task", task.id).ai_seen_at);
    accepted.db.close();
    checks.push("AI作成Taskを同じIDで依頼→質問→競合時入力保持→返答→成果報告→採用、Task継続");
    if (process.argv.includes("--all-features")) {
      await closeTask(page);
      await page.locator(".sidebar button", { hasText: "Debrief" }).first().click();
      const logs = page.getByRole("region", { name: "AI作業ログ", exact: true });
      await logs.getByRole("button", { name: "AI作業ログを取り込む", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "AI作業ログを取り込む", exact: true });
      await dialog
        .locator('input[type="file"]')
        .setInputFiles(path.resolve("fixtures/agent-work-logs/codex.json"));
      await dialog.getByRole("button", { name: "確認へ進む", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      const detail = page.getByRole("complementary", { name: "選択Sessionの詳細", exact: true });
      await detail.getByRole("button", { name: "採用", exact: true }).click();
      await detail
        .getByRole("button", { name: "採用", exact: true })
        .waitFor({ state: "detached" });
      await logs.getByLabel("表示日").fill("2026-10-03");
      await logs.getByRole("button", { name: "週", exact: true }).click();
      assert.equal(await logs.locator(".agent-log-block").count(), 1);
      await page.screenshot({ path: `${output}/combined-work-log-desktop.png` });
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.setMinimumSize(0, 0);
        window.setContentSize(420, 844);
      });
      await logs.locator(".agent-log-block").click();
      await page.getByRole("dialog", { name: "選択Sessionの詳細", exact: true }).waitFor();
      await page.screenshot({ path: `${output}/combined-work-log-narrow.png` });
      await page.keyboard.press("Escape");
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setContentSize(1400, 900),
      );
      const imported = new WorkspaceDatabase(databasePath);
      assert.equal(imported.list("agent_session").length, 1);
      assert.equal(imported.list("agent_session")[0].observation.mode, "history");
      assert.notEqual(imported.list("agent_session")[0].status, "active");
      assert.equal(imported.get("task", task.id).state, "doing");
      assert.equal(imported.get("task", task.id).work_state, "accepted");
      imported.db.close();
      await board(page);
      card = page.locator(".task-board-card", { hasText: task.title });
      await card.getByRole("button", { name: task.title, exact: true }).click();
      await page
        .locator(".task-conversation")
        .getByText("25℃で進めてください", { exact: true })
        .waitFor();
      checks.push(
        "同じ隔離workspaceでログfixtureをpreview→採用、420幅の詳細→ボードへ戻り人の返答とTask継続を保持",
      );
    }
    await closeTask(page);
    await page.locator(".sidebar button", { hasText: "Notes" }).first().click();
    const noteRow = page.locator(".note-row", { hasText: note.title });
    await noteRow.locator(".ai-creation-mark").first().waitFor();
    assert.equal(await noteRow.locator(".ai-creation-mark").count(), 1);
    await page.getByText(note.title, { exact: true }).first().click();
    await page.locator(".note-preview-panel .ai-creation-mark").first().waitFor();
    assert.equal(await page.locator(".note-preview-panel .ai-creation-mark").count(), 1);
    await page
      .locator(".note-preview-panel")
      .getByRole("button", { name: "AI作成 · 未確認。作成元を表示", exact: true })
      .click();
    await page
      .locator(".ai-creation-explanation:popover-open")
      .getByRole("button", { name: "見た", exact: true })
      .click();
    await page
      .locator(".ai-creation-explanation:popover-open")
      .getByText("AI作成 · 既読", { exact: true })
      .waitFor();
    checks.push("AI Note直接作成と未確認/既読UIも共存");
    await app.close();
    app = null;
    const first = new WorkspaceDatabase(databasePath);
    const secondDirectory = path.join(userData, "isolated-replica");
    const second = new WorkspaceDatabase(path.join(secondDirectory, "research-desk.sqlite"));
    second.loadWorkspace();
    const shared = path.join(userData, "isolated-shared");
    const firstSync = new SharedFolderSyncService(first);
    const secondSync = new SharedFolderSyncService(second);
    try {
      await firstSync.configure(shared);
      await secondSync.configure(shared);
      assert.equal(first.workspaceId, second.workspaceId);
      for (const type of [
        "task",
        "note",
        "ai_proposal",
        "work_receipt",
        "feed_post",
        "feed_reply",
        ...(process.argv.includes("--all-features") ? ["agent_session", "reference"] : []),
      ]) {
        assert.deepEqual(
          second
            .list(type)
            .map((x) => x.id)
            .sort(),
          first
            .list(type)
            .map((x) => x.id)
            .sort(),
          type,
        );
      }
      assert.deepEqual(second.get("task", task.id).ai_creation, task.ai_creation);
      assert(second.get("task", task.id).ai_seen_at);
      assert.equal(second.get("task", task.id).work_state, "accepted");
      assert(second.get("note", note.id).ai_seen_at);
      const comment = second.list("feed_post").find((x) => x.task_id === task.id);
      assert(comment);
      second.save("feed_reply", {
        id: randomUUID(),
        post_id: comment.id,
        body: "別端末からの追記",
        author_kind: "self",
        source: "manual",
        created_at: new Date().toISOString(),
      });
      second.save("task", { ...second.get("task", task.id), state: "waiting" });
      await secondSync.syncNow();
      await firstSync.syncNow();
      assert.equal(first.get("task", task.id).state, "waiting");
      assert(first.list("feed_reply").some((x) => x.body === "別端末からの追記"));
    } finally {
      await firstSync.stop();
      await secondSync.stop();
      first.db.close();
      second.db.close();
    }
    checks.push(
      "一時共有folderの2端末でTask/Note/既読/Proposal/Receipt/Feedを同期し状態と返信を往復",
    );
    app = await electron.launch({
      args: [".", "--disable-gpu", "--disable-gpu-compositing", `--user-data-dir=${userData}`],
      env,
    });
    page = await app.firstWindow();
    await board(page);
    const restoredCard = page.locator(".task-board-card", { hasText: task.title });
    assert.equal(
      await restoredCard.getByRole("combobox", { name: `${task.title}のTask状態` }).inputValue(),
      "waiting",
    );
    assert.equal(await restoredCard.locator(".ai-creation-dot").count(), 0);
    await restoredCard.getByRole("button", { name: task.title, exact: true }).click();
    await page
      .locator(".task-conversation")
      .getByText("別端末からの追記", { exact: true })
      .waitFor();
    assert.match(await page.locator(".task-conversation").innerText(), /25℃で進めてください/);
    await page.screenshot({ path: `${output}/integrated-restart-sync.png` });
    await app.close();
    app = null;
    replicaApp = await electron.launch({
      args: [
        ".",
        "--disable-gpu",
        "--disable-gpu-compositing",
        `--user-data-dir=${secondDirectory}`,
      ],
      env: { ...env, TASKEN_USER_DATA_DIR: secondDirectory },
    });
    const replicaPage = await replicaApp.firstWindow();
    await board(replicaPage);
    await replicaPage.getByRole("button", { name: task.title, exact: true }).click();
    await replicaPage
      .locator(".task-conversation")
      .getByText("別端末からの追記", { exact: true })
      .waitFor();
    await replicaPage.screenshot({ path: `${output}/integrated-replica.png` });
    checks.push("実Electron終了/再起動後と同期先の別profileで同じ課題/会話/既読を表示");
    return checks;
  } catch (error) {
    if (!page.isClosed()) {
      await page.screenshot({ path: `${output}/integrated-failure.png` });
      console.error((await page.locator("body").innerText()).slice(-4500));
    }
    throw error;
  } finally {
    await app?.close();
    await replicaApp?.close();
  }
}
