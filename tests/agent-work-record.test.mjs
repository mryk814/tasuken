// AI の作業（#751 PR 1）: 新しい種類 agent_work_record と、その受け口（Core の record-agent-work と
// MCP の tasken.report_work）、同じ作業を 2 回数えない判定、消す・取り消す、同期（往復と空の差分）。
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { build } from "esbuild";

import { buildMcpBridge } from "../scripts/build-mcp-bridge.mjs";
import { TaskenCoreClient } from "../src/main/mcp/taskenCoreClient.mjs";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import { SharedFolderSyncService } from "../src/main/services/sharedFolderSync.mjs";
import { nodeExecPath } from "./helpers/childProcessNode.mjs";

const bundles = fs.mkdtempSync(path.join(process.cwd(), ".agent-work-record-test-"));
after(() => fs.rmSync(bundles, { recursive: true, force: true }));
const mcpDirectory = path.join(bundles, "mcp");
await buildMcpBridge({ outDir: mcpDirectory });
await build({
  stdin: {
    contents: `
    export { TaskenDesktopComposition } from "./src/main/composition/taskenDesktopComposition.ts";
    export { WorkspaceService } from "./src/main/services/workspaceService.ts";
    export { startTaskenHeadlessCore } from "./src/main/headless/taskenHeadlessCore.ts";
    export { startTaskenMcpHttpServer } from "./src/main/mcp/httpServer.mjs";
    export { createTaskenCore } from "./src/main/infrastructure/sqlite/public.ts";
    export { AgentWorkRecordService, planAgentWorkRange } from "./src/main/core/public.ts";
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
  TaskenDesktopComposition,
  WorkspaceService,
  startTaskenHeadlessCore,
  startTaskenMcpHttpServer,
  createTaskenCore,
  AgentWorkRecordService,
  planAgentWorkRange,
} = await import(pathToFileURL(path.join(bundles, "core.mjs")));

const TYPE = "agent_work_record";
const PERSONAL_THEME = "theme-personal-default";

// 後片付けは登録の逆順で走らせる（t.after は登録順なので、DB を閉じる前に一時の場所を消そうとして失敗する）。
const deferred = new WeakMap();
function defer(t, cleanup) {
  if (!deferred.has(t)) {
    const stack = [];
    deferred.set(t, stack);
    t.after(async () => {
      for (const step of stack.reverse()) await step();
    });
  }
  deferred.get(t).push(cleanup);
}

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-agent-work-"));
  defer(t, () => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const count = (db, sql, ...params) => db.db.prepare(sql).get(...params).count;
const outbox = (db) => count(db, "SELECT COUNT(*) AS count FROM sync_outbox");
const changeEvents = (db) =>
  count(db, "SELECT COUNT(*) AS count FROM entities WHERE entity_type = 'change_event'");

/** index.ts と同じ組み立ての Desktop の Core（AI の書き込みを含む）を、一時の userData で起こす。 */
async function startDesktop(t) {
  const userData = temporary(t);
  const db = new WorkspaceDatabase(path.join(userData, "research-desk.sqlite"));
  db.loadWorkspace();
  const workspace = new WorkspaceService(db, userData, undefined, undefined, () => {
    throw new Error("no images");
  });
  const composition = new TaskenDesktopComposition({ userDataPath: userData, persistence: db });
  composition.enableAiWrites({ workspace });
  await composition.coreRuntime.start();
  defer(t, async () => {
    await composition.coreRuntime.stop();
    db.db.close();
  });
  return { userData, db, workspace, client: new TaskenCoreClient({ userDataPath: userData }) };
}

const work = (patch = {}) => ({
  idempotency_key: "work-1",
  caller: "claude-code",
  source_app: "test-mcp",
  source_session: "conversation-1",
  client_kind: "claude_code",
  model_label: "test-model",
  status: "done",
  summary: "作業の記録を作り直した。",
  intent: "作業ログを小さくしたい",
  ended_at: "2026-11-14T10:00:00.000Z",
  ...patch,
});

async function rejectsWith(promise, code, check = () => true) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, error.message);
    return check(error) !== false;
  });
}

test("Core: 書ける。書き手は Core が固定し、Task を変えず、来歴を作らず、差分は 1 つだけ出る", async (t) => {
  const { db, client } = await startDesktop(t);
  db.setPreference("aiDirectWriteEnabled", true);
  const created = await client.createAiItem({
    kind: "task",
    title: "作業の対象",
    idempotency_key: "task-1",
    caller: "claude-code",
    source_app: "test-mcp",
  });
  const task = db.get("task", created.entity.id);
  const beforeOutbox = outbox(db);
  const beforeEvents = changeEvents(db);

  const changed = Array.from({ length: 12 }, (_, index) => `src/file-${index}.ts`);
  const result = await client.recordAgentWork(
    work({ theme_ids: [PERSONAL_THEME], task_ids: [task.id], changed, verified: ["tsc"] }),
  );
  assert.equal(result.status, "recorded");
  assert.equal(result.record.written_by, "claude-code");
  assert.equal(result.record.basis, "ai_report");
  assert.deepEqual(result.record.changed, changed.slice(0, 10));
  assert.equal(result.record.changed_more, 2);
  assert.equal(result.record.started_at, null);

  const stored = db.get(TYPE, result.id);
  assert.equal(stored.source, "mcp");
  assert.equal(stored.summary, "作業の記録を作り直した。");
  assert.match(stored.request_fingerprint, /^[0-9a-f]{64}$/);
  // 保存 1 回 = 差分 1 つ。来歴は作らない。Task は版も中身も変わらない。
  assert.equal(outbox(db), beforeOutbox + 1);
  assert.equal(changeEvents(db), beforeEvents);
  assert.deepEqual(db.get("task", task.id), task);
  const packet = JSON.parse(
    db.db
      .prepare("SELECT payload_json FROM sync_outbox ORDER BY device_sequence DESC LIMIT 1")
      .get().payload_json,
  );
  assert.equal(packet.entityType, TYPE);
  assert.equal(packet.entityId, result.id);

  // 呼び手が書き手や根拠を名乗る欄は無い（Core が決める）。
  for (const extra of [{ written_by: "本人" }, { basis: "folded" }, { actor: { kind: "user" } }])
    await rejectsWith(
      client.recordAgentWork(work({ idempotency_key: "spoof", ...extra })),
      "VALIDATION_FAILED",
    );
  // 来歴を取らない種類の来歴は、保存の境界で断る（仕組みで作らせない）。
  assert.throws(() =>
    db.save("change_event", {
      entity_type: TYPE,
      entity_id: result.id,
      changed_at: new Date().toISOString(),
      change_type: "created",
      source: "ai",
    }),
  );
});

test("Core: 上限を超えた入力は切り詰めずに断り、何が長いかを返す。何も書かない", async (t) => {
  const { db, client } = await startDesktop(t);
  const before = outbox(db);
  const cases = [
    [{ summary: "あ".repeat(401) }, "VALIDATION_FAILED", "summary"],
    [{ intent: "あ".repeat(161) }, "VALIDATION_FAILED", "intent"],
    [{ notice: "あ".repeat(201) }, "VALIDATION_FAILED", "notice"],
    [{ verified: ["1", "2", "3", "4", "5", "6"] }, "VALIDATION_FAILED", "verified"],
    [{ remaining: ["あ".repeat(121)] }, "VALIDATION_FAILED", "remaining"],
    [{ changed: ["x".repeat(101)] }, "VALIDATION_FAILED", "changed"],
    [{ changed: ["C:\\Users\\someone\\repo\\a.ts"] }, "VALIDATION_FAILED", "changed"],
    [{ changed: ["/home/someone/repo/a.ts"] }, "VALIDATION_FAILED", "changed"],
    [
      { source_session: "C:\\Users\\someone\\.codex\\session.jsonl" },
      "VALIDATION_FAILED",
      "source_session",
    ],
    [{ theme_ids: ["a", "b", "c", "d", "e", "f"] }, "VALIDATION_FAILED", "theme_ids"],
    [{ client_kind: "x".repeat(81) }, "VALIDATION_FAILED", "client_kind"],
    [{ caller: "x".repeat(81) }, "VALIDATION_FAILED", "caller"],
    [{ status: "partially" }, "VALIDATION_FAILED", "status"],
    [{ theme_ids: ["no-such-theme"] }, "INVALID_REFERENCE", "theme_ids"],
    [{ task_ids: ["no-such-task"] }, "INVALID_REFERENCE", "task_ids"],
    [{ started_at: "2026-11-14T11:00:00.000Z" }, "VALIDATION_FAILED", "started_at"],
  ];
  for (const [patch, code, field] of cases) {
    await rejectsWith(
      client.recordAgentWork(work({ idempotency_key: field, ...patch })),
      code,
      (error) => {
        const text = JSON.stringify(error.details);
        assert.ok(text.includes(field), `${field}: ${text}`);
      },
    );
  }
  assert.equal(outbox(db), before);
  assert.equal(db.list(TYPE, true).length, 0);
});

test("Core: 同じ作業を 2 回数えない（鍵・会話と時間の範囲）。dry_run は書かない", async (t) => {
  const { db, client } = await startDesktop(t);
  const first = await client.recordAgentWork(work());
  // 同じ鍵の再送は同じ 1 件。
  const again = await client.recordAgentWork(work());
  assert.equal(again.status, "duplicate");
  assert.equal(again.id, first.id);
  // 同じ鍵で中身が違えば断る。
  await rejectsWith(client.recordAgentWork(work({ summary: "違う中身" })), "IDEMPOTENCY_CONFLICT");
  // 鍵を変えても、同じ AI の同じ会話で、もう数えた時間までの作業なら同じ作業として返す。
  const sameRange = await client.recordAgentWork(work({ idempotency_key: "work-1-retry" }));
  assert.equal(sameRange.status, "duplicate");
  assert.equal(sameRange.id, first.id);
  const earlier = await client.recordAgentWork(
    work({ idempotency_key: "work-earlier", ended_at: "2026-11-14T09:00:00.000Z" }),
  );
  assert.equal(earlier.status, "duplicate");
  assert.equal(db.list(TYPE, true).length, 1);

  // 続きは新しい 1 件。始まりを省けば前の記録の終わり、前より早い始まりは前の終わりまで寄せる（範囲を重ねない）。
  const next = await client.recordAgentWork(
    work({ idempotency_key: "work-2", ended_at: "2026-11-14T11:00:00.000Z" }),
  );
  assert.equal(next.status, "recorded");
  assert.equal(next.record.started_at, "2026-11-14T10:00:00.000Z");
  const third = await client.recordAgentWork(
    work({
      idempotency_key: "work-3",
      started_at: "2026-11-14T08:00:00.000Z",
      ended_at: "2026-11-14T12:00:00.000Z",
    }),
  );
  assert.equal(third.record.started_at, "2026-11-14T11:00:00.000Z");
  // 別の AI の同じ ID の会話は別の作業。
  const other = await client.recordAgentWork(
    work({ idempotency_key: "codex-1", client_kind: "codex" }),
  );
  assert.equal(other.status, "recorded");
  // 会話の ID が無ければ、鍵だけで見る。
  const noSession = await client.recordAgentWork(
    work({ idempotency_key: "no-session", source_session: undefined }),
  );
  assert.equal(noSession.status, "recorded");

  const before = outbox(db);
  const dry = await client.recordAgentWork(
    work({ idempotency_key: "dry", ended_at: "2026-11-14T13:00:00.000Z", dry_run: true }),
  );
  assert.equal(dry.status, "validated");
  assert.equal(db.get(TYPE, dry.id, true), null);
  assert.equal(outbox(db), before);
  assert.equal(db.list(TYPE, true).length, 5);
});

test("同じ作業の判定: 拾い上げは AI の記録の終わりから 10 分のゆとりを見る", () => {
  const prior = [{ id: "a", ended_at: "2026-11-14T10:00:00.000Z" }];
  const plan = (endedAt, basis, startedAt = null) =>
    planAgentWorkRange(prior, { startedAt, endedAt }, basis);
  assert.equal(plan("2026-11-14T10:05:00.000Z", "log_pickup").kind, "covered");
  assert.equal(plan("2026-11-14T10:10:00.000Z", "log_pickup").kind, "covered");
  assert.deepEqual(plan("2026-11-14T10:30:00.000Z", "log_pickup"), {
    kind: "write",
    startedAt: "2026-11-14T10:00:00.000Z",
  });
  assert.equal(plan("2026-11-14T10:05:00.000Z", "ai_report").kind, "write");
  assert.equal(plan("2026-11-14T10:00:00.000Z", "ai_report").kind, "covered");
  assert.deepEqual(planAgentWorkRange([], { startedAt: null, endedAt: "x" }, "ai_report"), {
    kind: "write",
    startedAt: null,
  });
});

test("Core: 1 つの client が 1 日に書けるのは 200 件まで", () => {
  const counts = [];
  const port = {
    workspaceId: "w",
    resolveRepositoryContextId: () => null,
    runTransaction: (callback) =>
      callback({
        get: () => null,
        listForSession: () => [],
        countWrittenSince: (writtenBy, since) => {
          counts.push([writtenBy, since]);
          return 200;
        },
        exists: () => true,
        insert: () => assert.fail("上限を超えて書いた"),
        markDeleted: () => null,
      }),
  };
  const service = new AgentWorkRecordService(port, { now: () => "2026-11-14T10:00:00.000Z" });
  assert.throws(
    () => service.record(work()),
    (error) => error.code === "DAILY_LIMIT",
  );
  assert.deepEqual(counts, [["claude-code", "2026-11-13T10:00:00.000Z"]]);
});

test("消す・取り消す: 本人は消して戻せる。AI は自分の書いた物だけを取り消せる。書き換えはさせない", async (t) => {
  const { db, workspace, client } = await startDesktop(t);
  const written = await client.recordAgentWork(work());
  const id = written.id;

  // 本人: 消した印を付ける・戻す。どちらも差分 1 つ。
  let before = outbox(db);
  workspace.removeEntity(TYPE, id);
  assert.ok(db.get(TYPE, id, true).deleted_at);
  assert.equal(db.get(TYPE, id), null);
  assert.equal(outbox(db), before + 1);
  before = outbox(db);
  workspace.restoreEntity(TYPE, id);
  assert.equal(db.get(TYPE, id).deleted_at, null);
  assert.equal(outbox(db), before + 1);

  // 1 回だけ書き、書き換えない（どの道からも）。
  assert.throws(() => db.save(TYPE, { ...db.get(TYPE, id), summary: "書き換え" }), /書き換え/);

  // AI: 書いた client だけが undo_change で取り消せる。直接の書き込みの設定は問わない。
  db.setPreference("aiDirectWriteEnabled", false);
  const undo = (caller) =>
    client.undoChange({
      change_id: id,
      caller,
      source_app: "test-mcp",
      source_session: "conversation-1",
      idempotency_key: `undo-${caller}`,
      why: "間違えて書いた",
    });
  await rejectsWith(undo("someone-else"), "NOT_RECORD_WRITER");
  assert.equal(db.get(TYPE, id).deleted_at, null);
  before = outbox(db);
  const undone = await undo("claude-code");
  assert.deepEqual(undone.undone, [
    { change_id: id, undo_change_id: `agent-work-retract:${id}`, agent_work_record_id: id },
  ]);
  assert.ok(db.get(TYPE, id, true).deleted_at);
  assert.equal(outbox(db), before + 1);
  // 取り消しの再送は何も増やさない。本人は戻せる。
  await undo("claude-code");
  assert.equal(outbox(db), before + 1);
  workspace.restoreEntity(TYPE, id);
  assert.equal(db.get(TYPE, id).deleted_at, null);
});

// --- 同期 ---------------------------------------------------------------------------

function createDevices(t, names) {
  const root = temporary(t);
  const shared = path.join(root, "shared");
  const devices = {};
  for (const name of names) {
    const dir = path.join(root, name);
    const db = new WorkspaceDatabase(path.join(dir, "research-desk.sqlite"));
    const sync = new SharedFolderSyncService(
      db,
      () => {},
      path.join(dir, "attachments", "markdown-images"),
      path.join(dir, "attachments", "capture-images"),
    );
    devices[name] = { db, sync };
  }
  defer(t, async () => {
    for (const name of names) {
      await devices[name].sync.stop();
      if (devices[name].db.db.open) devices[name].db.db.close();
    }
  });
  return { shared, ...devices };
}

async function settle(...syncs) {
  for (let round = 0; round < 3; round += 1) for (const sync of syncs) await sync.syncNow();
}

async function joined(t, names) {
  const env = createDevices(t, names);
  for (const name of names) await env[name].sync.configure(env.shared);
  await settle(...names.map((name) => env[name].sync));
  return env;
}

test("同期: 2 台で新しい記録が往復し、本人が消した印も届く", async (t) => {
  const env = await joined(t, ["first", "second"]);
  const core = createTaskenCore(env.first.db);
  const written = core.recordAgentWork.record(work());
  await settle(env.first.sync, env.second.sync);
  const received = env.second.db.get(TYPE, written.id);
  assert.equal(received.summary, written.record.summary);
  assert.equal(received.written_by, "claude-code");

  env.second.db.remove(TYPE, written.id);
  await settle(env.first.sync, env.second.sync);
  assert.ok(env.first.db.get(TYPE, written.id, true).deleted_at);
  env.first.db.restore(TYPE, written.id);
  await settle(env.first.sync, env.second.sync);
  assert.equal(env.second.db.get(TYPE, written.id).deleted_at, null);
  for (const device of [env.first, env.second]) {
    assert.equal(device.db.syncConflictCount(), 0);
    assert.equal(device.sync.status().state, "idle");
  }
});

/** 移行（PR 4）で中身を抜いた送信済みの差分の形。封筒だけを残す。 */
function retiredPacket(workspaceId, deviceId, deviceSequence, entityType, entityId) {
  const changeId = createHash("sha256")
    .update(`${deviceId}:${deviceSequence}`)
    .digest("hex")
    .slice(0, 32)
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
  return {
    format: "tasken-sync-change",
    formatVersion: 1,
    workspaceId,
    changeId,
    revisionId: changeId,
    parentRevisionIds: [],
    deviceId,
    deviceSequence,
    entityType,
    entityId,
    createdAt: "2026-11-14T00:00:00.000Z",
    retired: true,
  };
}

function writePacket(shared, packet) {
  const directory = path.join(shared, "devices", packet.deviceId);
  fs.mkdirSync(directory, { recursive: true });
  const name = `${String(packet.deviceSequence).padStart(12, "0")}-${packet.changeId}.json`;
  fs.writeFileSync(path.join(directory, name), JSON.stringify(packet));
}

test("同期: 空の差分（retired）を受けても止まらず、連番が進み、その後の差分も入る", async (t) => {
  const env = await joined(t, ["first", "second"]);
  // 手元の記録を、移行した端末が中身を抜いた後の差分で書き換えさせない。
  const core = createTaskenCore(env.second.db);
  const kept = core.recordAgentWork.record(work());
  await settle(env.first.sync, env.second.sync);

  // 移行済みの端末（first）が、自分の送信済みの差分を空にした後の形を、別の端末の ID で置く。
  const migrated = "00000000-0000-4000-8000-0000000000aa";
  const workspaceId = env.second.db.workspaceId;
  writePacket(env.shared, retiredPacket(workspaceId, migrated, 1, "agent_session", "s-1"));
  writePacket(env.shared, retiredPacket(workspaceId, migrated, 2, "change_event", "e-1"));
  writePacket(env.shared, retiredPacket(workspaceId, migrated, 3, "ai_proposal", "p-1"));
  writePacket(env.shared, retiredPacket(workspaceId, migrated, 4, "reference", "r-1"));
  // 空の差分の後に続く、ふつうの差分。余計な欄が付いていても、決まった欄だけを残して取り込む。
  const later = createTaskenCore(env.first.db).recordAgentWork.record(
    work({ idempotency_key: "later", source_session: "conversation-2" }),
  );
  const source = env.first.db.syncPacket(
    env.first.db.db
      .prepare("SELECT change_id FROM sync_outbox ORDER BY device_sequence DESC LIMIT 1")
      .get().change_id,
  ).packet;
  writePacket(env.shared, {
    ...source,
    deviceId: migrated,
    deviceSequence: 5,
    entity: { ...source.entity, unknown_field: "持ち込ませない" },
  });

  await env.second.sync.syncNow();
  assert.equal(env.second.sync.status().state, "idle");
  assert.equal(env.second.db.syncCursor(migrated), 5);
  assert.equal(env.second.db.get(TYPE, later.id).summary, later.record.summary);
  assert.equal("unknown_field" in env.second.db.get(TYPE, later.id), false);
  // 空の差分は手元の記録を変えない（消すのは各端末の移行）。
  assert.equal(env.second.db.get(TYPE, kept.id).deleted_at, null);

  // 中身を持つ差分に印だけ付けたものは受けない（取り込みを黙って飛ばさせない）。
  const forged = { ...source, deviceId: migrated, deviceSequence: 6, retired: true };
  writePacket(env.shared, forged);
  await assert.rejects(env.second.sync.syncNow(), /空の同期差分/);
  assert.equal(env.second.db.syncCursor(migrated), 5);
});

// --- 移行（PR 4）で畳む時の同期の約束。今の同期のコードで、新しい種類について先に確かめる。

/** 元の会話の ID だけから決まる UUID。端末や時刻を混ぜない。 */
function foldedRevisionId(recordId) {
  const hash = createHash("sha256").update(`agent-work-fold-v1\0${recordId}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** 畳んだ記録の中身。元の会話だけから決まる。 */
function foldedRecord(id) {
  return {
    id,
    started_at: "2026-11-01T09:00:00.000Z",
    ended_at: "2026-11-01T10:00:00.000Z",
    client_kind: "codex",
    client_label: null,
    model_label: null,
    source_session_id: `session-${id}`,
    theme_ids: [],
    task_ids: [],
    repository_context_ids: [],
    intent: null,
    summary: `folded ${id}`,
    changed: [],
    changed_more: 0,
    verified: [],
    remaining: [],
    status: "done",
    notice: null,
    basis: "folded",
    written_by: "migration",
    request_fingerprint: null,
  };
}

/**
 * 移行の 1 件分を模す。記録を同期に載せずに保存し、決まった版の ID の差分を出し、
 * 手元の head をその版にする。既にある記録は飛ばす（先に畳んだ端末の差分が届いていた時）。
 */
function fold(db, id) {
  if (db.get(TYPE, id, true)) return "skipped";
  const revisionId = foldedRevisionId(id);
  db.db.transaction(() => {
    const saved = db.save(TYPE, foldedRecord(id), { skipSync: true, source: "migration" });
    db.enqueueSyncEntity(TYPE, saved, [], revisionId);
    db.setSyncHead(TYPE, id, revisionId);
  })();
  return "folded";
}

test("同期（畳む約束）: 2 台がそれぞれ畳んでから同期すると、重複として収まり、競合にならない", async (t) => {
  const env = await joined(t, ["first", "second"]);
  const ids = ["rec-1", "rec-2", "rec-3"];
  for (const id of ids) {
    assert.equal(fold(env.first.db, id), "folded");
    assert.equal(fold(env.second.db, id), "folded");
  }
  const firstOutbox = outbox(env.first.db);
  const secondOutbox = outbox(env.second.db);
  await settle(env.first.sync, env.second.sync);
  for (const device of [env.first, env.second]) {
    assert.equal(device.db.syncConflictCount(), 0);
    assert.equal(device.sync.status().state, "idle");
    assert.equal(device.db.list(TYPE, true).length, ids.length);
    for (const id of ids) assert.equal(device.db.syncHead(TYPE, id), foldedRevisionId(id));
  }
  // 同期の後に、差分が勝手に増えていない（中継の出し直しなどが起きていない）。
  assert.equal(outbox(env.first.db), firstOutbox);
  assert.equal(outbox(env.second.db), secondOutbox);
});

test("同期（畳む約束）: 片方だけ畳んでも止まらず、後から畳む側は届いた記録を飛ばす。本人が消した印は後継の版として入る", async (t) => {
  const env = await joined(t, ["first", "second"]);
  assert.equal(fold(env.first.db, "rec-1"), "folded");
  await settle(env.first.sync, env.second.sync);
  assert.equal(env.second.db.get(TYPE, "rec-1").summary, "folded rec-1");
  assert.equal(env.second.db.syncHead(TYPE, "rec-1"), foldedRevisionId("rec-1"));
  const before = outbox(env.second.db);
  assert.equal(fold(env.second.db, "rec-1"), "skipped");
  assert.equal(outbox(env.second.db), before);

  env.first.db.remove(TYPE, "rec-1");
  await settle(env.first.sync, env.second.sync);
  assert.ok(env.second.db.get(TYPE, "rec-1", true).deleted_at);
  for (const device of [env.first, env.second]) {
    assert.equal(device.db.syncConflictCount(), 0);
    assert.equal(device.db.list(TYPE, true).length, 1);
  }
  assert.equal(env.second.db.syncHead(TYPE, "rec-1"), env.first.db.syncHead(TYPE, "rec-1"));
});

test("同期（畳む約束）: 2 台が畳んだ後に空の 3 台目が参加すると、記録は 1 件ずつ入る", async (t) => {
  const env = await joined(t, ["first", "second"]);
  for (const id of ["rec-1", "rec-2"]) {
    fold(env.first.db, id);
    fold(env.second.db, id);
  }
  await settle(env.first.sync, env.second.sync);
  const third = createDevices(t, ["third"]).third;
  await third.sync.configure(env.shared);
  await settle(env.first.sync, env.second.sync, third.sync);
  assert.equal(third.db.list(TYPE, true).length, 2);
  for (const device of [env.first, env.second, third]) {
    assert.equal(device.db.syncConflictCount(), 0);
    assert.equal(device.sync.status().state, "idle");
  }
  assert.equal(third.db.syncHead(TYPE, "rec-1"), foldedRevisionId("rec-1"));
});

test("同期（畳む約束）の対照: 版の ID を決めずに 2 台がふつうに保存すると、競合になる", async (t) => {
  const env = await joined(t, ["first", "second"]);
  env.first.db.save(TYPE, foldedRecord("rec-1"));
  env.second.db.save(TYPE, foldedRecord("rec-1"));
  await settle(env.first.sync, env.second.sync);
  assert.ok(env.first.db.syncConflictCount() + env.second.db.syncConflictCount() > 0);
});

// --- MCP: Desktop の stdio と NAS の HTTP で同じに動く ---------------------------------

test("MCP: report_work（Task 無し）は Desktop の stdio と NAS の HTTP で同じ記録を書く", async (t) => {
  const desktop = await startDesktop(t);
  const transport = new StdioClientTransport({
    command: nodeExecPath,
    args: [path.join(mcpDirectory, "server.mjs")],
    env: { ...process.env, TASKEN_USER_DATA_DIR: desktop.userData, TASKEN_MCP_READ_ONLY: "0" },
    stderr: "pipe",
  });
  const stdio = new Client({ name: "agent-work-test", version: "1" });
  await stdio.connect(transport);
  defer(t, async () => {
    await stdio.close();
    await transport.close();
  });

  const replicaData = temporary(t);
  const replica = await startTaskenHeadlessCore({
    userDataPath: replicaData,
    // 新規作成も許した配備（個人業務の Theme が手元にできる）。記録は proposals 配備でも書ける。
    writeMode: "create-only",
    env: {},
  });
  defer(t, () => replica.stop());
  const token = randomBytes(32).toString("base64url");
  // Core の client は HTTP の側に作らせる（試験の側の class を渡すと、失敗の見分けが別物になる）。
  const http = await startTaskenMcpHttpServer({
    env: { TASKEN_MCP_READ_ONLY: "0", TASKEN_USER_DATA_DIR: replicaData },
    port: 0,
    clients: { muse: { token, readOnly: false } },
  });
  defer(t, () => http.close());
  const api = async (name, body) => {
    const response = await fetch(`http://127.0.0.1:${http.address().port}/api/v1/${name}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };

  const args = {
    idempotency_key: "parity-1",
    source_session: "conversation-parity",
    client_kind: "claude_code",
    model_label: "test-model",
    status: "progress",
    summary: "両方の入口で同じに書く。",
    intent: "AI の作業を記録したい",
    changed: ["src/a.ts", "PR #1"],
    verified: ["typecheck"],
    remaining: ["画面"],
    notice: "気づき",
    theme_ids: [PERSONAL_THEME],
    ended_at: "2026-11-14T10:00:00.000Z",
  };
  const viaStdio = await stdio.callTool({
    name: "tasken.report_work",
    arguments: { ...args, caller: "claude-code" },
  });
  assert.equal(viaStdio.isError, undefined, JSON.stringify(viaStdio.content));
  const viaHttp = await api("report_work", args);
  assert.equal(viaHttp.status, 200, JSON.stringify(viaHttp.body));

  const local = viaStdio.structuredContent;
  const remote = viaHttp.body;
  assert.equal(local.status, "recorded");
  assert.equal(remote.status, "recorded");
  // 書き手は、stdio は呼び手の名前、HTTP は認証で確かめた client 名。ID は Workspace と経路から
  // 決まるので別。ほかは同じ。
  assert.equal(local.record.written_by, "claude-code");
  assert.equal(remote.record.written_by, "muse");
  assert.equal(local.record.status, "partial");
  const comparable = ({ record }) => {
    const { written_by: _writer, created_at: _created, id: _id, ...rest } = record;
    return rest;
  };
  assert.deepEqual(comparable(local), comparable(remote));

  // 同じ鍵の再送は同じ 1 件（両方の入口）。
  assert.equal(
    (
      await stdio.callTool({
        name: "tasken.report_work",
        arguments: { ...args, caller: "claude-code" },
      })
    ).structuredContent.status,
    "duplicate",
  );
  assert.equal((await api("report_work", args)).body.status, "duplicate");

  // 案を送れる接続なら、どちらでも書ける（get_capabilities にも出る）。
  for (const capabilities of [
    (await stdio.callTool({ name: "tasken.get_capabilities", arguments: {} })).structuredContent,
    (await api("get_capabilities", {})).body,
  ]) {
    assert.equal(capabilities.writes.agent_work_record, true);
    assert.equal(capabilities.writes.task_work_report, true);
  }
  // 上限は MCP の入口でも同じに断る。
  const tooLong = await api("report_work", {
    ...args,
    idempotency_key: "long",
    summary: "あ".repeat(401),
  });
  assert.equal(tooLong.status, 400);
  assert.equal(desktop.db.list(TYPE, true).length, 1);
});

test("NAS: 案だけを受ける配備（proposals）でも書け、読み取りだけの配備では書けない", async (t) => {
  for (const [writeMode, expected] of [
    ["proposals", true],
    ["read-only", false],
  ]) {
    const userData = temporary(t);
    const core = await startTaskenHeadlessCore({ userDataPath: userData, writeMode, env: {} });
    try {
      const { capabilities } = await new TaskenCoreClient({ userDataPath: userData }).inspect();
      assert.equal(capabilities.includes("agent_work.record"), expected, writeMode);
    } finally {
      await core.stop();
    }
  }
});

test("同期: 畳む予定の種類でない空の差分は受けない（中身を黙って飛ばさせない）", async (t) => {
  for (const entityType of [TYPE, "task", "note", "retired_kind"]) {
    const env = await joined(t, ["first", "second"]);
    const migrated = "00000000-0000-4000-8000-0000000000bb";
    writePacket(
      env.shared,
      retiredPacket(env.second.db.workspaceId, migrated, 1, entityType, "x-1"),
    );
    await assert.rejects(env.second.sync.syncNow(), /空の同期差分/, entityType);
    assert.equal(env.second.db.syncCursor(migrated), 0, entityType);
  }
});

test("Core: 受け取った時刻より 5 分以上先の時刻は断る（後の報告が黙って捨てられないように）", async (t) => {
  const { db, client } = await startDesktop(t);
  const ahead = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
  // 日本時間に Z を付けた時の形（9 時間先）。
  for (const [patch, field] of [
    [{ ended_at: ahead(9 * 60) }, "ended_at"],
    [{ started_at: ahead(30), ended_at: ahead(60) }, "started_at"],
  ])
    await rejectsWith(
      client.recordAgentWork(work({ idempotency_key: field, ...patch })),
      "VALIDATION_FAILED",
      (error) => assert.equal(error.details.field, field),
    );
  assert.equal(db.list(TYPE, true).length, 0);
  // 時計のずれ程度（数分）は受ける。
  const near = await client.recordAgentWork(work({ idempotency_key: "near", ended_at: ahead(3) }));
  assert.equal(near.status, "recorded");
});

test("Core: AI の種類の表記をそろえ、取り消した直後に同じ時刻で書き直せる", async (t) => {
  const { client, db } = await startDesktop(t);
  const first = await client.recordAgentWork(work({ client_kind: "Claude-Code" }));
  assert.equal(first.record.client_kind, "claude_code");
  // 表記が違っても同じ AI の同じ会話として数える。
  const sameWork = await client.recordAgentWork(
    work({ idempotency_key: "other-spelling", client_kind: "claude code" }),
  );
  assert.equal(sameWork.status, "duplicate");
  assert.equal(sameWork.id, first.id);

  // 書いた AI が取り消したら、同じ時刻までの作業を書き直せる。
  await client.undoChange({
    change_id: first.id,
    caller: "claude-code",
    source_app: "test-mcp",
    source_session: "conversation-1",
    idempotency_key: "undo-first",
    why: "書き直す",
  });
  const rewritten = await client.recordAgentWork(
    work({ idempotency_key: "rewrite", summary: "書き直した要約。" }),
  );
  assert.equal(rewritten.status, "recorded");
  assert.notEqual(rewritten.id, first.id);
  // 本人が消した記録は、ほかの書き手（拾い上げなど）の判定では数えたまま。
  workspaceRemove(db, rewritten.id);
  const otherWriter = await client.recordAgentWork(
    work({ idempotency_key: "other-writer", caller: "someone-else" }),
  );
  assert.equal(otherWriter.status, "duplicate");
});

function workspaceRemove(db, id) {
  db.remove(TYPE, id);
}

test("Core: 自由な文に秘密の形（トークン・鍵・Bearer・認証情報付きの URL）があれば断る", async (t) => {
  const { db, client } = await startDesktop(t);
  const token = `ghp_${"a".repeat(36)}`;
  for (const [patch, field] of [
    [{ summary: `トークン ${token} を設定した` }, "summary"],
    [{ summary: `github_pat_${"b".repeat(40)} を使った` }, "summary"],
    [{ notice: `sk-${"c".repeat(40)}` }, "notice"],
    [{ intent: `xoxb-${"d".repeat(30)}` }, "intent"],
    [{ verified: ["AKIAABCDEFGHIJKLMNOP で確かめた"] }, "verified"],
    [{ remaining: ["-----BEGIN OPENSSH PRIVATE KEY-----"] }, "remaining"],
    [{ summary: "Authorization: Bearer abcdefghijklmnop を送った" }, "summary"],
    [{ changed: ["https://user:pass@example.com/repo.git"] }, "changed"],
  ])
    await rejectsWith(
      client.recordAgentWork(work({ idempotency_key: field + JSON.stringify(patch), ...patch })),
      "VALIDATION_FAILED",
      (error) => assert.equal(error.details.field, field),
    );
  assert.equal(db.list(TYPE, true).length, 0);
  // ふつうの言葉の「token」や URL は通す。
  const plain = await client.recordAgentWork(
    work({ summary: "token の期限切れを直した。https://example.com/docs を見た。" }),
  );
  assert.equal(plain.status, "recorded");
});
