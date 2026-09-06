package jp.personal.tasken.companion

import android.content.Context
import android.content.ContextWrapper
import android.os.Process
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import java.net.HttpURLConnection
import java.net.URI
import java.time.Instant
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.FixMethodOrder
import org.junit.Test
import org.junit.runners.MethodSorters

/** Run seed and verify in separate instrumentation processes against one isolated Gateway fixture. */
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class MobileTaskEditGatewayTest {
    private val arguments = InstrumentationRegistry.getArguments()
    private val context: Context = object : ContextWrapper(InstrumentationRegistry.getInstrumentation().targetContext) {
        override fun getApplicationContext(): Context = this
    }
    private val databaseName = "task-edit-gateway-533.db"
    private val preferences get() = context.getSharedPreferences("task-edit-gateway-533", Context.MODE_PRIVATE)
    private val serverId get() = requireNotNull(arguments.getString("gatewayServerId"))
    private val deviceId get() = requireNotNull(arguments.getString("gatewayDeviceId"))

    @Test fun aSeedInterruptedEditChain() = runBlocking {
        assumeTrue(arguments.containsKey("gatewayOrigin"))
        context.deleteDatabase(databaseName)
        preferences.edit().clear().commit()
        val db = Room.databaseBuilder(context, MobileLocalDatabase::class.java, databaseName).build()
        try {
            val dao = db.mobileDao()
            dao.upsertSyncState(SyncStateEntity(serverId = serverId, apiVersion = 1, schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
                cursor = null, lastSuccessfulSyncAt = Instant.now().toString(), lastAttemptAt = null, lastError = null))
            val outbox = MobileOutbox(context, dao, { deviceId }, schedule = {})
            val id = outbox.enqueueCreate("応答を失うCreate", draftId = "gateway-$serverId")
            val original = requireNotNull(dao.outbox(requireNotNull(dao.task(id)?.optimisticCommandId)))
            control("{\"dropNextReceipt\":true}")
            assertTrue(outbox.drain(serverId, ::send))
            assertEquals(1, snapshot().getValue("lostReceipts").jsonPrimitive.content.toInt())
            control("{\"offline\":true}")
            outbox.enqueueUpdateTitle(id, "PC停止中に直した原文")
            dao.upsertThemes(listOf(ThemeCacheEntity("theme-offline-fixture", "Offline fixture")))
            outbox.enqueueUpdateTheme(id, "theme-offline-fixture")
            outbox.enqueueUpdateTodayDate(id, LocalDate.parse("2026-09-08"))
            outbox.enqueueUpdateSchedule(id, MobileTaskScheduleDraft("2026-09-08", "2026-09-10", "once_within_window", "09:30", 45))
            val items = listOf(MobileChecklistItem("first", "資料を確認", false, 0.0, null), MobileChecklistItem("second", "結果を記録", false, 1.0, null))
            outbox.enqueueUpdateChecklist(id, items)
            outbox.enqueueUpdateChecklist(id, items.map { it.copy(done = true, completedAt = "2026-09-06T00:00:00Z") })
            outbox.enqueueComplete(id)
            assertEquals(original.envelopeJson, dao.outbox(original.commandId)?.envelopeJson)
            assertEquals("PC停止中に直した原文", dao.task(id)?.title)
            assertEquals(7, dao.outboxCount())
            assertTrue(preferences.edit().putString("taskId", id).putString("rootEnvelope", original.envelopeJson)
                .putString("rootCommandId", original.commandId).putInt("pid", Process.myPid()).commit())
        } finally { db.close() }
    }

    @Test fun bVerifyInterruptedEditChain() = runBlocking {
        assumeTrue(arguments.containsKey("gatewayOrigin"))
        val id = requireNotNull(preferences.getString("taskId", null))
        assertNotEquals(preferences.getInt("pid", -1), Process.myPid())
        val db = Room.databaseBuilder(context, MobileLocalDatabase::class.java, databaseName).build()
        try {
            val dao = db.mobileDao()
            val outbox = MobileOutbox(context, dao, { deviceId }, schedule = {})
            assertEquals("PC停止中に直した原文", dao.task(id)?.title)
            assertEquals("done", dao.task(id)?.state)
            control("{\"restartDesktop\":true,\"offline\":false}")
            outbox.recoverInterruptedSending()
            assertFalse(outbox.drain(serverId) { envelope ->
                runBlocking {
                    assertEquals("2026-09-10", dao.task(id)?.scheduleEndDate)
                    assertEquals("09:30", dao.task(id)?.plannedStartTime)
                    assertTrue(decodeMobileChecklist(requireNotNull(dao.task(id)).checklistJson).all { it.done })
                    assertEquals("done", dao.task(id)?.state)
                }
                send(envelope)
            })
            assertEquals(0, dao.outboxCount())
            val state = snapshot()
            val task = state.getValue("tasks").jsonArray.map { it.jsonObject }.single { it.getValue("id").jsonPrimitive.content == id }
            assertEquals("PC停止中に直した原文", task.getValue("title").jsonPrimitive.content)
            assertEquals("2026-09-08", task.getValue("today_date").jsonPrimitive.content)
            assertEquals("done", task.getValue("state").jsonPrimitive.content)
            assertEquals("theme-offline-fixture", task.getValue("project_id").jsonPrimitive.content)
            assertEquals(7, task.getValue("version").jsonPrimitive.content.toInt())
            assertEquals(7, dao.task(id)?.serverVersion)
            assertEquals("09:30", task.getValue("planned_start_time").jsonPrimitive.content)
            assertEquals(45, task.getValue("planned_duration_minutes").jsonPrimitive.content.toInt())
            assertEquals("2026-09-10", dao.task(id)?.scheduleEndDate)
            assertEquals(listOf("first", "second"), decodeMobileChecklist(requireNotNull(dao.task(id)).checklistJson).map { it.id })
            assertTrue(decodeMobileChecklist(requireNotNull(dao.task(id)).checklistJson).all { it.done })
            val seen = state.getValue("seenCommands").jsonArray.map { it.jsonObject }
                .filter { it.getValue("commandId").jsonPrimitive.content == preferences.getString("rootCommandId", null) }
            assertTrue(seen.size >= 2)
            assertTrue(seen.all { it == Json.parseToJsonElement(requireNotNull(preferences.getString("rootEnvelope", null))).jsonObject })
        } finally { db.close(); context.deleteDatabase(databaseName) }
    }

    @Test fun cDifferentFieldChangesComposeWithoutLosingDesktopDescription() = runBlocking {
        assumeTrue(arguments.containsKey("gatewayOrigin"))
        val db = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java).build()
        try {
            val dao = db.mobileDao()
            dao.upsertSyncState(SyncStateEntity(serverId = serverId, apiVersion = 1, schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
                cursor = null, lastSuccessfulSyncAt = Instant.now().toString(), lastAttemptAt = null, lastError = null))
            val outbox = MobileOutbox(context, dao, { deviceId }, schedule = {})
            val id = outbox.enqueueCreate("競合前の名前", draftId = "different-$serverId")
            assertFalse(outbox.drain(serverId, ::send))
            val root = outbox.enqueueUpdateTitle(id, "Androidの名前")
            outbox.enqueueComplete(id)
            control(buildJsonObject { put("editTask", buildJsonObject {
                put("id", JsonPrimitive(id)); put("changes", buildJsonObject { put("description", JsonPrimitive("Desktopだけの本文")) })
            }) }.toString())
            assertFalse(outbox.drain(serverId, ::send))
            assertNull(dao.conflict(root))
            assertEquals("Desktopだけの本文", dao.task(id)?.description)
            assertEquals(0, dao.outboxCount())
            val task = snapshot().getValue("tasks").jsonArray.map { it.jsonObject }.single { it.getValue("id").jsonPrimitive.content == id }
            assertEquals("Androidの名前", task.getValue("title").jsonPrimitive.content)
            assertEquals("Desktopだけの本文", task.getValue("description").jsonPrimitive.content)
            assertEquals("done", task.getValue("state").jsonPrimitive.content)
        } finally { db.close() }
    }

    @Test fun dSameFieldConflictKeepsBothNamesUntilExplicitDiscard() = runBlocking {
        assumeTrue(arguments.containsKey("gatewayOrigin"))
        val db = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java).build()
        try {
            val dao = db.mobileDao()
            dao.upsertSyncState(SyncStateEntity(serverId = serverId, apiVersion = 1, schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
                cursor = null, lastSuccessfulSyncAt = Instant.now().toString(), lastAttemptAt = null, lastError = null))
            val outbox = MobileOutbox(context, dao, { deviceId }, schedule = {})
            val id = outbox.enqueueCreate("同名競合前", draftId = "same-$serverId")
            assertFalse(outbox.drain(serverId, ::send))
            val root = outbox.enqueueUpdateTitle(id, "Androidで入力した名前")
            outbox.enqueueComplete(id)
            control(buildJsonObject { put("editTask", buildJsonObject {
                put("id", JsonPrimitive(id)); put("changes", buildJsonObject { put("title", JsonPrimitive("Desktopで入力した名前")) })
            }) }.toString())
            assertFalse(outbox.drain(serverId, ::send))
            assertEquals("Androidで入力した名前", dao.conflict(root)?.localTitle)
            assertEquals("Desktopで入力した名前", dao.task(id)?.title)
            assertEquals(OutboxState.Blocked, dao.taskDescendants(root).single().state)
            outbox.acceptServer(root)
            assertEquals(0, dao.outboxCount())
            assertEquals("Desktopで入力した名前", dao.task(id)?.title)
            assertEquals("todo", dao.task(id)?.state)
        } finally { db.close() }
    }

    @Test fun zCleanupFixtureData() {
        context.deleteDatabase(databaseName)
        assertTrue(preferences.edit().clear().commit())
    }

    private val client = MobileGatewayFixtureClient()
    private fun send(envelope: String) = client.send(envelope)
    private fun snapshot() = client.snapshot()
    private fun control(body: String?) = client.control(body)
}
