import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import test from "node:test";

import { build } from "esbuild";

const bundled = await build({
  stdin: {
    contents: `
      export { ApplicationCommandService } from "./src/main/services/applicationCommandService.ts";
      export { TaskCapabilityService } from "./src/main/modules/task/public.ts";
      export { MobileGatewayAdapter, MobileGatewayClient, MobileGatewayClientError } from "./src/main/gateway/mobile/public.ts";
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
  TASKEN_MOBILE_CAPABILITIES,
  TASKEN_MOBILE_ENDPOINTS,
  TaskCapabilityService,
  mobileCreateTaskRequestSchema,
  mobileTodayRequestSchema,
} = mobile;

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

function capability() {
  const repository = new MemoryRepository();
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

function gateway(service, overrides = {}) {
  return new MobileGatewayAdapter({
    core: core(service, overrides),
    state: {
      current: () => ({ serverId: "desktop-home", serverRevision: 42, generatedAt: now }),
    },
  });
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

test("Phase 4A Mobile contract rejects unknown fields, forged actor/source, versions, and ambiguous idempotency", () => {
  const valid = createRequest();
  assert.equal(mobileCreateTaskRequestSchema.safeParse(valid).success, true);
  for (const invalid of [
    { ...valid, apiVersion: 2 },
    { ...valid, schemaVersion: 2 },
    { ...valid, actor: { kind: "user", id: "forged" } },
    { ...valid, source: "android" },
    { ...valid, command: { ...valid.command, name: "CompleteTask" } },
    { ...valid, idempotencyKey: "different-command" },
  ]) {
    assert.equal(mobileCreateTaskRequestSchema.safeParse(invalid).success, false);
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
  const adapter = gateway(service);
  const response = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.today,
    principal,
    body: { apiVersion: 1, schemaVersion: 1, requestId: "request-today", date: "2026-08-21", limit: 20 },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body.data.items[0]).sort(), ["id", "state", "themeId", "title", "updatedAt", "workState"]);
  assert.doesNotMatch(JSON.stringify(response.body), /C:\/private|secret|token\.txt|repository_subdirectory|ai_source_refs/);

  const forbidden = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.today,
    principal: { ...principal, scopes: ["mobile:task-write"] },
    body: { apiVersion: 1, schemaVersion: 1, requestId: "request-today", date: "2026-08-21" },
  });
  assert.equal(forbidden.status, 403);
  const agent = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.today,
    principal: { kind: "agent", deviceId: "agent", scopes: ["mobile:read"] },
    body: {},
  });
  assert.equal(agent.status, 401);
});

test("Phase 4A CreateTask derives actor/source, matches Desktop semantics, and uses durable Core replay", async () => {
  const mobileCapability = capability();
  const mobileAdapter = gateway(mobileCapability.service);
  const first = await mobileAdapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.taskCommands,
    principal,
    body: createRequest(),
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.data.status, "applied");
  assert.equal(first.body.data.task.version, undefined);
  assert.equal(mobileCapability.repository.list("change_event").length, 1);
  const event = mobileCapability.repository.list("change_event")[0];
  assert.equal(event.command_id, "command-mobile-create");
  assert.equal(event.actor_id, principal.deviceId);
  assert.equal(event.command_source, "mobile");

  const replay = await mobileAdapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.taskCommands,
    principal,
    body: createRequest(),
  });
  assert.equal(replay.status, 200);
  assert.equal(mobileCapability.repository.list("change_event").length, 1);

  const conflict = await mobileAdapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.taskCommands,
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
        id: "task-desktop-create",
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

  const accessToken = "mobile-token-that-is-distinct-from-core-token";
  const adapter = gateway(service);
  const seen = [];
  const client = new MobileGatewayClient({
    baseUrl: "https://desktop.tailnet.ts.net",
    accessToken,
    fetch: async (url, init) => {
      seen.push({ url, authorization: init.headers.authorization });
      const authorized = init.headers.authorization === `Bearer ${accessToken}`;
      const result = await adapter.handle({
        method: init.method,
        path: new URL(url).pathname,
        principal: authorized ? principal : null,
        ...(init.body ? { body: JSON.parse(init.body) } : {}),
      });
      const body = JSON.stringify(result.body);
      return new Response(body, { status: result.status, headers: { ...result.headers, "content-length": String(Buffer.byteLength(body)) } });
    },
  });
  const health = await client.health();
  assert.equal(health.data.capabilities.includes(TASKEN_MOBILE_CAPABILITIES.taskCreate), true);
  const created = await client.createTask(createRequest({
    requestId: "request-client-create",
    commandId: "command-client-create",
    idempotencyKey: "command-client-create",
    command: { ...createRequest().command, task: { ...createRequest().command.task, id: "task-client-create" } },
  }));
  assert.equal(created.data.status, "applied");
  assert.equal(seen.every((entry) => entry.url.startsWith("https://desktop.tailnet.ts.net/v1/")), true);
  assert.equal(seen.every((entry) => entry.authorization === `Bearer ${accessToken}`), true);
  assert.throws(() => new MobileGatewayClient({ baseUrl: "http://127.0.0.1:1234", accessToken }), /private HTTPS/);
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

  const timeout = new MobileGatewayClient({
    baseUrl: "https://desktop.tailnet.ts.net",
    accessToken,
    timeoutMs: 5,
    fetch: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });
  await assert.rejects(timeout.health(), (error) => error.code === "gateway_unavailable");

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
