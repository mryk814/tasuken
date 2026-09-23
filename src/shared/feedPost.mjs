/**
 * 自分自身のFeed投稿の共有規則。
 *
 * 自分の投稿はFeed専用の正本（`feed_post`）に保存し、Notesには残さない。
 * 移行前の投稿ID（`feed-note:<noteId>`）はそのままFeed専用のIDにし、
 * 反応・返信・会話の対応を保つ。
 */

export const FEED_POST_MIGRATED_ID_PREFIX = "feed-note:";
// roundtrip-marker-7f3a2

function text(value) {
  return typeof value === "string" ? value : "";
}

export function migratedFeedPostId(noteId) {
  return `${FEED_POST_MIGRATED_ID_PREFIX}${String(noteId)}`;
}

export function feedPostTitleFromBody(body) {
  const firstLine = String(body || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "メモ";
  return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
}

function publishedNoteBody(note) {
  return text(note?.body_markdown ?? note?.body).trim();
}

export function isMigratablePublishedNote(note) {
  if (!note || typeof note !== "object" || Array.isArray(note)) return false;
  if (note.deleted_at) return false;
  if (!text(note.feed_published_at).trim()) return false;
  return publishedNoteBody(note).length > 0;
}

export function feedPostFromPublishedNote(note, migratedAt) {
  if (!isMigratablePublishedNote(note)) return null;
  const body = publishedNoteBody(note);
  const title = text(note.title).trim() || feedPostTitleFromBody(body);
  const projectId = text(note.project_id ?? note.theme_id).trim();
  const sourceRecordId = text(note.source_record_id).trim();
  return {
    id: migratedFeedPostId(note.id),
    title,
    body_markdown: body,
    project_id: projectId || null,
    source_record_id: sourceRecordId || null,
    published_at: text(note.feed_published_at).trim(),
    origin_note_id: String(note.id),
    migrated_from_note_at: migratedAt,
  };
}
