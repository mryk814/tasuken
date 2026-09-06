package jp.personal.tasken.companion

import android.content.Context
import android.os.Process
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/** The runner starts each phase in a new Android process against an isolated real Gateway. */
class MobileRelatedDocumentsGatewayTest {
    private val gateway = MobileGatewayFixtureClient()
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val name get() = "related-550-${gateway.serverId}"
    private val preferences get() = context.getSharedPreferences(name, Context.MODE_PRIVATE)
    private val taskId = "related-fixture-task"
    private fun open() = Room.databaseBuilder(context, MobileLocalDatabase::class.java, "$name.db").build()

    @Test fun aFetchActualPagesAndSelectedBodies() = runBlocking {
        assumeTrue(gateway.available)
        check(!context.getDatabasePath("$name.db").exists())
        gateway.control("{\"seedRelatedDocuments\":true}")
        val db = open()
        try {
            val dao = db.mobileDao()
            dao.upsertSyncState(SyncStateEntity(serverId = gateway.serverId, apiVersion = 1, schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
                cursor = null, lastSuccessfulSyncAt = "2026-09-06T08:00:00Z", lastAttemptAt = null, lastError = null))
            val reader = MobileRelatedDocumentsReader(dao, gateway::read)
            reader.refresh(taskId, false)
            assertEquals(reader.observe(taskId).first().error, 50, reader.observe(taskId).first().documents.size)
            assertTrue(reader.observe(taskId).first().bodies.isEmpty())
            reader.refresh(taskId, true)
            assertEquals(52, reader.observe(taskId).first().documents.size)
            reader.load(taskId, "note", "related-note-00")
            reader.load(taskId, "capture_entry", "related-source-capture")
            val bodies = reader.observe(taskId).first().bodies
            assertEquals(2, bodies.size)
            assertTrue(bodies.first { it.type == "note" }.document.truncated)
            assertTrue(bodies.first { it.type == "note" }.document.body.length <= 50000)
            assertEquals("Taskの作成元の原文", bodies.first { it.type == "capture_entry" }.document.body)
            assertTrue(preferences.edit().putInt("pid", Process.myPid()).commit())
        } finally { db.close() }
    }

    @Test fun bReadAfterAndroidRestartWhilePcOffline() = runBlocking {
        assumeTrue(gateway.available)
        assertNotEquals(preferences.getInt("pid", -1), Process.myPid())
        gateway.control("{\"offline\":true}")
        val db = open()
        try {
            val reader = MobileRelatedDocumentsReader(db.mobileDao(), gateway::read)
            reader.refresh(taskId, false)
            reader.load(taskId, "note", "related-note-01")
            val state = reader.observe(taskId).first()
            assertEquals(52, state.documents.size); assertEquals(2, state.bodies.size)
            assertNotNull(state.fetchedAt); assertNotNull(state.error)
            assertFalse(state.bodies.any { it.id == "related-note-01" })
        } finally { db.close() }
    }

    @Test fun cReceiveDeletionAfterPcRestart() = runBlocking {
        assumeTrue(gateway.available)
        gateway.control("{\"offline\":false,\"restartDesktop\":true}")
        gateway.control("{\"removeRelatedDocument\":true}")
        val db = open()
        try {
            val reader = MobileRelatedDocumentsReader(db.mobileDao(), gateway::read)
            reader.load(taskId, "note", "related-note-00")
            val state = reader.observe(taskId).first()
            assertFalse(state.bodies.any { it.id == "related-note-00" })
            assertFalse(state.documents.any { it.id == "related-note-00" })
            assertTrue(state.bodies.any { it.type == "capture_entry" })
        } finally { db.close() }
    }

    @Test fun zCleanupOwnedFixture() {
        assumeTrue(gateway.available)
        context.deleteDatabase("$name.db")
        context.deleteSharedPreferences(name)
    }
}
