import assert from "node:assert/strict";
import fs, { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { build } from "esbuild";
import { previewTaskCoding, previewThemeCoding } from "../src/shared/aiContextPreview.mjs";

async function importWorkspaceService() {
  const outputDirectory = mkdtempSync(path.join(os.tmpdir(), "tasken-context-preview-service-bundle-"));
  const outputFile = path.join(outputDirectory, "workspaceService.mjs");
  await build({
    entryPoints: [path.resolve("src/main/services/workspaceService.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: outputFile,
    logLevel: "silent",
    plugins: [{
      name: "electron-mock",
      setup(buildApi) {
        buildApi.onResolve({ filter: /^electron$/ }, () => ({ path: "electron-mock", namespace: "electron-mock" }));
        buildApi.onLoad({ filter: /.*/, namespace: "electron-mock" }, () => ({ contents: "export const app={getPath:()=>\"\"}; export class BrowserWindow{}; export const clipboard={}; export const dialog={}; export const nativeImage={}; export const shell={openPath:async()=>\"\"};", loader: "js" }));
        buildApi.onResolve({ filter: /^adm-zip$/ }, () => ({ path: "adm-zip-mock", namespace: "adm-zip-mock" }));
        buildApi.onLoad({ filter: /.*/, namespace: "adm-zip-mock" }, () => ({ contents: "export default class AdmZip {}", loader: "js" }));
        buildApi.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: "better-sqlite3-mock", namespace: "better-sqlite3-mock" }));
        buildApi.onLoad({ filter: /.*/, namespace: "better-sqlite3-mock" }, () => ({ contents: "export default class Database { constructor() { throw new Error('database path is not used by Core Context Preview'); } }", loader: "js" }));
      },
    }],
  });
  return import(pathToFileURL(outputFile).href);
}

const { WorkspaceService } = await importWorkspaceService();

function fixtureRepository() {
  const workspace = {
    projects: [{ id: "theme-1", name: "Theme", state: "active", ai_visibility: ["m365", "coding_agent"], ai_summary: "Theme summary", ai_freshness: "current", ai_authority: "user_confirmed" }],
    tasks: [{ id: "task-1", title: "Task", state: "todo", project_id: "theme-1", ai_visibility: ["m365", "coding_agent"], ai_summary: "Task summary", ai_freshness: "current", ai_authority: "user_confirmed" }],
    notes: [{ id: "note-1", title: "Context", project_id: "theme-1", body_markdown: "Context", ai_visibility: ["coding_agent"], ai_summary: "Note summary", ai_freshness: "current", ai_authority: "user_confirmed" }],
    references: [{ id: "ref-1", source_type: "task", source_id: "task-1", target_type: "note", target_id: "note-1", relation_type: "related_to", status: "asserted" }],
    change_events: [], repository_contexts: [], work_receipts: [], knowledge_nodes: [], knowledge_edges: [],
  };
  const keyByType = { project: "projects", theme: "themes", task: "tasks", note: "notes", reference: "references", change_event: "change_events", repository_context: "repository_contexts", work_receipt: "work_receipts", knowledge_node: "knowledge_nodes", knowledge_edge: "knowledge_edges" };
  return {
    workspace,
    loadWorkspace: () => structuredClone(workspace),
    list: (type) => structuredClone(workspace[keyByType[type]] || []),
    get: (type, id) => structuredClone((workspace[keyByType[type]] || []).find((entry) => entry.id === id) || null),
    getPreference: (key) => key === "aiVisibilityDefault" ? ["coding_agent"] : "",
    setPreference: () => true,
    getDataHealthState: () => ({ schema: "tasken-data-health-state/v1", revision: 0, updatedAt: "", issues: {} }),
    setDataHealthState: () => true,
  };
}

test("WorkspaceService PreviewはCore context_selectionとTheme AI Pack planをそのままadapterへ通す (#296)", async () => {
  const repository = fixtureRepository();
  const taskResponse = {
    ai_audience: "coding_agent",
    task: repository.workspace.tasks[0],
    theme: repository.workspace.projects[0],
    related: { notes: repository.workspace.notes, conversations: [], resources: [], artifacts: [], activity: [], work_receipts: [] },
  };
  const themeResponse = {
    ai_audience: "coding_agent",
    themes: repository.workspace.projects,
    open_items: repository.workspace.tasks.map((entry) => ({ ...entry, entity_type: "task" })),
    recent_notes: repository.workspace.notes,
    repository_contexts: [],
    knowledge: { knowledge_nodes: [], knowledge_edges: [] },
  };
  const calls = [];
  const coreClient = {
    getTaskContext: async (request) => { calls.push(["task", request]); return taskResponse; },
    getThemeContext: async (request) => { calls.push(["theme", request]); return themeResponse; },
  };
  const service = new WorkspaceService(repository, mkdtempSync(path.join(os.tmpdir(), "tasken-preview-userdata-")), () => "2026-08-09T00:00:00.000Z", coreClient);
    const task = await service.getAiContextPreview({ audience: "coding_agent", scope: { type: "task", id: "task-1" } });
    assert.deepEqual(task.preview, previewTaskCoding(taskResponse));

    const theme = await service.getAiContextPreview({ audience: "coding_agent", scope: { type: "theme", id: "theme-1" } });
    assert.deepEqual(theme.preview, previewThemeCoding(themeResponse));
    assert.deepEqual(calls, [["task", { task_id: "task-1" }], ["theme", { theme_id: "theme-1" }]]);

    const m365Theme = await service.getAiContextPreview({ audience: "m365", scope: { type: "theme", id: "theme-1" } });
    const m365Task = await service.getAiContextPreview({ audience: "m365", scope: { type: "task", id: "task-1" } });
    assert.equal(m365Theme.preview.schema, "tasken-ai-context-preview/v1");
    assert.deepEqual(m365Task.preview, m365Theme.preview);
    assert.deepEqual(m365Task.effectiveScope, { type: "theme", id: "theme-1" });
    assert.equal(m365Task.includedInEffectiveScope, true);
});

test("WorkspaceService Previewはraw Core/discovery errorをRendererへ公開しない (#296)", async () => {
  const repository = fixtureRepository();
  const coreClient = {
    getTaskContext: async () => { throw new Error("C:\\Users\\alice\\private\\tasken-core.json"); },
    getThemeContext: async () => { throw new Error("unused"); },
  };
  const service = new WorkspaceService(repository, "C:\\Users\\alice\\private", undefined, coreClient);
  const result = await service.getAiContextPreview({ audience: "coding_agent", scope: { type: "task", id: "task-1" } });
  assert.equal(result.state, "error");
  assert.doesNotMatch(result.error, /C:\\Users|workspace\.sqlite|alice|private/);
});

test("Data Health CAS競合はraw DB errorをRendererへ公開しない (#296)", () => {
  const repository = fixtureRepository();
  const service = new WorkspaceService(repository, mkdtempSync(path.join(os.tmpdir(), "tasken-health-userdata-")), () => "2026-08-09T00:00:00.000Z");
  const health = service.getDataHealth({ state: "all" });
  assert.ok(health.issues.length > 0);
  repository.setDataHealthState = () => { throw new Error("Data Health state revision conflict at C:\\Users\\alice\\workspace.sqlite"); };
  assert.throws(
    () => service.setDataHealthIssueState({ issueId: health.issues[0].id, state: "ignored", expectedRevision: health.stateRevision }),
    (error) => {
      assert.match(error.message, /別画面で更新/);
      assert.doesNotMatch(error.message, /C:\\Users|workspace\.sqlite|revision conflict/);
      return true;
    },
  );
});
