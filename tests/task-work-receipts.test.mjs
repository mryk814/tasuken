import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}

const { ApplicationCommandService } = await importBundled(
  "src/main/services/applicationCommandService.ts",
);
const { normalizeEntity, normalizeTaskAssignment } =
  await import("../src/main/repositories/domain.mjs");
const { WorkspaceDatabase } = await import("../src/main/repositories/workspaceRepository.mjs");

function repository() {
  const records = new Map([
    [
      "theme:theme-personal-default",
      { __type: "theme", id: "theme-personal-default", name: "個人業務", version: 1 },
    ],
  ]);
  const key = (type, id) => `${type}:${id}`;
  return {
    records,
    list(type) {
      return [...records.values()].filter((entity) => entity.__type === type);
    },
    get(type, id, includeDeleted = false) {
      const entity = records.get(key(type, id)) || null;
      return entity && (!entity.deleted_at || includeDeleted) ? entity : null;
    },
    saveMany(operations) {
      return operations.map(({ type, entity }) => {
        const current = records.get(key(type, entity.id));
        const saved = { ...entity, __type: type, version: Number(current?.version || 0) + 1 };
        records.set(key(type, entity.id), saved);
        return saved;
      });
    },
    save(type, entity) {
      return this.saveMany([{ action: "save", type, entity }])[0];
    },
    remove() {
      return null;
    },
    runTransaction(callback) {
      return callback(this);
    },
  };
}

function envelope(
  name,
  payload,
  commandId,
  expectedVersions = [],
  actor = { kind: "user" },
  source = "main_ui",
) {
  return {
    commandId,
    name,
    payload,
    actor,
    source,
    expectedVersions,
    issuedAt: "2026-08-08T00:00:00.000Z",
  };
}

function createAiTask(service) {
  service.execute(
    envelope(
      "CreateTask",
      {
        task: {
          id: "task-ai",
          title: "AI work",
          state: "todo",
          project_id: "theme-personal-default",
          intended_executor: "ai_agent",
          requester: "self",
          work_state: "ready_for_agent",
        },
      },
      "create-ai",
    ),
  );
}

test("repository/domain write invariant blocks every direct AI completion and normalizes reassignment", () => {
  const base = {
    id: "task-invariant",
    title: "Invariant",
    state: "todo",
    project_id: "theme-personal-default",
    requester: "self",
  };
  assert.throws(
    () =>
      normalizeEntity("task", {
        ...base,
        intended_executor: "ai_agent",
        state: "done",
        work_state: "needs_human_review",
      }),
    /work_state=accepted/,
  );
  assert.equal(
    normalizeEntity("task", {
      ...base,
      intended_executor: "ai_agent",
      state: "done",
      work_state: "accepted",
    }).work_state,
    "accepted",
  );

  const assignedToAi = normalizeTaskAssignment(
    { ...base, intended_executor: "ai_agent", work_state: "accepted" },
    { ...base, intended_executor: "human", work_state: "not_delegated" },
  );
  assert.equal(assignedToAi.work_state, "ready_for_agent");
  assert.equal(assignedToAi.work_started_at, null);
  const assignedAway = normalizeTaskAssignment(
    { ...base, intended_executor: "self", work_state: "accepted" },
    { ...base, intended_executor: "ai_agent", work_state: "accepted" },
  );
  assert.equal(assignedAway.work_state, "not_delegated");
  assert.throws(
    () =>
      normalizeTaskAssignment(
        { ...base, intended_executor: "self", work_state: "in_progress" },
        { ...base, intended_executor: "ai_agent", work_state: "in_progress" },
      ),
    /作業中または確認中/,
  );

  const repo = repository();
  const service = new ApplicationCommandService(repo);
  service.execute(
    envelope(
      "CreateTask",
      {
        task: {
          ...base,
          id: "task-reassign",
          intended_executor: "self",
          work_state: "not_delegated",
        },
      },
      "create-reassign",
    ),
  );
  service.execute(
    envelope(
      "UpdateTask",
      {
        task: {
          ...repo.get("task", "task-reassign"),
          intended_executor: "ai_agent",
          work_state: "accepted",
        },
      },
      "assign-ai",
      [{ type: "task", id: "task-reassign", version: 1 }],
    ),
  );
  assert.equal(repo.get("task", "task-reassign").work_state, "ready_for_agent");
});

test("direct Save, Today, MCP proposal, and Focus completion all share the AI completion boundary", () => {
  const todo = readFileSync("src/renderer/src/features/workspace/pages/TodoPage.tsx", "utf8");
  const app = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
  const domain = readFileSync("src/main/repositories/domain.mjs", "utf8");
  const repositorySource = readFileSync("src/main/repositories/workspaceRepository.mjs", "utf8");
  const mcp = readFileSync("src/main/mcp/server.mjs", "utf8");
  const proposalPanel = readFileSync(
    "src/renderer/src/features/workspace/components/AiProposalPanel.tsx",
    "utf8",
  );
  const drawer = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");
  assert.match(todo, /buildCompleteTaskOperations/);
  assert.match(app, /saveEntities\(domainPlan\.operations/);
  assert.match(
    domain,
    /input\.intended_executor === "ai_agent"\s*&&\s*input\.state === "done"\s*&&\s*input\.work_state !== "accepted"/,
  );
  assert.match(repositorySource, /normalizeTaskAssignment\(protectedInput, existing\)/);
  assert.doesNotMatch(mcp, /registerTool\("tasken\.accept_task_work"/);
  assert.doesNotMatch(mcp, /request_human_review|request_review/);
  assert.doesNotMatch(proposalPanel, /request_review/);
  assert.match(
    drawer,
    /!\["done", "cancelled"\]\.includes\(task\.state\) &&\s*!\["accepted", "reported_done", "needs_human_review", "in_progress"\]\.includes\(\s*workState,?\s*\)/,
  );
  assert.match(drawer, /AIへ依頼を準備/);
  assert.match(drawer, /intended_executor: "ai_agent", work_state: "ready_for_agent"/);
  assert.match(drawer, /Coding AgentがTasken MCPから取得できます/);
  assert.match(drawer, /workspaceApi\.copyText\(/);
  assert.match(drawer, /tasken\.get_task_context に task_id=/);
  assert.match(drawer, /AIへ渡る内容を確認/);
  assert.doesNotMatch(
    drawer,
    /useEffect\(\(\) => \{\s*if \(isAiDelegationReady\) setWorkOpen\(true\);/,
  );
  assert.match(
    drawer,
    /key=\{`\$\{task\.id\}:\$\{task\.work_state \|\| task\.intended_executor \|\| "not_delegated"\}`\}/,
  );
  assert.match(
    drawer,
    /key=\{`\$\{taskForWorkSection\.id\}:\$\{taskForWorkSection\.work_state \|\| taskForWorkSection\.intended_executor \|\| "not_delegated"\}`\}/,
  );

  const repo = repository();
  const service = new ApplicationCommandService(repo);
  createAiTask(service);
  repo.save("note", {
    id: "focus-session-ai",
    title: "Focus Session: AI work",
    body_markdown: "scratch",
    project_id: "theme-personal-default",
    properties_json: {
      document_role: "focus_session",
      session_state: "active",
      task_id: "task-ai",
    },
  });
  const task = repo.get("task", "task-ai");
  assert.throws(
    () =>
      service.execute(
        envelope(
          "EndFocusSession",
          {
            session: {
              ...repo.get("note", "focus-session-ai"),
              properties_json: {
                document_role: "focus_session",
                session_state: "ended",
                task_id: "task-ai",
              },
            },
            task: { ...task, state: "done" },
            completeTask: true,
          },
          "focus-ai-complete",
          [
            { type: "note", id: "focus-session-ai", version: 1 },
            { type: "task", id: "task-ai", version: task.version },
          ],
        ),
      ),
    /AIの報告だけではTaskを完了できません/,
  );

  repo.records.set("task:task-ai-proposal", {
    ...task,
    __type: "task",
    id: "task-ai-proposal",
    work_state: "needs_human_review",
    version: 2,
  });
  repo.save("ai_proposal", {
    id: "proposal-ai-done",
    source: "mcp",
    payload_type: "items",
    status: "pending",
  });
  assert.throws(
    () =>
      service.execute({
        ...envelope(
          "ApplyAiProposal",
          {
            proposal: { ...repo.get("ai_proposal", "proposal-ai-done"), status: "accepted" },
            candidates: [
              {
                type: "task",
                entity: {
                  ...repo.get("task", "task-ai-proposal"),
                  state: "done",
                  work_state: "accepted",
                },
              },
            ],
          },
          "mcp-ai-complete",
          [
            { type: "ai_proposal", id: "proposal-ai-done", version: 1 },
            { type: "task", id: "task-ai-proposal", version: 2 },
          ],
        ),
        source: "mcp",
      }),
    /AcceptTaskWork/,
  );
});

test("AI report stays needs_human_review and cannot complete before human accept", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  createAiTask(service);
  service.execute(
    envelope(
      "StartTaskWork",
      { taskId: "task-ai", executorKind: "ai_agent", executorIdentity: "Codex" },
      "start-ai",
      [{ type: "task", id: "task-ai", version: 1 }],
    ),
  );
  const report = service.execute(
    envelope(
      "ReportTaskDone",
      {
        taskId: "task-ai",
        receipt: {
          id: "receipt-ai-1",
          task_id: "task-ai",
          executor_kind: "ai_agent",
          executor_label: "Codex",
          reported_at: "2026-08-08T00:01:00.000Z",
          summary: "Implemented the requested change.",
          completed_items: ["domain"],
          changed_or_created_items: ["src/domain.ts"],
          external_references: [
            {
              kind: "merge_request",
              provider: "gitlab",
              display_label: "!42",
              url: "https://gitlab.example/group/project/-/merge_requests/42?utm_source=agent#overview",
              external_id: "42",
            },
          ],
        },
      },
      "report-ai",
      [{ type: "task", id: "task-ai", version: 2 }],
      { kind: "ai_agent", id: "codex" },
      "mcp",
    ),
  );
  assert.equal(repo.get("task", "task-ai").work_state, "needs_human_review");
  assert.ok(report.changes.some(({ type }) => type === "work_receipt"));
  assert.deepEqual(repo.get("work_receipt", "receipt-ai-1").external_references, [
    {
      kind: "merge_request",
      provider: "gitlab",
      display_label: "!42",
      url: "https://gitlab.example/group/project/-/merge_requests/42",
      external_id: "42",
    },
  ]);
  assert.throws(
    () =>
      service.execute(
        envelope("CompleteTask", { taskId: "task-ai" }, "complete-too-early", [
          { type: "task", id: "task-ai", version: 3 },
        ]),
      ),
    /AIの報告だけではTaskを完了できません/,
  );
  assert.throws(
    () =>
      service.execute(
        envelope(
          "AcceptTaskWork",
          { taskId: "task-ai" },
          "ai-accept",
          [{ type: "task", id: "task-ai", version: 3 }],
          { kind: "ai_agent", id: "codex" },
          "mcp",
        ),
      ),
    /人間UIからのみ/,
  );
  assert.throws(
    () =>
      service.execute(
        envelope(
          "ReturnTaskWork",
          { taskId: "task-ai", reviewNote: "再確認してください。" },
          "mcp-return",
          [{ type: "task", id: "task-ai", version: 3 }],
          { kind: "user" },
          "mcp",
        ),
      ),
    /人間UIからのみ/,
  );
});

test("SQLite repository enforces AI completion, append-only receipts, and task receipt cascade restore", async () => {
  const directory = await mkdtemp(path.join(process.cwd(), ".tasken-work-receipt-"));
  const database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite"));
  try {
    database.loadWorkspace();
    const task = {
      id: "sqlite-task-ai",
      title: "SQLite AI task",
      state: "todo",
      project_id: "theme-personal-default",
      intended_executor: "ai_agent",
      requester: "self",
      work_state: "ready_for_agent",
    };
    const assignedTask = database.save("task", task);
    assert.equal(assignedTask.work_state, "ready_for_agent");
    const invalidDone = { ...assignedTask, state: "done", work_state: "needs_human_review" };
    assert.throws(() => database.save("task", invalidDone), /work_state=accepted/);
    assert.throws(
      () =>
        database.saveMany([
          { action: "save", type: "task", entity: { ...invalidDone, id: "sqlite-task-ai-batch" } },
        ]),
      /work_state=accepted/,
    );

    const acceptedTask = database.saveMany([
      {
        action: "save",
        type: "task",
        entity: { ...assignedTask, state: "done", work_state: "accepted" },
      },
    ]);
    assert.equal(acceptedTask[0].state, "done");
    assert.equal(acceptedTask[0].work_state, "accepted");
    const receipt = database.save("work_receipt", {
      id: "sqlite-receipt",
      task_id: "sqlite-task-ai",
      executor_kind: "ai_agent",
      executor_label: "AI agent",
      reported_at: "2026-08-08T00:02:00.000Z",
      summary: "SQLite receipt",
      completed_items: [],
      changed_or_created_items: [],
      source: "ai",
    });
    assert.equal(receipt.version, 1);
    assert.throws(
      () =>
        database.saveMany([
          {
            action: "save",
            type: "work_receipt",
            entity: { ...receipt, summary: "tampered" },
          },
        ]),
      /append-only/,
    );

    database.remove("task", "sqlite-task-ai");
    assert.equal(database.get("task", "sqlite-task-ai"), null);
    const cascadedReceipt = database.get("work_receipt", "sqlite-receipt", true);
    assert.ok(cascadedReceipt?.deleted_at);
    assert.deepEqual(cascadedReceipt.cascade_deleted_by, {
      parentType: "task",
      parentId: "sqlite-task-ai",
    });

    database.restore("task", "sqlite-task-ai");
    assert.equal(database.get("task", "sqlite-task-ai")?.state, "done");
    const restoredReceipt = database.get("work_receipt", "sqlite-receipt");
    assert.equal(restoredReceipt?.summary, "SQLite receipt");
    assert.equal(restoredReceipt?.deleted_at, null);
    assert.equal(restoredReceipt?.cascade_deleted_by, undefined);
  } finally {
    database.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("human UI accept unlocks ordinary Task completion and receipt metadata is canonical", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  createAiTask(service);
  repo.save("ai_proposal", {
    id: "proposal-mcp",
    source: "mcp",
    payload_type: "task_work",
    payload: { task_work: [{ action: "report_done", task_id: "task-ai" }] },
    status: "pending",
  });
  service.execute(
    envelope("StartTaskWork", { taskId: "task-ai" }, "start-ai-2", [
      { type: "task", id: "task-ai", version: 1 },
    ]),
  );
  const report = service.execute(
    envelope(
      "ReportTaskDone",
      {
        taskId: "task-ai",
        receipt: {
          id: "receipt-ai-2",
          task_id: "task-ai",
          executor_kind: "ai_agent",
          executor_label: "Codex",
          reported_at: "2026-08-08T00:01:00.000Z",
          summary: "Report",
          completed_items: [],
          changed_or_created_items: [],
          source_session: "proposal-mcp",
          version: 99,
          deleted_at: "spoofed",
          source: "spoofed",
        },
      },
      "report-ai-2",
      [{ type: "task", id: "task-ai", version: 2 }],
    ),
  );
  const accepted = service.execute(
    envelope("AcceptTaskWork", { taskId: "task-ai" }, "human-accept", [
      { type: "task", id: "task-ai", version: 3 },
    ]),
  );
  assert.equal(accepted.status, "applied");
  const receipt = repo.get("work_receipt", "receipt-ai-2");
  assert.equal(receipt.deleted_at, undefined);
  assert.equal(receipt.source, "ai");
  assert.deepEqual(receipt.provenance, {
    reported_via: "mcp",
    proposal_id: "proposal-mcp",
    imported_by: "human",
  });
  assert.equal(receipt.version, 1);
  const reportEvent = repo.get("change_event", report.events[0]);
  assert.equal(reportEvent.source, "ai");
  assert.equal(reportEvent.event_kind, "task_ai_reported");
  const completed = service.execute(
    envelope("CompleteTask", { taskId: "task-ai" }, "human-complete", [
      { type: "task", id: "task-ai", version: 4 },
    ]),
  );
  assert.equal(repo.get("task", "task-ai").state, "done");
  assert.equal(completed.status, "applied");
});

test("MCP Receipt provenance requires a matching task_work proposal", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  service.execute(
    envelope(
      "CreateTask",
      {
        task: {
          id: "task-ai-unrelated",
          title: "Unrelated AI work",
          state: "todo",
          project_id: "theme-personal-default",
          intended_executor: "ai_agent",
          requester: "self",
          work_state: "ready_for_agent",
        },
      },
      "create-unrelated",
    ),
  );
  repo.save("ai_proposal", {
    id: "proposal-wrong-task",
    source: "mcp",
    payload_type: "task_work",
    payload: { task_work: [{ action: "report_done", task_id: "another-task" }] },
    status: "pending",
  });
  service.execute(
    envelope("StartTaskWork", { taskId: "task-ai-unrelated" }, "start-unrelated", [
      { type: "task", id: "task-ai-unrelated", version: 1 },
    ]),
  );
  const report = service.execute(
    envelope(
      "ReportTaskDone",
      {
        taskId: "task-ai-unrelated",
        receipt: {
          id: "receipt-wrong-provenance",
          task_id: "task-ai-unrelated",
          executor_kind: "ai_agent",
          executor_label: "Codex",
          reported_at: "2026-08-08T00:03:00.000Z",
          summary: "Report with an unrelated proposal id",
          completed_items: [],
          changed_or_created_items: [],
          source_session: "proposal-wrong-task",
        },
      },
      "report-unrelated",
      [{ type: "task", id: "task-ai-unrelated", version: 2 }],
    ),
  );
  const receipt = repo.get("work_receipt", "receipt-wrong-provenance");
  assert.equal(receipt.source_session, undefined);
  assert.deepEqual(receipt.provenance, { reported_via: "main_ui", imported_by: "human" });
  assert.equal(repo.get("change_event", report.events[0]).source, "ai");
});

test("MCP interim receipt keeps work in progress and only the done report enters human review", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  createAiTask(service);
  service.execute(
    envelope("StartTaskWork", { taskId: "task-ai" }, "start-sequence", [
      { type: "task", id: "task-ai", version: 1 },
    ]),
  );

  repo.save("ai_proposal", {
    id: "proposal-progress",
    source: "mcp",
    payload_type: "task_work",
    payload: { task_work: [{ action: "append_receipt", task_id: "task-ai" }] },
    request: { tool: "tasken.append_work_receipt", caller: "Codex", idempotency_key: "progress-1" },
    status: "pending",
  });
  const progress = service.execute(
    envelope(
      "AppendWorkReceipt",
      {
        taskId: "task-ai",
        receipt: {
          id: "receipt-progress",
          task_id: "task-ai",
          executor_kind: "ai_agent",
          executor_label: "Codex",
          reported_at: "2026-08-09T00:02:00.000Z",
          summary: "Implemented the read projection",
          completed_items: ["read projection"],
          changed_or_created_items: ["taskContext.mjs"],
          source_session: "proposal-progress",
        },
      },
      "proposal-progress",
      [{ type: "task", id: "task-ai", version: 2 }],
    ),
  );
  assert.equal(repo.get("task", "task-ai").work_state, "in_progress");
  assert.equal(repo.get("task", "task-ai").work_reported_at, null);
  assert.equal(repo.get("change_event", progress.events[0]).event_kind, "task_work_recorded");
  assert.equal(repo.get("change_event", progress.events[0]).metadata.work_action, "appended");

  repo.save("ai_proposal", {
    id: "proposal-done",
    source: "mcp",
    payload_type: "task_work",
    payload: { task_work: [{ action: "report_done", task_id: "task-ai" }] },
    request: { tool: "tasken.report_task_done", caller: "Codex", idempotency_key: "done-1" },
    status: "pending",
  });
  const done = service.execute(
    envelope(
      "ReportTaskDone",
      {
        taskId: "task-ai",
        receipt: {
          id: "receipt-done",
          task_id: "task-ai",
          executor_kind: "ai_agent",
          executor_label: "Codex",
          reported_at: "2026-08-09T00:03:00.000Z",
          summary: "Task implementation is ready for review",
          completed_items: ["all acceptance criteria"],
          changed_or_created_items: ["taskContext.mjs", "server.mjs"],
          source_session: "proposal-done",
        },
      },
      "proposal-done",
      [{ type: "task", id: "task-ai", version: 3 }],
    ),
  );
  assert.equal(repo.get("task", "task-ai").work_state, "needs_human_review");
  assert.equal(repo.get("task", "task-ai").work_reported_at, "2026-08-09T00:03:00.000Z");
  assert.equal(repo.get("change_event", done.events[0]).event_kind, "task_ai_reported");
  assert.equal(repo.get("change_event", done.events[0]).metadata.work_action, "reported");
  assert.equal(repo.list("work_receipt").length, 2);
});

test("MCP blocker report appends a receipt, retains audit metadata, and moves work to blocked without completing Task", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  createAiTask(service);
  repo.save("ai_proposal", {
    id: "proposal-start",
    source: "mcp",
    payload_type: "task_work",
    payload: {
      task_work: [
        {
          action: "start",
          task_id: "task-ai",
          repository_context: {
            repository_context_id: "repo-1",
            provider: "github",
            repository_slug: "mryk814/tasuken",
            branch: "codex/issue-279-task-context",
            cwd: "C:/private/must-not-persist",
            remotes: ["https://user:secret@github.com/mryk814/tasuken.git"],
          },
        },
      ],
    },
    request: { tool: "tasken.start_task_work", caller: "Codex", idempotency_key: "start-1" },
    status: "pending",
  });
  const started = service.execute(
    envelope(
      "StartTaskWork",
      { taskId: "task-ai", sourceSession: "proposal-start" },
      "proposal-start",
      [{ type: "task", id: "task-ai", version: 1 }],
    ),
  );
  assert.deepEqual(repo.get("change_event", started.events[0]).metadata.repository_context, {
    repository_context_id: "repo-1",
    provider: "github",
    repository_slug: "mryk814/tasuken",
    branch: "codex/issue-279-task-context",
  });
  repo.save("ai_proposal", {
    id: "proposal-blocked",
    source: "mcp",
    payload_type: "task_work",
    payload: {
      task_work: [
        { action: "report_blocked", task_id: "task-ai", expected_version: 2, caller: "Codex" },
      ],
    },
    request: {
      tool: "tasken.report_task_blocked",
      caller: "Codex",
      source_session: "codex-session-42",
      idempotency_key: "blocker-1",
    },
    created_at: "2026-08-09T00:02:00.000Z",
    status: "pending",
  });
  service.execute(
    envelope(
      "ReportTaskBlocked",
      {
        taskId: "task-ai",
        receipt: {
          id: "receipt-blocked",
          task_id: "task-ai",
          executor_kind: "ai_agent",
          executor_label: "Codex",
          reported_at: "2026-08-09T00:03:00.000Z",
          summary: "Credential is missing",
          completed_items: ["Inspected configuration"],
          changed_or_created_items: [],
          verification: [],
          remaining_work: ["Provide credential"],
          source_session: "proposal-blocked",
          repository_context: {
            repository_context_id: "repo-1",
            provider: "github",
            repository_slug: "mryk814/tasuken",
            branch: "codex/issue-279-task-context",
            cwd: "C:/private/must-not-persist",
            workspace_folder: "C:/private/tasuken",
            remotes: ["https://user:secret@github.com/mryk814/tasuken.git"],
          },
        },
      },
      "proposal-blocked",
      [{ type: "task", id: "task-ai", version: 2 }],
    ),
  );

  const task = repo.get("task", "task-ai");
  const receipt = repo.get("work_receipt", "receipt-blocked");
  assert.equal(task.state, "todo");
  assert.equal(task.work_state, "blocked");
  assert.equal(receipt.provenance.reported_via, "mcp");
  assert.equal(receipt.provenance.caller, "Codex");
  assert.equal(receipt.provenance.source_session, "codex-session-42");
  assert.equal(receipt.provenance.idempotency_key, "blocker-1");
  assert.deepEqual(receipt.repository_context, {
    repository_context_id: "repo-1",
    provider: "github",
    repository_slug: "mryk814/tasuken",
    branch: "codex/issue-279-task-context",
  });
  assert.equal(JSON.stringify(receipt).includes("C:/private"), false);
  assert.equal(JSON.stringify(receipt).includes("secret"), false);

  service.execute(
    envelope("StartTaskWork", { taskId: "task-ai" }, "resume-after-block", [
      { type: "task", id: "task-ai", version: 3 },
    ]),
  );
  assert.equal(repo.get("task", "task-ai").work_state, "in_progress");
});
