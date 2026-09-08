package jp.personal.tasken.companion

import android.content.Context
import android.content.ContextWrapper
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class MobileLocalSearchAccessTest {
    private val server = "search-access-server"
    private val at = "2026-09-08T08:00:00Z"
    private fun isolatedContext(prefix: String) = object : ContextWrapper(InstrumentationRegistry.getInstrumentation().targetContext) {
        override fun getApplicationContext(): Context = this
        override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("$prefix-$name", mode)
    }
    private fun denial(status: Int, serverId: String = server) = GatewayHttpResponse(status,
        """{"ok":false,"meta":{"apiVersion":1,"schemaVersion":$TASKEN_MOBILE_SCHEMA_VERSION,"serverId":"$serverId","serverRevision":1,"generatedAt":"$at","truncated":false},"error":{"code":"${if (status == 401) "unauthorized" else "forbidden"}","message":"Read revoked","retryable":false}}""")

    @Test fun confirmedReadRevocationSurvivesReopenWithoutDeletingTasksOrPendingOriginals() = runBlocking {
        for (status in listOf(401, 403)) {
            val name = "search-access-${UUID.randomUUID()}"
            val context = isolatedContext(name)
            var db = Room.databaseBuilder(context, MobileLocalDatabase::class.java, "$name.db").build()
            var store = MobileGatewayConnectionStore(context)
            try {
                store.save("https://gateway.test", "t".repeat(43), setOf("mobile:read"))
                val dao = db.mobileDao()
                dao.upsertSyncState(SyncStateEntity(serverId = server, apiVersion = 1, schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
                    cursor = null, lastSuccessfulSyncAt = at, lastAttemptAt = at, lastError = null))
                dao.upsertTask(TaskCacheEntity("task", 1, "原文のTask", null, "todo", null, null, at, null))
                dao.upsertRecallCapture(RecallCaptureCacheEntity(server, "capture", "command", "未同期の原文", at))
                dao.insertOutbox(OutboxCommandEntity("command", "key", "request", "device", at, "CreateCapture", "保存済みの原文envelope",
                    server, OutboxState.Pending, 0, at, null, null, captureId = "capture"))
                var repository = AndroidMobileTaskRepository(context, store, db, scheduleOutboxOnStart = false,
                    httpClient = MobileGatewayHttpClient { _, _, _, _, _ -> denial(status) })
                assertEquals(2, repository.observeLocalSearch(MobileLocalSearchRequest("原文")).first().total)
                repository.refreshThemeContext("theme")
                assertFalse(store.configuration().paired)
                val revoked = repository.observeLocalSearch(MobileLocalSearchRequest("原文")).first()
                assertNotNull(revoked.error); assertTrue(revoked.hits.isEmpty())
                db.close()
                db = Room.databaseBuilder(context, MobileLocalDatabase::class.java, "$name.db").build()
                store = MobileGatewayConnectionStore(context)
                repository = AndroidMobileTaskRepository(context, store, db, scheduleOutboxOnStart = false)
                assertNotNull(repository.observeLocalSearch(MobileLocalSearchRequest("原文")).first().error)
                assertNotNull(db.mobileDao().task("task"))
                assertEquals("未同期の原文", db.localSearchDao().capture(server, "capture")!!.body)
                assertEquals("保存済みの原文envelope", db.mobileDao().outbox("command")!!.envelopeJson)
                store.save("https://gateway.test", "r".repeat(43), setOf("mobile:read"))
                assertEquals(2, repository.observeLocalSearch(MobileLocalSearchRequest("原文")).first().total)
            } finally {
                store.clearToken(); db.close(); context.deleteDatabase("$name.db")
                context.deleteSharedPreferences("$name-tasken_mobile_gateway")
            }
        }
    }

    @Test fun proxyOrOtherServerUnauthorizedDoesNotRevokeCurrentReadAccess() = runBlocking {
        val context = isolatedContext("search-access-${UUID.randomUUID()}")
        val db = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java).build()
        val store = MobileGatewayConnectionStore(context)
        try {
            store.save("https://gateway.test", "t".repeat(43), setOf("mobile:read"))
            db.mobileDao().upsertSyncState(SyncStateEntity(serverId = server, apiVersion = 1, schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
                cursor = null, lastSuccessfulSyncAt = at, lastAttemptAt = at, lastError = null))
            var response = GatewayHttpResponse(401, "proxy authentication required")
            val repository = AndroidMobileTaskRepository(context, store, db, scheduleOutboxOnStart = false,
                httpClient = MobileGatewayHttpClient { _, _, _, _, _ -> response })
            repository.refreshThemeContext("theme")
            assertTrue(store.observeOwnerReadAccess().first())
            response = denial(401, "other-server")
            repository.refreshThemeContext("theme")
            assertTrue(store.observeOwnerReadAccess().first())
        } finally { store.clearToken(); db.close() }
    }
}
