import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { build } from "esbuild";

import { ReadOnlyTaskenContext } from "../src/main/mcp/readOnlyContext.mjs";

const bundled = await build({
  stdin: {
    contents: `
      export { ContentDetailQueryService } from "./src/main/core/services/contentDetailQueryService.ts";
      export { WorkspaceContentDetailReadAdapter } from "./src/main/infrastructure/sqlite/workspaceContentDetailReadAdapter.ts";
      export {
        getNoteRequestSchema, getNoteResponseSchema,
        getConversationRequestSchema, getConversationResponseSchema,
        getArtifactMetadataRequestSchema, getArtifactMetadataResponseSchema,
      } from "./src/shared/contracts/task/contentDetailQueries.ts";
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
  ContentDetailQueryService,
  WorkspaceContentDetailReadAdapter,
  getNoteRequestSchema,
  getNoteResponseSchema,
  getConversationRequestSchema,
  getConversationResponseSchema,
  getArtifactMetadataRequestSchema,
  getArtifactMetadataResponseSchema,
} = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const now = "2026-08-21T00:00:00.000Z";

function fixture() {
  const visibleTheme = {
    id: "theme-visible",
    name: "Visible",
    default_ai_visibility: ["coding_agent"],
    updated_at: now,
  };
  const hiddenTheme = {
    id: "theme-hidden",
    name: "Hidden",
    default_ai_visibility: ["m365"],
    updated_at: now,
  };
  return {
    themes: [visibleTheme, hiddenTheme],
    notes: [
      {
        id: "note-visible",
        title: "Visible Note",
        body_markdown: "N".repeat(100_001),
        note_type: "decision",
        project_id: visibleTheme.id,
        version: 4,
        created_at: "2026-08-20T00:00:00.000Z",
        updated_at: now,
      },
      {
        id: "note-hidden",
        title: "Hidden Note",
        body_markdown: "HIDDEN_NOTE_BODY",
        project_id: hiddenTheme.id,
        updated_at: now,
      },
      {
        id: "note-archived",
        title: "Archived Note",
        body_markdown: "archived body",
        project_id: visibleTheme.id,
        deleted_at: now,
        updated_at: now,
      },
    ],
    resources: [
      {
        id: "conversation-visible",
        title: "Chat Ref",
        description: "D".repeat(2_001),
        body_markdown: "conversation body",
        url: "https://alice:secret@example.com/chat/1?token=URL_SECRET#message",
        resource_scope: "chat_ref",
        message_count: 0,
        source_format: "markdown",
        project_id: visibleTheme.id,
        version: 2,
        updated_at: now,
      },
      {
        id: "resource-not-chat",
        title: "Not Chat",
        body_markdown: "should not match",
        resource_scope: "note",
        project_id: visibleTheme.id,
        updated_at: now,
      },
    ],
    artifacts: [{
      id: "artifact-visible",
      title: "Artifact",
      filename: "report.json",
      file_type: "json",
      mime_type: "application/json",
      file_size: 42,
      storage_mode: "managed",
      source_type: "task",
      source_id: "task-1",
      origin_note_id: "note-visible",
      generated_by: "Codex",
      description: "Artifact metadata",
      stored_path: "C:/private/report.json",
      original_path: "/home/private/source.json",
      body: "EXTERNAL_FILE_CONTENT_SENTINEL",
      project_id: visibleTheme.id,
      updated_at: now,
    }],
  };
}

class FixturePersistence {
  constructor(workspace) {
    this.workspace = workspace;
    this.calls = [];
  }

  list(type, includeDeleted = false) {
    this.calls.push({ operation: "list", type, includeDeleted });
    const collection = { theme: "themes", note: "notes", resource: "resources", artifact: "artifacts" }[type];
    return (this.workspace[collection] || []).filter((record) => includeDeleted || !record.deleted_at);
  }

  getPreference(key) {
    this.calls.push({ operation: "getPreference", key });
    return ["coding_agent"];
  }
}

function serviceFixture() {
  const workspace = fixture();
  const persistence = new FixturePersistence(workspace);
  const adapter = new WorkspaceContentDetailReadAdapter(persistence);
  return { workspace, persistence, service: new ContentDetailQueryService(adapter) };
}

test("Wave 5 content detail service preserves legacy Note/Conversation/Artifact projections", () => {
  const workspace = fixture();
  const legacy = new ReadOnlyTaskenContext("wave5-content.sqlite", {
    workspace,
    aiVisibilityDefault: ["coding_agent"],
  });
  const { service } = serviceFixture();
  try {
    for (const request of [
      { note_id: "note-visible", max_text_length: 8 },
      { conversation_id: "conversation-visible", max_text_length: 12 },
      { artifact_id: "artifact-visible" },
      { note_id: "note-hidden" },
      { note_id: "note-archived", include_archived: false },
      { note_id: "note-archived", include_archived: true },
      { note_id: "missing" },
    ]) {
      const expected = request.note_id
        ? legacy.toolGetNote(request)
        : request.conversation_id
          ? legacy.toolGetConversation(request)
          : legacy.toolGetArtifactMetadata(request);
      const actual = request.note_id
        ? service.getNote(request)
        : request.conversation_id
          ? service.getConversation(request)
          : service.getArtifactMetadata(request);
      assert.deepEqual(actual, expected, JSON.stringify(request));
    }
  } finally {
    legacy.close();
  }
});

test("Wave 5 preserves detail budgets, Chat Ref URL policy, and Artifact path/content privacy", () => {
  const { service } = serviceFixture();
  const noteDefault = service.getNote({ note_id: "note-visible" });
  assert.equal(noteDefault.note.body_markdown.length, 50_000);
  assert.equal(noteDefault.truncated, true);
  const noteMaximum = service.getNote({ note_id: "note-visible", max_text_length: 100_000 });
  assert.equal(noteMaximum.note.body_markdown.length, 100_000);
  assert.equal(noteMaximum.truncated, true);

  const conversation = service.getConversation({ conversation_id: "conversation-visible" });
  assert.equal(conversation.conversation.source_url, "https://example.com/chat/1");
  assert.equal(conversation.conversation.message_count, null);
  assert.equal(conversation.conversation.description.length, 2_003);

  const artifact = service.getArtifactMetadata({ artifact_id: "artifact-visible" });
  assert.equal(artifact.external_file_content_included, false);
  assert.equal("stored_path" in artifact.artifact, false);
  assert.equal("original_path" in artifact.artifact, false);
  assert.equal("body" in artifact.artifact, false);
  assert.doesNotMatch(JSON.stringify(artifact), /EXTERNAL_FILE_CONTENT_SENTINEL|C:\\private|\/home\/private/);
});

test("Wave 5 read adapter remains narrow and does not invoke a write API", () => {
  const workspace = fixture();
  const persistence = new FixturePersistence(workspace);
  const adapter = new WorkspaceContentDetailReadAdapter(persistence);
  assert.equal(adapter.list("note", false).length, 2);
  assert.equal(adapter.list("note", true).length, 3);
  assert.deepEqual(adapter.workspaceAiVisibilityDefault(), ["coding_agent"]);
  assert.deepEqual(persistence.calls, [
    { operation: "list", type: "note", includeDeleted: false },
    { operation: "list", type: "note", includeDeleted: true },
    { operation: "getPreference", key: "aiVisibilityDefault" },
  ]);
  assert.equal("save" in persistence, false);
});

test("Wave 5 shared request/response contracts are strict at the detail boundary", () => {
  assert.equal(getNoteRequestSchema.safeParse({ note_id: "note-1", unexpected: true }).success, false);
  assert.equal(getConversationRequestSchema.safeParse({ conversation_id: "conversation-1", unexpected: true }).success, false);
  assert.equal(getArtifactMetadataRequestSchema.safeParse({ artifact_id: "artifact-1", unexpected: true }).success, false);

  const { service } = serviceFixture();
  const note = service.getNote({ note_id: "note-visible", max_text_length: 8 });
  const conversation = service.getConversation({ conversation_id: "conversation-visible", max_text_length: 8 });
  const artifact = service.getArtifactMetadata({ artifact_id: "artifact-visible" });
  assert.equal(getNoteResponseSchema.safeParse(note).success, true);
  assert.equal(getConversationResponseSchema.safeParse(conversation).success, true);
  assert.equal(getArtifactMetadataResponseSchema.safeParse(artifact).success, true);
  assert.equal(getNoteResponseSchema.safeParse(service.getNote({ note_id: "missing" })).success, true);
});
