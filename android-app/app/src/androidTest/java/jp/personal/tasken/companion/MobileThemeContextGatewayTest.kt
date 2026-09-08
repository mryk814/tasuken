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

/** Run the phases separately against the explicitly supplied isolated Gateway. */
class MobileThemeContextGatewayTest {
    private val gateway = MobileGatewayFixtureClient()
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val name get() = "theme-551-${gateway.serverId}"
    private val preferences get() = context.getSharedPreferences(name, Context.MODE_PRIVATE)
    private val themeId = "theme-context-fixture"
    private fun open() = Room.databaseBuilder(context, MobileLocalDatabase::class.java, "$name.db").build()

    @Test fun aFetchDesktopUpdate() = runBlocking {
        assumeTrue(gateway.available)
        check(!context.getDatabasePath("$name.db").exists())
        gateway.control("{\"themeContextPhase\":\"initial\"}")
        val db = open()
        try {
            db.mobileDao().upsertSyncState(SyncStateEntity(serverId = gateway.serverId, apiVersion = 1,
                schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION, cursor = null, lastSuccessfulSyncAt = null,
                lastAttemptAt = null, lastError = null))
            val reader = MobileThemeContextReader(db.mobileDao(), gateway::read)
            reader.refresh(themeId)
            assertEquals(ThemeContextContent.Available, reader.observe(themeId).first().content)
            assertNotNull(reader.observe(themeId).first().theme!!.charter)
            gateway.control("{\"themeContextPhase\":\"updated\"}")
            reader.refresh(themeId)
            assertEquals("濃度と温度を分けて再測定する。", reader.observe(themeId).first().theme!!.currentState!!.current_direction)
            assertTrue(preferences.edit().putInt("pid", Process.myPid()).commit())
        } finally { db.close() }
    }

    @Test fun bReadAfterAndroidRestartWhilePcOffline() = runBlocking {
        assumeTrue(gateway.available)
        assertNotEquals(preferences.getInt("pid", -1), Process.myPid())
        gateway.control("{\"offline\":true}")
        val db = open()
        try {
            val reader = MobileThemeContextReader(db.mobileDao(), gateway::read)
            reader.refresh(themeId)
            val state = reader.observe(themeId).first()
            assertEquals("濃度と温度を分けて再測定する。", state.theme!!.currentState!!.current_direction)
            assertNotNull(state.fetchedAt)
            assertEquals(ThemeContextFailure.Offline, state.failure)
        } finally { db.close() }
    }

    @Test fun cReceiveDeletionAfterPcRestart() = runBlocking {
        assumeTrue(gateway.available)
        gateway.control("{\"offline\":false,\"restartDesktop\":true}")
        val db = open()
        try {
            val reader = MobileThemeContextReader(db.mobileDao(), gateway::read)
            reader.refresh(themeId)
            assertNull(reader.observe(themeId).first().failure)
            assertEquals("濃度と温度を分けて再測定する。", reader.observe(themeId).first().theme!!.currentState!!.current_direction)
            gateway.control("{\"themeContextPhase\":\"deleted\"}")
            reader.refresh(themeId)
            assertEquals(ThemeContextContent.Missing, reader.observe(themeId).first().content)
            assertNull(reader.observe(themeId).first().theme)
        } finally { db.close() }
    }

    @Test fun zCleanupOwnedFixture() {
        assumeTrue(gateway.available)
        context.deleteDatabase("$name.db")
        context.deleteSharedPreferences(name)
    }
}
