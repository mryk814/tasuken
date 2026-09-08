package jp.personal.tasken.companion

import android.content.Context
import android.content.ContextWrapper
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.IOException
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.first
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
    fun previouslySyncedEmptyTodayRetainsCacheWithoutReportingConnectionSuccess() = runBlocking {
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

        val repository = offlineRepository()
        val result = repository.loadToday()

        assertTrue(result is MobileTodayResult.Unavailable)
        val cache = repository.observeTodayCache(java.time.LocalDate.now()).first()
        assertTrue(cache.tasks.isEmpty())
        assertEquals("2026-08-24T01:00:00Z", cache.lastSuccessfulSyncAt)
    }

    @Test
    fun unsyncedEmptyTodayStillReportsGatewayUnavailable() {
        val result = offlineRepository().loadToday()

        assertTrue(result is MobileTodayResult.Unavailable)
    }

    @Test
    fun confirmedUnauthorizedRequiresPairingAndRetainsSyncHistory() = runBlocking {
        dao.upsertSyncState(SyncStateEntity(
            serverId = "server-1", apiVersion = 1, schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
            cursor = "cursor-1", lastSuccessfulSyncAt = "2026-09-06T00:00:00Z",
            lastAttemptAt = "2026-09-06T00:00:00Z", lastError = null,
        ))
        dao.upsertRelatedDocuments(RelatedDocumentCacheEntity("server-1", "task", "{}"))
        dao.upsertRelatedBodies(listOf(RelatedBodyCacheEntity("server-1", "task", "note", "note", "cached text")))
        dao.upsertThemeContext(ThemeContextCacheEntity("server-1", "theme", "cached theme"))
        val repository = AndroidMobileTaskRepository(
            context, store, database, scheduleOutboxOnStart = false,
            httpClient = MobileGatewayHttpClient { _, _, _, _, _ -> GatewayHttpResponse(401,
                """{"ok":false,"meta":{"apiVersion":1,"schemaVersion":$TASKEN_MOBILE_SCHEMA_VERSION,"serverId":"server-1","serverRevision":1,"generatedAt":"2026-09-06T00:00:00Z","truncated":false},"error":{"code":"unauthorized","message":"Token expired","retryable":false}}""",
            ) },
        )
        assertTrue(repository.loadToday() is MobileTodayResult.PairingRequired)
        assertTrue(dao.relatedDocuments("server-1", "task") == null)
        assertTrue(dao.relatedBodies("server-1", "task").isEmpty())
        assertTrue(dao.themeContext("server-1", "theme") == null)
        assertEquals("2026-09-06T00:00:00Z", repository.observeTodayCache(java.time.LocalDate.now()).first().lastSuccessfulSyncAt)
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
