package jp.personal.tasken.companion

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.IOException
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

// Re-pairing to another node of the same workspace (PC Desktop -> NAS): same serverId, different origin.
@RunWith(AndroidJUnit4::class)
class MobileNodeSwitchPairingTest {
    private val oldOrigin = "https://old-node.test"
    private val newOrigin = "https://new-node.test"
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
                lastSuccessfulSyncAt = "2026-08-26T00:00:00Z",
                lastAttemptAt = "2026-08-26T00:00:00Z",
                lastError = null,
            ),
        )
        val refreshId = "refresh-old-node"
        dao.prepareThemeRefresh("server-1", refreshId, "2026-08-26T00:00:00Z")
        dao.completeThemeRefresh(
            "server-1", 900, "2026-08-26T00:00:00Z", "2026-08-26T00:00:00Z", refreshId,
            listOf(ThemeCacheEntity("theme-1", "Theme")),
        )
        store = MobileGatewayConnectionStore(context)
        store.clearToken()
        store.save(oldOrigin, "o".repeat(43), setOf("mobile:read"))
    }

    @After
    fun tearDown() {
        store.clearToken()
        database.close()
    }

    @Test
    fun pairingAnotherOriginResetsThemeRevisionAndKeepsNeverSentCommands() = runBlocking {
        insertCommand("never-sent", OutboxState.Pending, attemptCount = 0)

        pair(newOrigin)

        assertEquals(newOrigin, store.configuration().origin)
        assertNull(dao.themeCatalogState()?.serverRevision)
        assertEquals(OutboxState.Pending, dao.outbox("never-sent")?.state)
    }

    @Test
    fun pairingAnotherOriginIsRefusedWhileACommandMayHaveReachedTheOldNode() = runBlocking {
        insertCommand("in-doubt", OutboxState.RetryWait, attemptCount = 1)

        val result = pair(newOrigin)

        assertTrue(result is MobileTodayResult.PairingRequired)
        assertTrue((result as MobileTodayResult.PairingRequired).message.isNotBlank())
        assertEquals(oldOrigin, store.configuration().origin)
        assertEquals("o".repeat(43), store.readToken())
        assertEquals(900, dao.themeCatalogState()?.serverRevision)
        assertEquals(OutboxState.RetryWait, dao.outbox("in-doubt")?.state)
    }

    @Test
    fun pairingTheSameOriginAgainStaysAllowedEvenWithSentCommands() = runBlocking {
        insertCommand("in-doubt", OutboxState.RetryWait, attemptCount = 1)

        pair(oldOrigin)

        assertEquals("n".repeat(43), store.readToken())
        assertEquals(900, dao.themeCatalogState()?.serverRevision)
    }

    private fun pair(origin: String): MobileTodayResult {
        val repository = AndroidMobileTaskRepository(
            context = context,
            store = store,
            database = database,
            scheduleOutboxOnStart = false,
            httpClient = MobileGatewayHttpClient { _, path, _, _, _ ->
                if (path == "/v1/pair") GatewayHttpResponse(200, pairingResponse()) else throw IOException("offline")
            },
        )
        return repository.pair(origin, "12345678")
    }

    private suspend fun insertCommand(id: String, state: String, attemptCount: Int) {
        dao.insertOutbox(
            OutboxCommandEntity(
                commandId = id,
                idempotencyKey = id,
                requestId = "request-$id",
                clientDeviceId = "android-test-device",
                issuedAt = "2026-08-26T00:00:00Z",
                commandName = "CreateTask",
                envelopeJson = "{}",
                serverId = "server-1",
                state = state,
                attemptCount = attemptCount,
                createdAt = "2026-08-26T00:00:00Z",
                lastAttemptAt = null,
                lastError = null,
            ),
        )
    }

    private fun pairingResponse(): String =
        """
        {
          "ok": true,
          "meta": {
            "apiVersion": 1,
            "schemaVersion": 7,
            "serverId": "server-1",
            "serverRevision": 3,
            "generatedAt": "2026-11-12T00:00:00Z",
            "truncated": false
          },
          "data": {
            "accessToken": "${"n".repeat(43)}",
            "scopes": ["mobile:read"]
          }
        }
        """.trimIndent()
}
