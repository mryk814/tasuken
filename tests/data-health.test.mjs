import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DataHealthEvaluator, buildDataHealth, DATA_HEALTH_STATE_SCHEMA } from "../src/shared/dataHealth.mjs";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";

test("Data Healthはcanonical/link/relation/AI Pack anomalyをprivate pathなしで投影する (#296)", () => {
  const workspace = {
    projects: [{ id: "theme-1", name: "Theme", ai_visibility: ["m365"], ai_summary: "Theme", ai_freshness: "current" }],
    notes: [{
      id: "note-1",
      title: "Context",
      body_markdown: "[[task:missing-task|Missing]]",
      project_id: "theme-1",
      ai_visibility: ["m365"],
      ai_summary: "Summary",
      ai_freshness: "current",
      properties_json: { canonical_markdown: { canonical_path: "C:\\Users\\private\\secret.md", sync_state: "external_ahead" } },
    }],
    tasks: [
      { id: "task-a", title: "Duplicate", project_id: "theme-1", ai_visibility: ["coding_agent"], ai_summary: "A", ai_freshness: "stale" },
      { id: "task-b", title: "Duplicate", project_id: "theme-1", ai_visibility: ["coding_agent"], ai_summary: "B", ai_freshness: "current" },
    ],
    references: [{ id: "ref-broken", source_type: "task", source_id: "task-a", target_type: "note", target_id: "missing-note", relation_type: "related_to" }],
    knowledge_nodes: [{ id: "claim-1", title: "Isolated", node_type: "claim", theme_id: "theme-1" }],
    canonical_root_status: { notes: { status: "broken", absolutePath: "C:\\private" } },
  };
  const result = buildDataHealth(workspace, {
    generatedAt: "2026-08-09T00:00:00.000Z",
    themeAiPackStatuses: [
      { themeId: "theme-1", state: "dirty", packDirectory: "C:\\Users\\private\\AI Pack" },
      { themeId: "theme-2", state: "recovery_required", error: "C:\\private" },
    ],
  });
  const rules = new Set(result.issues.map((issue) => issue.ruleId));
  for (const rule of ["broken_internal_link", "broken_relation", "canonical_markdown_anomaly", "ai_pack_stale", "ai_pack_anomaly", "isolated_entity", "duplicate_candidate", "stale_context"]) {
    assert.ok(rules.has(rule), `missing rule: ${rule}`);
  }
  assert.doesNotMatch(JSON.stringify(result), /C:\\\\Users|C:\\\\private|secret\.md|packDirectory|absolutePath/);
  assert.equal(result.issues.find((issue) => issue.ruleId === "ai_pack_stale").severity, "warning");
  assert.equal(result.issues.find((issue) => issue.ruleId === "ai_pack_anomaly").severity, "error");
  assert.deepEqual(result.issues.find((issue) => issue.ruleId === "canonical_markdown_anomaly" && issue.ref.id === "note-1").metadata, { syncState: "external_ahead" });
});

test("Data Health evaluatorは通常Entity 1件更新時にその1件だけ再評価する (#296)", () => {
  const evaluator = new DataHealthEvaluator();
  const tasks = Array.from({ length: 100 }, (_, index) => ({
    id: `task-${index}`,
    title: `Task ${index}`,
    state: "todo",
    version: 1,
    ai_visibility: ["coding_agent"],
    ai_summary: `Summary ${index}`,
    ai_freshness: "current",
  }));
  const first = evaluator.evaluate({ tasks });
  assert.deepEqual(first.evaluation, { evaluatedEntities: 100, reusedEntities: 0, totalEntities: 100 });
  const changed = tasks.map((task, index) => index === 42 ? { ...task, version: 2, ai_summary: "Changed" } : task);
  const second = evaluator.evaluate({ tasks: changed });
  assert.deepEqual(second.evaluation, { evaluatedEntities: 1, reusedEntities: 99, totalEntities: 100 });
});

test("Data Health stateはtyped repository CASでignoreを再読込しstale/concurrent更新を拒否する (#296)", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-data-health-state-"));
  const dbPath = path.join(directory, "workspace.sqlite");
  const first = new WorkspaceDatabase(dbPath);
  try {
    assert.deepEqual(first.getDataHealthState(), { schema: DATA_HEALTH_STATE_SCHEMA, revision: 0, updatedAt: "", issues: {} });
    const saved = first.setDataHealthState(0, {
      updatedAt: "2026-08-09T01:00:00.000Z",
      issues: { "issue-1": { state: "ignored", updatedAt: "2026-08-09T01:00:00.000Z", note: "known" } },
    });
    assert.equal(saved.revision, 1);
    assert.throws(() => first.setDataHealthState(0, { issues: {} }), /revision conflict/);

    const second = new WorkspaceDatabase(dbPath);
    try {
      assert.equal(second.getDataHealthState().issues["issue-1"].state, "ignored");
      const third = new WorkspaceDatabase(dbPath);
      try {
        second.setDataHealthState(1, { updatedAt: "2026-08-09T02:00:00.000Z", issues: {} });
        assert.throws(() => third.setDataHealthState(1, { updatedAt: "2026-08-09T02:00:00.000Z", issues: {} }), /revision conflict/);
      } finally {
        third.db.close();
      }
    } finally {
      second.db.close();
    }
  } finally {
    first.db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
