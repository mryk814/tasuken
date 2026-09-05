package jp.personal.tasken.companion

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.IOException
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MobileHumanReviewRepositoryTest {
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
        store = MobileGatewayConnectionStore(context)
        store.clearToken()
        store.save("https://gateway.test", "w".repeat(43), setOf("mobile:human-review"))
    }

    @After
    fun tearDown() {
        store.clearToken()
        database.close()
    }

    @Test
    fun responseLossRetryKeepsCommandIdentityAndAppliesCanonicalTaskBeforeSync() = runBlocking {
        val requestBodies = mutableListOf<String>()
        var attempts = 0
        val httpClient = MobileGatewayHttpClient { _, path, method, body, token ->
                assertEquals("w".repeat(43), token)
                when {
                    path == "/v1/work-reviews" -> {
                        assertEquals("POST", method)
                        val requestBody = requireNotNull(body)
                        val envelope = Json.decodeFromString<MobileTaskWorkReviewEnvelopeDto>(requestBody)
                        requestBodies += requestBody
                        attempts += 1
                        if (attempts == 1) throw IOException("response lost")
                        GatewayHttpResponse(200, reviewResponse(envelope.commandId))
                    }
                    path.startsWith("/v1/sync?") -> throw IOException("sync unavailable")
                    else -> error("Unexpected Mobile Gateway path: $path")
                }
            }
        fun repositoryAfterRestart() = AndroidMobileTaskRepository(
            context = context,
            store = store,
            database = database,
            scheduleOutboxOnStart = false,
            httpClient = httpClient,
        )
        val task = MobileTask(
            id = "task-1",
            title = "Review task",
            themeId = null,
            state = "review",
            workState = "needs_human_review",
            updatedAt = "2026-08-26T00:00:00Z",
            version = 5,
            latestWorkReceipt = MobileWorkReceiptSummary(
                id = "receipt-1",
                reportedAt = "2026-08-26T00:00:00Z",
                executorLabel = "Codex",
                summary = "ready",
            ),
        )

        assertTrue(repositoryAfterRestart().reviewTaskWork(task, "return", "  needs one more check  ") is MobileHumanReviewResult.Unavailable)
        assertTrue(dao.pendingHumanReview(requestBodies.single().let {
            Json.decodeFromString<MobileTaskWorkReviewEnvelopeDto>(it).commandId
        }) != null)
        val applied = repositoryAfterRestart().reviewTaskWork(task, "return", "needs one more check")

        assertTrue(applied is MobileHumanReviewResult.Applied)
        assertEquals(2, requestBodies.size)
        assertEquals(requestBodies.first(), requestBodies.last())
        assertEquals(null, dao.pendingHumanReview(Json.decodeFromString<MobileTaskWorkReviewEnvelopeDto>(requestBodies.first()).commandId))
        val cached = requireNotNull(dao.task("task-1"))
        assertEquals(6, cached.serverVersion)
        assertEquals("done", cached.state)
        assertEquals("accepted", cached.workState)
    }

    @Test
    fun delayedLowerVersionReviewResponseCannotReplaceNewerCachedTask() = runBlocking {
        dao.upsertTask(
            TaskCacheEntity(
                id = "task-1",
                serverVersion = 7,
                title = "Newer task",
                themeId = null,
                state = "review",
                workState = "needs_human_review",
                todayDate = null,
                updatedAt = "2026-08-26T00:00:02Z",
                optimisticCommandId = null,
            ),
        )
        dao.insertPendingHumanReview(
            PendingHumanReviewEntity(
                commandId = "review-command-1",
                serverId = "server-1",
                taskId = "task-1",
                envelopeJson = "{}",
                createdAt = "2026-08-26T00:00:00Z",
            ),
        )

        dao.applyHumanReviewSuccess(
            commandId = "review-command-1",
            canonicalTask = TaskCacheEntity(
                id = "task-1",
                serverVersion = 6,
                title = "Delayed review response",
                themeId = null,
                state = "done",
                workState = "accepted",
                todayDate = null,
                updatedAt = "2026-08-26T00:00:01Z",
                optimisticCommandId = null,
            ),
        )

        val cached = requireNotNull(dao.task("task-1"))
        assertEquals(7, cached.serverVersion)
        assertEquals("Newer task", cached.title)
        assertEquals(null, dao.pendingHumanReview("review-command-1"))
    }

    @Test
    fun humanReviewScopeIsFailClosedForOldTokensAndClearedWithToken() {
        store.save("https://gateway.test", "w".repeat(43))
        assertTrue(store.configuration().paired)
        assertEquals(false, store.configuration().canReviewWorkReceipts())

        assertThrows(IllegalArgumentException::class.java) {
            store.save(
                "https://gateway.test",
                "w".repeat(43),
                setOf("mobile:read", "mobile:admin"),
            )
        }

        store.save(
            "https://gateway.test",
            "w".repeat(43),
            setOf("mobile:read", "mobile:human-review"),
        )
        assertTrue(store.configuration().canReviewWorkReceipts())

        store.clearToken()
        assertEquals(false, store.configuration().paired)
        assertEquals(emptySet<String>(), store.configuration().scopes)
    }

    @Test
    fun pairingRejectsResponseWithoutScopesAndDoesNotSaveItsToken() {
        store.clearToken()
        val repository = AndroidMobileTaskRepository(
            context = context,
            store = store,
            database = database,
            scheduleOutboxOnStart = false,
            httpClient = MobileGatewayHttpClient { _, path, method, _, token ->
                assertEquals("/v1/pair", path)
                assertEquals("POST", method)
                assertEquals(null, token)
                GatewayHttpResponse(200, pairingResponseWithoutScopes())
            },
        )

        val result = repository.pair("https://gateway.test", "12345678")

        assertTrue(result is MobileTodayResult.PairingRequired)
        assertEquals(null, store.readToken())
        assertEquals(emptySet<String>(), store.configuration().scopes)
    }

    private fun reviewResponse(commandId: String): String =
        """
        {
          "ok": true,
          "meta": {
            "apiVersion": 1,
            "schemaVersion": 7,
            "serverId": "server-1",
            "serverRevision": 42,
            "generatedAt": "2026-08-26T00:00:01Z",
            "truncated": false
          },
          "data": {
            "commandId": "$commandId",
            "commandStatus": "applied",
            "action": "return",
            "receiptId": "receipt-1",
            "task": {
              "id": "task-1",
              "version": 6,
              "title": "Review task",
              "themeId": null,
              "state": "done",
              "workState": "accepted",
              "todayDate": null,
              "plannedStartTime": null,
              "plannedDurationMinutes": null,
              "latestWorkReceipt": null,
              "checklistItems": [],
              "schedule": null,
              "updatedAt": "2026-08-26T00:00:01Z"
            }
          }
        }
        """.trimIndent()

    private fun pairingResponseWithoutScopes(): String =
        """
        {
          "ok": true,
          "meta": {
            "apiVersion": 1,
            "schemaVersion": 7,
            "serverId": "server-1",
            "serverRevision": 42,
            "generatedAt": "2026-08-30T00:00:00Z",
            "truncated": false
          },
          "data": {
            "accessToken": "${"x".repeat(43)}"
          }
        }
        """.trimIndent()
}
