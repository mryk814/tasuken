/**
 * 常時稼働nodeの`proposals`配備が受け付ける書き込みの種類。
 * Coreの拒否とMCP bridgeの公開判定は、どちらもこの一覧を正本にする。
 */

/**
 * `propose_content`で受け付ける種類。画像付きの提案は種類を問わず受け付けない。
 * Note編集案とFeedの返信も新しいProposalを作るだけで既存のEntityを書き換えない。
 * Note編集案はDesktopで採用するときに今の版と照合されるので、古い読みからの提案は採用で断られる。
 */
export const PROPOSALS_PROFILE_CONTENT_KINDS = Object.freeze([
  "feed_post",
  "feed_reply",
  "note_create",
  "note_edit",
] as const);

/** `propose_repository_task`で受け付ける種類。 */
export const PROPOSALS_PROFILE_REPOSITORY_TASK_KINDS = Object.freeze(["task"] as const);
