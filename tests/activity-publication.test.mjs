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

test("daily output includes recorded work regardless of per-item AI settings", () => {
  const { domain, input } = fixture();
  const output = buildActivityPublication(input, domain);
  assert.match(output, /実験完了/);
  assert.match(output, /精度を確認/);
  assert.match(output, /非公開の実験/);
  assert.match(output, /非公開本文/);
  assert.doesNotMatch(output, /Excluded by policy|公開範囲/);
  assert.deepEqual(domain.tasks[1].ai_visibility, []);
});

test("daily output does not require Theme AI permissions", () => {
  const { domain, input } = fixture();
  delete domain.projects[0].default_ai_visibility;
  assert.match(buildActivityPublication(input, domain), /実験完了/);
  assert.match(
    buildActivityPublication({ ...input, workspaceDefault: ["m365"] }, domain),
    /実験完了/,
  );
  assert.match(
    buildActivityPublication({ ...input, workspaceDefault: ["m365"] }, domain),
    /非公開/,
  );
});

test("daily output includes unassigned session narratives", () => {
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
  assert.match(output, /非公開session/);
  assert.match(output, /非公開result/);
});

test("publication fails closed when canonical events are unavailable", () => {
  const { domain, input } = fixture();
  delete input.changeEvents;
  assert.throws(() => buildActivityPublication(input, domain), /活動履歴を再読み込み/);
});

test("daily event output still sanitizes secrets and machine-local paths", () => {
  const { domain, input } = fixture();
  domain.change_events[0].summary = "実験結果 C:\\Users\\person\\result.csv token=abcd-secret";
  const output = buildActivityPublication(input, domain);
  assert.match(output, /実験結果/);
  assert.doesNotMatch(output, /person|abcd-secret/);
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

test("session output ignores linked-item AI settings while omitting repository metadata", () => {
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
  assert.match(buildActivityPublication(input, domain), /session narrative/);
  domain.references.pop();
  domain.change_events[1].origin = { session_id: "session" };
  assert.match(buildActivityPublication(input, domain), /session narrative/);
  assert.match(buildActivityPublication(input, domain), /session result/);
});
