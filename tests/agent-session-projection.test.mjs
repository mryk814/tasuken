import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentWorkProjection } from "../src/renderer/src/features/workspace/lib/agentSessionProjection.ts";
import { crossNavigation, toolNavigation } from "../src/renderer/src/pages/routes.ts";

function domainFixture() {
  return {
    projects: [
      { id: "theme-a", name: "Tasken", state: "active" },
      { id: "theme-b", name: "Other", state: "active" },
    ],
    repository_contexts: [
      { id: "repo-a", label: "tasuken", provider: "github", repository_slug: "mryk814/tasuken" },
      { id: "repo-b", label: "other", provider: "gitlab", repository_slug: "team/other" },
    ],
    working_copies: [
      {
        id: "copy-a",
        repository_context_id: "repo-a",
        device_id: "home",
        storage_root_id: "projects",
        active: true,
      },
    ],
    agent_sessions: [
      {
        id: "session-today",
        started_at: "2026-08-25T10:00:00+09:00",
        ended_at: "2026-08-25T11:00:00+09:00",
        status: "completed",
        client_kind: "codex",
        source_session_id: "codex-498",
        intent: { summary: "Issue #498を進める" },
        outcome: {
          summary: "MCP workflowを実装",
          decisions: [],
          changed_items: ["Agent Session"],
          verification: ["tests"],
          remaining_work: [],
        },
      },
      {
        id: "session-handoff",
        started_at: "2026-08-24T09:00:00+09:00",
        ended_at: "2026-08-24T10:00:00+09:00",
        status: "blocked",
        client_kind: "cursor",
        source_session_id: "cursor-497",
        intent: { summary: "UIを調査" },
        outcome: {
          summary: "描画確認待ち",
          decisions: [],
          changed_items: [],
          verification: [],
          remaining_work: ["Windowsで確認"],
        },
      },
      {
        id: "session-other",
        started_at: "2026-08-25T12:00:00+09:00",
        status: "active",
        client_kind: "claude_code",
        intent: { summary: "別repoで作業" },
      },
    ],
    tasks: [{ id: "task-a", title: "Agent Session", state: "doing", project_id: "theme-a" }],
    references: [
      {
        id: "r1",
        source_type: "agent_session",
        source_id: "session-today",
        target_type: "project",
        target_id: "theme-a",
        relation_type: "worked_on",
      },
      {
        id: "r2",
        source_type: "agent_session",
        source_id: "session-today",
        target_type: "task",
        target_id: "task-a",
        relation_type: "worked_on",
      },
      {
        id: "r3",
        source_type: "agent_session",
        source_id: "session-today",
        target_type: "working_copy",
        target_id: "copy-a",
        relation_type: "executed_in",
      },
      {
        id: "r4",
        source_type: "agent_session",
        source_id: "session-handoff",
        target_type: "project",
        target_id: "theme-a",
        relation_type: "worked_on",
      },
      {
        id: "r5",
        source_type: "agent_session",
        source_id: "session-other",
        target_type: "repository_context",
        target_id: "repo-b",
        relation_type: "worked_on",
      },
    ],
    work_receipts: [
      {
        id: "receipt-a",
        task_id: "task-a",
        executor_kind: "ai_agent",
        executor_label: "Codex",
        reported_at: "2026-08-25T11:00:00+09:00",
        summary: "Phase 3完了",
        completed_items: [],
        changed_or_created_items: [],
        source_session: "codex-498",
        external_references: [
          {
            kind: "pull_request",
            provider: "github",
            display_label: "PR #499",
            url: "https://github.com/mryk814/tasuken/pull/499",
            external_id: "499",
          },
        ],
      },
    ],
    change_events: [
      {
        id: "event-a",
        entity_type: "task",
        entity_id: "task-a",
        changed_at: "2026-08-25T10:30:00+09:00",
        change_type: "updated",
        source: "ai",
        origin: { kind: "agent", session_id: "session-today" },
        summary: "Taskを更新",
      },
    ],
    capture_entries: [],
    waitings: [],
    plan_nodes: [],
    schedules: [],
    notes: [],
    resources: [],
    sketches: [],
    knowledge_nodes: [],
    task_dependencies: [],
    plan_dependencies: [],
    knowledge_edges: [],
    ai_proposals: [],
    artifacts: [],
  };
}

test("Tasken Debrief evidence derives today's cross-theme/repository AI work and linked evidence", () => {
  const domain = domainFixture();
  const before = structuredClone(domain);
  const rows = buildAgentWorkProjection(domain, { date: "2026-08-25" });

  assert.deepEqual(
    rows.map((row) => row.session.id),
    ["session-other", "session-today"],
  );
  const tasken = rows.find((row) => row.session.id === "session-today");
  assert.deepEqual(
    tasken.themes.map((theme) => theme.id),
    ["theme-a"],
  );
  assert.deepEqual(
    tasken.repositories.map((repo) => repo.id),
    ["repo-a"],
  );
  assert.deepEqual(
    tasken.tasks.map((task) => task.id),
    ["task-a"],
  );
  assert.deepEqual(
    tasken.receipts.map((receipt) => receipt.id),
    ["receipt-a"],
  );
  assert.deepEqual(
    tasken.activities.map((event) => event.id),
    ["event-a"],
  );
  assert.deepEqual(
    domain,
    before,
    "daily summary must remain a pure projection rather than a second source of truth",
  );
});

test("unresolved handoff stays visible on the next day and Theme/repository filters remain independent", () => {
  const domain = domainFixture();
  const rows = buildAgentWorkProjection(domain, {
    date: "2026-08-25",
    themeId: "theme-a",
    includeUnresolved: true,
  });
  assert.deepEqual(
    rows.map((row) => row.session.id),
    ["session-today", "session-handoff"],
  );
  assert.equal(rows[1].unresolved, true);

  const limitedRows = buildAgentWorkProjection(domain, {
    date: "2026-08-25",
    includeUnresolved: true,
    limit: 2,
  });
  assert.equal(limitedRows.length, 2);
  assert.ok(
    limitedRows.some((row) => row.session.id === "session-handoff"),
    "the limit must reserve room for an older unresolved handoff",
  );

  const repoRows = buildAgentWorkProjection(domain, { repositoryContextId: "repo-b" });
  assert.deepEqual(
    repoRows.map((row) => row.session.id),
    ["session-other"],
  );
});

test("AI Inbox stays beside Inbox and keeps Settings as the utility tool", () => {
  assert.deepEqual(crossNavigation, ["inbox", "ai-io", "debrief", "timeline"]);
  assert.deepEqual(toolNavigation, ["settings", "knowledge"]);
});
