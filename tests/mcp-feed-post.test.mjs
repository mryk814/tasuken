import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { build } from "esbuild";

import { buildAttentionQueue, countAttention } from "../src/shared/contracts/task/public.ts";
import {
  buildPostsFromProposals,
  draftNoteEntity,
  draftNoteId,
  feedReactionId,
  noteReferenceOf,
} from "../src/renderer/src/features/workspace/lib/feedPosts.ts";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";

async function importBundled(relativePaths) {
  const result = await build({
    stdin: {
      contents: relativePaths
        .map((relativePath, index) => `export * as bundled${index} from "./${relativePath}";`)
        .join("\n"),
      resolveDir: process.cwd(),
    },
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

const bundled = await importBundled([
  "src/main/services/applicationCommandService.ts",
  "src/main/composition/taskenCoreRuntime.ts",
]);
const { ApplicationCommandService } = bundled.bundled0;
const { TaskenCoreRuntime } = bundled.bundled1;

const THEME_ID = "theme-feed-post";
const TASK_ID = "task-feed-post";

function seedDatabase(database) {
  database.save("theme", { id: THEME_ID, name: "粘度測定の条件", ai_visibility: ["coding_agent"] });
  database.save("task", {
    id: TASK_ID,
    title: "保存のやり直しを直す",
    state: "todo",
    project_id: THEME_ID,
    today_date: "2026-09-21",
    updated_at: "2026-09-21T08:00:00.000Z",
  });
}

/**
 * SNS型Feed 第2段階: 実MCP経由で届いた投稿が、そのまま読めること。
 *
 * 実SQLite + 実stdio MCPを同じworkspaceへ向け、
 * 「投稿 → Proposalとして保存 → Feedの投影が読む → 要対応は増えない → 再送は増えない」を通す。
 */
async function withWorkspace(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-feed-post-mcp-"));
  const dbPath = path.join(root, "workspace.sqlite");
  const database = new WorkspaceDatabase(dbPath);
  database.loadWorkspace();
  seedDatabase(database);
  const application = new ApplicationCommandService(database);
  const runtime = new TaskenCoreRuntime(root, database, (envelope) =>
    application.execute(envelope),
  );
  await runtime.start();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["scripts/mcp-server.mjs"],
    env: {
      ...process.env,
      TASKEN_DB_PATH: dbPath,
      TASKEN_MCP_INBOX_PATH: path.join(root, "mcp-inbox"),
      TASKEN_USER_DATA_DIR: root,
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "tasken-mcp-feed-post", version: "1.0.0" });
  await client.connect(transport);
  try {
    return await run({ root, database, application, client });
  } finally {
    await client.close().catch(() => {});
    await runtime.stop().catch(() => {});
    database.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function callTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  return result.structuredContent;
}

function feedPosts(database) {
  return buildPostsFromProposals({
    proposals: database.list("ai_proposal", true),
    themes: database.list("theme", true),
    tasks: database.list("task", true),
  });
}

function attentionCount(database) {
  return countAttention(
    buildAttentionQueue({
      tasks: database.list("task", true),
      proposals: database.list("ai_proposal", true),
      receipts: database.list("work_receipt", true),
      themes: database.list("theme", true),
    }),
  );
}

test("MCPから届いた投稿は、採用を待たずにFeedで読めて、要対応を増やさない", async () => {
  await withWorkspace(async ({ database, client }) => {
    const before = attentionCount(database);

    const queued = await callTool(client, "tasken.propose_feed_post", {
      idempotency_key: "feed-post-idempotent-save",
      caller: "Codex",
      source_app: "codex",
      topic: "insight",
      body: [
        "保存をやり直しても、同じノートが増えないようにしました。",
        "効いたのは再送を止めることではなく、同じ依頼だと判別できることでした。",
      ],
      task_id: TASK_ID,
      theme: THEME_ID,
      attachment_label: "図: 再送の流れ",
      evidence: ["実装: src/main/services/applicationCommandService.ts"],
      article: {
        title: "「もう一度保存」に耐える設計",
        body: "保存ボタンを二度押しても増やさない。\n\n依頼に名前を付けると二度目を判別できる。",
        note_type: "memo",
      },
    });

    assert.equal(queued.payload_type, "feed_posts");
    assert.equal(typeof queued.proposal_id, "string");
    const stored = database.get("ai_proposal", queued.proposal_id);
    assert.equal(stored.status, "pending");
    assert.equal(stored.source, "mcp");

    // Feedは投稿として読み、Task・Themeの参照を保つ。
    const posts = feedPosts(database);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].id, `feed-post:${queued.proposal_id}`);
    assert.equal(posts[0].author, "codex");
    assert.equal(posts[0].kind, "insight");
    assert.equal(posts[0].learnable, true, "気づきは学びタブで読める");
    assert.equal(posts[0].taskId, TASK_ID);
    assert.equal(posts[0].taskTitle, "保存のやり直しを直す");
    assert.equal(posts[0].attachment?.kind, "note_draft");
    assert.equal(posts[0].attachment?.title, "「もう一度保存」に耐える設計");
    assert.equal(posts[0].attachment?.refLabel, "粘度測定の条件");
    assert.equal(posts[0].attachment?.figureLabel, "図: 再送の流れ");

    // 読むことは判断ではない。要対応の件数は変わらない。
    assert.equal(attentionCount(database), before);

    // 再送は同じProposalへ収束する。最近の投稿IDを添えても内容の同一性は崩れない。
    const retried = await callTool(client, "tasken.propose_feed_post", {
      idempotency_key: "feed-post-idempotent-save",
      caller: "Codex",
      source_app: "codex",
      topic: "insight",
      body: [
        "保存をやり直しても、同じノートが増えないようにしました。",
        "効いたのは再送を止めることではなく、同じ依頼だと判別できることでした。",
      ],
      task_id: TASK_ID,
      theme: THEME_ID,
      attachment_label: "図: 再送の流れ",
      evidence: ["実装: src/main/services/applicationCommandService.ts"],
      article: {
        title: "「もう一度保存」に耐える設計",
        body: "保存ボタンを二度押しても増やさない。\n\n依頼に名前を付けると二度目を判別できる。",
        note_type: "memo",
      },
      recent_post_ids: [`feed-post:${queued.proposal_id}`],
    });
    assert.equal(retried.status, "duplicate");
    assert.equal(retried.proposal_id, queued.proposal_id);
    assert.equal(feedPosts(database).length, 1, "再送で投稿は増えない");
    assert.equal(attentionCount(database), before);

    // 違う内容は別の投稿として届く。
    const second = await callTool(client, "tasken.propose_feed_post", {
      idempotency_key: "feed-post-short",
      caller: "Codex",
      source_app: "codex",
      topic: "work_report",
      body: ["比較表を作り直しました。40℃では差が広がりませんでした。"],
      task_id: TASK_ID,
    });
    assert.equal(second.status, "queued");
    const both = feedPosts(database);
    assert.equal(both.length, 2);
    assert.equal(both[0].attachment, null);
    assert.equal(attentionCount(database), before, "作業報告の投稿も判断ではない");
  });
});

test("同じidempotency_keyへ違う投稿は送れない", async () => {
  await withWorkspace(async ({ database, client }) => {
    await callTool(client, "tasken.propose_feed_post", {
      idempotency_key: "feed-post-conflict",
      caller: "Codex",
      source_app: "codex",
      topic: "insight",
      body: ["最初の投稿です。"],
    });
    const conflict = await client.callTool({
      name: "tasken.propose_feed_post",
      arguments: {
        idempotency_key: "feed-post-conflict",
        caller: "Codex",
        source_app: "codex",
        topic: "insight",
        body: ["別の内容です。"],
      },
    });
    assert.equal(conflict.isError, true, JSON.stringify(conflict));
    assert.match(JSON.stringify(conflict.content), /idempotency_key/u);
    assert.equal(feedPosts(database).length, 1);
  });
});

test("投稿は「採用が必要なProposal」と混同させず、再送の防ぎ方も正しく案内する", async () => {
  await withWorkspace(async ({ client }) => {
    // 接続時の説明が、Feedの読み物と採用待ちProposalを分けている。
    const instructions = String(client.getInstructions() || "");
    assert.match(instructions, /propose_feed_post/u);
    assert.match(instructions, /NOT pending decisions/u);
    assert.match(instructions, /accepting them is not required/u);
    assert.match(instructions, /queues a Proposal/u);
    // AIに見える画面名は現行の表示名へ揃える（旧称を使わない）。
    assert.doesNotMatch(instructions, /AI Inbox/u);

    const tools = await client.listTools();
    const staleScreenNames = tools.tools.filter((tool) =>
      /AI Inbox/u.test(String(tool.description || "")),
    );
    assert.deepEqual(
      staleScreenNames.map((tool) => tool.name),
      [],
      "tool説明に旧画面名を残さない",
    );
    const feedTool = tools.tools.find((tool) => tool.name === "tasken.propose_feed_post");
    assert.ok(feedTool, "tasken.propose_feed_post が公開されている");
    assert.match(feedTool.description, /appears in Feed as soon as this call succeeds/u);
    assert.match(feedTool.description, /does not need to accept it/u);
    assert.doesNotMatch(feedTool.description, /recent post ids in/u);

    const properties = feedTool.inputSchema.properties;
    // recent_post_ids へ自動の重複排除を約束させない。
    assert.match(String(properties.recent_post_ids.description), /does not compare them/u);
    assert.match(String(properties.recent_post_ids.description), /does not prevent a duplicate/u);
    // 再送はkeyの再利用で防ぐと説明する。
    assert.match(String(properties.idempotency_key.description), /Reuse the same value/u);
    assert.match(String(properties.idempotency_key.description), /generates a new key/u);

    const queued = await callTool(client, "tasken.propose_feed_post", {
      idempotency_key: "feed-post-message-boundary",
      caller: "Codex",
      source_app: "codex",
      topic: "insight",
      body: ["応答の文言を確かめます。"],
    });
    assert.equal(queued.status, "queued");
    assert.doesNotMatch(queued.message, /Previewして採用/u, "投稿は採用操作を求めない");
    assert.match(queued.message, /採用を待たずに読めます/u);

    const retried = await callTool(client, "tasken.propose_feed_post", {
      idempotency_key: "feed-post-message-boundary",
      caller: "Codex",
      source_app: "codex",
      topic: "insight",
      body: ["応答の文言を確かめます。"],
    });
    assert.equal(retried.status, "duplicate");
    assert.match(retried.message, /新しい投稿は増えていません/u);

    // 採用が必要なNote提案は、これまでどおりPreviewと採用を案内する。
    const note = await callTool(client, "tasken.propose_note", {
      idempotency_key: "note-message-boundary",
      caller: "Codex",
      source_app: "codex",
      title: "応答の文言",
      body: "採用が必要なことを確かめる。",
    });
    assert.equal(note.status, "queued");
    assert.match(note.message, /Previewして採用してください/u);
  });
});

const DRAFT_BODY =
  "保存ボタンを二度押しても増やさない。\n\n依頼に名前を付けると二度目を判別できる。";

function acceptEnvelope(proposal, candidates, commandId) {
  return {
    commandId,
    name: "ApplyAiProposal",
    payload: { proposal: { ...proposal, status: "accepted" }, candidates },
    actor: { kind: "user", id: "fixture-desktop" },
    source: "main_ui",
    expectedVersions: [
      { type: "ai_proposal", id: proposal.id, version: Number(proposal.version || 0) },
    ],
    issuedAt: proposal.received_at,
  };
}

test("記事の草稿は「Noteに保存」で正式Noteになり、投稿とブックマークは残る", async () => {
  await withWorkspace(async ({ database, application, client }) => {
    const before = attentionCount(database);
    const queued = await callTool(client, "tasken.propose_feed_post", {
      idempotency_key: "feed-post-save-note",
      caller: "Codex",
      source_app: "codex",
      topic: "learning",
      body: ["不確かさの書き方を調べました。"],
      theme: THEME_ID,
      article: { title: "不確かさを記録に残す手順", body: DRAFT_BODY, note_type: "memo" },
    });
    const post = feedPosts(database).find((entry) => entry.proposalId === queued.proposal_id);
    assert.ok(post, "投稿として読める");

    // 読者の状態（ブックマーク）は投稿の安定IDに結び付く。
    database.save("feed_reaction", {
      id: feedReactionId(post.id, "bookmark"),
      post_id: post.id,
      kind: "bookmark",
      created_at: "2026-09-21T10:00:00.000Z",
    });

    // 読むだけでは正式Noteを作らない。
    assert.equal(database.list("note").length, 0);
    const note = draftNoteEntity(post);
    assert.ok(note);

    const proposal = database.get("ai_proposal", queued.proposal_id);
    application.execute(
      acceptEnvelope(
        proposal,
        [{ type: "note", entity: note }],
        `feed-post:${queued.proposal_id}:save-note:v${proposal.version}`,
      ),
    );

    const saved = database.get("note", note.id);
    assert.equal(saved.title, "不確かさを記録に残す手順");
    assert.equal(saved.body_markdown, DRAFT_BODY, "送られた本文をそのまま保存する");
    assert.equal(saved.project_id, THEME_ID);
    assert.equal(
      saved.accepted_from_proposal_id,
      queued.proposal_id,
      "採用で作られたEntityは、どのProposalから生まれたかを保持する",
    );
    assert.equal(database.get("ai_proposal", queued.proposal_id).status, "accepted");

    // 採用後も同じIDの投稿として読め、読んだ印も残る。
    const after = feedPosts(database).find((entry) => entry.proposalId === queued.proposal_id);
    assert.ok(after, "採用しても投稿は残る");
    assert.equal(after.id, post.id);
    assert.equal(draftNoteId(after), note.id, "草稿の解決先がNoteへ変わる");
    assert.equal(
      database.list("feed_reaction").filter((row) => row.post_id === post.id).length,
      1,
      "ブックマークは投稿のIDのまま",
    );
    assert.equal(attentionCount(database), before);
  });
});

test("受領IDからProposalの採否と作成Entityを確認でき、再送を促さない", async () => {
  await withWorkspace(async ({ database, application, client }) => {
    const queued = await callTool(client, "tasken.propose_feed_post", {
      idempotency_key: "feed-post-status",
      caller: "Codex",
      source_app: "codex",
      topic: "insight",
      body: ["状態を確認できるかを試します。"],
      article: { title: "状態照会の対象", body: DRAFT_BODY, note_type: "memo" },
    });

    // 未採用: 判断待ちであることだけを返し、Entityは返さない。
    const pending = await callTool(client, "tasken.get_proposal_status", {
      proposal_id: queued.proposal_id,
    });
    assert.equal(pending.schema, "tasken-proposal-status/v1");
    assert.equal(pending.found, true);
    assert.equal(pending.status, "pending");
    assert.equal(pending.awaiting_review, true);
    assert.equal(pending.payload_type, "feed_posts");
    assert.equal(pending.source_app, "codex");
    assert.deepEqual(pending.created_entities, []);
    assert.equal(pending.resolved_by, "none");
    // この応答はこのnodeの正本であり、他端末への配送は確認していない。
    assert.equal(pending.view.canonical_node, "this_node");
    assert.equal(pending.view.delivery_confirmed, false);
    assert.equal(pending.view.device_id, database.deviceId);

    // 採用: 作成されたEntityをbacklinkから返す。
    const post = feedPosts(database).find((entry) => entry.proposalId === queued.proposal_id);
    const note = draftNoteEntity(post);
    const proposal = database.get("ai_proposal", queued.proposal_id);
    application.execute(
      acceptEnvelope(
        proposal,
        [{ type: "note", entity: note }],
        `feed-post:${queued.proposal_id}:status:v${proposal.version}`,
      ),
    );

    const accepted = await callTool(client, "tasken.get_proposal_status", {
      proposal_id: queued.proposal_id,
    });
    assert.equal(accepted.status, "accepted");
    assert.equal(accepted.awaiting_review, false);
    assert.equal(accepted.resolved_by, "created_backlink");
    assert.deepEqual(accepted.created_entities, [
      { type: "note", id: note.id, title: "状態照会の対象" },
    ]);

    // 知らないIDは「無い」と返し、状態を推測しない。
    const missing = await callTool(client, "tasken.get_proposal_status", {
      proposal_id: "00000000-0000-4000-8000-000000000000",
    });
    assert.equal(missing.found, false);
    assert.equal(missing.status, null);
    assert.equal(missing.awaiting_review, false);
    assert.deepEqual(missing.created_entities, []);
  });
});

test("採用済みのNoteを削除すると参照先がないと分かり、元に戻すと同じ参照が開ける", async () => {
  await withWorkspace(async ({ database, application, client }) => {
    const queued = await callTool(client, "tasken.propose_feed_post", {
      idempotency_key: "feed-post-note-removed",
      caller: "Codex",
      source_app: "codex",
      topic: "learning",
      body: ["参照先が消えたときの見え方を確かめます。"],
      theme: THEME_ID,
      article: { title: "参照の切れ方", body: DRAFT_BODY, note_type: "memo" },
    });
    const post = feedPosts(database).find((entry) => entry.proposalId === queued.proposal_id);
    const note = draftNoteEntity(post);
    assert.ok(note);
    // 採用前は草稿のまま読める。
    assert.equal(noteReferenceOf(post, null), "draft");

    const proposal = database.get("ai_proposal", queued.proposal_id);
    application.execute(
      acceptEnvelope(
        proposal,
        [{ type: "note", entity: note }],
        `feed-post:${queued.proposal_id}:save-note:v${proposal.version}`,
      ),
    );

    const currentPost = () =>
      feedPosts(database).find((entry) => entry.proposalId === queued.proposal_id);
    const currentNote = () => database.get("note", note.id) ?? null;
    assert.equal(currentPost().proposalStatus, "accepted");
    assert.equal(noteReferenceOf(currentPost(), currentNote()), "saved");

    // Noteを削除しても投稿と草稿は残り、参照先がないことが分かる。
    database.remove("note", note.id);
    const removedPost = currentPost();
    assert.ok(removedPost, "Noteを削除しても投稿は残る");
    assert.equal(removedPost.draft.markdown, DRAFT_BODY, "草稿の本文は投稿に残る");
    assert.equal(noteReferenceOf(removedPost, currentNote()), "missing");

    // 元に戻すと同じIDのNoteが戻るので、同じ参照からまた読める。
    database.restore("note", note.id);
    assert.equal(currentNote().id, note.id);
    assert.equal(noteReferenceOf(currentPost(), currentNote()), "saved");
  });
});

test("読み物のpayloadだけでは正式データを変更できない", async () => {
  await withWorkspace(async ({ database, application, client }) => {
    // 本文にTaskの変更を紛れ込ませた投稿を、MCPの入力（スキーマ）を通さず直接保存する。
    const queued = await callTool(client, "tasken.propose_feed_post", {
      idempotency_key: "feed-post-boundary",
      caller: "Codex",
      source_app: "codex",
      topic: "insight",
      body: ["本文だけの投稿です。"],
      task_id: TASK_ID,
    });
    const stored = database.get("ai_proposal", queued.proposal_id);
    database.save("ai_proposal", {
      ...stored,
      payload: {
        feed_posts: [
          {
            ...stored.payload.feed_posts[0],
            task_state: "done",
            notes: [{ action: "create", title: "勝手に作られるNote" }],
          },
        ],
      },
    });

    const beforeTask = database.get("task", TASK_ID);
    const proposal = database.get("ai_proposal", queued.proposal_id);
    application.execute(acceptEnvelope(proposal, [], `feed-post:${queued.proposal_id}:accept`));

    assert.equal(database.list("note").length, 0, "payloadのnotesは作られない");
    const afterTask = database.get("task", TASK_ID);
    assert.equal(afterTask.state, beforeTask.state);
    assert.equal(afterTask.version, beforeTask.version);
    assert.equal(database.get("ai_proposal", queued.proposal_id).status, "accepted");
  });
});
