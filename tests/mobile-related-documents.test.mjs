import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createMobileOfflineGateway } from "./helpers/mobile-offline-gateway.mjs";

const bundle = await build({
  stdin: {
    contents: `
  export { MobileGatewayAdapter } from './src/main/gateway/mobile/mobileGatewayAdapter.ts';
  export { createMobileRelatedDocumentReadPort } from './src/main/composition/mobileRelatedDocumentReadPort.ts';
`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { MobileGatewayAdapter, createMobileRelatedDocumentReadPort } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
function fixture() {
  const rows = { task: [{ id: "task", version: 1 }], note: [], capture_entry: [], reference: [] };
  const port = createMobileRelatedDocumentReadPort({
    get: (type, id) => rows[type]?.find((record) => record.id === id && !record.deleted_at) || null,
    list: (type) => rows[type]?.filter((record) => !record.deleted_at) || [],
  });
  const adapter = new MobileGatewayAdapter({
    core: {
      status: () => ({ apiVersion: "1", capabilities: ["task.query", "task.command"] }),
      ...port,
    },
    state: {
      current: () => ({
        serverId: "desktop-related",
        serverRevision: 1,
        generatedAt: "2026-09-06T08:00:00Z",
      }),
    },
  });
  const request = (query = {}, options = {}) =>
    adapter.handle({
      method: "GET",
      path: "/v1/task-related-documents",
      query: { apiVersion: "1", schemaVersion: "7", taskId: "task", ...query },
      principal: { kind: "mobile_device", deviceId: "phone", scopes: ["mobile:read"] },
      ...options,
    });
  function note(id, extra = {}) {
    rows.note.push({
      id,
      title: `資料 ${id}`,
      body_markdown: " private owner text ",
      version: 1,
      ai_visibility: [],
      ...extra,
    });
    rows.reference.push({
      id: `ref-${id}`,
      source_type: "task",
      source_id: "task",
      target_type: "note",
      target_id: id,
      relation_type: "related_to",
      status: "asserted",
    });
  }
  return { rows, request, note };
}

test("owner read is independently scoped and validates query before projection", async () => {
  const f = fixture();
  assert.equal((await f.request({}, { principal: null })).status, 401);
  assert.equal(
    (
      await f.request(
        {},
        {
          principal: { kind: "mobile_device", deviceId: "phone", scopes: ["mobile:context-read"] },
        },
      )
    ).status,
    403,
  );
  assert.equal((await f.request({ limit: "51" })).status, 400);
  assert.equal((await f.request({ locator: "file:///secret" })).status, 400);
  const health = await f.request({}, { path: "/v1/health", query: {} });
  assert.ok(health.body.data.capabilities.includes("mobile.task-related.read"));
});

test("explicit source and accepted references list without body; suggestions and unrelated material are excluded", async () => {
  const f = fixture();
  f.note("private");
  f.note("suggested");
  f.rows.reference[1].status = "suggested";
  f.rows.capture_entry.push({
    id: "source",
    version: 1,
    text: "source text",
    triaged_to_type: "task",
    triaged_to_id: "task",
  });
  f.rows.note.push({ id: "unrelated", title: "same theme", version: 1 });
  const list = await f.request();
  assert.equal(list.status, 200);
  assert.deepEqual(
    list.body.data.documents.map((item) => item.id),
    ["source", "private"],
  );
  assert.ok(!JSON.stringify(list.body).includes("private owner text"));
  assert.deepEqual(list.body.data.documents[0].reasons, [
    { predicate: "triaged_to", direction: "to_task" },
  ]);
  const body = await f.request(
    { type: "note", id: "private" },
    { path: "/v1/task-related-document" },
  );
  assert.equal(body.body.data.document.body, " private owner text ");
  const unavailable = await f.request(
    { type: "note", id: "unrelated" },
    { path: "/v1/task-related-document" },
  );
  assert.equal(unavailable.body.data.status, "not_related");
  assert.equal(unavailable.body.data.document, null);
});

test("bounded lists continue, stale cursors fail explicitly, long text and removed sources are truthful", async () => {
  const f = fixture();
  for (let index = 0; index < 51; index++) f.note(`note-${String(index).padStart(2, "0")}`);
  const first = (await f.request()).body.data;
  assert.equal(first.documents.length, 50);
  assert.ok(first.nextCursor);
  const last = (await f.request({ cursor: first.nextCursor })).body.data;
  assert.equal(last.documents.length, 1);
  assert.equal(last.nextCursor, null);
  f.rows.note[0].version = 2;
  assert.equal((await f.request({ cursor: first.nextCursor })).body.data.status, "cursor_stale");
  f.rows.note[0].body_markdown = "x".repeat(50001);
  const long = (
    await f.request({ type: "note", id: "note-00" }, { path: "/v1/task-related-document" })
  ).body.data.document;
  assert.equal(long.body.length, 50000);
  assert.equal(long.totalCharacters, 50001);
  assert.equal(long.truncated, true);
  f.rows.note[0].deleted_at = "2026-09-06T09:00:00Z";
  const broken = (await f.request()).body.data.documents.find((item) => item.id === "note-00");
  assert.equal(broken.status, "not_found");
  assert.equal(broken.version, null);
  assert.ok(!broken.title.includes("資料"));
  assert.equal(
    (await f.request({ type: "note", id: "note-00" }, { path: "/v1/task-related-document" })).body
      .data.document,
    null,
  );
  f.rows.task[0].deleted_at = "2026-09-06T09:00:00Z";
  assert.equal((await f.request()).body.data.status, "not_found");
});

test("real Gateway/Core/SQLite serves owner documents through restart and receives deletion", async () => {
  const fixture = await createMobileOfflineGateway();
  try {
    await fixture.control({ seedRelatedDocuments: true });
    const read = async (endpoint, query = {}) => {
      const params = new URLSearchParams({
        apiVersion: "1",
        schemaVersion: "7",
        taskId: "related-fixture-task",
        ...query,
      });
      const response = await fetch(`${fixture.config.origin}/v1/${endpoint}?${params}`, {
        headers: { authorization: `Bearer ${fixture.config.accessToken}` },
      });
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      return body.data;
    };
    const first = await read("task-related-documents");
    assert.equal(first.documents.length, 50);
    assert.ok(first.documents.some((item) => item.id === "related-source-capture"));
    const second = await read("task-related-documents", { cursor: first.nextCursor });
    assert.equal(second.documents.length, 2);
    const note = await read("task-related-document", { type: "note", id: "related-note-00" });
    assert.ok(note.document.body.length <= 50000);
    assert.ok(note.document.truncated);
    assert.equal(note.document.body.isWellFormed(), true);
    const capture = await read("task-related-document", {
      type: "capture_entry",
      id: "related-source-capture",
    });
    assert.equal(capture.document.body, "Taskの作成元の原文");
    await fixture.control({ restartDesktop: true });
    const restarted = await read("task-related-document", { type: "note", id: "related-note-00" });
    assert.equal(restarted.status, "available");
    assert.equal(restarted.document.body === note.document.body, true);
    assert.ok(restarted.document.version >= note.document.version);
    await fixture.control({ removeRelatedDocument: true });
    assert.equal(
      (await read("task-related-document", { type: "note", id: "related-note-00" })).status,
      "not_found",
    );
  } finally {
    await fixture.close();
  }
});
