import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import {
  buildAttentionQueue,
  countAttention,
  isReadingMaterialProposal,
} from "../src/shared/contracts/task/public.ts";
import {
  buildPostsFromProposals,
  feedReactionId,
  postsBookmarked,
} from "../src/renderer/src/features/workspace/lib/feedPosts.ts";

/**
 * SNS型Feed 第2段階: AIから届いた読み物Proposalを、Feedが読める形へ写す。
 *
 * 投稿は**要対応の判断ではない**（`buildAttentionQueue` が除外する）。
 * 記事を採用しても投稿は残り、出所のIDで追跡する。
 */

function feedProposal(overrides = {}) {
  return {
    id: "proposal-feed-1",
    source: "mcp",
    source_app: "codex",
    payload_type: "feed_posts",
    status: "pending",
    received_at: "2026-09-21T10:00:00.000Z",
    created_at: "2026-09-21T10:00:00.000Z",
    request: { caller: "Codex", tool: "tasken.propose_feed_post" },
    payload: {
      feed_posts: [
        {
          action: "publish",
          topic: "insight",
          body: [
            "保存をやり直しても増えないようにしました。",
            "同じ依頼だと判別できれば再送を止められます。",
          ],
          task_id: "task-note-save",
          theme: "theme-materials",
          article: {
            title: "「もう一度保存」に耐える設計",
            body: "保存を二度押しても増やさない。\n\n依頼に名前を付けると二度目を判別できる。",
            note_type: "memo",
          },
          attachment_label: "図: 再送の流れ",
          evidence: ["実装: src/main/services/applicationCommandService.ts"],
        },
      ],
    },
    ...overrides,
  };
}

test("読み物Proposalを投稿へ写し、記事の草稿も読める形にする", () => {
  const posts = buildPostsFromProposals({
    proposals: [feedProposal()],
    themes: [{ id: "theme-materials", name: "高分子材料評価" }],
    tasks: [{ id: "task-note-save", title: "ノートの保存を直す" }],
  });

  assert.equal(posts.length, 1);
  const post = posts[0];
  assert.equal(post.id, "feed-post:proposal-feed-1");
  assert.equal(post.author, "codex");
  assert.equal(post.kind, "insight");
  assert.equal(post.learnable, true);
  assert.equal(post.createdAt, "2026-09-21T10:00:00.000Z");
  assert.deepEqual(post.paragraphs, [
    "保存をやり直しても増えないようにしました。",
    "同じ依頼だと判別できれば再送を止められます。",
  ]);
  assert.equal(post.attachment?.kind, "note_draft");
  assert.equal(post.attachment?.title, "「もう一度保存」に耐える設計");
  // 記事の本文は段落へ分けて読める。
  assert.deepEqual(post.attachment?.articleBody, [
    "保存を二度押しても増やさない。",
    "依頼に名前を付けると二度目を判別できる。",
  ]);
  assert.equal(post.attachment?.figureLabel, "図: 再送の流れ");
  assert.equal(post.attachment?.refLabel, "高分子材料評価");
  assert.equal(post.proposalId, "proposal-feed-1");
  assert.equal(post.taskTitle, "ノートの保存を直す");
  assert.deepEqual(post.evidence, ["実装: src/main/services/applicationCommandService.ts"]);
});

test("投稿は要対応の件数を増やさない。一般のNote提案は従来どおり判断待ちに残る", () => {
  const feed = feedProposal();
  const note = {
    id: "proposal-note-1",
    source: "mcp",
    source_app: "codex",
    payload_type: "notes",
    status: "pending",
    received_at: "2026-09-21T10:05:00.000Z",
    request: { caller: "Codex" },
    payload: { notes: [{ action: "create", title: "Note", body: "本文" }] },
  };

  assert.equal(isReadingMaterialProposal(feed), true);
  assert.equal(isReadingMaterialProposal(note), false);

  const onlyFeed = buildAttentionQueue({ proposals: [feed] });
  assert.equal(countAttention(onlyFeed), 0, "読み物の投稿は判断ではない");

  const both = buildAttentionQueue({ proposals: [feed, note] });
  assert.equal(countAttention(both), 1, "一般のNote提案は判断待ちに残る");
  assert.equal(both[0].sourceId, "proposal-note-1");

  // 採用後（pendingでない）も投稿としては読める。
  const adopted = feedProposal({ status: "accepted" });
  assert.equal(buildPostsFromProposals({ proposals: [adopted] }).length, 1);
  // 削除された投稿は読まない。
  assert.equal(
    buildPostsFromProposals({
      proposals: [feedProposal({ deleted_at: "2026-09-22T00:00:00.000Z" })],
    }).length,
    0,
  );
});

test("読者の状態は投稿の安定IDに結び付き、同じ操作で増えない", () => {
  assert.equal(
    feedReactionId("feed-post:proposal-1", "bookmark"),
    "feed-reaction:feed-post:proposal-1:bookmark",
  );
  assert.equal(
    feedReactionId("feed-post:proposal-1", "bookmark"),
    feedReactionId("feed-post:proposal-1", "bookmark"),
  );
  assert.notEqual(
    feedReactionId("feed-post:proposal-1", "bookmark"),
    feedReactionId("feed-post:proposal-1", "interesting"),
  );
  assert.throws(() => feedReactionId("", "bookmark"), /1〜200/u);
  // 「既知だった」も同じ規則で保存する（#604後半の反応表）。
  assert.equal(
    feedReactionId("feed-post:proposal-1", "known"),
    "feed-reaction:feed-post:proposal-1:known",
  );
});

test("保存した投稿だけを、元の並びのまま読み返せる", () => {
  const posts = buildPostsFromProposals({
    proposals: [
      feedProposal(),
      feedProposal({
        id: "proposal-feed-2",
        payload: { feed_posts: [{ action: "publish", topic: "learning", body: ["二つ目。"] }] },
      }),
    ],
  });
  assert.equal(posts.length, 2);
  assert.deepEqual(
    postsBookmarked(posts, new Set([posts[1].id])).map((post) => post.id),
    [posts[1].id],
  );
  // 印が無ければ空。並びは元のタイムラインのまま。
  assert.deepEqual(postsBookmarked(posts, new Set()), []);
  assert.deepEqual(
    postsBookmarked(posts, new Set(posts.map((post) => post.id))).map((post) => post.id),
    posts.map((post) => post.id),
  );
});

test("実データでは読者の状態を保存し、再起動後も残る", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tasken-feed-post-"));
  const dbPath = path.join(directory, "workspace.sqlite");
  let database = new WorkspaceDatabase(dbPath);
  try {
    database.loadWorkspace();
    database.save("ai_proposal", feedProposal());
    database.save("feed_reaction", {
      id: feedReactionId("feed-post:proposal-feed-1", "bookmark"),
      post_id: "feed-post:proposal-feed-1",
      kind: "bookmark",
      created_at: "2026-09-21T10:10:00.000Z",
    });
    // 連打しても増えない。
    database.save("feed_reaction", {
      id: feedReactionId("feed-post:proposal-feed-1", "bookmark"),
      post_id: "feed-post:proposal-feed-1",
      kind: "bookmark",
      created_at: "2026-09-21T10:10:01.000Z",
    });
    assert.equal(database.list("feed_reaction").length, 1);

    database.db.close();
    database = new WorkspaceDatabase(dbPath);
    database.loadWorkspace();

    const posts = buildPostsFromProposals({ proposals: database.list("ai_proposal", true) });
    assert.equal(posts.length, 1, "再起動後も投稿を読める");
    const reactions = database.list("feed_reaction");
    assert.equal(reactions.length, 1, "再起動後もブックマークが残る");
    assert.equal(reactions[0].post_id, posts[0].id);

    // 取り消しは削除（既存のUndo境界）。
    database.remove("feed_reaction", reactions[0].id);
    assert.equal(database.list("feed_reaction").length, 0);
    database.restore("feed_reaction", reactions[0].id);
    assert.equal(database.list("feed_reaction").length, 1);
  } finally {
    database.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("不正な読者の状態は保存しない", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tasken-feed-post-bad-"));
  const database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite"));
  try {
    database.loadWorkspace();
    assert.throws(
      () =>
        database.save("feed_reaction", {
          id: "r1",
          post_id: "",
          kind: "bookmark",
          created_at: "2026-09-21T10:00:00.000Z",
        }),
      /post_id/u,
    );
    assert.throws(
      () =>
        database.save("feed_reaction", {
          id: "r2",
          post_id: "p",
          kind: "like",
          created_at: "2026-09-21T10:00:00.000Z",
        }),
      /kind/u,
    );
    assert.throws(
      () =>
        database.save("feed_reaction", {
          id: "r3",
          post_id: "p",
          kind: "bookmark",
          created_at: "2026-09-21",
        }),
      /created_at/u,
    );
  } finally {
    database.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
