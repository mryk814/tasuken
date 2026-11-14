package jp.personal.tasken.companion

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.time.Instant
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** #761: which command goes next when some of them keep failing, and what a failure leaves behind. */
@RunWith(AndroidJUnit4::class)
class MobileOutboxRetryTest {
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
    fun laterEditOfSameTaskWaitsBehindItsFailingCommand() = runBlocking {
        seedTask("task-a", version = 3, title = "元の名前")
        seedTask("task-b", version = 5, title = "別のTask")
        val renameA = outbox.enqueueUpdateTitle("task-a", "一回目")
        tick()
        val completeA = requireNotNull(outbox.enqueueComplete("task-a").commandId)
        tick()
        val renameB = outbox.enqueueUpdateTitle("task-b", "別のTaskの新しい名前")
        val sent = mutableListOf<String>()

        val result = outbox.send("server-1") { envelope ->
            val commandId = commandIdOf(envelope)
            sent += commandId
            if (commandId == renameA) {
                MobileCommandSendResult.Retry("HTTP 503", serverReached = true)
            } else {
                MobileCommandSendResult.Applied(taskReceipt(commandId, "task-b", 6))
            }
        }

        assertEquals(listOf(renameA, renameB), sent)
        assertEquals(MobileOutboxDrainResult(retryPending = true, connectionFailed = false), result)
        assertEquals(OutboxState.Pending, dao.outbox(completeA)?.state)
        assertEquals(renameA, dao.outbox(completeA)?.dependsOnCommandId)
        assertEquals(0, dao.outbox(completeA)?.attemptCount)
        assertEquals("done", dao.task("task-a")?.state)
        assertNull(dao.outbox(renameB))
    }

    @Test
    fun unreachableDesktopStopsTheRoundAndNextRoundStartsWithAnotherCommand() = runBlocking {
        seedTask("task-a", version = 3, title = "A")
        seedTask("task-b", version = 5, title = "B")
        val renameA = outbox.enqueueUpdateTitle("task-a", "A2")
        tick()
        val renameB = outbox.enqueueUpdateTitle("task-b", "B2")
        val sent = mutableListOf<String>()

        val offline = outbox.send("server-1") { envelope ->
            sent += commandIdOf(envelope)
            MobileCommandSendResult.Retry("Desktopへ接続できませんでした。")
        }

        assertEquals(listOf(renameA), sent)
        assertEquals(MobileOutboxDrainResult(retryPending = true, connectionFailed = true), offline)
        assertEquals(OutboxState.Pending, dao.outbox(renameB)?.state)

        sent.clear()
        tick()
        val online = outbox.send("server-1") { envelope ->
            val commandId = commandIdOf(envelope)
            sent += commandId
            MobileCommandSendResult.Applied(
                if (commandId == renameA) taskReceipt(commandId, "task-a", 4) else taskReceipt(commandId, "task-b", 6),
            )
        }

        // The command that failed last time goes after the one that was never tried.
        assertEquals(listOf(renameB, renameA), sent)
        assertEquals(MobileOutboxDrainResult(retryPending = false, connectionFailed = false), online)
        assertEquals(0, dao.outboxCount())
    }

    @Test
    fun failuresInRowEndTheRoundButKeepEveryCommandAndItsReason() = runBlocking {
        val ids = (1..4).map { index ->
            seedTask("task-$index", version = 1, title = "T$index")
            tick()
            outbox.enqueueUpdateTitle("task-$index", "T$index 変更")
        }
        val sent = mutableListOf<String>()

        val result = outbox.send("server-1") { envelope ->
            sent += commandIdOf(envelope)
            MobileCommandSendResult.Retry("HTTP 502", serverReached = true)
        }

        assertEquals(ids.take(MOBILE_OUTBOX_FAILURES_IN_ROW_LIMIT), sent)
        assertEquals(MobileOutboxDrainResult(retryPending = true, connectionFailed = false, triedAll = false), result)
        assertEquals(4, dao.outboxCount())
        ids.take(MOBILE_OUTBOX_FAILURES_IN_ROW_LIMIT).forEach {
            val command = requireNotNull(dao.outbox(it))
            assertEquals(OutboxState.RetryWait, command.state)
            assertEquals(1, command.attemptCount)
            assertEquals("HTTP 502", command.lastError)
        }
        assertEquals(OutboxState.Pending, dao.outbox(ids.last())?.state)
    }

    @Test
    fun retryingCommandsAreReadableWithCountAndLastReason() = runBlocking {
        seedTask("task-a", version = 3, title = "A")
        val renameA = outbox.enqueueUpdateTitle("task-a", "A2")
        repeat(2) { round ->
            tick()
            outbox.send("server-1") { MobileCommandSendResult.Retry("HTTP 503 #$round", serverReached = true) }
        }

        val retrying = dao.observeRetryingOutbox().first().single()

        assertEquals(renameA, retrying.commandId)
        assertEquals(2, retrying.attemptCount)
        assertEquals("HTTP 503 #1", retrying.lastError)
        assertEquals(clock.toString(), retrying.lastAttemptAt)
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

    private fun commandIdOf(envelope: String): String =
        Json.parseToJsonElement(envelope).jsonObject.getValue("commandId").jsonPrimitive.content

    private fun taskReceipt(commandId: String, taskId: String, version: Int) =
        MobileTaskCommandContract.decodeReceipt(receipt(commandId, taskJson(taskId, version, "Desktop正規化後")))

    private fun taskJson(id: String, version: Int, title: String, state: String = "todo"): String =
        """{"id":"$id","version":$version,"title":"$title","themeId":null,"state":"$state","workState":null,""" +
            """"todayDate":"2026-08-22","schedule":null,"updatedAt":"2026-08-22T02:00:00Z"}"""

    private fun meta(): String =
        """{"apiVersion":1,"schemaVersion":$TASKEN_MOBILE_SCHEMA_VERSION,"serverId":"server-1",""" +
            """"serverRevision":8,"generatedAt":"2026-08-22T02:00:00Z","truncated":false}"""

    private fun receipt(commandId: String, task: String): String =
        """{"ok":true,"meta":${meta()},"data":{"commandId":"$commandId","status":"applied","task":$task}}"""
}
