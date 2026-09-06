package jp.personal.tasken.companion

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.async
import kotlinx.coroutines.CompletableDeferred
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class MobileRelatedDocumentsDatabaseTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val json = Json
    private val at = "2026-09-06T08:00:00Z"
    private val meta = MobileResponseMetaDto(1, TASKEN_MOBILE_SCHEMA_VERSION, "related-server", 1, at, false)
    private fun sync() = SyncStateEntity(serverId = meta.serverId, apiVersion = 1, schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
        cursor = null, lastSuccessfulSyncAt = at, lastAttemptAt = null, lastError = null)
    private fun summary(id: String = "note", version: Int = 1) = RelatedSummary("note", id, "測定条件の比較", version, "available", listOf(RelatedReason("related_to", "from_task")))
    private fun list(items: List<RelatedSummary>, cursor: String? = null) = GatewayHttpResponse(200, json.encodeToString(RelatedListResponse(true, meta, RelatedListData("task", "available", items, cursor))))
    private fun body(status: String = "available", text: String = "  比較した条件\n🔬  ", version: Int = 1) = GatewayHttpResponse(200,
        json.encodeToString(RelatedBodyResponse(true, meta, RelatedBodyData("task", "note", "note", status,
            if (status == "available") RelatedBody("測定条件の比較", version, text, text.length, false) else null))))

    @Test fun selectedBodySurvivesDatabaseReopenAndOfflineThenReceivedDeletionPurgesIt() = runBlocking {
        val name = "related-550-${UUID.randomUUID()}.db"
        var db = Room.databaseBuilder(context, MobileLocalDatabase::class.java, name).build()
        try {
            var dao = db.mobileDao(); dao.upsertSyncState(sync())
            var reply = list(listOf(summary(), summary("unfetched")))
            var reader = MobileRelatedDocumentsReader(dao) { reply }
            reader.refresh("task", false)
            assertTrue(reader.observe("task").first().bodies.isEmpty())
            reply = body(); reader.load("task", "note", "note")
            assertEquals("  比較した条件\n🔬  ", reader.observe("task").first().bodies.single().document.body)
            db.close(); db = Room.databaseBuilder(context, MobileLocalDatabase::class.java, name).build(); dao = db.mobileDao()
            reader = MobileRelatedDocumentsReader(dao) { throw java.io.IOException("offline") }
            reader.refresh("task", false); reader.load("task", "note", "unfetched")
            assertEquals(1, reader.observe("task").first().bodies.size)
            assertNotNull(reader.observe("task").first().error)
            reader = MobileRelatedDocumentsReader(dao) { body("not_found") }
            reader.load("task", "note", "note")
            val removed = reader.observe("task").first()
            assertTrue(removed.bodies.isEmpty()); assertFalse(removed.documents.any { it.id == "note" })
        } finally { db.close(); context.deleteDatabase(name) }
    }

    @Test fun pagesContinueAndBodyUpdatesAndRevocationAreExplicit() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java).build()
        try {
            val dao = db.mobileDao(); dao.upsertSyncState(sync())
            var reply = list((1..50).map { summary("id-$it") }, "opaque+/=cursor")
            var path = ""
            val reader = MobileRelatedDocumentsReader(dao) { path = it; reply }
            reader.refresh("task", false)
            reply = list(listOf(summary()))
            reader.refresh("task", true)
            assertTrue(path.contains("cursor=opaque%2B%2F%3Dcursor")); assertEquals(51, reader.observe("task").first().documents.size)
            reply = body(); reader.load("task", "note", "note")
            reply = list(listOf(summary(version = 2))); reader.refresh("task", false)
            assertEquals(1, reader.observe("task").first().bodies.single().document.version)
            reply = body(text = "更新済み本文", version = 2); reader.load("task", "note", "note")
            assertEquals("更新済み本文", reader.observe("task").first().bodies.single().document.body)
            dao.upsertRelatedDocuments(RelatedDocumentCacheEntity(meta.serverId, "another-task", json.encodeToString(reader.observe("task").first())))
            reply = GatewayHttpResponse(403, """{"ok":false,"meta":{"apiVersion":1,"schemaVersion":$TASKEN_MOBILE_SCHEMA_VERSION,"serverId":"related-server","serverRevision":1,"generatedAt":"$at","truncated":false},"error":{"code":"forbidden","message":"read revoked","retryable":false}}"""); reader.refresh("task", false)
            assertTrue(reader.observe("task").first().bodies.isEmpty())
            assertNull(dao.relatedDocuments(meta.serverId, "another-task"))
            assertTrue(reader.observe("task").first().error!!.contains("失効"))
        } finally { db.close() }
    }

    @Test fun unsupportedAndMalformedGatewayNeverReplaceFetchedContentWithEmpty() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java).build()
        try {
            val dao = db.mobileDao(); dao.upsertSyncState(sync())
            var reply = GatewayHttpResponse(404, "old gateway")
            val reader = MobileRelatedDocumentsReader(dao) { reply }
            reader.refresh("task", false)
            assertNull(reader.observe("task").first().fetchedAt)
            reply = list(listOf(summary())); reader.refresh("task", false)
            reply = body(); reader.load("task", "note", "note")
            reply = GatewayHttpResponse(401, "proxy error"); reader.refresh("task", false)
            assertEquals(1, reader.observe("task").first().bodies.size)
            reply = GatewayHttpResponse(200, json.encodeToString(RelatedListResponse(true, meta.copy(schemaVersion = 999), RelatedListData("task", "available", emptyList(), null))))
            reader.refresh("task", false)
            assertEquals(1, reader.observe("task").first().bodies.size)
            reply = list(emptyList()); reader.refresh("task", false)
            assertTrue(reader.observe("task").first().bodies.isEmpty()); assertNotNull(reader.observe("task").first().fetchedAt)
        } finally { db.close() }
    }

    @Test fun manyLongBodiesRemainReadableWithoutOneOversizedCursorWindowRow() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java).build()
        try {
            val dao = db.mobileDao(); dao.upsertSyncState(sync())
            val text = "測".repeat(50000)
            val reader = MobileRelatedDocumentsReader(dao) { path ->
                if (path.startsWith("/v1/task-related-documents?")) list((1..20).map { summary("long-$it") })
                else {
                    val id = android.net.Uri.parse(path).getQueryParameter("id")!!
                    GatewayHttpResponse(200, json.encodeToString(RelatedBodyResponse(true, meta, RelatedBodyData("task", "note", id, "available", RelatedBody("長い資料", 1, text, text.length, false)))))
                }
            }
            reader.refresh("task", false)
            for (index in 1..20) reader.load("task", "note", "long-$index")
            val cached = reader.observe("task").first()
            assertEquals(20, cached.bodies.size)
            assertTrue(cached.bodies.all { it.document.body == text })
            assertTrue(dao.relatedDocuments(meta.serverId, "task")!!.payload.length < 10000)
        } finally { db.close() }
    }

    @Test fun responseStartedBeforeAnotherRequestRevokesAccessCannotRestoreCache() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java).build()
        try {
            val dao = db.mobileDao(); dao.upsertSyncState(sync())
            val started = CompletableDeferred<Unit>()
            val released = CompletableDeferred<Unit>()
            val reader = MobileRelatedDocumentsReader(dao) {
                started.complete(Unit); released.await(); list(listOf(summary()))
            }
            val pending = async { reader.refresh("task", false) }
            started.await()
            dao.revokeRelatedDocuments(meta.serverId)
            released.complete(Unit); pending.await()
            assertNull(dao.relatedDocuments(meta.serverId, "task"))
            assertTrue(reader.observe("task").first().documents.isEmpty())
        } finally { db.close() }
    }
}
