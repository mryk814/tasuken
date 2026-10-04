package jp.personal.tasken.companion

import android.content.Context
import android.content.ContextWrapper
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Real PC Gateway/Core/SQLite, explicit loopback fixture only; never app pairing or production data. */
class MobileFeedGatewayTest {
    @Test fun feedActionsSurviveOfflineRestartLostResponsesAndAnUnwritableNode() = runBlocking {
        val fixture = MobileGatewayFixtureClient()
        assumeTrue(fixture.available)
        val args = InstrumentationRegistry.getArguments()
        val context = object : ContextWrapper(InstrumentationRegistry.getInstrumentation().targetContext) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int) =
                super.getSharedPreferences("feed-live-fixture-$name", mode)
        }
        val preferences = context.getSharedPreferences("tasken_mobile_gateway", Context.MODE_PRIVATE)
        preferences.edit().clear().putString("device_id", fixture.deviceId).commit()
        val store = MobileGatewayConnectionStore(context)
        store.save(requireNotNull(args.getString("gatewayOrigin")), requireNotNull(args.getString("gatewayToken")),
            setOf("mobile:read", "mobile:capture-write"))
        val db = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java).build()
        try {
            db.mobileDao().upsertSyncState(SyncStateEntity(serverId = fixture.serverId, apiVersion = 1,
                schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION, cursor = null,
                lastSuccessfulSyncAt = "2026-10-04T09:00:00Z", lastAttemptAt = null, lastError = null))
            val repository = AndroidMobileTaskRepository(context = context, store = store, database = db,
                scheduleOutboxOnStart = false)
            fixture.control("{\"seedFeed\":true}")
            assertTrue(repository.refreshFeed())
            val post = repository.observeCachedFeed().first().single()
            assertEquals(listOf("合成PC gatewayの投稿"), post.body)

            assertEquals(MobileFeedActionResult.Queued,
                repository.enqueueFeedReaction(post.postId, FEED_REACTION_BOOKMARK, true))
            assertTrue(repository.observePendingFeedActions().first().isEmpty())
            assertEquals(listOf(FEED_REACTION_BOOKMARK), repository.observeCachedFeed().first().single().reactions)
            assertEquals(1, fixture.snapshot().getValue("feedReactions").jsonArray.size)

            fixture.control("{\"offline\":true}")
            assertEquals(MobileFeedActionResult.Queued, repository.enqueueFeedReply(post.postId, "合成: PC停止中の返信"))
            assertEquals(1, repository.observePendingFeedActions().first().size)
            fixture.control("{\"restartDesktop\":true,\"offline\":false}")
            assertTrue(repository.flushFeedActions().isEmpty())
            assertTrue(repository.observePendingFeedActions().first().isEmpty())
            assertEquals("合成: PC停止中の返信", repository.observeCachedFeed().first().single().replies.single().body)

            fixture.control("{\"dropNextReceipt\":true}")
            repository.enqueueFeedReply(post.postId, "合成: 応答を失った返信")
            // HttpURLConnection may resend the same POST before returning to the repository.
            assertTrue(repository.observePendingFeedActions().first().size <= 1)
            assertEquals("1", fixture.snapshot().getValue("lostReceipts").jsonPrimitive.content)
            assertEquals(2, fixture.snapshot().getValue("feedReplies").jsonArray.size)
            assertTrue(repository.flushFeedActions().isEmpty())
            assertTrue(repository.observePendingFeedActions().first().isEmpty())
            assertEquals(2, fixture.snapshot().getValue("feedReplies").jsonArray.size)
            val repeated = fixture.snapshot().getValue("seenCommands").jsonArray.map { it.jsonObject }
                .filter { it.getValue("action").jsonObject["body"]?.jsonPrimitive?.content == "合成: 応答を失った返信" }
            assertTrue(repeated.size >= 2)
            assertEquals(1, repeated.map { it.getValue("commandId").jsonPrimitive.content }.distinct().size)

            fixture.control("{\"feedWritable\":false,\"restartDesktop\":true}")
            repository.enqueueFeedReply(post.postId, "合成: 書込み口のない接続先で保留")
            assertEquals(1, repository.observePendingFeedActions().first().size)
            assertEquals(2, fixture.snapshot().getValue("feedReplies").jsonArray.size)
            fixture.control("{\"feedWritable\":true,\"restartDesktop\":true}")
            assertTrue(repository.flushFeedActions().isEmpty())
            assertTrue(repository.observePendingFeedActions().first().isEmpty())
            assertEquals(3, fixture.snapshot().getValue("feedReplies").jsonArray.size)
            assertTrue(repository.refreshFeed())
            assertEquals(3, repository.observeCachedFeed().first().single().replies.size)
        } finally {
            store.clearToken()
            preferences.edit().clear().commit()
            db.close()
        }
    }
}
