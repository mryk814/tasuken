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
        store.save("https://gateway.test", "w".repeat(43), setOf("mobile:read"))
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
        return """{"postId":"$id","authorKind":"$kind","authorLabel":"$label","topic":"$topic","createdAt":"$at","body":["本文 $id"],"taskId":null,"taskTitle":null,"themeId":null,"themeName":null,"attachment":null,"link":null}"""
    }

    private fun response(vararg posts: String, serverId: String = "server-1"): String =
        """{"ok":true,"meta":{"apiVersion":1,"schemaVersion":$TASKEN_MOBILE_SCHEMA_VERSION,"serverId":"$serverId","serverRevision":1,"generatedAt":"2026-10-04T09:00:00.000Z","truncated":false},"data":{"posts":[${posts.joinToString(",")}],"truncated":false}}"""

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
