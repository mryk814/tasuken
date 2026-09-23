/**
 * 自分の投稿の保存先移行（Notes → Feed専用）。
 *
 * 移行前のFeed印付きNoteをFeed専用の正本（`feed_post`）へ移す。投稿IDは
 * 移行前の投稿ID（`feed-note:<noteId>`）と同じにし、反応・返信・会話の
 * 対応を保つ。元のNoteは論理削除で残し、復元できるようにする。
 */

import { feedPostFromPublishedNote, isMigratablePublishedNote } from "../../shared/feedPost.mjs";

/**
 * Feed印付きNoteをFeed専用へ移す。冪等。
 *
 * 元Noteの出所・Theme・本文・公開時刻はFeed専用へ写し、元の整理先
 * （capture_entry の triaged_to）と添付（artifact の source）もFeed専用へ
 * 付け替える。重複Noteは既存の削除契約で論理削除し、元に戻すで復元できる。
 * 途中終了しても開き直したときに残りを移せる。
 */
export function migratePublishedFeedNotes(database, migratedAt = new Date().toISOString()) {
  const migrated = [];
  const migrate = database.db.transaction(() => {
    for (const note of database.list("note", true)) {
      if (!isMigratablePublishedNote(note)) continue;
      const post = feedPostFromPublishedNote(note, migratedAt);
      if (!post) continue;
      if (!database.get("feed_post", post.id, true)) {
        database.save("feed_post", post, { source: "migration" });
      }
      for (const capture of database.list("capture_entry", true)) {
        if (
          capture.deleted_at ||
          capture.triaged_to_type !== "note" ||
          String(capture.triaged_to_id || "") !== String(note.id)
        ) {
          continue;
        }
        database.save(
          "capture_entry",
          { ...capture, triaged_to_type: "feed_post", triaged_to_id: post.id },
          { source: "migration" },
        );
      }
      for (const artifact of database.list("artifact", true)) {
        if (
          artifact.source_type !== "note" ||
          String(artifact.source_id || "") !== String(note.id)
        ) {
          continue;
        }
        database.save(
          "artifact",
          { ...artifact, source_type: "feed_post", source_id: post.id },
          { source: "migration" },
        );
      }
      database.remove("note", String(note.id));
      migrated.push(post.id);
    }
  });
  migrate();
  return migrated;
}
