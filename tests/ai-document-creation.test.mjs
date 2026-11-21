import { nodeExecPath } from "./helpers/childProcessNode.mjs";
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
import { TaskenCoreClient } from "../src/main/mcp/taskenCoreClient.mjs";

const bundles = fs.mkdtempSync(path.join(process.cwd(), ".ai-document-test-"));
after(() => fs.rmSync(bundles, { recursive: true, force: true }));
const mcpDirectory = path.join(bundles, "mcp");
await buildMcpBridge({ outDir: mcpDirectory });
await build({
  stdin: {
    contents: `
    export { startTaskenHeadlessCore } from "./src/main/headless/taskenHeadlessCore.ts";
    export { AiDocumentCreationService } from "./src/main/core/services/aiDocumentCreationService.ts";
    export { createAiDocumentCreationPort } from "./src/main/composition/aiDocumentCreationPort.ts";
    export { DocumentFileStore } from "./src/main/services/documentFileStore.ts";
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
  AiDocumentCreationService,
  createAiDocumentCreationPort,
  DocumentFileStore,
} = await import(pathToFileURL(path.join(bundles, "core.mjs")));

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";

function temporary() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tasken-ai-document-"));
}

/** repositoryの最小の形（get/save/runTransaction）だけを真似る。 */
function fakePersistence() {
  const store = new Map();
  const key = (type, id) => `${type}:${id}`;
  const persistence = {
    workspaceId: "workspace-test",
    get(type, id, includeDeleted = false) {
      const record = store.get(key(type, id));
      if (!record) return null;
      if (record.deleted_at && !includeDeleted) return null;
      return record;
    },
    save(type, entity) {
      const saved = {
        ...entity,
        version: (store.get(key(type, entity.id))?.version || 0) + 1,
        created_at: store.get(key(type, entity.id))?.created_at || "2026-11-19T00:00:00.000Z",
        updated_at: "2026-11-19T00:00:00.000Z",
      };
      store.set(key(type, entity.id), saved);
      return saved;
    },
    runTransaction(callback) {
      return callback({
        get: (type, id, includeDeleted) => persistence.get(type, id, includeDeleted),
        save: (type, entity) => persistence.save(type, entity),
      });
    },
    store,
  };
  persistence.save("theme", { id: "theme-personal-default", name: "個人業務" });
  persistence.save("task", {
    id: "task-1",
    title: "Task",
    project_id: "theme-personal-default",
    state: "todo",
  });
  return persistence;
}

function request(overrides = {}) {
  return {
    task_id: "task-1",
    title: "週次レポート",
    file_name: "report.html",
    content: "<!doctype html><html><body><h1>Report</h1></body></html>",
    caller: "dot",
    source_app: "test-dot",
    source_session: "conversation-1",
    idempotency_key: "doc-1",
    reason: "The user asked for a designed report",
    ...overrides,
  };
}

function listFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listFilesRecursive(full));
    else found.push(full);
  }
  return found;
}

test("direct creation saves a Document with the AI mark, an event and a self-contained file", (t) => {
  const userDataPath = temporary();
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }));
  const persistence = fakePersistence();
  const service = new AiDocumentCreationService(
    persistence,
    createAiDocumentCreationPort(userDataPath),
  );
  const result = service.execute(request());
  assert.equal(result.schema, "tasken-ai-document-creation/v1");
  assert.equal(result.status, "created");
  assert.equal(result.entity.type, "document");
  assert.equal(result.entity.task_id, "task-1");
  assert.equal(result.entity.theme_id, "theme-personal-default");
  assert.equal(result.entity.ai_creation.caller, "dot");
  assert.equal(result.entity.ai_creation.schema, "tasken-ai-creation/v1");
  assert.equal(result.entity.ai_seen_at, null);

  const saved = persistence.get("document", result.entity.id);
  assert.equal(saved.task_id, "task-1");
  assert.equal(saved.media_type, "text/html");
  assert.equal(saved.ai_authority, "ai_generated");
  const events = [...persistence.store.values()].filter(
    (record) => record.event_kind === "document_created",
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].actor_kind, "ai_agent");
  assert.equal(events[0].command_name, "CreateAiDocument");

  const fileStore = new DocumentFileStore(userDataPath);
  const html = fileStore.read(saved.filename);
  assert.equal(html, request().content);
});

test("retry with the same key returns duplicate; different content conflicts", (t) => {
  const userDataPath = temporary();
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }));
  const persistence = fakePersistence();
  const service = new AiDocumentCreationService(
    persistence,
    createAiDocumentCreationPort(userDataPath),
  );
  const first = service.execute(request());
  const second = service.execute(request());
  assert.equal(second.status, "duplicate");
  assert.equal(second.entity.id, first.entity.id);
  const documents = [...persistence.store.keys()].filter((key) => key.startsWith("document:"));
  assert.equal(documents.length, 1);
  assert.throws(
    () => service.execute(request({ content: "<html><body>changed</body></html>" })),
    (error) => error.name === "AiDocumentCreationError" && error.code === "IDEMPOTENCY_CONFLICT",
  );
});

test("missing task and disabled direct writes are refused before anything is written", (t) => {
  const userDataPath = temporary();
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }));
  const persistence = fakePersistence();
  const port = createAiDocumentCreationPort(userDataPath);
  const service = new AiDocumentCreationService(persistence, port);
  assert.throws(
    () => service.execute(request({ task_id: "no-such-task" })),
    (error) => error.name === "CorePublicError" && error.code === "INVALID_REFERENCE",
  );
  const disabled = new AiDocumentCreationService(persistence, port, { isEnabled: () => false });
  assert.throws(
    () => disabled.execute(request()),
    (error) => error.name === "CorePublicError" && error.code === "DIRECT_WRITE_DISABLED",
  );
  assert.equal(listFilesRecursive(path.join(userDataPath, "attachments")).length, 0);
});

test("assets are verified and inlined; staged files are cleaned up", (t) => {
  const userDataPath = temporary();
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }));
  const persistence = fakePersistence();
  const service = new AiDocumentCreationService(
    persistence,
    createAiDocumentCreationPort(userDataPath),
  );
  const result = service.execute(
    request({
      idempotency_key: "doc-assets",
      content: '<!doctype html><html><body><img src="tasken-upload://chart"></body></html>',
      assets: [
        {
          reference_id: "chart",
          file_name: "chart.png",
          media_type: "image/png",
          data_base64: PNG,
        },
      ],
    }),
  );
  assert.equal(result.status, "created");
  const saved = persistence.get("document", result.entity.id);
  const html = new DocumentFileStore(userDataPath).read(saved.filename);
  assert.ok(html.includes(`data:image/png;base64,${PNG}`));
  assert.ok(!html.includes("tasken-upload://"));
  // stage済みアセットは片付けられ、残るのはDocument本体だけ。
  const staged = listFilesRecursive(path.join(userDataPath, "attachments", "document-assets"));
  assert.equal(staged.length, 0);
  const bodies = listFilesRecursive(path.join(userDataPath, "attachments", "documents"));
  assert.equal(bodies.length, 1);
});

test("an invalid asset fails the whole creation and leaves nothing behind", (t) => {
  const userDataPath = temporary();
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }));
  const persistence = fakePersistence();
  const service = new AiDocumentCreationService(
    persistence,
    createAiDocumentCreationPort(userDataPath),
  );
  // media_typeとマジックバイトが食い違う（PNGの中身をvideo/mp4と申告）。
  assert.throws(
    () =>
      service.execute(
        request({
          idempotency_key: "doc-bad-asset",
          content: '<!doctype html><html><body><img src="tasken-upload://chart"></body></html>',
          assets: [
            {
              reference_id: "chart",
              file_name: "chart.mp4",
              media_type: "video/mp4",
              data_base64: PNG,
            },
          ],
        }),
      ),
    (error) => error.name === "CorePublicError" && error.code === "VALIDATION_FAILED",
  );
  // 参照だけあってアセットが無い場合も全体が失敗する。
  assert.throws(
    () =>
      service.execute(
        request({
          idempotency_key: "doc-missing-asset",
          content: '<!doctype html><html><body><img src="tasken-upload://chart"></body></html>',
        }),
      ),
    (error) => error.name === "CorePublicError" && error.code === "VALIDATION_FAILED",
  );
  assert.equal(
    [...persistence.store.keys()].filter((key) => key.startsWith("document:")).length,
    0,
  );
  assert.equal(listFilesRecursive(path.join(userDataPath, "attachments")).length, 0);
});

test("create-only headless: MCP tool is listed and get_task_context shows the Document", async () => {
  const dir = temporary();
  const bootstrap = new WorkspaceDatabase(path.join(dir, "research-desk.sqlite"));
  bootstrap.loadWorkspace();
  bootstrap.db.close();

  let core;
  let transport;
  let mcp;
  try {
    core = await startTaskenHeadlessCore({ userDataPath: dir, writeMode: "create-only" });
    const client = new TaskenCoreClient({ userDataPath: dir });
    const task = await client.createAiItem({
      kind: "task",
      title: "Document host task",
      body: "",
      caller: "dot",
      source_app: "test-dot",
      idempotency_key: "task-for-document",
      reason: "",
    });
    const created = await client.createAiDocument({
      task_id: task.entity.id,
      title: "設計メモ",
      file_name: "design.html",
      content: "<!doctype html><html><body><p>design</p></body></html>",
      caller: "dot",
      source_app: "test-dot",
      idempotency_key: "document-e2e",
      reason: "e2e",
    });
    assert.equal(created.status, "created");
    assert.equal(created.entity.task_id, task.entity.id);

    const context = await client.getTaskContext({ task_id: task.entity.id });
    const documents = context.related?.documents || context.documents || [];
    assert.equal(documents.length, 1);
    assert.equal(documents[0].id, created.entity.id);
    assert.equal(documents[0].title, "設計メモ");
    assert.ok(documents[0].ai, "context should carry the AI origin header");

    transport = new StdioClientTransport({
      command: nodeExecPath,
      args: [path.join(mcpDirectory, "server.mjs")],
      env: { ...process.env, TASKEN_USER_DATA_DIR: dir, TASKEN_MCP_READ_ONLY: "0" },
      stderr: "pipe",
    });
    // ブリッジの起動診断（TASKEN_MCP_DIAGNOSTIC）は子のstderrへ出る。pipeのまま
    // 読み手がいないと、起動に失敗した理由が試験のログへ残らない。
    transport.stderr?.on("data", (chunk) => process.stderr.write(chunk));
    mcp = new Client({ name: "document-test", version: "1" });
    await mcp.connect(transport);
    const tools = (await mcp.listTools()).tools.map((tool) => tool.name);
    assert.ok(tools.includes("tasken.create_document"));

    // file_path 指定でアセットを同梱し、自己完結 HTML へインライン化される（#790）
    const assetFile = path.join(dir, "diagram.png");
    fs.writeFileSync(assetFile, Buffer.from(PNG, "base64"));
    const withPathAsset = await mcp.callTool({
      name: "tasken.create_document",
      arguments: {
        task_id: task.entity.id,
        title: "図入りレポート",
        file_name: "report.html",
        content: '<!doctype html><html><body><img src="tasken-upload://fig1"></body></html>',
        assets: [{ reference_id: "fig1", file_path: assetFile }],
        caller: "dot",
        source_app: "test-dot",
        idempotency_key: "document-file-path-e2e",
        reason: "file_path asset test",
      },
    });
    assert.equal(withPathAsset.isError, undefined, JSON.stringify(withPathAsset));
    assert.equal(withPathAsset.structuredContent.status, "created");
    const savedHtml = new DocumentFileStore(dir).read(
      withPathAsset.structuredContent.entity.file_name,
    );
    assert.ok(
      savedHtml.includes(`data:image/png;base64,${PNG}`),
      "asset should be inlined from file_path",
    );
    assert.equal(savedHtml.includes("tasken-upload://"), false);
  } finally {
    // 後始末は1つにまとめ、閉じてから消す。t.afterを分けると登録順に走る最初の
    // rmSyncが、開いたままのSQLiteに当たってWindowsでEPERMになり、throwした
    // after以降のafter（Core停止・ブリッジ終了）が走らず、Coreと子のプロセスが
    // 残って試験全体が止まる（FAILURES.md 2026-11-16と同じ形）。
    // 途中の片付けが失敗しても、残りの片付けは必ず試す。
    await mcp?.close().catch(() => {});
    await transport?.close().catch(() => {});
    await core?.stop().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
