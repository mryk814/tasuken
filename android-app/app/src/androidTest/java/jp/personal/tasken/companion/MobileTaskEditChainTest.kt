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
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MobileTaskEditChainTest {
    private lateinit var context: Context
    private lateinit var db: MobileLocalDatabase
    private lateinit var dao: MobileLocalDao
    private lateinit var outbox: MobileOutbox
    private val databaseName = "task-edit-chain-${UUID.randomUUID()}.db"
    private val timestamp = "2026-09-06T00:00:00Z"
    private val server = mutableMapOf<String, MobileTaskSummaryDto>()
    private val receipts = mutableMapOf<String, MobileTaskCommandResponseDto>()

    private fun open() {
        db = Room.databaseBuilder(context, MobileLocalDatabase::class.java, databaseName).allowMainThreadQueries().build()
        dao = db.mobileDao()
        outbox = MobileOutbox(context, dao, { "chain-device" }, { Instant.parse(timestamp) }, {})
    }

    @Before fun setUp() = runBlocking {
        context = ApplicationProvider.getApplicationContext()
        open()
        dao.upsertSyncState(SyncStateEntity(serverId = "server", apiVersion = 1,
            schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION, cursor = null, lastSuccessfulSyncAt = timestamp,
            lastAttemptAt = timestamp, lastError = null))
    }

    @After fun tearDown() { db.close(); context.deleteDatabase(databaseName) }

    @Test fun lostCreateResponseThenRenameAndCompleteSurviveRestartWithoutRollback() = runBlocking {
        val id = outbox.enqueueCreate("最初の原文", draftId = "lost-response")
        val sent = requireNotNull(dao.claimNext("server", timestamp))
        val firstReceipt = applyAtServer(sent.envelopeJson)
        val titleId = outbox.enqueueUpdateTitle(id, "送信後の原文")
        outbox.enqueueComplete(id)
        assertEquals(sent.envelopeJson, dao.outbox(sent.commandId)?.envelopeJson)
        assertEquals("", dao.outbox(titleId)?.envelopeJson)
        assertNotNull(dao.outbox(titleId)?.taskIntentJson)
        db.close(); open()
        assertEquals(1, outbox.recoverInterruptedSending())
        var calls = 0
        outbox.drain("server") { envelope ->
            runBlocking {
                assertEquals("送信後の原文", dao.task(id)?.title)
                assertEquals("done", dao.task(id)?.state)
            }
            calls++
            MobileCommandSendResult.Applied(applyAtServer(envelope))
        }
        assertEquals(3, calls)
        assertEquals(3, receipts.size)
        assertEquals("送信後の原文", server[id]?.title)
        assertEquals("done", dao.task(id)?.state)
        assertEquals(3, dao.task(id)?.serverVersion)
        assertEquals(0, dao.outboxCount())
        assertFalse(dao.applyCommandReceipt(sent.commandId, "server", id, sent.attemptCount,
            TaskCacheEntity(id = id, serverVersion = 1, title = "最初の原文", themeId = null,
                state = "todo", workState = null, todayDate = null, updatedAt = timestamp, optimisticCommandId = null),
            requireNotNull(dao.syncState())))
        assertEquals(firstReceipt, receipts[sent.commandId])
        assertEquals("送信後の原文", dao.task(id)?.title)
    }

    @Test fun existingTaskKeepsScalarEditOrderAndIndependentTaskSurvivesConflict() = runBlocking {
        val id = seed("task-main")
        val other = seed("task-other")
        val parent = outbox.enqueueUpdateTitle(id, "ローカル名")
        outbox.enqueueUpdateTodayDate(id, LocalDate.parse("2026-09-07"))
        outbox.enqueueComplete(id)
        outbox.enqueueUpdateTitle(other, "独立Task")
        server[id] = requireNotNull(server[id]).copy(title = "他端末の名前", version = 2)
        outbox.drain("server") { envelope -> send(envelope) }
        assertNotNull(dao.conflict(parent))
        assertEquals(2, dao.taskDescendants(parent).size)
        assertTrue(dao.taskDescendants(parent).all { it.state == OutboxState.Blocked && it.attemptCount == 0 })
        assertEquals("独立Task", server[other]?.title)
        assertEquals(2, dao.observeAllTasks().first().first { it.task.id == id }.toMobileTask("server").heldChanges.size)
        outbox.keepLocal(parent)
        outbox.drain("server") { envelope -> send(envelope) }
        assertEquals("ローカル名", server[id]?.title)
        assertEquals("2026-09-07", server[id]?.todayDate)
        assertEquals("done", server[id]?.state)
        assertEquals(0, dao.outboxCount())
    }

    @Test fun rejectedParentPreservesChildrenAndExplicitDiscardRestoresOriginal() = runBlocking {
        val id = seed("reject")
        val root = outbox.enqueueUpdateTitle(id, "保持する名前")
        outbox.enqueueComplete(id)
        outbox.drain("server") { MobileCommandSendResult.Rejected("not_found", "Taskは削除されています。") }
        assertEquals(OutboxState.Rejected, dao.outbox(root)?.state)
        assertEquals(OutboxState.Blocked, dao.taskDescendants(root).single().state)
        assertEquals("保持する名前", dao.task(id)?.title)
        db.close(); open()
        assertEquals(2, dao.observeAllTasks().first().single().toMobileTask("server").heldChanges.size)
        outbox.discardRejectedTaskChanges(root)
        assertEquals("元の名前", dao.task(id)?.title)
        assertEquals("todo", dao.task(id)?.state)
        assertEquals(0, dao.outboxCount())
    }

    @Test fun successorAndProjectionRollbackTogetherWhenCacheWriteFails() = runBlocking {
        val id = seed("rollback")
        outbox.enqueueUpdateTitle(id, "先行変更")
        val before = dao.task(id)
        db.openHelper.writableDatabase.execSQL("CREATE TRIGGER reject_edit BEFORE INSERT ON task_cache WHEN NEW.title = '失敗する入力' BEGIN SELECT RAISE(ABORT, 'fixture'); END")
        assertTrue(runCatching { outbox.enqueueUpdateTitle(id, "失敗する入力") }.isFailure)
        assertEquals(1, dao.outboxCount())
        assertEquals(before, dao.task(id))
    }

    @Test fun afterAttemptStateToggleCreatesNewIntentAndDoesNotRewriteEnvelope() = runBlocking {
        val id = seed("toggle")
        outbox.enqueueComplete(id)
        val sent = requireNotNull(dao.claimNext("server", timestamp))
        outbox.enqueueReopen(id)
        assertEquals(sent, dao.outbox(sent.commandId))
        assertEquals(1, dao.taskDescendants(sent.commandId).size)
        outbox.recoverInterruptedSending()
        outbox.drain("server") { send(it) }
        assertEquals("todo", server[id]?.state)
        assertEquals(3, server[id]?.version)
    }

    @Test fun attemptedScheduleUsesNextReceiptVersionsAndNeverRollsBackFollowingInputs() = runBlocking {
        val id = seed("schedule-chain")
        val original = requireNotNull(dao.task(id)).copy(scheduleId = "dates", scheduleVersion = 4,
            scheduleStartDate = "2026-09-08", scheduleEndDate = "2026-09-10", scheduleDateKind = "range", scheduleRangeSemantics = "ongoing")
        dao.upsertTask(original)
        val first = outbox.enqueueUpdateSchedule(id, MobileTaskScheduleDraft("2026-09-08", "2026-09-11", "ongoing", "09:00", 30))
        val attempted = requireNotNull(dao.claimNext("server", timestamp))
        assertEquals(first, attempted.commandId)
        val second = outbox.enqueueUpdateSchedule(id, MobileTaskScheduleDraft("2026-09-08", "2026-09-12", "ongoing", "10:00", 60))
        val third = outbox.enqueueUpdateSchedule(id, MobileTaskScheduleDraft("2026-09-08", "2026-09-13", "ongoing", "11:00", 90))
        assertEquals(second, third)
        assertEquals(attempted, dao.outbox(first))
        val items = listOf(MobileChecklistItem("one", "後続の項目", false, 0.0))
        val checklist = outbox.enqueueUpdateChecklist(id, items)
        assertEquals(checklist, outbox.enqueueUpdateChecklist(id, items.map { it.copy(done = true, completedAt = timestamp) }))
        outbox.enqueueComplete(id)
        assertEquals(4, dao.outboxCount())
        assertTrue(dao.applyCommandReceipt(first, "server", id, attempted.attemptCount,
            original.copy(serverVersion = 2, scheduleVersion = 5, scheduleEndDate = "2026-09-11", plannedStartTime = "09:00", plannedDurationMinutes = 30),
            requireNotNull(dao.syncState())))
        val materialized = MobileTaskCommandContract.decodeUpdateEnvelope(requireNotNull(dao.outbox(second)).envelopeJson)
        assertEquals(2, materialized.command.expectedVersion)
        assertEquals(5, materialized.command.expectedScheduleVersion)
        assertEquals("2026-09-13", dao.task(id)?.scheduleEndDate)
        assertEquals("11:00", dao.task(id)?.plannedStartTime)
        assertEquals(90, dao.task(id)?.plannedDurationMinutes)
        assertTrue(decodeMobileChecklist(requireNotNull(dao.task(id)).checklistJson).single().done)
        assertEquals("done", dao.task(id)?.state)
        db.close(); open()
        assertEquals(materialized, MobileTaskCommandContract.decodeUpdateEnvelope(requireNotNull(dao.outbox(second)).envelopeJson))
        assertEquals("2026-09-13", dao.task(id)?.scheduleEndDate)
    }

    @Test fun unsentStructuredEditsAndCoalescingRollbackAtomically() = runBlocking {
        val id = outbox.enqueueCreate("未送信の予定入力")
        outbox.enqueueUpdateSchedule(id, MobileTaskScheduleDraft("2026-09-08", "2026-09-10", "ongoing", "09:15", 45))
        assertEquals(1, dao.outboxCount())
        val create = requireNotNull(dao.outbox(requireNotNull(dao.task(id)?.optimisticCommandId)))
        assertEquals("09:15", MobileTaskCommandContract.decodeCreateEnvelope(create.envelopeJson).command.task.plannedStartTime)
        assertEquals(45, dao.task(id)?.plannedDurationMinutes)
        dao.claimNext("server", timestamp)
        outbox.enqueueUpdateChecklist(id, listOf(MobileChecklistItem("one", "保存済み項目", false, 0.0)))
        val beforeTask = dao.task(id)
        val beforeCommands = dao.outboxForTask(id)
        db.openHelper.writableDatabase.execSQL("CREATE TRIGGER reject_checklist BEFORE INSERT ON task_cache WHEN NEW.checklistJson LIKE '%失敗する項目%' BEGIN SELECT RAISE(ABORT, 'fixture'); END")
        assertTrue(runCatching { outbox.enqueueUpdateChecklist(id, listOf(MobileChecklistItem("one", "失敗する項目", true, 0.0, timestamp))) }.isFailure)
        assertEquals(beforeTask, dao.task(id))
        assertEquals(beforeCommands, dao.outboxForTask(id))
        outbox.enqueueUpdateSchedule(id, MobileTaskScheduleDraft("2026-09-08", "2026-09-12", "ongoing", "11:00", 90))
        val savedTask = dao.task(id)
        val savedCommands = dao.outboxForTask(id)
        db.openHelper.writableDatabase.execSQL("CREATE TRIGGER reject_schedule BEFORE INSERT ON task_cache WHEN NEW.plannedStartTime = '12:00' BEGIN SELECT RAISE(ABORT, 'fixture'); END")
        assertTrue(runCatching { outbox.enqueueUpdateSchedule(id, MobileTaskScheduleDraft("2026-09-08", "2026-09-13", "ongoing", "12:00", 120)) }.isFailure)
        assertEquals(savedTask, dao.task(id))
        assertEquals(savedCommands, dao.outboxForTask(id))
    }

    private suspend fun seed(id: String): String {
        dao.upsertTask(TaskCacheEntity(id = id, serverVersion = 1, title = "元の名前", themeId = null,
            state = "todo", workState = null, todayDate = null, updatedAt = timestamp, optimisticCommandId = null))
        server[id] = MobileTaskSummaryDto(id = id, version = 1, title = "元の名前", themeId = null,
            state = "todo", workState = null, todayDate = null, schedule = null, updatedAt = timestamp)
        return id
    }

    private fun send(envelope: String): MobileCommandSendResult {
        val root = Json.parseToJsonElement(envelope).jsonObject
        val command = root.getValue("command").jsonObject
        val id = command.getValue("taskId").jsonPrimitive.content
        val expected = command.getValue("expectedVersion").jsonPrimitive.content.toInt()
        val current = requireNotNull(server[id])
        if (current.version != expected) return MobileCommandSendResult.Conflict(MobileTaskCommandErrorResponseDto(
            ok = false, meta = meta(), error = MobileTaskCommandErrorDto("version_conflict", "他端末で変更されました。", false,
                MobileVersionConflictDto(current, command.getValue("name").jsonPrimitive.content, expected, "task")),
        ))
        return MobileCommandSendResult.Applied(applyAtServer(envelope))
    }

    private fun applyAtServer(envelope: String): MobileTaskCommandResponseDto {
        val root = Json.parseToJsonElement(envelope).jsonObject
        val commandId = root.getValue("commandId").jsonPrimitive.content
        receipts[commandId]?.let { return it }
        val command = root.getValue("command").jsonObject
        val name = command.getValue("name").jsonPrimitive.content
        val task = if (name == "CreateTask") {
            val candidate = MobileTaskCommandContract.decodeCreateEnvelope(envelope).command.task
            MobileTaskSummaryDto(id = candidate.id, version = 1, title = candidate.title, themeId = candidate.projectId,
                todayDate = candidate.todayDate, state = "todo", workState = null, schedule = null, updatedAt = timestamp)
        } else {
            val current = requireNotNull(server[command.getValue("taskId").jsonPrimitive.content])
            val changes = command["changes"]?.jsonObject
            current.copy(version = current.version + 1,
                title = changes?.get("title")?.jsonPrimitive?.content ?: current.title,
                todayDate = if (changes?.containsKey("todayDate") == true) changes.getValue("todayDate").let { if (it == JsonNull) null else it.jsonPrimitive.content } else current.todayDate,
                state = when (name) { "CompleteTask" -> "done"; "ReopenTask" -> "todo"; else -> current.state })
        }
        server[task.id] = task
        return MobileTaskCommandResponseDto(true, meta(), MobileTaskCommandReceiptDto(commandId, "applied", task)).also { receipts[commandId] = it }
    }

    private fun meta() = MobileResponseMetaDto(1, TASKEN_MOBILE_SCHEMA_VERSION, "server", 1, timestamp, false)
}
