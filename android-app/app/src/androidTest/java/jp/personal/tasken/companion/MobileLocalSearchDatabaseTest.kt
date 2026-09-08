package jp.personal.tasken.companion

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import java.util.UUID
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class MobileLocalSearchDatabaseTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val server = "search-server"
    private val at = "2026-09-08T08:00:00Z"
    private fun database() = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java).build()
    private fun reader(db: MobileLocalDatabase) = MobileLocalSearchReader(db, flowOf(true))
    private fun request(query: String = "", page: Int = 0) = MobileLocalSearchRequest(query = query, page = page, timezone = "Asia/Tokyo")
    private suspend fun seed(db: MobileLocalDatabase) {
        db.mobileDao().upsertSyncState(SyncStateEntity(serverId = server, apiVersion = 1, schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
            cursor = null, lastSuccessfulSyncAt = at, lastAttemptAt = at, lastError = null))
    }
    private fun task(id: String, title: String = "温度を比較 $id") = TaskCacheEntity(id, 1, title, "theme", "todo", null, null, at, null)
    private fun workLog(id: String, text: String = "温度の比較を進めた") = WorkLogCacheEntity(id, server, 1, text, "2026-09-07", at, "theme", null, false, false, null)
    private suspend fun related(db: MobileLocalDatabase, taskId: String, id: String, text: String, version: Int = 1, type: String = "note") {
        val summary = RelatedSummary(type, id, "比較の原記録", version, "available", listOf(RelatedReason("related_to", "from_task")))
        val body = CachedRelatedBody(type, id, RelatedBody(summary.title, version, text, text.length, false), at)
        db.mobileDao().upsertRelatedDocuments(RelatedDocumentCacheEntity(server, taskId, Json.encodeToString(RelatedDocumentsState(listOf(summary), listOf(body), fetchedAt = at))))
        db.mobileDao().upsertRelatedBodies(listOf(RelatedBodyCacheEntity(server, taskId, type, id, Json.encodeToString(body))))
    }

    @Test fun literalJapaneseSearchUsesSavedBodiesOfflineAndKeepsDateMeaningAndCoverage() = runBlocking {
        val name = "search-552-${UUID.randomUUID()}.db"
        var db = Room.databaseBuilder(context, MobileLocalDatabase::class.java, name).build()
        try {
            seed(db)
            val dao = db.mobileDao()
            dao.upsertTask(task("task"))
            dao.upsertWorkLog(workLog("work"))
            dao.upsertRecallCapture(RecallCaptureCacheEntity(server, "capture", "command", "温度 100% A_B '引用' \"比較\"", at))
            related(db, "task", "note", "温度と濃度を比較した本文")
            dao.upsertRelatedDocuments(RelatedDocumentCacheEntity(server, "unread-task", Json.encodeToString(RelatedDocumentsState(
                listOf(RelatedSummary("note", "unread", "温度の未取得Note", 1, "available", listOf(RelatedReason("related_to", "from_task")))), fetchedAt = at))))
            db.close()
            db = Room.databaseBuilder(context, MobileLocalDatabase::class.java, name).build()
            val reader = reader(db)
            val all = reader.observeLocalSearch(request("温度")).first()
            assertEquals(4, all.total); assertEquals(1, all.coverage.unfetchedNotes)
            assertEquals(setOf("更新日", "実施日", "入力日", "本文取得日"), all.hits.map { it.dateMeaning }.toSet())
            for (query in listOf("100%", "A_B", "'引用'", "\"比較\"")) assertEquals(query, 1, reader.observeLocalSearch(request(query)).first().total)
            assertEquals(0, reader.observeLocalSearch(request("100_")).first().total)
            assertEquals(0, reader.observeLocalSearch(request("'; DROP TABLE task_cache; --")).first().total)
            assertNotNull(db.mobileDao().task("task"))
            assertEquals(4, reader.observeLocalSearch(request("  ")).first().total)
            assertNotNull(reader.observeLocalSearch(request("長".repeat(201))).first().error)
            assertEquals(1, reader.observeLocalSearch(request("温度").copy(fromDate = "2026-09-07", toDate = "2026-09-07")).first().total)
            assertEquals(3, reader.observeLocalSearch(request("温度").copy(themeId = "theme")).first().total)
        } finally { db.close(); context.deleteDatabase(name) }
    }

    @Test fun newestBodyWinsBeforeMatchingAndSameSourceDoesNotDuplicateAcrossProjections() = runBlocking {
        val db = database()
        try {
            seed(db)
            db.mobileDao().upsertTask(task("a")); db.mobileDao().upsertTask(task("b"))
            related(db, "a", "same-note", "古いキーワード", 1)
            related(db, "b", "same-note", "更新されたキーワード", 2)
            assertEquals(0, reader(db).observeLocalSearch(request("古い")).first().total)
            assertEquals(1, reader(db).observeLocalSearch(request("更新された")).first().total)
            db.mobileDao().upsertRecallCapture(RecallCaptureCacheEntity(server, "same-capture", "command", "同じ原文", at))
            related(db, "a", "same-capture", "同じ原文", 2, "capture_entry")
            val result = reader(db).observeLocalSearch(request("同じ原文")).first()
            assertEquals(1, result.total)
            assertEquals("入力日", result.hits.single().dateMeaning)
            assertNotNull(result.hits.single().relatedTaskId)
        } finally { db.close() }
    }

    @Test fun liveChangesAndDeletionAreReflectedWithoutAStaleIndex() = runBlocking {
        val db = database()
        try {
            seed(db)
            val changes = Channel<MobileLocalSearchPage>(Channel.UNLIMITED)
            val job = launch { reader(db).observeLocalSearch(request("比較")).collect { changes.send(it) } }
            suspend fun awaitCount(count: Int) = withTimeout(10000) { while (changes.receive().total != count) { } }
            awaitCount(0)
            db.mobileDao().upsertTask(task("task")); awaitCount(1)
            db.mobileDao().upsertTask(task("task", "別のタイトル")); awaitCount(0)
            db.mobileDao().upsertWorkLog(workLog("work")); awaitCount(1)
            db.mobileDao().upsertWorkLog(workLog("work").copy(deleted = true)); awaitCount(0)
            related(db, "task", "note", "比較した記録"); awaitCount(1)
            db.mobileDao().revokeOwnerReadCaches(server); awaitCount(0)
            job.cancel(); changes.close()
            Unit
        } finally { db.close() }
    }

    @Test fun boundedPagesAreStableAndReceivedDeletionRemovesEveryRelatedCopy() = runBlocking {
        val db = database()
        try {
            seed(db)
            repeat(123) { db.mobileDao().upsertTask(task("task-${it.toString().padStart(3, '0')}")) }
            val pages = (0..2).map { reader(db).observeLocalSearch(request("温度", it)).first() }
            assertEquals(listOf(50, 50, 23), pages.map { it.hits.size })
            assertEquals(123, pages.flatMap { it.hits }.map { it.key }.distinct().size)
            assertTrue(pages[0].hasNext); assertFalse(pages[2].hasNext)
            related(db, "task-000", "gone-note", "削除の対象")
            related(db, "task-001", "gone-note", "削除の対象")
            val meta = MobileResponseMetaDto(1, TASKEN_MOBILE_SCHEMA_VERSION, server, 1, at, false)
            val response = RelatedBodyResponse(true, meta, RelatedBodyData("task-000", "note", "gone-note", "not_found", null))
            val relatedReader = MobileRelatedDocumentsReader(db.mobileDao()) { GatewayHttpResponse(200, Json.encodeToString(response)) }
            relatedReader.load("task-000", "note", "gone-note")
            assertEquals(0, reader(db).observeLocalSearch(request("削除")).first().total)
            assertTrue(db.mobileDao().relatedBodies(server, "task-001").isEmpty())
            assertTrue(Json.decodeFromString<RelatedDocumentsState>(db.mobileDao().relatedDocuments(server, "task-001")!!.payload).bodies.isEmpty())
            assertNotNull(db.mobileDao().task("task-000"))
        } finally { db.close() }
    }

    @Test fun seenSourceRemovedFromPublishedDayCannotReturnFromOriginalCaptureOverlay() = runBlocking {
        val db = database()
        try {
            seed(db)
            db.mobileDao().upsertRecallCapture(RecallCaptureCacheEntity(server, "capture", "command", "整理済みの比較", at))
            db.mobileDao().insertRecallSeenSources(listOf(RecallSeenSourceEntity(server, "capture_entry", "capture", at)))
            db.mobileDao().upsertRecallDay(RecallDayCacheEntity(server, "2026-09-08", "Asia/Tokyo", "[]", at, null, "revision", null, false))
            assertEquals(0, reader(db).observeLocalSearch(request("比較")).first().total)
            assertNotNull(db.localSearchDao().capture(server, "capture"))
        } finally { db.close() }
    }
}
