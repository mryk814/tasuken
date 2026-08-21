import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const bundled = await build({
  stdin: {
    contents: `
      export { ApplicationCommandService } from "./src/main/services/applicationCommandService.ts";
      export { TaskCapabilityService } from "./src/main/modules/task/public.ts";
      export { TaskenCoreRuntime } from "./src/main/composition/taskenCoreRuntime.ts";
      export { TaskenCoreClient } from "./src/main/mcp/taskenCoreClient.mjs";
      export { MobileGatewayAdapter, MobileGatewayClient, MobileGatewayClientError, MobileGatewayCoreUnavailableError } from "./src/main/gateway/mobile/public.ts";
      export * from "./src/shared/contracts/mobile/public.ts";
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});

const mobile = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const {
  ApplicationCommandService,
  MobileGatewayAdapter,
  MobileGatewayClient,
  MobileGatewayClientError,
  MobileGatewayCoreUnavailableError,
  TASKEN_MOBILE_CAPABILITIES,
  TASKEN_MOBILE_ENDPOINTS,
  TaskCapabilityService,
  TaskenCoreClient,
  TaskenCoreRuntime,
  mobileTaskCommandRequestSchema,
  mobileTodayRequestSchema,
  mobileTodayResponseSchema,
} = mobile;

const todayGolden = JSON.parse(readFileSync(
  new URL("../contracts/mobile/v1/today-response.golden.json", import.meta.url),
  "utf8",
));

const now = "2026-08-21T01:00:00.000Z";
const principal = {
  kind: "mobile_device",
  deviceId: "device-fold-7",
  scopes: ["mobile:read", "mobile:task-write"],
};

class MemoryRepository {
  constructor() {
    this.records = new Map();
    this.records.set("theme:theme-personal-default", {
      type: "theme",
      id: "theme-personal-default",
      name: "Personal",
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

function capability(repository = new MemoryRepository()) {
  const application = new ApplicationCommandService(repository);
  const service = new TaskCapabilityService(repository, (command) => application.execute(command));
  return { repository, service };
}

function core(service, overrides = {}) {
  return {
    status: async () => ({ apiVersion: "1", capabilities: ["task.query", "task.command"] }),
    executeTaskQuery: (input) => service.executeQuery(input),
    executeTaskCommand: (input) => service.executeCommand(input),
    ...overrides,
  };
}

function gateway(service, overrides = {}, options = {}) {
  return new MobileGatewayAdapter({
    core: core(service, overrides),
    state: {
      current: () => ({ serverId: "desktop-home", serverRevision: 42, generatedAt: now }),
    },
    ...options,
  });
}

function todayQuery(overrides = {}) {
  return {
    apiVersion: "1",
    schemaVersion: "1",
    requestId: "request-today",
    date: "2026-08-21",
    limit: "20",
    ...overrides,
  };
}

function createRequest(overrides = {}) {
  return {
    apiVersion: 1,
    schemaVersion: 1,
    requestId: "request-mobile-create",
    commandId: "command-mobile-create",
    idempotencyKey: "command-mobile-create",
    clientDeviceId: principal.deviceId,
    issuedAt: now,
    command: {
      name: "CreateTask",
      task: {
        id: "task-mobile-create",
        title: "Mobile Task",
        projectId: "theme-personal-default",
        state: "todo",
        priority: "normal",
        requester: "self",
        intendedExecutor: "self",
        todayDate: "2026-08-21",
      },
    },
    ...overrides,
  };
}

function stateRequest(name, expectedVersion, overrides = {}) {
  const suffix = name === "CompleteTask" ? "complete" : "reopen";
  return {
    apiVersion: 1,
    schemaVersion: 1,
    requestId: `request-mobile-${suffix}`,
    commandId: `command-mobile-${suffix}`,
    idempotencyKey: `command-mobile-${suffix}`,
    clientDeviceId: principal.deviceId,
    issuedAt: now,
    command: {
      name,
      taskId: "task-mobile-create",
      expectedVersion,
    },
    ...overrides,
  };
}

test("canonical Today golden is accepted and malformed responses fail closed", () => {
  assert.deepEqual(mobileTodayResponseSchema.parse(todayGolden), todayGolden);

  const withMeta = (patch) => ({
    ...structuredClone(todayGolden),
    meta: { ...todayGolden.meta, ...patch },
  });
  const withData = (patch) => ({
    ...structuredClone(todayGolden),
    data: { ...todayGolden.data, ...patch },
  });
  const withFirstItem = (patch) => withData({
    items: [{ ...todayGolden.data.items[0], ...patch }, ...todayGolden.data.items.slice(1)],
  });
  const missingTitle = structuredClone(todayGolden);
  delete missingTitle.data.items[0].title;

  for (const invalid of [
    { ...structuredClone(todayGolden), ok: false },
    withMeta({ apiVersion: 2 }),
    withMeta({ schemaVersion: 2 }),
    withMeta({ generatedAt: "not-a-timestamp" }),
    withData({ date: "2026-02-30" }),
    withData({ items: Array.from({ length: 51 }, (_, index) => ({
      ...todayGolden.data.items[0],
      id: `task-${index}`,
    })) }),
    withFirstItem({ id: " " }),
    withFirstItem({ id: "x".repeat(201) }),
    withFirstItem({ state: "invalid" }),
    withFirstItem({ workState: "invalid" }),
    withFirstItem({ updatedAt: "not-a-timestamp" }),
    missingTitle,
    { ...structuredClone(todayGolden), unexpected: true },
  ]) {
    assert.equal(mobileTodayResponseSchema.safeParse(invalid).success, false);
  }

  const nonUuidEntityIds = withFirstItem({ id: "task-contract-id", themeId: "theme-contract-id" });
  assert.equal(mobileTodayResponseSchema.safeParse(nonUuidEntityIds).success, true);
  const padded = mobileTodayResponseSchema.parse(withFirstItem({
    id: "  task-contract-id  ",
    title: "  Padded title  ",
    themeId: "  theme-contract-id  ",
  }));
  assert.deepEqual(
    {
      id: padded.data.items[0].id,
      title: padded.data.items[0].title,
      themeId: padded.data.items[0].themeId,
    },
    { id: "task-contract-id", title: "Padded title", themeId: "theme-contract-id" },
  );
  assert.equal(mobileTodayResponseSchema.safeParse(withMeta({ truncated: true })).success, true);
  assert.equal(mobileTodayResponseSchema.safeParse(withData({ nextCursor: "" })).success, true);
});

test("Phase 4A Mobile contract rejects unknown fields, forged actor/source, versions, and ambiguous idempotency", () => {
  assert.deepEqual(TASKEN_MOBILE_ENDPOINTS, {
    pair: "/v1/pair",
    health: "/v1/health",
    today: "/v1/today",
    bootstrap: "/v1/bootstrap",
    sync: "/v1/sync",
    commands: "/v1/commands",
  });
  const valid = createRequest();
  assert.equal(mobileTaskCommandRequestSchema.safeParse(valid).success, true);
  for (const invalid of [
    { ...valid, apiVersion: 2 },
    { ...valid, schemaVersion: 2 },
    { ...valid, actor: { kind: "user", id: "forged" } },
    { ...valid, source: "android" },
    { ...valid, command: { name: "CompleteTask", taskId: "task-mobile-create" } },
    { ...valid, idempotencyKey: "different-command" },
  ]) {
    assert.equal(mobileTaskCommandRequestSchema.safeParse(invalid).success, false);
  }
  assert.equal(mobileTodayRequestSchema.safeParse({
    apiVersion: 1,
    schemaVersion: 1,
    requestId: "request-today",
    date: "2026-08-21",
    limit: 51,
  }).success, false);
});

test("Phase 4A Today is scope-gated, Core-delegated, bounded, and path/secret free", async () => {
  const { service } = capability();
  service.executeCommand({
    schemaVersion: 1,
    command_id: "desktop-seed",
    name: "CreateTask",
    actor: { kind: "user", id: "desktop-user" },
    source: "desktop",
    issued_at: now,
    payload: {
      task: {
        id: "task-private-seed",
        title: "Visible title",
        project_id: "theme-personal-default",
        state: "todo",
        priority: "normal",
        today_date: "2026-08-21",
        repository_subdirectory: "C:/private/worktree",
        ai_source_refs: [{ kind: "file", locator: "C:/secret/token.txt" }],
      },
    },
  });
  let coreQuery;
  const adapter = gateway(service, {
    executeTaskQuery: (input) => {
      coreQuery = input;
      return service.executeQuery(input);
    },
  });
  const response = await adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.today,
    principal,
    query: todayQuery(),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(coreQuery, {
    schemaVersion: 1,
    query_id: "request-today",
    name: "ListTodayTasks",
    parameters: { date: "2026-08-21", limit: 20 },
  });
  assert.deepEqual(Object.keys(response.body.data.items[0]).sort(), ["id", "state", "themeId", "title", "updatedAt", "version", "workState"]);
  assert.doesNotMatch(JSON.stringify(response.body), /C:\/private|secret|token\.txt|repository_subdirectory|ai_source_refs/);

  const forbidden = await adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.today,
    principal: { ...principal, scopes: ["mobile:task-write"] },
    query: todayQuery(),
  });
  assert.equal(forbidden.status, 403);
  const agent = await adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.today,
    principal: { kind: "agent", deviceId: "agent", scopes: ["mobile:read"] },
    query: todayQuery(),
  });
  assert.equal(agent.status, 401);

  const bodyBearingGet = await adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.today,
    principal,
    query: todayQuery(),
    body: {},
  });
  assert.equal(bodyBearingGet.status, 400);
  assert.equal(bodyBearingGet.body.error.code, "validation_failed");

  const unknownQuery = await adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.today,
    principal,
    query: todayQuery({ unexpected: "field" }),
  });
  assert.equal(unknownQuery.body.error.code, "validation_failed");
});

test("Phase 4A CreateTask derives actor/source, matches Desktop semantics, and uses durable Core replay", async () => {
  const mobileCapability = capability();
  const mobileAdapter = gateway(mobileCapability.service);
  const first = await mobileAdapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: createRequest(),
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.data.status, "applied");
  assert.equal(first.body.data.task.version, 1);
  assert.equal(mobileCapability.repository.list("change_event").length, 1);
  const event = mobileCapability.repository.list("change_event")[0];
  assert.equal(event.command_id, "command-mobile-create");
  assert.equal(event.actor_id, principal.deviceId);
  assert.equal(event.command_source, "mobile");

  const restarted = capability(mobileCapability.repository);
  const restartedAdapter = gateway(restarted.service);
  const replay = await restartedAdapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: createRequest(),
  });
  assert.equal(replay.status, 200);
  assert.equal(mobileCapability.repository.list("change_event").length, 1);

  const conflict = await restartedAdapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: createRequest({ command: { ...createRequest().command, task: { ...createRequest().command.task, title: "Changed" } } }),
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, "idempotency_conflict");
  assert.equal(mobileCapability.repository.list("change_event").length, 1);

  const desktopCapability = capability();
  const desktop = desktopCapability.service.executeCommand({
    schemaVersion: 1,
    command_id: "command-desktop-create",
    name: "CreateTask",
    actor: { kind: "user", id: "desktop-user" },
    source: "desktop",
    issued_at: now,
    payload: {
      task: {
        id: "task-mobile-create",
        title: "Mobile Task",
        project_id: "theme-personal-default",
        state: "todo",
        priority: "normal",
        requester: "self",
        intended_executor: "self",
        today_date: "2026-08-21",
      },
    },
  });
  assert.equal(desktop.ok, true);
  assert.equal(desktop.value.status, first.body.data.status);
  assert.equal(desktop.value.event.name, "TaskCreated");
  assert.equal(desktopCapability.repository.list("change_event").length, 1);

  const mobileTask = mobileCapability.repository.get("task", "task-mobile-create", true);
  const desktopTask = desktopCapability.repository.get("task", "task-mobile-create", true);
  const canonicalTask = (task) => ({
    id: task.id,
    title: task.title,
    project_id: task.project_id,
    state: task.state,
    priority: task.priority,
    requester: task.requester,
    intended_executor: task.intended_executor,
    today_date: task.today_date,
    version: task.version,
  });
  assert.deepEqual(canonicalTask(mobileTask), canonicalTask(desktopTask));

  const mobileEvent = mobileCapability.repository.list("change_event")[0];
  const desktopEvent = desktopCapability.repository.list("change_event")[0];
  assert.deepEqual(
    {
      entity_type: mobileEvent.entity_type,
      entity_id: mobileEvent.entity_id,
      change_type: mobileEvent.change_type,
      command_name: mobileEvent.command_name,
      after: canonicalTask(JSON.parse(mobileEvent.after_json)),
      attribution: { actor_kind: mobileEvent.actor_kind, actor_id: "normalized", command_source: "normalized" },
    },
    {
      entity_type: desktopEvent.entity_type,
      entity_id: desktopEvent.entity_id,
      change_type: desktopEvent.change_type,
      command_name: desktopEvent.command_name,
      after: canonicalTask(JSON.parse(desktopEvent.after_json)),
      attribution: { actor_kind: desktopEvent.actor_kind, actor_id: "normalized", command_source: "normalized" },
    },
  );
  assert.deepEqual(
    { actor_id: mobileEvent.actor_id, command_source: mobileEvent.command_source },
    { actor_id: principal.deviceId, command_source: "mobile" },
  );
  assert.deepEqual(
    { actor_id: desktopEvent.actor_id, command_source: desktopEvent.command_source },
    { actor_id: "desktop-user", command_source: "main_ui" },
  );

  const stale = desktopCapability.service.executeCommand({
    schemaVersion: 1,
    command_id: "command-desktop-stale",
    name: "UpdateTask",
    actor: { kind: "user", id: "desktop-user" },
    source: "desktop",
    issued_at: now,
    payload: {
      task_id: "task-mobile-create",
      expected_version: 999,
      changes: { title: "Stale update" },
    },
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, "CONFLICT");
  assert.equal(stale.error.conflict_reason, "version_conflict");
  assert.equal(stale.error.details.current_task.id, "task-mobile-create");
  assert.equal(stale.error.details.current_task.version, 1);
  assert.equal(stale.error.details.current_task.state, "todo");

  const desktopDuplicate = desktopCapability.service.executeCommand({
    schemaVersion: 1,
    command_id: "command-desktop-duplicate",
    name: "CreateTask",
    actor: { kind: "user", id: "desktop-user" },
    source: "desktop",
    issued_at: now,
    payload: {
      task: {
        id: "task-mobile-create",
        title: "Duplicate",
        project_id: "theme-personal-default",
        state: "todo",
        priority: "normal",
        requester: "self",
        intended_executor: "self",
      },
    },
  });
  assert.equal(desktopDuplicate.ok, false);
  assert.equal(desktopDuplicate.error.code, "CONFLICT");
  assert.equal(desktopDuplicate.error.conflict_reason, "entity_already_exists");

  const existingEntity = await restartedAdapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: createRequest({
      requestId: "request-existing-entity",
      commandId: "command-existing-entity",
      idempotencyKey: "command-existing-entity",
    }),
  });
  assert.equal(existingEntity.status, 409);
  assert.equal(existingEntity.body.error.code, "entity_conflict");

  const broken = capability();
  const brokenAdapter = gateway(broken.service);
  const brokenRequest = createRequest({
    requestId: "request-broken-receipt",
    commandId: "command-broken-receipt",
    idempotencyKey: "command-broken-receipt",
    command: {
      ...createRequest().command,
      task: { ...createRequest().command.task, id: "task-broken-receipt" },
    },
  });
  const brokenFirst = await brokenAdapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: brokenRequest,
  });
  assert.equal(brokenFirst.status, 200);
  const brokenEvent = broken.repository.list("change_event")[0];
  delete brokenEvent.receipt_json;
  const brokenRestart = capability(broken.repository);
  const brokenCoreReplay = brokenRestart.service.executeCommand({
    schemaVersion: 1,
    command_id: brokenRequest.commandId,
    name: "CreateTask",
    actor: { kind: "user", id: principal.deviceId },
    source: "mobile",
    issued_at: brokenRequest.issuedAt,
    payload: {
      task: {
        id: brokenRequest.command.task.id,
        title: brokenRequest.command.task.title,
        project_id: brokenRequest.command.task.projectId,
        state: brokenRequest.command.task.state,
        priority: brokenRequest.command.task.priority,
        requester: brokenRequest.command.task.requester,
        intended_executor: brokenRequest.command.task.intendedExecutor,
        today_date: brokenRequest.command.task.todayDate,
      },
    },
  });
  assert.equal(brokenCoreReplay.ok, false);
  assert.equal(brokenCoreReplay.error.code, "CONFLICT");
  assert.equal(brokenCoreReplay.error.conflict_reason, "other_conflict");
  const brokenMobileReplay = await gateway(brokenRestart.service).handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: brokenRequest,
  });
  assert.equal(brokenMobileReplay.status, 500);
  assert.equal(brokenMobileReplay.body.error.code, "internal_error");
  assert.equal(brokenMobileReplay.body.error.retryable, false);
});

test("Mobile CompleteTask and ReopenTask require canonical expectedVersion and preserve replay", async () => {
  const mobileCapability = capability();
  const adapter = gateway(mobileCapability.service);
  const created = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: createRequest(),
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.data.task.version, 1);

  const completed = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: stateRequest("CompleteTask", 1),
  });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.data.task.state, "done");
  assert.equal(completed.body.data.task.version, 2);

  const replay = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: stateRequest("CompleteTask", 1),
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.task.version, 2);
  assert.equal(mobileCapability.repository.list("change_event").length, 2);

  const stale = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: stateRequest("ReopenTask", 1),
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, "version_conflict");
  assert.deepEqual(stale.body.error.conflict, {
    currentTask: {
      id: "task-mobile-create",
      version: 2,
      title: "Mobile Task",
      themeId: "theme-personal-default",
      state: "done",
      workState: "not_delegated",
      updatedAt: now,
    },
    intendedAction: "ReopenTask",
    expectedVersion: 1,
  });

  const reopened = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: stateRequest("ReopenTask", 2, {
      requestId: "request-mobile-reopen-current",
      commandId: "command-mobile-reopen-current",
      idempotencyKey: "command-mobile-reopen-current",
    }),
  });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.data.task.state, "todo");
  assert.equal(reopened.body.data.task.version, 3);
});

test("Phase 4A fails closed on Core version/capability and client uses separate HTTPS bearer", async () => {
  const { service } = capability();
  const mismatch = gateway(service, { status: async () => ({ apiVersion: "999", capabilities: ["task.query", "task.command"] }) });
  const response = await mismatch.handle({ method: "GET", path: TASKEN_MOBILE_ENDPOINTS.health, principal });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, "version_mismatch");

  const missing = gateway(service, { status: async () => ({ apiVersion: "1", capabilities: ["task.query"] }) });
  const missingResponse = await missing.handle({ method: "GET", path: TASKEN_MOBILE_ENDPOINTS.health, principal });
  assert.equal(missingResponse.body.error.code, "capability_unavailable");

  const writeOnlyPrincipal = { ...principal, scopes: ["mobile:task-write"] };
  const writeOnlyHealth = await gateway(service).handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.health,
    principal: writeOnlyPrincipal,
  });
  assert.equal(writeOnlyHealth.status, 200);
  assert.deepEqual(writeOnlyHealth.body.data.capabilities, [
    TASKEN_MOBILE_CAPABILITIES.health,
    TASKEN_MOBILE_CAPABILITIES.taskWrite,
  ]);

  let coreStatusCalls = 0;
  const forbiddenBeforeCore = gateway(service, {
    status: async () => {
      coreStatusCalls += 1;
      throw new Error("must not be reached");
    },
  });
  const forbidden = await forbiddenBeforeCore.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.today,
    query: todayQuery(),
    principal: { ...principal, scopes: [] },
  });
  assert.equal(forbidden.body.error.code, "forbidden");
  assert.equal(coreStatusCalls, 0);

  const warnings = [];
  const unexpected = gateway(service, { status: async () => { throw new Error("secret body token"); } }, {
    logger: { warn: (event) => warnings.push(event) },
  });
  const unexpectedResponse = await unexpected.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.health,
    principal,
  });
  assert.equal(unexpectedResponse.status, 500);
  assert.equal(unexpectedResponse.body.error.code, "internal_error");
  assert.equal(unexpectedResponse.body.error.retryable, false);
  assert.deepEqual(warnings, [{ id: "unknown", location: "MobileGatewayAdapter.handle" }]);
  assert.doesNotMatch(JSON.stringify(warnings), /secret|token/);

  const unavailable = gateway(service, {
    status: async () => { throw new MobileGatewayCoreUnavailableError(); },
  }, { logger: { warn: (event) => warnings.push(event) } });
  const unavailableResponse = await unavailable.handle({ method: "GET", path: TASKEN_MOBILE_ENDPOINTS.health, principal });
  assert.equal(unavailableResponse.status, 503);
  assert.equal(unavailableResponse.body.error.code, "upstream_unavailable");
  assert.equal(unavailableResponse.body.error.retryable, true);
  assert.equal(warnings.length, 1);

  const accessToken = "mobile-token-that-is-distinct-from-core-token";
  const adapter = gateway(service);
  const seen = [];
  const client = new MobileGatewayClient({
    baseUrl: "https://desktop.tailnet.ts.net",
    accessToken,
    fetch: async (url, init) => {
      seen.push({ url, method: init.method, body: init.body, authorization: init.headers.authorization });
      const authorized = init.headers.authorization === `Bearer ${accessToken}`;
      const result = await adapter.handle({
        method: init.method,
        path: new URL(url).pathname,
        principal: authorized ? principal : null,
        query: Object.fromEntries(new URL(url).searchParams),
        ...(init.body ? { body: JSON.parse(init.body) } : {}),
      });
      const body = JSON.stringify(result.body);
      return new Response(body, { status: result.status, headers: { ...result.headers, "content-length": String(Buffer.byteLength(body)) } });
    },
  });
  const health = await client.health();
  assert.equal(health.data.capabilities.includes(TASKEN_MOBILE_CAPABILITIES.taskWrite), true);
  const created = await client.executeTaskCommand(createRequest({
    requestId: "request-client-create",
    commandId: "command-client-create",
    idempotencyKey: "command-client-create",
    command: { ...createRequest().command, task: { ...createRequest().command.task, id: "task-client-create" } },
  }));
  assert.equal(created.data.status, "applied");
  const today = await client.listToday({
    apiVersion: 1,
    schemaVersion: 1,
    requestId: "request-client-today",
    date: "2026-08-21",
    limit: 20,
  });
  assert.equal(today.data.items.some((item) => item.id === "task-client-create"), true);
  const todayCall = seen.find((entry) => entry.url.includes("/v1/today?"));
  assert.ok(todayCall);
  assert.equal(todayCall.method, "GET");
  assert.equal(todayCall.body, undefined);
  assert.equal(seen.every((entry) => entry.url.startsWith("https://desktop.tailnet.ts.net/v1/")), true);
  assert.equal(seen.every((entry) => entry.authorization === `Bearer ${accessToken}`), true);

  const writeOnlyClient = new MobileGatewayClient({
    baseUrl: "https://desktop.tailnet.ts.net",
    accessToken,
    fetch: async (url, init) => {
      const result = await adapter.handle({
        method: init.method,
        path: new URL(url).pathname,
        principal: writeOnlyPrincipal,
        query: Object.fromEntries(new URL(url).searchParams),
        ...(init.body ? { body: JSON.parse(init.body) } : {}),
      });
      return new Response(JSON.stringify(result.body), { status: result.status, headers: result.headers });
    },
  });
  const writeOnlyCreated = await writeOnlyClient.executeTaskCommand(createRequest({
    requestId: "request-write-only-create",
    commandId: "command-write-only-create",
    idempotencyKey: "command-write-only-create",
    command: {
      ...createRequest().command,
      task: { ...createRequest().command.task, id: "task-write-only-create" },
    },
  }));
  assert.equal(writeOnlyCreated.data.status, "applied");
  assert.throws(() => new MobileGatewayClient({ baseUrl: "http://127.0.0.1:1234", accessToken }), /private HTTPS/);
});

test("Mobile bootstrap and cursor sync are deterministic, retry-safe, and expose tombstones and server reset", async () => {
  const { repository, service } = capability();
  const adapter = gateway(service);
  for (const [id, title] of [["task-sync-a", "同期A"], ["task-sync-b", "同期B"]]) {
    const response = await adapter.handle({
      method: "POST",
      path: TASKEN_MOBILE_ENDPOINTS.commands,
      principal,
      body: createRequest({
        requestId: `request-${id}`,
        commandId: `command-${id}`,
        idempotencyKey: `command-${id}`,
        command: { ...createRequest().command, task: { ...createRequest().command.task, id, title } },
      }),
    });
    assert.equal(response.status, 200);
  }

  const bootstrap = await adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.bootstrap,
    principal,
    query: { apiVersion: "1", schemaVersion: "1", requestId: "request-bootstrap", limit: "50" },
  });
  assert.equal(bootstrap.status, 200);
  assert.deepEqual(bootstrap.body.data.tasks.map((task) => task.id).sort(), ["task-sync-a", "task-sync-b"]);
  assert.equal(bootstrap.body.data.hasMore, false);
  const cursor = bootstrap.body.data.nextCursor;
  assert.equal(typeof cursor, "string");

  const first = repository.records.get("task:task-sync-a");
  repository.records.set("task:task-sync-a", {
    ...first,
    title: "同期A更新",
    version: first.version + 1,
    updated_at: "2026-08-21T02:00:00.000Z",
  });
  const second = repository.records.get("task:task-sync-b");
  repository.records.set("task:task-sync-b", {
    ...second,
    version: second.version + 1,
    updated_at: "2026-08-21T03:00:00.000Z",
    deleted_at: "2026-08-21T03:00:00.000Z",
  });

  const syncQuery = { apiVersion: "1", schemaVersion: "1", requestId: "request-sync", cursor, limit: "1" };
  const firstPage = await adapter.handle({ method: "GET", path: TASKEN_MOBILE_ENDPOINTS.sync, principal, query: syncQuery });
  const retriedPage = await adapter.handle({ method: "GET", path: TASKEN_MOBILE_ENDPOINTS.sync, principal, query: syncQuery });
  assert.deepEqual(retriedPage.body.data, firstPage.body.data);
  assert.equal(firstPage.body.data.hasMore, true);
  assert.equal(firstPage.body.data.changes[0].kind, "upsert");
  assert.equal(firstPage.body.data.changes[0].task.title, "同期A更新");

  const secondPage = await adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.sync,
    principal,
    query: { ...syncQuery, requestId: "request-sync-2", cursor: firstPage.body.data.nextCursor },
  });
  assert.equal(secondPage.body.data.hasMore, false);
  assert.deepEqual(secondPage.body.data.changes, [{
    kind: "tombstone",
    entityType: "task",
    id: "task-sync-b",
    version: 2,
    updatedAt: "2026-08-21T03:00:00.000Z",
  }]);

  const resetAdapter = gateway(service, {}, {
    state: { current: () => ({ serverId: "desktop-restored", serverRevision: 1, generatedAt: now }) },
  });
  const resetResponse = await resetAdapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.sync,
    principal,
    query: { ...syncQuery, requestId: "request-after-reset" },
  });
  assert.equal(resetResponse.status, 200);
  assert.equal(resetResponse.body.meta.serverId, "desktop-restored");
});

test("Mobile UpdateTask auto-merges a different-field race and returns canonical same-field conflict", async () => {
  const { service } = capability();
  const adapter = gateway(service);
  assert.equal((await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: createRequest(),
  })).status, 200);

  const priorityUpdate = service.executeCommand({
    schemaVersion: 1,
    command_id: "command-desktop-priority",
    name: "UpdateTask",
    actor: { kind: "user", id: "desktop-user" },
    source: "desktop",
    issued_at: now,
    payload: { task_id: "task-mobile-create", expected_version: 1, changes: { priority: "high" } },
  });
  assert.equal(priorityUpdate.ok, true);

  const merged = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: {
      ...createRequest(),
      requestId: "request-mobile-update",
      commandId: "command-mobile-update",
      idempotencyKey: "command-mobile-update",
      command: {
        name: "UpdateTask",
        taskId: "task-mobile-create",
        expectedVersion: 1,
        changes: { title: "Mobile title" },
        base: { title: "Mobile Task" },
      },
    },
  });
  assert.equal(merged.status, 200);
  assert.equal(merged.body.data.task.title, "Mobile title");
  assert.equal(merged.body.data.task.version, 3);

  const desktopTitle = service.executeCommand({
    schemaVersion: 1,
    command_id: "command-desktop-title-after-mobile",
    name: "UpdateTask",
    actor: { kind: "user", id: "desktop-user" },
    source: "desktop",
    issued_at: now,
    payload: { task_id: "task-mobile-create", expected_version: 3, changes: { title: "Desktop title" } },
  });
  assert.equal(desktopTitle.ok, true);

  const conflict = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: {
      ...createRequest(),
      requestId: "request-mobile-update-conflict",
      commandId: "command-mobile-update-conflict",
      idempotencyKey: "command-mobile-update-conflict",
      command: {
        name: "UpdateTask",
        taskId: "task-mobile-create",
        expectedVersion: 3,
        changes: { title: "Second mobile title" },
        base: { title: "Mobile title" },
      },
    },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, "version_conflict");
  assert.equal(conflict.body.error.conflict.intendedAction, "UpdateTask");
  assert.equal(conflict.body.error.conflict.currentTask.title, "Desktop title");
});

test("Phase 4A client rejects oversized/auth responses without disclosing credentials and stays native-free", async () => {
  const accessToken = "mobile-token-that-must-never-appear-in-errors";
  const unauthorizedClient = new MobileGatewayClient({
    baseUrl: "https://desktop.tailnet.ts.net",
    accessToken,
    fetch: async () => new Response(JSON.stringify({
      ok: false,
      meta: { apiVersion: 1, schemaVersion: 1, serverId: "desktop", serverRevision: 1, generatedAt: now, truncated: false },
      error: { code: "unauthorized", message: `leak ${accessToken}`, retryable: false },
    }), { status: 401, headers: { "x-tasken-mobile-api-version": "1" } }),
  });
  await assert.rejects(unauthorizedClient.health(), (error) => (
    error instanceof MobileGatewayClientError
      && error.code === "unauthorized"
      && !error.message.includes(accessToken)
  ));

  const oversized = new MobileGatewayClient({
    baseUrl: "https://desktop.tailnet.ts.net",
    accessToken,
    maxResponseBytes: 32,
    fetch: async () => new Response("{}", {
      status: 200,
      headers: { "content-length": "999", "x-tasken-mobile-api-version": "1" },
    }),
  });
  await assert.rejects(oversized.health(), (error) => error.code === "response_too_large");

  let pulls = 0;
  let cancelled = false;
  const unbounded = new MobileGatewayClient({
    baseUrl: "https://desktop.tailnet.ts.net",
    accessToken,
    maxResponseBytes: 32,
    fetch: async () => new Response(new ReadableStream({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(20));
        if (pulls === 10) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 }), {
      status: 200,
      headers: { "x-tasken-mobile-api-version": "1" },
    }),
  });
  await assert.rejects(unbounded.health(), (error) => error.code === "response_too_large");
  assert.equal(cancelled, true);
  assert.ok(pulls < 10);

  const timeout = new MobileGatewayClient({
    baseUrl: "https://desktop.tailnet.ts.net",
    accessToken,
    timeoutMs: 5,
    fetch: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });
  await assert.rejects(timeout.health(), (error) => error.code === "gateway_unavailable");

  let stalledCancelled = false;
  const stalledBody = new MobileGatewayClient({
    baseUrl: "https://desktop.tailnet.ts.net",
    accessToken,
    timeoutMs: 5,
    fetch: async () => new Response(new ReadableStream({
      cancel() {
        stalledCancelled = true;
      },
    }), {
      status: 200,
      headers: { "x-tasken-mobile-api-version": "1" },
    }),
  });
  await assert.rejects(stalledBody.health(), (error) => error.code === "gateway_unavailable");
  assert.equal(stalledCancelled, true);

  const sources = [
    readFileSync("src/main/gateway/mobile/mobileGatewayAdapter.ts", "utf8"),
    readFileSync("src/main/gateway/mobile/mobileGatewayClient.ts", "utf8"),
  ].join("\n");
  assert.doesNotMatch(sources, /better-sqlite3|workspaceRepository|readOnlyContext|tasken-core\.json|taskenCoreDiscovery|node:fs|electron/);
  await assert.doesNotReject(build({
    entryPoints: ["src/main/gateway/mobile/public.ts"],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    logLevel: "silent",
  }));
});

test("Phase 4A production Runtime shares one Task service across Desktop, Core HTTP, and Mobile", async () => {
  const tempRoot = process.platform === "win32" ? os.tmpdir() : "/tmp";
  const root = mkdtempSync(path.join(tempRoot, "tasken-core-mobile-"));
  const enforcesPosixOwnerMode = typeof process.getuid === "function";
  if (enforcesPosixOwnerMode) chmodSync(root, 0o700);
  const repository = new MemoryRepository();
  const application = new ApplicationCommandService(repository);
  const runtime = new TaskenCoreRuntime(root, repository, (command) => application.execute(command));
  const client = runtime.createClient(root);
  try {
    await runtime.start();
    if (enforcesPosixOwnerMode) {
      chmodSync(path.join(root, "tasken-core.json"), 0o600);
      assert.equal(statSync(path.join(root, "tasken-core.json")).mode & 0o077, 0);
    }
    const adapter = runtime.createMobileGateway({
      current: () => ({ serverId: "desktop-home", serverRevision: 42, generatedAt: now }),
    });
    const status = await client.status();
    assert.equal(status.apiVersion, "1");
    assert.equal(status.capabilities.includes("task.query"), true);
    assert.equal(status.capabilities.includes("task.command"), true);

    const created = await adapter.handle({
      method: "POST",
      path: TASKEN_MOBILE_ENDPOINTS.commands,
      principal,
      body: createRequest(),
    });
    assert.equal(created.status, 200);

    const query = {
      schemaVersion: 1,
      query_id: "query-shared-task",
      name: "GetTask",
      parameters: { task_id: "task-mobile-create", include_deleted: false },
    };
    const desktopRead = runtime.taskCapability.executeQuery(query);
    const coreHttpRead = await client.executeTaskQuery(query);
    assert.deepEqual(coreHttpRead, desktopRead);
    await assert.rejects(
      client.executeTaskQuery({ ...query, unexpected: true }),
      (error) => error?.code === "VALIDATION_FAILED" && error?.status === 400,
    );
    const malformedClient = new TaskenCoreClient({
      discoveryPath: path.join(root, "tasken-core.json"),
      fetch: async () => new Response(JSON.stringify({ ...coreHttpRead, leaked: "must-not-pass" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-tasken-core-version": "1",
        },
      }),
    });
    await assert.rejects(
      malformedClient.executeTaskQuery(query),
      (error) => error?.code === "INVALID_RESPONSE" && !JSON.stringify(error).includes("must-not-pass"),
    );

    const update = {
      schemaVersion: 1,
      command_id: "command-core-http-update",
      name: "UpdateTask",
      actor: { kind: "user", id: "desktop-user" },
      source: "http",
      issued_at: now,
      payload: {
        task_id: "task-mobile-create",
        expected_version: 1,
        changes: { title: "Updated through Core HTTP" },
      },
    };
    const updated = await client.executeTaskCommand(update);
    assert.equal(updated.ok, true);
    assert.equal(updated.value.task.title, "Updated through Core HTTP");

    const mobileRead = await adapter.handle({
      method: "GET",
      path: TASKEN_MOBILE_ENDPOINTS.today,
      principal,
      query: todayQuery({ requestId: "request-after-core-update" }),
    });
    assert.equal(mobileRead.status, 200);
    assert.equal(mobileRead.body.data.items[0].title, "Updated through Core HTTP");
    assert.deepEqual(await client.executeTaskCommand(update), updated);
    assert.equal(repository.list("change_event").length, 2);

    await runtime.stop();
    await assert.rejects(
      client.executeTaskQuery(query),
      (error) => error?.code === "CORE_UNAVAILABLE",
    );
    assert.doesNotMatch(readFileSync("src/main/mcp/server.mjs", "utf8"), /executeTaskCommand/);
  } finally {
    await runtime.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
