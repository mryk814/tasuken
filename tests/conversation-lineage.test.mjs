import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

import { buildEntityLineage, lineageContextSelection } from "../src/shared/conversationLineage.mjs";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const { buildDerivedFromDocumentCompanion } = await importBundled(
  "src/renderer/src/features/workspace/lib/lineageOperations.ts",
);

const workspace = {
  resources: [
    { id: "chat-root", title: "元Conversation", resource_scope: "chat_ref", project_id: "theme-a", created_at: "2026-08-01T00:00:00.000Z" },
    { id: "chat-child", title: "派生Conversation", resource_scope: "chat_ref", parent_resource_id: "chat-root", project_id: "theme-a", created_at: "2026-08-05T00:00:00.000Z" },
  ],
  tasks: [
    { id: "task-1", title: "調査する", state: "todo", project_id: "theme-a", created_at: "2026-08-02T00:00:00.000Z" },
  ],
  notes: [
    { id: "note-1", title: "調査メモ", project_id: "theme-a", created_at: "2026-08-03T00:00:00.000Z" },
    { id: "note-direct", title: "AI原稿", project_id: "theme-a", created_at: "2026-08-03T01:00:00.000Z" },
  ],
  artifacts: [
    { id: "artifact-1", title: "report.pdf", filename: "report.pdf", source_type: "note", source_id: "note-1", origin_note_id: "note-1", created_at: "2026-08-04T00:00:00.000Z" },
    { id: "artifact-direct", title: "proposal.md", filename: "proposal.md", source_type: "note", source_id: "note-direct", origin_note_id: "note-direct", created_at: "2026-08-04T01:00:00.000Z" },
  ],
  references: [
    { id: "ref-task-chat", source_type: "task", source_id: "task-1", target_type: "resource", target_id: "chat-root", relation_type: "derived_from", note: "ConversationからTaskを作成", created_at: "2026-08-02T00:00:00.000Z" },
    { id: "ref-note-task", source_type: "note", source_id: "note-1", target_type: "task", target_id: "task-1", relation_type: "derived_from", note: "TaskからNoteを作成", created_at: "2026-08-03T00:00:00.000Z" },
    { id: "ref-note-direct-chat", source_type: "note", source_id: "note-direct", target_type: "resource", target_id: "chat-root", relation_type: "derived_from", note: "ConversationからNoteを作成", created_at: "2026-08-03T01:00:00.000Z" },
    { id: "ref-note-chat", source_type: "note", source_id: "note-1", target_type: "resource", target_id: "chat-root", relation_type: "mentions", note: "本文中の参照" },
  ],
};

test("Conversation lineage returns direct summary and a two-level tree without mixing references", () => {
  const lineage = buildEntityLineage(workspace, { type: "resource", id: "chat-root" }, { maxDepth: 2, maxItems: 20 });
  assert.deepEqual(lineage.summary, { task: 1, note: 1, artifact: 0, conversation: 1, other: 0 });
  assert.ok(lineage.descendants.some((item) => item.ref.id === "note-1" && item.depth === 2));
  assert.ok(lineage.descendants.some((item) => item.ref.id === "artifact-direct" && item.depth === 2));
  assert.equal(lineage.descendants.some((item) => item.relation.predicate === "mentions"), false);
  assert.ok(lineage.references.some((item) => item.ref.id === "note-1" && item.relation.predicate === "mentions"));
  const task = lineage.descendants.find((item) => item.ref.id === "task-1");
  assert.equal(task.relation.reason, "ConversationからTaskを作成");
  assert.equal(task.relation.created_at, "2026-08-02T00:00:00.000Z");
});

test("Note and Artifact can trace upstream to the originating Conversation", () => {
  const note = buildEntityLineage(workspace, { type: "note", id: "note-1" }, { maxDepth: 2 });
  assert.ok(note.ancestors.some((item) => item.ref.id === "chat-root" && item.depth === 2));
  const artifact = buildEntityLineage(workspace, { type: "artifact", id: "artifact-direct" }, { maxDepth: 2 });
  assert.ok(artifact.ancestors.some((item) => item.ref.id === "note-direct" && item.depth === 1 && item.relation.predicate === "exported_from"));
  assert.ok(artifact.ancestors.some((item) => item.ref.id === "chat-root" && item.depth === 2));
});

test("lineage traversal is cycle-safe, bounded, and exposes AI-ready path reasons", () => {
  const cyclic = {
    ...workspace,
    references: [
      ...workspace.references,
      { id: "ref-cycle", source_type: "resource", source_id: "chat-root", target_type: "note", target_id: "note-1", relation_type: "derived_from" },
    ],
  };
  const lineage = buildEntityLineage(cyclic, { type: "resource", id: "chat-root" }, { maxDepth: 2, maxItems: 2 });
  assert.ok(lineage.descendants.length <= 2);
  assert.equal(new Set(lineage.descendants.map((item) => `${item.ref.type}:${item.ref.id}`)).size, lineage.descendants.length);
  const context = lineageContextSelection(workspace, { type: "resource", id: "chat-root" }, { maxDepth: 2, maxItems: 20 });
  assert.ok(context.paths.some((path) => path.target.id === "note-1" && path.edge_ids.length === 2));
  assert.ok(context.paths.every((path) => path.reason));
  assert.equal(context.edges.some((edge) => edge.predicate === "mentions"), false);
});

test("Conversation create actions persist typed derived_from references and every primary Entity exposes the shared panel", () => {
  const drawer = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");
  const plans = readFileSync("src/renderer/src/features/workspace/lib/drawerFormPlans.ts", "utf8");
  const app = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
  const artifacts = readFileSync("src/renderer/src/features/workspace/components/artifacts.tsx", "utf8");
  assert.match(drawer, /Taskを作る/);
  assert.match(drawer, /Noteを作る/);
  assert.match(drawer, /seed=\{\{ type: "resource", id: resourceId \}\}/);
  assert.match(drawer, /seed=\{\{ type: "task", id: task\.id \}\}/);
  assert.match(drawer, /seed=\{\{ type: "note", id: note\.id \}\}/);
  assert.match(plans, /buildDerivedFromReferenceOperation\(base, "task", taskId\)/);
  assert.match(app, /buildDerivedFromDocumentCompanion\(base, String\(entity\.id\)\)/);
  assert.match(app, /companions: documentCompanions/);
  assert.match(app, /created_from_conversation/);
  assert.doesNotMatch(app, /buildSaveNoteOperations/);
  assert.match(artifacts, /seed=\{\{ type: "artifact", id: artifact\.id \}\}/);
});

test("Conversationから作るNoteはdocument:save用のReference companionを生成する", () => {
  const companion = buildDerivedFromDocumentCompanion({
    _lineage_source_type: "resource",
    _lineage_source_id: "conversation-1",
    _lineage_reference_id: "reference-note-lineage",
  }, "note-1");
  assert.deepEqual({
    action: companion.action,
    type: companion.type,
    source_type: companion.entity.source_type,
    source_id: companion.entity.source_id,
    target_type: companion.entity.target_type,
    target_id: companion.entity.target_id,
    relation_type: companion.entity.relation_type,
    reason: companion.options.reason,
  }, {
    action: "save",
    type: "reference",
    source_type: "note",
    source_id: "note-1",
    target_type: "resource",
    target_id: "conversation-1",
    relation_type: "derived_from",
    reason: "created_from_conversation",
  });
});
