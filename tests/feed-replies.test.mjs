import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import { buildAttentionQueue, countAttention } from "../src/shared/contracts/task/public.ts";
import {
  buildPostsFromProposals,
  buildRepliesFromEntities,
  feedReplyEntity,
  postsForHome,
  postsForLearning,
  replyPostId,
  withReplies,
} from "../src/renderer/src/features/workspace/lib/feedPosts.ts";

/**
 * SNS型Feed 第3段階: 投稿への返信。
 *
 * 返信は投稿のIDに紐づく独立したEntity（`feed_reply`）で、人とAIの返答を同じスレッドへ並べる。
 * 返信してもTaskと未解決件数は変わらない。投稿（読み物Proposal）を削除したときは
 * 返信と読んだ印も一緒に外れ、復元で一緒に戻る。
 */

const POST_PROPOSAL = "proposal-feed-reply";
const POST_ID = `feed-post:${POST_PROPOSAL}`;
const AT = "2026-09-21T10:00:00.000Z";

function feedProposal() {
  return {
    id: POST_PROPOSAL,
    source: "mcp",
    source_app: "claude",
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
          body: ["平均が近くても、ばらつきまで同じとは限りません。"],
          evidence: [],
        },
      ],
    },
  };
}

function reply(id, overrides = {}) {
  return {
    id,
    post_id: POST_ID,
    body: "サンプル数が少ないときも同じ見方でよい？",
    created_at: AT,
    author_kind: "self",
    ...overrides,
  };
}

function feedPosts(database) {
  return buildPostsFromProposals({ proposals: database.list("ai_proposal", true) });
}

test("返信は親投稿の直後へ並び、AIの返答も同じスレッドで読める", () => {
  const posts = [
    ...feedPostsOf([feedProposal()]),
    ...buildRepliesFromEntities({
      replies: [
        reply("reply-self-1"),
        reply("reply-ai-1", {
          body: "3回以下のときは幅だけを見てください。",
          author_kind: "ai",
          author_label: "Codex",
          created_at: "2026-09-21T10:05:00.000Z",
        }),
      ],
    }),
  ];
  // 画面と同じ順序: 新着順のタイムラインへ、スレッドの中だけ古い順で差し込む。
  const ordered = withReplies(postsForHome(posts));
  assert.deepEqual(
    ordered.map((post) => post.id),
    [POST_ID, replyPostId("reply-self-1"), replyPostId("reply-ai-1")],
    "親の直後へ書かれた順に並ぶ",
  );
  const [parent, own, answer] = ordered;
  assert.equal(own.replyTo, POST_ID);
  assert.equal(own.author, "self");
  assert.equal(own.paragraphs[0], "サンプル数が少ないときも同じ見方でよい？");
  assert.equal(answer.author, "codex", "AIの返答は投稿元の表示名を使う");
  assert.equal(answer.replyTo, POST_ID);
  assert.equal(answer.kind, "own_note");

  // 学びタブは返信で水増ししない。
  assert.deepEqual(
    postsForLearning(posts).map((post) => post.id),
    [POST_ID],
  );
});

function feedPostsOf(proposals) {
  return buildPostsFromProposals({ proposals });
}

test("返信を保存しても要対応は増えない", () => {
  const proposals = [feedProposal()];
  const before = countAttention(buildAttentionQueue({ proposals }));
  const after = countAttention(buildAttentionQueue({ proposals }));
  assert.equal(before, 0, "読み物の投稿は判断ではない");
  assert.equal(after, 0);
});

test("返信は再起動後も残り、削除と復元ができる", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tasken-feed-reply-"));
  const dbPath = path.join(directory, "workspace.sqlite");
  let database = new WorkspaceDatabase(dbPath);
  try {
    database.loadWorkspace();
    database.save("ai_proposal", feedProposal());
    database.save(
      "feed_reply",
      feedReplyEntity({ id: "reply-1", postId: POST_ID, body: "質問です。", createdAt: AT }),
    );
    assert.equal(database.list("feed_reply").length, 1);
    assert.equal(database.list("feed_reply")[0].author_kind, "self");

    database.db.close();
    database = new WorkspaceDatabase(dbPath);
    database.loadWorkspace();
    const replies = buildRepliesFromEntities({ replies: database.list("feed_reply", true) });
    assert.equal(replies.length, 1, "再起動後も返信を読める");
    assert.equal(replies[0].replyTo, POST_ID);

    database.remove("feed_reply", "reply-1");
    assert.equal(
      buildRepliesFromEntities({ replies: database.list("feed_reply", true) }).length,
      0,
    );
    database.restore("feed_reply", "reply-1");
    assert.equal(
      buildRepliesFromEntities({ replies: database.list("feed_reply", true) }).length,
      1,
    );
  } finally {
    database.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("投稿を削除すると返信と読んだ印も外れ、復元で一緒に戻る", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tasken-feed-reply-cascade-"));
  const database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite"));
  try {
    database.loadWorkspace();
    database.save("ai_proposal", feedProposal());
    database.save(
      "feed_reply",
      feedReplyEntity({ id: "reply-1", postId: POST_ID, body: "質問です。", createdAt: AT }),
    );
    database.save("feed_reaction", {
      id: "feed-reaction-1",
      post_id: POST_ID,
      kind: "bookmark",
      created_at: AT,
    });
    // 別の投稿への返信は巻き込まない。
    database.save(
      "feed_reply",
      feedReplyEntity({
        id: "reply-other",
        postId: "feed-post:other",
        body: "別の投稿への返信。",
        createdAt: AT,
      }),
    );

    database.remove("ai_proposal", POST_PROPOSAL);
    assert.equal(database.list("feed_reply").length, 1, "投稿を消したら返信も外れる");
    assert.equal(database.list("feed_reply")[0].id, "reply-other");
    assert.equal(database.list("feed_reaction").length, 0);

    database.restore("ai_proposal", POST_PROPOSAL);
    assert.equal(database.list("feed_reply").length, 2, "復元で返信も戻る");
    assert.equal(database.list("feed_reaction").length, 1);
  } finally {
    database.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("不正な返信は保存しない", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tasken-feed-reply-bad-"));
  const database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite"));
  try {
    database.loadWorkspace();
    assert.throws(
      () => feedReplyEntity({ id: "r", postId: POST_ID, body: "   ", createdAt: AT }),
      /本文/u,
    );
    assert.throws(
      () => database.save("feed_reply", reply("bad-1", { body: "" })),
      /feed_reply\.body/u,
    );
    assert.throws(
      () => database.save("feed_reply", reply("bad-2", { post_id: "" })),
      /feed_reply\.post_id/u,
    );
    assert.throws(
      () => database.save("feed_reply", reply("bad-3", { created_at: "2026-09-21" })),
      /feed_reply\.created_at/u,
    );
    assert.throws(
      () => database.save("feed_reply", reply("bad-4", { author_kind: "robot" })),
      /feed_reply\.author_kind/u,
    );
  } finally {
    database.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
