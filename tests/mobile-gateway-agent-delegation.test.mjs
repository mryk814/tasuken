import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import { build } from "esbuild";

const bundled = await build({
  stdin: {
    contents: `
      export { ApplicationCommandService } from "./src/main/services/applicationCommandService.ts";
      export { TaskCapabilityService } from "./src/main/modules/task/public.ts";
      export { safeReceiptText, publicTaskForContext, TaskContextTextBudget } from "./src/shared/taskContext.mjs";
      export { formatTaskLocator, parseTaskLocator } from "./src/shared/contracts/mobile/public.mjs";
      export { entityIdSchema } from "./src/shared/kernel/id.ts";
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
  entityIdSchema,
  TaskCapabilityService,
  formatTaskLocator,
  parseTaskLocator,
  publicTaskForContext,
  safeReceiptText,
  TaskContextTextBudget,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const now = "2026-08-30T01:00:00.000Z";

class MemoryRepository {
  constructor() {
    this.records = new Map();
    this.records.set("theme:theme-personal-default", {
      type: "theme",
      id: "theme-personal-default",
      name: "Personal",
      version: 1,
      ai_visibility: ["coding_agent"],
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
    const deleted = { ...current, deleted_at: now, version: Number(current.version) + 1 };
    this.records.set(`${type}:${id}`, deleted);
    return { ...deleted };
  }

  runTransaction(callback) {
    return callback(this);
  }
}

test("canonical Task locator round-trips exact IDs with one strict percent decode", () => {
  for (const id of ["task /?#%+@!'()* 日本語🚀", "%2F", "/abc/", "line\nbreak", "e\u0301", "é"]) {
    const locator = formatTaskLocator(id);
    assert.equal(parseTaskLocator(locator), id);
  }
  assert.equal(parseTaskLocator("tasken://task/%252F"), "%2F");
  assert.equal(entityIdSchema.safeParse("\ud800").success, false);
  assert.throws(() => formatTaskLocator("\ud800"), TypeError);
  for (const invalid of [
    "tasken://task/",
    "tasken://task/%",
    "tasken://task/%61",
    "tasken://task/a%2fb",
    "tasken://task/a?b",
    "tasken://task/a#b",
    "tasken://user@task/a",
    "tasken://task:1/a",
    "TASKEN://task/a",
  ]) {
    assert.equal(parseTaskLocator(invalid), null);
  }
});

test("canonical public text removes credentials, local paths, URL secrets, and hidden reasoning", () => {
  const safe = safeReceiptText(
    "Bearer bearer-secret password=hunter2 C:\\Users\\me\\secret.txt /home/me/.env " +
      "https://user:pass@example.com/path?api_key=query-secret#hash-secret " +
      "<analysis>private chain of thought</analysis> " +
      "-----BEGIN PRIVATE KEY-----\npem-key-material\n-----END PRIVATE KEY----- " +
      `ghp_${"a".repeat(36)} sk_live_${"b".repeat(24)} ` +
      `AIza${"c".repeat(35)} npm_${"d".repeat(36)}`,
  );
  for (const secret of [
    "bearer-secret",
    "hunter2",
    "Users\\me",
    "/home/me",
    "query-secret",
    "hash-secret",
    "private chain of thought",
    "user:pass",
    "pem-key-material",
    `ghp_${"a".repeat(36)}`,
    `sk_live_${"b".repeat(24)}`,
    `AIza${"c".repeat(35)}`,
    `npm_${"d".repeat(36)}`,
  ]) {
    assert.equal(safe.includes(secret), false);
  }
  assert.equal(safe.includes("https://example.com/path"), true);
  const projected = publicTaskForContext(
    {
      id: "task-public",
      version: 1,
      title: "Bearer producer-secret",
      description: "password=producer-password /home/me/private.txt",
      state: "todo",
    },
    new TaskContextTextBudget(10_000),
  );
  assert.equal(JSON.stringify(projected).includes("producer-secret"), false);
  assert.equal(JSON.stringify(projected).includes("producer-password"), false);
  assert.equal(JSON.stringify(projected).includes("/home/me"), false);
});

test("TaskUpdated reports persisted derived work_state changes", () => {
  const repository = new MemoryRepository();
  const application = new ApplicationCommandService(repository);
  application.execute({
    commandId: "create-derived-task",
    name: "CreateTask",
    actor: { kind: "user", id: "desktop-user" },
    source: "main_ui",
    issuedAt: now,
    payload: {
      task: {
        id: "task-derived-work-state",
        title: "Derived fields",
        project_id: "theme-personal-default",
        state: "todo",
        priority: "normal",
        requester: "self",
        intended_executor: "self",
      },
    },
  });
  const capability = new TaskCapabilityService(repository, (command) =>
    application.execute(command),
  );
  const result = capability.executeCommand({
    schemaVersion: 2,
    command_id: "update-derived-task",
    name: "UpdateTask",
    actor: { kind: "user", id: "desktop-user" },
    source: "desktop",
    issued_at: now,
    payload: {
      task_id: "task-derived-work-state",
      expected_version: 1,
      changes: { intended_executor: "ai_agent" },
      base: { intended_executor: "self" },
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.event.name, "TaskUpdated");
  assert.deepEqual(result.value.event.changed_fields, ["intended_executor", "work_state"]);
});
