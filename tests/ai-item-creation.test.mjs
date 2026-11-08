import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";
import { buildMcpBridge } from "../scripts/build-mcp-bridge.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import {
  SharedFolderSyncService,
  SYNC_PACKET_FILE_PATTERN,
} from "../src/main/services/sharedFolderSync.mjs";
import { TaskenCoreClient } from "../src/main/mcp/taskenCoreClient.mjs";
import { canonicalMarkdownBindingFromProperties } from "../src/shared/canonicalMarkdown.mjs";
import { createHash } from "node:crypto";

const bundles = fs.mkdtempSync(path.join(process.cwd(), ".ai-creation-test-"));
after(() => fs.rmSync(bundles, { recursive: true, force: true }));
const mcpDirectory = path.join(bundles, "mcp");
await buildMcpBridge({ outDir: mcpDirectory });
await build({
  stdin: {
    contents: `
    export { startTaskenHeadlessCore } from "./src/main/headless/taskenHeadlessCore.ts";
    export { WorkspaceService } from "./src/main/services/workspaceService.ts";
    export { ApplicationCommandService } from "./src/main/services/applicationCommandService.ts";
    export { AiItemCreationService } from "./src/main/core/services/aiItemCreationService.ts";
    export { createAiItemCreationPort } from "./src/main/composition/aiItemCreationPort.ts";
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
  startTaskenHeadlessCore,
  WorkspaceService,
  ApplicationCommandService,
  AiItemCreationService,
  createAiItemCreationPort,
} = await import(pathToFileURL(path.join(bundles, "core.mjs")));

const request = (kind, key = kind) => ({
  kind,
  title: `${kind} from conversation`,
  body: "User's idea",
  caller: "dot",
  source_app: "test-dot",
  source_session: "conversation-1",
  idempotency_key: key,
  reason: "The user asked to keep this",
});

function temporary() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tasken-ai-create-"));
}
function open(dir) {
  const db = new WorkspaceDatabase(path.join(dir, "research-desk.sqlite"));
  db.loadWorkspace();
  return db;
}

test("explicit creation-only headless and actual stdio MCP: scope, persistence, retry, delete, old pending", async () => {
  const dir = temporary();
  let core, transport, client;
  const bootstrap = open(dir);
  bootstrap.save("ai_proposal", {
    id: "old-pending",
    source: "mcp",
    source_app: "old",
    payload_type: "notes",
    payload: { notes: [{ title: "Old", body: "pending" }] },
    status: "pending",
    received_at: new Date().toISOString(),
  });
  bootstrap.db.close();
  const connect = async (mode) => {
    core = await startTaskenHeadlessCore({ userDataPath: dir, writeMode: mode });
    transport = new StdioClientTransport({
      command: process.env.TASKEN_NODE_EXEC_PATH || process.execPath,
      args: [path.join(mcpDirectory, "server.mjs")],
      env: { ...process.env, TASKEN_USER_DATA_DIR: dir, TASKEN_MCP_READ_ONLY: "0" },
      stderr: "pipe",
    });
    client = new Client({ name: "creation-test", version: "1" });
    await client.connect(transport);
  };
  const disconnect = async () => {
    await client?.close();
    await transport?.close();
    await core?.stop();
  };
  try {
    await connect("proposals");
    const legacyTools = (await client.listTools()).tools.map((t) => t.name);
    assert.equal(legacyTools.includes("tasken.create_task"), false);
    await assert.rejects(
      new TaskenCoreClient({ userDataPath: dir }).createAiItem(request("task")),
      (e) => e.code === "CAPABILITY_UNAVAILABLE",
    );
    await disconnect();
    await connect("create-only");
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert(names.includes("tasken.create_task"));
    assert(names.includes("tasken.create_note"));
    for (const name of [
      "tasken.update_task",
      "tasken.delete_task",
      "tasken.complete_task",
      "tasken.start_task_work",
    ])
      assert(!names.includes(name));
    const caps = (await client.callTool({ name: "tasken.get_capabilities", arguments: {} }))
      .structuredContent;
    assert.equal(caps.core.write_profile, "create-only");
    assert.equal(caps.writes.note_edit, false);
    const coreClient = new TaskenCoreClient({ userDataPath: dir });
    for (const extra of [
      { workspace_id: "other" },
      { actor: { kind: "user" } },
      { task_id: "existing" },
      { state: "done" },
      { intended_executor: "ai_agent" },
      { canonical_path: "other.md" },
    ])
      await assert.rejects(
        coreClient.createAiItem({ ...request("task"), ...extra }),
        (e) => e.code === "VALIDATION_FAILED",
      );
    const result = await Promise.all([
      coreClient.createAiItem(request("task")),
      coreClient.createAiItem(request("task")),
    ]);
    assert.equal(result[0].entity.id, result[1].entity.id);
    assert.deepEqual(result.map((r) => r.status).sort(), ["created", "duplicate"]);
    const { kind: _kind, ...args } = request("note");
    const noteCall = await client.callTool({ name: "tasken.create_note", arguments: args });
    assert(!noteCall.isError, JSON.stringify(noteCall));
    const note = noteCall.structuredContent;
    assert.equal(note.status, "created");
    assert.equal(note.entity.ai_seen_at, null);
    assert.equal(note.entity.ai_creation.caller, "dot");
    await assert.rejects(
      coreClient.createAiItem({ ...request("task"), title: "Different" }),
      (e) => e.code === "IDEMPOTENCY_CONFLICT",
    );
    const discovery = JSON.parse(fs.readFileSync(path.join(dir, "tasken-core.json"), "utf8"));
    const unauthorized = await fetch(discovery.origin + "/v1/commands/create-ai-item", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request("task")),
    });
    assert.equal(unauthorized.status, 401);
    const broad = await fetch(discovery.origin + "/v1/task/command", {
      method: "POST",
      headers: { authorization: `Bearer ${discovery.token}`, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(broad.status, 404);
    await disconnect();
    const db = open(dir);
    try {
      const task = db.get("task", result[0].entity.id);
      assert.equal(task.requester, "self");
      assert.equal(task.intended_executor, "self");
      assert.equal(task.work_state, "not_delegated");
      assert.equal(task.ai_authority, "ai_generated");
      assert.equal(db.list("schedule").length, 0);
      assert.equal(db.list("task").length, 1);
      assert.equal(db.list("note").length, 1);
      assert.equal(db.get("ai_proposal", "old-pending").status, "pending");
      const workspace = new WorkspaceService(db, dir, undefined, undefined, () => {
        throw Error("no images");
      });
      workspace.markAiItemSeen("task", task.id);
      assert(db.get("task", task.id).ai_seen_at);
      assert.equal(db.get("task", task.id).ai_authority, "ai_generated");
      assert.deepEqual(db.get("task", task.id).ai_creation, task.ai_creation);
      db.remove("task", task.id);
    } finally {
      db.db.close();
    }
    await connect("create-only");
    const replay = await new TaskenCoreClient({ userDataPath: dir }).createAiItem(request("task"));
    assert.equal(replay.status, "duplicate");
    assert(replay.entity.deleted_at);
    assert.equal(
      (await new TaskenCoreClient({ userDataPath: dir }).createAiItem(request("note"))).entity.id,
      note.entity.id,
    );
  } finally {
    await disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("canonical Note, file failure, DB-after-file recovery and existing delete/Undo", () => {
  const dir = temporary();
  const db = open(dir);
  const workspace = new WorkspaceService(db, dir, undefined, undefined, () => {
    throw Error("no images");
  });
  const commands = new ApplicationCommandService(db);
  const creator = () =>
    new AiItemCreationService(db, createAiItemCreationPort(commands, workspace));
  try {
    creator().execute(request("task", "personal-task"));
    // The same canonical root preference used by Desktop is used by headless creation.
    db.setPreference("artifactDirectory", path.join(dir, "notes"));
    const saved = creator().execute(request("note", "canonical"));
    const entity = db.get("note", saved.entity.id);
    const binding = canonicalMarkdownBindingFromProperties(entity.properties_json, {
      noteId: entity.id,
    });
    assert(binding, JSON.stringify(entity));
    assert.equal(binding.sync_state, "in_sync");
    assert(fs.readFileSync(binding.canonical_path, "utf8").includes("User's idea"));
    workspace.markAiItemSeen("note", entity.id);
    assert(db.get("note", entity.id).ai_seen_at);
    assert.equal(db.get("note", entity.id).ai_authority, "ai_generated");
    assert.deepEqual(db.get("note", entity.id).ai_creation, entity.ai_creation);
    workspace.removeEntity("note", entity.id);
    assert(db.get("note", entity.id, true).deleted_at);
    assert(creator().execute(request("note", "canonical")).entity.deleted_at);
    workspace.restoreEntity("note", entity.id);
    assert.equal(db.get("note", entity.id).ai_authority, "ai_generated");
    assert(fs.existsSync(binding.canonical_path));
    const originalWrite = workspace.writeAtomicText;
    workspace.writeAtomicText = function (p, ...rest) {
      if (p.endsWith(".md")) throw Error("injected file failure");
      return originalWrite.call(this, p, ...rest);
    };
    const failedFile = creator().execute(request("note", "file-failure"));
    assert.equal(failedFile.entity.canonical_sync_state, "internal_ahead");
    assert.equal(creator().execute(request("note", "file-failure")).status, "duplicate");
    workspace.writeAtomicText = originalWrite;
    const originalSave = db.saveMany;
    db.saveMany = () => {
      throw Error("DB after file failure");
    };
    assert.throws(() => creator().execute(request("note", "db-failure")), /DB after file failure/);
    db.saveMany = originalSave;
    const recovered = creator().execute(request("note", "db-failure"));
    assert.equal(recovered.status, "duplicate");
    assert.equal(recovered.entity.canonical_sync_state, "in_sync");
    assert.equal(db.list("note").length, 3);
  } finally {
    db.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("creation-only replica joins while empty and publishes personal Task/Note to Desktop", async () => {
  const dir = temporary();
  const hostDirectory = path.join(dir, "desktop");
  fs.mkdirSync(hostDirectory);
  const host = open(hostDirectory);
  const shared = path.join(dir, "shared");
  const sync = new SharedFolderSyncService(host, () => {}, path.join(hostDirectory, "images"));
  let core;
  try {
    await sync.configure(shared);
    await sync.syncNow();
    core = await startTaskenHeadlessCore({
      userDataPath: path.join(dir, "replica"),
      syncDirectory: shared,
      writeMode: "create-only",
    });
    const client = new TaskenCoreClient({ userDataPath: path.join(dir, "replica") });
    const task = await client.createAiItem(request("task", "synced-task"));
    const note = await client.createAiItem(request("note", "synced-note"));
    assert.equal(task.workspace_id, host.workspaceId);
    await core.syncNow();
    await sync.syncNow();
    assert.equal(host.get("task", task.entity.id).intended_executor, "self");
    assert.equal(host.get("note", note.entity.id).body_markdown, request("note").body);
    assert.deepEqual(host.get("task", task.entity.id).ai_creation, task.entity.ai_creation);
    assert.equal(host.get("note", note.entity.id).ai_seen_at, null);
  } finally {
    await core?.stop();
    await sync.stop();
    host.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Desktop と NAS の replica が読み合う、AI 作成の Task・Note の差分の形。replica はプル型で、main に
// 入ってから 5 分で新しい形を書き始めるが、Desktop は本人が上げるまで古いまま。形を変えると、古い
// Desktop が replica の差分を取り込めず止まりうる。形が変わったら、入れる前に一言の印を立てる
// （本人の判断、2026-11-08）。その印を、人の注意ではなくこの試験で求める。
const AI_ITEM_CONTRACT = path.resolve("contracts/sync/ai-item-packets.json");
const VARIABLE_TEXT = [
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, // ID（note:<id> のように途中に含むものも）
  /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/, // 日付・時刻
  /^[0-9a-f]{32,}$/i, // 要約値
];
/** キーと型の一覧。文字列は、ID・時刻・入力の文・path でなければ値まで写す（列挙の値の変化も拾う）。 */
function packetShape(value, inputs, prefix = "$", out = new Set()) {
  if (value === null) out.add(`${prefix}: null`);
  else if (Array.isArray(value)) {
    out.add(`${prefix}: array`);
    for (const item of value) packetShape(item, inputs, `${prefix}[]`, out);
  } else if (typeof value === "object") {
    out.add(`${prefix}: object`);
    for (const key of Object.keys(value).sort())
      packetShape(value[key], inputs, `${prefix}.${key}`, out);
  } else if (typeof value === "string") {
    const variable =
      inputs.has(value) || path.isAbsolute(value) || VARIABLE_TEXT.some((re) => re.test(value));
    out.add(variable ? `${prefix}: string` : `${prefix}: string=${JSON.stringify(value)}`);
  } else if (typeof value === "boolean") out.add(`${prefix}: boolean=${value}`);
  else out.add(`${prefix}: ${typeof value}`);
  return out;
}

test("AI 作成の Task・Note の差分の形が変わったら、contracts/sync/ai-item-packets.json に印が要る", async () => {
  const dir = temporary();
  const hostDirectory = path.join(dir, "desktop");
  fs.mkdirSync(hostDirectory);
  const host = open(hostDirectory);
  const shared = path.join(dir, "shared");
  const sync = new SharedFolderSyncService(host, () => {}, path.join(hostDirectory, "images"));
  let core;
  try {
    await sync.configure(shared);
    core = await startTaskenHeadlessCore({
      userDataPath: path.join(dir, "replica"),
      syncDirectory: shared,
      writeMode: "create-only",
    });
    const client = new TaskenCoreClient({ userDataPath: path.join(dir, "replica") });
    const task = await client.createAiItem(request("task", "contract-task"));
    const note = await client.createAiItem(request("note", "contract-note"));
    await core.syncNow();
    // replica が共有フォルダへ実際に出したファイル（各 Entity の最後の差分）
    const replicaDevice = fs
      .readdirSync(path.join(shared, "devices"))
      .find((name) => name !== host.deviceId);
    const deviceDirectory = path.join(shared, "devices", replicaDevice);
    const packets = fs
      .readdirSync(deviceDirectory)
      .filter((name) => SYNC_PACKET_FILE_PATTERN.test(name))
      .sort()
      .map((name) => JSON.parse(fs.readFileSync(path.join(deviceDirectory, name), "utf8")));
    const latest = (id) => packets.filter((packet) => packet.entityId === id).at(-1);
    const inputs = new Set([
      ...Object.values(request("task", "contract-task")),
      ...Object.values(request("note", "contract-note")),
    ]);
    const shape = {
      task: [...packetShape(latest(task.entity.id), inputs)].sort(),
      note: [...packetShape(latest(note.entity.id), inputs)].sort(),
    };
    const digest = createHash("sha256").update(JSON.stringify(shape)).digest("hex");
    const contract = fs.existsSync(AI_ITEM_CONTRACT)
      ? JSON.parse(fs.readFileSync(AI_ITEM_CONTRACT, "utf8"))
      : { shape: null, flags: [] };
    const flag = contract.flags.at(-1);
    const howTo = [
      "AI 作成の Task・Note の差分の形（Desktop と NAS の replica が読み合う形）が変わった。",
      "replica は main に入ってから 5 分でこの形を書き始め、Desktop は本人が上げるまで古いまま。",
      "入れる前に、古い Desktop がこの形を取り込めるか（Desktop を先に上げる必要があるか）を決め、",
      `${path.relative(process.cwd(), AI_ITEM_CONTRACT)} の shape を下の新しい形にし、flags の末尾に`,
      `{ "date": "YYYY-MM-DD", "shape_sha256": "${digest}", "desktop_first": true|false, "note": "何が変わったか" }`,
      "を足す。PR の本文にも同じ一言を書く。",
      `新しい形: ${JSON.stringify(shape, null, 2)}`,
    ].join("\n");
    assert.deepEqual(contract.shape, shape, howTo);
    assert.equal(flag?.shape_sha256, digest, howTo);
    assert.equal(typeof flag.desktop_first, "boolean", howTo);
    assert.ok(typeof flag.note === "string" && flag.note.trim().length >= 10, howTo);
    assert.match(String(flag.date), /^\d{4}-\d{2}-\d{2}$/, howTo);
  } finally {
    await core?.stop();
    await sync.stop();
    host.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
