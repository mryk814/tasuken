package jp.personal.tasken.companion

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.time.Instant
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MobileThemeCatalogRepositoryTest {
    private lateinit var context: Context
    private lateinit var database: MobileLocalDatabase
    private lateinit var dao: MobileLocalDao

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
                cursor = "task-cursor",
                lastSuccessfulSyncAt = "2026-08-22T01:00:00Z",
                lastAttemptAt = "2026-08-22T01:00:00Z",
                lastError = null,
            ),
        )
    }

    @After
    fun tearDown() {
        database.close()
    }

    @Test
    fun oldDesktop404BecomesUnsupportedWithoutRetryAndClearsStaleCandidates() = runBlocking {
        seedCatalog(4, listOf(ThemeCacheEntity("theme-old", "Old")))
        val repository = repositoryWith { GatewayHttpResponse(404, "") }

        val outcome = repository.refreshThemes("https://gateway.test", "token")

        assertEquals(MobileThemeRefreshOutcome.Unsupported, outcome)
        assertTrue(dao.themes().isEmpty())
        assertEquals(ThemeCatalogStatus.Unsupported, dao.themeCatalogState()?.status)
        assertEquals("server-1", dao.themeCatalogState()?.serverId)
        assertEquals(null, dao.themeCatalogState()?.serverRevision)
    }

    @Test
    fun oldDesktopTheme404DoesNotFailTodayOrRequestBackgroundRetry() {
        val store = MobileGatewayConnectionStore(context)
        store.clearToken()
        store.save("https://gateway.test", "a".repeat(43))
        try {
            val repository = AndroidMobileTaskRepository(
                context = context,
                store = store,
                database = database,
                scheduleOutboxOnStart = false,
                httpClient = MobileGatewayHttpClient { _, path, _, _, _ ->
                    when {
                        path.startsWith("/v1/bootstrap") -> GatewayHttpResponse(200, emptyTaskBootstrap())
                        path.startsWith("/v1/sync") -> GatewayHttpResponse(200, emptyTaskSyncPage())
                        path.startsWith("/v1/themes") -> GatewayHttpResponse(404, "")
                        else -> error("Unexpected request path: $path")
                    }
                },
                themeNow = { Instant.parse("2026-08-22T02:00:00Z") },
            )

            assertTrue(repository.loadToday() is MobileTodayResult.Available)
            assertEquals(true, runBlocking { repository.synchronizeIfPaired() })
            assertEquals(ThemeCatalogStatus.Unsupported, runBlocking { dao.themeCatalogState() }?.status)
        } finally {
            store.clearToken()
        }
    }

    @Test
    fun retryableThemeFailureKeepsTaskSyncSuccessfulAndRequestsBackgroundRetry() {
        val store = MobileGatewayConnectionStore(context)
        store.clearToken()
        store.save("https://gateway.test", "b".repeat(43))
        try {
            val repository = AndroidMobileTaskRepository(
                context = context,
                store = store,
                database = database,
                scheduleOutboxOnStart = false,
                httpClient = MobileGatewayHttpClient { _, path, _, _, _ ->
                    when {
                        path.startsWith("/v1/bootstrap") -> GatewayHttpResponse(200, emptyTaskBootstrap())
                        path.startsWith("/v1/sync") -> GatewayHttpResponse(200, emptyTaskSyncPage())
                        path.startsWith("/v1/themes") -> GatewayHttpResponse(503, "")
                        else -> error("Unexpected request path: $path")
                    }
                },
                themeNow = { Instant.parse("2026-08-22T02:00:00Z") },
            )

            assertEquals(false, runBlocking { repository.synchronizeIfPaired() })
            assertEquals(ThemeCatalogStatus.Error, runBlocking { dao.themeCatalogState() }?.status)
            assertEquals("server-1", runBlocking { dao.syncState() }?.serverId)
        } finally {
            store.clearToken()
        }
    }

    @Test
    fun revisionMutationBetweenPagesFailsClosedAndKeepsPreviousCatalogStale() = runBlocking {
        seedCatalog(6, listOf(ThemeCacheEntity("theme-old", "Old")))
        var page = 0
        val repository = repositoryWith {
            page += 1
            if (page == 1) {
                GatewayHttpResponse(200, themePage(7, "cursor-a", "theme-a"))
            } else {
                GatewayHttpResponse(200, themePage(8, null, "theme-b"))
            }
        }

        val outcome = repository.refreshThemes("https://gateway.test", "token")

        assertTrue(outcome is MobileThemeRefreshOutcome.Failed && outcome.retryable)
        assertEquals(listOf("theme-old"), dao.themes().map { it.id })
        assertEquals(6, dao.themeCatalogState()?.serverRevision)
        assertEquals(ThemeCatalogStatus.Stale, dao.themeCatalogState()?.status)
    }

    @Test
    fun cursorCycleFailsClosedWithoutReplacingPreviousCatalog() = runBlocking {
        seedCatalog(6, listOf(ThemeCacheEntity("theme-old", "Old")))
        var page = 0
        val repository = repositoryWith {
            page += 1
            when (page) {
                1 -> GatewayHttpResponse(200, themePage(7, "cursor-a", "theme-a"))
                2 -> GatewayHttpResponse(200, themePage(7, "cursor-b", "theme-b"))
                else -> GatewayHttpResponse(200, themePage(7, "cursor-a", "theme-c"))
            }
        }

        val outcome = repository.refreshThemes("https://gateway.test", "token")

        assertTrue(outcome is MobileThemeRefreshOutcome.Failed && outcome.retryable)
        assertEquals(listOf("theme-old"), dao.themes().map { it.id })
        assertEquals(ThemeCatalogStatus.Stale, dao.themeCatalogState()?.status)
    }

    @Test
    fun duplicateIdAcrossPagesFailsClosedEvenWhenEachPageIsValid() = runBlocking {
        seedCatalog(6, listOf(ThemeCacheEntity("theme-old", "Old")))
        var page = 0
        val repository = repositoryWith {
            page += 1
            if (page == 1) {
                GatewayHttpResponse(200, themePage(7, "cursor-a", "theme-duplicate"))
            } else {
                GatewayHttpResponse(200, themePage(7, null, "theme-duplicate"))
            }
        }

        val outcome = repository.refreshThemes("https://gateway.test", "token")

        assertTrue(outcome is MobileThemeRefreshOutcome.Failed && !outcome.retryable)
        assertEquals(listOf("theme-old"), dao.themes().map { it.id })
        assertEquals(ThemeCatalogStatus.Stale, dao.themeCatalogState()?.status)
    }

    @Test
    fun observationRecoversCachedLoadingOwnedByAnOldProcessToStale() = runBlocking {
        seedCatalog(9, listOf(ThemeCacheEntity("theme-cached", "Cached")))
        dao.prepareThemeRefresh("server-1", "old-process:refresh", "2026-08-22T02:00:00Z")
        val repository = AndroidMobileTaskRepository(
            context = context,
            database = database,
            scheduleOutboxOnStart = false,
            themeNow = { Instant.parse("2026-08-22T02:01:00Z") },
            processInstanceId = "new-process",
        )

        val state = repository.observeThemeCatalogState().first()

        assertTrue(state is MobileThemeCatalogState.Stale)
        assertEquals(listOf("theme-cached"), state.themes.map { it.id })
        assertEquals(9, (state as MobileThemeCatalogState.Stale).serverRevision)
        assertNull(dao.themeCatalogState()?.activeRefreshId)
    }

    @Test
    fun observationDoesNotStealARefreshOwnedByTheCurrentProcess() = runBlocking {
        seedCatalog(9, listOf(ThemeCacheEntity("theme-cached", "Cached")))
        dao.prepareThemeRefresh("server-1", "same-process:refresh", "2026-08-22T02:00:00Z")
        val repository = AndroidMobileTaskRepository(
            context = context,
            database = database,
            scheduleOutboxOnStart = false,
            processInstanceId = "same-process",
        )

        val state = repository.observeThemeCatalogState().first()

        assertTrue(state is MobileThemeCatalogState.Loading)
        assertEquals("same-process:refresh", dao.themeCatalogState()?.activeRefreshId)
    }

    @Test
    fun observationRecoversInterruptedInitialLoadingToError() = runBlocking {
        dao.prepareThemeRefresh("server-1", "old-process:initial", "2026-08-22T02:00:00Z")
        val repository = AndroidMobileTaskRepository(
            context = context,
            database = database,
            scheduleOutboxOnStart = false,
            processInstanceId = "new-process",
        )

        val state = repository.observeThemeCatalogState().first()

        assertTrue(state is MobileThemeCatalogState.Error)
        assertTrue(state.themes.isEmpty())
        assertNull(dao.themeCatalogState()?.activeRefreshId)
    }

    @Test
    fun bootstrapConfirmsServerBeforePostingAndNeverSendsOldServerOutbox() = runBlocking {
        val localOutbox = MobileOutbox(context, dao, { "device" }, schedule = {})
        val taskId = localOutbox.enqueueCreate("旧Desktop向け", java.time.LocalDate.parse("2026-08-22"))
        val commandId = requireNotNull(dao.task(taskId)?.optimisticCommandId)
        val store = MobileGatewayConnectionStore(context)
        store.clearToken()
        store.save("https://gateway.test", "c".repeat(43))
        val requestedPaths = mutableListOf<String>()
        try {
            val repository = AndroidMobileTaskRepository(
                context = context,
                store = store,
                database = database,
                scheduleOutboxOnStart = false,
                httpClient = MobileGatewayHttpClient { _, path, _, _, _ ->
                    requestedPaths += path
                    GatewayHttpResponse(200, emptyTaskBootstrap(serverId = "server-2"))
                },
            )

            assertEquals(true, repository.synchronizeIfPaired())
            assertEquals(1, requestedPaths.size)
            assertTrue(requestedPaths.single().startsWith("/v1/bootstrap"))
            assertEquals(OutboxState.Pending, dao.outbox(commandId)?.state)
            assertEquals("server-1", dao.syncState()?.serverId)
        } finally {
            store.clearToken()
        }
    }

    @Test
    fun pairToDifferentServerDoesNotSaveNewCredentialsOrSendOldOutbox() = runBlocking {
        val localOutbox = MobileOutbox(context, dao, { "device" }, schedule = {})
        val taskId = localOutbox.enqueueCreate("旧Desktop向け", java.time.LocalDate.parse("2026-08-22"))
        val commandId = requireNotNull(dao.task(taskId)?.optimisticCommandId)
        val store = MobileGatewayConnectionStore(context)
        store.clearToken()
        val requestedPaths = mutableListOf<String>()
        try {
            val repository = AndroidMobileTaskRepository(
                context = context,
                store = store,
                database = database,
                scheduleOutboxOnStart = false,
                httpClient = MobileGatewayHttpClient { _, path, _, _, _ ->
                    requestedPaths += path
                    GatewayHttpResponse(200, pairResponse("server-2", "g".repeat(43)))
                },
            )

            val result = repository.pair("https://gateway.test", "12345678")

            assertTrue(result is MobileTodayResult.Unavailable)
            assertNull(store.readToken())
            assertEquals(listOf("/v1/pair"), requestedPaths)
            assertEquals(OutboxState.Pending, dao.outbox(commandId)?.state)
            assertEquals("server-1", dao.syncState()?.serverId)
        } finally {
            store.clearToken()
        }
    }

    @Test
    fun sameServerRepairPairsThenConfirmsIdentityAndDrainsOwnedOutboxWithReplacementCredential() = runBlocking {
        val localOutbox = MobileOutbox(context, dao, { "device" }, schedule = {})
        val taskId = localOutbox.enqueueCreate("再pair後に送る", java.time.LocalDate.parse("2026-08-22"))
        val commandId = requireNotNull(dao.task(taskId)?.optimisticCommandId)
        assertEquals("server-1", dao.outbox(commandId)?.serverId)
        val store = MobileGatewayConnectionStore(context)
        val revokedToken = "d".repeat(43)
        val replacementToken = "g".repeat(43)
        store.clearToken()
        store.save("https://gateway.test", revokedToken)
        val requestedPaths = mutableListOf<String>()
        val requestTokens = mutableListOf<String?>()
        var commandPosted = false
        try {
            val repository = AndroidMobileTaskRepository(
                context = context,
                store = store,
                database = database,
                scheduleOutboxOnStart = false,
                httpClient = MobileGatewayHttpClient { _, path, _, body, accessToken ->
                    requestedPaths += path
                    requestTokens += accessToken
                    when {
                        path == "/v1/pair" -> GatewayHttpResponse(
                            200,
                            pairResponse("server-1", replacementToken),
                        )
                        path.startsWith("/v1/bootstrap") -> GatewayHttpResponse(
                            200,
                            emptyTaskBootstrap(if (commandPosted) taskId else null),
                        )
                        path == "/v1/commands" -> {
                            assertEquals(commandId, MobileTaskCommandContract.decodeCreateEnvelope(requireNotNull(body)).commandId)
                            commandPosted = true
                            GatewayHttpResponse(200, commandReceipt(commandId, taskId))
                        }
                        path.startsWith("/v1/themes") -> GatewayHttpResponse(404, "")
                        else -> error("Unexpected request path: $path")
                    }
                },
            )

            assertTrue(repository.pair("https://gateway.test", "12345678") is MobileTodayResult.Available)
            assertEquals(
                listOf("/v1/pair", "/v1/bootstrap", "/v1/commands", "/v1/bootstrap", "/v1/themes"),
                requestedPaths.map { it.substringBefore('?') },
            )
            assertEquals(listOf(null) + List(4) { replacementToken }, requestTokens)
            assertEquals(replacementToken, store.readToken())
            assertEquals("https://gateway.test", store.configuration().origin)
            assertTrue(store.configuration().canReviewWorkReceipts())
            assertNull(dao.outbox(commandId))
            assertEquals(1, dao.task(taskId)?.serverVersion)
        } finally {
            store.clearToken()
        }
    }

    @Test
    fun deletedThemeGatewayErrorRejectsAndRollsBackWhilePreservingMessage() = runBlocking {
        val taskId = "theme-rejected-transport-task"
        seedCatalog(
            7,
            listOf(
                ThemeCacheEntity("theme-old", "旧Theme"),
                ThemeCacheEntity("theme-deleted", "削除済みTheme"),
            ),
        )
        dao.upsertTask(
            TaskCacheEntity(
                id = taskId,
                serverVersion = 3,
                title = "Theme transport",
                themeId = "theme-old",
                state = "todo",
                workState = null,
                todayDate = "2026-08-22",
                updatedAt = "2026-08-22T01:00:00Z",
                optimisticCommandId = null,
            ),
        )
        val localOutbox = MobileOutbox(context, dao, { "device" }, schedule = {})
        val commandId = localOutbox.enqueueUpdateTheme(taskId, "theme-deleted")
        val store = MobileGatewayConnectionStore(context)
        store.clearToken()
        store.save("https://gateway.test", "h".repeat(43))
        val requestedPaths = mutableListOf<String>()
        try {
            val repository = AndroidMobileTaskRepository(
                context = context,
                store = store,
                database = database,
                scheduleOutboxOnStart = false,
                httpClient = MobileGatewayHttpClient { _, path, _, body, _ ->
                    requestedPaths += path.substringBefore('?')
                    when {
                        path.startsWith("/v1/bootstrap") -> GatewayHttpResponse(200, emptyTaskBootstrap())
                        path == "/v1/commands" -> {
                            assertEquals(
                                commandId,
                                MobileTaskCommandContract.decodeUpdateEnvelope(requireNotNull(body)).commandId,
                            )
                            GatewayHttpResponse(404, themeNotFoundError())
                        }
                        path.startsWith("/v1/sync") -> GatewayHttpResponse(200, emptyTaskSyncPage())
                        path.startsWith("/v1/themes") -> GatewayHttpResponse(200, themePage(7, null, "theme-old"))
                        else -> error("Unexpected request path: $path")
                    }
                },
            )

            assertTrue(repository.synchronizeIfPaired())

            assertEquals(
                listOf("/v1/bootstrap", "/v1/commands", "/v1/sync", "/v1/proposals", "/v1/themes"),
                requestedPaths,
            )
            assertEquals(OutboxState.Rejected, dao.outbox(commandId)?.state)
            assertEquals("theme-old", dao.task(taskId)?.themeId)
            assertNull(dao.task(taskId)?.optimisticCommandId)
            val rejected = repository.observeAllCachedTasks().first().single().rejectedThemeUpdate
            assertEquals("theme_not_found", rejected?.code)
            assertEquals("選択したThemeは削除済みか利用できません。", rejected?.message)
        } finally {
            store.clearToken()
        }
    }

    @Test
    fun oldWorkerCannotClearTokenSavedByANewerRepair() {
        val store = MobileGatewayConnectionStore(context)
        val oldToken = "e".repeat(43)
        val newToken = "f".repeat(43)
        store.clearToken()
        try {
            store.save("https://gateway.test", oldToken)
            store.save("https://gateway.test", newToken)

            store.clearTokenIfMatches(oldToken)

            assertEquals(newToken, store.readToken())
            store.clearTokenIfMatches(newToken)
            assertNull(store.readToken())
        } finally {
            store.clearToken()
        }
    }

    private fun repositoryWith(response: () -> GatewayHttpResponse): AndroidMobileTaskRepository =
        AndroidMobileTaskRepository(
            context = context,
            database = database,
            scheduleOutboxOnStart = false,
            httpClient = MobileGatewayHttpClient { _, path, _, _, _ ->
                require(path.startsWith("/v1/themes"))
                response()
            },
            themeNow = { Instant.parse("2026-08-22T02:00:00Z") },
        )

    private suspend fun seedCatalog(revision: Int, themes: List<ThemeCacheEntity>) {
        dao.prepareThemeRefresh("server-1", "seed-$revision", "2026-08-22T01:00:00Z")
        assertTrue(
            dao.completeThemeRefresh(
                serverId = "server-1",
                serverRevision = revision,
                generatedAt = "2026-08-22T01:00:00Z",
                attemptedAt = "2026-08-22T01:00:00Z",
                refreshId = "seed-$revision",
                themes = themes,
            ),
        )
    }

    private fun themePage(revision: Int, nextCursor: String?, themeId: String): String {
        val cursorJson = nextCursor?.let { "\"$it\"" } ?: "null"
        return """
            {
              "ok": true,
              "meta": {
                "apiVersion": 1,
                "schemaVersion": 6,
                "serverId": "server-1",
                "serverRevision": $revision,
                "generatedAt": "2026-08-22T02:00:00Z",
                "truncated": ${nextCursor != null}
              },
              "data": {
                "themes": [{"id": "$themeId", "title": "$themeId"}],
                "nextCursor": $cursorJson
              }
            }
        """.trimIndent()
    }

    private fun emptyTaskSyncPage(): String = """
        {
          "ok": true,
          "meta": {
            "apiVersion": 1,
            "schemaVersion": 6,
            "serverId": "server-1",
            "serverRevision": 7,
            "generatedAt": "2026-08-22T02:00:00Z",
            "truncated": false
          },
          "data": {
            "changes": [],
            "nextCursor": "task-cursor",
            "hasMore": false
          }
        }
    """.trimIndent()

    private fun themeNotFoundError(): String = """
        {
          "ok": false,
          "meta": {
            "apiVersion": 1,
            "schemaVersion": 6,
            "serverId": "server-1",
            "serverRevision": 7,
            "generatedAt": "2026-08-22T02:00:00Z",
            "truncated": false
          },
          "error": {
            "code": "theme_not_found",
            "message": "選択したThemeは削除済みか利用できません。",
            "retryable": false
          }
        }
    """.trimIndent()

    private fun emptyTaskBootstrap(taskId: String? = null, serverId: String = "server-1"): String {
        val tasks = taskId?.let {
            """[{"id":"$it","version":1,"title":"再pair後に送る","themeId":null,"state":"todo","workState":null,"todayDate":"2026-08-22","schedule":null,"updatedAt":"2026-08-22T02:00:00Z"}]"""
        } ?: "[]"
        return """
            {
              "ok": true,
              "meta": {
                "apiVersion": 1,
                "schemaVersion": 6,
                "serverId": "$serverId",
                "serverRevision": 7,
                "generatedAt": "2026-08-22T02:00:00Z",
                "truncated": false
              },
              "data": {
                "tasks": $tasks,
                "nextCursor": "task-cursor",
                "hasMore": false
              }
            }
        """.trimIndent()
    }

    private fun commandReceipt(commandId: String, taskId: String): String = """
        {
          "ok": true,
          "meta": {
            "apiVersion": 1,
            "schemaVersion": 6,
            "serverId": "server-1",
            "serverRevision": 8,
            "generatedAt": "2026-08-22T02:00:00Z",
            "truncated": false
          },
          "data": {
            "commandId": "$commandId",
            "status": "applied",
            "task": {
              "id": "$taskId",
              "version": 1,
              "title": "再pair後に送る",
              "themeId": null,
              "state": "todo",
              "workState": null,
              "todayDate": "2026-08-22",
              "schedule": null,
              "updatedAt": "2026-08-22T02:00:00Z"
            }
          }
        }
    """.trimIndent()

    private fun pairResponse(serverId: String, token: String): String = """
        {
          "ok": true,
          "meta": {
            "apiVersion": 1,
            "schemaVersion": 6,
            "serverId": "$serverId",
            "serverRevision": 7,
            "generatedAt": "2026-08-22T02:00:00Z",
            "truncated": false
          },
          "data": {
            "accessToken": "$token",
            "scopes": ["mobile:read", "mobile:human-review"]
          }
        }
    """.trimIndent()
}
