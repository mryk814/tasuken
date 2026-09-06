import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import { buildActivityEvent } from "../src/shared/activityEvent.mjs";
import { createMobileOfflineGateway } from "./helpers/mobile-offline-gateway.mjs";

const bundle = await build({
  stdin: {
    contents: `
      export { MobileGatewayAdapter } from './src/main/gateway/mobile/mobileGatewayAdapter.ts';
      export { createMobileActivityReadPort } from './src/main/composition/mobileActivityReadPort.ts';
      export { planWorkLog } from './src/main/services/workLogCommand.ts';
      export * from './src/shared/contracts/mobile/public.ts';
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
  MobileGatewayAdapter,
  createMobileActivityReadPort,
  mobileActivityResponseSchema,
  planWorkLog,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const now = "2026-09-06T08:00:00.000Z";
const query = (overrides = {}) => ({
  apiVersion: "1",
  schemaVersion: "7",
  requestId: "recall-test",
  date: "2026-09-06",
  timezone: "Asia/Tokyo",
  limit: "100",
  ...overrides,
});
function fixture(
  workspace = { tasks: [], notes: [], capture_entries: [], change_events: [] },
  overrides = {},
) {
  const adapter = new MobileGatewayAdapter({
    core: {
      status: () => ({ apiVersion: "1", capabilities: ["task.query", "task.command"] }),
      queryActivity: createMobileActivityReadPort({ readWorkspaceSnapshot: () => workspace }),
      ...overrides,
    },
    state: { current: () => ({ serverId: "desktop-recall", serverRevision: 1, generatedAt: now }) },
  });
  return {
    workspace,
    request: (values = {}, options = {}) =>
      adapter.handle({
        method: "GET",
        path: "/v1/activity",
        query: query(values),
        principal: { kind: "mobile_device", deviceId: "phone-recall", scopes: ["mobile:read"] },
        ...options,
      }),
  };
}
function taskEvent(workspace, id, occurredAt = now) {
  const task = { id: `task-${id}`, title: `測定 ${id}`, state: "done", ai_visibility: [] };
  workspace.tasks.push(task);
  workspace.change_events.push(
    buildActivityEvent({
      id: `event-${id}`,
      entity_type: "task",
      entity_id: task.id,
      event_kind: "task_completed",
      occurred_at: occurredAt,
      after: task,
    }),
  );
}

test("activity requires mobile:read, advertises only an available port, and rejects invalid queries", async () => {
  let calls = 0;
  const source = fixture(undefined, {
    queryActivity: () => {
      calls += 1;
      throw new Error("must not be called");
    },
  });
  assert.equal((await source.request({}, { principal: null })).status, 401);
  assert.equal(
    (
      await source.request(
        {},
        {
          principal: { kind: "mobile_device", deviceId: "phone", scopes: ["mobile:context-read"] },
        },
      )
    ).status,
    403,
  );
  assert.equal((await source.request({}, { method: "POST" })).status, 405);
  for (const invalid of [
    { date: "2026-02-30" },
    { timezone: "invalid/zone" },
    { timezone: "" },
    { limit: "0" },
    { limit: "-1" },
    { limit: "501" },
    { limit: "1.5" },
    { cursor: "x".repeat(201) },
    { audience: "coding_agent" },
    { profile: "default" },
  ]) {
    const response = await source.request(invalid);
    assert.equal(response.status, 400, JSON.stringify({ invalid, response }));
    assert.equal(response.body.error.code, "validation_failed");
  }
  assert.equal(calls, 0);
  const health = await fixture().request({}, { path: "/v1/health", query: {} });
  assert.ok(health.body.data.capabilities.includes("mobile.activity.read"));
  const old = fixture(undefined, { queryActivity: undefined });
  const oldHealth = await old.request({}, { path: "/v1/health", query: {} });
  assert.equal(oldHealth.body.data.capabilities.includes("mobile.activity.read"), false);
  assert.equal((await old.request()).body.error.code, "capability_unavailable");
});

test("owner recall pages through 501 AI-private records without duplicate IDs", async () => {
  const source = fixture();
  for (let index = 0; index < 501; index += 1)
    taskEvent(source.workspace, String(index).padStart(3, "0"));
  const first = await source.request({ limit: "500" });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  mobileActivityResponseSchema.parse(first.body);
  assert.equal(first.body.meta.truncated, true);
  assert.equal(first.body.data.events.length, 500);
  assert.equal(first.body.data.page.matched_visible_count, 501);
  assert.equal(first.body.data.events[0].id, "event-500");
  assert.deepEqual(first.body.data.events[0].mobile_source, {
    type: "task",
    id: "task-500",
    status: "available",
    reason: null,
  });
  const second = await source.request({ limit: "500", cursor: first.body.data.page.next_cursor });
  assert.equal(second.body.data.page.status, "ok");
  assert.equal(second.body.data.events.length, 1);
  assert.equal(second.body.data.events[0].id, "event-000");
  assert.equal(second.body.data.page.next_cursor, null);
  assert.equal(second.body.meta.truncated, false);
  assert.equal(
    new Set([...first.body.data.events, ...second.body.data.events].map((event) => event.id)).size,
    501,
  );
});

test("calendar boundaries and WorkLog performed days keep their own precision and original source", async () => {
  const source = fixture();
  taskEvent(source.workspace, "before", "2026-09-05T14:59:59.000Z");
  taskEvent(source.workspace, "midnight", "2026-09-05T15:00:00.000Z");
  const command = JSON.parse(
    readFileSync(new URL("./fixtures/work-log-v1.json", import.meta.url), "utf8"),
  );
  const plan = planWorkLog(
    {
      ...command,
      commandId: "work-log-yesterday",
      performedDate: "2026-09-06",
      issuedAt: "2026-09-08T10:00:00+09:00",
      themeId: null,
      taskId: null,
    },
    now,
    null,
    { kind: "user", id: "phone-recall" },
  );
  source.workspace.notes.push(plan.note);
  source.workspace.change_events.push(plan.companion.event);
  const response = await source.request();
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(
    response.body.data.events.map((event) => event.entity_ref.id),
    ["task-midnight", "work-log-yesterday"],
  );
  const log = response.body.data.events.find(
    (event) => event.entity_ref.id === "work-log-yesterday",
  );
  assert.equal(log.local_date, "2026-09-06");
  assert.equal(log.local_time, "");
  assert.equal(log.recall.date_basis, "performed_day");
  assert.equal(log.recall.stage, "work_recorded");
  assert.deepEqual(log.mobile_source, {
    type: "work_log",
    id: "work-log-yesterday",
    status: "available",
    reason: null,
  });
  const utc = await source.request({ timezone: "UTC" });
  assert.deepEqual(
    utc.body.data.events.map((event) => event.entity_ref.id),
    ["work-log-yesterday"],
  );
  const enteredDay = await source.request({ date: "2026-09-08" });
  assert.equal(enteredDay.body.data.events.length, 0);
  assert.equal(enteredDay.body.data.page.status, "ok");
  assert.equal(enteredDay.body.data.page.matched_visible_count, 0);
});

test("invalid and stale cursors are explicit unsuccessful pages, never a fetched empty day", async () => {
  const source = fixture();
  taskEvent(source.workspace, "a");
  taskEvent(source.workspace, "b");
  const first = await source.request({ limit: "1" });
  const cursor = first.body.data.page.next_cursor;
  const changedQuery = await source.request({ limit: "1", date: "2026-09-05", cursor });
  assert.equal(changedQuery.body.data.page.status, "invalid_cursor");
  assert.equal(changedQuery.body.data.page.matched_visible_count, null);
  const malformed = await source.request({ cursor: "invalid" });
  assert.equal(malformed.body.data.page.status, "invalid_cursor");
  taskEvent(source.workspace, "c");
  const stale = await source.request({ limit: "1", cursor });
  assert.equal(stale.body.data.page.status, "resync_required");
  assert.equal(stale.body.data.page.matched_visible_count, null);
  assert.deepEqual(stale.body.data.events, []);
});

test("source availability distinguishes Capture and Desktop-only Note details", async () => {
  const source = fixture();
  source.workspace.capture_entries.push({
    id: "capture",
    text: "途中の測定メモ",
    state: "untriaged",
    captured_at: now,
    ai_visibility: [],
  });
  const note = {
    id: "ordinary-note",
    title: "詳しいノート",
    body_markdown: "本文",
    ai_visibility: [],
  };
  source.workspace.notes.push(note);
  source.workspace.change_events.push(
    buildActivityEvent({
      id: "note-event",
      entity_type: "note",
      entity_id: note.id,
      event_kind: "note_created",
      occurred_at: now,
      after: note,
    }),
  );
  const response = await source.request();
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const capture = response.body.data.events.find((event) => event.entity_ref.id === "capture");
  assert.equal(capture.recall.stage, "input");
  assert.deepEqual(capture.mobile_source, {
    type: "capture_entry",
    id: "capture",
    status: "available",
    reason: null,
  });
  assert.deepEqual(
    response.body.data.events.find((event) => event.entity_ref.id === "ordinary-note")
      .mobile_source,
    {
      type: "note",
      id: "ordinary-note",
      status: "unavailable",
      reason: "unsupported_type",
    },
  );
});

test("owner recall keeps private historical and current names and private secondary references", async () => {
  const oldTask = {
    id: "moved-task",
    title: "当時の非公開Task",
    project_id: "old-theme",
    state: "done",
    ai_visibility: [],
  };
  const workspace = {
    tasks: [{ ...oldTask, title: "現在の非公開Task", project_id: "new-theme" }],
    notes: [{ id: "private-note", title: "非公開の参照", ai_visibility: [] }],
    themes: [
      { id: "old-theme", name: "以前の所属", default_ai_visibility: [] },
      { id: "new-theme", name: "現在の所属", default_ai_visibility: [] },
    ],
    change_events: [
      buildActivityEvent({
        id: "moved-event",
        entity_type: "task",
        entity_id: oldTask.id,
        event_kind: "task_completed",
        occurred_at: now,
        after: oldTask,
        source_refs: [{ type: "note", id: "private-note" }],
        relation_refs: [{ type: "note", id: "private-note", relation: "context" }],
      }),
    ],
  };
  const source = fixture(workspace);
  const response = await source.request();
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const entry = response.body.data.events[0];
  assert.equal(entry.entity_title, "当時の非公開Task");
  assert.equal(entry.theme_ref.id, "old-theme");
  assert.equal(entry.recall.history.current_entity_title, "現在の非公開Task");
  assert.equal(entry.recall.history.current_theme_ref.id, "new-theme");
  assert.equal(entry.recall.history.theme_title, "以前の所属");
  assert.equal(entry.recall.history.current_theme_title, "現在の所属");
  assert.ok(entry.source_refs.some((ref) => ref.id === "private-note"));
  assert.ok(entry.relation_refs.some((ref) => ref.id === "private-note"));
  workspace.tasks[0].deleted_at = now;
  const deleted = await source.request();
  assert.equal(deleted.body.data.events.length, 0);
  assert.deepEqual(deleted.body.data.excluded_reasons, [
    { type: "task", reason: "entity_deleted", count: 1 },
  ]);
});

test("shared mobile fixtures retain complete, empty, continuation and unsupported-source distinctions", () => {
  const examples = JSON.parse(
    readFileSync(
      new URL("../contracts/mobile/v1/activity-response.golden.json", import.meta.url),
      "utf8",
    ),
  );
  for (const example of Object.values(examples)) mobileActivityResponseSchema.parse(example);
  assert.equal(examples.single.data.events.length, 1);
  assert.equal(examples.empty.data.page.status, "ok");
  assert.equal(examples.empty.data.page.matched_visible_count, 0);
  assert.equal(examples.partial.data.truncated, true);
  assert.ok(examples.partial.data.page.next_cursor);
  assert.equal(examples.unavailable.data.events[0].mobile_source.reason, "unsupported_type");
});

test("real Gateway and SQLite return a recorded WorkLog after Desktop restart", async () => {
  const source = await createMobileOfflineGateway();
  try {
    const headers = {
      authorization: `Bearer ${source.config.accessToken}`,
      "content-type": "application/json",
    };
    const health = await (await fetch(`${source.config.origin}/v1/health`, { headers })).json();
    assert.ok(health.data.capabilities.includes("mobile.activity.read"));
    assert.ok(health.data.capabilities.includes("mobile.work-log.read"));
    const send = await fetch(`${source.config.origin}/v1/commands`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        apiVersion: 1,
        schemaVersion: 7,
        requestId: "recall-log",
        commandId: "recall-log",
        idempotencyKey: "recall-log",
        clientDeviceId: source.config.deviceId,
        issuedAt: now,
        command: {
          name: "RecordWorkLog",
          body: "昨日の測定を途中まで実施",
          performedDate: "2026-09-05",
        },
      }),
    });
    assert.equal(send.status, 200);
    await source.control({ restartDesktop: true });
    const url = `${source.config.origin}/v1/activity?${new URLSearchParams(query({ date: "2026-09-05" }))}`;
    const response = await fetch(url, { headers });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    const entry = body.data.events.find((event) => event.entity_ref.id === "recall-log");
    assert.equal(entry.recall.stage, "work_recorded");
    assert.equal(entry.mobile_source.id, "recall-log");
    assert.equal(entry.local_date, "2026-09-05");
    assert.equal(entry.local_time, "");
  } finally {
    await source.close();
  }
});
