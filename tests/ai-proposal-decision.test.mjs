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
  runtime.enableAiTaskChange(createAiTaskChangeService(db, commands, isEnabled));
  runtime.enableAiDirectWrite(
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
  return { db, workspace, core: new TaskenCoreClient({ userDataPath: dir }) };
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

async function reportedTask(db, core, action = "report_done") {
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
    ...(action === "report_blocked"
      ? { blocker: "原本の場所が分からない" }
      : { summary: "誤字を3か所直した" }),
    work_attempt_id: "6a1b8d2e-3c4f-4a5b-8c6d-7e8f9a0b1c2d",
    action,
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
  // 採用の内側で続けて実行した記録（作業の記録・受領）にも、同じ根拠が付く。
  const inner = [...db.changeEventCommandIdsWithPrefix(`${decided.change_id}:`)];
  assert(inner.length > 0);
  const events = [decided.change_id, ...inner].flatMap((id) => db.listChangeEventsByCommandId(id));
  assert(events.length > 1);
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

test("レビューの指摘: 止まった報告の採用でcomplete_taskを付けると、書く前に断る", async (t) => {
  const { db, core } = await desktop(t);
  const proposal = await reportedTask(db, core, "report_blocked");
  await refused(
    core.decideProposal({
      proposal_id: proposal.id,
      expected_version: proposal.version,
      decision: "accept",
      complete_task: true,
      said: "完了にして",
      ...who,
    }),
    "INVALID_TRANSITION",
  );
  assert.equal(db.get("ai_proposal", proposal.id).status, "pending");
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
  // 却下したものを、同じ版で採用に決め直すことはできない。
  await refused(
    core.decideProposal({
      proposal_id: second.id,
      expected_version: second.version,
      decision: "accept",
      said: "やっぱり残して",
      ...who,
    }),
    "ALREADY_DECIDED",
  );
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

/** 全文を読んだときにだけ返る、本文の署名。 */
async function fullRead(core, noteId) {
  const read = await core.getNote({ note_id: noteId });
  assert.equal(read.truncated, false);
  return { base_version: read.note.version, base_signature: read.body_signature };
}

test("Noteの直接編集: 版と全文の署名を照合し、本人が書いたNoteは本人の言葉が要り、断るときは何も残さない", async (t) => {
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
      ...(await fullRead(core, note.id)),
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
    ...(await fullRead(core, note.id)),
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
  assert(events.some((event) => (event.record_type || event.entity_type) === "note"));
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
    ...(await fullRead(core, created.entity.id)),
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
    ...(await fullRead(core, created.entity.id)),
    body: "下書き（誤字を直し、段落を分けた）",
    why: "段落を分ける",
    idempotency_key: "edit-ai-note-2",
    ...who,
  });
  assert.equal(again.status, "applied");
  // 本人の言葉で一度決めたNoteは、次から本人の言葉が要る（Taskと同じ）。
  await core.editNote({
    note_id: created.entity.id,
    ...(await fullRead(core, created.entity.id)),
    body: "本人が決めた本文",
    said: "本文はこれにして",
    idempotency_key: "edit-ai-note-said",
    ...who,
  });
  await refused(
    core.editNote({
      note_id: created.entity.id,
      ...(await fullRead(core, created.entity.id)),
      body: "AIの本文",
      why: "整える",
      idempotency_key: "edit-ai-note-why",
      ...who,
    }),
    "ASK_USER",
  );
});

test("レビューの指摘: 切り詰めた読み取りから書くと断り、Noteの残りを消さない", async (t) => {
  const { db, core } = await desktop(t);
  const body = Array.from({ length: 40 }, (_, index) => `段落${index}`).join("\n\n");
  const note = db.save("note", {
    id: "note-long",
    title: "長いメモ",
    body_markdown: body,
    note_type: "memo",
    project_id: "theme-personal-default",
  });
  const partial = await core.getNote({ note_id: note.id, max_text_length: 50 });
  assert.equal(partial.truncated, true);
  assert.equal(partial.body_signature, null);
  await refused(
    core.editNote({
      note_id: note.id,
      base_version: partial.note.version,
      base_signature: "made-up",
      body: `${partial.note.body_markdown}\n\n追記`,
      said: "追記して",
      idempotency_key: "edit-truncated",
      ...who,
    }),
    "BODY_NOT_FULLY_READ",
  );
  assert.equal(db.get("note", note.id).body_markdown, body);
  assert.equal(
    db.list("ai_proposal").filter((proposal) => proposal.payload_type === "notes").length,
    0,
  );
});

test("レビューの指摘: 採用が保存で失敗したら、保留の提案を残さずSAVE_FAILED", async (t) => {
  const { db, core, workspace } = await desktop(t);
  const note = db.save("note", {
    id: "note-fail",
    title: "メモ",
    body_markdown: "本文",
    note_type: "memo",
    project_id: "theme-personal-default",
  });
  const original = workspace.saveCanonicalNote;
  workspace.saveCanonicalNote = () => {
    throw new Error("disk full");
  };
  try {
    await refused(
      core.editNote({
        note_id: note.id,
        ...(await fullRead(core, note.id)),
        body: "新しい本文",
        said: "直して",
        idempotency_key: "edit-fail",
        ...who,
      }),
      "SAVE_FAILED",
    );
  } finally {
    workspace.saveCanonicalNote = original;
  }
  assert.equal(
    db.list("ai_proposal").filter((proposal) => proposal.status === "pending").length,
    0,
  );
  assert.equal(db.get("note", note.id).body_markdown, "本文");
});

test("設定が無効なら採否もNote編集も断る", async (t) => {
  const { db, core } = await desktop(t);
  db.setPreference("aiDirectWriteEnabled", false);
  await refused(
    core.editNote({
      note_id: "none",
      base_version: 1,
      base_signature: "x",
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
