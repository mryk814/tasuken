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
function fixture(overrides = {}) {
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
  });
  return { adapter, calls };
}

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
          plannedStartTime: "16:30",
          plannedDurationMinutes: 75,
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
  assert.equal(command.payload.task.planned_start_time, "16:30");
  assert.equal(command.payload.task.planned_duration_minutes, 75);
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
