import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  WorkspaceDatabase,
  workspaceSchemaVersion,
} from "../src/main/repositories/workspaceRepository.mjs";
import { migratePublishedFeedNotes } from "../src/main/repositories/feedPostMigration.mjs";
import { buildAttentionQueue, countAttention } from "../src/shared/contracts/task/public.ts";
import {
  buildOwnPosts,
  captureFeedPost,
  feedPostEntity,
  noteTitleFrom,
  postsForHome,
  postsForLearning,
  updateFeedOwnPost,
} from "../src/renderer/src/features/workspace/lib/feedPosts.ts";
import { migratedFeedPostId } from "../src/shared/feedPost.mjs";

/**
 * SNS型Feed 第3段階: 自分の投稿欄。
 *
 * 自分の投稿はFeed専用の正本（`feed_post`）に保存し、Notesには残さない。
 * 未整理のメモ全件を自動で流さず、削除は既存の「元に戻す」で戻す。
 */

const AT = "2026-09-21T10:00:00.000Z";

function post(id, overrides = {}) {
  return {
    id,
    title: "測定条件の気づき",
    body_markdown: "条件を先に決めると、測り直しが減る。",
    published_at: AT,
    ...overrides,
  };
}

test("Feed専用の投稿だけを自分の投稿として読む", () => {
  const posts = buildOwnPosts({
    feedPosts: [
      post("post-published", { project_id: "theme-materials" }),
      post("post-deleted", { deleted_at: "2026-09-22T00:00:00.000Z" }),
      post("post-empty", { body_markdown: "   " }),
      post("post-unpublished", { published_at: "" }),
    ],
  });
  assert.deepEqual(
    posts.map((entry) => entry.id),
    ["post-published"],
    "Feed専用の投稿だけを読む",
  );
  const entry = posts[0];
  assert.equal(entry.author, "self");
  assert.equal(entry.kind, "own_note");
  assert.equal(entry.createdAt, AT);
  assert.equal(entry.attachment, null);
  assert.deepEqual(entry.paragraphs, ["条件を先に決めると、測り直しが減る。"]);
  assert.equal(entry.themeId, "theme-materials");
  assert.equal(entry.learnable, false, "自分の投稿は学びタブへ出さない");
  assert.deepEqual(postsForLearning(posts), []);

  // 順序は載せた時刻の新しい順。
  const later = buildOwnPosts({
    feedPosts: [
      post("post-a", { published_at: AT }),
      post("post-b", { published_at: "2026-09-21T11:00:00.000Z" }),
    ],
  });
  assert.deepEqual(
    postsForHome(later).map((item) => item.id),
    ["post-b", "post-a"],
  );
});

test("投稿はFeed専用の正本として保存する", () => {
  const entity = feedPostEntity({
    id: "post-new",
    body: "  一段落目。\n\n二段落目。  ",
    publishedAt: AT,
    projectId: "theme-materials",
    sourceRecordId: "capture-inbox",
  });
  assert.equal(entity.id, "post-new");
  assert.equal(entity.body_markdown, "一段落目。\n\n二段落目。", "前後の空白だけを落とす");
  assert.equal(entity.title, "一段落目。", "見出しは本文の1行目から作る");
  assert.equal(entity.published_at, AT);
  assert.equal(entity.project_id, "theme-materials");
  assert.equal(entity.source_record_id, "capture-inbox");
  assert.equal("note_type" in entity, false, "Noteの種別は持たない");
  assert.equal("feed_published_at" in entity, false, "Feed印は持たない");
  assert.throws(() => feedPostEntity({ id: "x", body: "   ", publishedAt: AT }), /本文/u);
  assert.equal(noteTitleFrom("あ".repeat(80)).length, 61, "長い見出しは切る");
  assert.equal(noteTitleFrom("\n\n"), "メモ");

  const updated = updateFeedOwnPost("  直した本文。\n\n二段落目は同じ。  ");
  assert.equal(updated.title, "直した本文。");
  assert.equal(updated.body_markdown, "直した本文。\n\n二段落目は同じ。");
  assert.throws(() => updateFeedOwnPost("   "), /本文/u);
});

test("自分の投稿はNotesに残らず、削除と復元ができる", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tasken-feed-own-"));
  const database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite"));
  try {
    database.loadWorkspace();
    database.save(
      "feed_post",
      feedPostEntity({ id: "post-own", body: "自分で書いた記録。", publishedAt: AT }),
    );
    database.save("note", { id: "note-plain", title: "作業メモ", body_markdown: "本文" });
    assert.equal(buildOwnPosts({ feedPosts: database.list("feed_post", true) }).length, 1);
    assert.deepEqual(
      database
        .list("note", true)
        .map((note) => note.id)
        .filter((id) => id === "post-own"),
      [],
      "投稿がNotesに混ざらない",
    );

    database.remove("feed_post", "post-own");
    assert.equal(buildOwnPosts({ feedPosts: database.list("feed_post", true) }).length, 0);
    database.restore("feed_post", "post-own");
    assert.equal(buildOwnPosts({ feedPosts: database.list("feed_post", true) }).length, 1);
  } finally {
    database.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("自分の投稿は要対応の判断を増やさない", () => {
  assert.equal(buildOwnPosts({ feedPosts: [post("post-published")] }).length, 1);
  // 投稿はProposalでも判断でもない。要対応の入力に入らないことを固定する。
  assert.equal(countAttention(buildAttentionQueue({ proposals: [], tasks: [] })), 0);
});

test("未整理のInbox記録は題名・本文・Theme・出所を保ったままFeedへ載せられる", () => {
  const entity = captureFeedPost(
    {
      id: "post-from-inbox",
      title: "乾燥の気づき",
      text: "同じ条件でも時間が違うと結果が変わる。",
      projectId: "theme-materials",
      sourceRecordId: "capture-inbox",
    },
    AT,
  );
  assert.equal(entity.project_id, "theme-materials");
  assert.equal(entity.source_record_id, "capture-inbox");
  assert.equal(entity.body_markdown, "乾燥の気づき\n同じ条件でも時間が違うと結果が変わる。");
  assert.equal(buildOwnPosts({ feedPosts: [entity] }).length, 1);

  assert.throws(
    () =>
      captureFeedPost(
        {
          id: "post-empty",
          title: "  ",
          text: "  ",
        },
        AT,
      ),
    /本文/u,
  );
});

test("Feed印付きNoteは投稿IDと会話の対応を保ったままFeed専用へ移る", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tasken-feed-post-migration-"));
  const database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite"));
  try {
    database.loadWorkspace();
    database.save("source_record", {
      id: "source-legacy",
      source_title: "移行前の出所",
    });
    database.save("project", {
      id: "theme-materials",
      name: "高分子材料評価",
      state: "active",
    });
    database.save("note", {
      id: "note-legacy",
      title: "移行前の投稿",
      body_markdown: "移行前の本文。",
      note_type: "memo",
      project_id: "theme-materials",
      source_record_id: "source-legacy",
      feed_published_at: AT,
    });
    database.save("capture_entry", {
      id: "capture-legacy",
      title: "移行前の記録",
      text: "移行前の本文。",
      kind: "inbox",
      content_type: "text",
      captured_at: AT,
      state: "triaged",
      triaged_to_type: "note",
      triaged_to_id: "note-legacy",
    });
    database.save("artifact", {
      id: "artifact-legacy",
      title: "移行前の添付",
      filename: "memo.md",
      file_type: "md",
      mime_type: "text/markdown",
      source_type: "note",
      source_id: "note-legacy",
      storage_mode: "linked",
      target: "https://example.com/memo.md",
    });
    database.save("feed_reaction", {
      id: "reaction-legacy",
      post_id: migratedFeedPostId("note-legacy"),
      kind: "bookmark",
      created_at: AT,
    });
    database.save("feed_reply", {
      id: "reply-legacy",
      post_id: migratedFeedPostId("note-legacy"),
      body: "続きも読んだ。",
      created_at: AT,
    });

    const migratedIds = migratePublishedFeedNotes(database);
    assert.deepEqual(migratedIds, [migratedFeedPostId("note-legacy")]);

    const posts = database.list("feed_post", true);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].id, migratedFeedPostId("note-legacy"));
    assert.equal(posts[0].title, "移行前の投稿");
    assert.equal(posts[0].body_markdown, "移行前の本文。");
    assert.equal(posts[0].published_at, AT);
    assert.equal(posts[0].project_id, "theme-materials");
    assert.equal(posts[0].source_record_id, "source-legacy");
    assert.equal(posts[0].origin_note_id, "note-legacy");
    assert.equal(buildOwnPosts({ feedPosts: posts }).length, 1);

    assert.equal(
      database.list("note").some((note) => note.id === "note-legacy"),
      false,
      "移行後の正本はNotesに残らない",
    );
    const retired = database.get("note", "note-legacy", true);
    assert.ok(retired.deleted_at, "元のNoteは論理削除で残す");

    const converted = database.get("capture_entry", "capture-legacy");
    assert.equal(converted.triaged_to_type, "feed_post");
    assert.equal(converted.triaged_to_id, migratedFeedPostId("note-legacy"));
    const movedArtifact = database.get("artifact", "artifact-legacy");
    assert.equal(movedArtifact.source_type, "feed_post");
    assert.equal(movedArtifact.source_id, migratedFeedPostId("note-legacy"));
    assert.equal(database.get("feed_reaction", "reaction-legacy").post_id, posts[0].id);
    assert.equal(database.get("feed_reply", "reply-legacy").post_id, posts[0].id);

    // 二重実行しても増えない。
    assert.deepEqual(migratePublishedFeedNotes(database), []);
    assert.equal(database.list("feed_post", true).length, 1);
  } finally {
    database.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("schema v7で起動時移行が配線されている", async () => {
  assert.equal(workspaceSchemaVersion, 7);
  const directory = await mkdtemp(path.join(os.tmpdir(), "tasken-feed-post-wiring-"));
  const databasePath = path.join(directory, "workspace.sqlite");
  const database = new WorkspaceDatabase(databasePath);
  database.db.exec("UPDATE workspace_meta SET value = '6' WHERE key = 'schema_version'");
  database.db.close();
  const reopened = new WorkspaceDatabase(databasePath);
  try {
    assert.equal(
      reopened.db.prepare("SELECT value FROM workspace_meta WHERE key = 'schema_version'").get()
        .value,
      "7",
    );
  } finally {
    reopened.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
