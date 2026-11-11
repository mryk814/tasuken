// 本人の言葉を根拠に、ローカルのAIがProposalの採否を取り次ぎ、Noteを直接編集する（#703 段3）。
// Desktopと同じ配線で、Core HTTPから確かめる。データは一時フォルダの架空のもの。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import { TaskenCoreClient } from "../src/main/mcp/taskenCoreClient.mjs";

const bundles = fs.mkdtempSync(path.join(process.cwd(), ".ai-proposal-decision-test-"));
after(() => fs.rmSync(bundles, { recursive: true, force: true }));
await build({
  stdin: {
    contents: `
    export { WorkspaceService } from "./src/main/services/workspaceService.ts";
    export { ApplicationCommandService } from "./src/main/services/applicationCommandService.ts";
    export { AiProposalDecisionService } from "./src/main/services/aiProposalDecisionService.ts";
    export {
      TaskenCoreRuntime,
      createAiItemCreationPort,
      createAiTaskChangeService,
    } from "./src/main/composition/taskenCoreRuntime.ts";
  `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  alias: { electron: path.resolve("src/main/headless/electronUnavailable.ts") },
  outfile: path.join(bundles, "core.mjs"),
  logLevel: "silent",
});
const {
  WorkspaceService,
  ApplicationCommandService,
  AiProposalDecisionService,
  TaskenCoreRuntime,
  createAiItemCreationPort,
  createAiTaskChangeService,
} = await import(pathToFileURL(path.join(bundles, "core.mjs")));

async function desktop(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-ai-decision-"));
  const db = new WorkspaceDatabase(path.join(dir, "research-desk.sqlite"));
  db.loadWorkspace();
  db.setPreference("aiDirectWriteEnabled", true);
  const workspace = new WorkspaceService(db, dir, undefined, undefined, () => {
    throw Error("no images");
  });
  const commands = new ApplicationCommandService(db);
  const isEnabled = () => db.readPreference("aiDirectWriteEnabled") === true;
  const runtime = new TaskenCoreRuntime(
    dir,
    db,
    (command) => commands.execute(command),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { executeAiTaskStart: (command) => commands.executeAiTaskStart(command, "any") },
  );
  runtime.enableAiItemCreation(createAiItemCreationPort(commands, workspace), {
    isEnabled,
    scope: "any",
  });
  runtime.enableAiDirectWrite(
    createAiTaskChangeService(db, commands, isEnabled),
    new AiProposalDecisionService({
      persistence: db,
      commands,
      artifacts: workspace,
      proposeContent: (request) => runtime.proposeContent(request),
      isEnabled,
    }),
  );
  await runtime.start();
  t.after(async () => {
    await runtime.stop();
    db.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { db, core: new TaskenCoreClient({ userDataPath: dir }) };
}

const who = { caller: "Claude Code", source_session: "conversation-d" };

async function refused(promise, code) {
  let caught;
  await assert.rejects(promise, (error) => {
    caught = error;
    return error.code === code;
  });
  return caught;
}

async function reportedTask(db, core) {
  db.save("task", {
    id: "task-report",
    title: "資料の誤字を探す",
    project_id: "theme-personal-default",
    state: "todo",
    priority: "normal",
    requester: "self",
    intended_executor: "ai_agent",
    work_state: "ready_for_agent",
  });
  const started = await core.startAiTaskWork({
    task_id: "task-report",
    expected_version: db.get("task", "task-report").version,
    idempotency_key: "start-report",
    caller: "Claude Code",
    started_at: new Date().toISOString(),
    work_attempt_id: "6a1b8d2e-3c4f-4a5b-8c6d-7e8f9a0b1c2d",
  });
  const report = await core.proposeTaskWork({
    task_id: "task-report",
    expected_version: started.value.task.version,
    idempotency_key: "report-done",
    caller: "Claude Code",
    executor_kind: "ai_agent",
    executor_label: "Claude Code",
    summary: "誤字を3か所直した",
    work_attempt_id: "6a1b8d2e-3c4f-4a5b-8c6d-7e8f9a0b1c2d",
    action: "report_done",
    actor: { kind: "ai_agent" },
    source: "mcp",
    source_app: "claude-code",
  });
  return db.get("ai_proposal", report.proposal_id);
}

test("作業報告を本人の言葉で採用し、Taskも完了にする。本人の言葉が無ければ受けない", async (t) => {
  const { db, core } = await desktop(t);
  const proposal = await reportedTask(db, core);
  const request = {
    proposal_id: proposal.id,
    expected_version: proposal.version,
    decision: "accept",
    complete_task: true,
    said: "OK、それで完了にして",
    ...who,
  };
  await refused(core.decideProposal({ ...request, said: undefined }), "VALIDATION_FAILED");
  const decided = await core.decideProposal(request);
  assert.equal(decided.status, "applied");
  assert.equal(decided.proposal_status, "accepted");
  assert.equal(decided.task.state, "done");
  assert(db.get("work_receipt", proposal.id), "報告がWork Receiptになる");
  const events = db.listChangeEventsByCommandId(decided.change_id);
  assert(events.length > 0);
  for (const event of events) {
    assert.equal(event.actor_kind, "ai_agent");
    assert.equal(event.metadata.ai_direct.said, "OK、それで完了にして");
  }
  // 再送は同じ結果。決め直しはできない。
  assert.equal((await core.decideProposal(request)).status, "duplicate");
  await refused(
    core.decideProposal({ ...request, decision: "reject", complete_task: undefined }),
    "ALREADY_DECIDED",
  );
});

test("Note案の採用・却下。ほかの種類はDesktopの画面へ案内し、古い版は409", async (t) => {
  const { db, core } = await desktop(t);
  const queue = (key) =>
    core.proposeContent({
      kind: "note_create",
      title: `会議のメモ ${key}`,
      body: "決まったこと",
      idempotency_key: key,
      caller: "Claude Code",
      actor: { kind: "ai_agent" },
      source: "mcp",
      source_app: "claude-code",
    });
  const first = db.get("ai_proposal", (await queue("note-a")).proposal_id);
  await refused(
    core.decideProposal({
      proposal_id: first.id,
      expected_version: first.version + 1,
      decision: "accept",
      said: "残して",
      ...who,
    }),
    "CONFLICT",
  );
  const accepted = await core.decideProposal({
    proposal_id: first.id,
    expected_version: first.version,
    decision: "accept",
    said: "そのメモ残しておいて",
    ...who,
  });
  assert.equal(accepted.proposal_status, "accepted");
  assert.equal(db.get("note", accepted.note.id).title, "会議のメモ note-a");

  const second = db.get("ai_proposal", (await queue("note-b")).proposal_id);
  const rejected = await core.decideProposal({
    proposal_id: second.id,
    expected_version: second.version,
    decision: "reject",
    said: "それは要らない",
    ...who,
  });
  assert.equal(rejected.proposal_status, "rejected");
  assert.equal(db.list("note").filter((note) => note.title === "会議のメモ note-b").length, 0);

  db.save("ai_proposal", {
    id: "items-proposal",
    source: "mcp",
    source_app: "old",
    payload_type: "items",
    payload: { items: [{ title: "x" }] },
    status: "pending",
    received_at: new Date().toISOString(),
  });
  await refused(
    core.decideProposal({
      proposal_id: "items-proposal",
      expected_version: db.get("ai_proposal", "items-proposal").version,
      decision: "accept",
      said: "採用して",
      ...who,
    }),
    "DECIDE_IN_DESKTOP",
  );
});

test("Noteの直接編集: 版を照合し、本人が書いたNoteは本人の言葉が要り、断るときは何も残さない", async (t) => {
  const { db, core } = await desktop(t);
  const note = db.save("note", {
    id: "note-human",
    title: "読書メモ",
    body_markdown: "最初の段落",
    note_type: "memo",
    project_id: "theme-personal-default",
  });
  const proposalsBefore = db.list("ai_proposal").length;
  await refused(
    core.editNote({
      note_id: note.id,
      base_version: note.version,
      body: "AIが書き換えた段落",
      why: "読みやすくする",
      idempotency_key: "edit-human-why",
      ...who,
    }),
    "ASK_USER",
  );
  assert.equal(db.list("ai_proposal").length, proposalsBefore, "断るときはProposalを残さない");
  assert.equal(db.get("note", note.id).body_markdown, "最初の段落");

  const request = {
    note_id: note.id,
    base_version: note.version,
    title: "読書メモ（要約つき）",
    body: "最初の段落\n\n要約: 三つの論点",
    said: "要約を足して",
    idempotency_key: "edit-human-said",
    ...who,
  };
  const edited = await core.editNote(request);
  assert.equal(edited.status, "applied");
  const saved = db.get("note", note.id);
  assert.equal(saved.title, "読書メモ（要約つき）");
  assert.equal(saved.body_markdown, "最初の段落\n\n要約: 三つの論点");
  const events = db.listChangeEventsByCommandId(edited.change_id);
  assert(
    events.some((event) => (event.record_type || event.entity_type) === "note"),
    JSON.stringify(
      events.map((event) => [event.record_type, event.entity_type, event.command_name]),
    ),
  );
  for (const event of events) assert.equal(event.metadata.ai_direct.said, "要約を足して");
  // 同じ鍵の再送は同じ結果。
  assert.equal((await core.editNote(request)).status, "duplicate");
  // 古い版からの編集は409。
  await refused(
    core.editNote({ ...request, idempotency_key: "edit-stale", body: "古い版から" }),
    "CONFLICT",
  );

  // AIが作って本人がまだ触っていないNoteは、本人の言葉なしで直せる。
  const created = await core.createAiItem({
    kind: "note",
    title: "AIのメモ",
    body: "下書き",
    caller: "Claude Code",
    idempotency_key: "ai-note",
  });
  const aiEdit = await core.editNote({
    note_id: created.entity.id,
    base_version: created.entity.version,
    body: "下書き（誤字を直した）",
    why: "誤字を直す",
    idempotency_key: "edit-ai-note",
    ...who,
  });
  assert.equal(aiEdit.status, "applied");
  assert.equal(db.get("note", created.entity.id).body_markdown, "下書き（誤字を直した）");
  // AIが直した後も、本人が触っていなければ続けて直せる。
  const again = await core.editNote({
    note_id: created.entity.id,
    base_version: aiEdit.note.version,
    body: "下書き（誤字を直し、段落を分けた）",
    why: "段落を分ける",
    idempotency_key: "edit-ai-note-2",
    ...who,
  });
  assert.equal(again.status, "applied");
});

test("設定が無効なら採否もNote編集も断る", async (t) => {
  const { db, core } = await desktop(t);
  db.setPreference("aiDirectWriteEnabled", false);
  await refused(
    core.editNote({
      note_id: "none",
      base_version: 1,
      body: "x",
      said: "x",
      idempotency_key: "off",
      ...who,
    }),
    "DIRECT_WRITE_DISABLED",
  );
  await refused(
    core.decideProposal({
      proposal_id: "none",
      expected_version: 1,
      decision: "accept",
      said: "x",
      ...who,
    }),
    "DIRECT_WRITE_DISABLED",
  );
});
