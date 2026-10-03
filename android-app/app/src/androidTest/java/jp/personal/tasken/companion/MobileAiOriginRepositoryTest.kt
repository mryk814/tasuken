package jp.personal.tasken.companion

import android.content.Context
import android.content.ContextWrapper
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import java.time.LocalDate
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class MobileAiOriginRepositoryTest {
    @Test fun bootstrapSyncCacheReopenAndSeenProjectionPreserveState() = runBlocking {
        val context = object : ContextWrapper(InstrumentationRegistry.getInstrumentation().targetContext) {
            override fun getApplicationContext(): Context = this
        }
        val name = "ai-origin-${UUID.randomUUID()}.db"
        val store = MobileGatewayConnectionStore(context)
        store.clearToken(); store.save("https://gateway.test", "t".repeat(43))
        var seen = false
        val receivedAt = "2026-10-03T08:00:00Z"
        val client = MobileGatewayHttpClient { _, path, _, _, _ ->
            val meta = """{"apiVersion":1,"schemaVersion":$TASKEN_MOBILE_SCHEMA_VERSION,"serverId":"origin-server","serverRevision":2,"generatedAt":"$receivedAt","truncated":false}"""
            val task = """{"id":"origin-task","version":${if (seen) 2 else 1},"title":"条件を確認する","themeId":null,"state":"todo","workState":"not_delegated","todayDate":"${LocalDate.now()}","schedule":null,"updatedAt":"$receivedAt","aiOrigin":{"caller":"Codex","receivedAt":"$receivedAt","seenAt":${if (seen) "\"2026-10-03T09:00:00Z\"" else "null"}}}"""
            val data = when {
                path.startsWith("/v1/bootstrap") -> """{"tasks":[$task],"nextCursor":"origin-cursor","hasMore":false}"""
                path.startsWith("/v1/sync") -> """{"changes":[{"kind":"upsert","task":$task}],"nextCursor":"origin-cursor","hasMore":false}"""
                else -> """{"themes":[],"nextCursor":null}"""
            }
            GatewayHttpResponse(200, """{"ok":true,"meta":$meta,"data":$data}""")
        }
        var db = Room.databaseBuilder(context, MobileLocalDatabase::class.java, name).build()
        try {
            fun repository() = AndroidMobileTaskRepository(context, store, db, scheduleOutboxOnStart = false, httpClient = client)
            var repo = repository()
            assertTrue(repo.loadToday() is MobileTodayResult.Available)
            val task = repo.observeCachedTasks().first().single()
            assertEquals(MobileAiOrigin("Codex", receivedAt), task.aiOrigin)
            assertEquals("todo", task.state)
            db.close()
            db = Room.databaseBuilder(context, MobileLocalDatabase::class.java, name).build()
            repo = repository()
            assertEquals(task.aiOrigin, repo.observeCachedTasks().first().single().aiOrigin)
            seen = true
            assertTrue(repo.loadToday() is MobileTodayResult.Available)
            val updated = repo.observeCachedTasks().first().single()
            assertEquals("2026-10-03T09:00:00Z", updated.aiOrigin?.seenAt)
            assertEquals(task.state, updated.state)
            assertEquals(task.workState, updated.workState)
            assertEquals(0, db.mobileDao().outboxCount())
        } finally { db.close(); store.clearToken(); context.deleteDatabase(name) }
    }
}
