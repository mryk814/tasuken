package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * DesktopとAndroidが同じFeed投稿の意味を共有することの確認。
 * goldenは `contracts/mobile/v1/feed-response.golden.json` を共有する。
 */
class MobileFeedGoldenTest {
    private val golden =
        requireNotNull(javaClass.classLoader?.getResource("feed-response.golden.json")).readText()

    @Test
    fun decodesCanonicalFeedReadModel() {
        val response = MobileFeedContract.decode(golden)

        assertTrue(response.ok)
        assertFalse(response.data.truncated)
        // Desktopの並び（新しい順）をそのまま使う。AIの投稿も自分の投稿も同じ流れ。
        assertEquals(
            listOf("feed-post:p-codex", "own-1", "feed-post:p-claude", "feed-post:p-note"),
            response.data.posts.map { it.postId },
        )
    }

    @Test
    fun separatesAiPostsFromOwnPostsOnlyByAuthorKind() {
        val posts = MobileFeedContract.decode(golden).data.posts.associateBy { it.postId }

        assertEquals("Codex", posts.getValue("feed-post:p-codex").authorLabel)
        assertFalse(posts.getValue("feed-post:p-codex").isHuman)
        assertTrue(posts.getValue("own-1").isHuman)
        assertEquals("自分", posts.getValue("own-1").authorLabel)
        assertEquals(
            listOf("今日は粘度の実験を進める。", "温度条件は明日決める。"),
            posts.getValue("own-1").body,
        )
    }

    @Test
    fun carriesTaskThemeAttachmentAndLinkWithoutArticleBodies() {
        val posts = MobileFeedContract.decode(golden).data.posts.associateBy { it.postId }
        val codex = posts.getValue("feed-post:p-codex")

        assertEquals("task-viscosity", codex.taskId)
        assertEquals("粘度測定の条件を決める", codex.taskTitle)
        assertEquals("高分子材料評価", codex.themeName)
        assertEquals(MobileFeedAttachmentDto("note_draft", "粘度測定は温度を先に揃える"), codex.attachment)
        assertEquals(
            MobileFeedLinkDto("https://example.com/viscosity", "測定ガイド", null),
            posts.getValue("feed-post:p-claude").link,
        )
        assertEquals(MobileFeedAttachmentDto("note", "粘度の基礎"), posts.getValue("feed-post:p-note").attachment)
        assertNull(posts.getValue("own-1").attachment)
    }

    @Test
    fun carriesMyReactionsAndTheThreadInDesktopOrder() {
        val posts = MobileFeedContract.decode(golden).data.posts.associateBy { it.postId }
        val codex = posts.getValue("feed-post:p-codex")

        assertEquals(setOf("bookmark", "interesting"), codex.reactions.toSet())
        // 古い順。自分のメモ → AIの返答 → AIの返答。
        assertEquals(
            listOf("reply-self-1", "feed-answer:a-claude", "reply-ai-1"),
            codex.replies.map { it.replyId },
        )
        assertTrue(codex.replies.first().isHuman)
        assertFalse(codex.replies.last().isHuman)
        assertTrue(codex.replies.none { it.pending })
        assertTrue(posts.getValue("own-1").reactions.isEmpty())
        assertTrue(posts.getValue("own-1").replies.isEmpty())
    }

    @Test
    fun pendingFlagIsNeverPartOfTheContract() {
        val reply = MobileFeedReplyDto("r", "human", "自分", "2026-10-04T10:00:00Z", "メモ", pending = true)
        val post = MobileFeedContract.decode(golden).data.posts.first().copy(replies = listOf(reply))

        // 端末の中だけの印は保存・送信に出ない。
        assertFalse(MobileFeedContract.encodePost(post).contains("pending"))
    }

    @Test
    fun cachedPostRoundTripsThroughItsStoredPayload() {
        val post = MobileFeedContract.decode(golden).data.posts.first()
        val restored = post.toCacheEntity("server-1", 0, "2026-10-04T09:00:00Z").toPost()

        assertEquals(post, restored)
    }

    @Test
    fun rejectsUnknownFieldsInsteadOfDroppingThemSilently() {
        val withExtra = golden.replaceFirst("\"postId\"", "\"surprise\": true, \"postId\"")

        assertThrows(Exception::class.java) { MobileFeedContract.decode(withExtra) }
    }

    @Test
    fun onlyWebLinksCanBeOpened() {
        assertEquals("example.com", safeExternalUri("https://example.com/a")?.host)
        assertNull(safeExternalUri("javascript:alert(1)"))
        assertNull(safeExternalUri("file:///sdcard/secret"))
        assertNull(safeExternalUri("intent://scan/#Intent;scheme=zxing;end"))
    }

    @Test
    fun topicLabelsMatchDesktop() {
        assertEquals("気づき", feedTopicLabel("insight"))
        assertEquals("学び", feedTopicLabel("learning"))
        assertEquals("情報紹介", feedTopicLabel("reference"))
        assertEquals("質問", feedTopicLabel("question"))
        assertEquals("作業報告", feedTopicLabel("work_report"))
        assertEquals("メモ", feedTopicLabel("own_note"))
    }
}
