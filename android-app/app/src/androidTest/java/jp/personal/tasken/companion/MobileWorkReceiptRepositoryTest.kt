package jp.personal.tasken.companion

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.IOException
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MobileWorkReceiptRepositoryTest {
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
                schemaVersion = 5,
                cursor = "cursor-1",
                lastSuccessfulSyncAt = "2026-08-22T01:00:00Z",
                lastAttemptAt = "2026-08-22T01:00:00Z",
                lastError = null,
            ),
        )
        store = MobileGatewayConnectionStore(context)
        store.clearToken()
        store.save("https://gateway.test", "w".repeat(43))
    }

    @After
    fun tearDown() {
        store.clearToken()
        database.close()
    }

    @Test
    fun remoteDetailIsStrictlyDecodedThenAvailableFromRoomWhenOffline() = runBlocking {
        var online = true
        val repository = repositoryWith { path ->
            assertTrue(path.startsWith("/v1/work-receipt?"))
            assertTrue(path.contains("taskId=task-ai-review"))
            assertTrue(path.contains("receiptId=receipt-ai-review"))
            if (!online) throw IOException("offline")
            GatewayHttpResponse(200, receiptResponse())
        }

        val remote = repository.loadWorkReceipt("task-ai-review", "receipt-ai-review")
        assertTrue(remote is MobileWorkReceiptLoadResult.Available)
        remote as MobileWorkReceiptLoadResult.Available
        assertEquals(false, remote.fromCache)
        assertEquals(listOf("Gateway contract"), remote.detail.completedItems)
        assertNotNull(dao.workReceipt("receipt-ai-review", "server-1"))

        online = false
        val cached = repository.loadWorkReceipt("task-ai-review", "receipt-ai-review")
        assertTrue(cached is MobileWorkReceiptLoadResult.Available)
        cached as MobileWorkReceiptLoadResult.Available
        assertEquals(true, cached.fromCache)
        assertEquals(remote.detail, cached.detail)
        assertTrue(cached.warning.orEmpty().contains("保存済み"))
    }

    @Test
    fun crossServerResponseFailsClosedWithoutWritingCache() = runBlocking {
        val repository = repositoryWith {
            GatewayHttpResponse(200, receiptResponse(serverId = "server-other"))
        }

        val result = repository.loadWorkReceipt("task-ai-review", "receipt-ai-review")

        assertTrue(result is MobileWorkReceiptLoadResult.Unavailable)
        assertEquals(null, dao.workReceipt("receipt-ai-review", "server-1"))
    }

    private fun repositoryWith(
        response: (String) -> GatewayHttpResponse,
    ): AndroidMobileTaskRepository = AndroidMobileTaskRepository(
        context = context,
        store = store,
        database = database,
        scheduleOutboxOnStart = false,
        httpClient = MobileGatewayHttpClient { _, path, method, body, token ->
            assertEquals("GET", method)
            assertEquals(null, body)
            assertEquals("w".repeat(43), token)
            response(path)
        },
    )

    private fun receiptResponse(serverId: String = "server-1"): String =
        """
        {
          "ok": true,
          "meta": {
            "apiVersion": 1,
            "schemaVersion": 5,
            "serverId": "$serverId",
            "serverRevision": 42,
            "generatedAt": "2026-08-22T02:00:00Z",
            "truncated": false
          },
          "data": {
            "receipt": {
              "id": "receipt-ai-review",
              "taskId": "task-ai-review",
              "executorKind": "ai_agent",
              "executorLabel": "Codex",
              "startedAt": "2026-08-22T01:00:00Z",
              "reportedAt": "2026-08-22T01:30:00Z",
              "reportKind": "report",
              "summary": "Androidで確認してください。",
              "completedItems": ["Gateway contract"],
              "changedOrCreatedItems": ["MobileWorkReceiptDto.kt"],
              "verification": ["instrumentation"],
              "remainingWork": ["Fold7 signoff"],
              "externalReferences": []
            }
          }
        }
        """.trimIndent()
}
