package jp.personal.tasken.companion

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.time.Instant
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * #761 regression: a command the Desktop answers with 503 used to stop every later command and the read.
 * Uses only the HTTP boundary, so it runs the same on the code before the fix.
 */
@RunWith(AndroidJUnit4::class)
class MobileOutboxRetryRepositoryTest {
    private lateinit var context: Context
    private lateinit var database: MobileLocalDatabase
    private lateinit var dao: MobileLocalDao
    private var clock = Instant.parse("2026-08-22T01:02:03Z")
    private lateinit var outbox: MobileOutbox

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
        outbox = MobileOutbox(context, dao, { "device" }, now = { clock }, schedule = {})
    }

    @After
    fun tearDown() {
        database.close()
    }

    @Test
    fun failingHeadCommandLetsLaterTaskThroughAndStillReadsDesktop() = runBlocking {
        seedTask("task-a", version = 3, title = "元の名前")
        seedTask("task-b", version = 5, title = "完了するTask")
        val renameA = outbox.enqueueUpdateTitle("task-a", "端末で変えた名前")
        tick()
        val completeB = requireNotNull(outbox.enqueueComplete("task-b").commandId)
        val store = MobileGatewayConnectionStore(context)
        store.clearToken()
        store.save("https://gateway.test", "r".repeat(43))
        val sentCommands = mutableListOf<String>()
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
                        path.startsWith("/v1/bootstrap") -> GatewayHttpResponse(
                            200,
                            page("tasks", listOf(taskJson("task-a", 3, "元の名前"), taskJson("task-b", 5, "完了するTask"))),
                        )
                        path == "/v1/commands" -> {
                            val commandId = Json.parseToJsonElement(requireNotNull(body)).jsonObject
                                .getValue("commandId").jsonPrimitive.content
                            sentCommands += commandId
                            if (commandId == renameA) {
                                GatewayHttpResponse(503, "")
                            } else {
                                GatewayHttpResponse(200, receipt(commandId, taskJson("task-b", 6, "完了するTask", "done")))
                            }
                        }
                        path.startsWith("/v1/sync") -> GatewayHttpResponse(
                            200,
                            page("changes", listOf(
                                """{"kind":"upsert","task":${taskJson("task-a", 3, "元の名前")}}""",
                                """{"kind":"upsert","task":${taskJson("task-b", 6, "完了するTask", "done")}}""",
                            )),
                        )
                        path.startsWith("/v1/themes") -> GatewayHttpResponse(404, "")
                        else -> GatewayHttpResponse(404, "")
                    }
                },
            )

            assertFalse(repository.synchronizeIfPaired())
            // Only A's own failure is left: the workers must not back off and hold back the next operation.
            assertEquals(MobileSyncOutcome.CommandsWaiting, repository.lastSyncOutcome)

            assertEquals(listOf(renameA, completeB), sentCommands)
            // A receipt resets the sync cursor, so the read after the commands is a fresh bootstrap.
            val afterCommands = requestedPaths.drop(requestedPaths.lastIndexOf("/v1/commands") + 1)
            assertTrue(afterCommands.any { it == "/v1/bootstrap" || it == "/v1/sync" })
            assertNull(dao.outbox(completeB))
            assertEquals("done", dao.task("task-b")?.state)
            assertEquals(6, dao.task("task-b")?.serverVersion)
            val waiting = requireNotNull(dao.outbox(renameA))
            assertEquals(OutboxState.RetryWait, waiting.state)
            assertEquals(1, waiting.attemptCount)
            assertTrue(requireNotNull(waiting.lastError).contains("503"))
            // The read must not overwrite the change still waiting to be sent.
            assertEquals("端末で変えた名前", dao.task("task-a")?.title)
            assertEquals(renameA, dao.task("task-a")?.optimisticCommandId)
        } finally {
            store.clearToken()
        }
    }

    @Test
    fun answerDecidesWhetherOnlyThisCommandFailedOrTheDesktopWasNotReached() = runBlocking {
        data class Case(val name: String, val answer: GatewayHttpResponse, val desktopReached: Boolean)
        val cases = listOf(
            // 429 asks this device to slow down: nothing else this round, and no read.
            Case("429", GatewayHttpResponse(429, ""), desktopReached = false),
            // A 200 that is not JSON is not the Desktop (a captive portal, for example).
            Case("200 HTML", GatewayHttpResponse(200, "<html>Wi-Fi login</html>"), desktopReached = false),
            // An unreadable receipt that names the confirmed Desktop came from it.
            Case("200 own serverId", GatewayHttpResponse(200, """{"ok":true,"meta":${meta()},"data":{}}"""),
                desktopReached = true),
        )
        cases.forEach { case ->
            tearDown()
            setUp()
            seedTask("task-a", version = 3, title = "A")
            seedTask("task-b", version = 5, title = "B")
            val renameA = outbox.enqueueUpdateTitle("task-a", "A2")
            tick()
            val completeB = requireNotNull(outbox.enqueueComplete("task-b").commandId)
            val store = MobileGatewayConnectionStore(context)
            store.clearToken()
            store.save("https://gateway.test", "c".repeat(43))
            val sentCommands = mutableListOf<String>()
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
                            path.startsWith("/v1/bootstrap") -> GatewayHttpResponse(
                                200,
                                page("tasks", listOf(taskJson("task-a", 3, "A"), taskJson("task-b", 5, "B"))),
                            )
                            path == "/v1/commands" -> {
                                val commandId = Json.parseToJsonElement(requireNotNull(body)).jsonObject
                                    .getValue("commandId").jsonPrimitive.content
                                sentCommands += commandId
                                if (commandId == renameA) case.answer
                                else GatewayHttpResponse(200, receipt(commandId, taskJson("task-b", 6, "B", "done")))
                            }
                            else -> GatewayHttpResponse(404, "")
                        }
                    },
                )

                assertFalse(case.name, repository.synchronizeIfPaired())

                val readAfterCommands = requestedPaths.drop(requestedPaths.lastIndexOf("/v1/commands") + 1)
                    .any { it == "/v1/bootstrap" || it == "/v1/sync" }
                assertEquals(case.name, OutboxState.RetryWait, dao.outbox(renameA)?.state)
                assertEquals(case.name, 1, dao.outbox(renameA)?.attemptCount)
                if (case.desktopReached) {
                    assertEquals(case.name, listOf(renameA, completeB), sentCommands)
                    assertTrue(case.name, readAfterCommands)
                    assertEquals(case.name, MobileSyncOutcome.CommandsWaiting, repository.lastSyncOutcome)
                } else {
                    assertEquals(case.name, listOf(renameA), sentCommands)
                    assertFalse(case.name, readAfterCommands)
                    assertEquals(case.name, OutboxState.Pending, dao.outbox(completeB)?.state)
                    assertEquals(case.name, MobileSyncOutcome.RetrySoon, repository.lastSyncOutcome)
                }
            } finally {
                store.clearToken()
            }
        }
    }

    private fun tick() {
        clock = clock.plusSeconds(1)
    }

    private suspend fun seedTask(id: String, version: Int, title: String) {
        dao.upsertTask(
            TaskCacheEntity(
                id = id,
                serverVersion = version,
                title = title,
                themeId = null,
                state = "todo",
                workState = null,
                todayDate = "2026-08-22",
                updatedAt = "2026-08-22T01:00:00Z",
                optimisticCommandId = null,
            ),
        )
    }

    private fun taskJson(id: String, version: Int, title: String, state: String = "todo"): String =
        """{"id":"$id","version":$version,"title":"$title","themeId":null,"state":"$state","workState":null,""" +
            """"todayDate":"2026-08-22","schedule":null,"updatedAt":"2026-08-22T02:00:00Z"}"""

    private fun meta(): String =
        """{"apiVersion":1,"schemaVersion":$TASKEN_MOBILE_SCHEMA_VERSION,"serverId":"server-1",""" +
            """"serverRevision":8,"generatedAt":"2026-08-22T02:00:00Z","truncated":false}"""

    private fun receipt(commandId: String, task: String): String =
        """{"ok":true,"meta":${meta()},"data":{"commandId":"$commandId","status":"applied","task":$task}}"""

    private fun page(field: String, items: List<String>): String =
        """{"ok":true,"meta":${meta()},"data":{"$field":[${items.joinToString(",")}],""" +
            """"nextCursor":"task-cursor","hasMore":false}}"""
}
