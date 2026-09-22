import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import { buildAttentionQueue, countAttention } from "../src/shared/contracts/task/public.ts";
import {
  FEED_PUBLISHED_FIELD,
  buildOwnPosts,
  feedNoteEntity,
  noteTitleFrom,
  ownPostId,
  postsForHome,
  postsForLearning,
  unpublishNote,
} from "../src/renderer/src/features/workspace/lib/feedPosts.ts";

/**
 * SNS型Feed 第3段階: 自分の投稿欄。
 *
 * 既存のMemo入力（Note）を再利用し、**Feedへ載せると選んだNoteだけ**を投稿として読む。
 * 未整理のメモ全件を自動で流さず、外すとNoteはNotesに残したままFeedから消える。
 */

const AT = "2026-09-21T10:00:00.000Z";

function note(id, overrides = {}) {
  return {
    id,
    title: "測定条件のメモ",
    body_markdown: "条件を先に決めると、測り直しが減る。",
    note_type: "memo",
    ...overrides,
  };
}

test("Feedへ載せたNoteだけを自分の投稿として読む", () => {
  const posts = buildOwnPosts({
    notes: [
      note("note-published", { [FEED_PUBLISHED_FIELD]: AT }),
      note("note-plain"),
      note("note-deleted", { [FEED_PUBLISHED_FIELD]: AT, deleted_at: "2026-09-22T00:00:00.000Z" }),
      note("note-empty", { [FEED_PUBLISHED_FIELD]: AT, body_markdown: "   " }),
    ],
  });
  assert.deepEqual(
    posts.map((post) => post.id),
    [ownPostId("note-published")],
    "印の付いたNoteだけを読む",
  );
  const post = posts[0];
  assert.equal(post.author, "self");
  assert.equal(post.kind, "own_note");
  assert.equal(post.createdAt, AT);
  assert.equal(post.noteId, "note-published");
  assert.equal(post.attachment, null);
  assert.deepEqual(post.paragraphs, ["条件を先に決めると、測り直しが減る。"]);
  assert.equal(post.learnable, false, "自分のメモは学びタブへ出さない");
  assert.deepEqual(postsForLearning(posts), []);

  // IDはNoteから決まるので、順序は載せた時刻の新しい順。
  const later = buildOwnPosts({
    notes: [
      note("note-a", { [FEED_PUBLISHED_FIELD]: AT }),
      note("note-b", { [FEED_PUBLISHED_FIELD]: "2026-09-21T11:00:00.000Z" }),
    ],
  });
  assert.deepEqual(
    postsForHome(later).map((post) => post.noteId),
    ["note-b", "note-a"],
  );
});

test("投稿は既存のMemo入力（Note）として保存する", () => {
  const entity = feedNoteEntity({
    id: "note-new",
    body: "  一段落目。\n\n二段落目。  ",
    publishedAt: AT,
  });
  assert.equal(entity.id, "note-new");
  assert.equal(entity.note_type, "memo");
  assert.equal(entity.body_markdown, "一段落目。\n\n二段落目。", "前後の空白だけを落とす");
  assert.equal(entity.feed_published_at, AT);
  assert.equal(entity.title, "一段落目。", "見出しは本文の1行目から作る");
  assert.throws(() => feedNoteEntity({ id: "x", body: "   ", publishedAt: AT }), /本文/u);
  assert.equal(noteTitleFrom("あ".repeat(80)).length, 61, "長い見出しは切る");
  assert.equal(noteTitleFrom("\n\n"), "メモ");
});

test("Feedから外してもメモはNotesに残る", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tasken-feed-own-"));
  const database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite"));
  try {
    database.loadWorkspace();
    database.save(
      "note",
      feedNoteEntity({ id: "note-own", body: "自分で書いた記録。", publishedAt: AT }),
    );
    assert.equal(buildOwnPosts({ notes: database.list("note", true) }).length, 1);

    const saved = database.list("note")[0];
    database.save("note", unpublishNote(saved));
    const afterUnpublish = database.get("note", "note-own");
    assert.equal(buildOwnPosts({ notes: database.list("note", true) }).length, 0, "Feedから外れる");
    assert.equal(afterUnpublish.title, saved.title, "メモはNotesに残る");
    assert.equal(afterUnpublish.body_markdown, "自分で書いた記録。");
    assert.equal(afterUnpublish[FEED_PUBLISHED_FIELD] ?? null, null);

    // 載せ直すと同じ投稿IDへ戻る。
    database.save("note", { ...afterUnpublish, [FEED_PUBLISHED_FIELD]: AT });
    const restored = buildOwnPosts({ notes: database.list("note", true) });
    assert.equal(restored.length, 1);
    assert.equal(restored[0].id, ownPostId("note-own"));
  } finally {
    database.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("自分の投稿は要対応の判断を増やさない", () => {
  const notes = [note("note-published", { [FEED_PUBLISHED_FIELD]: AT })];
  assert.equal(buildOwnPosts({ notes }).length, 1);
  // 投稿はProposalでも判断でもない。要対応の入力に入らないことを固定する。
  assert.equal(countAttention(buildAttentionQueue({ proposals: [], tasks: [] })), 0);
});
