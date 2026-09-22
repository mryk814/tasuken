/**
 * Feedの読み出し（SNS型Feed 第3段階）。
 *
 * 返信・読者の印・読み物Proposalをまとめて1回のsnapshotで読む。
 * 正式データを変更しない読み取り専用のportである。
 */
export interface FeedContextRecord {
  id: string;
  [key: string]: unknown;
}

export interface FeedContextWorkspace {
  ai_proposals?: FeedContextRecord[];
  feed_replies?: FeedContextRecord[];
  feed_reactions?: FeedContextRecord[];
}

export interface FeedContextSnapshot {
  workspace: FeedContextWorkspace;
}

export interface FeedContextReadPort {
  readFeedContextSnapshot(includeDeleted?: boolean): FeedContextSnapshot;
}
