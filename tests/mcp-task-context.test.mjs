import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { build } from "esbuild";

import { ReadOnlyTaskenContext } from "../src/main/mcp/readOnlyContext.mjs";
import { queueMcpProposal, validateMcpProposalEnvelope } from "../src/main/mcp/proposalInbox.mjs";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import { buildActivityEvent } from "../src/shared/activityEvent.mjs";
import { previewTaskCoding, previewThemeCoding } from "../src/shared/aiContextPreview.mjs";

const bundledCore = await build({
  stdin: {
    contents: `
      export { TaskenCoreHost } from "./src/main/infrastructure/http/taskenCoreHost.ts";
      export { createTaskenCore } from "./src/main/infrastructure/sqlite/public.ts";
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { TaskenCoreHost, createTaskenCore } = await import(
  `data:text/javascript;base64,${Buffer.from(bundledCore.outputFiles[0].text).toString("base64")}`
);

function contextFixture() {
  const theme = {
    id: "theme-1",
    name: "Task context",
    description: "MCP context delivery",
    state: "active",
    repository_context_ids: ["repo-1"],
    primary_repository_context_id: "repo-1",
    updated_at: "2026-08-09T00:00:00.000Z",
  };
  const task = {
    id: "task-1",
    title: "Implement context",
    description: "Task request and acceptance live here.",
    state: "todo",
    priority: "high",
    project_id: theme.id,
    requester: "human",
    intended_executor: "ai_agent",
    executor_identity: "Codex",
    work_state: "in_progress",
    repository_context_mode: "inherit",
    version: 4,
    updated_at: "2026-08-09T02:00:00.000Z",
  };
  const notes = [
    { id: "note-1", title: "Decision", body_markdown: "Detailed decision body", project_id: theme.id, updated_at: "2026-08-09T03:00:00.000Z" },
    { id: "note-2", title: "Older note", body_markdown: "Older body", project_id: theme.id, updated_at: "2026-08-09T01:00:00.000Z" },
    { id: "note-hidden", title: "Private", body_markdown: "must never leak", project_id: theme.id, ai_visibility: [], updated_at: "2026-08-09T04:00:00.000Z" },
  ];
  const conversation = {
    id: "conversation-1",
    title: "Copilot session",
    description: "Implementation discussion",
    body_markdown: "User: implement it\nAssistant: acknowledged",
    url: "https://user:secret@example.com/chat/1?token=secret#message",
    resource_scope: "chat_ref",
    message_count: 2,
    project_id: theme.id,
    updated_at: "2026-08-09T02:30:00.000Z",
  };
  const resource = {
    id: "resource-1",
    title: "MCP specification",
    url: "https://example.com/spec?tracking=1",
    resource_scope: "note",
    project_id: theme.id,
    updated_at: "2026-08-09T02:20:00.000Z",
  };
  const artifact = {
    id: "artifact-1",
    title: "Test report",
    filename: "report.json",
    file_type: "json",
    mime_type: "application/json",
    stored_path: "C:/private/report.json",
    original_path: "C:/private/source.json",
    source_type: "task",
    source_id: task.id,
    project_id: theme.id,
    updated_at: "2026-08-09T02:10:00.000Z",
  };
  const references = [
    { id: "ref-note-1", source_type: "task", source_id: task.id, target_type: "note", target_id: "note-1", relation_type: "context" },
    { id: "ref-note-2", source_type: "task", source_id: task.id, target_type: "note", target_id: "note-2", relation_type: "context" },
    { id: "ref-note-hidden", source_type: "task", source_id: task.id, target_type: "note", target_id: "note-hidden", relation_type: "context" },
    { id: "ref-conversation", source_type: "task", source_id: task.id, target_type: "resource", target_id: conversation.id, relation_type: "context" },
    { id: "ref-resource", source_type: "task", source_id: task.id, target_type: "resource", target_id: resource.id, relation_type: "context" },
  ];
  const receipt = {
    id: "receipt-1",
    task_id: task.id,
    executor_kind: "ai_agent",
    executor_label: "Codex",
    reported_at: "2026-08-09T02:40:00.000Z",
    summary: "Implemented the first pass",
    completed_items: ["context read model"],
    changed_or_created_items: ["readOnlyContext.mjs"],
    verification: ["focused tests"],
    remaining_work: ["human review"],
    repository_context: { cwd: "C:/private/repo", repository_context_id: "repo-1", provider: "github", repository_slug: "mryk814/tasuken", branch: "codex/issue-279-task-context" },
    runtime_metadata: { provider: "openai", model: "gpt-5", report_kind: "done", diagnostic_path: "C:/private/diagnostic.json" },
    provenance: { reported_via: "mcp", caller: "codex", private_path: "C:/private/provenance.json", secret: "must never leak provenance" },
    updated_at: "2026-08-09T02:40:00.000Z",
  };
  return new ReadOnlyTaskenContext("in-memory.sqlite", {
    workspace: {
      themes: [theme],
      tasks: [task],
      notes,
      resources: [conversation, resource],
      artifacts: [artifact],
      references,
      work_receipts: [receipt],
      repository_contexts: [{
        id: "repo-1",
        label: "Tasuken",
        provider: "github",
        canonical_url: "https://github.com/mryk814/tasuken",
        canonical_identity: "github.com/mryk814/tasuken",
        repository_slug: "mryk814/tasuken",
        remote_aliases: ["git@github.com:mryk814/tasuken.git"],
        local_path: "C:/private/tasuken",
        active: true,
      }],
      change_events: [
        buildActivityEvent({
          id: "event-1",
          entityType: "task",
          entityId: task.id,
          changeType: "updated",
          eventKind: "task_work_recorded",
          occurredAt: "2026-08-09T02:50:00.000Z",
          before: { ...task, work_state: "ready_for_agent" },
          after: task,
        }),
        buildActivityEvent({
          id: "event-2",
          entityType: "task",
          entityId: task.id,
          changeType: "updated",
          eventKind: "task_ai_reported",
          occurredAt: "2026-08-09T02:55:00.000Z",
          before: { ...task, work_state: "in_progress" },
          after: { ...task, work_state: "needs_human_review" },
        }),
      ],
    },
  });
}

test("get_task_context returns bounded related summaries, safe locators, repository match, and no private file data", () => {
  const context = contextFixture();
  try {
    const result = context.toolGetTaskContext({
      task_id: "task-1",
      max_items_per_type: 1,
      max_text_length: 5000,
      workspace: {
        cwd: "C:/work/tasuken",
        git_root: "C:/work/tasuken",
        remotes: ["git@github.com:mryk814/tasuken.git"],
        branch: "codex/issue-279-task-context",
      },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.task.id, "task-1");
    assert.equal(result.assignment.work_state, "in_progress");
    assert.equal(result.theme.id, "theme-1");
    assert.equal(result.workspace_match.status, "matched");
    assert.equal(result.repository_contexts[0].local_path, undefined);
    assert.equal(result.related.notes.length, 1);
    assert.equal(result.truncation.notes.omitted_count, 1);
    assert.equal(result.related.notes[0].included_because, "explicitly_linked");
    assert.equal(result.related.notes[0].locator.tool, "tasken.get_note");
    assert.equal(result.related.conversations[0].source_url, "https://example.com/chat/1");
    assert.equal(result.related.artifacts[0].locator.tool, "tasken.get_artifact_metadata");
    assert.equal(result.related.activity[0].included_because, "recent_activity");
    assert.equal(result.related.activity[0].id, "event-2");
    assert.deepEqual(result.related.work_receipts[0].repository_context, {
      repository_context_id: "repo-1",
      provider: "github",
      repository_slug: "mryk814/tasuken",
      branch: "codex/issue-279-task-context",
    });
    assert.deepEqual(result.related.work_receipts[0].runtime_metadata, { provider: "openai", model: "gpt-5", report_kind: "done" });
    assert.equal(result.context_selection.schema, "tasken-context-selection/v1");
    assert.ok(result.context_selection.included.some((entry) => entry.ref.type === "resource" && entry.ref.id === "conversation-1"));
    assert.equal(result.context_selection.included.some((entry) => entry.ref.type === "conversation"), false);
    assert.ok(result.context_selection.excluded.some((entry) => entry.ref.type === "note" && entry.ref.id === "note-hidden"));
    const preview = previewTaskCoding(result);
    assert.deepEqual(
      preview.included.map((entry) => entry.ref),
      result.context_selection.included.map((entry) => entry.ref),
    );
    assert.deepEqual(
      preview.excluded.map((entry) => ({ ref: entry.ref, reason: entry.reason })),
      result.context_selection.excluded.map((entry) => ({ ref: entry.ref, reason: entry.reason })),
    );
    assert.equal(JSON.stringify(result).includes("must never leak"), false);
    assert.equal(JSON.stringify(result).includes("C:/private"), false);
    assert.equal(JSON.stringify(result).includes("token=secret"), false);
    assert.equal(result.truncated, true);
  } finally {
    context.close();
  }
});

test("Task context budgets AI metadata, rejects private source roots, and keeps include sections aligned with Preview", () => {
  const context = contextFixture();
  try {
    Object.assign(context.workspace.tasks[0], {
      ai_summary: "S".repeat(12_000),
      ai_visibility: ["coding_agent"],
      ai_source_refs: [
        { kind: "canonical_document", locator: "ignored", storage_root_id: "C:\\Users\\private", relative_path: "Notes/source.md" },
        { kind: "file", locator: "C:\\Users\\private\\secret.md" },
        { kind: "url", locator: "https://alice:secret@example.com/private" },
      ],
    });
    const bounded = context.toolGetTaskContext({ task_id: "task-1", max_text_length: 1_000 });
    const serialized = JSON.stringify(bounded);
    assert.equal(bounded.truncation.text.reason, "max_text_length");
    assert.equal(bounded.truncation.text.used, 1_000);
    assert.equal(bounded.context_selection.estimated_characters, 1_000);
    assert.doesNotMatch(serialized, /C:\\\\Users|alice:secret|secret\.md/);
    assert.doesNotMatch(JSON.stringify(previewTaskCoding(bounded)), /C:\\\\Users|alice:secret|secret\.md/);

    const repositoryOnly = context.toolGetTaskContext({
      task_id: "task-1",
      include: ["repository"],
      max_text_length: 5_000,
    });
    const graphRefs = repositoryOnly.context_graph.nodes.map((node) => `${node.type}:${node.id}`).sort();
    assert.deepEqual(graphRefs, ["task:task-1"]);
    assert.equal(JSON.stringify(repositoryOnly.context_graph).includes("Decision"), false);
    assert.ok(repositoryOnly.context_selection.excluded.some((entry) => entry.ref.id === "note-1" && entry.reason === "include_not_requested"));
    assert.deepEqual(
      previewTaskCoding(repositoryOnly).included.map((entry) => entry.ref),
      repositoryOnly.context_selection.included.map((entry) => entry.ref),
    );
  } finally {
    context.close();
  }
});

test("Theme Coding uses the common bounded relation query and Preview preserves its exact selection", () => {
  const context = contextFixture();
  try {
    const result = context.toolGetThemeContext({ theme_id: "theme-1", max_chars: 5_000, max_hops: 2 });
    assert.equal(result.error, undefined);
    assert.equal(result.context_selection.seed.type, "theme");
    assert.ok(result.context_selection.relations.some((edge) => edge.predicate === "uses_repository_context"));
    assert.ok(result.open_items.some((entry) => entry.entity_type === "task" && entry.id === "task-1"));
    assert.ok(result.context_selection.excluded.some((entry) => entry.ref.id === "note-hidden"));
    const preview = previewThemeCoding(result);
    assert.deepEqual(
      preview.included.map((entry) => entry.ref),
      result.context_selection.included.map((entry) => entry.ref),
    );
    assert.deepEqual(
      preview.excluded.map((entry) => ({ ref: entry.ref, reason: entry.reason })),
      result.context_selection.excluded.map((entry) => ({ ref: entry.ref, reason: entry.reason })),
    );
    assert.equal(JSON.stringify(result).includes("must never leak"), false);
    assert.equal(JSON.stringify(result).includes("C:/private"), false);
  } finally {
    context.close();
  }
});

test("Theme repository contexts remain attributed by each Theme edge when the graph includes another Theme", () => {
  const context = new ReadOnlyTaskenContext("ignored", {
    workspace: {
      themes: [
        { id: "theme-a", name: "A", state: "active", repository_context_ids: ["repo-shared", "repo-a"] },
        { id: "theme-b", name: "B", state: "active", repository_context_ids: ["repo-shared"] },
      ],
      repository_contexts: [
        { id: "repo-shared", label: "Shared", active: true },
        { id: "repo-a", label: "A only", active: true },
      ],
    },
  });
  try {
    const result = context.toolGetThemeContext({ theme_id: "theme-a", max_hops: 2, max_nodes: 20 });
    assert.deepEqual(
      result.theme_repository_contexts.map((entry) => ({ theme_id: entry.theme_id, context_ids: entry.context_ids })),
      [
        { theme_id: "theme-a", context_ids: ["repo-a", "repo-shared"] },
        { theme_id: "theme-b", context_ids: ["repo-shared"] },
      ],
    );
  } finally {
    context.close();
  }
});

test("task detail tools require stable IDs, preserve AI visibility, and never read external Artifact content", () => {
  const context = contextFixture();
  try {
    const note = context.toolGetNote({ note_id: "note-1", max_text_length: 8 });
    assert.equal(note.note.body_markdown.length, 8);
    assert.equal(note.truncated, true);
    assert.equal(context.toolGetNote({ note_id: "note-hidden" }).error.code, "not_found");

    const conversation = context.toolGetConversation({ conversation_id: "conversation-1", max_text_length: 12 });
    assert.equal(conversation.conversation.body_markdown.length, 12);
    assert.equal(conversation.conversation.source_url, "https://example.com/chat/1");

    const artifact = context.toolGetArtifactMetadata({ artifact_id: "artifact-1" });
    assert.equal(artifact.external_file_content_included, false);
    assert.equal("stored_path" in artifact.artifact, false);
    assert.equal("target" in artifact.artifact, false);
    const activity = context.toolGetActivityEntries({ task_id: "task-1" });
    assert.equal(activity.events.length, 2);
    assert.equal(activity.events[0].id, "event-2");
    assert.equal(context.toolGetTaskContext({ task_id: "missing" }).error.code, "not_found");
  } finally {
    context.close();
  }
});

test("task work proposal retries are idempotent and reject key reuse with different content", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-task-context-idempotency-"));
  const inboxPath = path.join(root, "mcp-inbox");
  const base = {
    inboxPath,
    payloadType: "task_work",
    sourceApp: "codex",
    idempotencyKey: "session-1-report-1",
    payload: {
      task_work: [{
        action: "report_blocked",
        task_id: "task-1",
        expected_version: 4,
        caller: "Codex",
        source_session: "session-1",
        executor_kind: "ai_agent",
        executor_label: "Codex",
        summary: "Need credentials",
        completed_items: ["checked configuration"],
        changed_or_created_items: [],
        verification: [],
        remaining_work: ["provide credentials"],
      }],
    },
    request: { tool: "tasken.report_task_blocked", caller: "Codex" },
  };
  try {
    const first = queueMcpProposal(base);
    const retry = queueMcpProposal(base);
    assert.equal(first.proposal_id, retry.proposal_id);
    assert.equal(retry.status, "duplicate");
    assert.equal(fs.readdirSync(inboxPath).filter((name) => name.endsWith(".json")).length, 1);
    assert.throws(() => queueMcpProposal({
      ...base,
      payload: { task_work: [{ ...base.payload.task_work[0], summary: "Different blocker" }] },
    }), /異なる内容/);
    assert.throws(() => queueMcpProposal({
      ...base,
      idempotencyKey: "session-1-private-repository-context",
      payload: { task_work: [{
        ...base.payload.task_work[0],
        repository_context: { repository_context_id: "repo-1", cwd: "C:/private/tasuken" },
      }] },
    }), /非公開field/);
    const envelope = validateMcpProposalEnvelope(JSON.parse(fs.readFileSync(path.join(inboxPath, fs.readdirSync(inboxPath)[0]), "utf8")));
    assert.equal(envelope.request.idempotency_key, "session-1-report-1");
    assert.match(envelope.request.payload_digest, /^[0-9a-f]{64}$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("read-only MCP mode exposes context tools and no proposal or task-work write tools", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["scripts/mcp-server.mjs"],
    env: { ...process.env, TASKEN_MCP_READ_ONLY: "1" },
    stderr: "pipe",
  });
  const client = new Client({ name: "tasken-read-only-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const names = new Set(listed.tools.map((tool) => tool.name));
    assert.equal(names.has("tasken.get_task_context"), true);
    assert.equal(names.has("tasken.get_note"), true);
    assert.equal(names.has("tasken.start_task_work"), false);
    assert.equal(names.has("tasken.propose_task"), false);
    assert.equal([...names].some((name) => /delete|remove|complete_task/.test(name)), false);
  } finally {
    await client.close();
  }
});

test("task blocker workflow is callable over MCP and queues a reviewable append-only receipt proposal", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-task-blocked-stdio-"));
  fs.chmodSync(root, 0o700);
  const inboxPath = path.join(root, "mcp-inbox");
  const database = new WorkspaceDatabase(path.join(root, "workspace.sqlite3"));
  const host = new TaskenCoreHost({ userDataPath: root, ...createTaskenCore(database) });
  await host.start();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["scripts/mcp-server.mjs"],
    env: { ...process.env, TASKEN_USER_DATA_DIR: root, TASKEN_MCP_INBOX_PATH: inboxPath },
    stderr: "pipe",
  });
  const client = new Client({ name: "tasken-task-blocked-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const names = new Set((await client.listTools()).tools.map((tool) => tool.name));
    for (const name of ["tasken.start_task_work", "tasken.append_work_receipt", "tasken.report_task_done", "tasken.report_task_blocked"]) {
      assert.equal(names.has(name), true);
    }
    const result = await client.callTool({
      name: "tasken.report_task_blocked",
      arguments: {
        task_id: "task-1",
        expected_version: 4,
        idempotency_key: "session-1-blocked-1",
        caller: "Codex",
        source_session: "session-1",
        repository_context: {
          repository_context_id: "repo-1",
          provider: "github",
          repository_slug: "mryk814/tasuken",
          branch: "codex/issue-279-task-context",
        },
        executor_label: "Codex",
        blocker: "Repository credential is unavailable.",
        attempted_work: ["Inspected repository configuration"],
        needed_input: ["Provide repository access"],
        retained_artifacts: ["diagnostic log"],
      },
    });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal("inbox_path" in result.structuredContent, false);
    assert.equal(fs.existsSync(inboxPath), false);
    const proposal = database.get("ai_proposal", result.structuredContent.proposal_id);
    assert.ok(proposal);
    const report = proposal.payload.task_work[0];
    assert.equal(report.action, "report_blocked");
    assert.equal(report.summary, "Repository credential is unavailable.");
    assert.deepEqual(report.repository_context, {
      repository_context_id: "repo-1",
      provider: "github",
      repository_slug: "mryk814/tasuken",
      branch: "codex/issue-279-task-context",
    });
    assert.equal(proposal.request.idempotency_key, "session-1-blocked-1");
    assert.deepEqual(proposal.request.actor, { kind: "ai_agent" });
    assert.equal(proposal.request.source, "mcp");
    const rejected = await client.callTool({
      name: "tasken.report_task_blocked",
      arguments: {
        task_id: "task-1",
        expected_version: 4,
        idempotency_key: "session-1-blocked-private-path",
        caller: "Codex",
        executor_label: "Codex",
        blocker: "Unsafe context should be rejected.",
        repository_context: { repository_context_id: "repo-1", cwd: "C:/private/tasuken" },
      },
    });
    assert.equal(rejected.isError, true);
    assert.equal(database.list("ai_proposal").length, 1);
    assert.equal(fs.existsSync(inboxPath), false);
  } finally {
    try {
      await client.close();
    } finally {
      try {
        await host.stop();
      } finally {
        database.db.close();
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
});
