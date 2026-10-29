import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createQuickCaptureOrganizationFixture } from "./helpers/quick-capture-organization.mjs";

function fixture(options = {}) {
  const tasks = new Map();
  const notes = [];
  const main = {
    webContents: { id: 40, send: (...args) => messages.push(args) },
    isDestroyed: () => false,
    focus() {},
  };
  const messages = [];
  const f = createQuickCaptureOrganizationFixture(
    undefined,
    (command) => {
      if (options.failSave) throw new Error("保存失敗");
      tasks.set(command.payload.task.id, command.payload.task);
      return { changes: [{ type: "task", entity: command.payload.task }] };
    },
    {
      repository: {
        getPreference: () => "light",
        list: (type) => (type === "note" ? notes : []),
        get: (type, id) => (type === "task" ? tasks.get(id) : null),
      },
      isMainSender: (id) => id === 40,
      showMainWindow: () => main,
      notifyCommandApplied: options.notifyCommandApplied,
    },
  );
  const identity = { id: randomUUID(), issuedAt: "2026-10-29T03:00:00.000Z" };
  return {
    ...f,
    tasks,
    notes,
    messages,
    main,
    identity,
    save: (text = "実験を始める") =>
      f.call("save", text, "today-task", undefined, undefined, undefined, undefined, identity),
    ack: (requestId, ok, sender = main.webContents) =>
      f.handlers.get("workspace:captured-task-focus-result")({ sender }, requestId, ok),
  };
}

test("Task追加の再送でTask・Schedule・CommandのIDと保存値を保持する", () => {
  const f = fixture();
  assert.equal(f.save().id, f.identity.id);
  f.save();
  assert.deepEqual(f.commands[0], f.commands[1]);
  assert.equal(f.tasks.size, 1);
  assert.equal(f.tasks.get(f.identity.id).state, "todo");
  assert.equal(f.commands[0].payload.schedule.owner_id, f.identity.id);
});

test("保存前の失敗は入力を直せるnot_savedを返し、Taskを作らない", () => {
  const f = fixture({ failSave: true });
  assert.deepEqual(f.save(), { status: "not_saved", message: "保存失敗" });
  assert.equal(f.tasks.size, 0);
  assert.equal(f.save("｜期限だけ").status, "not_saved");
});

test("commit後の通知失敗でも保存済みTaskのIDを返す", () => {
  const f = fixture({
    notifyCommandApplied: () => {
      throw new Error("通知失敗");
    },
  });
  assert.equal(f.save().id, f.identity.id);
  assert.equal(f.tasks.size, 1);
});

test("新規TaskのFocusはメイン画面の開始確認を待ち、不正なsenderの確認は無視する", async () => {
  const f = fixture();
  f.save();
  let resolved = false;
  const pending = f.call("focus", f.identity.id).then(() => {
    resolved = true;
  });
  const [channel, request] = f.messages.at(-1);
  assert.equal(channel, "workspace:captured-task-focus-open");
  assert.equal(request.taskId, f.identity.id);
  f.ack(request.requestId, true, { id: 99 });
  await Promise.resolve();
  assert.equal(resolved, false);
  f.ack(request.requestId, true);
  await pending;
});

test("Focus開始失敗後は保存をやり直さず、同じTaskで再試行できる", async () => {
  const f = fixture();
  f.save();
  const pending = f.call("focus", f.identity.id);
  f.ack(f.messages.at(-1)[1].requestId, false);
  await assert.rejects(pending, /保存済みTask/);
  const retry = f.call("focus", f.identity.id);
  f.ack(f.messages.at(-1)[1].requestId, true);
  await retry;
  assert.equal(f.commands.length, 1);
});

test("進行中・一時停止中の別Focusを置き換えず、保存済みTaskを残す", async () => {
  const f = fixture();
  f.save();
  f.notes.push({
    id: "active",
    properties_json: {
      document_role: "focus_session",
      session_state: "active",
      task_id: "other",
      paused_at: "2026-10-29T03:00:00Z",
    },
  });
  await assert.rejects(f.call("focus", f.identity.id), /別のFocus Session/);
  assert.equal(f.messages.length, 0);
  assert.equal(f.tasks.size, 1);
  assert.equal(f.notes[0].properties_json.task_id, "other");
});

test("他画面・未知のTask・削除済みTaskのFocus要求を拒否する", async () => {
  const f = fixture();
  f.save();
  await assert.rejects(
    f.handlers.get("quick-capture:focus")({ sender: { id: 99 } }, f.identity.id),
  );
  await assert.rejects(f.call("focus", "unknown"));
  f.tasks.delete(f.identity.id);
  await assert.rejects(f.call("focus", f.identity.id), /状態を確認/);
});

test("メイン画面の応答がなければタイムアウトし、Taskを保持する", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const f = fixture();
  f.save();
  const pending = f.call("focus", f.identity.id);
  t.mock.timers.tick(15000);
  await assert.rejects(pending, /保存済みTask/);
  assert.equal(f.tasks.size, 1);
});
