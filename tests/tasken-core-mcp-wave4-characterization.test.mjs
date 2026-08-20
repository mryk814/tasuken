import assert from "node:assert/strict";
import test from "node:test";

import { ReadOnlyTaskenContext } from "../src/main/mcp/readOnlyContext.mjs";

const visibleTheme = {
  id: "theme-visible",
  name: "Visible",
  default_ai_visibility: ["coding_agent"],
  updated_at: "2026-08-21T00:00:00.000Z",
};
const hiddenTheme = {
  id: "theme-hidden",
  name: "Hidden",
  default_ai_visibility: ["m365"],
  updated_at: "2026-08-21T00:00:00.000Z",
};

function context(workspace) {
  return new ReadOnlyTaskenContext("wave4-characterization.sqlite", {
    workspace,
    aiVisibilityDefault: ["coding_agent"],
  });
}

function visibleWorkspace(overrides = {}) {
  return {
    themes: [visibleTheme],
    items: [],
    tasks: [],
    waitings: [],
    plan_nodes: [],
    schedules: [],
    ...overrides,
  };
}

function ids(result) {
  return result.items.map((item) => item.id);
}

function publicRecord(record) {
  const { ai: _ai, ...withoutAi } = record;
  return withoutAi;
}

test("Wave 4 legacy search integrates Item, Task, Waiting, PlanNode and Schedule with legacy dedupe", () => {
  const workspace = visibleWorkspace({
    items: [{
      id: "legacy-duplicate",
      title: "Legacy duplicate",
      description: "old representation",
      status: "todo",
      project_id: "theme-visible",
      updated_at: "2026-08-20T01:00:00.000Z",
      deleted_at: null,
      source: "legacy",
    }],
    tasks: [{
      id: "task-duplicate",
      legacy_item_id: "legacy-duplicate",
      title: "V2 duplicate wins",
      description: "new representation",
      state: "doing",
      priority: "high",
      project_id: "theme-visible",
      updated_at: "2026-08-20T02:00:00.000Z",
      deleted_at: null,
      source: "manual",
    }],
    waitings: [{
      id: "waiting-1",
      title: "Waiting projection",
      description: "waiting description",
      waiting_for: "Vendor",
      next_action: "Ask vendor",
      state: "pending",
      project_id: "theme-visible",
      updated_at: "2026-08-20T03:00:00.000Z",
      deleted_at: null,
      source: "manual",
    }],
    plan_nodes: [{
      id: "plan-1",
      title: "Plan milestone",
      description: "plan description",
      type: "milestone",
      state: "in_progress",
      project_id: "theme-visible",
      updated_at: "2026-08-20T04:00:00.000Z",
      deleted_at: null,
      source: "manual",
    }],
    schedules: [
      {
        id: "schedule-task",
        owner_type: "task",
        owner_id: "task-duplicate",
        start_date: "2026-09-01",
        end_date: "2026-09-03",
        updated_at: "2026-08-20T02:00:00.000Z",
      },
      {
        id: "schedule-waiting",
        owner_type: "waiting",
        owner_id: "waiting-1",
        start_date: "2026-09-04",
        end_date: "2026-09-04",
        updated_at: "2026-08-20T03:00:00.000Z",
      },
      {
        id: "schedule-plan",
        owner_type: "plan_node",
        owner_id: "plan-1",
        start_date: "2026-09-05",
        end_date: "2026-09-07",
        updated_at: "2026-08-20T04:00:00.000Z",
      },
    ],
  });
  const read = context(workspace);
  try {
    const result = read.toolSearchItems({});
    assert.deepEqual(ids(result), ["plan-1", "waiting-1", "legacy-duplicate"]);
    assert.equal(result.limit, 20);
    assert.equal(result.ai_audience, "coding_agent");
    assert.equal(result.excluded_count, 0);
    assert.deepEqual(result.excluded_reasons, []);
    assert.deepEqual(result.items.map(publicRecord), [
      {
        id: "plan-1",
        title: "Plan milestone",
        kind: "milestone",
        status: "todo",
        priority: "normal",
        theme_id: "theme-visible",
        description: "plan description",
        planned_start: "2026-09-05",
        planned_end: "2026-09-07",
        due_date: null,
        source_record_id: undefined,
        created_at: undefined,
        updated_at: "2026-08-20T04:00:00.000Z",
        deleted_at: null,
        source: "manual",
      },
      {
        id: "waiting-1",
        title: "Waiting projection",
        kind: "waiting",
        status: "waiting",
        priority: "normal",
        theme_id: "theme-visible",
        description: "waiting description",
        waiting_for: "Vendor",
        next_action: "Ask vendor",
        planned_start: "2026-09-04",
        planned_end: "2026-09-04",
        due_date: null,
        source_record_id: undefined,
        created_at: undefined,
        updated_at: "2026-08-20T03:00:00.000Z",
        deleted_at: null,
        source: "manual",
      },
      {
        id: "legacy-duplicate",
        title: "V2 duplicate wins",
        kind: "task",
        status: "doing",
        priority: "high",
        theme_id: "theme-visible",
        description: "new representation",
        planned_start: "2026-09-01",
        planned_end: "2026-09-03",
        due_date: null,
        source_record_id: undefined,
        created_at: undefined,
        updated_at: "2026-08-20T02:00:00.000Z",
        deleted_at: null,
        source: "manual",
      },
    ]);
    for (const item of result.items) {
      assert.equal("locator" in item, false);
      assert.equal("result_meta" in item, false);
    }
  } finally {
    read.close();
  }
});

test("Wave 4 legacy status mapping and open-item date projection are fixed", () => {
  const read = context(visibleWorkspace({
    tasks: [
      { id: "task-doing", title: "doing", state: "doing", project_id: "theme-visible", updated_at: "2026-08-20T01:00:00.000Z", deleted_at: null },
      { id: "task-done", title: "done", state: "done", project_id: "theme-visible", updated_at: "2026-08-20T02:00:00.000Z", deleted_at: null },
    ],
    waitings: [
      { id: "waiting-open", title: "open waiting", state: "pending", project_id: "theme-visible", updated_at: "2026-08-20T03:00:00.000Z", deleted_at: null },
      { id: "waiting-received", title: "received", state: "received", project_id: "theme-visible", updated_at: "2026-08-20T04:00:00.000Z", deleted_at: null },
      { id: "waiting-cancelled", title: "cancelled", state: "cancelled", project_id: "theme-visible", updated_at: "2026-08-20T05:00:00.000Z", deleted_at: null },
    ],
    plan_nodes: [
      { id: "plan-open", title: "open plan", type: "period", state: "in_progress", project_id: "theme-visible", updated_at: "2026-08-20T06:00:00.000Z", deleted_at: null },
      { id: "plan-done", title: "done plan", type: "milestone", state: "done", project_id: "theme-visible", updated_at: "2026-08-20T07:00:00.000Z", deleted_at: null },
      { id: "plan-cancelled", title: "cancelled plan", type: "milestone", state: "cancelled", project_id: "theme-visible", updated_at: "2026-08-20T08:00:00.000Z", deleted_at: null },
    ],
    items: [
      { id: "legacy-open", title: "legacy open", status: "inbox", project_id: "theme-visible", updated_at: "2026-08-20T09:00:00.000Z", deleted_at: null },
      { id: "legacy-default", title: "legacy default", project_id: "theme-visible", updated_at: "2026-08-20T10:00:00.000Z", deleted_at: null },
    ],
    schedules: [
      { id: "schedule-plan-open", owner_type: "plan_node", owner_id: "plan-open", start_date: "2026-09-03", end_date: "2026-09-03", updated_at: "2026-08-20T06:00:00.000Z" },
      { id: "schedule-task-doing", owner_type: "task", owner_id: "task-doing", start_date: "2026-09-01", end_date: "2026-09-01", updated_at: "2026-08-20T01:00:00.000Z" },
      { id: "schedule-waiting-open", owner_type: "waiting", owner_id: "waiting-open", start_date: "2026-09-02", end_date: "2026-09-04", updated_at: "2026-08-20T03:00:00.000Z" },
    ],
  }));
  try {
    const all = read.toolSearchItems({});
    const stateById = new Map(all.items.map((item) => [item.id, item.status]));
    assert.deepEqual(Object.fromEntries(stateById), {
      "legacy-default": undefined,
      "legacy-open": "inbox",
      "plan-cancelled": "cancelled",
      "plan-done": "done",
      "plan-open": "todo",
      "waiting-cancelled": "cancelled",
      "waiting-open": "waiting",
      "waiting-received": "done",
      "task-done": "done",
      "task-doing": "doing",
    });
    const open = read.toolListOpenItems({});
    assert.deepEqual(ids(open), ["task-doing", "plan-open", "waiting-open", "legacy-default", "legacy-open"]);
    assert.equal(open.items.find((item) => item.id === "task-doing").planned_start, "2026-09-01");
    assert.equal(open.items.find((item) => item.id === "waiting-open").planned_end, "2026-09-04");
    assert.equal(open.items.find((item) => item.id === "legacy-default").planned_end, undefined);
  } finally {
    read.close();
  }
});

test("Wave 4 search matches exactly title, description, next_action, and waiting_for case-insensitively", () => {
  const read = context(visibleWorkspace({
    tasks: [{ id: "title", title: "Alpha Title", description: "unrelated", state: "todo", project_id: "theme-visible", updated_at: "2026-08-20T01:00:00.000Z", deleted_at: null }],
    waitings: [{ id: "description", title: "waiting", description: "Bravo Description", next_action: "unrelated", waiting_for: "someone", state: "pending", project_id: "theme-visible", updated_at: "2026-08-20T02:00:00.000Z", deleted_at: null }, { id: "next-action", title: "waiting", description: "unrelated", next_action: "Charlie Next", waiting_for: "someone", state: "pending", project_id: "theme-visible", updated_at: "2026-08-20T03:00:00.000Z", deleted_at: null }, { id: "waiting-for", title: "waiting", description: "unrelated", next_action: "unrelated", waiting_for: "Delta Waiting", state: "pending", project_id: "theme-visible", updated_at: "2026-08-20T04:00:00.000Z", deleted_at: null }],
    items: [{ id: "priority-only", title: "ordinary", description: "ordinary", status: "todo", priority: "Echo only in priority", project_id: "theme-visible", updated_at: "2026-08-20T05:00:00.000Z", deleted_at: null }],
  }));
  try {
    assert.deepEqual(ids(read.toolSearchItems({ query: "tItLe" })), ["title"]);
    assert.deepEqual(ids(read.toolSearchItems({ query: "dEsCrIpTiOn" })), ["description"]);
    assert.deepEqual(ids(read.toolSearchItems({ query: "nExT" })), ["next-action"]);
    assert.deepEqual(ids(read.toolSearchItems({ query: "dElTa" })), ["waiting-for"]);
    assert.deepEqual(ids(read.toolSearchItems({ query: "Echo only" })), []);
  } finally {
    read.close();
  }
});

test("Wave 4 AI visibility is applied before limit and hidden-first ordering does not consume the limit", () => {
  const read = context({
    themes: [visibleTheme, hiddenTheme],
    items: [
      { id: "hidden-first", title: "Hidden first", status: "todo", project_id: "theme-hidden", updated_at: "2026-08-21T04:00:00.000Z", deleted_at: null },
      { id: "visible-second", title: "Visible second", status: "todo", project_id: "theme-visible", updated_at: "2026-08-21T03:00:00.000Z", deleted_at: null },
    ],
    tasks: [], waitings: [], plan_nodes: [], schedules: [],
  });
  try {
    const result = read.toolSearchItems({ limit: 1 });
    assert.deepEqual(ids(result), ["visible-second"]);
    assert.equal(result.limit, 1);
    assert.equal(result.excluded_count, 1);
    assert.deepEqual(result.excluded_reasons, [{ type: "item", reason: "ThemeのAI公開範囲に含まれていません。", count: 1 }]);
  } finally {
    read.close();
  }
});

test("Wave 4 theme and archived filters retain the current search/list differences", () => {
  const read = context({
    themes: [visibleTheme, hiddenTheme],
    tasks: [
      { id: "visible-active", title: "same", state: "todo", project_id: "theme-visible", updated_at: "2026-08-21T01:00:00.000Z", deleted_at: null },
      { id: "visible-archived", title: "same", state: "todo", project_id: "theme-visible", updated_at: "2026-08-21T02:00:00.000Z", deleted_at: "2026-08-20T00:00:00.000Z" },
      { id: "hidden-active", title: "same", state: "todo", project_id: "theme-hidden", updated_at: "2026-08-21T03:00:00.000Z", deleted_at: null },
    ],
    items: [], waitings: [], plan_nodes: [], schedules: [],
  });
  try {
    assert.deepEqual(ids(read.toolSearchItems({ theme_id: "theme-visible" })), ["visible-active"]);
    assert.deepEqual(ids(read.toolSearchItems({ theme_id: "theme-visible", include_archived: true })), ["visible-archived", "visible-active"]);
    assert.deepEqual(ids(read.toolListOpenItems({ include_archived: true })), ["visible-active"]);
  } finally {
    read.close();
  }
});

test("Wave 4 limit defaults and clamps at the legacy context boundary", () => {
  const items = Array.from({ length: 105 }, (_, index) => ({
    id: `item-${String(index).padStart(3, "0")}`,
    title: `Item ${index}`,
    status: "todo",
    project_id: "theme-visible",
    updated_at: `2026-08-20T${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00.000Z`,
    deleted_at: null,
  }));
  const read = context(visibleWorkspace({ items }));
  try {
    for (const list of [read.toolSearchItems.bind(read), read.toolListOpenItems.bind(read)]) {
      assert.equal(list({ limit: 1 }).items.length, 1);
      assert.equal(list({ limit: 1 }).limit, 1);
      assert.equal(list({}).items.length, 20);
      assert.equal(list({}).limit, 20);
      assert.equal(list({ limit: 100 }).items.length, 100);
      assert.equal(list({ limit: 100 }).limit, 100);
      assert.equal(list({ limit: 101 }).items.length, 100);
      assert.equal(list({ limit: 101 }).limit, 100);
    }
  } finally {
    read.close();
  }
});

test("Wave 4 date sorting puts scheduled dates first, no-date items last, and keeps ties stable", () => {
  const read = context(visibleWorkspace({
    items: [
      { id: "no-date-a", title: "No date A", status: "todo", project_id: "theme-visible", updated_at: "2026-08-20T03:00:00.000Z", deleted_at: null },
      { id: "same-date-a", title: "Same date A", status: "todo", project_id: "theme-visible", updated_at: "2026-08-20T02:00:00.000Z", deleted_at: null, due_date: "2026-09-02" },
      { id: "same-date-b", title: "Same date B", status: "todo", project_id: "theme-visible", updated_at: "2026-08-20T01:00:00.000Z", deleted_at: null, due_date: "2026-09-02" },
    ],
    tasks: [{ id: "scheduled", title: "Scheduled", state: "todo", project_id: "theme-visible", updated_at: "2026-08-20T04:00:00.000Z", deleted_at: null }],
    schedules: [{ id: "scheduled-date", owner_type: "task", owner_id: "scheduled", start_date: "2026-09-01", end_date: "2026-09-01", updated_at: "2026-08-20T04:00:00.000Z" }],
  }));
  try {
    assert.deepEqual(ids(read.toolListOpenItems({})), ["scheduled", "same-date-a", "same-date-b", "no-date-a"]);
  } finally {
    read.close();
  }
});
