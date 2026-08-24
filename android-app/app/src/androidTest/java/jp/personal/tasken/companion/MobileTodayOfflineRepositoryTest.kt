package jp.personal.tasken.companion

import android.content.Context
import android.content.ContextWrapper
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.IOException
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MobileTodayOfflineRepositoryTest {
    private lateinit var context: Context
    private lateinit var database: MobileLocalDatabase
    private lateinit var dao: MobileLocalDao
    private lateinit var store: MobileGatewayConnectionStore

    @Before
    fun setUp() {
        val testContext = InstrumentationRegistry.getInstrumentation().context
        context = object : ContextWrapper(testContext) {
            override fun getApplicationContext(): Context = this
        }
        database = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        dao = database.mobileDao()
        store = MobileGatewayConnectionStore(context)
        store.clearToken()
        store.save("https://gateway.test", "t".repeat(43))
    }

    @After
    fun tearDown() {
        store.clearToken()
        database.close()
    }

    @Test
    fun previouslySyncedEmptyTodayRemainsAvailableWhenGatewayIsOffline() = runBlocking {
        dao.upsertSyncState(
            SyncStateEntity(
                serverId = "server-1",
                apiVersion = 1,
                schemaVersion = 4,
                cursor = "cursor-1",
                lastSuccessfulSyncAt = "2026-08-24T01:00:00Z",
                lastAttemptAt = "2026-08-24T01:00:00Z",
                lastError = null,
            ),
        )

        val result = offlineRepository().loadToday()

        assertTrue(result is MobileTodayResult.Available)
        result as MobileTodayResult.Available
        assertTrue(result.tasks.isEmpty())
        assertEquals("2026-08-24T01:00:00Z", result.generatedAt)
    }

    @Test
    fun unsyncedEmptyTodayStillReportsGatewayUnavailable() {
        val result = offlineRepository().loadToday()

        assertTrue(result is MobileTodayResult.Unavailable)
    }

    private fun offlineRepository() = AndroidMobileTaskRepository(
        context = context,
        store = store,
        database = database,
        scheduleOutboxOnStart = false,
        httpClient = MobileGatewayHttpClient { _, _, _, _, _ ->
            throw IOException("offline")
        },
    )
}
