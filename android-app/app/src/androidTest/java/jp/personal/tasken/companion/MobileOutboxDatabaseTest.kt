package jp.personal.tasken.companion

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.time.Instant
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.first
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MobileOutboxDatabaseTest {
    private lateinit var context: Context
    private lateinit var database: MobileLocalDatabase
    private lateinit var dao: MobileLocalDao
    private lateinit var outbox: MobileOutbox

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        database = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        dao = database.mobileDao()
        outbox = MobileOutbox(
            context = context,
            dao = dao,
            deviceId = { "android-test-device" },
            now = { Instant.parse("2026-08-22T01:02:03Z") },
            schedule = {},
        )
    }

    @After
    fun tearDown() {
        database.close()
    }

    @Test
    fun offlineCreatePersistsOptimisticTaskAndImmutableEnvelopeTogether() = runBlocking {
        val taskId = outbox.enqueueCreate("  外出先で記録  ", LocalDate.parse("2026-08-22"))
        val task = requireNotNull(dao.task(taskId))
        val command = requireNotNull(dao.outbox(requireNotNull(task.optimisticCommandId)))
        val envelope = MobileTaskCommandContract.decodeCreateEnvelope(command.envelopeJson)

        assertEquals("外出先で記録", task.title)
        assertEquals("2026-08-22", task.todayDate)
        assertEquals(command.commandId, command.idempotencyKey)
        assertEquals(command.commandId, envelope.commandId)
        assertEquals(command.requestId, envelope.requestId)
        assertEquals(command.issuedAt, envelope.issuedAt)
        assertEquals(taskId, envelope.command.task.id)
        assertEquals(OutboxState.Pending, command.state)
    }

    @Test
    fun interruptedSendingReturnsToRetryWithoutChangingEnvelope() = runBlocking {
        val taskId = outbox.enqueueCreate("再送する", LocalDate.parse("2026-08-22"))
        val commandId = requireNotNull(dao.task(taskId)?.optimisticCommandId)
        val before = requireNotNull(dao.outbox(commandId))
        requireNotNull(dao.claimNext("2026-08-22T01:03:00Z"))

        assertEquals(1, outbox.recoverInterruptedSending())
        val recovered = requireNotNull(dao.outbox(commandId))
        assertEquals(OutboxState.RetryWait, recovered.state)
        assertEquals(before.envelopeJson, recovered.envelopeJson)
        assertEquals(1, recovered.attemptCount)
    }

    @Test
    fun receiptConvergesCanonicalTaskThenDeletesOutboxAndDuplicateIsSafe() = runBlocking {
        val taskId = outbox.enqueueCreate("正規化前", LocalDate.parse("2026-08-22"))
        val commandId = requireNotNull(dao.task(taskId)?.optimisticCommandId)
        val response = receipt(commandId, taskId)

        assertTrue(outbox.drain { MobileCommandSendResult.Applied(response) }.not())
        assertEquals("Desktop正規化後", dao.task(taskId)?.title)
        assertNull(dao.task(taskId)?.optimisticCommandId)
        assertEquals(0, dao.outboxCount())

        dao.applyCommandReceipt(
            commandId,
            canonicalTask(response),
            syncState(response),
        )
        assertEquals(1, dao.tasks().count { it.id == taskId })
        assertEquals(0, dao.outboxCount())
    }

    @Test
    fun completeAndReopenUseCachedVersionAndConvergeReceipts() = runBlocking {
        val taskId = "10000000-0000-4000-8000-000000000010"
        dao.upsertTask(
            TaskCacheEntity(
                id = taskId,
                serverVersion = 7,
                title = "状態を変える",
                themeId = null,
                state = "todo",
                workState = null,
                todayDate = "2026-08-22",
                updatedAt = "2026-08-22T01:00:00Z",
                optimisticCommandId = null,
            ),
        )

        val completeId = outbox.enqueueComplete(taskId)
        val completeEnvelope = MobileTaskCommandContract.decodeStateEnvelope(
            requireNotNull(dao.outbox(completeId)).envelopeJson,
        )
        assertEquals("CompleteTask", completeEnvelope.command.name)
        assertEquals(7, completeEnvelope.command.expectedVersion)
        assertEquals("done", dao.task(taskId)?.state)
        assertTrue(outbox.drain { MobileCommandSendResult.Applied(receipt(completeId, taskId, "done", 8)) }.not())
        assertEquals(8, dao.task(taskId)?.serverVersion)
        assertNull(dao.task(taskId)?.optimisticCommandId)

        val reopenId = outbox.enqueueReopen(taskId)
        val reopenEnvelope = MobileTaskCommandContract.decodeStateEnvelope(
            requireNotNull(dao.outbox(reopenId)).envelopeJson,
        )
        assertEquals("ReopenTask", reopenEnvelope.command.name)
        assertEquals(8, reopenEnvelope.command.expectedVersion)
        assertEquals("todo", dao.task(taskId)?.state)
    }

    @Test
    fun versionConflictKeepsServerStateAndLocalIntentUntilExplicitResolution() = runBlocking {
        val taskId = "10000000-0000-4000-8000-000000000020"
        dao.upsertTask(canonicalCachedTask(taskId, version = 7, state = "todo"))

        val staleCommandId = outbox.enqueueComplete(taskId)
        assertTrue(outbox.drain {
            MobileCommandSendResult.Conflict(conflict(taskId, serverVersion = 8, serverState = "todo"))
        }.not())

        val conflictedTask = requireNotNull(dao.task(taskId))
        assertEquals("todo", conflictedTask.state)
        assertEquals(8, conflictedTask.serverVersion)
        assertEquals(staleCommandId, conflictedTask.conflictCommandId)
        assertEquals(OutboxState.Conflict, dao.outbox(staleCommandId)?.state)
        assertEquals(1, dao.observeConflictCount().first())

        val replacementId = outbox.keepLocal(staleCommandId)
        val replacement = requireNotNull(dao.outbox(replacementId))
        val replacementEnvelope = MobileTaskCommandContract.decodeStateEnvelope(replacement.envelopeJson)
        assertNull(dao.outbox(staleCommandId))
        assertNull(dao.conflict(staleCommandId))
        assertEquals(8, replacementEnvelope.command.expectedVersion)
        assertEquals("CompleteTask", replacementEnvelope.command.name)
        assertEquals("done", dao.task(taskId)?.state)

        assertTrue(outbox.drain {
            MobileCommandSendResult.Applied(receipt(replacementId, taskId, "done", 9))
        }.not())
        assertEquals(9, dao.task(taskId)?.serverVersion)
        assertNull(dao.task(taskId)?.conflictCommandId)
    }

    @Test
    fun acceptingServerDeletesConflictAndOriginalCommand() = runBlocking {
        val taskId = "10000000-0000-4000-8000-000000000021"
        dao.upsertTask(canonicalCachedTask(taskId, version = 3, state = "todo"))
        val commandId = outbox.enqueueComplete(taskId)
        outbox.drain {
            MobileCommandSendResult.Conflict(conflict(taskId, serverVersion = 4, serverState = "todo"))
        }

        outbox.acceptServer(commandId)

        assertNull(dao.outbox(commandId))
        assertNull(dao.conflict(commandId))
        assertNull(dao.task(taskId)?.conflictCommandId)
        assertEquals("todo", dao.task(taskId)?.state)
    }

    private fun receipt(
        commandId: String,
        taskId: String,
        state: String = "todo",
        version: Int = 1,
    ) = MobileTaskCommandResponseDto(
        ok = true,
        meta = MobileResponseMetaDto(
            apiVersion = 1,
            schemaVersion = 1,
            serverId = "server-1",
            serverRevision = 10,
            generatedAt = "2026-08-22T01:04:00Z",
            truncated = false,
        ),
        data = MobileTaskCommandReceiptDto(
            commandId = commandId,
            status = "applied",
            task = MobileTaskSummaryDto(
                id = taskId,
                version = version,
                title = "Desktop正規化後",
                themeId = null,
                state = state,
                workState = null,
                updatedAt = "2026-08-22T01:04:00Z",
            ),
        ),
    )

    private fun conflict(
        taskId: String,
        serverVersion: Int,
        serverState: String,
    ) = MobileTaskCommandErrorResponseDto(
        ok = false,
        meta = MobileResponseMetaDto(
            apiVersion = 1,
            schemaVersion = 1,
            serverId = "server-1",
            serverRevision = 11,
            generatedAt = "2026-08-22T01:05:00Z",
            truncated = false,
        ),
        error = MobileTaskCommandErrorDto(
            code = "version_conflict",
            message = "Taskが更新されています。",
            retryable = false,
            conflict = MobileVersionConflictDto(
                currentTask = MobileTaskSummaryDto(
                    id = taskId,
                    version = serverVersion,
                    title = "Desktop側Task",
                    themeId = null,
                    state = serverState,
                    workState = null,
                    updatedAt = "2026-08-22T01:05:00Z",
                ),
                intendedAction = "CompleteTask",
                expectedVersion = serverVersion - 1,
            ),
        ),
    )

    private fun canonicalCachedTask(taskId: String, version: Int, state: String) = TaskCacheEntity(
        id = taskId,
        serverVersion = version,
        title = "状態を変える",
        themeId = null,
        state = state,
        workState = null,
        todayDate = "2026-08-22",
        updatedAt = "2026-08-22T01:00:00Z",
        optimisticCommandId = null,
    )

    private fun canonicalTask(response: MobileTaskCommandResponseDto): TaskCacheEntity =
        TaskCacheEntity(
            id = response.data.task.id,
            serverVersion = response.data.task.version,
            title = response.data.task.title,
            themeId = response.data.task.themeId,
            state = response.data.task.state,
            workState = response.data.task.workState,
            todayDate = "2026-08-22",
            updatedAt = response.data.task.updatedAt,
            optimisticCommandId = null,
        )

    private fun syncState(response: MobileTaskCommandResponseDto): SyncStateEntity =
        SyncStateEntity(
            serverId = response.meta.serverId,
            apiVersion = response.meta.apiVersion,
            schemaVersion = response.meta.schemaVersion,
            cursor = null,
            lastSuccessfulSyncAt = response.meta.generatedAt,
            lastAttemptAt = response.meta.generatedAt,
            lastError = null,
        )
}
