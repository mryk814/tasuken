/**
 * 常時稼働nodeの`proposals`配備が受け付ける書き込みの種類。
 * Coreの拒否とMCP bridgeの公開判定は、どちらもこの一覧を正本にする。
 */

/** `propose_content`で受け付ける種類。画像付きNoteは含まない。 */
export const PROPOSALS_PROFILE_CONTENT_KINDS = Object.freeze(["feed_post", "note_create"] as const);

/** `propose_repository_task`で受け付ける種類。 */
export const PROPOSALS_PROFILE_REPOSITORY_TASK_KINDS = Object.freeze(["task"] as const);
