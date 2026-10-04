package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** Feedへの反応・返信の送信内容と、送信待ちを画面へ重ねる規則。 */
class MobileFeedActionTest {
    private fun envelope(commandId: String, issuedAt: String, action: MobileFeedActionDto) = MobileFeedActionEnvelopeDto(
        apiVersion = 1,
        schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
        requestId = "request-$commandId",
        commandId = commandId,
        idempotencyKey = commandId,
        clientDeviceId = "device",
        issuedAt = issuedAt,
        action = action,
    )

    private fun reaction(commandId: String, at: String, kind: String, on: Boolean, postId: String = "post-1") =
        envelope(commandId, at, MobileFeedActionDto("SetFeedReaction", postId, kind = kind, on = on))

    private fun reply(commandId: String, at: String, body: String, postId: String = "post-1") =
        envelope(commandId, at, MobileFeedActionDto("PostFeedReply", postId, replyId = commandId, body = body))

    private fun post(
        id: String = "post-1",
        reactions: List<String> = emptyList(),
        replies: List<MobileFeedReplyDto> = emptyList(),
    ) = MobileFeedPostDto(
        postId = id, authorKind = "ai", authorLabel = "Codex", topic = "insight",
        createdAt = "2026-10-04T08:00:00Z", body = listOf("本文"), reactions = reactions, replies = replies,
    )

    @Test
    fun reactionRequestOmitsUnusedFieldsSoTheStrictDesktopContractAccepts() {
        val json = MobileFeedActionContract.encode(reaction("c1", "2026-10-04T10:00:00Z", "interesting", true))

        assertTrue(json.contains("\"action\":{\"name\":\"SetFeedReaction\",\"postId\":\"post-1\",\"kind\":\"interesting\",\"on\":true}"))
        assertFalse(json.contains("replyId"))
        assertFalse(json.contains("null"))
    }

    @Test
    fun replyRequestCarriesTheDeviceChosenIdAndNoAiRequest() {
        val json = MobileFeedActionContract.encode(reply("reply-1", "2026-10-04T10:00:00Z", "来週読む"))

        assertTrue(json.contains("\"action\":{\"name\":\"PostFeedReply\",\"postId\":\"post-1\",\"replyId\":\"reply-1\",\"body\":\"来週読む\"}"))
        assertTrue(json.contains("\"commandId\":\"reply-1\""))
        assertTrue(json.contains("\"idempotencyKey\":\"reply-1\""))
        assertFalse(json.contains("ai"))
    }

    @Test
    fun envelopesSurviveBeingStoredAndRead() {
        val original = reply("reply-1", "2026-10-04T10:00:00Z", "来週読む")

        assertEquals(original, MobileFeedActionContract.decodeEnvelope(MobileFeedActionContract.encode(original)))
    }

    @Test
    fun repliesAreTrimmedAndLimited() {
        assertEquals("来週読む", MobileFeedActionContract.normalizeReply("  来週読む \n"))
        assertThrows(IllegalArgumentException::class.java) { MobileFeedActionContract.normalizeReply("  \n ") }
        assertThrows(IllegalArgumentException::class.java) {
            MobileFeedActionContract.normalizeReply("あ".repeat(FEED_REPLY_MAX_LENGTH + 1))
        }
        assertEquals(FEED_REPLY_MAX_LENGTH, MobileFeedActionContract.normalizeReply("あ".repeat(FEED_REPLY_MAX_LENGTH)).length)
    }

    @Test
    fun onlySupportedReactionsAreSent() {
        MobileFeedActionContract.requireReactionKind(FEED_REACTION_BOOKMARK)
        MobileFeedActionContract.requireReactionKind(FEED_REACTION_INTERESTING)
        assertThrows(IllegalArgumentException::class.java) { MobileFeedActionContract.requireReactionKind("hidden") }
    }

    @Test
    fun pendingReactionsAppearImmediatelyAndTheLatestWins() {
        val posts = listOf(post(reactions = listOf("bookmark")), post("post-2"))
        val pending = listOf(
            reaction("c1", "2026-10-04T10:00:00Z", "interesting", true),
            reaction("c2", "2026-10-04T10:00:01Z", "bookmark", false),
        )

        val shown = applyPendingFeedActions(posts, pending)

        assertEquals(listOf("interesting"), shown[0].reactions)
        assertEquals(emptyList<String>(), shown[1].reactions)
    }

    @Test
    fun aPendingReplyIsMarkedAndNeverDuplicatesOneTheDesktopAlreadyHas() {
        val synced = MobileFeedReplyDto("reply-1", "human", "自分", "2026-10-04T10:00:00Z", "来週読む")
        val pending = listOf(
            reply("reply-1", "2026-10-04T10:00:00Z", "来週読む"),
            reply("reply-2", "2026-10-04T10:05:00Z", "続き"),
        )

        val shown = applyPendingFeedActions(listOf(post(replies = listOf(synced))), pending).single()

        // 届いている返信は重ねず、届いていない返信だけが「送信待ち」で末尾に並ぶ。
        assertEquals(listOf("reply-1", "reply-2"), shown.replies.map { it.replyId })
        assertEquals(listOf(false, true), shown.replies.map { it.pending })
        assertTrue(shown.replies.last().isHuman)
        assertEquals("自分", shown.replies.last().authorLabel)
    }

    @Test
    fun noPendingActionsLeavesThePostsUntouched() {
        val posts = listOf(post(reactions = listOf("bookmark")))

        assertEquals(posts, applyPendingFeedActions(posts, emptyList()))
    }
}
