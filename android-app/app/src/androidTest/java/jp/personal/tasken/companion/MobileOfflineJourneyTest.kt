package jp.personal.tasken.companion

import android.content.Context
import android.content.ContextWrapper
import android.os.Process
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.time.Instant
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Run the two methods in separate instrumentation processes with the same runner fixture. */
class MobileOfflineJourneyTest {
    private val gateway = MobileGatewayFixtureClient()
    private val capturedAt = "2026-09-06T00:00:00Z"
    private val date = LocalDate.parse("2026-09-06")
    private val longText = " 原文🧪\n日本語 https://example.test/journey\n".repeat(200)
    private val draftText = "未保存の入力\n再起動しても残す🧪  "
    private val recoveredText = "期限を過ぎても回収する原文"
    private val appContext get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val prefix get() = "offline-journey-${gateway.serverId}"
    private val databaseName get() = "$prefix.db"
    private val preferences get() = appContext.getSharedPreferences(prefix, Context.MODE_PRIVATE)
    private val draftContext get() = object : ContextWrapper(appContext) {
        override fun getApplicationContext(): Context = this
        override fun getFilesDir(): File = File(appContext.filesDir, prefix).also { check(it.isDirectory || it.mkdirs()) }
        override fun getSharedPreferences(name: String, mode: Int) = appContext.getSharedPreferences("$prefix-$name", mode)
    }

    private fun open() = Room.databaseBuilder(appContext, MobileLocalDatabase::class.java, databaseName)
        .allowMainThreadQueries().build()

    @Test fun aSaveOfflineInputAndEditsBeforeProcessExit() = runBlocking {
        assumeTrue("Requires the isolated Gateway runner", gateway.available)
        check(appContext.packageName.endsWith(".debug"))
        check(!appContext.getDatabasePath(databaseName).exists()) { "Use a fresh runner fixture." }
        gateway.control("{\"offline\":true}")
        val db = open()
        try {
            val dao = db.mobileDao()
            dao.upsertSyncState(SyncStateEntity(serverId = gateway.serverId, apiVersion = 1,
                schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION, cursor = null,
                lastSuccessfulSyncAt = capturedAt, lastAttemptAt = capturedAt, lastError = null))
            dao.upsertThemes(listOf(ThemeCacheEntity("theme-offline-fixture", "Offline fixture")))
            val outbox = MobileOutbox(appContext, dao, { gateway.deviceId }, { Instant.parse(capturedAt) }, {})
            val taskId = outbox.enqueueCreate("最初の名前", date, draftId = "$prefix-task")
            // The first send has started: every following operation must preserve its envelope.
            assertTrue(outbox.drain(gateway.serverId, gateway::send))
            val original = dao.outboxForTask(taskId).single()
            assertEquals(1, original.attemptCount)
            outbox.enqueueUpdateTitle(taskId, "オフラインで編集した名前")
            outbox.enqueueUpdateTheme(taskId, "theme-offline-fixture")
            outbox.enqueueUpdateTodayDate(taskId, date.plusDays(1))
            outbox.enqueueUpdateSchedule(taskId, MobileTaskScheduleDraft(date.toString(), date.plusDays(3).toString(),
                "ongoing", plannedStartTime = "14:30", plannedDurationMinutes = 45))
            val items = listOf(MobileChecklistItem("journey-first", "調べる", false, 0.0),
                MobileChecklistItem("journey-second", "記録する", false, 1.0))
            outbox.enqueueUpdateChecklist(taskId, items)
            outbox.enqueueUpdateChecklist(taskId, items.map { it.copy(done = true, completedAt = capturedAt) })
            outbox.enqueueComplete(taskId)
            outbox.enqueueReopen(taskId)
            assertEquals(original.envelopeJson, dao.outbox(original.commandId)?.envelopeJson)
            assertTask(dao.task(taskId))
            val unsentId = outbox.enqueueCreate("未送信の名前", date, draftId = "$prefix-unsent")
            outbox.enqueueUpdateTitle(unsentId, "未送信を編集")
            outbox.enqueueUpdateTheme(unsentId, "theme-offline-fixture")
            outbox.enqueueUpdateTodayDate(unsentId, date.plusDays(2))
            outbox.enqueueUpdateChecklist(unsentId, items)
            val unsent = dao.outboxForTask(unsentId).single()
            assertEquals(0, unsent.attemptCount)
            val captureId = outbox.enqueueCapture(longText, draftId = "$prefix-capture", createdAt = capturedAt)

            val oldNow = Instant.now().minusSeconds(10L * 24 * 60 * 60)
            check(MobileCaptureDraftStore(draftContext, now = { oldNow }).save(MobileCaptureDraftSnapshot(
                MobileCaptureDraft.fresh(text = recoveredText, now = { oldNow }), false)))
            val store = MobileCaptureDraftStore(draftContext)
            assertNull(store.load())
            assertEquals(recoveredText, store.recoveredInputs().single().text)
            val draft = MobileCaptureDraft.fresh(text = draftText)
            check(store.save(MobileCaptureDraftSnapshot(draft, true)))
            check(preferences.edit().putString("taskId", taskId).putString("captureId", captureId)
                .putString("draftId", draft.draftId).putString("originalEnvelope", original.envelopeJson)
                .putString("unsentId", unsentId).putString("unsentCommandId", unsent.commandId)
                .putString("originalCommandId", original.commandId).putInt("pid", Process.myPid()).commit())
            assertEquals(0, gateway.snapshot().getValue("tasks").jsonArray.size)
            assertEquals(0, gateway.snapshot().getValue("captures").jsonArray.size)
        } finally {
            db.close()
        }
    }

    @Test fun bReloadSameInputsAndConvergeAfterLostReceipt() = runBlocking {
        assumeTrue("Requires the isolated Gateway runner", gateway.available)
        assertNotEquals(preferences.getInt("pid", Process.myPid()), Process.myPid())
        check(appContext.getDatabasePath(databaseName).exists())
        val db = open()
        try {
            val dao = db.mobileDao()
            val taskId = checkNotNull(preferences.getString("taskId", null))
            val captureId = checkNotNull(preferences.getString("captureId", null))
            val unsentId = checkNotNull(preferences.getString("unsentId", null))
            val unsentCommandId = checkNotNull(preferences.getString("unsentCommandId", null))
            val unsentTask = checkNotNull(dao.task(unsentId))
            assertEquals("未送信を編集", unsentTask.title)
            assertEquals("theme-offline-fixture", unsentTask.themeId)
            assertEquals(date.plusDays(2).toString(), unsentTask.todayDate)
            assertEquals(2, decodeMobileChecklist(unsentTask.checklistJson).size)
            assertEquals(unsentCommandId, dao.outboxForTask(unsentId).single().commandId)
            assertTask(dao.task(taskId))
            assertEquals(preferences.getString("originalEnvelope", null),
                dao.outbox(checkNotNull(preferences.getString("originalCommandId", null)))?.envelopeJson)
            val store = MobileCaptureDraftStore(draftContext)
            assertEquals(draftText, checkNotNull(store.load()).draft.text)
            assertEquals(preferences.getString("draftId", null), checkNotNull(store.load()).draft.draftId)
            val recovered = store.recoveredInputs().single()
            assertEquals(recoveredText, recovered.text)
            assertNull(store.restoreRecoveredInput(recovered.id))

            val originalCommandId = checkNotNull(preferences.getString("originalCommandId", null))
            gateway.control(JsonObject(mapOf("offline" to JsonPrimitive(false), "dropNextReceipt" to JsonPrimitive(true),
                "dropCommandId" to JsonPrimitive(originalCommandId))).toString())
            val outbox = MobileOutbox(appContext, dao, { gateway.deviceId }, { Instant.parse(capturedAt) }, {})
            outbox.recoverInterruptedSending()
            assertTrue(outbox.drain(gateway.serverId, gateway::send))
            assertTask(dao.task(taskId))
            val afterLostReceipt = gateway.snapshot()
            val createEvent = afterLostReceipt.getValue("events").jsonArray.single {
                it.jsonObject["command_id"]?.jsonPrimitive?.content == originalCommandId
            }
            val createReceipt = afterLostReceipt.getValue("receipts").jsonArray.single {
                it.jsonObject["commandId"]?.jsonPrimitive?.content == originalCommandId
            }
            gateway.control("{\"restartDesktop\":true}")
            assertFalse(outbox.drain(gateway.serverId, gateway::send))
            assertEquals(0, dao.outboxCount())
            assertTask(dao.task(taskId))

            val conflictTaskId = outbox.enqueueCreate("競合元", date, draftId = "$prefix-conflict")
            val independentTaskId = outbox.enqueueCreate("独立Task", date, draftId = "$prefix-independent")
            assertFalse(outbox.drain(gateway.serverId, gateway::send))
            val conflictingCommand = outbox.enqueueUpdateTitle(conflictTaskId, "Androidの変更を保持")
            outbox.enqueueComplete(conflictTaskId)
            outbox.enqueueUpdateTitle(independentTaskId, "別Taskの同期は継続する")
            gateway.control(JsonObject(mapOf("editTask" to JsonObject(mapOf("id" to JsonPrimitive(conflictTaskId),
                "changes" to JsonObject(mapOf("title" to JsonPrimitive("Desktopの変更を保持"))))))).toString())
            assertFalse(outbox.drain(gateway.serverId, gateway::send))
            assertNotNull(dao.conflict(conflictingCommand))
            assertEquals(OutboxState.Blocked, dao.taskDescendants(conflictingCommand).single().state)
            assertEquals("別Taskの同期は継続する", dao.task(independentTaskId)?.title)
            assertNull(dao.task(independentTaskId)?.optimisticCommandId)
            val snapshot = gateway.snapshot()
            val unsentCanonical = snapshot.getValue("tasks").jsonArray.single {
                it.jsonObject["id"]?.jsonPrimitive?.content == unsentId
            }.jsonObject
            assertEquals("未送信を編集", unsentCanonical.getValue("title").jsonPrimitive.content)
            assertEquals("theme-offline-fixture", unsentCanonical.getValue("project_id").jsonPrimitive.content)
            assertEquals(date.plusDays(2).toString(), unsentCanonical.getValue("today_date").jsonPrimitive.content)
            assertEquals(1, snapshot.getValue("receipts").jsonArray.count {
                it.jsonObject["commandId"]?.jsonPrimitive?.content == unsentCommandId
            })
            assertEquals(1, snapshot.getValue("events").jsonArray.count {
                it.jsonObject["entity_id"]?.jsonPrimitive?.content == unsentId
            })
            val task = snapshot.getValue("tasks").jsonArray.single { it.jsonObject["id"]?.jsonPrimitive?.content == taskId }.jsonObject
            assertEquals("オフラインで編集した名前", task.getValue("title").jsonPrimitive.content)
            assertEquals("theme-offline-fixture", task.getValue("project_id").jsonPrimitive.content)
            assertEquals(date.plusDays(1).toString(), task.getValue("today_date").jsonPrimitive.content)
            assertEquals("todo", task.getValue("state").jsonPrimitive.content)
            assertEquals("14:30", task.getValue("planned_start_time").jsonPrimitive.content)
            assertEquals("45", task.getValue("planned_duration_minutes").jsonPrimitive.content)
            val schedule = snapshot.getValue("schedules").jsonArray.single {
                it.jsonObject["owner_id"]?.jsonPrimitive?.content == taskId
            }.jsonObject
            assertEquals(date.plusDays(3).toString(), schedule.getValue("end_date").jsonPrimitive.content)
            val captures = snapshot.getValue("captures").jsonArray.filter { it.jsonObject["id"]?.jsonPrimitive?.content == captureId }
            assertEquals(1, captures.size)
            assertEquals(longText, captures.single().jsonObject.getValue("text").jsonPrimitive.content)
            assertEquals(1, snapshot.getValue("lostReceipts").jsonPrimitive.content.toInt())
            val events = snapshot.getValue("events").jsonArray
            assertEquals(createEvent, events.single {
                it.jsonObject["command_id"]?.jsonPrimitive?.content == originalCommandId
            })
            assertEquals(createReceipt, snapshot.getValue("receipts").jsonArray.single {
                it.jsonObject["commandId"]?.jsonPrimitive?.content == originalCommandId
            })
            assertEquals(1, events.count { it.jsonObject["entity_id"]?.jsonPrimitive?.content == captureId })
            assertEquals(events.size, events.map { it.jsonObject.getValue("id").jsonPrimitive.content }.distinct().size)
            val eventCount = events.size
            val seen = snapshot.getValue("seenCommands").jsonArray
            val duplicates = seen.groupBy { it.jsonObject.getValue("commandId").jsonPrimitive.content }.values.filter { it.size > 1 }
            assertEquals(1, duplicates.size)
            assertEquals(2, duplicates.single().size)
            assertEquals(duplicates.single()[0], duplicates.single()[1])
            assertFalse(outbox.drain(gateway.serverId, gateway::send))
            gateway.control("{\"restartDesktop\":true}")
            assertEquals(eventCount, gateway.snapshot().getValue("events").jsonArray.size)
            assertEquals(draftText, checkNotNull(store.load()).draft.text)
        } finally {
            db.close()
            cleanup()
        }
    }

    @Test fun cCleanupOwnedFixture() {
        assumeTrue("Requires the isolated Gateway runner", gateway.available)
        cleanup()
    }

    private fun cleanup() {
        if (appContext.getDatabasePath(databaseName).exists()) check(appContext.deleteDatabase(databaseName))
        check(preferences.edit().clear().commit())
        check(appContext.getSharedPreferences("$prefix-tasken-mobile-input-recovery", Context.MODE_PRIVATE).edit().clear().commit())
        val directory = File(appContext.filesDir, prefix)
        check(directory.canonicalFile.parentFile == appContext.filesDir.canonicalFile)
        if (directory.exists()) check(directory.deleteRecursively())
    }

    private fun assertTask(task: TaskCacheEntity?) {
        val saved = checkNotNull(task)
        assertEquals("オフラインで編集した名前", saved.title)
        assertEquals("theme-offline-fixture", saved.themeId)
        assertEquals(date.plusDays(1).toString(), saved.todayDate)
        assertEquals(date.plusDays(3).toString(), saved.scheduleEndDate)
        assertEquals("ongoing", saved.scheduleRangeSemantics)
        assertEquals("14:30", saved.plannedStartTime)
        assertEquals(45, saved.plannedDurationMinutes)
        assertEquals("todo", saved.state)
        val items = decodeMobileChecklist(saved.checklistJson)
        assertEquals(listOf("journey-first", "journey-second"), items.map { it.id })
        assertTrue(items.all { it.done })
    }
}
