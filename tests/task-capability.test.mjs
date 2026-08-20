import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { build } from "esbuild";

const bundled = await build({
  stdin: {
    contents: `
      export { ApplicationCommandService } from "./src/main/services/applicationCommandService.ts";
      export {
        TaskCapabilityService,
        createTaskHttpAdapter,
        createTaskMcpAdapter,
        registerTaskIpc,
      } from "./src/main/modules/task/public.ts";
      export { createTaskClient } from "./src/renderer/src/features/task/api/taskClient.ts";
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});

const {
  ApplicationCommandService,
  TaskCapabilityService,
  createTaskHttpAdapter,
  createTaskMcpAdapter,
  registerTaskIpc,
  createTaskClient,
} = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const now = "2026-08-17T13:30:00.000Z";

class MemoryRepository {
  constructor() {
    this.records = new Map();
    this.records.set("theme:theme-personal-default", {
      type: "theme",
      id: "theme-personal-default",
      name: "個人業務",
      version: 1,
    });
  }

  list(type, includeDeleted = false) {
    return [...this.records.values()].filter((entity) => entity.type === type && (includeDeleted || !entity.deleted_at));
  }

  get(type, id, includeDeleted = false) {
    const entity = this.records.get(`${type}:${id}`) || null;
    return entity && (includeDeleted || !entity.deleted_at) ? { ...entity } : null;
  }

  save(type, entity) {
    return this.saveMany([{ action: "save", type, entity }])[0];
  }

  saveMany(operations) {
    return operations.map(({ type, entity }) => {
      const current = this.records.get(`${type}:${entity.id}`);
      const saved = {
        ...entity,
        type,
        version: Number(current?.version || 0) + 1,
        source: entity.source || "manual",
        created_at: entity.created_at || current?.created_at || now,
        updated_at: now,
        deleted_at: entity.deleted_at || null,
      };
      this.records.set(`${type}:${entity.id}`, saved);
      return { ...saved };
    });
  }

  remove(type, id) {
    const current = this.records.get(`${type}:${id}`);
    if (!current) return null;
    const deleted = { ...current, deleted_at: now, updated_at: now, version: Number(current.version) + 1 };
    this.records.set(`${type}:${id}`, deleted);
    return { ...deleted };
  }

  runTransaction(callback) {
    return callback(this);
  }
}

function capability() {
  const repository = new MemoryRepository();
  const application = new ApplicationCommandService(repository);
  return {
    repository,
    service: new TaskCapabilityService(repository, (command) => application.execute(command)),
  };
}

function createCommand(source, suffix) {
  return {
    schemaVersion: 1,
    command_id: `command-${suffix}`,
    name: "CreateTask",
    actor: { kind: "user", id: "actor-1" },
    source,
    issued_at: now,
    payload: {
      task: {
        id: `task-${suffix}`,
        project_id: "theme-personal-default",
        title: `Task ${suffix}`,
        state: "todo",
        priority: "normal",
        today_date: "2026-08-17",
      },
    },
  };
}

test("Desktop, HTTP, and authorized MCP use the same Task application handler semantics", () => {
  const desktop = capability();
  const desktopResponse = desktop.service.executeCommand(createCommand("desktop", "desktop"));

  const http = capability();
  const httpResponse = createTaskHttpAdapter(http.service).handle({
    method: "POST",
    path: "/v1/task/commands",
    body: createCommand("http", "http"),
    authorized: true,
  });

  const mcp = capability();
  const mcpResponse = createTaskMcpAdapter(mcp.service, { allowDirectWrites: true })
    .invoke("task.create", createCommand("mcp", "mcp"));

  assert.equal(desktopResponse.ok, true);
  assert.equal(httpResponse.status, 200);
  assert.equal(httpResponse.body.ok, true);
  assert.equal(mcpResponse.ok, true);
  for (const response of [desktopResponse, httpResponse.body, mcpResponse]) {
    assert.equal(response.value.name, "CreateTask");
    assert.equal(response.value.status, "applied");
    assert.equal(response.value.event.name, "TaskCreated");
    assert.equal(response.value.task.version, 1);
  }
  assert.equal(desktop.repository.list("change_event").length, 1);
  assert.equal(http.repository.list("change_event").length, 1);
  assert.equal(mcp.repository.list("change_event").length, 1);
});

test("Task query returns a bounded public read model through HTTP and MCP adapters", () => {
  const { service } = capability();
  service.executeCommand(createCommand("desktop", "query"));
  const query = {
    schemaVersion: 1,
    query_id: "query-1",
    name: "ListTodayTasks",
    parameters: { date: "2026-08-17", project_id: "theme-personal-default", limit: 10 },
  };
  const http = createTaskHttpAdapter(service).handle({ method: "POST", path: "/v1/task/queries", body: query, authorized: true });
  const mcp = createTaskMcpAdapter(service).invoke("task.list_today", query);
  assert.equal(http.status, 200);
  assert.deepEqual(http.body, mcp);
  assert.equal(mcp.value.items.length, 1);
  assert.equal(Object.hasOwn(mcp.value.items[0], "type"), false);
});

test("MCP direct Task writes are proposal-only by default and HTTP checks authorization", () => {
  const { service } = capability();
  const command = createCommand("mcp", "denied");
  const mcpAdapter = createTaskMcpAdapter(service);
  const mcp = mcpAdapter.invoke("task.create", command);
  const http = createTaskHttpAdapter(service).handle({
    method: "POST",
    path: "/v1/task/commands",
    body: { ...command, source: "http" },
    authorized: false,
  });
  assert.equal(mcp.ok, false);
  assert.equal(mcp.error.code, "FORBIDDEN");
  assert.deepEqual(mcpAdapter.operations.map((operation) => operation.name), [
    "task.create", "task.update", "task.delete", "task.complete", "task.reopen", "task.get", "task.list_today",
  ]);
  assert.match(mcpAdapter.operations.find((operation) => operation.name === "task.update").concurrency, /expected_version/);
  assert.equal(http.status, 403);
  assert.equal(http.body.ok, false);
  assert.equal(http.body.error.code, "FORBIDDEN");
});

test("Electron IPC registrar validates through the same service and publishes a versioned Task event", () => {
  const { service } = capability();
  const handlers = new Map();
  const published = [];
  const changed = [];
  registerTaskIpc({
    channels: { command: "task:command", query: "task:query", changed: "task:changed" },
    handle: (channel, listener) => handlers.set(channel, listener),
    publish: (channel, payload) => published.push({ channel, payload }),
  }, service, () => changed.push(["task"]));

  const response = handlers.get("task:command")({}, createCommand("desktop", "ipc"));
  assert.equal(response.ok, true);
  assert.equal(published[0].channel, "task:changed");
  assert.equal(published[0].payload.name, "TaskCreated");
  assert.deepEqual(changed, [["task"]]);

  const query = handlers.get("task:query")({}, {
    schemaVersion: 1,
    query_id: "query-ipc",
    name: "GetTask",
    parameters: { task_id: "task-ipc" },
  });
  assert.equal(query.ok, true);
  assert.equal(query.value.task.id, "task-ipc");
});

test("Task capability preserves create, update, complete, reopen, and delete version semantics", () => {
  const { service } = capability();
  const created = service.executeCommand(createCommand("desktop", "lifecycle"));
  assert.equal(created.ok, true);

  const context = {
    schemaVersion: 1,
    actor: { kind: "user", id: "actor-1" },
    source: "desktop",
    issued_at: now,
  };
  const updated = service.executeCommand({
    ...context,
    command_id: "command-update",
    name: "UpdateTask",
    payload: { task_id: "task-lifecycle", expected_version: 1, changes: { title: "Updated" } },
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.value.task.version, 2);
  assert.equal(updated.value.event.name, "TaskUpdated");

  const completed = service.executeCommand({
    ...context,
    command_id: "command-complete",
    name: "CompleteTask",
    payload: { task_id: "task-lifecycle", expected_version: 2, completion_note: "done" },
  });
  assert.equal(completed.ok, true);
  assert.equal(completed.value.task.version, 3);
  assert.equal(completed.value.event.name, "TaskCompleted");

  const reopened = service.executeCommand({
    ...context,
    command_id: "command-reopen",
    name: "ReopenTask",
    payload: { task_id: "task-lifecycle", expected_version: 3 },
  });
  assert.equal(reopened.ok, true);
  assert.equal(reopened.value.task.version, 4);
  assert.equal(reopened.value.event.name, "TaskReopened");

  const removed = service.executeCommand({
    ...context,
    command_id: "command-delete",
    name: "DeleteTask",
    payload: { task_id: "task-lifecycle", expected_version: 4 },
  });
  assert.equal(removed.ok, true);
  assert.equal(removed.value.task.version, 5);
  assert.equal(removed.value.event.name, "TaskDeleted");
  assert.equal(typeof removed.value.task.deleted_at, "string");
});

test("Task IPC rejects capability access from a non-main window with a structured error", () => {
  const { service } = capability();
  const handlers = new Map();
  registerTaskIpc({
    channels: { command: "task:command", query: "task:query", changed: "task:changed" },
    handle: (channel, listener) => handlers.set(channel, listener),
    publish: () => assert.fail("denied command must not publish"),
    authorize: () => false,
  }, service);
  const response = handlers.get("task:command")({ sender: "today-mini" }, createCommand("desktop", "forbidden-window"));
  assert.deepEqual(response, {
    ok: false,
    error: {
      code: "FORBIDDEN",
      message: "このウィンドウにはTask capabilityの利用権限がありません。",
      issues: [],
      retryable: false,
    },
  });
});

test("Renderer Task client resyncs by query before delivering an event with a task_version gap", async () => {
  const taskV1 = {
    id: "task-gap",
    project_id: "theme-personal-default",
    title: "Version 1",
    state: "todo",
    priority: "normal",
    today_date: "2026-08-17",
    version: 1,
    source: "manual",
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  const taskV3 = { ...taskV1, title: "Version 3", version: 3 };
  let eventListener;
  let getCalls = 0;
  const capability = {
    create: async () => assert.fail("not used"),
    update: async () => assert.fail("not used"),
    delete: async () => assert.fail("not used"),
    complete: async () => assert.fail("not used"),
    reopen: async () => assert.fail("not used"),
    get: async () => {
      getCalls += 1;
      return { ok: true, value: { schemaVersion: 1, query_id: "resync", name: "GetTask", task: taskV3 } };
    },
    listToday: async (query) => ({
      ok: true,
      value: { schemaVersion: 1, query_id: query.query_id, name: "ListTodayTasks", date: "2026-08-17", items: [taskV1], next_cursor: null },
    }),
    subscribe: (listener) => { eventListener = listener; return () => {}; },
  };
  const client = createTaskClient(capability);
  await client.listToday({ date: "2026-08-17", queryId: "initial" });
  const delivered = new Promise((resolve) => client.subscribe(resolve));
  eventListener({
    schemaVersion: 1,
    event_id: "event-gap",
    name: "TaskUpdated",
    task_id: "task-gap",
    task_version: 3,
    occurred_at: now,
    actor: { kind: "user", id: "actor-1" },
    changed_fields: ["title"],
    task: taskV3,
  });
  const change = await delivered;
  assert.equal(getCalls, 1);
  assert.equal(change.resynced, true);
  assert.equal(change.task.version, 3);
});

test("Renderer Task client reports a failed gap resync instead of swallowing it", async () => {
  const taskV1 = {
    id: "task-gap-error",
    project_id: "theme-personal-default",
    title: "Version 1",
    state: "todo",
    priority: "normal",
    today_date: "2026-08-17",
    version: 1,
    source: "manual",
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  let eventListener;
  const capability = {
    create: async () => assert.fail("not used"),
    update: async () => assert.fail("not used"),
    delete: async () => assert.fail("not used"),
    complete: async () => assert.fail("not used"),
    reopen: async () => assert.fail("not used"),
    get: async () => { throw new Error("resync unavailable"); },
    listToday: async (query) => ({
      ok: true,
      value: { schemaVersion: 1, query_id: query.query_id, name: "ListTodayTasks", date: "2026-08-17", items: [taskV1], next_cursor: null },
    }),
    subscribe: (listener) => { eventListener = listener; return () => {}; },
  };
  const client = createTaskClient(capability);
  await client.listToday({ date: "2026-08-17", queryId: "initial-error" });
  let delivered = false;
  const reported = new Promise((resolve) => client.subscribe(() => { delivered = true; }, resolve));
  eventListener({
    schemaVersion: 1,
    event_id: "event-gap-error",
    name: "TaskUpdated",
    task_id: taskV1.id,
    task_version: 3,
    occurred_at: now,
    actor: { kind: "user", id: "actor-1" },
    changed_fields: ["title"],
    task: { ...taskV1, title: "Version 3", version: 3 },
  });
  const error = await reported;
  assert.equal(error.message, "resync unavailable");
  assert.equal(delivered, false);
});
