package jp.personal.tasken.companion

import android.content.Context
import android.os.Process
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import java.time.Instant
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Uses the shared loopback Gateway/Core/SQLite fixture, never app pairing or production data. */
class MobileLongCaptureGatewayTest {
    private val gateway = MobileGatewayFixtureClient()
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val databaseName = "long-capture-live-535.db"
    private val preferences get() = context.getSharedPreferences("long-capture-live-535", Context.MODE_PRIVATE)
    private val suffix = "\n日本語と🔬 https://example.com/original\n末尾の空白  \n"
    private val text = " \n" + "記".repeat(12000 - 2 - suffix.length) + suffix

    @Test
    fun seedOfflineCapture() = runBlocking {
        assumeTrue(gateway.available)
        context.deleteDatabase(databaseName)
        val database = Room.databaseBuilder(context, MobileLocalDatabase::class.java, databaseName).build()
        try {
            val dao = database.mobileDao()
            dao.upsertSyncState(SyncStateEntity(serverId = gateway.serverId, apiVersion = 1,
                schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION, cursor = null,
                lastSuccessfulSyncAt = Instant.now().toString(), lastAttemptAt = null, lastError = null))
            val outbox = MobileOutbox(context, dao, { gateway.deviceId }, schedule = {})
            gateway.control("{\"offline\":true}")
            assertEquals(12000, text.length)
            val id = outbox.enqueueCapture(text, draftId = "long-${gateway.serverId}")
            val command = dao.outboxForCapture(id).single()
            assertTrue(outbox.drain(gateway.serverId, gateway::send))
            assertTrue(gateway.snapshot().getValue("captures").jsonArray.isEmpty())
            assertEquals(text, dao.observePendingCaptures().first().single().toPendingCapture()?.text)
            assertTrue(preferences.edit().putString("captureId", id).putString("commandId", command.commandId)
                .putString("envelope", command.envelopeJson).putInt("pid", Process.myPid()).commit())
        } finally { database.close() }
    }

    @Test
    fun verifyAfterProcessExitAndDesktopRestart() = runBlocking {
        assumeTrue(gateway.available)
        assertNotEquals(preferences.getInt("pid", -1), Process.myPid())
        val id = requireNotNull(preferences.getString("captureId", null))
        val commandId = requireNotNull(preferences.getString("commandId", null))
        val envelope = requireNotNull(preferences.getString("envelope", null))
        val database = Room.databaseBuilder(context, MobileLocalDatabase::class.java, databaseName).build()
        try {
            val dao = database.mobileDao()
            val outbox = MobileOutbox(context, dao, { gateway.deviceId }, schedule = {})
            assertEquals(text, dao.observePendingCaptures().first().single().toPendingCapture()?.text)
            assertEquals(envelope, dao.outbox(commandId)?.envelopeJson)
            gateway.control("{\"offline\":false,\"dropNextReceipt\":true}")
            assertTrue(outbox.drain(gateway.serverId, gateway::send))
            assertEquals(text, capture(gateway.snapshot(), id).getValue("text").jsonPrimitive.content)
            assertEquals(envelope, dao.outbox(commandId)?.envelopeJson)
            gateway.control("{\"restartDesktop\":true}")
            assertFalse(outbox.drain(gateway.serverId, gateway::send))
            assertEquals(0, dao.outboxCount())
            assertEquals(1, dao.captureReceipt(id)?.serverVersion)
            val created = gateway.snapshot()
            assertEquals(text, capture(created, id).getValue("text").jsonPrimitive.content)
            assertEquals(1, events(created, commandId).size)
            assertTrue(events(created, commandId).single().getValue("receipt_json").jsonPrimitive.content.isNotBlank())
            val replayed = created.getValue("seenCommands").jsonArray.map { it.jsonObject }
                .filter { it.getValue("commandId").jsonPrimitive.content == commandId }
            assertTrue(replayed.size >= 2)
            assertTrue(replayed.all { it == Json.parseToJsonElement(envelope).jsonObject })

            val undo = outbox.undoCapture(id)
            assertEquals(undo.commandId, outbox.undoCapture(id).commandId)
            gateway.control("{\"dropNextReceipt\":true}")
            assertTrue(outbox.drain(gateway.serverId, gateway::send))
            gateway.control("{\"restartDesktop\":true}")
            assertFalse(outbox.drain(gateway.serverId, gateway::send))
            assertEquals(0, dao.outboxCount())
            assertEquals(null, dao.captureReceipt(id))
            val deleted = gateway.snapshot()
            assertEquals(1, deleted.getValue("captures").jsonArray.size)
            assertEquals(text, capture(deleted, id).getValue("text").jsonPrimitive.content)
            assertEquals("2", capture(deleted, id).getValue("version").jsonPrimitive.content)
            assertTrue(capture(deleted, id).getValue("deleted_at").jsonPrimitive.content.isNotBlank())
            assertEquals(1, events(deleted, commandId).size)
            assertEquals(1, events(deleted, requireNotNull(undo.commandId)).size)
            assertEquals("2", deleted.getValue("lostReceipts").jsonPrimitive.content)
        } finally { database.close() }
    }

    @Test
    fun cleanup() {
        assumeTrue(gateway.available)
        context.deleteDatabase(databaseName)
        assertTrue(preferences.edit().clear().commit())
    }

    private fun capture(state: JsonObject, id: String) = state.getValue("captures").jsonArray.map { it.jsonObject }
        .single { it.getValue("id").jsonPrimitive.content == id }

    private fun events(state: JsonObject, commandId: String) = state.getValue("events").jsonArray.map { it.jsonObject }
        .filter { it["command_id"]?.jsonPrimitive?.content == commandId }
}
