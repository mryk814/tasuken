// ローカルのAI（Claude Codeなど）が、本人の言葉を根拠に既存のTaskを直接変える入口（#703）。
// Desktopと同じ配線で、Core HTTPと実stdioのMCPから確かめる。データは一時フォルダの架空のもの。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildMcpBridge } from "../scripts/build-mcp-bridge.mjs";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import { TaskenCoreClient } from "../src/main/mcp/taskenCoreClient.mjs";

const bundles = fs.mkdtempSync(path.join(process.cwd(), ".ai-task-change-test-"));
after(() => fs.rmSync(bundles, { recursive: true, force: true }));
const mcpDirectory = path.join(bundles, "mcp");
await buildMcpBridge({ outDir: mcpDirectory });
await build({
  stdin: {
    contents: `
    export { WorkspaceService } from "./src/main/services/workspaceService.ts";
    export { ApplicationCommandService } from "./src/main/services/applicationCommandService.ts";
    export { createAiItemCreationPort } from "./src/main/composition/aiItemCreationPort.ts";
    export { createAiTaskChangeService } from "./src/main/composition/aiTaskChangePort.ts";
    export { TaskenCoreRuntime } from "./src/main/composition/taskenCoreRuntime.ts";
  `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  alias: { electron: path.resolve("src/main/headless/electronUnavailable.ts") },
  outfile: path.join(bundles, "core.mjs"),
  logLevel: "silent",
});
const {
  WorkspaceService,
  ApplicationCommandService,
  createAiItemCreationPort,
  createAiTaskChangeService,
  TaskenCoreRuntime,
} = await import(pathToFileURL(path.join(bundles, "core.mjs")));

/** Desktopと同じ配線のCore。設定は既定で有効にしておく（無効の確かめは個別に）。 */
async function desktop(t, { enabled = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-ai-task-change-"));
  const db = new WorkspaceDatabase(path.join(dir, "research-desk.sqlite"));
  db.loadWorkspace();
  db.save("theme", { id: "theme-work", name: "仕事" });
  if (enabled) db.setPreference("aiDirectWriteEnabled", true);
  const workspace = new WorkspaceService(db, dir, undefined, undefined, () => {
    throw Error("no images");
  });
  const commands = new ApplicationCommandService(db);
  const isEnabled = () => db.readPreference("aiDirectWriteEnabled") === true;
  const runtime = new TaskenCoreRuntime(
    dir,
    db,
    (command) => commands.execute(command),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { executeAiTaskStart: (command) => commands.executeAiTaskStart(command, "any") },
  );
  runtime.enableAiItemCreation(createAiItemCreationPort(commands, workspace), {
    isEnabled,
    scope: "any",
  });
  const changes = createAiTaskChangeService(db, commands, isEnabled);
  runtime.enableAiTaskChange(changes);
  await runtime.start();
  t.after(async () => {
    await runtime.stop();
    db.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, db, commands, changes, core: new TaskenCoreClient({ userDataPath: dir }) };
}

function humanTask(db, id, extra = {}) {
  return db.save("task", {
    id,
    title: "四半期の資料",
    description: "本人が作ったTask",
    project_id: "theme-work",
    state: "todo",
    priority: "normal",
    requester: "self",
    intended_executor: "self",
    work_state: "not_delegated",
    ...extra,
  });
}

let keySequence = 0;
function change(task, extra = {}) {
  keySequence += 1;
  return {
    action: "update",
    task_id: task.id,
    expected_version: Number(task.version),
    idempotency_key: `change-${keySequence}`,
    caller: "Claude Code",
    source_session: "conversation-a",
    ...extra,
  };
}

async function refused(promise, code) {
  let caught;
  await assert.rejects(promise, (error) => {
    caught = error;
    return error.code === code;
  });
  return caught;
}

test("設定が無効なら断り、有効にするとその場で使える", async (t) => {
  const { db, core } = await desktop(t, { enabled: false });
  const task = humanTask(db, "task-off");
  await refused(
    core.changeTask(change(task, { changes: { title: "変更" }, said: "題名を変えて" })),
    "DIRECT_WRITE_DISABLED",
  );
  db.setPreference("aiDirectWriteEnabled", true);
  const result = await core.changeTask(
    change(task, { changes: { title: "変更" }, said: "題名を変えて" }),
  );
  assert.equal(result.status, "applied");
  assert.equal(db.get("task", task.id).title, "変更");
});

test("本人が作ったTaskは本人の言葉が要り、根拠と出所が来歴に残る", async (t) => {
  const { db, core } = await desktop(t);
  const task = humanTask(db, "task-human");
  const asked = await refused(
    core.changeTask(change(task, { changes: { title: "AIの判断" }, why: "古そうだったので" })),
    "ASK_USER",
  );
  assert.equal(asked.status, 422);
  assert.equal(asked.details.reason, "needs_user_words");
  assert.equal(db.get("task", task.id).title, "四半期の資料");

  const applyRequest = change(task, {
    changes: {
      title: "四半期の資料（確定版）",
      priority: "high",
      schedule: { end_date: "2026-11-20" },
      checklist: [{ title: "表を直す" }, { title: "送る", done: true }],
    },
    said: "期限を20日にして、題名に確定版と付けて",
  });
  const result = await core.changeTask(applyRequest);
  assert.equal(result.status, "applied");
  assert.equal(result.task.title, "四半期の資料（確定版）");
  assert.equal(result.task.priority, "high");
  assert.equal(result.task.schedule.end_date, "2026-11-20");
  assert.equal(result.task.schedule.date_kind, "deadline");
  assert.deepEqual(
    result.task.checklist_items.map((item) => [item.title, item.done, Boolean(item.completed_at)]),
    [
      ["表を直す", false, false],
      ["送る", true, true],
    ],
  );
  const events = db.listChangeEventsByCommandId(result.change_id);
  assert(events.length >= 2, "Taskと日程の両方のEventが残る");
  for (const event of events) {
    assert.equal(event.actor_kind, "ai_agent");
    assert.equal(event.source, "ai");
    assert.equal(event.metadata.ai_direct.said, "期限を20日にして、題名に確定版と付けて");
    assert.equal(event.metadata.ai_direct.source_session, "conversation-a");
  }

  // 同じ鍵で内容が違えば競合。
  await refused(
    core.changeTask({ ...applyRequest, changes: { title: "別の内容" } }),
    "IDEMPOTENCY_CONFLICT",
  );

  // 古い版は今のTaskを添えて409。
  const stale = await refused(
    core.changeTask(change(task, { changes: { title: "古い版から" }, said: "変えて" })),
    "CONFLICT",
  );
  assert.equal(stale.status, 409);
  assert.equal(stale.details.current_task.title, "四半期の資料（確定版）");

  // 許可リストの外の欄は入力の時点で断る。
  for (const extra of [
    { state: "done" },
    { ai_authority: "user_confirmed" },
    { work_state: "accepted" },
  ])
    await refused(
      core.changeTask(change(result.task, { changes: extra, said: "変えて" })),
      "VALIDATION_FAILED",
    );
  // 日程を消す。
  const current = db.get("task", task.id);
  const cleared = await core.changeTask(
    change(current, { changes: { schedule: null }, said: "期限は無しで" }),
  );
  assert.equal(cleared.task.schedule.end_date, null);
});

test("同じ鍵の再送は二重にならない", async (t) => {
  const { db, core } = await desktop(t);
  const task = humanTask(db, "task-retry");
  const request = change(task, { changes: { title: "一度だけ" }, said: "題名を変えて" });
  const first = await core.changeTask(request);
  const second = await core.changeTask(request);
  assert.equal(first.status, "applied");
  assert.equal(second.status, "duplicate");
  assert.equal(second.change_id, first.change_id);
  assert.equal(db.get("task", task.id).version, first.task.version);
});

test("AIが作って本人がまだ触っていないTaskは、本人の言葉なしで直せる", async (t) => {
  const { db, core, commands } = await desktop(t);
  const created = await core.createAiItem({
    kind: "task",
    title: "AIが作ったTask",
    caller: "Claude Code",
    idempotency_key: "created-1",
  });
  let task = db.get("task", created.entity.id);
  const edited = await core.changeTask(
    change(task, { changes: { title: "AIが直した題名" }, why: "誤字を直す" }),
  );
  assert.equal(edited.status, "applied");
  // 本人が一度でも触ったら、本人の言葉が要る。
  task = db.get("task", task.id);
  commands.execute({
    commandId: "human-edit",
    name: "UpdateTask",
    actor: { kind: "user" },
    source: "main_ui",
    issuedAt: new Date().toISOString(),
    payload: { task: { ...task, description: "本人のメモ" } },
    expectedVersions: [{ type: "task", id: task.id, version: task.version }],
  });
  task = db.get("task", task.id);
  await refused(
    core.changeTask(change(task, { changes: { title: "また直す" }, why: "誤字" })),
    "ASK_USER",
  );
  // AIの作成そのものを取り消せる（本人が触った後は、版が進んでいるので断る）。
  const undone = await core.undoChange({
    change_id: created.entity.ai_creation.command_id,
    why: "間違えて作った",
    idempotency_key: "undo-created",
    caller: "Claude Code",
    source_session: "conversation-a",
  });
  assert.equal(undone.undone.length, 0);
  assert.equal(undone.stopped.code, "CONFLICT");

  const other = await core.createAiItem({
    kind: "task",
    title: "すぐ消すTask",
    caller: "Claude Code",
    idempotency_key: "created-2",
  });
  const removed = await core.undoChange({
    change_id: other.entity.ai_creation.command_id,
    why: "間違えて作った",
    idempotency_key: "undo-created-2",
    caller: "Claude Code",
    source_session: "conversation-a",
  });
  assert.equal(removed.undone.length, 1);
  assert(db.get("task", other.entity.id, true).deleted_at);
});

test("委任して開始すると、作業中は直接いじれない。完了・再開・繰り返し・削除", async (t) => {
  const { db, core } = await desktop(t);
  let task = humanTask(db, "task-delegate");
  const delegated = await core.changeTask(
    change(task, {
      changes: { intended_executor: "ai_agent", handoff_instruction: "資料の誤字を探す" },
      said: "これやっといて",
    }),
  );
  assert.equal(delegated.task.intended_executor, "ai_agent");
  assert.equal(delegated.task.work_state, "ready_for_agent");
  const started = await core.startAiTaskWork({
    task_id: task.id,
    expected_version: delegated.task.version,
    idempotency_key: "start-delegated",
    caller: "Claude Code",
    started_at: new Date().toISOString(),
    work_attempt_id: "2b0f6a63-4f8e-4f5a-9c8b-3f6f4e1d2a10",
  });
  assert.equal(started.ok, true);
  task = db.get("task", task.id);
  assert.equal(task.work_state, "in_progress");
  await refused(
    core.changeTask(change(task, { action: "complete", changes: undefined, said: "終わり" })),
    "DELEGATED_IN_PROGRESS",
  );

  const plain = humanTask(db, "task-complete");
  const completed = await core.changeTask(
    change(plain, { action: "complete", completion_note: "済み", said: "これ終わった" }),
  );
  assert.equal(completed.task.state, "done");
  const reopened = await core.changeTask(
    change(completed.task, { action: "reopen", said: "やっぱりまだ" }),
  );
  assert.equal(reopened.task.state, "todo");

  const recurring = humanTask(db, "task-recurring", {
    repeat_rule: { frequency: "weekly", interval: 1, next_from: "completed" },
  });
  await refused(
    core.changeTask(change(recurring, { action: "complete", said: "終わった" })),
    "COMPLETE_IN_DESKTOP",
  );

  const doomed = humanTask(db, "task-delete");
  const deleted = await core.changeTask(change(doomed, { action: "delete", said: "これ消して" }));
  assert(deleted.task.deleted_at);
  const restored = await core.undoChange({
    change_id: deleted.change_id,
    said: "やっぱり戻して",
    idempotency_key: "undo-delete",
    caller: "Claude Code",
    source_session: "conversation-a",
  });
  assert.equal(restored.undone.length, 1);
  assert.equal(db.get("task", doomed.id).deleted_at, null);
});

test("取り消し: 前の値に戻し、二度は戻さず、後から変わっていれば止める", async (t) => {
  const { db, core } = await desktop(t);
  const task = humanTask(db, "task-undo");
  const edited = await core.changeTask(
    change(task, {
      changes: { title: "AIの題名", schedule: { start_date: "2026-11-12" } },
      said: "題名と日を変えて",
    }),
  );
  const undoRequest = (extra) => ({
    change_id: edited.change_id,
    idempotency_key: `undo-${(keySequence += 1)}`,
    caller: "Claude Code",
    source_session: "conversation-a",
    ...extra,
  });
  // 本人の言葉で決めた変更は、本人の言葉なしに戻さない。
  await refused(core.undoChange(undoRequest({ why: "戻したい" })), "ASK_USER");
  const undone = await core.undoChange(undoRequest({ said: "さっきの戻して" }));
  assert.equal(undone.undone.length, 1);
  const back = db.get("task", task.id);
  assert.equal(back.title, "四半期の資料");
  const schedule = db.list("schedule").find((entry) => entry.owner_id === task.id);
  assert.equal(schedule.start_date, null);
  const again = await core.undoChange(undoRequest({ said: "戻して" }));
  assert.equal(again.stopped.code, "ALREADY_UNDONE");

  const second = await core.changeTask(
    change(back, { changes: { title: "二回目" }, said: "題名を変えて" }),
  );
  db.save("task", { ...db.get("task", task.id), description: "本人が後から書いた" });
  const blocked = await core.undoChange({
    change_id: second.change_id,
    said: "戻して",
    idempotency_key: "undo-after-human",
    caller: "Claude Code",
    source_session: "conversation-a",
  });
  assert.equal(blocked.undone.length, 0);
  assert.equal(blocked.stopped.code, "CONFLICT");
  assert.equal(blocked.stopped.current_task.description, "本人が後から書いた");
  assert.equal(db.get("task", task.id).title, "二回目");
});

test("本人はDesktopの画面からAIの変更を取り消せる。本人の操作として残り、設定を止めた後でも使える", async (t) => {
  const { db, core, changes } = await desktop(t);
  const task = humanTask(db, "task-user-undo");
  const edited = await core.changeTask(
    change(task, { changes: { title: "AIが付けた題名" }, said: "題名を変えて" }),
  );
  db.setPreference("aiDirectWriteEnabled", false);
  const result = changes.undoByUser(edited.change_id);
  assert.equal(result.stopped, null);
  assert.equal(db.get("task", task.id).title, "四半期の資料");
  const undoEvents = db.listChangeEventsByCommandId(result.undone[0].undo_change_id);
  assert(undoEvents.length > 0);
  for (const event of undoEvents) {
    assert.equal(event.actor_kind, "user");
    assert.equal(event.metadata.ai_direct.undo_of, edited.change_id);
  }
  // 元の変更には取り消し済みの印が付き、二度は戻さない。
  assert.equal(
    db.listChangeEventsByCommandId(edited.change_id)[0].metadata.ai_direct.undone_by,
    result.undone[0].undo_change_id,
  );
  assert.equal(changes.undoByUser(edited.change_id).stopped.code, "ALREADY_UNDONE");
  // 人の変更はここからは取り消せない。
  assert.equal(changes.undoByUser("not-an-ai-change").stopped.code, "NOT_FOUND");
});

// 読めないものは変えさせない。NASのHTTPのclientはTaskのIDを外から持ち込めるので、読み取りと同じ判定にする。
test("AIの公開範囲の外のTaskとThemeは無いものとして扱う。本人の画面からの取り消しは使える", async (t) => {
  const { db, core, changes } = await desktop(t);
  db.save("theme", { id: "theme-private", name: "見せない", default_ai_visibility: [] });
  const hidden = humanTask(db, "task-hidden", { project_id: "theme-private" });
  await refused(
    core.changeTask(change(hidden, { changes: { title: "変更" }, said: "題名を変えて" })),
    "NOT_FOUND",
  );
  assert.equal(db.get("task", hidden.id).title, "四半期の資料");

  const visible = humanTask(db, "task-visible");
  await refused(
    core.changeTask(
      change(visible, { changes: { theme_id: "theme-private" }, said: "見せないThemeへ移して" }),
    ),
    "INVALID_REFERENCE",
  );
  // 変えた後に本人がThemeを隠したら、AIはその変更を戻せない。本人は画面から戻せる。
  const edited = await core.changeTask(
    change(visible, { changes: { title: "AIの題名" }, said: "題名を変えて" }),
  );
  db.save("theme", { ...db.get("theme", "theme-work"), default_ai_visibility: [] });
  const result = await core.undoChange({
    change_id: edited.change_id,
    said: "戻して",
    idempotency_key: "undo-hidden",
    caller: "Claude Code",
    source_session: "conversation-a",
  });
  assert.equal(result.undone.length, 0);
  assert.equal(result.stopped.code, "NOT_FOUND");
  assert.equal(result.stopped.current_task, null);
  assert.equal(db.get("task", visible.id).title, "AIの題名");
  assert.equal(changes.undoByUser(edited.change_id).stopped, null);
  assert.equal(db.get("task", visible.id).title, "四半期の資料");
});

test("同期の競合中のTaskは断る", async (t) => {
  const { db, core } = await desktop(t);
  const task = humanTask(db, "task-conflict");
  db.db
    .prepare(
      `INSERT INTO sync_conflicts(id, entity_type, entity_id, local_revision_id, incoming_revision_id, packet_json, created_at, updated_at)
       VALUES ('conflict-1', 'task', ?, 'local', 'incoming', '{}', '2026-11-11', '2026-11-11')`,
    )
    .run(task.id);
  await refused(
    core.changeTask(change(task, { changes: { title: "x" }, said: "変えて" })),
    "SYNC_CONFLICT",
  );
});

test("一つの会話で30件を超えたら止め、本人の言葉とconfirm_bulkで次の30件。会話ごとに取り消せる", async (t) => {
  const { db, core } = await desktop(t);
  const tasks = Array.from({ length: 32 }, (_, index) => humanTask(db, `bulk-${index}`));
  const results = [];
  for (const task of tasks.slice(0, 30))
    results.push(
      await core.changeTask(
        change(task, { source_session: "bulk", changes: { priority: "high" }, said: "全部優先に" }),
      ),
    );
  const limited = await refused(
    core.changeTask(
      change(tasks[30], { source_session: "bulk", changes: { priority: "high" }, said: "全部" }),
    ),
    "ASK_USER",
  );
  assert.equal(limited.details.reason, "bulk_limit");
  // 同じTaskをもう一度変えるのは数えない。
  const same = db.get("task", tasks[0].id);
  assert.equal(
    (
      await core.changeTask(
        change(same, { source_session: "bulk", changes: { title: "同じTask" }, said: "題名も" }),
      )
    ).status,
    "applied",
  );
  // 別の会話は別に数える。
  assert.equal(
    (
      await core.changeTask(
        change(tasks[31], {
          source_session: "other",
          changes: { priority: "high" },
          said: "これも",
        }),
      )
    ).status,
    "applied",
  );
  assert.equal(
    (
      await core.changeTask(
        change(tasks[30], {
          source_session: "bulk",
          changes: { priority: "high" },
          said: "全部やって",
          confirm_bulk: true,
        }),
      )
    ).status,
    "applied",
  );
  // 会話ごとの取り消しは新しい順に全部戻す。
  const undone = await core.undoChange({
    undo_session: "bulk",
    said: "さっきのまとめて戻して",
    idempotency_key: "undo-bulk",
    caller: "Claude Code",
    source_session: "bulk-undo",
  });
  assert.equal(undone.stopped, null);
  assert.equal(undone.undone.length, 32);
  for (const task of tasks.slice(0, 31)) assert.equal(db.get("task", task.id).priority, "normal");
  assert.equal(db.get("task", tasks[0].id).title, "四半期の資料");
  assert.equal(db.get("task", tasks[31].id).priority, "high");
  // 同じ取り消しの再送は、同じ結果を返して二度は戻さない。
  const replay = await core.undoChange({
    undo_session: "bulk",
    said: "さっきのまとめて戻して",
    idempotency_key: "undo-bulk",
    caller: "Claude Code",
    source_session: "bulk-undo",
  });
  assert.equal(replay.undone.length, 32);
});

test("実stdioのMCP: 一覧に出て、設定の状態を返し、本人の言葉で変える", async (t) => {
  const { dir, db } = await desktop(t);
  const task = humanTask(db, "task-mcp");
  const transport = new StdioClientTransport({
    command: process.env.TASKEN_NODE_EXEC_PATH || process.execPath,
    args: [path.join(mcpDirectory, "server.mjs")],
    env: { ...process.env, TASKEN_USER_DATA_DIR: dir, TASKEN_MCP_READ_ONLY: "0" },
    stderr: "pipe",
  });
  const client = new Client({ name: "ai-task-change-test", version: "1" });
  await client.connect(transport);
  t.after(() => client.close());
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  assert(names.includes("tasken.change_task") && names.includes("tasken.undo_change"));
  const caps = (await client.callTool({ name: "tasken.get_capabilities", arguments: {} }))
    .structuredContent;
  assert.equal(caps.core.write_profile, "full");
  assert.equal(caps.writes.task_edit, true);
  const asked = await client.callTool({
    name: "tasken.change_task",
    arguments: change(task, { changes: { title: "x" }, why: "AIの判断" }),
  });
  assert.equal(asked.isError, true);
  assert.equal(asked.structuredContent.error.code, "ASK_USER");
  assert.match(asked.structuredContent.error.next_action, /said/);
  const done = await client.callTool({
    name: "tasken.change_task",
    arguments: change(task, {
      changes: { theme_id: "theme-personal-default" },
      said: "個人に移して",
    }),
  });
  assert(!done.isError, JSON.stringify(done));
  assert.equal(db.get("task", task.id).project_id, "theme-personal-default");
  db.setPreference("aiDirectWriteEnabled", false);
  const off = (await client.callTool({ name: "tasken.get_capabilities", arguments: {} }))
    .structuredContent;
  assert.equal(off.writes.task_edit, false);
  assert.equal(
    off.tools.find((tool) => tool.name === "tasken.change_task").reason,
    "disabled_in_settings",
  );
});

test("レビューの指摘: 取り消しは取り消せない（本人の取り消しをAIがやり直せない）", async (t) => {
  const { db, core, changes } = await desktop(t);
  const task = humanTask(db, "task-redo");
  const edited = await core.changeTask(
    change(task, { changes: { title: "AIの題名" }, said: "題名を変えて" }),
  );
  const userUndo = changes.undoByUser(edited.change_id);
  assert.equal(userUndo.stopped, null);
  const redo = await core.undoChange({
    change_id: userUndo.undone[0].undo_change_id,
    why: "やっぱり戻す",
    idempotency_key: "redo-user-undo",
    caller: "Claude Code",
    source_session: "conversation-a",
  });
  assert.equal(redo.undone.length, 0);
  assert.equal(redo.stopped.code, "NOT_AI_CHANGE");
  assert.equal(db.get("task", task.id).title, "四半期の資料");
});

test("レビューの指摘: 完了・再開の取り消しは、前の完了日時と完了メモに戻す", async (t) => {
  const { db, core, changes } = await desktop(t);
  const done = humanTask(db, "task-was-done", {
    state: "done",
    completed_at: "2026-10-01T09:00:00.000Z",
    completion_note: "前の完了メモ",
  });
  const reopened = await core.changeTask(
    change(done, { action: "reopen", said: "まだ終わってない" }),
  );
  assert.equal(changes.undoByUser(reopened.change_id).stopped, null);
  const back = db.get("task", done.id);
  assert.equal(back.state, "done");
  assert.equal(back.completed_at, "2026-10-01T09:00:00.000Z");
  assert.equal(back.completion_note, "前の完了メモ");

  const todo = humanTask(db, "task-note", { completion_note: "前のメモ" });
  const completed = await core.changeTask(
    change(todo, { action: "complete", completion_note: "AIのメモ", said: "終わった" }),
  );
  assert.equal(changes.undoByUser(completed.change_id).stopped, null);
  assert.equal(db.get("task", todo.id).state, "todo");
  assert.equal(db.get("task", todo.id).completion_note, "前のメモ");
});

test("レビューの指摘: チェック項目のdoneを省いても済みは外れない", async (t) => {
  const { db, core } = await desktop(t);
  const task = humanTask(db, "task-checklist", {
    checklist_items: [
      {
        id: "item-a",
        title: "A",
        done: true,
        sort_order: 0,
        completed_at: "2026-11-01T00:00:00.000Z",
      },
    ],
  });
  const result = await core.changeTask(
    change(task, {
      changes: { checklist: [{ id: "item-a", title: "A" }, { title: "B" }] },
      said: "Bを足して",
    }),
  );
  const [a, b] = result.task.checklist_items;
  assert.equal(a.done, true);
  assert.equal(a.completed_at, "2026-11-01T00:00:00.000Z");
  assert.equal(b.done, false);
});

test("レビューの指摘: 元に無かった欄の取り消し、本人の言葉の後の上書き、値の変わらない変更の取り消し", async (t) => {
  const { db, core } = await desktop(t);
  const created = await core.createAiItem({
    kind: "task",
    title: "AIのTask",
    caller: "Claude Code",
    idempotency_key: "created-missing-fields",
  });
  let task = db.get("task", created.entity.id);
  assert.equal(task.checklist_items, undefined);
  const added = await core.changeTask(
    change(task, { changes: { checklist: [{ title: "手順1" }] }, why: "手順を書き出す" }),
  );
  const undone = await core.undoChange({
    change_id: added.change_id,
    why: "やっぱり要らない",
    idempotency_key: "undo-missing-field",
    caller: "Claude Code",
    source_session: "conversation-a",
  });
  assert.equal(undone.stopped, null);
  assert.deepEqual(db.get("task", task.id).checklist_items, []);

  // 本人の言葉で一度決めたTaskは、AIが作ったものでも次から本人の言葉が要る。
  task = db.get("task", task.id);
  const decided = await core.changeTask(
    change(task, { changes: { title: "本人が決めた題名" }, said: "題名はこれにして" }),
  );
  await refused(
    core.changeTask(change(decided.task, { changes: { title: "AIの題名" }, why: "整える" })),
    "ASK_USER",
  );

  // 値の変わらない変更は、取り消しても何も変えず、二度は対象にしない。
  const same = await core.changeTask(
    change(decided.task, { changes: { title: "本人が決めた題名" }, said: "そのままで" }),
  );
  const first = await core.undoChange({
    change_id: same.change_id,
    said: "戻して",
    idempotency_key: "undo-same-1",
    caller: "Claude Code",
    source_session: "conversation-a",
  });
  assert.equal(first.stopped, null);
  const second = await core.undoChange({
    change_id: same.change_id,
    said: "戻して",
    idempotency_key: "undo-same-2",
    caller: "Claude Code",
    source_session: "conversation-a",
  });
  assert.equal(second.stopped.code, "ALREADY_UNDONE");
});
