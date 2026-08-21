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

        val completeId = requireNotNull(outbox.enqueueComplete(taskId).commandId)
        val completeEnvelope = MobileTaskCommandContract.decodeStateEnvelope(
            requireNotNull(dao.outbox(completeId)).envelopeJson,
        )
        assertEquals("CompleteTask", completeEnvelope.command.name)
        assertEquals(7, completeEnvelope.command.expectedVersion)
        assertEquals("done", dao.task(taskId)?.state)
        assertTrue(outbox.drain { MobileCommandSendResult.Applied(receipt(completeId, taskId, "done", 8)) }.not())
        assertEquals(8, dao.task(taskId)?.serverVersion)
        assertNull(dao.task(taskId)?.optimisticCommandId)

        val reopenId = requireNotNull(outbox.enqueueReopen(taskId).commandId)
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

        val staleCommandId = requireNotNull(outbox.enqueueComplete(taskId).commandId)
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
        val commandId = requireNotNull(outbox.enqueueComplete(taskId).commandId)
        outbox.drain {
            MobileCommandSendResult.Conflict(conflict(taskId, serverVersion = 4, serverState = "todo"))
        }

        outbox.acceptServer(commandId)

        assertNull(dao.outbox(commandId))
        assertNull(dao.conflict(commandId))
        assertNull(dao.task(taskId)?.conflictCommandId)
        assertEquals("todo", dao.task(taskId)?.state)
    }

    @Test
    fun completeAfterOfflineCreateWaitsForReceiptThenUsesCanonicalVersion() = runBlocking {
        val taskId = outbox.enqueueCreate("作成後に完了", LocalDate.parse("2026-08-22"))
        val createId = requireNotNull(dao.task(taskId)?.optimisticCommandId)
        val complete = outbox.enqueueComplete(taskId)
        val completeId = requireNotNull(complete.commandId)
        assertEquals(createId, dao.outbox(completeId)?.dependsOnCommandId)
        assertEquals(2, dao.outboxCount())
        assertEquals("done", dao.task(taskId)?.state)

        val sentNames = mutableListOf<String>()
        assertTrue(outbox.drain { payload ->
            if (sentNames.isEmpty()) {
                val envelope = MobileTaskCommandContract.decodeCreateEnvelope(payload)
                sentNames += envelope.command.name
                MobileCommandSendResult.Applied(receipt(createId, taskId, "todo", 1))
            } else {
                val envelope = MobileTaskCommandContract.decodeStateEnvelope(payload)
                sentNames += envelope.command.name
                assertEquals(1, envelope.command.expectedVersion)
                MobileCommandSendResult.Applied(receipt(completeId, taskId, "done", 2))
            }
        }.not())

        assertEquals(listOf("CreateTask", "CompleteTask"), sentNames)
        assertEquals(0, dao.outboxCount())
        assertEquals(2, dao.task(taskId)?.serverVersion)
        assertEquals("done", dao.task(taskId)?.state)
        assertNull(dao.task(taskId)?.optimisticCommandId)
    }

    @Test
    fun completeThenReopenBeforeSendCancelsCommandAtCanonicalState() = runBlocking {
        val taskId = "10000000-0000-4000-8000-000000000030"
        dao.upsertTask(canonicalCachedTask(taskId, version = 7, state = "todo"))
        outbox.enqueueComplete(taskId)

        val reopened = outbox.enqueueReopen(taskId)

        assertEquals(false, reopened.requiresSync)
        assertNull(reopened.commandId)
        assertEquals(0, dao.outboxCount())
        assertEquals("todo", dao.task(taskId)?.state)
        assertNull(dao.task(taskId)?.optimisticCommandId)
    }

    @Test
    fun createCompleteThenReopenKeepsOnlyOriginalCreate() = runBlocking {
        val taskId = outbox.enqueueCreate("作成だけ残す", LocalDate.parse("2026-08-22"))
        val createId = requireNotNull(dao.task(taskId)?.optimisticCommandId)
        outbox.enqueueComplete(taskId)

        val reopened = outbox.enqueueReopen(taskId)

        assertEquals(true, reopened.requiresSync)
        assertEquals(createId, reopened.commandId)
        assertEquals(1, dao.outboxCount())
        assertEquals("CreateTask", dao.outbox(createId)?.commandName)
        assertEquals("todo", dao.task(taskId)?.state)
        assertEquals(createId, dao.task(taskId)?.optimisticCommandId)
    }

    @Test
    fun bootstrapAndPagedSyncAdvanceCursorAtomicallyWithoutOverwritingPendingIntent() = runBlocking {
        val pendingTaskId = outbox.enqueueCreate("端末の未送信Task", LocalDate.parse("2026-08-22"))
        dao.upsertTask(canonicalCachedTask("stale-canonical", 1, "todo"))

        dao.applyBootstrap(
            tasks = listOf(
                canonicalCachedTask(pendingTaskId, 4, "done").copy(title = "Desktop側の同一Task"),
                canonicalCachedTask("bootstrap-task", 2, "todo").copy(title = "Bootstrap Task"),
            ),
            syncState = SyncStateEntity(
                serverId = "server-restored",
                apiVersion = 1,
                schemaVersion = 1,
                cursor = "2026-08-22T02:00:00Z|bootstrap-task",
                lastSuccessfulSyncAt = "2026-08-22T02:00:00Z",
                lastAttemptAt = "2026-08-22T02:00:00Z",
                lastError = null,
            ),
        )

        assertNull(dao.task("stale-canonical"))
        assertEquals("端末の未送信Task", dao.task(pendingTaskId)?.title)
        assertEquals("Bootstrap Task", dao.task("bootstrap-task")?.title)
        assertEquals("server-restored", dao.syncState()?.serverId)

        dao.applySyncPage(
            upserts = listOf(
                canonicalCachedTask("bootstrap-task", 3, "doing").copy(
                    title = "Delta Task",
                    updatedAt = "2026-08-22T03:00:00Z",
                ),
            ),
            tombstoneIds = listOf(pendingTaskId),
            syncState = requireNotNull(dao.syncState()).copy(
                cursor = "2026-08-22T03:00:00Z|bootstrap-task",
                lastSuccessfulSyncAt = "2026-08-22T03:00:00Z",
            ),
        )

        assertEquals("端末の未送信Task", dao.task(pendingTaskId)?.title)
        assertEquals("Delta Task", dao.task("bootstrap-task")?.title)
        assertEquals("doing", dao.task("bootstrap-task")?.state)
        assertEquals("2026-08-22T03:00:00Z|bootstrap-task", dao.syncState()?.cursor)
    }

    @Test
    fun titleUpdatePersistsBaseAndKeepsLocalTitleAcrossExplicitConflictResolution() = runBlocking {
        val taskId = "10000000-0000-4000-8000-000000000040"
        dao.upsertTask(canonicalCachedTask(taskId, version = 4, state = "todo").copy(title = "元の名前"))

        val commandId = outbox.enqueueUpdateTitle(taskId, "端末の名前")
        val envelope = MobileTaskCommandContract.decodeUpdateEnvelope(requireNotNull(dao.outbox(commandId)).envelopeJson)
        assertEquals("元の名前", envelope.command.base.title)
        assertEquals("端末の名前", envelope.command.changes.title)
        assertEquals("端末の名前", dao.task(taskId)?.title)

        assertEquals(false, outbox.drain {
            MobileCommandSendResult.Conflict(
                conflict(taskId, serverVersion = 5, serverState = "todo", intendedAction = "UpdateTask", serverTitle = "Desktopの名前"),
            )
        })
        val storedConflict = requireNotNull(dao.conflict(commandId))
        assertEquals("端末の名前", storedConflict.localTitle)
        assertEquals("Desktopの名前", dao.task(taskId)?.title)

        val replacementId = outbox.keepLocal(commandId)
        val replacement = MobileTaskCommandContract.decodeUpdateEnvelope(requireNotNull(dao.outbox(replacementId)).envelopeJson)
        assertEquals(5, replacement.command.expectedVersion)
        assertEquals("Desktopの名前", replacement.command.base.title)
        assertEquals("端末の名前", replacement.command.changes.title)
        assertEquals("端末の名前", dao.task(taskId)?.title)
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
        intendedAction: String = "CompleteTask",
        serverTitle: String = "Desktop側Task",
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
                    title = serverTitle,
                    themeId = null,
                    state = serverState,
                    workState = null,
                    updatedAt = "2026-08-22T01:05:00Z",
                ),
                intendedAction = intendedAction,
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
