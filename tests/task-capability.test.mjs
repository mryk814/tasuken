import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
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
      export { TASK_CONTRACT_SCHEMA_VERSION } from "./src/shared/contracts/task/public.ts";
      export { createTaskClient, projectTaskDraft } from "./src/renderer/src/features/task/public.ts";
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
  TASK_CONTRACT_SCHEMA_VERSION,
  TaskCapabilityService,
  createTaskHttpAdapter,
  createTaskMcpAdapter,
  registerTaskIpc,
  createTaskClient,
  projectTaskDraft,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const now = "2026-08-17T13:30:00.000Z";

test("Preload configures Zod without JIT before importing Task contracts", async () => {
  const preloadSource = readFileSync("src/preload/index.ts", "utf8");
  const configureImport = 'import "./configureContractValidation";';
  const taskImport = 'import { createTaskPreloadCapability } from "./capabilities/task";';
  assert.ok(preloadSource.indexOf(configureImport) < preloadSource.indexOf(taskImport));
  assert.doesNotMatch(readFileSync("src/renderer/index.html", "utf8"), /unsafe-eval/);

  const preloadContractBundle = await build({
    stdin: {
      contents: `
        import "./src/preload/configureContractValidation.ts";
        export { taskCommandResponseSchema } from "./src/shared/contracts/task/public.ts";
      `,
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  const preloadContract = await import(
    `data:text/javascript;base64,${Buffer.from(preloadContractBundle.outputFiles[0].text).toString("base64")}`
  );
  const OriginalFunction = globalThis.Function;
  globalThis.Function = function blockedFunctionConstructor() {
    throw new Error("Function constructor must not run at the Preload contract boundary");
  };
  try {
    assert.doesNotThrow(() => preloadContract.taskCommandResponseSchema.safeParse({}));
  } finally {
    globalThis.Function = OriginalFunction;
  }
});

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
    return [...this.records.values()].filter(
      (entity) => entity.type === type && (includeDeleted || !entity.deleted_at),
    );
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
    const deleted = {
      ...current,
      deleted_at: now,
      updated_at: now,
      version: Number(current.version) + 1,
    };
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
    application,
    service: new TaskCapabilityService(repository, (command) => application.execute(command)),
  };
}

function createCommand(source, suffix) {
  return {
    schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
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

test("UpdateTask three-way merges different fields and rejects a same-field race", () => {
  const { service } = capability();
  const created = service.executeCommand(createCommand("desktop", "field-merge"));
  assert.equal(created.ok, true);

  const priorityUpdate = service.executeCommand({
    schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
    command_id: "command-priority-update",
    name: "UpdateTask",
    actor: { kind: "user", id: "desktop-user" },
    source: "desktop",
    issued_at: now,
    payload: {
      task_id: "task-field-merge",
      expected_version: 1,
      changes: { priority: "high" },
    },
  });
  assert.equal(priorityUpdate.ok, true);

  const mergedTitle = service.executeCommand({
    schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
    command_id: "command-mobile-title",
    name: "UpdateTask",
    actor: { kind: "user", id: "mobile-device" },
    source: "mobile",
    issued_at: now,
    payload: {
      task_id: "task-field-merge",
      expected_version: 1,
      changes: { title: "Mobile title" },
      base: { title: "Task field-merge" },
    },
  });
  assert.equal(mergedTitle.ok, true);
  assert.equal(mergedTitle.value.task.title, "Mobile title");
  assert.equal(mergedTitle.value.task.priority, "high");
  assert.equal(mergedTitle.value.task.version, 3);

  const desktopTitle = service.executeCommand({
    schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
    command_id: "command-desktop-title",
    name: "UpdateTask",
    actor: { kind: "user", id: "desktop-user" },
    source: "desktop",
    issued_at: now,
    payload: {
      task_id: "task-field-merge",
      expected_version: 3,
      changes: { title: "Desktop title" },
    },
  });
  assert.equal(desktopTitle.ok, true);

  const conflict = service.executeCommand({
    schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
    command_id: "command-mobile-title-conflict",
    name: "UpdateTask",
    actor: { kind: "user", id: "mobile-device" },
    source: "mobile",
    issued_at: now,
    payload: {
      task_id: "task-field-merge",
      expected_version: 3,
      changes: { title: "Second mobile title" },
      base: { title: "Mobile title" },
    },
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error.conflict_reason, "version_conflict");
  assert.equal(conflict.error.details.current_task.title, "Desktop title");
});

test("Task capability creates, edits, clears, and projects the separately versioned canonical Schedule", () => {
  const { repository, service } = capability();
  assert.equal(service.executeCommand(createCommand("mobile", "schedule-lifecycle")).ok, true);
  const schedule = (overrides = {}) => ({
    start_date: null,
    end_date: "2026-08-24",
    date_kind: "deadline",
    range_semantics: null,
    confidence: "fixed",
    granularity: "day",
    ...overrides,
  });
  const command = (command_id, expectedVersion, expectedScheduleVersion, changes, base) => ({
    schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
    command_id,
    name: "UpdateTask",
    actor: { kind: "user", id: "mobile-device" },
    source: "mobile",
    issued_at: now,
    payload: {
      task_id: "task-schedule-lifecycle",
      expected_version: expectedVersion,
      schedule_change: { expected_version: expectedScheduleVersion, changes, base },
    },
  });

  const created = service.executeCommand(command("schedule-created", 1, null, schedule(), null));
  assert.equal(created.ok, true);
  assert.equal(created.value.task.version, 2);
  assert.deepEqual(created.value.task.schedule, {
    id: "schedule-created",
    owner_type: "task",
    owner_id: "task-schedule-lifecycle",
    start_date: null,
    end_date: "2026-08-24",
    date_kind: "deadline",
    range_semantics: null,
    confidence: "fixed",
    granularity: "day",
    version: 1,
    source: "manual",
    created_at: now,
    updated_at: now,
    deleted_at: null,
  });

  const unrelatedTaskUpdate = service.executeCommand({
    schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
    command_id: "task-priority-before-schedule",
    name: "UpdateTask",
    actor: { kind: "user", id: "desktop-user" },
    source: "desktop",
    issued_at: now,
    payload: {
      task_id: "task-schedule-lifecycle",
      expected_version: 2,
      changes: { priority: "high" },
    },
  });
  assert.equal(unrelatedTaskUpdate.ok, true);
  assert.equal(unrelatedTaskUpdate.value.task.version, 3);

  const range = schedule({
    start_date: "2026-08-22",
    end_date: "2026-08-24",
    date_kind: "range",
    range_semantics: null,
  });
  // The Schedule base/current still match, so a stale Task version must rebase safely.
  const edited = service.executeCommand(command("schedule-edited", 2, 1, range, schedule()));
  assert.equal(edited.ok, true);
  assert.equal(edited.value.task.version, 4);
  assert.equal(edited.value.task.priority, "high");
  assert.equal(edited.value.task.schedule.id, "schedule-created");
  assert.equal(edited.value.task.schedule.version, 2);
  assert.equal(edited.value.task.schedule.range_semantics, null);

  const clearedValue = schedule({ start_date: null, end_date: null, date_kind: "unknown" });
  const cleared = service.executeCommand(command("schedule-cleared", 4, 2, clearedValue, range));
  assert.equal(cleared.ok, true);
  assert.equal(cleared.value.task.schedule.id, "schedule-created");
  assert.equal(cleared.value.task.schedule.version, 3);
  assert.equal(cleared.value.task.schedule.start_date, null);
  assert.equal(cleared.value.task.schedule.end_date, null);
  assert.equal(repository.list("schedule").length, 1);

  const stale = service.executeCommand(command("schedule-stale", 5, 2, schedule(), range));
  assert.equal(stale.ok, false);
  assert.equal(stale.error.conflict_reason, "version_conflict");
  assert.equal(stale.error.details.current_task.schedule.version, 3);
});

test("Task application boundary rejects a second active Schedule for the same owner", () => {
  const { application, repository, service } = capability();
  assert.equal(service.executeCommand(createCommand("desktop", "one-schedule-owner")).ok, true);
  const task = repository.get("task", "task-one-schedule-owner");
  const first = application.execute({
    commandId: "application-schedule-first",
    name: "UpdateTask",
    actor: { kind: "user" },
    source: "main_ui",
    issuedAt: now,
    payload: {
      task,
      schedule: {
        id: "schedule-first",
        owner_type: "task",
        owner_id: task.id,
        start_date: "2026-08-22",
        end_date: "2026-08-22",
        date_kind: "point",
        range_semantics: null,
        confidence: "fixed",
        granularity: "day",
      },
    },
    expectedVersions: [{ type: "task", id: task.id, version: task.version }],
  });
  assert.equal(first.status, "applied");
  const current = repository.get("task", task.id);
  assert.throws(
    () =>
      application.execute({
        commandId: "application-schedule-second",
        name: "UpdateTask",
        actor: { kind: "user" },
        source: "main_ui",
        issuedAt: now,
        payload: {
          task: current,
          schedule: {
            id: "schedule-second",
            owner_type: "task",
            owner_id: task.id,
            start_date: "2026-08-23",
            end_date: "2026-08-23",
            date_kind: "point",
            range_semantics: null,
            confidence: "fixed",
            granularity: "day",
          },
        },
        expectedVersions: [{ type: "task", id: task.id, version: current.version }],
      }),
    /active Scheduleを1件だけ/,
  );
});

test("CreateTask stores validated capture provenance only on its canonical change event", () => {
  const { application, repository, service } = capability();
  const provenance = {
    reported_via: "share_target",
    captured_at: now,
    capture_method: null,
    recognition_mode: null,
    language: null,
    confidence: null,
    source_audio_available: null,
    shared_mime_type: "text/plain",
  };
  const command = createCommand("mobile", "capture-provenance");
  command.payload.provenance = provenance;

  const response = service.executeCommand(command);

  assert.equal(response.ok, true);
  assert.deepEqual(repository.list("change_event")[0].metadata.provenance, provenance);
  assert.equal(
    Object.hasOwn(repository.get("task", "task-capture-provenance"), "provenance"),
    false,
  );

  assert.throws(
    () =>
      application.execute({
        commandId: "application-invalid-provenance",
        name: "CreateTask",
        actor: { kind: "user" },
        source: "main_ui",
        issuedAt: now,
        payload: {
          task: {
            ...createCommand("mobile", "invalid-provenance").payload.task,
          },
          provenance: { ...provenance, shared_mime_type: null },
        },
      }),
    /provenance/,
  );
});

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
  const mcpResponse = createTaskMcpAdapter(mcp.service, { allowDirectWrites: true }).invoke(
    "task.create",
    createCommand("mcp", "mcp"),
  );

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
    schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
    query_id: "query-1",
    name: "ListTodayTasks",
    parameters: { date: "2026-08-17", project_id: "theme-personal-default", limit: 10 },
  };
  const http = createTaskHttpAdapter(service).handle({
    method: "POST",
    path: "/v1/task/queries",
    body: query,
    authorized: true,
  });
  const mcp = createTaskMcpAdapter(service).invoke("task.list_today", query);
  assert.equal(http.status, 200);
  assert.deepEqual(http.body, mcp);
  assert.equal(mcp.value.items.length, 1);
  assert.equal(Object.hasOwn(mcp.value.items[0], "type"), false);
});

test("Task query normalizes a legacy empty checklist completion timestamp", () => {
  const { repository, service } = capability();
  service.executeCommand(createCommand("desktop", "legacy-checklist"));
  const key = "task:task-legacy-checklist";
  repository.records.set(key, {
    ...repository.records.get(key),
    checklist_items: [
      {
        id: "check-legacy-empty-completed-at",
        title: "Legacy checklist item",
        done: false,
        sort_order: 0,
        completed_at: "",
      },
    ],
  });

  const result = service.executeQuery({
    schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
    query_id: "query-legacy-checklist",
    name: "ListTodayTasks",
    parameters: { date: "2026-08-17", limit: 10 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.items[0].checklist_items[0].completed_at, null);
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
  assert.deepEqual(
    mcpAdapter.operations.map((operation) => operation.name),
    [
      "task.create",
      "task.update",
      "task.delete",
      "task.complete",
      "task.reopen",
      "task.get",
      "task.list_today",
    ],
  );
  assert.match(
    mcpAdapter.operations.find((operation) => operation.name === "task.update").concurrency,
    /expected_version/,
  );
  assert.equal(http.status, 403);
  assert.equal(http.body.ok, false);
  assert.equal(http.body.error.code, "FORBIDDEN");
});

test("Electron IPC registrar validates through the same service and publishes a versioned Task event", () => {
  const { service } = capability();
  const handlers = new Map();
  const published = [];
  const changed = [];
  registerTaskIpc(
    {
      channels: { command: "task:command", query: "task:query", changed: "task:changed" },
      handle: (channel, listener) => handlers.set(channel, listener),
      publish: (channel, payload) => published.push({ channel, payload }),
    },
    service,
    () => changed.push(["task"]),
  );

  const response = handlers.get("task:command")({}, createCommand("desktop", "ipc"));
  assert.equal(response.ok, true);
  assert.equal(published[0].channel, "task:changed");
  assert.equal(published[0].payload.name, "TaskCreated");
  assert.deepEqual(changed, [["task"]]);

  const query = handlers.get("task:query")(
    {},
    {
      schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
      query_id: "query-ipc",
      name: "GetTask",
      parameters: { task_id: "task-ipc" },
    },
  );
  assert.equal(query.ok, true);
  assert.equal(query.value.task.id, "task-ipc");
});

test("Task capability preserves create, update, complete, reopen, and delete version semantics", () => {
  const { service } = capability();
  const created = service.executeCommand(createCommand("desktop", "lifecycle"));
  assert.equal(created.ok, true);

  const context = {
    schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
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

test("Renderer Task edit selects lifecycle commands through the public client and preserves versions", async () => {
  const { service, repository } = capability();
  const commands = [];
  const execute = async (command) => {
    commands.push(command);
    return service.executeCommand(command);
  };
  const client = createTaskClient({ create: execute, update: execute, complete: execute, reopen: execute });
  const context = (name) => ({
    commandId: `renderer-edit-${name}`,
    issuedAt: now,
    actor: { kind: "user", id: "actor-1" },
    entrypoint: "main_ui",
  });
  const draft = createCommand("desktop", "renderer-edit").payload.task;
  const created = await client.applyEdit(draft, null, context("create"));
  assert.equal(created.task.version, 1);
  assert.equal(created.event.name, "TaskCreated");

  const editedDraft = projectTaskDraft({ ...created.task, title: "Edited", renderer_only: true });
  const updated = await client.applyEdit(editedDraft, created.task, context("update"));
  assert.equal(updated.task.version, 2);
  assert.equal(updated.task.title, "Edited");
  assert.equal(updated.event.name, "TaskUpdated");

  const completed = await client.applyEdit(
    { ...editedDraft, state: "done", completion_note: "Finished" },
    updated.task,
    context("complete"),
  );
  assert.equal(completed.task.version, 3);
  assert.equal(completed.task.completion_note, "Finished");
  assert.equal(completed.event.name, "TaskCompleted");

  const stillDone = await client.applyEdit(
    { ...projectTaskDraft(completed.task), title: "Edited after completion" },
    completed.task,
    context("still-done"),
  );
  assert.equal(stillDone.task.version, 4);
  assert.equal(stillDone.event.name, "TaskUpdated");

  const reopened = await client.applyEdit(
    { ...projectTaskDraft(stillDone.task), state: "doing" },
    stillDone.task,
    context("reopen"),
  );
  assert.equal(reopened.task.version, 5);
  // ReopenTask keeps the existing application semantics: a reopened Task is todo.
  assert.equal(reopened.task.state, "todo");
  assert.equal(reopened.event.name, "TaskReopened");
  assert.equal(repository.get("task", draft.id).version, 5);
  assert.deepEqual(commands.map((command) => command.name), [
    "CreateTask", "UpdateTask", "CompleteTask", "UpdateTask", "ReopenTask",
  ]);
  assert.deepEqual(commands.slice(1).map((command) => command.payload.expected_version), [1, 2, 3, 4]);
  assert.equal(commands[4].payload.changes.state, "doing");
  assert.ok(commands.every((command) => command.source === "desktop" && command.entrypoint === "main_ui"));
  assert.ok(commands.every((command) => command.actor.id === "actor-1" && command.issued_at === now));
  assert.ok(commands.slice(1).every((command) => !("id" in command.payload.changes)));
  assert.equal("renderer_only" in commands[1].payload.changes, false);
  assert.equal(editedDraft.state, "todo");
});

test("Renderer Task edit preserves conflict details and transport failures without changing the draft", async () => {
  const { service, repository } = capability();
  const execute = async (command) => service.executeCommand(command);
  const client = createTaskClient({ create: execute, update: execute });
  const draft = createCommand("desktop", "renderer-conflict").payload.task;
  const created = await client.applyEdit(draft, null, { commandId: "renderer-conflict-create", issuedAt: now });
  await client.applyEdit({ ...draft, title: "Saved elsewhere" }, created.task, {
    commandId: "renderer-conflict-update", issuedAt: now,
  });
  const staleDraft = { ...draft, title: "Unsaved edit" };
  await assert.rejects(
    client.applyEdit(staleDraft, created.task, { commandId: "renderer-conflict-stale", issuedAt: now }),
    (error) => error.name === "TaskClientError" && error.code === "CONFLICT" && error.retryable === false,
  );
  assert.equal(repository.get("task", draft.id).title, "Saved elsewhere");
  assert.equal(repository.get("task", draft.id).version, 2);
  assert.equal(staleDraft.title, "Unsaved edit");

  const failure = new Error("Task transport unavailable");
  const failingClient = createTaskClient({ update: async () => { throw failure; } });
  await assert.rejects(
    failingClient.applyEdit(staleDraft, created.task, { commandId: "renderer-transport-failed", issuedAt: now }),
    (error) => error === failure,
  );
  assert.equal(staleDraft.title, "Unsaved edit");
});

test("Task IPC rejects capability access from a non-main window with a structured error", () => {
  const { service } = capability();
  const handlers = new Map();
  registerTaskIpc(
    {
      channels: { command: "task:command", query: "task:query", changed: "task:changed" },
      handle: (channel, listener) => handlers.set(channel, listener),
      publish: () => assert.fail("denied command must not publish"),
      authorize: () => false,
    },
    service,
  );
  const response = handlers.get("task:command")(
    { sender: "today-mini" },
    createCommand("desktop", "forbidden-window"),
  );
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
    schedule: null,
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
      return {
        ok: true,
        value: {
          schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
          query_id: "resync",
          name: "GetTask",
          task: taskV3,
        },
      };
    },
    listToday: async (query) => ({
      ok: true,
      value: {
        schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
        query_id: query.query_id,
        name: "ListTodayTasks",
        date: "2026-08-17",
        items: [taskV1],
        next_cursor: null,
      },
    }),
    subscribe: (listener) => {
      eventListener = listener;
      return () => {};
    },
  };
  const client = createTaskClient(capability);
  await client.listToday({ date: "2026-08-17", queryId: "initial" });
  const delivered = new Promise((resolve) => client.subscribe(resolve));
  eventListener({
    schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
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
    schedule: null,
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
    get: async () => {
      throw new Error("resync unavailable");
    },
    listToday: async (query) => ({
      ok: true,
      value: {
        schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
        query_id: query.query_id,
        name: "ListTodayTasks",
        date: "2026-08-17",
        items: [taskV1],
        next_cursor: null,
      },
    }),
    subscribe: (listener) => {
      eventListener = listener;
      return () => {};
    },
  };
  const client = createTaskClient(capability);
  await client.listToday({ date: "2026-08-17", queryId: "initial-error" });
  let delivered = false;
  const reported = new Promise((resolve) =>
    client.subscribe(() => {
      delivered = true;
    }, resolve),
  );
  eventListener({
    schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
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
