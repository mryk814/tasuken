import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const bundled = await build({
  stdin: {
    contents: `export { MobileGatewayAdapter } from "./src/main/gateway/mobile/public.ts";
    export { TASKEN_MOBILE_ENDPOINTS } from "./src/shared/contracts/mobile/public.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { MobileGatewayAdapter, TASKEN_MOBILE_ENDPOINTS } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const now = "2026-09-05T12:00:00.000Z";
const principal = {
  kind: "mobile_device",
  deviceId: "test-phone",
  scopes: ["mobile:read", "mobile:task-write"],
};
const body = {
  text: "金曜までに比較実験を準備。データを集める。",
  capturedAt: now,
  timeZone: "Asia/Tokyo",
  themeId: null,
};
const proposal = {
  title: "比較実験を準備",
  themeId: "research",
  startDate: null,
  endDate: "2026-09-11",
  rangeSemantics: null,
  checklist: ["データを集める"],
  supplement: "前回の条件を揃える",
  warnings: [],
};
function fixture(organizer = null, overrides = {}) {
  const calls = [];
  const adapter = new MobileGatewayAdapter({
    core: {
      status: async () => ({
        apiVersion: "1",
        capabilities: ["task.query", "task.command", "get_task_context"],
      }),
      listThemes: () => [{ id: "research", name: "研究" }],
      listWorkReceipts: () => [],
      executeTaskCommand: (command) => {
        calls.push(command);
        return {
          ok: false,
          error: { code: "NOT_FOUND", message: "fixture boundary", issues: [], retryable: false },
        };
      },
      ...overrides,
    },
    state: { current: () => ({ serverId: "test-desktop", serverRevision: 1, generatedAt: now }) },
    captureOrganizer: organizer,
  });
  return {
    adapter,
    calls,
    request: (overrides = {}) =>
      adapter.handle({
        method: "POST",
        path: TASKEN_MOBILE_ENDPOINTS.captureOrganization,
        principal,
        body,
        ...overrides,
      }),
  };
}

test("Capture organization enforces authentication, both scopes, method, and request shape before inference", async () => {
  let count = 0;
  const { request } = fixture({
    providerLabel: "Fake",
    organize: async () => {
      count++;
      return proposal;
    },
  });
  assert.equal((await request({ principal: null })).body.error.code, "unauthorized");
  for (const scopes of [[], ["mobile:read"], ["mobile:task-write"]]) {
    assert.equal(
      (await request({ principal: { ...principal, scopes } })).body.error.code,
      "forbidden",
    );
  }
  assert.equal((await request({ method: "GET" })).body.error.code, "method_not_allowed");
  for (const invalid of [
    { ...body, text: "" },
    { ...body, text: "a".repeat(12001) },
    { ...body, timeZone: "invalid-zone" },
    { ...body, injected: true },
  ]) {
    assert.equal((await request({ body: invalid })).body.error.code, "validation_failed");
  }
  assert.equal((await request({ query: { arbitrary: "1" } })).body.error.code, "validation_failed");
  assert.equal(count, 0);
});

test("Capture organization returns a validated proposal without creating data, and handles unavailable providers", async () => {
  assert.equal((await fixture().request()).body.error.code, "capability_unavailable");
  let received;
  const { request, calls } = fixture({
    providerLabel: "Fake",
    organize: async (input) => {
      received = input;
      return proposal;
    },
  });
  const result = await request();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.proposal, proposal);
  assert.equal(result.body.data.providerLabel, "Fake");
  assert.deepEqual(received, { ...body, themes: [{ id: "research", title: "研究" }] });
  assert.equal(calls.length, 0);
  const unavailable = fixture({
    providerLabel: "Fake",
    organize: async () => {
      throw new Error("provider secret must not escape");
    },
  });
  const failed = await unavailable.request();
  assert.equal(failed.body.error.code, "upstream_unavailable");
  assert.doesNotMatch(JSON.stringify(failed), /provider secret/);
});

test("Capture organization rejects invented Theme and invalid model dates", async () => {
  const { request } = fixture({
    providerLabel: "Fake",
    organize: async () => ({ ...proposal, themeId: "invented" }),
  });
  assert.equal((await request()).body.error.code, "theme_not_found");
  assert.equal(
    (await request({ body: { ...body, themeId: "invented" } })).body.error.code,
    "theme_not_found",
  );
  const invalid = fixture({
    providerLabel: "Fake",
    organize: async () => ({ ...proposal, startDate: "2026-09-12" }),
  });
  assert.equal((await invalid.request()).body.error.code, "upstream_unavailable");
});

test("Capture organization serializes requests per device and releases the slot after completion", async () => {
  let finish;
  let started;
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  const { request } = fixture({
    providerLabel: "Fake",
    organize: async () => {
      started();
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const first = request();
  await entered;
  assert.equal((await request()).body.error.code, "rate_limited");
  finish(proposal);
  assert.equal((await first).status, 200);
  const next = request();
  await new Promise((resolve) => setImmediate(resolve));
  finish(proposal);
  assert.equal((await next).status, 200);
});

test("Mobile accepted organization maps full description, checklist and deadline to one Core CreateTask", async () => {
  const { adapter, calls } = fixture();
  const description = "補足：前回の条件を揃える\n\n元の発話：" + body.text.repeat(100);
  await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: {
      apiVersion: 1,
      schemaVersion: 7,
      requestId: "organized-request",
      commandId: "organized-command",
      idempotencyKey: "organized-command",
      clientDeviceId: principal.deviceId,
      issuedAt: now,
      command: {
        name: "CreateTask",
        task: {
          id: "organized-task",
          title: proposal.title,
          projectId: "research",
          description,
          checklistItems: [
            {
              id: "check-1",
              title: "データを集める",
              done: false,
              sortOrder: 0,
              completedAt: null,
            },
          ],
        },
        schedule: { startDate: null, endDate: "2026-09-11", rangeSemantics: null },
      },
    },
  });
  assert.equal(calls.length, 1);
  const command = calls[0];
  assert.equal(command.name, "CreateTask");
  assert.equal(command.command_id, "organized-command");
  assert.equal(command.payload.task.description, description);
  assert.equal(command.payload.task.project_id, "research");
  assert.deepEqual(command.payload.task.checklist_items, [
    { id: "check-1", title: "データを集める", done: false, sort_order: 0, completed_at: null },
  ]);
  assert.deepEqual(command.payload.schedule, {
    start_date: null,
    end_date: "2026-09-11",
    date_kind: "deadline",
    range_semantics: null,
    confidence: "fixed",
    granularity: "day",
  });
});
