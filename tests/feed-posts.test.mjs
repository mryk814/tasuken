import assert from "node:assert/strict";
import test from "node:test";

import {
  FEED_AUTHORS,
  FEED_COLLAPSE_AT,
  FEED_POSTS,
  FEED_POST_KIND_LABELS,
  FEED_SHORT_POST_MAX,
  authorOf,
  filterPosts,
  needsMore,
  postBodyLength,
  postsForHome,
  postsForLearning,
  withReplies,
} from "../src/renderer/src/features/workspace/lib/feedPosts.ts";

/**
 * SNS型Feedの開発用fixture（`docs/feed-learning-sns-plan-2026-09-21.md` 第1段階）。
 * **架空データであること**と、読む面の規則が崩れていないことを固定する。
 */

test("12〜20件の投稿があり、投稿者名だけを差し替えた同じ文章がない", () => {
  assert.ok(FEED_POSTS.length >= 12 && FEED_POSTS.length <= 20, `件数: ${FEED_POSTS.length}`);
  const bodies = FEED_POSTS.map((post) => post.paragraphs.join("\n"));
  assert.equal(new Set(bodies).size, bodies.length, "同じ本文の投稿がある");
  assert.equal(new Set(FEED_POSTS.map((post) => post.id)).size, FEED_POSTS.length);
  // 冒頭の一文が重複していないこと（同じ書き出しを並べない）。
  const openings = FEED_POSTS.map((post) => post.paragraphs[0]);
  assert.equal(new Set(openings).size, openings.length, "同じ書き出しの投稿がある");
});

test("投稿者が複数いて、AI表記の有無を区別できる", () => {
  const authors = new Set(FEED_POSTS.map((post) => post.author));
  assert.ok(authors.size >= 4, `投稿者の種類: ${[...authors].join(", ")}`);
  assert.ok(authors.has("self"));
  assert.ok(authors.has("codex"));
  assert.ok(authors.has("claude"));
  // AIと自分の記録で表示を変えられるよう、種別を持つ。
  assert.equal(authorOf(FEED_POSTS.find((post) => post.author === "codex")).kind, "ai");
  assert.equal(authorOf(FEED_POSTS.find((post) => post.author === "self")).kind, "human");
  assert.equal(FEED_AUTHORS.tasken.kind, "auto_record");
});

test("流れる内容の6種類がすべて出ている", () => {
  const kinds = new Set(FEED_POSTS.map((post) => post.kind));
  assert.deepEqual([...kinds].sort(), Object.keys(FEED_POST_KIND_LABELS).sort());
});

test("短文と長文と添付が混ざり、長文はもっと読むで展開する", () => {
  // 返信は短くてよい。単独の投稿を編集上の目安（80〜260字）で見る。
  const roots = FEED_POSTS.filter((post) => !post.replyTo);

  // 目安より短い投稿は、気づきの一言か自動記録だけにする。
  const tooShort = roots.filter(
    (post) => postBodyLength(post) < 80 && !["insight", "own_note"].includes(post.kind),
  );
  assert.deepEqual(
    tooShort.map((post) => post.id),
    [],
    "短すぎる投稿がある",
  );

  // 目安より長い投稿は、読むための添付（記事・引用・Task）を持つ。
  const longWithoutAttachment = roots.filter(
    (post) => postBodyLength(post) > FEED_SHORT_POST_MAX && !post.attachment,
  );
  assert.deepEqual(
    longWithoutAttachment.map((post) => post.id),
    [],
    "長いだけの投稿がある",
  );

  const long = FEED_POSTS.filter((post) => postBodyLength(post) > FEED_SHORT_POST_MAX);
  assert.ok(long.length > 0, "長文の投稿がない");

  const collapsible = FEED_POSTS.filter((post) => needsMore(post));
  assert.ok(collapsible.length > 0, "もっと読むを使う投稿がない");
  assert.ok(collapsible.every((post) => postBodyLength(post) > FEED_COLLAPSE_AT));

  const attachments = new Set(
    FEED_POSTS.filter((post) => post.attachment).map((post) => post.attachment.kind),
  );
  // 記事・引用・Task・外部資料が揃っている。記事草稿もここに含む。
  assert.ok(attachments.has("note"));
  assert.ok(attachments.has("quote"));
  assert.ok(attachments.has("task"));
  assert.ok(attachments.has("external"));
  assert.ok(attachments.has("note_draft"));
  // 添付なしの短文だけで成立する投稿もある。
  assert.ok(FEED_POSTS.some((post) => post.attachment === null));
});

test("図は理解の助けになる投稿だけに付け、毎回飾らない", () => {
  const withFigure = FEED_POSTS.filter((post) => post.attachment?.figureLabel);
  assert.ok(withFigure.length > 0);
  assert.ok(withFigure.length < FEED_POSTS.length, "全投稿へ図を付けている");
  // 図の見出しは内容を説明する（「画像」だけにしない）。
  for (const post of withFigure) {
    assert.match(post.attachment.figureLabel, /[:：]/u, post.id);
  }
});

test("返信は親の直後へ入り、親が見つからない返信も落とさない", () => {
  const ordered = withReplies(postsForHome());
  const reply = ordered.find((post) => post.replyTo);
  assert.ok(reply, "返信の投稿がない");
  const parentIndex = ordered.findIndex((post) => post.id === reply.replyTo);
  assert.equal(ordered[parentIndex + 1].id, reply.id, "返信が親の直後にない");

  const orphan = withReplies([
    { ...FEED_POSTS[0], id: "orphan", replyTo: "missing-parent" },
    ...postsForHome(),
  ]);
  assert.ok(
    orphan.some((post) => post.id === "orphan"),
    "親のない返信が消えている",
  );
});

test("ホームは新着順、学びは読む投稿だけに絞る", () => {
  const home = postsForHome();
  for (let index = 1; index < home.length; index += 1) {
    assert.ok(
      home[index - 1].createdAt >= home[index].createdAt,
      `新着順になっていない: ${home[index - 1].id}`,
    );
  }
  const learnable = postsForLearning();
  assert.ok(learnable.length > 0 && learnable.length < home.length);
  assert.ok(learnable.every((post) => post.learnable));
  // 質問と自分の記録は学びへ出さない。
  assert.equal(
    learnable.some((post) => post.kind === "question"),
    false,
  );
  assert.equal(
    learnable.some((post) => post.kind === "own_note"),
    false,
  );
});

test("投稿者とThemeで絞り込める", () => {
  const byAuthor = filterPosts(postsForHome(), { author: "claude" });
  assert.ok(byAuthor.length > 0);
  assert.ok(byAuthor.every((post) => post.author === "claude"));

  const byTheme = filterPosts(postsForHome(), { themeLabel: "高分子材料評価" });
  assert.ok(byTheme.length > 0);
  assert.ok(byTheme.every((post) => post.attachment?.refLabel.includes("高分子材料評価") === true));

  assert.equal(filterPosts(postsForHome(), {}).length, FEED_POSTS.length);
});
