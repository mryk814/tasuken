import { feedPostIdForProposal, feedReactionId } from "../../shared/feedIds.mjs";
import type { MobileFeedActionRequest } from "../../shared/contracts/mobile/public.ts";
import type {
  MobileGatewayCorePort,
  MobileGatewayFeedActionResult,
} from "../gateway/mobile/public.ts";

/**
 * Feedへの書き込みをDesktopのmainへ任せる口。反応と返信は既存のEntity保存（`feed_reaction` /
 * `feed_reply`）をそのまま使い、保存後のDesktop画面の更新もmain側が行う。
 * 常時稼働nodeには渡さない（その場合、Androidからは書き込めないと返す）。
 */
export interface FeedWriterPort {
  save(
    type: "feed_reaction" | "feed_reply",
    entity: Record<string, unknown>,
  ): Record<string, unknown>;
  remove(type: "feed_reaction" | "feed_reply", id: string): Record<string, unknown> | null;
}

interface FeedActionPersistence {
  get(type: string, id: string, includeDeleted?: boolean): Record<string, unknown> | null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 反応や返信の対象にできる投稿か。Androidが読める範囲（AIの投稿・自分の投稿）だけを受ける。 */
function postExists(persistence: FeedActionPersistence, postId: string): boolean {
  const proposalPrefix = feedPostIdForProposal("");
  if (postId.startsWith(proposalPrefix)) {
    const proposal = persistence.get("ai_proposal", postId.slice(proposalPrefix.length), false);
    return Boolean(proposal && text(proposal.payload_type) === "feed_posts");
  }
  const post = persistence.get("feed_post", postId, false);
  return Boolean(post && !post.deleted_at);
}

type FeedAction = MobileFeedActionRequest["action"];

export function createMobileFeedActionPort(
  persistence: FeedActionPersistence,
  writer?: FeedWriterPort,
): Pick<MobileGatewayCorePort, "executeFeedAction"> {
  if (!writer) return {};
  return {
    executeFeedAction(input: {
      commandId: string;
      issuedAt: string;
      actorId: string;
      action: FeedAction;
    }): MobileGatewayFeedActionResult {
      const { action } = input;
      if (!postExists(persistence, action.postId)) return { ok: false, code: "not_found" };

      if (action.name === "SetFeedReaction") {
        const id = feedReactionId(action.postId, action.kind);
        const existing = persistence.get("feed_reaction", id, false);
        if (action.on) {
          if (existing) return { ok: true, commandId: input.commandId, status: "no_change" };
          writer.save("feed_reaction", {
            id,
            post_id: action.postId,
            kind: action.kind,
            created_at: input.issuedAt,
          });
        } else {
          if (!existing) return { ok: true, commandId: input.commandId, status: "no_change" };
          writer.remove("feed_reaction", id);
        }
        return { ok: true, commandId: input.commandId, status: "applied" };
      }

      // 返信は自分のメモ。端末が決めたIDで保存するので、応答を失った再送は同じ結果になる。
      const body = action.body.trim();
      const existing = persistence.get("feed_reply", action.replyId, true);
      if (existing) {
        const same =
          text(existing.post_id) === action.postId &&
          text(existing.body) === body &&
          text(existing.author_kind) !== "ai";
        // 同じIDで内容が違う再送は、別の返信を黙って上書きしない。
        return same
          ? { ok: true, commandId: input.commandId, status: "no_change" }
          : { ok: false, code: "idempotency_conflict" };
      }
      writer.save("feed_reply", {
        id: action.replyId,
        post_id: action.postId,
        body,
        created_at: input.issuedAt,
        author_kind: "self",
      });
      return { ok: true, commandId: input.commandId, status: "applied" };
    },
  };
}
