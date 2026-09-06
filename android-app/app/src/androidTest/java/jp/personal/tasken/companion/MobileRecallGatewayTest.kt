package jp.personal.tasken.companion

import android.content.Context
import android.content.ContextWrapper
import android.os.Process
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Real Mobile HTTP -> shared recall query -> SQLite, with process death between a and b. */
class MobileRecallGatewayTest {
    private val gateway = MobileGatewayFixtureClient()
    private val name get() = "recall-549-${gateway.serverId}"
    private val context get() = object : ContextWrapper(InstrumentationRegistry.getInstrumentation().targetContext) {
        override fun getApplicationContext(): Context = this
        override fun getSharedPreferences(key: String, mode: Int) = super.getSharedPreferences("$name-$key", mode)
    }
    private val preferences get() = context.getSharedPreferences("phase", Context.MODE_PRIVATE)
    private val date = LocalDate.parse("2026-09-06")
    private val zone = ZoneId.of("Asia/Tokyo")
    private val at = "2026-09-05T16:10:00Z"
    private fun open() = Room.databaseBuilder(context, MobileLocalDatabase::class.java, "$name.db").build()

    @Test fun cReadActualEmptyResponseContract() = runBlocking {
        assumeTrue(gateway.available)
        val response = gateway.read("/v1/activity?apiVersion=1&schemaVersion=$TASKEN_MOBILE_SCHEMA_VERSION&requestId=wire-probe&date=$date&timezone=Asia%2FTokyo&limit=500")
        assertEquals(response.body.take(1000), 200, response.status)
        MobileRecallContract.decode(response.body, gateway.serverId, date, zone)
        val db = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java).build()
        try {
            val dao = db.mobileDao()
            dao.upsertSyncState(SyncStateEntity(serverId = gateway.serverId, apiVersion = 1, schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
                cursor = null, lastSuccessfulSyncAt = at, lastAttemptAt = null, lastError = null))
            val reader = MobileRecallReader(dao, gateway::read)
            reader.refresh(date, zone, false)
            val day = reader.observe(date, zone).first()
            assertNotNull(day.error, day.lastFetchedAt)
            assertTrue(day.rows.isEmpty())
            assertFalse(day.partial)
        } finally { db.close() }
    }

    @Test fun aSaveOfflineThenCacheMoreThan500RealRecallRowsBeforeProcessExit() = runBlocking {
        assumeTrue(gateway.available)
        check(!context.getDatabasePath("$name.db").exists())
        val db = open()
        try {
            val dao = db.mobileDao()
            dao.upsertSyncState(SyncStateEntity(serverId = gateway.serverId, apiVersion = 1, schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
                cursor = null, lastSuccessfulSyncAt = at, lastAttemptAt = null, lastError = null))
            val outbox = MobileOutbox(context, dao, { gateway.deviceId }, now = { Instant.parse(at) }, schedule = {})
            val workLogs = MobileWorkLogOutbox(dao, { gateway.deviceId }, {})
            val workLogId = workLogs.record(MobileWorkLogDraft(body = "Task以外の比較検討。原文を保持🔬", performedDate = date.toString(), enteredAt = at))
            val yesterdayId = workLogs.record(MobileWorkLogDraft(body = "前日に実施した検討", performedDate = date.minusDays(1).toString(), enteredAt = at))
            val captureId = outbox.enqueueCapture("  夜間の測定メモ\n🔬  ", createdAt = at)
            val reader = MobileRecallReader(dao, gateway::read)
            gateway.control("{\"offline\":true}")
            reader.refresh(date, zone, false)
            assertEquals(2, reader.observe(date, zone).first().rows.size)
            assertNull(reader.observe(date, zone).first().lastFetchedAt)
            gateway.control("{\"offline\":false}")
            val taskId = outbox.enqueueCreate("完了操作を作業記録と区別するTask")
            assertFalse(outbox.drain(gateway.serverId) { envelope ->
                gateway.send(envelope).also { result -> check(result !is MobileCommandSendResult.Retry) { result.toString() } }
            })
            outbox.enqueueComplete(taskId)
            repeat(500) { index -> outbox.enqueueCapture("500件を超える続きの記録 $index", createdAt = at) }
            val needsRetry = outbox.drain(gateway.serverId) { envelope ->
                // Honor the real Host's 120 requests/minute limit while preparing the 500+ page fixture.
                Thread.sleep(600)
                gateway.send(envelope).also { result -> check(result !is MobileCommandSendResult.Retry) { result.toString() } }
            }
            assertFalse(dao.observePendingCaptures().first().filter { it.lastError != null }.map { it.lastError }.toString(), needsRetry)
            assertEquals(0, dao.outboxCount())
            // Receipt has arrived but no recall query has: local sources remain visible.
            assertEquals(502, reader.observe(date, zone).first().rows.size)
            reader.refresh(date, zone, false)
            val partial = reader.observe(date, zone).first()
            assertNotNull(partial.lastFetchedAt); assertTrue(partial.partial); assertTrue(partial.hasNextPage)
            assertEquals(partial.rows.size, partial.rows.map { it.id }.distinct().size)
            reader.refresh(date, zone, true)
            val complete = reader.observe(date, zone).first()
            assertNull(complete.error); assertFalse(complete.partial); assertTrue(complete.rows.size > 500)
            assertEquals(1, complete.rows.count { it.source.type == "work_log" && it.source.id == workLogId })
            assertEquals(1, complete.rows.count { it.source.type == "capture_entry" && it.source.id == captureId })
            assertTrue(complete.rows.any { it.stage == "Task完了" && it.source.id == taskId })
            assertEquals("  夜間の測定メモ\n🔬  ", complete.rows.first { it.source.id == captureId }.capture?.text)
            reader.refresh(date.minusDays(1), zone, false)
            assertEquals(listOf(yesterdayId), reader.observe(date.minusDays(1), zone).first().rows.map { it.source.id })
            assertTrue(preferences.edit().putInt("pid", Process.myPid()).putInt("count", complete.rows.size)
                .putString("captureId", captureId).putString("workLogId", workLogId).commit())
            gateway.control("{\"offline\":true}")
            Unit
        } finally { db.close() }
    }

    @Test fun bReadAfterAndroidRestartAndPcStopThenFetchAnotherTimezoneAndDeleteCapture() = runBlocking {
        assumeTrue(gateway.available)
        assertNotEquals(preferences.getInt("pid", Process.myPid()), Process.myPid())
        val db = open()
        try {
            val dao = db.mobileDao()
            val reader = MobileRecallReader(dao, gateway::read)
            val count = preferences.getInt("count", -1)
            assertEquals(count, reader.observe(date, zone).first().rows.size)
            reader.refresh(date, zone, false)
            val offline = reader.observe(date, zone).first()
            assertEquals(count, offline.rows.size); assertNotNull(offline.error); assertNotNull(offline.lastFetchedAt)
            gateway.control("{\"offline\":false,\"restartDesktop\":true}")
            val pacific = ZoneId.of("America/Los_Angeles")
            val previousDate = date.minusDays(1)
            reader.refresh(previousDate, pacific, false)
            assertTrue(reader.observe(previousDate, pacific).first().hasNextPage)
            reader.refresh(previousDate, pacific, true)
            val shifted = reader.observe(previousDate, pacific).first()
            assertNull(shifted.error); assertFalse(shifted.partial)
            val captureId = requireNotNull(preferences.getString("captureId", null))
            assertTrue(shifted.rows.any { it.source.id == captureId && it.date == previousDate.toString() })
            assertFalse(shifted.rows.any { it.source.id == preferences.getString("workLogId", null) })
            assertEquals(count, reader.observe(date, zone).first().rows.size)
            val outbox = MobileOutbox(context, dao, { gateway.deviceId }, now = { Instant.parse("2026-09-07T00:00:00Z") }, schedule = {})
            outbox.undoCapture(captureId)
            assertFalse(outbox.drain(gateway.serverId, gateway::send))
            assertFalse(dao.observeRecallCaptures().first().any { it.id == captureId })
        } finally { db.close() }
    }

    @Test fun zCleanupOwnedFixture() {
        assumeTrue(gateway.available)
        if (context.getDatabasePath("$name.db").exists()) check(context.deleteDatabase("$name.db"))
        preferences.edit().clear().commit()
    }
}
