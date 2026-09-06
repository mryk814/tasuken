package jp.personal.tasken.companion

import android.content.Context
import android.content.ContextWrapper
import android.os.Process
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import java.time.Instant
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/** The existing runner force-stops Android between a/b and owns the real Desktop fixture. */
class MobileWorkLogGatewayTest {
    private val gateway = MobileGatewayFixtureClient()
    private val name get() = "work-log-540-${gateway.serverId}"
    private val context get() = object : ContextWrapper(InstrumentationRegistry.getInstrumentation().targetContext) {
        override fun getApplicationContext(): Context = this
        override fun getSharedPreferences(key: String, mode: Int) = super.getSharedPreferences("$name-$key", mode)
    }
    private val preferences get() = context.getSharedPreferences("phase", Context.MODE_PRIVATE)
    private val body = " \n測定条件を比較した。🔬\n" + "判断の根拠を残す。".repeat(1000) + "\n未解決の点もそのまま。  "
    private val at = "2026-09-06T23:55:00+09:00"
    private fun open() = Room.databaseBuilder(context, MobileLocalDatabase::class.java, "$name.db").build()

    @Test fun aSaveOfflineOriginalAndDateBeforeProcessExit() = runBlocking {
        assumeTrue(gateway.available)
        check(!context.getDatabasePath("$name.db").exists())
        val db = open()
        try {
            val dao = db.mobileDao()
            dao.upsertSyncState(SyncStateEntity(serverId = gateway.serverId, apiVersion = 1, schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
                cursor = null, lastSuccessfulSyncAt = at, lastAttemptAt = null, lastError = null))
            val themeId = gateway.snapshot().getValue("themes").jsonArray.first().jsonObject.getValue("id").jsonPrimitive.content
            val taskOutbox = MobileOutbox(context, dao, { gateway.deviceId }, schedule = {})
            val taskId = taskOutbox.enqueueCreate("作業記録に関連するTask", projectId = themeId)
            assertFalse(taskOutbox.drain(gateway.serverId, gateway::send))
            val draft = MobileWorkLogDraft(body = body, performedDate = "2026-09-05", enteredAt = at, themeId = themeId, taskId = taskId)
            assertTrue(MobileWorkLogDraftStore(context).save(draft))
            val workLogs = MobileWorkLogOutbox(dao, { gateway.deviceId }, {})
            gateway.control("{\"offline\":true}")
            assertEquals(draft.id, workLogs.record(draft))
            assertEquals(draft.id, workLogs.record(draft))
            assertTrue(taskOutbox.drain(gateway.serverId, gateway::send))
            assertEquals(body, dao.workLog(draft.id)?.body)
            assertEquals("2026-09-05", dao.workLog(draft.id)?.performedDate)
            assertEquals(1, dao.outboxCount())
            check(preferences.edit().putInt("pid", Process.myPid()).putString("draft", MobileWorkLogContract.json.encodeToString(draft))
                .putString("envelope", dao.outbox(draft.id)?.envelopeJson).commit())
        } finally { db.close() }
    }

    @Test fun bReplayLostReceiptThenDeleteAndRestoreCanonicalNote() = runBlocking {
        assumeTrue(gateway.available)
        assertNotEquals(preferences.getInt("pid", Process.myPid()), Process.myPid())
        val db = open()
        try {
            val dao = db.mobileDao()
            val draft = MobileWorkLogContract.json.decodeFromString<MobileWorkLogDraft>(requireNotNull(preferences.getString("draft", null)))
            val envelope = preferences.getString("envelope", null)
            assertEquals(draft, MobileWorkLogDraftStore(context).load())
            assertEquals(body, dao.workLog(draft.id)?.body)
            assertEquals("2026-09-05", dao.workLog(draft.id)?.performedDate)
            assertEquals(envelope, dao.outbox(draft.id)?.envelopeJson)
            val sender = MobileOutbox(context, dao, { gateway.deviceId }, now = { Instant.parse("2026-09-08T00:00:00Z") }, schedule = {})
            sender.recoverInterruptedSending()
            gateway.control("{\"offline\":false,\"dropNextReceipt\":true,\"dropCommandId\":\"${draft.id}\"}")
            assertTrue(sender.drain(gateway.serverId, gateway::send))
            assertEquals(1, gateway.snapshot().getValue("workLogs").jsonArray.size)
            gateway.control("{\"restartDesktop\":true}")
            assertFalse(sender.drain(gateway.serverId) { sent -> assertEquals(envelope, sent); gateway.send(sent) })
            val canonical = requireNotNull(gateway.workLog(draft.id))
            assertEquals(draft.id, canonical.id); assertEquals(body, canonical.body)
            assertEquals(draft.performedDate, canonical.performedDate); assertEquals(draft.enteredAt, canonical.enteredAt)
            assertEquals(draft.themeId, canonical.themeId); assertEquals(draft.taskId, canonical.taskId)
            assertEquals(canonical.version, dao.workLog(draft.id)?.serverVersion)
            assertEquals(0, dao.outboxCount())
            val snapshot = gateway.snapshot()
            assertEquals(1, snapshot.getValue("workLogs").jsonArray.size)
            assertEquals(1, snapshot.getValue("events").jsonArray.count { it.jsonObject["command_name"]?.jsonPrimitive?.content == "RecordWorkLog" })
            gateway.control("{\"deleteTask\":\"${draft.taskId}\"}")
            assertTrue(requireNotNull(gateway.workLog(draft.id)).taskMissing)
            assertEquals(body, requireNotNull(gateway.workLog(draft.id)).body)
            val workLogs = MobileWorkLogOutbox(dao, { gateway.deviceId }, {})
            workLogs.delete(draft.id)
            assertFalse(sender.drain(gateway.serverId, gateway::send))
            assertTrue(requireNotNull(dao.workLog(draft.id)).deleted)
            workLogs.restore(draft.id)
            assertFalse(sender.drain(gateway.serverId, gateway::send))
            assertFalse(requireNotNull(gateway.workLog(draft.id)).deleted)
            assertEquals(body, dao.workLog(draft.id)?.body)
            assertEquals(0, dao.outboxCount())
        } finally { db.close() }
    }

    @Test fun zCleanupOwnedFixture() {
        assumeTrue(gateway.available)
        if (context.getDatabasePath("$name.db").exists()) check(context.deleteDatabase("$name.db"))
        MobileWorkLogDraftStore(context).clear()
        preferences.edit().clear().commit()
    }
}
