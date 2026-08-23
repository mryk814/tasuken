package jp.personal.tasken.companion

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
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
    fun setUp() = runBlocking {
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
        dao.upsertSyncState(activeSyncState())
    }

    @After
    fun tearDown() {
        database.close()
    }

    @Test
    fun offlineCreatePersistsOptimisticTaskAndImmutableEnvelopeTogether() = runBlocking {
        val taskId = outbox.enqueueCreate(
            "  外出先で記録  ",
            LocalDate.parse("2026-08-22"),
            projectId = "theme-research",
        )
        val task = requireNotNull(dao.task(taskId))
        val command = requireNotNull(dao.outbox(requireNotNull(task.optimisticCommandId)))
        val envelope = MobileTaskCommandContract.decodeCreateEnvelope(command.envelopeJson)

        assertEquals("外出先で記録", task.title)
        assertEquals("theme-research", task.themeId)
        assertEquals("2026-08-22", task.todayDate)
        assertEquals(command.commandId, command.idempotencyKey)
        assertEquals(command.commandId, envelope.commandId)
        assertEquals(command.requestId, envelope.requestId)
        assertEquals(command.issuedAt, envelope.issuedAt)
        assertEquals(taskId, envelope.command.task.id)
        assertEquals("theme-research", envelope.command.task.projectId)
        assertEquals(OutboxState.Pending, command.state)
    }

    @Test
    fun repeatedSubmitOfSameDraftReusesStableTaskAndCommand() = runBlocking {
        val first = outbox.enqueueCreate(
            title = "二重送信しない",
            todayDate = LocalDate.parse("2026-08-22"),
            projectId = "theme-research",
            draftId = "draft-stable-submit",
            createdAt = "2026-08-22T01:02:03Z",
        )
        val second = outbox.enqueueCreate(
            title = "二重送信しない",
            todayDate = LocalDate.parse("2026-08-22"),
            projectId = "theme-research",
            draftId = "draft-stable-submit",
            createdAt = "2026-08-22T01:02:03Z",
        )

        assertEquals(first, second)
        assertEquals(1, dao.tasks().count { it.id == first })
        assertEquals(1, dao.outboxCount())
    }

    @Test
    fun undoBeforeFirstSendCancelsCreateAndOptimisticTaskAtomically() = runBlocking {
        val taskId = outbox.enqueueCreate("送信前に戻す", LocalDate.parse("2026-08-22"))

        val result = outbox.undoCreate(taskId)

        assertEquals(false, result.requiresSync)
        assertNull(result.commandId)
        assertNull(dao.task(taskId))
        assertEquals(0, dao.outboxCount())
    }

    @Test
    fun undoAfterCreateAttemptQueuesDependentDeleteAndConverges() = runBlocking {
        val taskId = outbox.enqueueCreate("送信開始後に戻す", LocalDate.parse("2026-08-22"))
        val createId = requireNotNull(dao.task(taskId)?.optimisticCommandId)
        requireNotNull(dao.claimNext("server-1", "2026-08-22T01:03:00Z"))

        val undo = outbox.undoCreate(taskId)
        val deleteId = requireNotNull(undo.commandId)
        assertEquals(true, undo.requiresSync)
        assertEquals(createId, dao.outbox(deleteId)?.dependsOnCommandId)
        assertEquals(deleteId, dao.task(taskId)?.optimisticCommandId)

        assertEquals(1, outbox.recoverInterruptedSending())
        val sent = mutableListOf<String>()
        assertEquals(false, outbox.drain("server-1") { payload ->
            if (sent.isEmpty()) {
                val envelope = MobileTaskCommandContract.decodeCreateEnvelope(payload)
                sent += envelope.command.name
                MobileCommandSendResult.Applied(receipt(createId, taskId, version = 1))
            } else {
                val envelope = MobileTaskCommandContract.decodeStateEnvelope(payload)
                sent += envelope.command.name
                assertEquals("DeleteTask", envelope.command.name)
                assertEquals(1, envelope.command.expectedVersion)
                MobileCommandSendResult.Applied(receipt(deleteId, taskId, version = 2))
            }
        })

        assertEquals(listOf("CreateTask", "DeleteTask"), sent)
        assertNull(dao.task(taskId))
        assertEquals(0, dao.outboxCount())
    }

    @Test
    fun canonicalUndoUsesDeleteVersionConflictFlowWithoutSilentOverwrite() = runBlocking {
        val taskId = "10000000-0000-4000-8000-000000000006"
        dao.upsertTask(canonicalCachedTask(taskId, version = 7, state = "todo"))

        val deleteId = requireNotNull(outbox.undoCreate(taskId).commandId)
        val envelope = MobileTaskCommandContract.decodeStateEnvelope(requireNotNull(dao.outbox(deleteId)).envelopeJson)
        assertEquals("DeleteTask", envelope.command.name)
        assertEquals(7, envelope.command.expectedVersion)

        assertEquals(false, outbox.drain("server-1") {
            MobileCommandSendResult.Conflict(
                conflict(
                    taskId = taskId,
                    serverVersion = 8,
                    serverState = "todo",
                    intendedAction = "DeleteTask",
                ),
            )
        })
        assertEquals(deleteId, dao.task(taskId)?.conflictCommandId)
        assertEquals(OutboxState.Conflict, dao.outbox(deleteId)?.state)

        val replacementId = outbox.keepLocal(deleteId)
        val replacement = MobileTaskCommandContract.decodeStateEnvelope(
            requireNotNull(dao.outbox(replacementId)).envelopeJson,
        )
        assertEquals("DeleteTask", replacement.command.name)
        assertEquals(8, replacement.command.expectedVersion)

        assertEquals(false, outbox.drain("server-1") {
            MobileCommandSendResult.Applied(receipt(replacementId, taskId, version = 9))
        })
        assertNull(dao.task(taskId))
        assertEquals(0, dao.outboxCount())
    }

    @Test
    fun interruptedSendingReturnsToRetryWithoutChangingEnvelope() = runBlocking {
        val taskId = outbox.enqueueCreate("再送する", LocalDate.parse("2026-08-22"))
        val commandId = requireNotNull(dao.task(taskId)?.optimisticCommandId)
        val before = requireNotNull(dao.outbox(commandId))
        requireNotNull(dao.claimNext("server-1", "2026-08-22T01:03:00Z"))

        assertEquals(1, outbox.recoverInterruptedSending())
        val recovered = requireNotNull(dao.outbox(commandId))
        assertEquals(OutboxState.RetryWait, recovered.state)
        assertEquals(before.envelopeJson, recovered.envelopeJson)
        assertEquals(1, recovered.attemptCount)
    }

    @Test
    fun claimOnlyReturnsCommandsOwnedByTheConfirmedServer() = runBlocking {
        val taskId = outbox.enqueueCreate("server帰属", LocalDate.parse("2026-08-22"))
        val commandId = requireNotNull(dao.task(taskId)?.optimisticCommandId)

        assertNull(dao.claimNext("server-2", "2026-08-22T01:03:00Z"))
        assertEquals(OutboxState.Pending, dao.outbox(commandId)?.state)
        assertEquals("server-1", dao.claimNext("server-1", "2026-08-22T01:03:01Z")?.serverId)
    }

    @Test
    fun receiptFromAnotherServerCannotMutateTaskOrSyncState() = runBlocking {
        val taskId = outbox.enqueueCreate("別server receipt拒否", LocalDate.parse("2026-08-22"))
        val commandId = requireNotNull(dao.task(taskId)?.optimisticCommandId)
        val wrongServerReceipt = receipt(commandId, taskId).copy(
            meta = receipt(commandId, taskId).meta.copy(serverId = "server-2"),
        )

        assertTrue(outbox.drain("server-1") { MobileCommandSendResult.Applied(wrongServerReceipt) })

        assertEquals(OutboxState.RetryWait, dao.outbox(commandId)?.state)
        assertEquals(commandId, dao.task(taskId)?.optimisticCommandId)
        assertEquals("server-1", dao.syncState()?.serverId)
    }

    @Test
    fun receiptConvergesCanonicalTaskThenDeletesOutboxAndDuplicateIsSafe() = runBlocking {
        val taskId = outbox.enqueueCreate("正規化前", LocalDate.parse("2026-08-22"))
        val commandId = requireNotNull(dao.task(taskId)?.optimisticCommandId)
        val response = receipt(commandId, taskId)

        assertTrue(outbox.drain("server-1") { MobileCommandSendResult.Applied(response) }.not())
        assertEquals("Desktop正規化後", dao.task(taskId)?.title)
        assertNull(dao.task(taskId)?.optimisticCommandId)
        assertEquals(0, dao.outboxCount())

        assertEquals(
            false,
            dao.applyCommandReceipt(
                commandId = commandId,
                expectedServerId = "server-1",
                expectedTaskId = taskId,
                expectedAttemptCount = 1,
                canonicalTask = canonicalTask(response),
                syncState = syncState(response),
            ),
        )
        assertEquals(1, dao.tasks().count { it.id == taskId })
        assertEquals(0, dao.outboxCount())
    }

    @Test
    fun lateReceiptCannotStealNewSendingAttemptOrRegressAcceptedState() = runBlocking {
        val taskId = "10000000-0000-4000-8000-000000000009"
        dao.upsertTask(canonicalCachedTask(taskId, version = 7, state = "todo"))
        val commandId = requireNotNull(outbox.enqueueComplete(taskId).commandId)
        val firstAttempt = requireNotNull(dao.claimNext("server-1", "2026-08-22T01:03:00Z"))
        val ownershipProbe = receipt(commandId, taskId, state = "done", version = 8)

        assertEquals(
            false,
            dao.applyCommandReceipt(
                commandId = commandId,
                expectedServerId = "server-2",
                expectedTaskId = taskId,
                expectedAttemptCount = firstAttempt.attemptCount,
                canonicalTask = canonicalTask(ownershipProbe),
                syncState = syncState(ownershipProbe).copy(serverId = "server-2"),
            ),
        )
        val differentTaskId = "10000000-0000-4000-8000-000000000008"
        assertEquals(
            false,
            dao.applyCommandReceipt(
                commandId = commandId,
                expectedServerId = "server-1",
                expectedTaskId = differentTaskId,
                expectedAttemptCount = firstAttempt.attemptCount,
                canonicalTask = canonicalTask(ownershipProbe).copy(id = differentTaskId),
                syncState = syncState(ownershipProbe),
            ),
        )
        assertEquals(firstAttempt, dao.outbox(commandId))
        assertNull(dao.task(differentTaskId))
        assertEquals("server-1", dao.syncState()?.serverId)

        assertEquals(1, outbox.recoverInterruptedSending())
        val secondAttempt = requireNotNull(dao.claimNext("server-1", "2026-08-22T01:03:30Z"))
        assertEquals(firstAttempt.attemptCount + 1, secondAttempt.attemptCount)

        val staleResponse = ownershipProbe
        assertEquals(
            false,
            dao.applyCommandReceipt(
                commandId = commandId,
                expectedServerId = "server-1",
                expectedTaskId = taskId,
                expectedAttemptCount = firstAttempt.attemptCount,
                canonicalTask = canonicalTask(staleResponse).copy(title = "遅れて届いたreceipt"),
                syncState = syncState(staleResponse).copy(
                    lastSuccessfulSyncAt = "2026-08-22T01:03:10Z",
                    lastAttemptAt = "2026-08-22T01:03:10Z",
                ),
            ),
        )
        assertEquals(secondAttempt, dao.outbox(commandId))
        assertEquals(7, dao.task(taskId)?.serverVersion)
        assertEquals("状態を変える", dao.task(taskId)?.title)
        assertEquals("2026-08-22T01:00:00Z", dao.syncState()?.lastSuccessfulSyncAt)

        dao.upsertTask(
            requireNotNull(dao.task(taskId)).copy(
                serverVersion = 9,
                title = "同期で先に進んだTask",
            ),
        )
        assertEquals(
            false,
            dao.applyCommandReceipt(
                commandId = commandId,
                expectedServerId = "server-1",
                expectedTaskId = taskId,
                expectedAttemptCount = secondAttempt.attemptCount,
                canonicalTask = canonicalTask(staleResponse).copy(title = "versionが古いreceipt"),
                syncState = syncState(staleResponse),
            ),
        )
        assertEquals(secondAttempt, dao.outbox(commandId))
        assertEquals(9, dao.task(taskId)?.serverVersion)
        assertEquals("同期で先に進んだTask", dao.task(taskId)?.title)

        val acceptedResponse = receipt(commandId, taskId, state = "done", version = 10)
        assertTrue(
            dao.applyCommandReceipt(
                commandId = commandId,
                expectedServerId = "server-1",
                expectedTaskId = taskId,
                expectedAttemptCount = secondAttempt.attemptCount,
                canonicalTask = canonicalTask(acceptedResponse).copy(title = "最新のreceipt"),
                syncState = syncState(acceptedResponse).copy(
                    lastSuccessfulSyncAt = "2026-08-22T01:03:40Z",
                    lastAttemptAt = "2026-08-22T01:03:40Z",
                ),
            ),
        )
        assertNull(dao.outbox(commandId))
        assertEquals(10, dao.task(taskId)?.serverVersion)
        assertEquals("最新のreceipt", dao.task(taskId)?.title)
        assertEquals("2026-08-22T01:03:40Z", dao.syncState()?.lastSuccessfulSyncAt)

        assertEquals(
            false,
            dao.applyCommandReceipt(
                commandId = commandId,
                expectedServerId = "server-1",
                expectedTaskId = taskId,
                expectedAttemptCount = firstAttempt.attemptCount,
                canonicalTask = canonicalTask(staleResponse).copy(title = "遅れて届いたreceipt"),
                syncState = syncState(staleResponse),
            ),
        )
        assertEquals(10, dao.task(taskId)?.serverVersion)
        assertEquals("最新のreceipt", dao.task(taskId)?.title)
        assertEquals("2026-08-22T01:03:40Z", dao.syncState()?.lastSuccessfulSyncAt)
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
        assertTrue(outbox.drain("server-1") { MobileCommandSendResult.Applied(receipt(completeId, taskId, "done", 8)) }.not())
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
        assertTrue(outbox.drain("server-1") {
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

        assertTrue(outbox.drain("server-1") {
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
        outbox.drain("server-1") {
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
        assertTrue(outbox.drain("server-1") { payload ->
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
                serverId = "server-1",
                apiVersion = 1,
                schemaVersion = 2,
                cursor = "2026-08-22T02:00:00Z|bootstrap-task",
                lastSuccessfulSyncAt = "2026-08-22T02:00:00Z",
                lastAttemptAt = "2026-08-22T02:00:00Z",
                lastError = null,
            ),
        )

        assertNull(dao.task("stale-canonical"))
        assertEquals("端末の未送信Task", dao.task(pendingTaskId)?.title)
        assertEquals("Bootstrap Task", dao.task("bootstrap-task")?.title)
        assertEquals("server-1", dao.syncState()?.serverId)

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
    fun themeCatalogReplacementRemovesStaleRowsAndKeepsEmptyCatalogProvenance() = runBlocking {
        storeThemeCatalog(
            dao,
            listOf(
                ThemeCacheEntity("theme-z", "Zeta"),
                ThemeCacheEntity("theme-a", "Alpha"),
            ),
            revision = 4,
        )
        assertEquals(listOf("theme-a", "theme-z"), dao.observeThemes().first().map { it.id })

        storeThemeCatalog(dao, listOf(ThemeCacheEntity("theme-new", "New")), revision = 5)
        assertEquals(listOf("theme-new"), dao.themes().map { it.id })

        storeThemeCatalog(dao, emptyList(), revision = 6)
        assertTrue(dao.themes().isEmpty())
        assertEquals("server-1", dao.themeCatalogState()?.serverId)
        assertEquals(6, dao.themeCatalogState()?.serverRevision)
        assertEquals(ThemeCatalogStatus.Available, dao.themeCatalogState()?.status)
    }

    @Test
    fun themeCatalogRejectsOlderAndSupersededRefreshesAndInvalidatesServerChange() = runBlocking {
        storeThemeCatalog(dao, listOf(ThemeCacheEntity("theme-10", "Revision 10")), revision = 10)
        dao.prepareThemeRefresh("server-1", "slow-refresh", "2026-08-22T02:01:00Z")
        dao.prepareThemeRefresh("server-1", "fast-refresh", "2026-08-22T02:02:00Z")

        assertTrue(
            dao.completeThemeRefresh(
                "server-1",
                12,
                "2026-08-22T02:02:00Z",
                "2026-08-22T02:02:01Z",
                "fast-refresh",
                listOf(ThemeCacheEntity("theme-12", "Revision 12")),
            ),
        )
        assertEquals(
            false,
            dao.completeThemeRefresh(
                "server-1",
                11,
                "2026-08-22T02:01:00Z",
                "2026-08-22T02:01:00Z",
                "slow-refresh",
                listOf(ThemeCacheEntity("theme-11", "Revision 11")),
            ),
        )
        assertEquals(listOf("theme-12"), dao.themes().map { it.id })
        assertEquals(12, dao.themeCatalogState()?.serverRevision)

        dao.prepareThemeRefresh("server-1", "older-revision", "2026-08-22T02:04:00Z")
        assertEquals(
            false,
            dao.completeThemeRefresh(
                "server-1",
                9,
                "2026-08-22T02:04:00Z",
                "2026-08-22T02:04:01Z",
                "older-revision",
                listOf(ThemeCacheEntity("theme-9", "Revision 9")),
            ),
        )
        assertEquals(ThemeCatalogStatus.Available, dao.themeCatalogState()?.status)
        assertEquals(listOf("theme-12"), dao.themes().map { it.id })

        dao.invalidateThemeCatalogForServer("server-2", "2026-08-22T02:05:00Z")
        assertTrue(dao.themes().isEmpty())
        assertEquals("server-2", dao.themeCatalogState()?.serverId)
        assertEquals(ThemeCatalogStatus.Loading, dao.themeCatalogState()?.status)
    }

    @Test
    fun latestStartedThemeRefreshExclusivelyOwnsCompletion() = runBlocking {
        storeThemeCatalog(dao, listOf(ThemeCacheEntity("theme-10", "Revision 10")), revision = 10)
        dao.prepareThemeRefresh("server-1", "first-refresh", "2026-08-22T02:01:00Z")
        dao.prepareThemeRefresh("server-1", "later-refresh", "2026-08-22T02:02:00Z")

        assertEquals(
            false,
            dao.completeThemeRefresh(
                "server-1",
                11,
                "2026-08-22T02:01:00Z",
                "2026-08-22T02:01:00Z",
                "first-refresh",
                listOf(ThemeCacheEntity("theme-11", "Revision 11")),
            ),
        )
        assertTrue(
            dao.failThemeRefresh(
                "server-1",
                "later-refresh",
                "2026-08-22T02:04:00Z",
                "later request failed",
                unsupported = false,
            ),
        )
        assertEquals(listOf("theme-10"), dao.themes().map { it.id })
        assertEquals(10, dao.themeCatalogState()?.serverRevision)
        assertEquals(ThemeCatalogStatus.Stale, dao.themeCatalogState()?.status)
        assertEquals("later request failed", dao.themeCatalogState()?.lastError)
        assertEquals("2026-08-22T02:04:00Z", dao.themeCatalogState()?.lastAttemptAt)
    }

    @Test
    fun titleUpdatePersistsBaseAndKeepsLocalTitleAcrossExplicitConflictResolution() = runBlocking {
        val taskId = "10000000-0000-4000-8000-000000000040"
        dao.upsertTask(canonicalCachedTask(taskId, version = 4, state = "todo").copy(title = "元の名前"))

        val commandId = outbox.enqueueUpdateTitle(taskId, "端末の名前")
        val envelope = MobileTaskCommandContract.decodeUpdateEnvelope(requireNotNull(dao.outbox(commandId)).envelopeJson)
        assertEquals("元の名前", envelope.command.base.getValue("title").jsonPrimitive.content)
        assertEquals("端末の名前", envelope.command.changes.getValue("title").jsonPrimitive.content)
        assertEquals("端末の名前", dao.task(taskId)?.title)

        assertEquals(false, outbox.drain("server-1") {
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
        assertEquals("Desktopの名前", replacement.command.base.getValue("title").jsonPrimitive.content)
        assertEquals("端末の名前", replacement.command.changes.getValue("title").jsonPrimitive.content)
        assertEquals("端末の名前", dao.task(taskId)?.title)
    }

    @Test
    fun todayDateUpdatePersistsNullablePatchAndSurvivesConflictResolution() = runBlocking {
        val taskId = "10000000-0000-4000-8000-000000000041"
        dao.upsertTask(canonicalCachedTask(taskId, version = 4, state = "todo").copy(todayDate = null))

        val commandId = outbox.enqueueUpdateTodayDate(taskId, LocalDate.parse("2026-08-22"))
        val envelope = MobileTaskCommandContract.decodeUpdateEnvelope(requireNotNull(dao.outbox(commandId)).envelopeJson)
        assertEquals(JsonNull, envelope.command.base.getValue("todayDate"))
        assertEquals("2026-08-22", envelope.command.changes.getValue("todayDate").jsonPrimitive.content)
        assertEquals("2026-08-22", dao.task(taskId)?.todayDate)

        assertEquals(false, outbox.drain("server-1") {
            MobileCommandSendResult.Conflict(
                conflict(
                    taskId,
                    serverVersion = 5,
                    serverState = "todo",
                    intendedAction = "UpdateTask",
                    serverTodayDate = "2026-08-23",
                ),
            )
        })
        val storedConflict = requireNotNull(dao.conflict(commandId))
        assertTrue(storedConflict.localTodayDateChanged)
        assertEquals("2026-08-22", storedConflict.localTodayDate)
        assertEquals("2026-08-23", storedConflict.serverTodayDate)
        assertEquals("2026-08-23", dao.task(taskId)?.todayDate)

        val replacementId = outbox.keepLocal(commandId)
        val replacement = MobileTaskCommandContract.decodeUpdateEnvelope(requireNotNull(dao.outbox(replacementId)).envelopeJson)
        assertEquals("2026-08-23", replacement.command.base.getValue("todayDate").jsonPrimitive.content)
        assertEquals("2026-08-22", replacement.command.changes.getValue("todayDate").jsonPrimitive.content)
        assertEquals("2026-08-22", dao.task(taskId)?.todayDate)
    }

    @Test
    fun scheduleUpdatePersistsStrictPatchThenConvergesCanonicalReceipt() = runBlocking {
        val taskId = "10000000-0000-4000-8000-000000000044"
        dao.upsertTask(canonicalCachedTask(taskId, version = 4, state = "todo"))
        val draft = MobileTaskScheduleDraft("2026-08-23", "2026-08-25", null)

        val commandId = outbox.enqueueUpdateSchedule(taskId, draft)
        val envelope = MobileTaskCommandContract.decodeUpdateEnvelope(requireNotNull(dao.outbox(commandId)).envelopeJson)
        assertNull(envelope.command.expectedScheduleVersion)
        assertEquals(JsonNull, envelope.command.base.getValue("schedule"))
        val patch = envelope.command.changes.getValue("schedule").jsonObject
        assertEquals(setOf("startDate", "endDate", "rangeSemantics"), patch.keys)
        assertEquals("2026-08-23", patch.getValue("startDate").jsonPrimitive.content)
        assertEquals("range", dao.task(taskId)?.scheduleDateKind)
        assertNull(dao.task(taskId)?.scheduleId)
        assertEquals(commandId, dao.task(taskId)?.optimisticCommandId)

        val canonicalSchedule = scheduleDto(
            id = "schedule-44",
            version = 1,
            startDate = "2026-08-23",
            endDate = "2026-08-25",
            rangeSemantics = null,
        )
        assertEquals(false, outbox.drain("server-1") {
            MobileCommandSendResult.Applied(
                receipt(commandId, taskId, version = 5, schedule = canonicalSchedule),
            )
        })
        assertNull(dao.outbox(commandId))
        assertNull(dao.task(taskId)?.optimisticCommandId)
        assertEquals("schedule-44", dao.task(taskId)?.scheduleId)
        assertEquals(1, dao.task(taskId)?.scheduleVersion)
        assertEquals("2026-08-25", dao.task(taskId)?.scheduleEndDate)
    }

    @Test
    fun scheduleConflictSupportsAcceptServerThenKeepLocalWithLatestScheduleVersion() = runBlocking {
        val taskId = "10000000-0000-4000-8000-000000000045"
        dao.upsertTask(
            canonicalCachedTask(taskId, version = 4, state = "todo").copy(
                scheduleId = "schedule-45",
                scheduleVersion = 2,
                scheduleStartDate = null,
                scheduleEndDate = "2026-08-24",
                scheduleDateKind = "deadline",
                scheduleConfidence = "fixed",
                scheduleGranularity = "day",
            ),
        )
        val localDraft = MobileTaskScheduleDraft("2026-08-23", "2026-08-25", "once_within_window")
        val firstCommandId = outbox.enqueueUpdateSchedule(taskId, localDraft)
        val firstEnvelope = MobileTaskCommandContract.decodeUpdateEnvelope(requireNotNull(dao.outbox(firstCommandId)).envelopeJson)
        assertEquals(2, firstEnvelope.command.expectedScheduleVersion)
        assertEquals("2026-08-24", firstEnvelope.command.base.getValue("schedule").jsonObject.getValue("endDate").jsonPrimitive.content)

        val serverSchedule = scheduleDto("schedule-45", 3, null, "2026-08-26", null)
        outbox.drain("server-1") {
            MobileCommandSendResult.Conflict(
                conflict(
                    taskId,
                    serverVersion = 5,
                    serverState = "todo",
                    intendedAction = "UpdateTask",
                    serverSchedule = serverSchedule,
                ),
            )
        }
        val firstConflict = requireNotNull(dao.conflict(firstCommandId))
        assertTrue(firstConflict.localScheduleChanged)
        assertEquals("2026-08-25", firstConflict.localScheduleEndDate)
        assertEquals(3, dao.task(taskId)?.scheduleVersion)
        assertEquals("2026-08-26", dao.task(taskId)?.scheduleEndDate)

        outbox.acceptServer(firstCommandId)
        assertNull(dao.conflict(firstCommandId))
        assertEquals("2026-08-26", dao.task(taskId)?.scheduleEndDate)

        val secondCommandId = outbox.enqueueUpdateSchedule(taskId, localDraft)
        val latestServerSchedule = scheduleDto("schedule-45", 4, null, "2026-08-27", null)
        outbox.drain("server-1") {
            MobileCommandSendResult.Conflict(
                conflict(
                    taskId,
                    serverVersion = 6,
                    serverState = "todo",
                    intendedAction = "UpdateTask",
                    serverSchedule = latestServerSchedule,
                ),
            )
        }
        val replacementId = outbox.keepLocal(secondCommandId)
        val replacement = MobileTaskCommandContract.decodeUpdateEnvelope(requireNotNull(dao.outbox(replacementId)).envelopeJson)
        assertEquals(6, replacement.command.expectedVersion)
        assertEquals(4, replacement.command.expectedScheduleVersion)
        assertEquals("2026-08-27", replacement.command.base.getValue("schedule").jsonObject.getValue("endDate").jsonPrimitive.content)
        assertEquals("2026-08-25", replacement.command.changes.getValue("schedule").jsonObject.getValue("endDate").jsonPrimitive.content)
        assertEquals("2026-08-25", dao.task(taskId)?.scheduleEndDate)
        assertEquals(replacementId, dao.task(taskId)?.optimisticCommandId)
    }

    @Test
    fun themeUpdateUsesCachedCandidateAndKeepsBothValuesAcrossConflictResolution() = runBlocking {
        val taskId = "10000000-0000-4000-8000-000000000042"
        storeThemeCatalog(
            dao,
            listOf(
                ThemeCacheEntity("theme-old", "旧Theme"),
                ThemeCacheEntity("theme-local", "端末Theme"),
            ),
        )
        dao.upsertTask(
            canonicalCachedTask(taskId, version = 4, state = "todo").copy(themeId = "theme-old"),
        )

        val commandId = outbox.enqueueUpdateTheme(taskId, "theme-local")
        val envelope = MobileTaskCommandContract.decodeUpdateEnvelope(
            requireNotNull(dao.outbox(commandId)).envelopeJson,
        )
        assertEquals("theme-old", envelope.command.base.getValue("themeId").jsonPrimitive.content)
        assertEquals("theme-local", envelope.command.changes.getValue("themeId").jsonPrimitive.content)
        assertEquals("theme-local", dao.task(taskId)?.themeId)

        assertEquals(false, outbox.drain("server-1") {
            MobileCommandSendResult.Conflict(
                conflict(
                    taskId,
                    serverVersion = 5,
                    serverState = "todo",
                    intendedAction = "UpdateTask",
                    serverThemeId = "theme-server",
                ),
            )
        })
        val storedConflict = requireNotNull(dao.conflict(commandId))
        assertTrue(storedConflict.localThemeIdChanged)
        assertEquals("theme-local", storedConflict.localThemeId)
        assertEquals("theme-server", storedConflict.serverThemeId)
        assertEquals("theme-server", dao.task(taskId)?.themeId)

        val replacementId = outbox.keepLocal(commandId)
        val replacement = MobileTaskCommandContract.decodeUpdateEnvelope(
            requireNotNull(dao.outbox(replacementId)).envelopeJson,
        )
        assertEquals(5, replacement.command.expectedVersion)
        assertEquals("theme-server", replacement.command.base.getValue("themeId").jsonPrimitive.content)
        assertEquals("theme-local", replacement.command.changes.getValue("themeId").jsonPrimitive.content)
        assertEquals("theme-local", dao.task(taskId)?.themeId)
    }

    @Test
    fun acceptingDesktopThemeKeepsCanonicalThemeAndDeletesLocalIntent() = runBlocking {
        val taskId = "10000000-0000-4000-8000-000000000043"
        storeThemeCatalog(dao, listOf(ThemeCacheEntity("theme-local", "端末Theme")))
        dao.upsertTask(
            canonicalCachedTask(taskId, version = 4, state = "todo").copy(themeId = "theme-old"),
        )
        val commandId = outbox.enqueueUpdateTheme(taskId, "theme-local")
        outbox.drain("server-1") {
            MobileCommandSendResult.Conflict(
                conflict(
                    taskId,
                    serverVersion = 5,
                    serverState = "todo",
                    intendedAction = "UpdateTask",
                    serverThemeId = "theme-server",
                ),
            )
        }

        outbox.acceptServer(commandId)

        assertEquals("theme-server", dao.task(taskId)?.themeId)
        assertNull(dao.task(taskId)?.conflictCommandId)
        assertNull(dao.conflict(commandId))
        assertNull(dao.outbox(commandId))
    }

    @Test
    fun rejectedThemeUpdateRollsBackAtomicallyAndRemainsEditableAfterRestart() = runBlocking {
        val databaseName = "mobile-theme-rejected-restart-test"
        context.deleteDatabase(databaseName)
        var durableDatabase: MobileLocalDatabase? = null
        try {
            val initialDatabase = Room.databaseBuilder(context, MobileLocalDatabase::class.java, databaseName)
                .allowMainThreadQueries()
                .build()
            durableDatabase = initialDatabase
            val initialDao = initialDatabase.mobileDao()
            initialDao.upsertSyncState(activeSyncState())
            storeThemeCatalog(
                initialDao,
                listOf(
                    ThemeCacheEntity("theme-old", "旧Theme"),
                    ThemeCacheEntity("theme-deleted", "削除済みTheme"),
                ),
            )
            initialDao.upsertTask(
                canonicalCachedTask("rejected-theme-task", version = 6, state = "todo").copy(themeId = "theme-old"),
            )
            val initialOutbox = MobileOutbox(
                context = context,
                dao = initialDao,
                deviceId = { "restart-device" },
                now = { Instant.parse("2026-08-22T02:00:00Z") },
                schedule = {},
            )
            val rejectedCommandId = initialOutbox.enqueueUpdateTheme("rejected-theme-task", "theme-deleted")

            assertEquals(false, initialOutbox.drain("server-1") {
                MobileCommandSendResult.Rejected(
                    code = "theme_not_found",
                    message = "選択したThemeは削除済みか利用できません。",
                )
            })
            val rejected = requireNotNull(initialDao.outbox(rejectedCommandId))
            val structuredError = Json.parseToJsonElement(requireNotNull(rejected.lastError)).jsonObject
            assertEquals(OutboxState.Rejected, rejected.state)
            assertEquals("theme_not_found", structuredError.getValue("code").jsonPrimitive.content)
            assertEquals("選択したThemeは削除済みか利用できません。", structuredError.getValue("message").jsonPrimitive.content)
            assertEquals(false, structuredError.getValue("retryable").jsonPrimitive.boolean)
            assertEquals("theme-old", initialDao.task("rejected-theme-task")?.themeId)
            assertNull(initialDao.task("rejected-theme-task")?.optimisticCommandId)

            initialDatabase.close()
            val reopenedDatabase = Room.databaseBuilder(context, MobileLocalDatabase::class.java, databaseName)
                .allowMainThreadQueries()
                .build()
            durableDatabase = reopenedDatabase
            val reopenedDao = reopenedDatabase.mobileDao()
            val recreatedOutbox = MobileOutbox(
                context = context,
                dao = reopenedDao,
                deviceId = { "restart-device" },
                now = { Instant.parse("2026-08-22T02:01:00Z") },
                schedule = {},
            )

            assertEquals("theme-old", reopenedDao.task("rejected-theme-task")?.themeId)
            assertNull(reopenedDao.task("rejected-theme-task")?.optimisticCommandId)
            assertEquals(OutboxState.Rejected, reopenedDao.outbox(rejectedCommandId)?.state)
            val projected = reopenedDao.observeAllTasks().first().single().toMobileTask("server-1")
            assertEquals("theme_not_found", projected.rejectedThemeUpdate?.code)
            assertEquals("選択したThemeは削除済みか利用できません。", projected.rejectedThemeUpdate?.message)
            val replacementId = recreatedOutbox.enqueueUpdateTheme("rejected-theme-task", "theme-deleted")
            assertTrue(replacementId != rejectedCommandId)
            assertNull(reopenedDao.outbox(rejectedCommandId))
            assertEquals(replacementId, reopenedDao.task("rejected-theme-task")?.optimisticCommandId)
        } finally {
            durableDatabase?.close()
            context.deleteDatabase(databaseName)
        }
    }

    @Test
    fun rejectedThemeUpdateCanBeDiscardedAndIsScopedToActiveServer() = runBlocking {
        val taskId = "10000000-0000-4000-8000-000000000044"
        storeThemeCatalog(dao, listOf(ThemeCacheEntity("theme-new", "新Theme")))
        dao.upsertTask(canonicalCachedTask(taskId, version = 3, state = "todo").copy(themeId = null))
        val commandId = outbox.enqueueUpdateTheme(taskId, "theme-new")
        outbox.drain("server-1") {
            MobileCommandSendResult.Rejected("theme_not_found", "選択したThemeは削除済みか利用できません。")
        }

        val related = dao.observeAllTasks().first().single { it.task.id == taskId }
        assertEquals(commandId, related.toMobileTask("server-1").rejectedThemeUpdate?.commandId)
        assertNull(related.toMobileTask("server-2").rejectedThemeUpdate)

        outbox.discardRejectedThemeUpdate(taskId, commandId)

        assertNull(dao.outbox(commandId))
        assertNull(
            dao.observeAllTasks().first().single { it.task.id == taskId }
                .toMobileTask("server-1").rejectedThemeUpdate,
        )
    }

    @Test
    fun corruptRejectedThemeErrorShapeFallsBackWithoutBreakingTaskProjection() = runBlocking {
        val taskId = "10000000-0000-4000-8000-000000000045"
        storeThemeCatalog(dao, listOf(ThemeCacheEntity("theme-new", "新Theme")))
        dao.upsertTask(canonicalCachedTask(taskId, version = 3, state = "todo").copy(themeId = null))
        val commandId = outbox.enqueueUpdateTheme(taskId, "theme-new")
        outbox.drain("server-1") {
            MobileCommandSendResult.Rejected("theme_not_found", "選択したThemeは削除済みか利用できません。")
        }
        dao.markRejected(commandId, "{\"code\":{},\"message\":[]}")

        val rejection = dao.observeAllTasks().first().single { it.task.id == taskId }
            .toMobileTask("server-1").rejectedThemeUpdate

        assertEquals("command_rejected", rejection?.code)
        assertEquals("DesktopがTheme変更を受理しませんでした。", rejection?.message)
    }

    @Test
    fun retryableThemeRejectionKeepsOptimisticIntentForRetry() = runBlocking {
        val taskId = "10000000-0000-4000-8000-000000000044"
        storeThemeCatalog(dao, listOf(ThemeCacheEntity("theme-local", "端末Theme")))
        dao.upsertTask(canonicalCachedTask(taskId, version = 4, state = "todo").copy(themeId = "theme-old"))
        val commandId = outbox.enqueueUpdateTheme(taskId, "theme-local")

        assertTrue(outbox.drain("server-1") {
            MobileCommandSendResult.Rejected(
                code = "temporarily_unavailable",
                message = "Themeを確認できませんでした。",
                retryable = true,
            )
        })

        assertEquals(OutboxState.RetryWait, dao.outbox(commandId)?.state)
        assertEquals("theme-local", dao.task(taskId)?.themeId)
        assertEquals(commandId, dao.task(taskId)?.optimisticCommandId)
    }

    @Test
    fun nonThemeRejectionPreservesExistingOptimisticFailureState() = runBlocking {
        val taskId = "10000000-0000-4000-8000-000000000048"
        dao.upsertTask(canonicalCachedTask(taskId, version = 4, state = "todo").copy(title = "元の名前"))
        val commandId = outbox.enqueueUpdateTitle(taskId, "端末の名前")

        assertEquals(false, outbox.drain("server-1") {
            MobileCommandSendResult.Rejected(
                code = "title_rejected",
                message = "Task名を更新できませんでした。",
            )
        })

        assertEquals(OutboxState.Rejected, dao.outbox(commandId)?.state)
        assertEquals("端末の名前", dao.task(taskId)?.title)
        assertEquals(commandId, dao.task(taskId)?.optimisticCommandId)
    }

    @Test
    fun receiptForDifferentCommandFailsClosedWithoutOrphaningOptimisticTask() = runBlocking {
        val taskId = "10000000-0000-4000-8000-000000000049"
        dao.upsertTask(canonicalCachedTask(taskId, version = 7, state = "todo"))
        val commandId = requireNotNull(outbox.enqueueComplete(taskId).commandId)

        assertTrue(outbox.drain("server-1") {
            MobileCommandSendResult.Applied(receipt("different-command", taskId, state = "done", version = 8))
        })

        assertEquals(OutboxState.RetryWait, dao.outbox(commandId)?.state)
        assertEquals(commandId, dao.task(taskId)?.optimisticCommandId)
        assertEquals(7, dao.task(taskId)?.serverVersion)
    }

    @Test
    fun receiptForDifferentTaskFailsClosedWithoutUpsertingIt() = runBlocking {
        val taskId = "10000000-0000-4000-8000-000000000045"
        val differentTaskId = "10000000-0000-4000-8000-000000000046"
        dao.upsertTask(canonicalCachedTask(taskId, version = 7, state = "todo"))
        val commandId = requireNotNull(outbox.enqueueComplete(taskId).commandId)

        assertTrue(outbox.drain("server-1") {
            MobileCommandSendResult.Applied(receipt(commandId, differentTaskId, state = "done", version = 8))
        })

        assertEquals(OutboxState.RetryWait, dao.outbox(commandId)?.state)
        assertEquals(commandId, dao.task(taskId)?.optimisticCommandId)
        assertEquals(7, dao.task(taskId)?.serverVersion)
        assertNull(dao.task(differentTaskId))
        val error = Json.parseToJsonElement(requireNotNull(dao.outbox(commandId)?.lastError)).jsonObject
        assertEquals("invalid_command_receipt", error.getValue("code").jsonPrimitive.content)
    }

    @Test
    fun receiptVersionCannotRetreatAndNoChangeMayKeepExpectedVersion() = runBlocking {
        val taskId = "10000000-0000-4000-8000-000000000047"
        dao.upsertTask(canonicalCachedTask(taskId, version = 7, state = "todo"))
        val commandId = requireNotNull(outbox.enqueueComplete(taskId).commandId)

        assertTrue(outbox.drain("server-1") {
            MobileCommandSendResult.Applied(receipt(commandId, taskId, state = "done", version = 7))
        })
        assertEquals(OutboxState.RetryWait, dao.outbox(commandId)?.state)
        assertEquals(commandId, dao.task(taskId)?.optimisticCommandId)
        assertEquals(7, dao.task(taskId)?.serverVersion)

        assertEquals(false, outbox.drain("server-1") {
            MobileCommandSendResult.Applied(
                receipt(commandId, taskId, state = "done", version = 7, status = "no_change"),
            )
        })
        assertEquals(7, dao.task(taskId)?.serverVersion)
        assertNull(dao.task(taskId)?.optimisticCommandId)
        assertNull(dao.outbox(commandId))
    }

    @Test
    fun clearingThemeKeepsExplicitNullIntentThroughConflictAndRestart() = runBlocking {
        val databaseName = "mobile-theme-restart-test"
        context.deleteDatabase(databaseName)
        var durableDatabase: MobileLocalDatabase? = null
        try {
            val initialDatabase = Room.databaseBuilder(context, MobileLocalDatabase::class.java, databaseName)
                .allowMainThreadQueries()
                .build()
            durableDatabase = initialDatabase
            val durableDao = initialDatabase.mobileDao()
            durableDao.upsertSyncState(activeSyncState())
            storeThemeCatalog(durableDao, listOf(ThemeCacheEntity("theme-old", "外すTheme")))
            durableDao.upsertTask(
                canonicalCachedTask("restart-theme-task", version = 6, state = "todo").copy(themeId = "theme-old"),
            )
            val durableOutbox = MobileOutbox(
                context = context,
                dao = durableDao,
                deviceId = { "restart-device" },
                now = { Instant.parse("2026-08-22T02:00:00Z") },
                schedule = {},
            )
            val commandId = durableOutbox.enqueueUpdateTheme("restart-theme-task", null)
            initialDatabase.close()
            val reopenedDatabase = Room.databaseBuilder(context, MobileLocalDatabase::class.java, databaseName)
                .allowMainThreadQueries()
                .build()
            durableDatabase = reopenedDatabase
            val reopenedDao = reopenedDatabase.mobileDao()
            val reopenedEnvelope = MobileTaskCommandContract.decodeUpdateEnvelope(
                requireNotNull(reopenedDao.outbox(commandId)).envelopeJson,
            )

            assertEquals(JsonNull, reopenedEnvelope.command.changes.getValue("themeId"))
            assertEquals("theme-old", reopenedEnvelope.command.base.getValue("themeId").jsonPrimitive.content)
            assertNull(reopenedDao.task("restart-theme-task")?.themeId)
            assertEquals(commandId, reopenedDao.task("restart-theme-task")?.optimisticCommandId)
            assertEquals(listOf("theme-old"), reopenedDao.themes().map { it.id })
            assertEquals("server-1", reopenedDao.themeCatalogState()?.serverId)
            assertEquals(1, reopenedDao.themeCatalogState()?.serverRevision)
            assertEquals(ThemeCatalogStatus.Available, reopenedDao.themeCatalogState()?.status)

            val reopenedOutbox = MobileOutbox(
                context = context,
                dao = reopenedDao,
                deviceId = { "restart-device" },
                now = { Instant.parse("2026-08-22T02:01:00Z") },
                schedule = {},
            )
            assertEquals(false, reopenedOutbox.drain("server-1") {
                MobileCommandSendResult.Conflict(
                    conflict(
                        taskId = "restart-theme-task",
                        serverVersion = 7,
                        serverState = "todo",
                        intendedAction = "UpdateTask",
                        serverThemeId = "theme-server",
                    ),
                )
            })
            val conflict = requireNotNull(reopenedDao.conflict(commandId))
            assertTrue(conflict.localThemeIdChanged)
            assertNull(conflict.localThemeId)
            assertEquals("theme-server", conflict.serverThemeId)

            val replacementId = reopenedOutbox.keepLocal(commandId)
            val replacement = MobileTaskCommandContract.decodeUpdateEnvelope(
                requireNotNull(reopenedDao.outbox(replacementId)).envelopeJson,
            )
            assertEquals(JsonNull, replacement.command.changes.getValue("themeId"))
            assertEquals("theme-server", replacement.command.base.getValue("themeId").jsonPrimitive.content)
            assertNull(reopenedDao.task("restart-theme-task")?.themeId)

            assertEquals(false, reopenedOutbox.drain("server-1") {
                MobileCommandSendResult.Applied(
                    receipt(
                        commandId = replacementId,
                        taskId = "restart-theme-task",
                        version = 8,
                        themeId = "theme-personal-default",
                    ),
                )
            })
            assertEquals("theme-personal-default", reopenedDao.task("restart-theme-task")?.themeId)
            assertNull(reopenedDao.task("restart-theme-task")?.optimisticCommandId)
            assertEquals(0, reopenedDao.outboxCount())
        } finally {
            durableDatabase?.close()
            context.deleteDatabase(databaseName)
        }
    }

    private fun receipt(
        commandId: String,
        taskId: String,
        state: String = "todo",
        version: Int = 1,
        status: String = "applied",
        themeId: String? = null,
        todayDate: String? = null,
        schedule: MobileTaskScheduleDto? = null,
        plannedStartTime: String? = null,
        plannedDurationMinutes: Int? = null,
    ) = MobileTaskCommandResponseDto(
        ok = true,
        meta = MobileResponseMetaDto(
            apiVersion = 1,
            schemaVersion = 2,
            serverId = "server-1",
            serverRevision = 10,
            generatedAt = "2026-08-22T01:04:00Z",
            truncated = false,
        ),
        data = MobileTaskCommandReceiptDto(
            commandId = commandId,
            status = status,
            task = MobileTaskSummaryDto(
                id = taskId,
                version = version,
                title = "Desktop正規化後",
                themeId = themeId,
                state = state,
                workState = null,
                todayDate = todayDate,
                schedule = schedule,
                plannedStartTime = plannedStartTime,
                plannedDurationMinutes = plannedDurationMinutes,
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
        serverTodayDate: String? = null,
        serverThemeId: String? = null,
        serverSchedule: MobileTaskScheduleDto? = null,
        plannedStartTime: String? = null,
        plannedDurationMinutes: Int? = null,
    ) = MobileTaskCommandErrorResponseDto(
        ok = false,
        meta = MobileResponseMetaDto(
            apiVersion = 1,
            schemaVersion = 2,
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
                    themeId = serverThemeId,
                    state = serverState,
                    workState = null,
                    todayDate = serverTodayDate,
                    schedule = serverSchedule,
                    plannedStartTime = plannedStartTime,
                    plannedDurationMinutes = plannedDurationMinutes,
                    updatedAt = "2026-08-22T01:05:00Z",
                ),
                intendedAction = intendedAction,
                expectedVersion = serverVersion - 1,
            ),
        ),
    )

    private fun scheduleDto(
        id: String,
        version: Int,
        startDate: String?,
        endDate: String?,
        rangeSemantics: String?,
    ) = MobileTaskScheduleDto(
        id = id,
        version = version,
        startDate = startDate,
        endDate = endDate,
        dateKind = deriveScheduleDateKind(startDate, endDate),
        rangeSemantics = rangeSemantics,
        confidence = "fixed",
        granularity = "day",
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
            scheduleId = response.data.task.schedule?.id,
            scheduleVersion = response.data.task.schedule?.version,
            scheduleStartDate = response.data.task.schedule?.startDate,
            scheduleEndDate = response.data.task.schedule?.endDate,
            scheduleDateKind = response.data.task.schedule?.dateKind,
            scheduleRangeSemantics = response.data.task.schedule?.rangeSemantics,
            scheduleConfidence = response.data.task.schedule?.confidence,
            scheduleGranularity = response.data.task.schedule?.granularity,
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

    private fun activeSyncState(serverId: String = "server-1") = SyncStateEntity(
        serverId = serverId,
        apiVersion = 1,
        schemaVersion = 2,
        cursor = "task-cursor",
        lastSuccessfulSyncAt = "2026-08-22T01:00:00Z",
        lastAttemptAt = "2026-08-22T01:00:00Z",
        lastError = null,
    )

    private suspend fun storeThemeCatalog(
        targetDao: MobileLocalDao,
        themes: List<ThemeCacheEntity>,
        revision: Int = 1,
        serverId: String = "server-1",
    ) {
        val refreshId = UUID.randomUUID().toString()
        val generatedAt = "2026-08-22T02:00:00Z"
        targetDao.prepareThemeRefresh(serverId, refreshId, generatedAt)
        assertTrue(
            targetDao.completeThemeRefresh(
                serverId,
                revision,
                generatedAt,
                generatedAt,
                refreshId,
                themes,
            ),
        )
    }
}
