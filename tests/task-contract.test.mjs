import assert from "node:assert/strict";
import test from "node:test";

import {
  TASK_CONTRACT_SCHEMA_VERSION,
  parseTaskCommand,
  parseTaskEvent,
  parseTaskQuery,
  parseTaskQueryResult,
} from "../src/shared/contracts/task/public.ts";

const now = "2026-08-17T12:00:00.000Z";

function taskDraft(overrides = {}) {
  return {
    id: "task-contract-1",
    project_id: "project-1",
    title: "KernelとTask contractを固定する",
    description: null,
    state: "doing",
    priority: "high",
    requester: "self",
    intended_executor: "ai_agent",
    work_state: "in_progress",
    checklist_items: [
      { id: "check-1", title: "schemaを定義する", done: true, sort_order: 0, completed_at: now },
    ],
    ...overrides,
  };
}

function taskReadModel(overrides = {}) {
  return {
    ...taskDraft(),
    version: 3,
    source: "manual",
    created_at: now,
    updated_at: now,
    deleted_at: null,
    ...overrides,
  };
}

function createCommand(overrides = {}) {
  return {
    schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
    command_id: "command-1",
    name: "CreateTask",
    actor: { kind: "user", id: "actor-1" },
    source: "desktop",
    issued_at: now,
    payload: { task: taskDraft() },
    ...overrides,
  };
}

test("Task command schema validates a complete v1 create command", () => {
  const parsed = parseTaskCommand(createCommand());
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.name, "CreateTask");
    assert.equal(parsed.value.payload.task.description, null);
  }
});

test("Task command schema reports the nested path of an invalid required field", () => {
  const parsed = parseTaskCommand(createCommand({ payload: { task: taskDraft({ title: "" }) } }));
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.error.code, "INVALID_COMMAND");
    assert.ok(parsed.error.issues.some((issue) => issue.path.join(".") === "payload.task.title"));
  }
});

test("Task contract rejects an unknown future schema version with a structured error", () => {
  const parsed = parseTaskCommand(createCommand({ schemaVersion: 2 }));
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.error.code, "UNSUPPORTED_FUTURE_SCHEMA_VERSION");
    assert.deepEqual(parsed.error.issues[0].path, ["schemaVersion"]);
    assert.deepEqual(parsed.error.details, { receivedVersion: 2, currentVersion: 1 });
  }
});

test("Task contract has an explicit no-legacy-migration result for pre-v1 payloads", () => {
  const parsed = parseTaskCommand(createCommand({ schemaVersion: 0 }));
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.error.code, "UNSUPPORTED_SCHEMA_VERSION");
    assert.deepEqual(parsed.error.issues[0].path, ["schemaVersion"]);
  }
});

test("Task contract distinguishes nullable, optional, enum, and unknown fields", () => {
  const nullable = parseTaskCommand(createCommand({ payload: { task: taskDraft({ description: null }) } }));
  assert.equal(nullable.ok, true);

  const optionalTask = taskDraft();
  delete optionalTask.description;
  assert.equal(parseTaskCommand(createCommand({ payload: { task: optionalTask } })).ok, true);

  const invalidEnum = parseTaskCommand(createCommand({ payload: { task: taskDraft({ state: "closed" }) } }));
  assert.equal(invalidEnum.ok, false);
  if (!invalidEnum.ok) assert.ok(invalidEnum.error.issues.some((issue) => issue.path.join(".") === "payload.task.state"));

  const unknown = parseTaskCommand({ ...createCommand(), transport_only: true });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.ok(unknown.error.issues.some((issue) => issue.path.includes("transport_only")));
});

test("Desktop, Mobile, HTTP, and MCP serialize through the same Task command contract", () => {
  for (const source of ["desktop", "mobile", "http", "mcp"]) {
    const wireValue = JSON.parse(JSON.stringify(createCommand({ source })));
    const parsed = parseTaskCommand(wireValue);
    assert.equal(parsed.ok, true, source);
    if (parsed.ok) assert.equal(parsed.value.source, source);
  }
});

test("Task query and public read model round-trip through JSON", () => {
  const query = {
    schemaVersion: 1,
    query_id: "query-1",
    name: "ListTasks",
    parameters: { project_id: "project-1", states: ["todo", "doing"], limit: 50 },
  };
  const result = {
    schemaVersion: 1,
    query_id: "query-1",
    name: "ListTasks",
    items: [taskReadModel()],
    next_cursor: null,
  };
  assert.equal(parseTaskQuery(JSON.parse(JSON.stringify(query))).ok, true);
  const parsedResult = parseTaskQueryResult(JSON.parse(JSON.stringify(result)));
  assert.equal(parsedResult.ok, true);
  if (parsedResult.ok) assert.equal(parsedResult.value.items[0].version, 3);
});

test("Task event schema preserves the versioned read model", () => {
  const event = {
    schemaVersion: 1,
    event_id: "event-1",
    task_id: "task-contract-1",
    task_version: 3,
    occurred_at: now,
    actor: { kind: "user", id: "actor-1" },
    name: "TaskUpdated",
    changed_fields: ["title", "state"],
    task: taskReadModel(),
  };
  const parsed = parseTaskEvent(JSON.parse(JSON.stringify(event)));
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(parsed.value.changed_fields, ["title", "state"]);
});
