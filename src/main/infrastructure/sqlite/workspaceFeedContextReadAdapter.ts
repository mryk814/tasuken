import type {
  FeedContextReadPort,
  FeedContextRecord,
  FeedContextSnapshot,
} from "../../core/public.ts";

export interface FeedContextWorkspacePersistence {
  list(
    type: "ai_proposal" | "feed_reply" | "feed_reaction",
    includeDeleted?: boolean,
  ): FeedContextRecord[];
}

/** Uses the injected WorkspaceDatabase and its side-effect-free list API. */
export class WorkspaceFeedContextReadAdapter implements FeedContextReadPort {
  constructor(private readonly persistence: FeedContextWorkspacePersistence) {}

  readFeedContextSnapshot(includeDeleted = false): FeedContextSnapshot {
    return {
      workspace: {
        ai_proposals: this.persistence.list("ai_proposal", includeDeleted),
        feed_replies: this.persistence.list("feed_reply", includeDeleted),
        feed_reactions: this.persistence.list("feed_reaction", includeDeleted),
      },
    };
  }
}
