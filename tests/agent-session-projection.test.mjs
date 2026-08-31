import assert from "node:assert/strict";
import test from "node:test";

import {
  agentSessionHasContent,
  agentSessionHookSourceApps,
  buildAgentSessionAssignmentOperations,
  buildAgentWorkProjection,
  groupAgentWorkProjection,
} from "../src/renderer/src/features/workspace/domain-model/agentSessionProjection.ts";
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
        request_events: [
          { observed_at: "2026-08-25T10:00:00+09:00", text: "Issue #498を進める" },
          { observed_at: "2026-08-25T10:30:00+09:00", text: "UIも確認する" },
        ],
        response_checkpoints: [
          { observed_at: "2026-08-25T11:00:00+09:00", text: "MCP workflowを実装" },
        ],
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
      {
        id: "session-same-theme-repo-b",
        started_at: "2026-08-25T13:00:00+09:00",
        status: "completed",
        client_kind: "codex",
        intent: { summary: "同じThemeの別Repositoryを確認" },
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
      {
        id: "r6",
        source_type: "agent_session",
        source_id: "session-same-theme-repo-b",
        target_type: "project",
        target_id: "theme-a",
        relation_type: "worked_on",
      },
      {
        id: "r7",
        source_type: "agent_session",
        source_id: "session-same-theme-repo-b",
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
    ["session-same-theme-repo-b", "session-other", "session-today"],
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
  assert.equal(tasken.sessionIdentity, "codex-498");
  assert.equal(tasken.topic, "Agent Session — Issue #498を進める");
  assert.equal(tasken.result, "MCP workflowを実装");
  assert.equal(tasken.requestCount, 2);
  assert.equal(tasken.responseCount, 1);
  assert.equal(tasken.assignmentIncomplete, false);
  assert.deepEqual(
    domain,
    before,
    "daily summary must remain a pure projection rather than a second source of truth",
  );
});

test("確かな空hook記録だけを畳み、通常MCP結果と自動Activityは内容判定を変えない", () => {
  const domain = domainFixture();
  const hookMetadataOnly = {
    id: "session-hook-metadata-only",
    started_at: "2026-08-25T14:30:00+09:00",
    ended_at: "2026-08-25T14:31:00+09:00",
    status: "completed",
    client_kind: "codex",
    request_events: [],
    response_checkpoints: [],
    intent: { summary: "Session lifecycle hookで開始を観測しました。" },
    outcome: {
      summary: "Session lifecycle hookが終了を観測しました（user_exit）。",
      decisions: [],
      changed_items: [],
      verification: ["collector: codex / end reason: user_exit"],
      remaining_work: [],
    },
  };
  domain.agent_sessions.push({
    id: "session-manual-no-checkpoints",
    started_at: "2026-08-25T14:30:00+09:00",
    ended_at: "2026-08-25T14:31:00+09:00",
    status: "completed",
    client_kind: "codex",
    request_events: [],
    response_checkpoints: [],
    intent: { summary: "手動MCP依頼" },
    outcome: {
      summary: "構造化した手動の結果",
      decisions: ["採用する"],
      changed_items: ["Task"],
      verification: ["確認済み"],
      remaining_work: [],
    },
  });
  domain.agent_sessions.push(hookMetadataOnly);
  domain.agent_sessions.push({
    ...hookMetadataOnly,
    id: "session-hook-with-checkpoint",
    request_events: [{ observed_at: "2026-08-25T14:32:00+09:00", text: "実際の依頼" }],
  });
  domain.agent_sessions.push({ ...hookMetadataOnly, id: "session-missing-provenance" });
  domain.ai_proposals.push(
    {
      id: "proposal-hook-accepted",
      status: "accepted",
      source_app: "tasken-session-hook:codex",
      payload_type: "agent_sessions",
      payload: { agent_sessions: [{ action: "capture", session: hookMetadataOnly }] },
    },
    {
      id: "proposal-hook-pending",
      status: "pending",
      source_app: "tasken-session-hook:codex",
      payload_type: "agent_sessions",
      payload: {
        agent_sessions: [
          {
            action: "capture",
            session: domain.agent_sessions.find(
              (session) => session.id === "session-hook-with-checkpoint",
            ),
          },
        ],
      },
    },
  );
  domain.change_events.push({
    id: "event-hook-metadata-only",
    entity_type: "agent_session",
    entity_id: hookMetadataOnly.id,
    changed_at: "2026-08-25T14:31:00+09:00",
    change_type: "created",
    source: "ai",
    origin: { kind: "agent", session_id: hookMetadataOnly.id },
    summary: "Agent Sessionを記録",
  });

  const hookSourceApps = agentSessionHookSourceApps(domain.ai_proposals);
  const rows = new Map(
    buildAgentWorkProjection(domain, { limit: 20 }).map((row) => [row.session.id, row]),
  );
  const metadataOnly = rows.get(hookMetadataOnly.id);

  assert.equal(
    agentSessionHasContent(metadataOnly.session, hookSourceApps.get(metadataOnly.session.id)),
    false,
  );
  assert.equal(metadataOnly.presentation, "record");
  assert.equal(rows.get("session-manual-no-checkpoints").presentation, "content");
  assert.equal(rows.get("session-hook-with-checkpoint").presentation, "record");
  const requestOnly = rows.get("session-hook-with-checkpoint").session;
  requestOnly.response_checkpoints = [
    { observed_at: "2026-08-25T14:33:00+09:00", text: "依頼内容を確認しました。" },
  ];
  assert.equal(agentSessionHasContent(requestOnly, hookSourceApps.get(requestOnly.id)), true);
  assert.equal(rows.get("session-missing-provenance").presentation, "content");
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
    ["session-handoff", "session-same-theme-repo-b", "session-today"],
  );
  assert.equal(rows[0].unresolved, true);

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
    ["session-same-theme-repo-b", "session-other"],
  );
});

test("作業の引き継ぎと関連付け不足を別々に判定し、carryover onlyは当日を含めない", () => {
  const domain = domainFixture();
  domain.agent_sessions.push({
    id: "session-unassigned",
    started_at: "2026-08-25T14:00:00+09:00",
    status: "completed",
    client_kind: "codex",
    intent: { summary: "関連付け前の作業" },
  });
  const rows = buildAgentWorkProjection(domain, { date: "2026-08-25" });
  const other = rows.find((row) => row.session.id === "session-other");
  assert.equal(other.unresolved, false);
  assert.equal(other.assignmentIncomplete, true);
  const unassigned = rows.find((row) => row.session.id === "session-unassigned");
  assert.equal(unassigned.unresolved, false);
  assert.equal(unassigned.assignmentIncomplete, true);

  const handoff = buildAgentWorkProjection(domain, {
    date: "2026-08-25",
    includeUnresolved: true,
  }).find((row) => row.session.id === "session-handoff");
  assert.equal(handoff.unresolved, true);
  assert.equal(handoff.assignmentIncomplete, true);

  const carryover = buildAgentWorkProjection(domain, {
    date: "2026-08-25",
    carryoverOnly: true,
  });
  assert.deepEqual(
    carryover.map((row) => row.session.id),
    ["session-handoff"],
  );
});

test("関連付けは選択したTheme/Repositoryへのworked_on referenceだけを保存する", () => {
  let serial = 0;
  const operations = buildAgentSessionAssignmentOperations("session-unassigned", {
    themeId: "theme-a",
    repositoryContextId: "repo-a",
    recordedAt: "2026-08-25T12:00:00+09:00",
    idFactory: () => `assignment-${++serial}`,
  });
  assert.deepEqual(
    operations.map(({ entity }) => ({
      id: entity.id,
      source: [entity.source_type, entity.source_id],
      target: [entity.target_type, entity.target_id],
      relation: entity.relation_type,
      predicate: entity.predicate,
      origin: entity.origin,
    })),
    [
      {
        id: "assignment-1",
        source: ["agent_session", "session-unassigned"],
        target: ["project", "theme-a"],
        relation: "worked_on",
        predicate: "worked_on",
        origin: "user",
      },
      {
        id: "assignment-2",
        source: ["agent_session", "session-unassigned"],
        target: ["repository_context", "repo-a"],
        relation: "worked_on",
        predicate: "worked_on",
        origin: "user",
      },
    ],
  );
  assert.deepEqual(
    buildAgentSessionAssignmentOperations("session-unassigned", {
      themeId: "theme-a",
      repositoryContextId: "repo-a",
      existingThemeIds: ["theme-a"],
      existingRepositoryContextIds: ["repo-a"],
    }),
    [],
  );
});

test("DebriefはAI作業をTheme単位に整理し、Repositoryと未割当を保つ", () => {
  const rows = buildAgentWorkProjection(domainFixture(), { date: "2026-08-25" });
  const groups = groupAgentWorkProjection(rows);

  assert.deepEqual(
    groups.map((group) => ({
      theme: group.themeLabel,
      repository: group.repositoryLabel,
      sessions: group.rows.map((row) => row.session.id),
    })),
    [
      { theme: "Tasken", repository: "other", sessions: ["session-same-theme-repo-b"] },
      { theme: "Tasken", repository: "tasuken", sessions: ["session-today"] },
      { theme: "Theme未割当", repository: "other", sessions: ["session-other"] },
    ],
  );
});

test("AI Inbox stays beside Inbox and keeps Settings as the utility tool", () => {
  assert.deepEqual(crossNavigation, ["inbox", "ai-io", "debrief", "timeline"]);
  assert.deepEqual(toolNavigation, ["settings", "knowledge"]);
});
