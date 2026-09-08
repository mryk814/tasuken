package jp.personal.tasken.companion

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class MobileThemeContextDatabaseTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val theme = themeContextFixture()
    private val server = "theme-context-server"
    private val at = "2026-09-06T08:00:00Z"
    private val meta = MobileResponseMetaDto(1, TASKEN_MOBILE_SCHEMA_VERSION, server, 12, at, false)
    private fun sync(serverId: String = server) = SyncStateEntity(serverId = serverId, apiVersion = 1,
        schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION, cursor = null, lastSuccessfulSyncAt = at,
        lastAttemptAt = null, lastError = null)
    private fun success(value: MobileThemeContext? = theme) = GatewayHttpResponse(200, Json.encodeToString(
        MobileThemeContextResponse(true, meta, MobileThemeContextData(theme.id, if (value == null) "not_found" else "available", value))))
    private fun denied(serverId: String = server) = GatewayHttpResponse(403,
        """{"ok":false,"meta":{"apiVersion":1,"schemaVersion":$TASKEN_MOBILE_SCHEMA_VERSION,"serverId":"$serverId","serverRevision":12,"generatedAt":"$at","truncated":false},"error":{"code":"forbidden","message":"Read revoked","retryable":false}}""")

    @Test fun fullBoundedContentSurvivesReopenAndOfflineWithoutOversizedCursorWindow() = runBlocking {
        val name = "theme-551-${UUID.randomUUID()}.db"
        var db = Room.databaseBuilder(context, MobileLocalDatabase::class.java, name).build()
        val longText = "測".repeat(8000)
        val longList = List(20) { "条".repeat(1000) }
        val longest = theme.copy(
            charter = theme.charter!!.copy(purpose = longText, desired_outcome = longText, scope = longText,
                principles = longList, non_goals = longList, long_term_questions = longList, learning_interests = longList),
            currentState = theme.currentState!!.copy(current_direction = longText, next_frontier = longText,
                active_questions = longList, current_bets = longList, blockers = longList, unresolved_decisions = longList),
        )
        try {
            db.mobileDao().upsertSyncState(sync())
            var reader = MobileThemeContextReader(db.mobileDao()) { success(longest) }
            reader.refresh(theme.id)
            assertEquals(longest, reader.observe(theme.id).first().theme)
            db.close()
            db = Room.databaseBuilder(context, MobileLocalDatabase::class.java, name).build()
            reader = MobileThemeContextReader(db.mobileDao()) { throw IOException("offline") }
            reader.refresh(theme.id)
            val cached = reader.observe(theme.id).first()
            assertEquals(longest, cached.theme)
            assertEquals(ThemeContextFailure.Offline, cached.failure)
            assertNotNull(cached.fetchedAt)
        } finally { db.close(); context.deleteDatabase(name) }
    }

    @Test fun updatesUnsetAndReceivedDeletionReplaceTheCanonicalState() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java).build()
        try {
            db.mobileDao().upsertSyncState(sync())
            var reply = success()
            val reader = MobileThemeContextReader(db.mobileDao()) { reply }
            reader.refresh(theme.id)
            val updated = theme.copy(version = 4, currentState = theme.currentState!!.copy(current_direction = "変更された方向"))
            reply = success(updated); reader.refresh(theme.id)
            assertEquals(updated, reader.observe(theme.id).first().theme)
            reply = success(updated.copy(charter = null, currentState = null)); reader.refresh(theme.id)
            assertEquals(ThemeContextContent.Available, reader.observe(theme.id).first().content)
            assertNull(reader.observe(theme.id).first().theme!!.charter)
            reply = success(null); reader.refresh(theme.id)
            val deleted = reader.observe(theme.id).first()
            assertEquals(ThemeContextContent.Missing, deleted.content)
            assertNull(deleted.theme); assertNull(deleted.failure)
        } finally { db.close() }
    }

    @Test fun oldGatewayMalformedResponseAndProxyUnauthorizedKeepCacheAndCatalog() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java).build()
        try {
            val dao = db.mobileDao(); dao.upsertSyncState(sync())
            var reply = GatewayHttpResponse(404, "old Gateway")
            val reader = MobileThemeContextReader(dao) { reply }
            reader.refresh(theme.id)
            assertEquals(ThemeContextContent.Unfetched, reader.observe(theme.id).first().content)
            assertEquals(ThemeContextFailure.Unsupported, reader.observe(theme.id).first().failure)
            reply = success(); reader.refresh(theme.id)
            reply = GatewayHttpResponse(200, success().body.replace("\"schemaVersion\":7", "\"schemaVersion\":999")); reader.refresh(theme.id)
            assertEquals(ThemeContextFailure.InvalidResponse, reader.observe(theme.id).first().failure)
            assertEquals(theme, reader.observe(theme.id).first().theme)
            reply = GatewayHttpResponse(401, "proxy error"); reader.refresh(theme.id)
            assertEquals(theme, reader.observe(theme.id).first().theme)
            reply = denied("different-server"); reader.refresh(theme.id)
            assertEquals(theme, reader.observe(theme.id).first().theme)
            dao.upsertSyncState(sync("different-server"))
            assertEquals(ThemeContextContent.Unfetched, reader.observe(theme.id).first().content)
        } finally { db.close() }
    }

    @Test fun confirmedReadDenialPurgesBothReadersOnlyOnTheExpectedServer() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java).build()
        try {
            val dao = db.mobileDao(); dao.upsertSyncState(sync())
            var reply = success()
            val reader = MobileThemeContextReader(dao) { reply }
            reader.refresh(theme.id)
            dao.upsertThemeContext(ThemeContextCacheEntity(server, "other-theme", "retained before revoke"))
            dao.upsertThemeContext(ThemeContextCacheEntity("other-server", theme.id, "other server cache"))
            dao.upsertRelatedDocuments(RelatedDocumentCacheEntity(server, "task", "cached"))
            dao.upsertRelatedBodies(listOf(RelatedBodyCacheEntity(server, "task", "note", "note", "cached")))
            reply = denied(); reader.refresh(theme.id)
            assertEquals(ThemeContextFailure.AccessDenied, reader.observe(theme.id).first().failure)
            assertNull(reader.observe(theme.id).first().theme)
            assertNull(dao.themeContext(server, "other-theme"))
            assertNull(dao.relatedDocuments(server, "task")); assertTrue(dao.relatedBodies(server, "task").isEmpty())
            assertNotNull(dao.themeContext("other-server", theme.id))
        } finally { db.close() }
    }

    @Test fun pendingResponseCannotRestoreCacheAfterGlobalRevocation() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java).build()
        try {
            val dao = db.mobileDao(); dao.upsertSyncState(sync())
            val started = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
            val reader = MobileThemeContextReader(dao) { started.complete(Unit); release.await(); success() }
            val pending = async { reader.refresh(theme.id) }
            started.await(); dao.revokeOwnerReadCaches(server); release.complete(Unit); pending.await()
            assertNull(dao.themeContext(server, theme.id))
            assertNull(reader.observe(theme.id).first().theme)
        } finally { db.close() }
    }
}
