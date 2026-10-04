package jp.personal.tasken.companion

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Feed投稿の取得と保存。Desktopが返した投稿を並びのまま保存し、
 * 取れなかったときは保存済みの投稿を残す。
 */
@RunWith(AndroidJUnit4::class)
class MobileFeedRepositoryTest {
    private lateinit var context: Context
    private lateinit var database: MobileLocalDatabase
    private lateinit var dao: MobileLocalDao
    private lateinit var store: MobileGatewayConnectionStore

    @Before
    fun setUp() = runBlocking {
        context = ApplicationProvider.getApplicationContext()
        database = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        dao = database.mobileDao()
        dao.upsertSyncState(
            SyncStateEntity(
                serverId = "server-1",
                apiVersion = 1,
                schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
                cursor = "cursor-1",
                lastSuccessfulSyncAt = "2026-10-04T00:00:00Z",
                lastAttemptAt = "2026-10-04T00:00:00Z",
                lastError = null,
            ),
        )
        store = MobileGatewayConnectionStore(context)
        store.clearToken()
        store.save("https://gateway.test", "w".repeat(43), setOf("mobile:read", "mobile:capture-write"))
    }

    @After
    fun tearDown() {
        store.clearToken()
        database.close()
    }

    private fun repository(httpClient: MobileGatewayHttpClient) = AndroidMobileTaskRepository(
        context = context,
        store = store,
        database = database,
        scheduleOutboxOnStart = false,
        httpClient = httpClient,
    )

    private fun post(id: String, at: String, human: Boolean = false): String {
        val kind = if (human) "human" else "ai"
        val label = if (human) "自分" else "Codex"
        val topic = if (human) "own_note" else "insight"
        return """{"postId":"$id","authorKind":"$kind","authorLabel":"$label","topic":"$topic","createdAt":"$at","body":["本文 $id"],"taskId":null,"taskTitle":null,"themeId":null,"themeName":null,"attachment":null,"reactions":[],"replies":[],"link":null}"""
    }

    private fun response(vararg posts: String, serverId: String = "server-1"): String =
        """{"ok":true,"meta":{"apiVersion":1,"schemaVersion":$TASKEN_MOBILE_SCHEMA_VERSION,"serverId":"$serverId","serverRevision":1,"generatedAt":"2026-10-04T09:00:00.000Z","truncated":false},"data":{"posts":[${posts.joinToString(",")}],"truncated":false}}"""

    private fun actionOk(commandId: String, status: String = "applied", serverId: String = "server-1") =
        """{"ok":true,"meta":{"apiVersion":1,"schemaVersion":$TASKEN_MOBILE_SCHEMA_VERSION,"serverId":"$serverId","serverRevision":1,"generatedAt":"2026-10-04T09:00:00.000Z","truncated":false},"data":{"commandId":"$commandId","status":"$status"}}"""

    private fun actionError(code: String, message: String = "拒否") =
        """{"ok":false,"meta":{"apiVersion":1,"schemaVersion":$TASKEN_MOBILE_SCHEMA_VERSION,"serverId":"server-1","serverRevision":1,"generatedAt":"2026-10-04T09:00:00.000Z","truncated":false},"error":{"code":"$code","message":"$message","retryable":false}}"""

    private fun commandIdOf(body: String) = Regex("\"commandId\":\"([^\"]+)\"").find(body)!!.groupValues[1]

    @Test
    fun aReactionIsShownAtOnceThenSentWithItsCommandIdAndTheFeedIsRefreshed() = runBlocking {
        val sent = mutableListOf<String>()
        var feed = response(post("a", "2026-10-04T07:00:00Z"))
        val repository = repository(
            MobileGatewayHttpClient { _, path, method, body, _ ->
                when {
                    path == "/v1/feed-actions" && method == "POST" -> {
                        sent += body.orEmpty()
                        feed = feed.replace("\"reactions\":[]", "\"reactions\":[\"interesting\"]")
                        GatewayHttpResponse(200, actionOk(commandIdOf(body.orEmpty())))
                    }
                    path.startsWith("/v1/feed?") -> GatewayHttpResponse(200, feed)
                    else -> error("unexpected $path")
                }
            },
        )
        assertTrue(repository.refreshFeed())

        assertEquals(MobileFeedActionResult.Queued, repository.enqueueFeedReaction("a", FEED_REACTION_INTERESTING, true))

        assertEquals(1, sent.size)
        assertTrue(sent.single().contains("\"name\":\"SetFeedReaction\""))
        assertTrue(sent.single().contains("\"on\":true"))
        // 送れたので送信待ちは残らず、正本の反応が戻ってきている。
        assertTrue(repository.observePendingFeedActions().first().isEmpty())
        assertEquals(listOf("interesting"), repository.observeCachedFeed().first().single().reactions)
    }

    @Test
    fun anOfflineReactionStaysPendingShowsAtOnceAndIsSentOnTheNextFlush() = runBlocking {
        var online = false
        val sent = mutableListOf<String>()
        val repository = repository(
            MobileGatewayHttpClient { _, path, _, body, _ ->
                if (path.startsWith("/v1/feed?")) return@MobileGatewayHttpClient GatewayHttpResponse(200, response(post("a", "2026-10-04T07:00:00Z")))
                if (!online) throw java.io.IOException("offline")
                sent += body.orEmpty()
                GatewayHttpResponse(200, actionOk(commandIdOf(body.orEmpty())))
            },
        )
        assertTrue(repository.refreshFeed())

        assertEquals(MobileFeedActionResult.Queued, repository.enqueueFeedReaction("a", FEED_REACTION_BOOKMARK, true))
        // 接続できなくても、端末には残り、画面には重なる。
        val pending = repository.observePendingFeedActions().first()
        assertEquals(1, pending.size)
        assertEquals(listOf("bookmark"), applyPendingFeedActions(repository.observeCachedFeed().first(), pending).single().reactions)

        online = true
        assertTrue(repository.flushFeedActions().isEmpty())

        assertEquals(1, sent.size)
        assertTrue(repository.observePendingFeedActions().first().isEmpty())
    }

    @Test
    fun onlyTheLastOfRepeatedTogglesIsKept() = runBlocking {
        val repository = repository(MobileGatewayHttpClient { _, _, _, _, _ -> throw java.io.IOException("offline") })

        repository.enqueueFeedReaction("a", FEED_REACTION_INTERESTING, true)
        repository.enqueueFeedReaction("a", FEED_REACTION_INTERESTING, false)
        repository.enqueueFeedReaction("a", FEED_REACTION_INTERESTING, true)
        repository.enqueueFeedReaction("a", FEED_REACTION_BOOKMARK, true)

        val pending = repository.observePendingFeedActions().first()
        assertEquals(2, pending.size)
        assertEquals(
            listOf(true, true),
            pending.map { it.action.on },
        )
    }

    @Test
    fun aReplyKeepsItsIdAcrossAResendSoItIsNeverDuplicated() = runBlocking {
        var attempt = 0
        val bodies = mutableListOf<String>()
        val repository = repository(
            MobileGatewayHttpClient { _, path, _, body, _ ->
                if (path.startsWith("/v1/feed?")) return@MobileGatewayHttpClient GatewayHttpResponse(200, response(post("a", "2026-10-04T07:00:00Z")))
                bodies += body.orEmpty()
                attempt += 1
                // 1回目は応答を失う（Desktopには届いている想定）。2回目は変更なしで返る。
                if (attempt == 1) throw java.io.IOException("lost response")
                GatewayHttpResponse(200, actionOk(commandIdOf(body.orEmpty()), "no_change"))
            },
        )
        assertTrue(repository.refreshFeed())

        assertEquals(MobileFeedActionResult.Queued, repository.enqueueFeedReply("a", "  来週読む  "))
        val pending = repository.observePendingFeedActions().first().single()
        assertEquals("来週読む", pending.action.body)
        assertEquals(pending.commandId, pending.action.replyId)

        assertTrue(repository.flushFeedActions().isEmpty())

        assertEquals(2, bodies.size)
        assertEquals(commandIdOf(bodies[0]), commandIdOf(bodies[1]))
        assertTrue(repository.observePendingFeedActions().first().isEmpty())
    }

    @Test
    fun aRejectedActionIsDroppedWithAReasonButAnUnsupportedDesktopKeepsTheInput() = runBlocking {
        var code = "capability_unavailable"
        val repository = repository(
            MobileGatewayHttpClient { _, path, _, _, _ ->
                if (path.startsWith("/v1/feed?")) return@MobileGatewayHttpClient GatewayHttpResponse(200, response(post("a", "2026-10-04T07:00:00Z")))
                GatewayHttpResponse(if (code == "capability_unavailable") 409 else 404, actionError(code))
            },
        )
        assertTrue(repository.refreshFeed())

        repository.enqueueFeedReply("a", "消えてほしくない返信")
        // 書き込み口を持たない接続先。入力は消さず、送れる接続先でまた送る。
        assertEquals(1, repository.observePendingFeedActions().first().size)
        assertTrue(repository.flushFeedActions().isEmpty())
        assertEquals(1, repository.observePendingFeedActions().first().size)

        code = "not_found"
        val reasons = repository.flushFeedActions()
        assertEquals(listOf("この投稿はDesktopで見つかりませんでした。"), reasons)
        assertTrue(repository.observePendingFeedActions().first().isEmpty())
    }

    @Test
    fun withoutWritePermissionNothingIsSavedAndTheReasonIsShown() = runBlocking {
        store.save("https://gateway.test", "w".repeat(43), setOf("mobile:read"))
        val repository = repository(MobileGatewayHttpClient { _, _, _, _, _ -> error("must not be called") })

        val result = repository.enqueueFeedReaction("a", FEED_REACTION_BOOKMARK, true)

        assertTrue(result is MobileFeedActionResult.Unavailable)
        assertTrue(repository.observePendingFeedActions().first().isEmpty())
    }

    @Test
    fun anInvalidReplyIsRejectedBeforeAnythingIsSaved() = runBlocking {
        val repository = repository(MobileGatewayHttpClient { _, _, _, _, _ -> error("must not be called") })

        assertTrue(repository.enqueueFeedReply("a", "   ") is MobileFeedActionResult.Rejected)
        assertTrue(repository.enqueueFeedReply("a", "あ".repeat(FEED_REPLY_MAX_LENGTH + 1)) is MobileFeedActionResult.Rejected)
        assertTrue(repository.observePendingFeedActions().first().isEmpty())
    }

    @Test
    fun cachesTheFeedAndKeepsTheDesktopOrder() = runBlocking {
        val repository = repository(
            MobileGatewayHttpClient { _, path, method, _, token ->
                assertEquals("w".repeat(43), token)
                assertEquals("GET", method)
                assertTrue(path.startsWith("/v1/feed?"))
                GatewayHttpResponse(
                    200,
                    response(post("b", "2026-10-04T08:00:00Z", human = true), post("a", "2026-10-04T07:00:00Z")),
                )
            },
        )

        assertTrue(repository.refreshFeed())

        val cached = repository.observeCachedFeed().first()
        assertEquals(listOf("b", "a"), cached.map { it.postId })
        assertTrue(cached.first().isHuman)
        assertFalse(cached.last().isHuman)
    }

    @Test
    fun aRefreshReplacesThePostsSoDeletedOnesDisappear() = runBlocking {
        var answer = response(post("a", "2026-10-04T07:00:00Z"), post("b", "2026-10-04T06:00:00Z"))
        val repository = repository(MobileGatewayHttpClient { _, _, _, _, _ -> GatewayHttpResponse(200, answer) })
        assertTrue(repository.refreshFeed())
        assertEquals(listOf("a", "b"), repository.observeCachedFeed().first().map { it.postId })

        answer = response(post("b", "2026-10-04T06:00:00Z"))
        assertTrue(repository.refreshFeed())

        assertEquals(listOf("b"), repository.observeCachedFeed().first().map { it.postId })
    }

    @Test
    fun aDesktopWithoutTheFeedRouteKeepsWhatWasSaved() = runBlocking {
        var status = 200
        val repository = repository(
            MobileGatewayHttpClient { _, _, _, _, _ ->
                if (status == 200) {
                    GatewayHttpResponse(200, response(post("a", "2026-10-04T07:00:00Z")))
                } else {
                    GatewayHttpResponse(status, """{"ok":false,"error":{"code":"not_found","message":"unknown"}}""")
                }
            },
        )
        assertTrue(repository.refreshFeed())

        status = 404

        assertFalse(repository.refreshFeed())
        assertEquals(listOf("a"), repository.observeCachedFeed().first().map { it.postId })
    }

    @Test
    fun postsFromAnotherDesktopAreNotSaved() = runBlocking {
        val repository = repository(
            MobileGatewayHttpClient { _, _, _, _, _ ->
                GatewayHttpResponse(200, response(post("a", "2026-10-04T07:00:00Z"), serverId = "server-other"))
            },
        )

        // 接続先が違う応答は保存しない。
        assertFalse(repository.refreshFeed())
        assertTrue(repository.observeCachedFeed().first().isEmpty())
    }
}
