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
  decodeTaskenMobileThemeCursor,
  encodeTaskenMobileThemeCursor,
  mobileCapabilitySchema,
  mobileTaskCommandRequestSchema,
  mobileTaskWorkProposalDecisionRequestSchema,
  mobileTaskWorkProposalDecisionResponseSchema,
  mobileTaskWorkProposalsResponseSchema,
  mobileThemesRequestSchema,
  mobileThemesResponseSchema,
  mobileTodayRequestSchema,
  mobileTodayResponseSchema,
  mobileWorkReceiptRequestSchema,
  mobileWorkReceiptResponseSchema,
} = mobile;

const todayGolden = JSON.parse(readFileSync(
  new URL("../contracts/mobile/v1/today-response.golden.json", import.meta.url),
  "utf8",
));

const themesGolden = JSON.parse(readFileSync(
  new URL("../contracts/mobile/v1/themes-response.golden.json", import.meta.url),
  "utf8",
));

const workReceiptGolden = JSON.parse(readFileSync(
  new URL("../contracts/mobile/v1/work-receipt-response.golden.json", import.meta.url),
  "utf8",
));

const taskWorkProposalsGolden = JSON.parse(readFileSync(
  new URL("../contracts/mobile/v1/task-work-proposals-response.golden.json", import.meta.url),
  "utf8",
));

const now = "2026-08-21T01:00:00.000Z";
const principal = {
  kind: "mobile_device",
  deviceId: "device-fold-7",
  scopes: ["mobile:read", "mobile:task-write", "mobile:proposal-review"],
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
    listThemes: () => [{ id: "theme-personal-default", name: "Personal" }],
    listWorkReceipts: () => [],
    getWorkReceipt: () => null,
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
    schemaVersion: "4",
    requestId: "request-today",
    date: "2026-08-21",
    limit: "20",
    ...overrides,
  };
}

function createRequest(overrides = {}) {
  return {
    apiVersion: 1,
    schemaVersion: 4,
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
  const suffix = name === "CompleteTask" ? "complete" : name === "ReopenTask" ? "reopen" : "delete";
  return {
    apiVersion: 1,
    schemaVersion: 4,
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
    withMeta({ schemaVersion: 5 }),
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
  assert.equal(mobileTodayResponseSchema.safeParse(withFirstItem({
    checklistItems: [
      { id: "duplicate", title: "A", done: false, sortOrder: 0, completedAt: null },
      { id: "duplicate", title: "B", done: false, sortOrder: 1, completedAt: null },
    ],
  })).success, false);
  assert.equal(mobileTodayResponseSchema.safeParse(withFirstItem({
    checklistItems: [{ id: "valid", title: " ", done: false, sortOrder: 0, completedAt: null }],
  })).success, false);
});

test("canonical Theme catalog golden is narrow and malformed responses fail closed", () => {
  assert.deepEqual(mobileThemesResponseSchema.parse(themesGolden), themesGolden);
  assert.deepEqual(Object.keys(themesGolden.data.themes[0]).sort(), ["id", "title"]);
  const cursor = encodeTaskenMobileThemeCursor("a".repeat(64), 1);
  assert.deepEqual(decodeTaskenMobileThemeCursor(cursor), {
    fingerprint: "a".repeat(64),
    position: 1,
  });

  const withData = (patch) => ({
    ...structuredClone(themesGolden),
    data: { ...themesGolden.data, ...patch },
  });
  const withMetaAndData = (meta, data) => ({
    ...structuredClone(themesGolden),
    meta: { ...themesGolden.meta, ...meta },
    data: { ...themesGolden.data, ...data },
  });
  const withFirstTheme = (patch) => withData({
    themes: [{ ...themesGolden.data.themes[0], ...patch }, ...themesGolden.data.themes.slice(1)],
  });
  const missingTitle = structuredClone(themesGolden);
  delete missingTitle.data.themes[0].title;

  for (const invalid of [
    withFirstTheme({ title: "" }),
    withFirstTheme({ title: "x".repeat(501) }),
    withFirstTheme({ rawPath: "C:/private/theme" }),
    withData({ themes: Array.from({ length: 51 }, (_, index) => ({ id: `theme-${index}`, title: `Theme ${index}` })) }),
    withData({ themes: [themesGolden.data.themes[0], themesGolden.data.themes[0]] }),
    withData({ themes: [...themesGolden.data.themes].reverse() }),
    withData({ nextCursor: "" }),
    withMetaAndData({ truncated: false }, { nextCursor: cursor }),
    withMetaAndData({ truncated: true }, { nextCursor: null }),
    withMetaAndData({ truncated: true }, { themes: [], nextCursor: cursor }),
    missingTitle,
    { ...structuredClone(themesGolden), unexpected: true },
  ]) {
    assert.equal(mobileThemesResponseSchema.safeParse(invalid).success, false);
  }

  assert.equal(mobileThemesRequestSchema.safeParse({
    apiVersion: 1,
    schemaVersion: 4,
    requestId: "request-themes",
    limit: 50,
  }).success, true);
  assert.equal(mobileThemesResponseSchema.safeParse(withData({
    themes: Array.from({ length: 50 }, (_, index) => ({
      id: `theme-${String(index).padStart(2, "0")}`,
      title: `Theme ${index}`,
    })),
  })).success, true);
  assert.equal(mobileThemesRequestSchema.safeParse({
    apiVersion: 1,
    schemaVersion: 4,
    requestId: "request-themes-page-2",
    cursor,
    limit: 50,
  }).success, true);
  assert.equal(mobileThemesRequestSchema.safeParse({
    apiVersion: 1,
    schemaVersion: 4,
    requestId: "request-themes-trimmed-cursor",
    cursor: ` ${cursor} `,
    limit: 50,
  }).success, false);
  assert.equal(mobileThemesRequestSchema.safeParse({
    apiVersion: 1,
    schemaVersion: 4,
    requestId: "request-themes",
    limit: 51,
  }).success, false);
});

test("Phase 4A Mobile contract rejects unknown fields, forged actor/source, versions, and ambiguous idempotency", () => {
  assert.deepEqual(TASKEN_MOBILE_CAPABILITIES, {
    health: "mobile.health",
    todayRead: "mobile.today.read",
    syncRead: "mobile.sync.read",
    workReceiptRead: "mobile.work-receipt.read",
    proposalRead: "mobile.proposal.read",
    proposalReview: "mobile.proposal.review",
    taskWrite: "mobile.task.write",
  });
  assert.equal(mobileCapabilitySchema.safeParse("mobile.theme.read").success, false);
  assert.deepEqual(TASKEN_MOBILE_ENDPOINTS, {
    pair: "/v1/pair",
    health: "/v1/health",
    today: "/v1/today",
    themes: "/v1/themes",
    workReceipt: "/v1/work-receipt",
    proposals: "/v1/proposals",
    proposalDecisions: "/v1/proposal-decisions",
    bootstrap: "/v1/bootstrap",
    sync: "/v1/sync",
    commands: "/v1/commands",
  });
  const valid = createRequest();
  assert.equal(mobileTaskCommandRequestSchema.safeParse(valid).success, true);
  assert.equal(mobileTaskCommandRequestSchema.safeParse({
    ...valid,
    command: {
      name: "UpdateTask",
      taskId: "task-mobile-create",
      expectedScheduleVersion: null,
      expectedVersion: 1,
      changes: { todayDate: "2026-08-22" },
      base: { todayDate: null },
    },
  }).success, true);
  assert.equal(mobileTaskCommandRequestSchema.safeParse({
    ...valid,
    command: { name: "DeleteTask", taskId: "task-mobile-create", expectedVersion: 1 },
  }).success, true);
  assert.equal(mobileTaskCommandRequestSchema.safeParse({
    ...valid,
    command: {
      name: "UpdateTask",
      taskId: "task-mobile-create",
      expectedScheduleVersion: null,
      expectedVersion: 1,
      changes: { plannedSchedule: { startTime: "10:00", durationMinutes: 90 } },
      base: { plannedSchedule: { startTime: null, durationMinutes: null } },
    },
  }).success, false);
  for (const invalid of [
    { ...valid, apiVersion: 2 },
    { ...valid, schemaVersion: 5 },
    { ...valid, actor: { kind: "user", id: "forged" } },
    { ...valid, source: "android" },
    { ...valid, command: { name: "CompleteTask", taskId: "task-mobile-create" } },
    {
      ...valid,
      command: {
        name: "UpdateTask",
        taskId: "task-mobile-create",
        expectedScheduleVersion: null,
        expectedVersion: 1,
        changes: { todayDate: "2026-08-22" },
        base: { title: "Mobile Task" },
      },
    },
    {
      ...valid,
      command: {
        name: "UpdateTask",
        taskId: "task-mobile-create",
        expectedScheduleVersion: null,
        expectedVersion: 1,
        changes: { title: "Mixed", themeId: "theme-research" },
        base: { title: "Mobile Task", themeId: null },
      },
    },
    {
      ...valid,
      command: {
        name: "UpdateTask",
        taskId: "task-mobile-create",
        expectedScheduleVersion: null,
        expectedVersion: 1,
        changes: { themeId: "theme-research" },
        base: { title: "Mobile Task" },
      },
    },
    {
      ...valid,
      command: {
        name: "UpdateTask",
        taskId: "task-mobile-create",
        expectedScheduleVersion: null,
        expectedVersion: 1,
        changes: { plannedSchedule: { startTime: "25:00", durationMinutes: 90 } },
        base: { plannedSchedule: { startTime: null, durationMinutes: null } },
      },
    },
    { ...valid, idempotencyKey: "different-command" },
  ]) {
    assert.equal(mobileTaskCommandRequestSchema.safeParse(invalid).success, false);
  }
  assert.equal(mobileTodayRequestSchema.safeParse({
    apiVersion: 1,
    schemaVersion: 4,
    requestId: "request-today",
    date: "2026-08-21",
    limit: 51,
  }).success, false);
});

test("Mobile UpdateTask maps Today schedule to the canonical task field", async () => {
  const { service } = capability();
  const adapter = gateway(service);
  assert.equal((await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: createRequest(),
  })).status, 200);

  const scheduled = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: {
      ...createRequest(),
      requestId: "request-mobile-schedule",
      commandId: "command-mobile-schedule",
      idempotencyKey: "command-mobile-schedule",
      command: {
        name: "UpdateTask",
        taskId: "task-mobile-create",
        expectedScheduleVersion: null,
        expectedVersion: 1,
        changes: { todayDate: "2026-08-22" },
        base: { todayDate: null },
      },
    },
  });
  assert.equal(scheduled.status, 200);
  assert.equal(scheduled.body.data.task.todayDate, "2026-08-22");

  const unscheduled = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: {
      ...createRequest(),
      requestId: "request-mobile-unschedule",
      commandId: "command-mobile-unschedule",
      idempotencyKey: "command-mobile-unschedule",
      command: {
        name: "UpdateTask",
        taskId: "task-mobile-create",
        expectedScheduleVersion: null,
        expectedVersion: 2,
        changes: { todayDate: null },
        base: { todayDate: "2026-08-22" },
      },
    },
  });
  assert.equal(unscheduled.status, 200);
  assert.equal(unscheduled.body.data.task.todayDate, null);
});

test("Mobile checklist projection and UpdateTask preserve canonical item semantics", async () => {
  const { repository, service } = capability();
  const canonicalCommands = [];
  const adapter = gateway(service, {
    executeTaskCommand: (input) => {
      canonicalCommands.push(input);
      return service.executeCommand(input);
    },
  });
  assert.equal((await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: createRequest(),
  })).status, 200);

  const checklistItems = [
    { id: "check-second", title: "二番目", done: false, sortOrder: 1, completedAt: null },
    { id: "check-first", title: "最初", done: true, sortOrder: 0, completedAt: now },
  ];
  const response = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: {
      ...createRequest(),
      requestId: "request-mobile-checklist",
      commandId: "command-mobile-checklist",
      idempotencyKey: "command-mobile-checklist",
      command: {
        name: "UpdateTask",
        taskId: "task-mobile-create",
        expectedVersion: 1,
        expectedScheduleVersion: null,
        changes: { checklistItems },
        base: { checklistItems: [] },
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.task.checklistItems, [checklistItems[1], checklistItems[0]]);
  assert.deepEqual(canonicalCommands.at(-1).payload, {
    task_id: "task-mobile-create",
    expected_version: 1,
    changes: {
      checklist_items: [
        { id: "check-second", title: "二番目", done: false, sort_order: 1, completed_at: null },
        { id: "check-first", title: "最初", done: true, sort_order: 0, completed_at: now },
      ],
    },
    base: { checklist_items: [] },
  });
  assert.deepEqual(repository.get("task", "task-mobile-create").checklist_items, [
    { id: "check-second", title: "二番目", done: false, sort_order: 1, completed_at: null },
    { id: "check-first", title: "最初", done: true, sort_order: 0, completed_at: now },
  ]);
});

test("Mobile Schedule update derives canonical semantics and keeps Schedule identity/version server-owned", async () => {
  const { repository, service } = capability();
  const canonicalCommands = [];
  const adapter = gateway(service, {
    executeTaskCommand: (input) => {
      canonicalCommands.push(input);
      return service.executeCommand(input);
    },
  });
  assert.equal((await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: createRequest(),
  })).status, 200);

  const update = async (commandId, expectedVersion, expectedScheduleVersion, changes, base) => adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: {
      ...createRequest(),
      requestId: `request-${commandId}`,
      commandId,
      idempotencyKey: commandId,
      command: {
        name: "UpdateTask",
        taskId: "task-mobile-create",
        expectedVersion,
        expectedScheduleVersion,
        changes: { schedule: changes },
        base: { schedule: base },
      },
    },
  });

  const deadline = { startDate: null, endDate: "2026-08-24", rangeSemantics: null };
  const created = await update("command-mobile-schedule-create", 1, null, deadline, null);
  assert.equal(created.status, 200);
  assert.deepEqual(created.body.data.task.schedule, {
    id: "command-mobile-schedule-create",
    version: 1,
    startDate: null,
    endDate: "2026-08-24",
    dateKind: "deadline",
    rangeSemantics: null,
    confidence: "fixed",
    granularity: "day",
  });
  assert.deepEqual(canonicalCommands.at(-1).payload.schedule_change, {
    expected_version: null,
    changes: {
      start_date: null,
      end_date: "2026-08-24",
      date_kind: "deadline",
      range_semantics: null,
      confidence: "fixed",
      granularity: "day",
    },
    base: null,
  });
  const eventsAfterCreate = repository.list("change_event", true).length;
  const createReplay = await update("command-mobile-schedule-create", 1, null, deadline, null);
  assert.equal(createReplay.status, 200);
  assert.equal(createReplay.body.data.task.schedule.version, 1);
  assert.equal(repository.list("change_event", true).length, eventsAfterCreate);

  const range = { startDate: "2026-08-22", endDate: "2026-08-24", rangeSemantics: null };
  const edited = await update("command-mobile-schedule-edit", 2, 1, range, deadline);
  assert.equal(edited.status, 200);
  assert.equal(edited.body.data.task.schedule.id, "command-mobile-schedule-create");
  assert.equal(edited.body.data.task.schedule.version, 2);
  assert.equal(edited.body.data.task.schedule.dateKind, "range");
  assert.equal(edited.body.data.task.schedule.rangeSemantics, null);
  const eventsAfterEdit = repository.list("change_event", true).length;
  const editReplay = await update("command-mobile-schedule-edit", 2, 1, range, deadline);
  assert.equal(editReplay.status, 200);
  assert.equal(editReplay.body.data.task.schedule.version, 2);
  assert.equal(repository.list("change_event", true).length, eventsAfterEdit);

  const canonicalSchedule = repository.get("schedule", "command-mobile-schedule-create", true);
  repository.records.set("schedule:command-mobile-schedule-create", { ...canonicalSchedule, date_kind: "deadline" });
  const legacyProjection = await adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.bootstrap,
    principal,
    query: { apiVersion: "1", schemaVersion: "4", requestId: "request-legacy-schedule", limit: "50" },
  });
  assert.equal(legacyProjection.status, 200);
  assert.equal(legacyProjection.body.data.tasks[0].schedule.dateKind, "range");
  assert.equal(repository.get("schedule", "command-mobile-schedule-create", true).date_kind, "deadline");
  repository.records.set("schedule:command-mobile-schedule-create", canonicalSchedule);

  const clearedValue = { startDate: null, endDate: null, rangeSemantics: null };
  const cleared = await update("command-mobile-schedule-clear", 3, 2, clearedValue, range);
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.data.task.schedule.id, "command-mobile-schedule-create");
  assert.equal(cleared.body.data.task.schedule.version, 3);
  assert.equal(cleared.body.data.task.schedule.dateKind, "unknown");

  const invalid = await update(
    "command-mobile-schedule-invalid",
    4,
    3,
    { startDate: "2026-08-25", endDate: "2026-08-24", rangeSemantics: null },
    clearedValue,
  );
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, "validation_failed");
});

test("Mobile Schedule conflict remains valid when only the canonical Schedule version advanced", async () => {
  const { service } = capability();
  const setup = gateway(service);
  assert.equal((await setup.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: createRequest(),
  })).status, 200);
  const deadline = { startDate: null, endDate: "2026-08-24", rangeSemantics: null };
  assert.equal((await setup.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: {
      ...createRequest(),
      requestId: "request-schedule-conflict-setup",
      commandId: "command-schedule-conflict-setup",
      idempotencyKey: "command-schedule-conflict-setup",
      command: {
        name: "UpdateTask",
        taskId: "task-mobile-create",
        expectedVersion: 1,
        expectedScheduleVersion: null,
        changes: { schedule: deadline },
        base: { schedule: null },
      },
    },
  })).status, 200);
  const queried = service.executeQuery({
    schemaVersion: 2,
    query_id: "query-schedule-conflict",
    name: "GetTask",
    parameters: { task_id: "task-mobile-create", include_deleted: false },
  });
  assert.equal(queried.ok, true);
  const currentTask = {
    ...queried.value.task,
    schedule: { ...queried.value.task.schedule, version: queried.value.task.schedule.version + 1 },
  };
  const adapter = gateway(service, {
    executeTaskCommand: () => ({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "Schedule conflict",
        issues: [],
        retryable: false,
        conflict_reason: "version_conflict",
        details: { current_task: currentTask },
      },
    }),
  });
  const response = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: {
      ...createRequest(),
      requestId: "request-schedule-only-conflict",
      commandId: "command-schedule-only-conflict",
      idempotencyKey: "command-schedule-only-conflict",
      command: {
        name: "UpdateTask",
        taskId: "task-mobile-create",
        expectedVersion: currentTask.version,
        expectedScheduleVersion: currentTask.schedule.version - 1,
        changes: { schedule: { startDate: "2026-08-22", endDate: "2026-08-24", rangeSemantics: null } },
        base: { schedule: deadline },
      },
    },
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.conflict.conflictField, "schedule");
  assert.equal(response.body.error.conflict.expectedVersion, currentTask.version);
  assert.equal(response.body.error.conflict.expectedScheduleVersion, currentTask.schedule.version - 1);
  assert.equal(response.body.error.conflict.currentTask.version, currentTask.version);
  assert.equal(response.body.error.conflict.currentTask.schedule.version, currentTask.schedule.version);
});

test("Mobile bootstrap projects the latest Work Receipt summary without raw tool output", async () => {
  const { repository, service } = capability();
  const adapter = gateway(service, {
    listWorkReceipts: () => [
      {
        id: "receipt-old",
        taskId: "task-mobile-create",
        reportedAt: "2026-08-21T01:00:00.000Z",
        executorLabel: "Hermes",
        summary: "古い経過",
      },
      {
        id: "receipt-new",
        taskId: "task-mobile-create",
        reportedAt: "2026-08-21T03:00:00.000Z",
        executorLabel: "Hermes",
        summary: "確認してほしい結果",
      },
    ],
  });
  assert.equal((await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: createRequest({
      command: {
        ...createRequest().command,
        task: { ...createRequest().command.task, id: "task-mobile-create" },
      },
    }),
  })).status, 200);
  repository.records.set("task:task-mobile-create", {
    ...repository.records.get("task:task-mobile-create"),
    work_state: "needs_human_review",
  });

  const bootstrap = await adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.bootstrap,
    principal,
    query: { apiVersion: "1", schemaVersion: "4", requestId: "request-receipt", limit: "50" },
  });
  assert.equal(bootstrap.status, 200);
  assert.deepEqual(bootstrap.body.data.tasks[0].latestWorkReceipt, {
    id: "receipt-new",
    reportedAt: "2026-08-21T03:00:00.000Z",
    executorLabel: "Hermes",
    summary: "確認してほしい結果",
  });
  assert.equal(bootstrap.body.data.tasks[0].latestWorkReceipt.toolOutput, undefined);
  assert.equal(bootstrap.body.data.tasks[0].latestWorkReceipt.reasoning, undefined);

  const today = await adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.today,
    principal,
    query: todayQuery(),
  });
  assert.equal(today.body.data.items[0].latestWorkReceipt, undefined);
});

test("Mobile Work Receipt detail exposes only bounded canonical review fields", async () => {
  assert.deepEqual(mobileWorkReceiptResponseSchema.parse(workReceiptGolden), workReceiptGolden);
  assert.equal(mobileWorkReceiptRequestSchema.safeParse({
    apiVersion: 1,
    schemaVersion: 4,
    requestId: "request-work-receipt",
    taskId: "task-ai-review",
    receiptId: "receipt-ai-review",
  }).success, true);
  const { service } = capability();
  const adapter = gateway(service, {
    getWorkReceipt: () => ({
      id: "receipt-ai-review",
      taskId: "task-ai-review",
      executorKind: "ai_agent",
      executorLabel: "Codex",
      startedAt: "2026-08-21T01:00:00.000Z",
      reportedAt: "2026-08-21T01:20:00.000Z",
      summary: "Androidから確認できる変更です。",
      completedItems: ["Mobile Gateway detail contract"],
      changedOrCreatedItems: ["src/shared/contracts/mobile/schema.ts"],
      verification: ["node --test tests/mobile-gateway-phase4a.test.mjs"],
      remainingWork: ["Fold7 final signoff"],
      externalReferences: [{
        kind: "pull_request",
        provider: "github",
        display_label: "PR #472",
        url: "https://github.com/mryk814/tasuken/pull/472",
        external_id: "472",
      }],
      runtimeMetadata: { provider: "openai", model: "codex", report_kind: "report", reasoning: "hidden" },
      toolOutput: "hidden",
      reasoning: "hidden",
    }),
  });
  const response = await adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.workReceipt,
    principal,
    query: {
      apiVersion: "1",
      schemaVersion: "4",
      requestId: "request-work-receipt",
      taskId: "task-ai-review",
      receiptId: "receipt-ai-review",
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.meta.truncated, false);
  assert.deepEqual(response.body.data.receipt, workReceiptGolden.data.receipt);
  assert.equal(response.body.data.receipt.toolOutput, undefined);
  assert.equal(response.body.data.receipt.reasoning, undefined);
  assert.equal(response.body.data.receipt.runtimeMetadata, undefined);
});

test("Mobile Work Receipt detail rejects cross-Task lookup and truncates oversized review data", async () => {
  const { service } = capability();
  const adapter = gateway(service, {
    getWorkReceipt: () => ({
      id: "receipt-large",
      taskId: "task-owner",
      executorKind: "ai_agent",
      executorLabel: "Codex",
      startedAt: null,
      reportedAt: "2026-08-21T01:20:00.000Z",
      summary: "x".repeat(10001),
      completedItems: Array.from({ length: 21 }, (_, index) => `item-${index}-${"x".repeat(500)}`),
      changedOrCreatedItems: [],
      verification: [],
      remainingWork: [],
      externalReferences: [{
        kind: "pull_request",
        provider: "github",
        display_label: "PR #472",
        url: "https://github.com/mryk814/tasuken/pull/472?token=must-not-leave#review",
        external_id: "472",
      }],
      runtimeMetadata: { report_kind: "blocked" },
    }),
  });
  const query = {
    apiVersion: "1",
    schemaVersion: "4",
    requestId: "request-large",
    taskId: "task-owner",
    receiptId: "receipt-large",
  };
  const response = await adapter.handle({ method: "GET", path: TASKEN_MOBILE_ENDPOINTS.workReceipt, principal, query });
  assert.equal(response.status, 200);
  assert.equal(response.body.meta.truncated, true);
  assert.equal(response.body.data.receipt.reportKind, "blocked");
  assert.equal(response.body.data.receipt.summary.length, 10000);
  assert.equal(response.body.data.receipt.completedItems.length, 20);
  assert.ok(response.body.data.receipt.completedItems.every((item) => item.length <= 400));
  assert.equal(response.body.data.receipt.externalReferences[0].url, "https://github.com/mryk814/tasuken/pull/472");

  const crossTask = await adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.workReceipt,
    principal,
    query: { ...query, requestId: "request-cross-task", taskId: "task-other" },
  });
  assert.equal(crossTask.status, 404);
  assert.equal(crossTask.body.error.code, "not_found");
});

test("Mobile Task Work Proposal uses the canonical human decision boundary and redacts raw AI data", async () => {
  assert.deepEqual(
    mobileTaskWorkProposalsResponseSchema.parse(taskWorkProposalsGolden),
    taskWorkProposalsGolden,
  );
  assert.equal(mobileTaskWorkProposalsResponseSchema.safeParse({
    ...structuredClone(taskWorkProposalsGolden),
    data: {
      proposals: [{
        ...taskWorkProposalsGolden.data.proposals[0],
        runtimeMetadata: { reasoning: "must stay on Desktop" },
      }],
    },
  }).success, false);

  const { repository } = capability();
  const application = new ApplicationCommandService(repository);
  let applicationCommandCalls = 0;
  const runtime = new TaskenCoreRuntime(os.tmpdir(), repository, (command) => {
    if (command.name === "ApplyTaskWorkProposal") applicationCommandCalls += 1;
    return application.execute(command);
  });
  const adapter = runtime.createMobileGateway({
    current: () => ({ serverId: "desktop-home", serverRevision: 42, generatedAt: now }),
  });
  const created = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: createRequest({
      requestId: "request-proposal-task",
      commandId: "command-proposal-task",
      idempotencyKey: "command-proposal-task",
      command: {
        ...createRequest().command,
        task: {
          ...createRequest().command.task,
          id: "task-proposal-review",
          title: "ProposalをAndroidで確認する",
        },
      },
    }),
  });
  assert.equal(created.status, 200);
  const proposalId = "11111111-1111-5111-8111-111111111111";
  repository.save("ai_proposal", {
    id: proposalId,
    source: "mcp",
    source_app: "hermes-discord",
    payload_type: "task_work",
    payload: {
      task_work: [{
        action: "start",
        task_id: "task-proposal-review",
        expected_version: 1,
        caller: "Hermes",
        executor_kind: "ai_agent",
        executor_identity: "Hermes",
        started_at: null,
        repository_context: { repository_slug: "mryk814/tasuken", branch: "secret-branch" },
        runtime_metadata: { provider: "hidden", reasoning: "hidden" },
      }],
    },
    request: {
      caller: "Hermes",
      payload_digest: "must-not-leave-desktop",
      idempotency_key: "hidden-idempotency-key",
    },
    status: "pending",
    received_at: "2026-08-21T00:59:00.000Z",
  });

  const proposalList = await adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.proposals,
    principal,
    query: { apiVersion: "1", schemaVersion: "4", requestId: "request-proposals", limit: "50" },
  });
  assert.equal(proposalList.status, 200);
  assert.equal(proposalList.body.data.proposals.length, 1);
  assert.deepEqual(proposalList.body.data.proposals[0], {
    id: proposalId,
    version: 1,
    status: "pending",
    task: {
      id: "task-proposal-review",
      version: 1,
      title: "ProposalをAndroidで確認する",
      themeId: "theme-personal-default",
      workState: "not_delegated",
    },
    action: "start",
    caller: "Hermes",
    sourceApp: "hermes-discord",
    receivedAt: "2026-08-21T00:59:00.000Z",
    expectedTaskVersion: 1,
    stale: false,
    executorLabel: "Hermes",
    startedAt: null,
    reportedAt: null,
    summary: null,
    completedItems: [],
    changedOrCreatedItems: [],
    verification: [],
    remainingWork: [],
    externalReferences: [],
  });
  const serializedProjection = JSON.stringify(proposalList.body);
  assert.equal(serializedProjection.includes("payload_digest"), false);
  assert.equal(serializedProjection.includes("repository_slug"), false);
  assert.equal(serializedProjection.includes("runtime_metadata"), false);
  assert.equal(serializedProjection.includes("reasoning"), false);

  const decisionBody = {
    apiVersion: 1,
    schemaVersion: 4,
    requestId: "request-proposal-accept",
    commandId: "command-proposal-accept",
    idempotencyKey: "command-proposal-accept",
    clientDeviceId: principal.deviceId,
    issuedAt: now,
    proposalId,
    taskId: "task-proposal-review",
    expectedProposalVersion: 1,
    expectedTaskVersion: 1,
    decision: "accept",
  };
  assert.equal(mobileTaskWorkProposalDecisionRequestSchema.safeParse(decisionBody).success, true);
  const forbidden = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.proposalDecisions,
    principal: { ...principal, scopes: ["mobile:read", "mobile:task-write"] },
    body: decisionBody,
  });
  assert.equal(forbidden.status, 403);
  assert.equal(applicationCommandCalls, 0);
  const agent = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.proposalDecisions,
    principal: { kind: "ai_agent", deviceId: "agent", scopes: ["mobile:proposal-review"] },
    body: decisionBody,
  });
  assert.equal(agent.status, 401);
  assert.equal(applicationCommandCalls, 0);

  const accepted = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.proposalDecisions,
    principal,
    body: decisionBody,
  });
  assert.equal(accepted.status, 200);
  assert.equal(mobileTaskWorkProposalDecisionResponseSchema.safeParse(accepted.body).success, true);
  assert.equal(accepted.body.data.proposalStatus, "accepted");
  assert.equal(repository.get("ai_proposal", proposalId, true).status, "accepted");
  assert.equal(repository.get("task", "task-proposal-review").work_state, "in_progress");
  const acceptedTaskVersion = repository.get("task", "task-proposal-review").version;

  const replayed = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.proposalDecisions,
    principal,
    body: decisionBody,
  });
  assert.equal(replayed.status, 200);
  assert.equal(repository.get("task", "task-proposal-review").version, acceptedTaskVersion);

  const staleProposalId = "22222222-2222-5222-8222-222222222222";
  repository.save("ai_proposal", {
    id: staleProposalId,
    source: "mcp",
    source_app: "codex",
    payload_type: "task_work",
    payload: { task_work: [{
      action: "start",
      task_id: "task-proposal-review",
      expected_version: 1,
      caller: "Codex",
    }] },
    request: { caller: "Codex" },
    status: "pending",
    received_at: "2026-08-21T01:01:00.000Z",
  });
  const staleList = await adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.proposals,
    principal,
    query: { apiVersion: "1", schemaVersion: "4", requestId: "request-stale-proposal", limit: "50" },
  });
  assert.equal(staleList.body.data.proposals[0].stale, true);
  const staleAccept = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.proposalDecisions,
    principal,
    body: {
      ...decisionBody,
      requestId: "request-stale-accept",
      commandId: "command-stale-accept",
      idempotencyKey: "command-stale-accept",
      proposalId: staleProposalId,
      expectedTaskVersion: acceptedTaskVersion,
    },
  });
  assert.equal(staleAccept.status, 409);
  assert.equal(staleAccept.body.error.code, "proposal_conflict");
  assert.equal(repository.get("ai_proposal", staleProposalId, true).status, "pending");
  const rejected = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.proposalDecisions,
    principal,
    body: {
      ...decisionBody,
      requestId: "request-stale-reject",
      commandId: "command-stale-reject",
      idempotencyKey: "command-stale-reject",
      proposalId: staleProposalId,
      expectedTaskVersion: acceptedTaskVersion,
      decision: "reject",
    },
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.data.proposalStatus, "rejected");
  assert.equal(repository.get("task", "task-proposal-review").version, acceptedTaskVersion);
});

test("Mobile UpdateTask rejects plannedSchedule writes after the time editor was withdrawn", async () => {
  const { service } = capability();
  const adapter = gateway(service);
  const rejected = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: {
      ...createRequest(),
      command: {
        name: "UpdateTask",
        taskId: "task-mobile-create",
        expectedScheduleVersion: null,
        expectedVersion: 1,
        changes: { plannedSchedule: { startTime: "10:00", durationMinutes: 90 } },
        base: { plannedSchedule: { startTime: null, durationMinutes: null } },
      },
    },
  });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error.code, "validation_failed");
});

test("Mobile UpdateTask maps Theme to canonical project_id, normalizes null to Personal, and rejects deleted Themes", async () => {
  const { repository, service } = capability();
  repository.save("theme", {
    id: "theme-research",
    name: "Research",
  });
  const canonicalCommands = [];
  const adapter = gateway(service, {
    executeTaskCommand: (input) => {
      canonicalCommands.push(input);
      return service.executeCommand(input);
    },
  });
  assert.equal((await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: createRequest(),
  })).status, 200);

  const attached = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: {
      ...createRequest(),
      requestId: "request-mobile-theme-attach",
      commandId: "command-mobile-theme-attach",
      idempotencyKey: "command-mobile-theme-attach",
      command: {
        name: "UpdateTask",
        taskId: "task-mobile-create",
        expectedScheduleVersion: null,
        expectedVersion: 1,
        changes: { themeId: "theme-research" },
        base: { themeId: "theme-personal-default" },
      },
    },
  });
  assert.equal(attached.status, 200);
  assert.equal(attached.body.data.task.themeId, "theme-research");
  assert.deepEqual(canonicalCommands.at(-1).payload, {
    task_id: "task-mobile-create",
    expected_version: 1,
    changes: { project_id: "theme-research" },
    base: { project_id: "theme-personal-default" },
  });

  const detached = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: {
      ...createRequest(),
      requestId: "request-mobile-theme-detach",
      commandId: "command-mobile-theme-detach",
      idempotencyKey: "command-mobile-theme-detach",
      command: {
        name: "UpdateTask",
        taskId: "task-mobile-create",
        expectedScheduleVersion: null,
        expectedVersion: 2,
        changes: { themeId: null },
        base: { themeId: "theme-research" },
      },
    },
  });
  assert.equal(detached.status, 200);
  assert.equal(detached.body.data.task.themeId, "theme-personal-default");
  assert.deepEqual(canonicalCommands.at(-1).payload.changes, { project_id: null });
  assert.deepEqual(canonicalCommands.at(-1).payload.base, { project_id: "theme-research" });

  repository.remove("theme", "theme-research");
  const deleted = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: {
      ...createRequest(),
      requestId: "request-mobile-theme-deleted",
      commandId: "command-mobile-theme-deleted",
      idempotencyKey: "command-mobile-theme-deleted",
      command: {
        name: "UpdateTask",
        taskId: "task-mobile-create",
        expectedScheduleVersion: null,
        expectedVersion: 3,
        changes: { themeId: "theme-research" },
        base: { themeId: "theme-personal-default" },
      },
    },
  });
  assert.equal(deleted.status, 404);
  assert.equal(deleted.body.error.code, "theme_not_found");
  assert.equal(deleted.body.error.message, "選択したThemeは削除済みか利用できません。");
  assert.equal(deleted.body.error.retryable, false);
  assert.equal(repository.get("task", "task-mobile-create").project_id, "theme-personal-default");
  assert.equal(repository.get("task", "task-mobile-create").version, 3);
});

test("Phase 4A Today is scope-gated, Core-delegated, bounded, and path/secret free", async () => {
  const { service } = capability();
  service.executeCommand({
    schemaVersion: 2,
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
    schemaVersion: 2,
    query_id: "request-today",
    name: "ListTodayTasks",
    parameters: { date: "2026-08-21", limit: 20 },
  });
  assert.deepEqual(Object.keys(response.body.data.items[0]).sort(), [
    "checklistItems",
    "id",
    "schedule",
    "state",
    "themeId",
    "title",
    "updatedAt",
    "version",
    "workState",
  ]);
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

test("Mobile Theme catalog is read-scoped, deterministic, paged, and exposes only id/title", async () => {
  const { service } = capability();
  const catalog = [
    { id: "theme-gamma", name: "Gamma", description: "C:/private/theme-gamma", accessToken: "secret-gamma" },
    { id: "theme-alpha", name: "Alpha", repository_subdirectory: "/private/alpha" },
    { id: "theme-beta", name: "Beta", ai_source_refs: [{ locator: "C:/secret/token.txt" }] },
  ];
  const adapter = gateway(service, { listThemes: () => catalog });
  const first = await adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.themes,
    principal,
    query: { apiVersion: "1", schemaVersion: "4", requestId: "request-themes-1", limit: "2" },
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.meta.truncated, true);
  assert.deepEqual(first.body.data.themes, [
    { id: "theme-alpha", title: "Alpha" },
    { id: "theme-beta", title: "Beta" },
  ]);
  const firstCursor = decodeTaskenMobileThemeCursor(first.body.data.nextCursor);
  assert.equal(firstCursor?.position, 2);
  assert.match(firstCursor?.fingerprint || "", /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(first.body), /private|secret|token|description|repository|source/i);

  const second = await adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.themes,
    principal,
    query: {
      apiVersion: "1",
      schemaVersion: "4",
      requestId: "request-themes-2",
      cursor: first.body.data.nextCursor,
      limit: "2",
    },
  });
  assert.equal(second.status, 200);
  assert.equal(second.body.meta.truncated, false);
  assert.deepEqual(second.body.data, {
    themes: [{ id: "theme-gamma", title: "Gamma" }],
    nextCursor: null,
  });

  const invalidCursor = await adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.themes,
    principal,
    query: { apiVersion: "1", schemaVersion: "4", requestId: "request-themes-stale", cursor: "theme-missing" },
  });
  assert.equal(invalidCursor.status, 400);
  assert.equal(invalidCursor.body.error.code, "validation_failed");

  const trimmedCursor = await adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.themes,
    principal,
    query: {
      apiVersion: "1",
      schemaVersion: "4",
      requestId: "request-themes-trimmed",
      cursor: ` ${first.body.data.nextCursor} `,
    },
  });
  assert.equal(trimmedCursor.status, 400);
  assert.equal(trimmedCursor.body.error.code, "validation_failed");

  catalog.push({ id: "theme-delta", name: "Delta" });
  const changedCatalog = await adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.themes,
    principal,
    query: {
      apiVersion: "1",
      schemaVersion: "4",
      requestId: "request-themes-changed",
      cursor: first.body.data.nextCursor,
      limit: "2",
    },
  });
  assert.equal(changedCatalog.status, 400);
  assert.equal(changedCatalog.body.error.code, "validation_failed");

  const duplicateCatalog = await gateway(service, {
    listThemes: () => [
      { id: "theme-duplicate", name: "First" },
      { id: " theme-duplicate ", name: "Second" },
    ],
  }).handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.themes,
    principal,
    query: { apiVersion: "1", schemaVersion: "4", requestId: "request-themes-duplicate" },
  });
  assert.equal(duplicateCatalog.status, 500);
  assert.equal(duplicateCatalog.body.error.code, "internal_error");

  const forbidden = await adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.themes,
    principal: { ...principal, scopes: ["mobile:task-write"] },
    query: { apiVersion: "1", schemaVersion: "4", requestId: "request-themes-forbidden" },
  });
  assert.equal(forbidden.status, 403);

  const unknownQuery = await adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.themes,
    principal,
    query: { apiVersion: "1", schemaVersion: "4", requestId: "request-themes-invalid", includeArchived: "true" },
  });
  assert.equal(unknownQuery.status, 400);
  assert.equal(unknownQuery.body.error.code, "validation_failed");
});

test("CreateTask preserves strict capture provenance through replay without storing captured content", async () => {
  const mobileCapability = capability();
  const adapter = gateway(mobileCapability.service);
  const provenance = {
    reportedVia: "android_speech",
    capturedAt: now,
    captureMethod: "android_speech",
    recognitionMode: "on_device",
    language: "ja-JP",
    confidence: 0.82,
    sourceAudioAvailable: false,
    sharedMimeType: null,
  };
  const request = createRequest({
    requestId: "request-mobile-provenance",
    commandId: "command-mobile-provenance",
    idempotencyKey: "command-mobile-provenance",
    command: {
      ...createRequest().command,
      task: {
        ...createRequest().command.task,
        id: "task-mobile-provenance",
        title: "音声で作成したTask",
      },
      provenance,
    },
  });

  const first = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: request,
  });

  assert.equal(first.status, 200);
  assert.deepEqual(mobileCapability.repository.list("change_event")[0].metadata.provenance, {
    reported_via: "android_speech",
    captured_at: now,
    capture_method: "android_speech",
    recognition_mode: "on_device",
    language: "ja-JP",
    confidence: 0.82,
    source_audio_available: false,
    shared_mime_type: null,
  });
  assert.doesNotMatch(JSON.stringify(mobileCapability.repository.list("change_event")[0].metadata), /音声で作成したTask/);

  const replay = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: request,
  });
  assert.equal(replay.status, 200);
  assert.equal(mobileCapability.repository.list("change_event").length, 1);

  const changedProvenance = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: {
      ...request,
      command: { ...request.command, provenance: { ...provenance, confidence: 0.5 } },
    },
  });
  assert.equal(changedProvenance.status, 409);
  assert.equal(changedProvenance.body.error.code, "idempotency_conflict");
  assert.equal(mobileCapability.repository.list("change_event").length, 1);

  const invalidProvenance = [
    { ...provenance, reportedVia: "widget" },
    {
      reportedVia: "share_target",
      capturedAt: now,
      captureMethod: null,
      recognitionMode: null,
      language: null,
      confidence: null,
      sourceAudioAvailable: null,
      sharedMimeType: null,
    },
    {
      reportedVia: "widget",
      capturedAt: now,
      captureMethod: null,
      recognitionMode: "on_device",
      language: null,
      confidence: null,
      sourceAudioAvailable: null,
      sharedMimeType: null,
    },
  ];
  for (const [index, invalid] of invalidProvenance.entries()) {
    const response = await adapter.handle({
      method: "POST",
      path: TASKEN_MOBILE_ENDPOINTS.commands,
      principal,
      body: {
        ...request,
        requestId: `request-invalid-provenance-${index}`,
        commandId: `command-invalid-provenance-${index}`,
        idempotencyKey: `command-invalid-provenance-${index}`,
        command: {
          ...request.command,
          task: { ...request.command.task, id: `task-invalid-provenance-${index}` },
          provenance: invalid,
        },
      },
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "validation_failed");
  }
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
    schemaVersion: 2,
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
    schemaVersion: 2,
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
    schemaVersion: 2,
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
    schemaVersion: 2,
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
      todayDate: "2026-08-21",
      plannedStartTime: null,
      plannedDurationMinutes: null,
      latestWorkReceipt: null,
      checklistItems: [],
      schedule: null,
      updatedAt: now,
    },
    intendedAction: "ReopenTask",
    expectedVersion: 1,
    conflictField: "task",
    expectedScheduleVersion: null,
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

  const deleted = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: stateRequest("DeleteTask", 3),
  });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.data.commandId, "command-mobile-delete");
  assert.equal(deleted.body.data.task.id, "task-mobile-create");
  assert.equal(deleted.body.data.task.version, 4);
  assert.equal(mobileCapability.repository.get("task", "task-mobile-create"), null);
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
  assert.deepEqual(health.data.capabilities, [
    TASKEN_MOBILE_CAPABILITIES.health,
    TASKEN_MOBILE_CAPABILITIES.todayRead,
    TASKEN_MOBILE_CAPABILITIES.syncRead,
    TASKEN_MOBILE_CAPABILITIES.workReceiptRead,
    TASKEN_MOBILE_CAPABILITIES.proposalRead,
    TASKEN_MOBILE_CAPABILITIES.taskWrite,
    TASKEN_MOBILE_CAPABILITIES.proposalReview,
  ]);
  const themes = await client.listThemes({
    apiVersion: 1,
    schemaVersion: 4,
    requestId: "request-client-themes",
    limit: 50,
  });
  assert.deepEqual(themes.data, {
    themes: [{ id: "theme-personal-default", title: "Personal" }],
    nextCursor: null,
  });

  const legacyRequests = [];
  const legacyDesktop = new MobileGatewayClient({
    baseUrl: "https://legacy-desktop.tailnet.ts.net",
    accessToken,
    fetch: async (url) => {
      legacyRequests.push(new URL(url).pathname);
      return new Response(JSON.stringify({
        ok: false,
        meta: { ...themesGolden.meta, serverId: "legacy-desktop", truncated: false },
        error: {
          code: "not_found",
          message: "Mobile API endpointが見つかりません。",
          retryable: false,
        },
      }), {
        status: 404,
        headers: { "x-tasken-mobile-api-version": "1" },
      });
    },
  });
  await assert.rejects(legacyDesktop.listThemes({
    apiVersion: 1,
    schemaVersion: 4,
    requestId: "request-legacy-themes",
    limit: 50,
  }), (error) => error instanceof MobileGatewayClientError && error.code === "not_found");
  assert.deepEqual(legacyRequests, [TASKEN_MOBILE_ENDPOINTS.themes]);

  const created = await client.executeTaskCommand(createRequest({
    requestId: "request-client-create",
    commandId: "command-client-create",
    idempotencyKey: "command-client-create",
    command: { ...createRequest().command, task: { ...createRequest().command.task, id: "task-client-create" } },
  }));
  assert.equal(created.data.status, "applied");
  const today = await client.listToday({
    apiVersion: 1,
    schemaVersion: 4,
    requestId: "request-client-today",
    date: "2026-08-21",
    limit: 20,
  });
  assert.equal(today.data.items.some((item) => item.id === "task-client-create"), true);
  const todayCall = seen.find((entry) => entry.url.includes("/v1/today?"));
  assert.ok(todayCall);
  assert.equal(todayCall.method, "GET");
  assert.equal(todayCall.body, undefined);
  const themesCall = seen.find((entry) => entry.url.includes("/v1/themes?"));
  assert.ok(themesCall);
  assert.equal(themesCall.method, "GET");
  assert.equal(themesCall.body, undefined);
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
    query: { apiVersion: "1", schemaVersion: "4", requestId: "request-bootstrap", limit: "50" },
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

  const syncQuery = { apiVersion: "1", schemaVersion: "4", requestId: "request-sync", cursor, limit: "1" };
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

test("Mobile bootstrap rederives dateKind when stored schedule kind disagrees with dates", async () => {
  const { repository, service } = capability();
  const adapter = gateway(service);
  assert.equal((await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.commands,
    principal,
    body: createRequest({
      requestId: "request-mismatch-create",
      commandId: "command-mismatch-create",
      idempotencyKey: "command-mismatch-create",
      command: {
        ...createRequest().command,
        task: { ...createRequest().command.task, id: "task-datekind-mismatch", title: "日付種別ずれ" },
      },
    }),
  })).status, 200);

  repository.records.set("schedule:sched-datekind-mismatch", {
    type: "schedule",
    id: "sched-datekind-mismatch",
    owner_type: "task",
    owner_id: "task-datekind-mismatch",
    start_date: "2026-09-08",
    end_date: "2026-09-08",
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

  const bootstrap = await adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.bootstrap,
    principal,
    query: { apiVersion: "1", schemaVersion: "4", requestId: "request-bootstrap-mismatch", limit: "50" },
  });
  assert.equal(bootstrap.status, 200);
  const task = bootstrap.body.data.tasks.find((item) => item.id === "task-datekind-mismatch");
  assert.equal(task.schedule.dateKind, "point");
  assert.equal(task.schedule.startDate, "2026-09-08");
  assert.equal(task.schedule.endDate, "2026-09-08");
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
    schemaVersion: 2,
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
        expectedScheduleVersion: null,
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
    schemaVersion: 2,
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
        expectedScheduleVersion: null,
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
      meta: { apiVersion: 1, schemaVersion: 4, serverId: "desktop", serverRevision: 1, generatedAt: now, truncated: false },
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

    const themeCatalog = await adapter.handle({
      method: "GET",
      path: TASKEN_MOBILE_ENDPOINTS.themes,
      principal,
      query: { apiVersion: "1", schemaVersion: "4", requestId: "request-runtime-themes" },
    });
    assert.equal(themeCatalog.status, 200);
    assert.deepEqual(themeCatalog.body.data, {
      themes: [{ id: "theme-personal-default", title: "Personal" }],
      nextCursor: null,
    });

    const created = await adapter.handle({
      method: "POST",
      path: TASKEN_MOBILE_ENDPOINTS.commands,
      principal,
      body: createRequest(),
    });
    assert.equal(created.status, 200);

    const query = {
    schemaVersion: 2,
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
    schemaVersion: 2,
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
