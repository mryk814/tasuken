import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: [path.resolve("src/renderer/src/features/workspace/lib/activityPublication.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { buildActivityPublication } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

function fixture() {
  const domain = {
    projects: [{ id: "public-theme", name: "材料評価", default_ai_visibility: ["m365"] }],
    tasks: [
      { id: "public-task", title: "実験完了", project_id: "public-theme" },
      { id: "private-task", title: "非公開の実験", project_id: "public-theme", ai_visibility: [] },
    ],
    waitings: [],
    notes: [],
    resources: [],
    knowledge_nodes: [],
    capture_entries: [],
    working_copies: [],
    agent_sessions: [],
    work_receipts: [],
    ai_proposals: [],
    repository_contexts: [],
    references: [],
    change_events: ["public-task", "private-task"].map((id) => ({
      id: `event-${id}`,
      entity_type: "task",
      entity_id: id,
      event_kind: "task_completed",
      occurred_at: "2026-09-05T10:00:00+09:00",
      summary: id === "private-task" ? "非公開本文" : "精度を確認",
      entity_ref: { type: "task", id },
      theme_ref: { kind: "theme", id: "public-theme" },
    })),
  };
  return {
    domain,
    input: {
      date: "2026-09-05",
      domain,
      themes: domain.projects,
      statusUpdates: [],
      changeEvents: domain.change_events,
    },
  };
}

test("publication includes permitted work and excludes local-only titles and summaries", () => {
  const { domain, input } = fixture();
  const output = buildActivityPublication(input, domain);
  assert.match(output, /実験完了/);
  assert.match(output, /精度を確認/);
  assert.doesNotMatch(output, /非公開/);
  assert.match(output, /Excluded by policy/);
  assert.deepEqual(domain.tasks[1].ai_visibility, []);
});

test("workspace default is honored but never overrides an explicit private item", () => {
  const { domain, input } = fixture();
  delete domain.projects[0].default_ai_visibility;
  assert.doesNotMatch(buildActivityPublication(input, domain), /実験完了/);
  assert.match(
    buildActivityPublication({ ...input, workspaceDefault: ["m365"] }, domain),
    /実験完了/,
  );
  assert.doesNotMatch(
    buildActivityPublication({ ...input, workspaceDefault: ["m365"] }, domain),
    /非公開/,
  );
});

test("unassigned session narratives are not implicitly published by workspace defaults", () => {
  const { domain, input } = fixture();
  domain.agent_sessions.push({
    id: "session",
    started_at: "2026-09-05T10:00:00+09:00",
    ended_at: "2026-09-05T11:00:00+09:00",
    client_kind: "codex",
    intent: { summary: "非公開session" },
    outcome: { summary: "非公開result", remaining_work: [] },
  });
  const output = buildActivityPublication({ ...input, workspaceDefault: ["m365"] }, domain);
  assert.doesNotMatch(output, /非公開session|非公開result/);
  assert.match(output, /AI作業 1件/);
});

test("publication fails closed when canonical events are unavailable", () => {
  const { domain, input } = fixture();
  delete input.changeEvents;
  assert.throws(() => buildActivityPublication(input, domain), /活動履歴を再読み込み/);
});

test("the complete daily publication includes the exact accepted result", () => {
  const { domain, input } = fixture();
  domain.work_receipts.push({
    id: "accepted-receipt",
    task_id: "public-task",
    summary: "検証用データで精度93％",
    completed_items: ["条件AとBを比較"],
    verification: ["独立データで確認"],
    remaining_work: ["別装置で再検証"],
  });
  domain.change_events[0].metadata = { work_action: "accepted" };
  domain.change_events[0].work_receipt_ref = { type: "work_receipt", id: "accepted-receipt" };
  const output = buildActivityPublication(input, domain);
  assert.match(output, /採用済みの作業結果/);
  assert.match(output, /検証用データで精度93％/);
  assert.match(output, /別装置で再検証/);
});

test("a theme-assigned session cannot leak work on a private Task through its narrative", () => {
  const { domain, input } = fixture();
  domain.agent_sessions.push({
    id: "session",
    started_at: "2026-09-05T10:00:00+09:00",
    ended_at: "2026-09-05T11:00:00+09:00",
    client_kind: "codex",
    intent: { summary: "session narrative" },
    outcome: { summary: "session result", remaining_work: [] },
  });
  domain.references.push({
    id: "assignment",
    source_type: "agent_session",
    source_id: "session",
    target_type: "project",
    target_id: "public-theme",
    relation_type: "worked_on",
  });
  domain.change_events[0].origin = { session_id: "session" };
  assert.match(buildActivityPublication(input, domain), /session narrative/);
  domain.repository_contexts.push({
    id: "private-repo",
    label: "private-repo-label",
    ai_visibility: [],
  });
  domain.references.push({
    id: "repo-reference",
    source_type: "agent_session",
    source_id: "session",
    target_type: "repository_context",
    target_id: "private-repo",
    relation_type: "worked_on",
  });
  assert.doesNotMatch(buildActivityPublication(input, domain), /private-repo-label/);
  domain.notes.push({ id: "private-note", title: "private-note-title", ai_visibility: [] });
  domain.references.push({
    id: "note-reference",
    source_type: "agent_session",
    source_id: "session",
    target_type: "note",
    target_id: "private-note",
    relation_type: "context",
  });
  assert.doesNotMatch(buildActivityPublication(input, domain), /session narrative/);
  domain.references.pop();
  domain.change_events[1].origin = { session_id: "session" };
  assert.doesNotMatch(buildActivityPublication(input, domain), /session narrative|session result/);
});
