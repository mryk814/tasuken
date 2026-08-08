import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
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
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const { ApplicationCommandService } = await importBundled("src/main/services/applicationCommandService.ts");
const { normalizeEntity, normalizeTaskAssignment } = await import("../src/main/repositories/domain.mjs");

function repository() {
  const records = new Map([
    ["theme:theme-personal-default", { __type: "theme", id: "theme-personal-default", name: "個人業務", version: 1 }],
  ]);
  const key = (type, id) => `${type}:${id}`;
  return {
    records,
    list(type) { return [...records.values()].filter((entity) => entity.__type === type); },
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
    save(type, entity) { return this.saveMany([{ action: "save", type, entity }])[0]; },
    remove() { return null; },
    runTransaction(callback) { return callback(this); },
  };
}

function envelope(name, payload, commandId, expectedVersions = [], actor = { kind: "user" }, source = "main_ui") {
  return { commandId, name, payload, actor, source, expectedVersions, issuedAt: "2026-08-08T00:00:00.000Z" };
}

function createAiTask(service) {
  service.execute(envelope("CreateTask", {
    task: {
      id: "task-ai",
      title: "AI work",
      state: "todo",
      project_id: "theme-personal-default",
      intended_executor: "ai_agent",
      requester: "self",
      work_state: "ready_for_agent",
    },
  }, "create-ai"));
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
    () => normalizeEntity("task", { ...base, intended_executor: "ai_agent", state: "done", work_state: "needs_human_review" }),
    /work_state=accepted/,
  );
  assert.equal(
    normalizeEntity("task", { ...base, intended_executor: "ai_agent", state: "done", work_state: "accepted" }).work_state,
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
    () => normalizeTaskAssignment(
      { ...base, intended_executor: "self", work_state: "in_progress" },
      { ...base, intended_executor: "ai_agent", work_state: "in_progress" },
    ),
    /作業中または確認中/,
  );

  const repo = repository();
  const service = new ApplicationCommandService(repo);
  service.execute(envelope("CreateTask", {
    task: { ...base, id: "task-reassign", intended_executor: "self", work_state: "not_delegated" },
  }, "create-reassign"));
  service.execute(envelope("UpdateTask", {
    task: { ...repo.get("task", "task-reassign"), intended_executor: "ai_agent", work_state: "accepted" },
  }, "assign-ai", [{ type: "task", id: "task-reassign", version: 1 }]));
  assert.equal(repo.get("task", "task-reassign").work_state, "ready_for_agent");
});

test("direct Save, Today, MCP proposal, and Focus completion all share the AI completion boundary", () => {
  const todo = readFileSync("src/renderer/src/features/workspace/pages/TodoPage.tsx", "utf8");
  const app = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
  const domain = readFileSync("src/main/repositories/domain.mjs", "utf8");
  const repositorySource = readFileSync("src/main/repositories/workspaceRepository.mjs", "utf8");
  const mcp = readFileSync("src/main/mcp/server.mjs", "utf8");
  const drawer = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");
  assert.match(todo, /buildCompleteTaskOperations/);
  assert.match(app, /saveEntities\(domainPlan\.operations/);
  assert.match(domain, /input\.intended_executor === "ai_agent" && input\.state === "done" && input\.work_state !== "accepted"/);
  assert.match(repositorySource, /normalizeTaskAssignment\(activityInput, existing\)/);
  assert.doesNotMatch(mcp, /registerTool\("tasken\.accept_task_work"/);
  assert.match(drawer, /!\["done", "cancelled"\]\.includes\(task\.state\) && !\["accepted", "reported_done", "needs_human_review", "in_progress"\]\.includes\(workState\)/);

  const repo = repository();
  const service = new ApplicationCommandService(repo);
  createAiTask(service);
  repo.save("note", {
    id: "focus-session-ai",
    title: "Focus Session: AI work",
    body_markdown: "scratch",
    project_id: "theme-personal-default",
    properties_json: { document_role: "focus_session", session_state: "active", task_id: "task-ai" },
  });
  const task = repo.get("task", "task-ai");
  assert.throws(() => service.execute(envelope("EndFocusSession", {
    session: {
      ...repo.get("note", "focus-session-ai"),
      properties_json: { document_role: "focus_session", session_state: "ended", task_id: "task-ai" },
    },
    task: { ...task, state: "done" },
    completeTask: true,
  }, "focus-ai-complete", [
    { type: "note", id: "focus-session-ai", version: 1 },
    { type: "task", id: "task-ai", version: task.version },
  ])), /AIの報告だけではTaskを完了できません/);

  repo.records.set("task:task-ai-proposal", {
    ...task,
    __type: "task",
    id: "task-ai-proposal",
    work_state: "needs_human_review",
    version: 2,
  });
  repo.save("ai_proposal", { id: "proposal-ai-done", source: "mcp", payload_type: "items", status: "pending" });
  assert.throws(() => service.execute({
    ...envelope("ApplyAiProposal", {
      proposal: { ...repo.get("ai_proposal", "proposal-ai-done"), status: "accepted" },
      candidates: [{ type: "task", entity: { ...repo.get("task", "task-ai-proposal"), state: "done", work_state: "accepted" } }],
    }, "mcp-ai-complete", [{ type: "ai_proposal", id: "proposal-ai-done", version: 1 }, { type: "task", id: "task-ai-proposal", version: 2 }]),
    source: "mcp",
  }), /AcceptTaskWork/);
});

test("AI report stays needs_human_review and cannot complete before human accept", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  createAiTask(service);
  service.execute(envelope("StartTaskWork", { taskId: "task-ai", executorKind: "ai_agent", executorIdentity: "Codex" }, "start-ai", [{ type: "task", id: "task-ai", version: 1 }]));
  const report = service.execute(envelope("AppendWorkReceipt", {
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
    },
  }, "report-ai", [{ type: "task", id: "task-ai", version: 2 }], { kind: "ai_agent", id: "codex" }, "mcp"));
  assert.equal(repo.get("task", "task-ai").work_state, "needs_human_review");
  assert.ok(report.changes.some(({ type }) => type === "work_receipt"));
  assert.throws(() => service.execute(envelope("CompleteTask", { taskId: "task-ai" }, "complete-too-early", [{ type: "task", id: "task-ai", version: 3 }])), /AIの報告だけではTaskを完了できません/);
  assert.throws(() => service.execute(envelope("AcceptTaskWork", { taskId: "task-ai" }, "ai-accept", [{ type: "task", id: "task-ai", version: 3 }], { kind: "ai_agent", id: "codex" }, "mcp")), /人間UIからのみ/);
  assert.throws(() => service.execute(envelope("ReturnTaskWork", { taskId: "task-ai", reviewNote: "再確認してください。" }, "mcp-return", [{ type: "task", id: "task-ai", version: 3 }], { kind: "user" }, "mcp")), /人間UIからのみ/);
});

test("human UI accept unlocks ordinary Task completion and receipt metadata is canonical", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  createAiTask(service);
  service.execute(envelope("StartTaskWork", { taskId: "task-ai" }, "start-ai-2", [{ type: "task", id: "task-ai", version: 1 }]));
  service.execute(envelope("AppendWorkReceipt", {
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
      version: 99,
      deleted_at: "spoofed",
      source: "spoofed",
    },
  }, "report-ai-2", [{ type: "task", id: "task-ai", version: 2 }], { kind: "ai_agent" }, "mcp"));
  const accepted = service.execute(envelope("AcceptTaskWork", { taskId: "task-ai" }, "human-accept", [{ type: "task", id: "task-ai", version: 3 }]));
  assert.equal(accepted.status, "applied");
  const receipt = repo.get("work_receipt", "receipt-ai-2");
  assert.equal(receipt.deleted_at, undefined);
  assert.equal(receipt.source, "ai");
  assert.equal(receipt.version, 1);
  const completed = service.execute(envelope("CompleteTask", { taskId: "task-ai" }, "human-complete", [{ type: "task", id: "task-ai", version: 4 }]));
  assert.equal(repo.get("task", "task-ai").state, "done");
  assert.equal(completed.status, "applied");
});
