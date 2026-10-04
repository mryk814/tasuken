/**
 * Feedの投稿・反応のID規則。DesktopのFeed画面とAndroidへ渡すread model・書き込み窓口が同じ規則を使う。
 */

/** @typedef {"bookmark" | "interesting" | "hidden" | "known"} FeedReactionKind */

/** @param {string} proposalId */
export function feedPostIdForProposal(proposalId) {
  return `feed-post:${proposalId}`;
}

/**
 * 反応のID。同じ投稿・同じ種類では同じIDになるので、連打や再送で増えない。
 * 取り消しはEntityの削除（既存のUndo境界）で行う。
 * @param {string} postId
 * @param {FeedReactionKind} kind
 */
export function feedReactionId(postId, kind) {
  const id = String(postId).trim();
  if (!id || id.length > 200) throw new Error("投稿IDは1〜200文字で指定してください。");
  return `feed-reaction:${id}:${kind}`;
}
