import {
  buildSaveFeedPostOperations,
  buildTriageCaptureEntryOperations,
} from "../domain-model/persistence";
import type { CaptureEntry } from "../domain-model/types";
import type { Artifact, SaveOperation } from "../types";
import { captureFeedPost } from "./feedPosts";
import { uuid } from "./format";

/**
 * 未整理のCapture（付箋メモを除く）。Inboxを廃止したので、Feedの自分の投稿へ移す対象。
 * 付箋メモ（micro_memo）は付箋の画面で扱い続ける。
 */
export function untriagedCapturesForFeed(entries: readonly CaptureEntry[]): CaptureEntry[] {
  return entries
    .filter((entry) => entry.state === "untriaged" && entry.kind !== "micro_memo")
    .sort((a, b) => String(a.captured_at).localeCompare(String(b.captured_at)));
}

/**
 * 1件のCaptureをFeedの自分の投稿へ移す操作。Inboxの「Feedへ」と同じ保存（投稿の作成・
 * 添付の付け替え・Captureの整理済み化）を、記録した日時のまま行う。音声・動画の添付はCaptureに残す。
 */
export function buildCaptureToFeedOperations(
  entry: CaptureEntry,
  artifacts: readonly Artifact[],
  postId = uuid(),
): SaveOperation[] {
  const post = captureFeedPost(
    {
      id: postId,
      // 題名が本文の書き出しと同じCapture（クイック記録の既定）では、題名を重ねない。
      title: entry.title && !entry.text.trim().startsWith(entry.title.trim()) ? entry.title : null,
      text: entry.text,
      projectId: entry.project_id || null,
      sourceRecordId: entry.source_record_id || null,
    },
    entry.captured_at || new Date().toISOString(),
  );
  const retargeted: SaveOperation[] = artifacts
    .filter(
      (artifact) =>
        artifact.source_type === "capture_entry" &&
        artifact.source_id === entry.id &&
        artifact.media_kind !== "audio" &&
        artifact.media_kind !== "video",
    )
    .map((artifact) => ({
      action: "save",
      type: "artifact",
      entity: {
        ...artifact,
        source_type: "feed_post",
        source_id: postId,
        theme_id: entry.project_id || null,
      },
    }));
  return [
    ...buildSaveFeedPostOperations(post),
    ...retargeted,
    ...buildTriageCaptureEntryOperations(entry, { type: "feed_post", id: postId }),
  ];
}
