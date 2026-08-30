import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import { build } from "esbuild";

const bundled = await build({
  stdin: {
    contents: `
      export { ApplicationCommandService } from "./src/main/services/applicationCommandService.ts";
      export { TaskCapabilityService } from "./src/main/modules/task/public.ts";
      export { ListAgentReadyTasksService } from "./src/main/core/services/listAgentReadyTasksService.ts";
      export { MobileGatewayAdapter } from "./src/main/gateway/mobile/public.ts";
      export { mobileTaskDelegationRequestSchema } from "./src/shared/contracts/mobile/public.ts";
      export { taskContextFingerprint } from "./src/main/gateway/mobile/taskContextPreview.ts";
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
  ListAgentReadyTasksService,
  MobileGatewayAdapter,
  TaskCapabilityService,
  formatTaskLocator,
  parseTaskLocator,
  publicTaskForContext,
  mobileTaskDelegationRequestSchema,
  safeReceiptText,
  taskContextFingerprint,
  TaskContextTextBudget,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const now = "2026-08-30T01:00:00.000Z";
const delegationTaskId = `ghp_${"x".repeat(24)}`;

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

function contextFixture(noteSummary = "公開情報") {
  return {
    task: {
      id: delegationTaskId,
      version: 1,
      title: "Hermesへ委任",
      description:
        "公開Task本文 C:\\Users\\private\\secret.txt Bearer hidden-token\n" +
        "-----BEGIN OPENSSH PRIVATE KEY-----\npreview-key-material\n-----END OPENSSH PRIVATE KEY-----",
      state: "todo",
      updated_at: now,
      ai: {
        ai_visibility: ["coding_agent"],
        ai_visibility_source: "entity",
        authority: "user_confirmed",
        freshness: "current",
        summary_authority: "user_confirmed",
      },
    },
    assignment: { intended_executor: "self", work_state: "not_delegated" },
    theme: null,
    repository_contexts: [],
    related: {
      notes: [
        {
          id: "note-1",
          version: 1,
          title: "関連Note",
          excerpt: noteSummary,
          included_because: "explicitly_linked",
          relation_path: [],
        },
      ],
      conversations: [],
      artifacts: [],
      resources: [],
      activity: [],
    },
    context_selection: {
      schema: "tasken-context-selection/v1",
      included: [
        {
          ref: { type: "task", id: delegationTaskId },
          reason: "seed",
          title: "Hermesへ委任",
          relation_path: [],
        },
      ],
      excluded: [],
      truncated: false,
    },
    warnings: [],
    truncation: {},
    read_only: true,
    ai_audience: "coding_agent",
  };
}

function taskQuery(service, id) {
  const result = service.executeQuery({
    schemaVersion: 2,
    query_id: `query-${Date.now()}`,
    name: "GetTask",
    parameters: { task_id: id },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value.task;
}

function requestBody(fingerprint, overrides = {}) {
  return {
    apiVersion: 1,
    schemaVersion: 6,
    requestId: "request-delegate",
    commandId: "command-delegate",
    taskId: delegationTaskId,
    expectedTaskVersion: 1,
    agent: "hermes",
    expectedResult: "PRを作成 @everyone",
    instruction:
      "C:\\Users\\private\\secret.txt を読む\r\nBearer hidden-token\n" +
      "-----BEGIN OPENSSH PRIVATE KEY-----\nshare-key-material\n-----END OPENSSH PRIVATE KEY-----",
    contextFingerprint: fingerprint,
    issuedAt: now,
    actorId: "device-1",
    ...overrides,
  };
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

test("Preview policy, delegation conflicts, and response-loss replay share one canonical boundary", async () => {
  const repository = new MemoryRepository();
  const application = new ApplicationCommandService(repository);
  application.execute({
    commandId: "create-task",
    name: "CreateTask",
    actor: { kind: "user", id: "desktop-user" },
    source: "main_ui",
    issuedAt: now,
    payload: {
      task: {
        id: delegationTaskId,
        title: "Hermesへ委任",
        project_id: "theme-personal-default",
        state: "todo",
        priority: "normal",
        requester: "self",
        intended_executor: "self",
      },
    },
  });
  repository.save("work_receipt", {
    id: "receipt-before-delegation",
    task_id: delegationTaskId,
    reported_at: "2026-08-30T00:30:00.000Z",
    executor_label: "Hermes",
    summary: "委任前の確認結果",
  });
  const capability = new TaskCapabilityService(repository, (command) =>
    application.execute(command),
  );
  let context = contextFixture();
  let fingerprintReads = 0;
  let workReceiptReads = 0;
  let lastDelegationError = null;
  let currentMeta = { serverId: "desktop", serverRevision: 1, generatedAt: now };
  const core = {
    status: async () => ({
      apiVersion: "1",
      capabilities: ["task.query", "task.command", "get_task_context"],
    }),
    listThemes: () => [{ id: "theme-personal-default", name: "Personal" }],
    listWorkReceipts: () => {
      workReceiptReads += 1;
      return [];
    },
    getWorkReceipt: () => null,
    listTaskWorkProposals: () => [],
    getTaskWorkProposal: () => null,
    decideTaskWorkProposal: () => ({ ok: false, code: "validation_failed" }),
    executeTaskQuery: (input) => capability.executeQuery(input),
    executeTaskCommand: (input) => capability.executeCommand(input),
    executeCaptureCommand: () => ({ ok: false, code: "validation_failed" }),
    getTaskContext: (input) => {
      assert.deepEqual(input.include, [
        "theme",
        "repository",
        "notes",
        "conversations",
        "artifacts",
        "resources",
        "activity",
      ]);
      assert.equal(input.include_archived, false);
      assert.equal(Object.prototype.hasOwnProperty.call(input, "workspace"), false);
      return context;
    },
    delegateTaskToAgent: (input) => {
      try {
        const receipt = application.executeTaskDelegation(
          {
            commandId: input.commandId,
            name: "DelegateTaskToAgent",
            actor: { kind: "user", id: input.actorId },
            source: "mobile",
            issuedAt: input.issuedAt,
            payload: {
              taskId: input.taskId,
              agent: input.agent,
              expectedResult: input.expectedResult,
              instruction: input.instruction,
              contextFingerprint: input.contextFingerprint,
            },
            expectedVersions: [
              { type: "task", id: input.taskId, version: input.expectedTaskVersion },
            ],
          },
          () => {
            fingerprintReads += 1;
            return taskContextFingerprint(context);
          },
          input.responseMeta,
        );
        const latest = receipt.resultSnapshot?.latestWorkReceipt;
        return {
          ok: true,
          commandId: receipt.commandId,
          status: receipt.status,
          task: receipt.resultSnapshot?.task,
          latestWorkReceipt: latest
            ? {
                id: latest.id,
                taskId: latest.task_id,
                version: latest.version,
                reportedAt: latest.reported_at,
                executorLabel: latest.executor_label,
                summary: latest.summary,
              }
            : null,
          responseMeta: receipt.resultSnapshot?.responseMeta,
        };
      } catch (error) {
        lastDelegationError = error;
        if (error.code === "COMMAND_ID_REUSED") return { ok: false, code: "idempotency_conflict" };
        if (error.code === "NOT_FOUND") return { ok: false, code: "not_found" };
        if (error.details?.conflictReason === "context_stale")
          return { ok: false, code: "context_stale" };
        if (error.code === "CONFLICT") return { ok: false, code: "version_conflict" };
        return { ok: false, code: "validation_failed" };
      }
    },
  };
  const adapter = new MobileGatewayAdapter({
    core,
    state: {
      current: () => currentMeta,
    },
  });
  const principal = {
    kind: "mobile_device",
    deviceId: "device-1",
    scopes: ["mobile:read", "mobile:context-read", "mobile:task-write"],
  };

  const preview = await adapter.handle({
    method: "GET",
    path: "/v1/task-context-preview",
    principal,
    query: {
      apiVersion: "1",
      schemaVersion: "6",
      requestId: "preview-1",
      taskId: delegationTaskId,
    },
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.data.task.id, delegationTaskId);
  const fingerprint = preview.body.data.contextFingerprint;
  assert.equal(fingerprint, taskContextFingerprint(context));
  assert.match(preview.body.data.task.description, /公開Task本文/u);
  assert.equal(preview.body.data.task.description.includes("C:\\Users"), false);
  assert.equal(preview.body.data.task.description.includes("hidden-token"), false);
  assert.equal(preview.body.data.task.description.includes("preview-key-material"), false);
  assert.equal(JSON.stringify(preview.body).includes("secret"), false);

  const missingScope = await adapter.handle({
    method: "GET",
    path: "/v1/task-context-preview",
    principal: { ...principal, scopes: ["mobile:read"] },
    query: {
      apiVersion: "1",
      schemaVersion: "6",
      requestId: "preview-old-device",
      taskId: delegationTaskId,
    },
  });
  assert.equal(missingScope.status, 403);

  const body = requestBody(fingerprint);
  const parsedBody = mobileTaskDelegationRequestSchema.safeParse(body);
  assert.equal(
    parsedBody.success,
    true,
    parsedBody.success ? "" : JSON.stringify(parsedBody.error.issues),
  );
  const applied = await adapter.handle({
    method: "POST",
    path: "/v1/task-delegations",
    principal,
    body,
  });
  assert.equal(
    applied.status,
    200,
    JSON.stringify({
      body: applied.body,
      error: lastDelegationError?.message,
      details: lastDelegationError?.details,
    }),
  );
  assert.equal(applied.body.data.task.workState, "ready_for_agent");
  assert.equal(applied.body.data.task.latestWorkReceipt.id, "receipt-before-delegation");
  assert.equal(applied.body.data.safeShare.taskId, body.taskId);
  assert.equal(parseTaskLocator(applied.body.data.safeShare.taskLocator), body.taskId);
  assert.equal(applied.body.data.safeShare.text.includes("C:\\Users"), false);
  assert.equal(applied.body.data.safeShare.text.includes("hidden-token"), false);
  assert.equal(applied.body.data.safeShare.text.includes("share-key-material"), false);
  assert.equal(applied.body.data.safeShare.text.includes("@everyone"), false);
  assert.equal(repository.get("task", body.taskId).intended_executor, "ai_agent");
  assert.equal(repository.get("task", body.taskId).executor_identity, "Hermes");
  const discover = new ListAgentReadyTasksService({
    listTasks: (includeArchived) => repository.list("task", includeArchived),
    listThemes: () => repository.list("theme"),
    workspaceAiVisibilityDefault: () => ["coding_agent"],
  }).execute({ limit: 20 });
  assert.deepEqual(
    discover.tasks.map((task) => task.id),
    [body.taskId],
  );
  assert.equal(fingerprintReads, 1);

  const delegatedTask = taskQuery(capability, body.taskId);
  const changedAfterResponse = capability.executeCommand({
    schemaVersion: 2,
    command_id: "change-after-delegation-response",
    name: "UpdateTask",
    actor: { kind: "user", id: "desktop-user" },
    source: "desktop",
    issued_at: "2026-08-30T01:30:00.000Z",
    payload: {
      task_id: body.taskId,
      expected_version: delegatedTask.version,
      changes: { title: "委任後に変更されたタイトル" },
      base: { title: delegatedTask.title },
    },
  });
  assert.equal(changedAfterResponse.ok, true, JSON.stringify(changedAfterResponse));
  repository.save("work_receipt", {
    id: "receipt-after-response-loss",
    task_id: body.taskId,
    reported_at: "2026-08-30T02:00:00.000Z",
    executor_label: "Hermes",
    summary: "応答喪失後の新しい結果",
  });

  context = contextFixture("Relation visibility changed after the response was lost");
  currentMeta = {
    serverId: "desktop",
    serverRevision: 99,
    generatedAt: "2026-08-30T12:00:00.000Z",
  };
  const replay = await adapter.handle({
    method: "POST",
    path: "/v1/task-delegations",
    principal,
    body,
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.commandId, applied.body.data.commandId);
  assert.deepEqual(
    replay.body,
    applied.body,
    "response-loss replay must return the exact first response",
  );
  assert.equal(fingerprintReads, 1, "replay must not consult mutable context");
  assert.equal(workReceiptReads, 0, "delegation responses must not consult mutable Work Receipts");
  assert.equal(
    repository
      .list("change_event", true)
      .filter((event) => event.command_name === "DelegateTaskToAgent").length,
    1,
  );

  const reused = await adapter.handle({
    method: "POST",
    path: "/v1/task-delegations",
    principal,
    body: { ...body, instruction: "different immutable command" },
  });
  assert.equal(reused.status, 409);
  assert.equal(reused.body.error.code, "idempotency_conflict");
  assert.equal(fingerprintReads, 1);

  const contextStale = await adapter.handle({
    method: "POST",
    path: "/v1/task-delegations",
    principal,
    body: requestBody(fingerprint, {
      requestId: "request-stale-context",
      commandId: "command-stale-context",
      expectedTaskVersion: 2,
    }),
  });
  assert.equal(contextStale.status, 409);
  assert.equal(contextStale.body.error.code, "context_stale");

  const staleTask = await adapter.handle({
    method: "POST",
    path: "/v1/task-delegations",
    principal,
    body: requestBody(taskContextFingerprint(context), {
      requestId: "request-stale-task",
      commandId: "command-stale-task",
      expectedTaskVersion: 1,
    }),
  });
  assert.equal(staleTask.status, 409);
  assert.equal(staleTask.body.error.code, "version_conflict");

  const wrongScope = await adapter.handle({
    method: "POST",
    path: "/v1/task-delegations",
    principal: { ...principal, scopes: ["mobile:context-read"] },
    body: requestBody(taskContextFingerprint(context), {
      requestId: "request-wrong-scope",
      commandId: "command-wrong-scope",
      expectedTaskVersion: 2,
    }),
  });
  assert.equal(wrongScope.status, 403);
});
