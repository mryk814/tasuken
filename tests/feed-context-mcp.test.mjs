import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { build } from "esbuild";

import { TASKEN_CORE_GET_FEED_CONTEXT_CAPABILITY } from "../src/shared/contracts/core/public.mjs";
import { TaskenCoreClient } from "../src/main/mcp/taskenCoreClient.mjs";
import { buildAttentionQueue, countAttention } from "../src/shared/contracts/task/public.ts";
import {
  buildPostsFromProposals,
  buildRepliesFromEntities,
  postsForHome,
  replyPostId,
  withReplies,
} from "../src/renderer/src/features/workspace/lib/feedPosts.ts";

const workspaceRepositoryModule = "../src/main/repositories/" + "workspaceRepository.mjs";
const { WorkspaceDatabase } = await import(workspaceRepositoryModule);

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

const { TaskenCoreHost } = await importBundled("src/main/infrastructure/http/taskenCoreHost.ts");
const { createTaskenCore } = await importBundled("src/main/infrastructure/sqlite/public.ts");
const { FeedContextQueryService } = await importBundled(
  "src/main/core/services/feedContextQueryService.ts",
);

/**
 * SNS型Feed 第3段階: 質問を外部AIへ渡す読み出し。
 *
 * 利用者が「AIに聞く」で残した質問と、その元になった投稿を、Core経由の
 * 読み出し専用tool（`tasken.get_feed_context`）で外部AIが読めるようにする。
 * 正式データは変更せず、要対応の判断も増やさない。
 */

const AT = "2026-09-21T10:00:00.000Z";
const POST_PROPOSAL = "proposal-feed-context";
const POST_ID = `feed-post:${POST_PROPOSAL}`;

function feedProposal(overrides = {}) {
  return {
    id: POST_PROPOSAL,
    source: "mcp",
    source_app: "codex",
    payload_type: "feed_posts",
    status: "pending",
    received_at: AT,
    created_at: AT,
    version: 1,
    payload: {
      feed_posts: [
        {
          action: "publish",
          topic: "insight",
          body: [
            "保存をやり直しても増えないようにしました。",
            "同じ依頼だと判別できることが効きました。",
          ],
          task_id: "task-1",
          theme: "theme-1",
          evidence: [],
        },
      ],
    },
    request: { idempotency_key: "feed-context", source: "mcp", caller: "Codex" },
    ...overrides,
  };
}

function stubPort(workspace) {
  return { readFeedContextSnapshot: () => ({ workspace }) };
}

test("未回答の質問だけを、元の投稿の抜粋つきで返す", () => {
  const service = new FeedContextQueryService(
    stubPort({
      ai_proposals: [feedProposal()],
      feed_replies: [
        {
          id: "question-open",
          post_id: POST_ID,
          body: "サンプル数が少ないときも同じ見方でよい？",
          created_at: AT,
          author_kind: "self",
          ai_requested_at: "2026-09-21T10:10:00.000Z",
        },
        {
          id: "question-answered",
          post_id: POST_ID,
          body: "こちらは回答済みです。",
          created_at: "2026-09-21T10:20:00.000Z",
          author_kind: "self",
          ai_requested_at: "2026-09-21T10:20:00.000Z",
        },
        {
          id: "answer-1",
          post_id: POST_ID,
          body: "3回以下なら幅だけを見てください。",
          created_at: "2026-09-21T10:30:00.000Z",
          author_kind: "ai",
          author_label: "Codex",
          reply_to: "question-answered",
        },
        // AIへ向けていない普通の返信は質問ではない。
        { id: "chat-1", post_id: POST_ID, body: "なるほど。", created_at: AT, author_kind: "self" },
      ],
      feed_reactions: [
        { id: "r1", post_id: POST_ID, kind: "bookmark", created_at: AT },
        { id: "r2", post_id: POST_ID, kind: "interesting", created_at: AT },
        { id: "r3", post_id: POST_ID, kind: "hidden", created_at: AT },
      ],
    }),
  );

  const result = service.execute({});
  assert.equal(result.read_only, true);
  assert.deepEqual(
    result.questions.map((question) => question.id),
    ["question-open"],
    "回答済みは既定で返さない",
  );
  const question = result.questions[0];
  assert.equal(question.post_id, POST_ID);
  assert.equal(question.answered, false);
  assert.equal(question.post?.id, POST_ID);
  assert.equal(question.post?.author, "codex");
  assert.equal(question.post?.task_id, "task-1");
  assert.match(question.post?.excerpt || "", /保存をやり直しても/u);

  const withAnswered = service.execute({ include_answered: true });
  assert.deepEqual(
    withAnswered.questions.map((question) => [question.id, question.answered]),
    [
      ["question-open", false],
      ["question-answered", true],
    ],
  );

  // 既出の題材と明示的な反応。非表示は反応として数えない。
  assert.deepEqual(
    result.recent_posts.map((post) => post.id),
    [POST_ID],
  );
  assert.deepEqual(result.reactions.bookmarked_post_ids, [POST_ID]);
  assert.deepEqual(result.reactions.interesting_post_ids, [POST_ID]);
  assert.equal(result.result_meta.truncated, false);
});

test("本文は抜粋だけを返し、上限で切り詰める", () => {
  const long = "あ".repeat(900);
  const service = new FeedContextQueryService(
    stubPort({
      ai_proposals: [
        feedProposal({
          payload: { feed_posts: [{ action: "publish", topic: "learning", body: [long] }] },
        }),
      ],
      feed_replies: [],
      feed_reactions: [],
    }),
  );
  const result = service.execute({ max_chars: 120 });
  assert.equal(result.max_chars, 120);
  const excerpt = result.recent_posts[0]?.excerpt || "";
  assert.equal(excerpt.length, 121, "上限＋省略記号");
  assert.match(excerpt, /…$/u);

  const limited = service.execute({ limit: 1, max_chars: 4_000 });
  assert.equal(limited.limit, 1);
  assert.equal(limited.recent_posts.length, 1);
});

test("実SQLite + 実Core + 実stdio MCPで、AIが質問と題材を読める", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-feed-context-"));
  fs.chmodSync(root, 0o700);
  const dbPath = path.join(root, "workspace.sqlite3");
  const database = new WorkspaceDatabase(dbPath);
  database.loadWorkspace();
  database.save("theme", { id: "theme-1", name: "高分子材料評価" });
  database.save("ai_proposal", feedProposal());
  database.save("feed_reply", {
    id: "question-1",
    post_id: POST_ID,
    body: "サンプル数が少ないときも同じ見方でよい？",
    created_at: AT,
    author_kind: "self",
    ai_requested_at: "2026-09-21T10:10:00.000Z",
  });
  database.save("feed_reaction", {
    id: "reaction-1",
    post_id: POST_ID,
    kind: "bookmark",
    created_at: AT,
  });

  const host = new TaskenCoreHost({ userDataPath: root, ...createTaskenCore(database) });
  await host.start();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["scripts/mcp-server.mjs"],
    env: {
      ...process.env,
      TASKEN_USER_DATA_DIR: root,
      TASKEN_MCP_INBOX_PATH: path.join(root, "legacy-inbox-must-not-exist"),
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "tasken-feed-context-test", version: "1.0.0" });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    assert.ok(
      listed.tools.some((tool) => tool.name === "tasken.get_feed_context"),
      JSON.stringify(listed.tools.map((tool) => tool.name)),
    );
    // Coreのdiscoveryは呼べる操作を個別に広告する。
    const inspected = await new TaskenCoreClient({ userDataPath: root }).inspect();
    assert.equal(inspected.status, "ok");
    assert.equal(
      inspected.capabilities.includes(TASKEN_CORE_GET_FEED_CONTEXT_CAPABILITY),
      true,
      JSON.stringify(inspected.capabilities),
    );

    const result = await client.callTool({
      name: "tasken.get_feed_context",
      arguments: {},
    });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    const context = result.structuredContent;
    assert.equal(context.read_only, true);
    assert.deepEqual(
      context.questions.map((question) => question.id),
      ["question-1"],
    );
    assert.match(context.questions[0].post.excerpt, /保存をやり直しても/u);
    assert.deepEqual(context.reactions.bookmarked_post_ids, [POST_ID]);

    // 読み出しは正式データを変えない。
    const before = database.list("ai_proposal", true).length;
    await client.callTool({
      name: "tasken.get_feed_context",
      arguments: { include_answered: true },
    });
    assert.equal(database.list("ai_proposal", true).length, before);
    assert.equal(database.get("ai_proposal", POST_PROPOSAL).status, "pending");

    // 不正な引数は境界で拒否する。
    const invalid = await client.callTool({
      name: "tasken.get_feed_context",
      arguments: { limit: 500 },
    });
    assert.equal(invalid.isError, true, JSON.stringify(invalid));

    // 質問へ返答すると、同じスレッドで読める形で届き、質問は回答済みになる。
    const answered = await client.callTool({
      name: "tasken.answer_feed_question",
      arguments: {
        idempotency_key: "feed-answer-1",
        caller: "Codex",
        source_app: "codex",
        post_id: POST_ID,
        reply_to: "question-1",
        body: "3回以下のときは幅だけを見てください。",
        author_label: "Codex",
      },
    });
    assert.equal(answered.isError, undefined, JSON.stringify(answered));
    assert.equal(answered.structuredContent.payload_type, "feed_replies");
    const stored = database.get("ai_proposal", answered.structuredContent.proposal_id);
    assert.equal(stored.status, "pending");
    assert.equal(stored.source, "mcp");

    // 返答も要対応の判断ではない。
    assert.equal(
      countAttention(
        buildAttentionQueue({
          proposals: database.list("ai_proposal", true),
          tasks: database.list("task", true),
        }),
      ),
      0,
    );

    // 回答済みは既定の読み出しから外れ、include_answeredで状態が分かる。
    const afterAnswer = await client.callTool({
      name: "tasken.get_feed_context",
      arguments: {},
    });
    assert.deepEqual(afterAnswer.structuredContent.questions, []);
    const withAnswered = await client.callTool({
      name: "tasken.get_feed_context",
      arguments: { include_answered: true },
    });
    assert.deepEqual(
      withAnswered.structuredContent.questions.map((question) => [question.id, question.answered]),
      [["question-1", true]],
    );

    // Feedの投影は、返答を元の投稿のスレッドへ入れ、質問を「回答あり」にする。
    const answerId = `feed-answer:${answered.structuredContent.proposal_id}`;
    const thread = withReplies(
      postsForHome([
        ...buildPostsFromProposals({ proposals: database.list("ai_proposal", true) }),
        ...buildRepliesFromEntities({
          replies: database.list("feed_reply", true),
          proposals: database.list("ai_proposal", true),
        }),
      ]),
    );
    const threadIds = thread.map((post) => post.id);
    assert.equal(threadIds[0], POST_ID, "親投稿が先頭");
    assert.deepEqual(
      [...threadIds.slice(1)].sort(),
      [answerId, replyPostId("question-1")].sort(),
      "質問と返答が同じスレッドへ入る",
    );
    assert.equal(thread.find((post) => post.id === replyPostId("question-1"))?.aiState, "answered");
    assert.match(
      thread.find((post) => post.id === answerId)?.paragraphs[0] || "",
      /3回以下のときは幅だけ/u,
    );

    // 同じidempotency_keyの再送は増えない。
    const retried = await client.callTool({
      name: "tasken.answer_feed_question",
      arguments: {
        idempotency_key: "feed-answer-1",
        caller: "Codex",
        source_app: "codex",
        post_id: POST_ID,
        reply_to: "question-1",
        body: "3回以下のときは幅だけを見てください。",
        author_label: "Codex",
      },
    });
    assert.equal(retried.structuredContent.status, "duplicate");
    assert.equal(
      database
        .list("ai_proposal", true)
        .filter((proposal) => proposal.payload_type === "feed_replies").length,
      1,
    );
  } finally {
    await client.close().catch(() => {});
    await host.stop().catch(() => {});
    database.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
