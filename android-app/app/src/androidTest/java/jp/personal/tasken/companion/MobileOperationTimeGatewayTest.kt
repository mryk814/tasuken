package jp.personal.tasken.companion

import android.content.Context
import android.os.Process
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.TimeZone
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/** The runner invokes a/b in separate Android processes against its isolated real Desktop. */
class MobileOperationTimeGatewayTest {
    private val gateway = MobileGatewayFixtureClient()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val prefix get() = "operation-time-538-${gateway.serverId}"
    private val databaseName get() = "$prefix.db"
    private val preferences get() = context.getSharedPreferences(prefix, Context.MODE_PRIVATE)
    private val operationAt = Instant.parse("2026-09-06T14:55:00Z")
    private val retryAt = Instant.parse("2026-09-08T03:00:00Z")
    private val checklist = listOf(MobileChecklistItem("operation-time-item", "日曜のチェック操作", false, 0.0))

    private fun open() = Room.databaseBuilder(context, MobileLocalDatabase::class.java, databaseName)
        .allowMainThreadQueries().build()

    @Test fun aSaveSundayOperationsBeforeProcessExit() = runBlocking {
        assumeTrue("Requires the isolated Gateway runner", gateway.available)
        check(context.packageName.endsWith(".debug"))
        check(!context.getDatabasePath(databaseName).exists()) { "Use a fresh runner fixture." }
        val previousZone = TimeZone.getDefault()
        TimeZone.setDefault(TimeZone.getTimeZone("Asia/Tokyo"))
        val db = open()
        try {
            assertEquals(LocalDate.parse("2026-09-06"), operationAt.atZone(ZoneId.systemDefault()).toLocalDate())
            assertEquals("23:55", operationAt.atZone(ZoneId.systemDefault()).toLocalTime().toString())
            val dao = db.mobileDao()
            dao.upsertSyncState(SyncStateEntity(serverId = gateway.serverId, apiVersion = 1,
                schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION, cursor = null,
                lastSuccessfulSyncAt = operationAt.toString(), lastAttemptAt = null, lastError = null))
            val seed = MobileOutbox(context, dao, { gateway.deviceId }, { operationAt.minusSeconds(3600) }, {})
            val taskId = seed.enqueueCreate("操作日の保持", checklistItems = checklist, draftId = "$prefix-task")
            assertFalse(seed.drain(gateway.serverId, gateway::send))

            val outbox = MobileOutbox(context, dao, { gateway.deviceId }, { operationAt }, {})
            val completeId = requireNotNull(outbox.enqueueComplete(taskId).commandId)
            gateway.control("{\"offline\":true}")
            assertTrue(outbox.drain(gateway.serverId, gateway::send))
            assertEquals(1, dao.outbox(completeId)?.attemptCount)
            val checkId = outbox.enqueueUpdateChecklist(taskId, checklist.map { it.copy(done = true, completedAt = operationAt.toString()) })
            val reopenId = requireNotNull(outbox.enqueueReopen(taskId).commandId)
            val uncheckId = outbox.enqueueUpdateChecklist(taskId, checklist)
            val captureId = outbox.enqueueCapture("日曜23:55の原文\n未解決のまま記録する。", draftId = "$prefix-capture", createdAt = operationAt.toString())
            val captureCommand = dao.outboxForCapture(captureId).single()
            val commands = listOf(completeId, checkId, reopenId, uncheckId).map { requireNotNull(dao.outbox(it)) } + captureCommand
            assertEquals(5, commands.size)
            assertTrue(commands.all { it.issuedAt == operationAt.toString() })
            assertEquals(listOf(completeId, checkId, reopenId), commands.take(4).drop(1).map { it.dependsOnCommandId })
            assertTrue(commands.drop(1).take(3).all { it.envelopeJson.isEmpty() && it.taskIntentJson != null })
            check(preferences.edit().putInt("pid", Process.myPid()).putString("taskId", taskId)
                .putString("captureId", captureId).putString("completeId", completeId).putString("checkId", checkId)
                .putString("commands", JsonArray(commands.map(::identity)).toString()).commit())
        } finally {
            db.close()
            TimeZone.setDefault(previousZone)
        }
    }

    @Test fun bReplayAcrossZoneAndDateChangeWithoutRestampingOperations() = runBlocking {
        assumeTrue("Requires the isolated Gateway runner", gateway.available)
        assertNotEquals(preferences.getInt("pid", Process.myPid()), Process.myPid())
        val previousZone = TimeZone.getDefault()
        TimeZone.setDefault(TimeZone.getTimeZone("Pacific/Kiritimati"))
        val db = open()
        try {
            // The very same Instant now falls on Monday locally; retries occur on Tuesday.
            assertEquals(LocalDate.parse("2026-09-07"), operationAt.atZone(ZoneId.systemDefault()).toLocalDate())
            assertEquals(LocalDate.parse("2026-09-08"), retryAt.atZone(ZoneId.systemDefault()).toLocalDate())
            val dao = db.mobileDao()
            val saved = Json.parseToJsonElement(requireNotNull(preferences.getString("commands", null))).jsonArray.map { it.jsonObject }
            for (original in saved) assertEquals(original, identity(requireNotNull(dao.outbox(original.text("commandId")))))
            val taskId = requireNotNull(preferences.getString("taskId", null))
            val captureId = requireNotNull(preferences.getString("captureId", null))
            val completeId = requireNotNull(preferences.getString("completeId", null))
            val checkId = requireNotNull(preferences.getString("checkId", null))
            val outbox = MobileOutbox(context, dao, { gateway.deviceId }, { retryAt }, {})
            outbox.recoverInterruptedSending()
            dropReceipt(completeId)
            assertTrue(outbox.drain(gateway.serverId, gateway::send))
            val completeEvent = operationEvents(gateway.snapshot(), completeId).single()
            assertOperationEvent(completeEvent, "task_completed")
            val completeReceipt = receipt(gateway.snapshot(), completeId)

            // Replaying the immutable parent materializes the child using its original Sunday time.
            gateway.control("{\"restartDesktop\":true}")
            dropReceipt(checkId)
            assertTrue(outbox.drain(gateway.serverId, gateway::send))
            val checked = requireNotNull(dao.outbox(checkId))
            assertEquals(operationAt.toString(), checked.issuedAt)
            assertEquals(operationAt.toString(), Json.parseToJsonElement(checked.envelopeJson).jsonObject.text("issuedAt"))
            val checkedEnvelope = checked.envelopeJson
            val checkedEvents = operationEvents(gateway.snapshot(), checkId)
            assertTrue(checkedEvents.any { it.text("event_kind") == "task_checklist_checked" })
            checkedEvents.filter { it.text("event_kind") == "task_checklist_checked" }.forEach { assertOperationEvent(it, "task_checklist_checked") }
            val checkReceipt = receipt(gateway.snapshot(), checkId)

            gateway.control("{\"restartDesktop\":true}")
            assertFalse(outbox.drain(gateway.serverId) { envelope ->
                val root = Json.parseToJsonElement(envelope).jsonObject
                assertEquals(operationAt.toString(), root.text("issuedAt"))
                if (root.text("commandId") == checkId) assertEquals(checkedEnvelope, envelope)
                gateway.send(envelope)
            })
            assertEquals(0, dao.outboxCount())
            assertEquals("todo", dao.task(taskId)?.state)
            assertFalse(decodeMobileChecklist(requireNotNull(dao.task(taskId)).checklistJson).single().done)
            val snapshot = gateway.snapshot()
            val commandIds = saved.map { it.text("commandId") }.toSet()
            val events = snapshot.getValue("events").jsonArray.map { it.jsonObject }
                .filter { it["command_id"]?.jsonPrimitive?.content in commandIds }
            val expectedKinds = setOf("task_completed", "task_reopened", "task_checklist_checked", "task_checklist_unchecked")
            assertTrue(events.toString(), events.map { it.text("event_kind") }.containsAll(expectedKinds))
            events.filter { it.text("event_kind") in expectedKinds }.forEach { assertOperationEvent(it, it.text("event_kind")) }
            val captureCommandId = saved.last().text("commandId")
            assertOperationEvent(operationEvents(snapshot, captureCommandId).single(), "entity_updated")
            assertEquals(completeEvent, operationEvents(snapshot, completeId).single())
            assertEquals(completeReceipt, receipt(snapshot, completeId))
            assertEquals(checkedEvents, operationEvents(snapshot, checkId))
            assertEquals(checkReceipt, receipt(snapshot, checkId))
            assertEquals(2, snapshot.getValue("lostReceipts").jsonPrimitive.content.toInt())
            val canonicalCapture = snapshot.getValue("captures").jsonArray.map { it.jsonObject }.single { it.text("id") == captureId }
            assertEquals(operationAt, Instant.parse(canonicalCapture.text("captured_at")))
            val seen = snapshot.getValue("seenCommands").jsonArray.map { it.jsonObject }.filter { it.text("commandId") in commandIds }
            for (original in saved) {
                val attempts = seen.filter { it.text("commandId") == original.text("commandId") }
                assertTrue(attempts.isNotEmpty())
                assertEquals(1, attempts.distinct().size)
                attempts.forEach { attempt ->
                    listOf("commandId", "requestId", "idempotencyKey", "clientDeviceId", "issuedAt").forEach { field ->
                        assertEquals(original.text(field), attempt.text(field))
                    }
                }
                assertEquals(1, snapshot.getValue("receipts").jsonArray.count { it.jsonObject.text("commandId") == original.text("commandId") })
            }
        } finally {
            db.close()
            TimeZone.setDefault(previousZone)
        }
    }

    @Test fun zCleanupOwnedFixture() {
        assumeTrue("Requires the isolated Gateway runner", gateway.available)
        if (context.getDatabasePath(databaseName).exists()) check(context.deleteDatabase(databaseName))
        check(preferences.edit().clear().commit())
    }

    private fun identity(command: OutboxCommandEntity) = buildJsonObject {
        put("commandId", JsonPrimitive(command.commandId)); put("requestId", JsonPrimitive(command.requestId))
        put("idempotencyKey", JsonPrimitive(command.idempotencyKey)); put("clientDeviceId", JsonPrimitive(command.clientDeviceId))
        put("issuedAt", JsonPrimitive(command.issuedAt)); put("envelope", JsonPrimitive(command.envelopeJson))
    }

    private fun dropReceipt(commandId: String) = gateway.control(buildJsonObject {
        put("offline", JsonPrimitive(false)); put("dropNextReceipt", JsonPrimitive(true)); put("dropCommandId", JsonPrimitive(commandId))
    }.toString())

    private fun operationEvents(snapshot: JsonObject, commandId: String) = snapshot.getValue("events").jsonArray
        .map { it.jsonObject }.filter { it["command_id"]?.jsonPrimitive?.content == commandId }

    private fun receipt(snapshot: JsonObject, commandId: String) = snapshot.getValue("receipts").jsonArray
        .single { it.jsonObject.text("commandId") == commandId }

    private fun assertOperationEvent(event: JsonObject, kind: String) {
        assertEquals(kind, event.text("event_kind"))
        assertEquals(operationAt, Instant.parse(event.text("occurred_at")))
        val metadata = event.getValue("metadata").jsonObject
        assertEquals(operationAt.toString(), metadata.text("operation_issued_at"))
        assertEquals("client_operation", metadata.text("time_basis"))
        assertEquals("unverified_client_clock", metadata.text("clock_status"))
        assertEquals(Instant.parse(event.text("changed_at")), Instant.parse(metadata.text("accepted_at")))
    }

    private fun JsonObject.text(key: String) = getValue(key).jsonPrimitive.content
}
