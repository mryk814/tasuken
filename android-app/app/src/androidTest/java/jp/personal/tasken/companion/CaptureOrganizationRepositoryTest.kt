package jp.personal.tasken.companion

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.IOException
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CaptureOrganizationRepositoryTest {
    private lateinit var context: Context
    private lateinit var database: MobileLocalDatabase
    private lateinit var dao: MobileLocalDao
    private lateinit var store: MobileGatewayConnectionStore
    private val token = "p".repeat(43)
    private val original = "明日は牛乳と卵を買う。朝食用。"
    private val cached = TaskCacheEntity(
        id = "existing-task", serverVersion = 2, title = "既存Task", themeId = "home",
        state = "todo", workState = null, todayDate = null,
        updatedAt = "2026-09-01T00:00:00Z", optimisticCommandId = null,
    )
    private val proposal = MobileCaptureOrganization(
        title = "牛乳と卵を買う", themeId = "home", startDate = "2026-09-07", endDate = "2026-09-08",
        rangeSemantics = "once_within_window", checklist = listOf("牛乳", "卵"),
        supplement = "朝食用。", warnings = listOf("予定の日付を確認してください。"),
    )

    @Before
    fun setUp() = runBlocking {
        context = ApplicationProvider.getApplicationContext()
        database = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java)
            .allowMainThreadQueries().build()
        dao = database.mobileDao()
        dao.upsertTask(cached)
        store = MobileGatewayConnectionStore(context)
        store.clearToken()
        store.save("https://gateway.test", token)
    }

    @After
    fun tearDown() {
        store.clearToken()
        database.close()
    }

    @Test
    fun organizingPostsOriginalAndRecordingBasisAndReturnsProposalWithoutSaving() = runBlocking {
        val spoken = MobileCaptureDraft.fresh(
            text = "古い下書き", now = { Instant.parse("2026-09-01T00:00:00Z") }, projectId = "home",
        ).withSpeechResult(
            ShortSpeechRecognitionResult(original, MobileSpeechRecognitionMode.OnDevice, "ja-JP", null),
            capturedAt = "2026-09-05T15:30:00Z", timeZone = "Asia/Tokyo",
        )
        // Reorganizing must use the original capture, not the shortened proposal title.
        val draft = spoken.withOrganization(proposal.copy(title = "短縮されたタイトル"))
        var calls = 0
        val repository = repositoryWith { path, method, body ->
            calls += 1
            assertEquals("/v1/capture-organization", path)
            assertEquals("POST", method)
            val data = Json.parseToJsonElement(requireNotNull(body)).jsonObject
            assertEquals(setOf("text", "capturedAt", "timeZone", "themeId"), data.keys)
            assertEquals(original, data.getValue("text").jsonPrimitive.content)
            assertEquals("home", data.getValue("themeId").jsonPrimitive.content)
            assertEquals("2026-09-05T15:30:00Z", data.getValue("capturedAt").jsonPrimitive.content)
            assertEquals("Asia/Tokyo", data.getValue("timeZone").jsonPrimitive.content)
            assertFalse(body.contains(token))
            GatewayHttpResponse(200, response(proposal))
        }

        assertEquals(proposal, repository.organizeCapture(draft))
        assertEquals(1, calls)
        assertEquals("短縮されたタイトル", draft.text)
        assertEquals(original, draft.originalText)
        assertNoWrites()
    }

    @Test
    fun legacyDraftUsesCreationDateAndSendsUnassignedThemeAsNull() = runBlocking {
        val draft = MobileCaptureDraft.fresh(text = original, now = { Instant.parse("2026-09-03T01:00:00Z") })
        val repository = repositoryWith { _, _, body ->
            val data = Json.parseToJsonElement(requireNotNull(body)).jsonObject
            assertEquals("2026-09-03T01:00:00Z", data.getValue("capturedAt").jsonPrimitive.content)
            assertEquals(ZoneId.systemDefault().id, data.getValue("timeZone").jsonPrimitive.content)
            assertEquals(JsonNull, data.getValue("themeId"))
            GatewayHttpResponse(200, response(proposal.copy(themeId = null)))
        }
        assertNull(repository.organizeCapture(draft).themeId)
        assertNoWrites()
    }

    @Test
    fun errorsAndMalformedProposalsKeepInputAndNeverExposeProviderPayloadOrToken() = runBlocking {
        val secret = "private-provider-secret"
        val draft = MobileCaptureDraft.fresh(text = original)
        val responses = listOf(
            GatewayHttpResponse(401, "$secret $token"),
            GatewayHttpResponse(403, "$secret $token"),
            GatewayHttpResponse(429, "$secret $token"),
            GatewayHttpResponse(503, "$secret $token"),
            GatewayHttpResponse(200, "$secret $token"),
            GatewayHttpResponse(200, response(proposal.copy(startDate = "2026-02-30"))),
            GatewayHttpResponse(200, response(proposal.copy(warnings = List(11) { secret }))),
        )
        for (httpResponse in responses) {
            val repository = repositoryWith { _, _, _ -> httpResponse }
            val failure = runCatching { repository.organizeCapture(draft) }.exceptionOrNull()
            assertTrue(failure is IllegalStateException)
            assertFalse(failure.toString().contains(secret))
            assertFalse(failure.toString().contains(token))
            assertNull(failure?.cause)
        }
        val offline = repositoryWith { _, _, _ -> throw IOException("$secret $token") }
        val failure = runCatching { offline.organizeCapture(draft) }.exceptionOrNull()
        assertTrue(failure is IllegalStateException)
        assertFalse(failure.toString().contains(secret))
        assertFalse(failure.toString().contains(token))
        assertEquals(original, draft.text)
        assertNull(draft.organization)
        assertNoWrites()
    }

    private suspend fun assertNoWrites() {
        assertEquals(listOf(cached), dao.tasks())
        assertEquals(0, dao.outboxCount())
        assertNull(dao.syncState())
    }

    private fun repositoryWith(
        response: (String, String, String?) -> GatewayHttpResponse,
    ) = AndroidMobileTaskRepository(
        context = context, store = store, database = database, scheduleOutboxOnStart = false,
        httpClient = MobileGatewayHttpClient { origin, path, method, body, accessToken ->
            assertEquals("https://gateway.test", origin)
            assertEquals(token, accessToken)
            response(path, method, body)
        },
    )

    private fun response(value: MobileCaptureOrganization) = buildJsonObject {
        put("ok", true)
        put("data", buildJsonObject {
            put("proposal", Json.encodeToJsonElement(MobileCaptureOrganization.serializer(), value))
            put("providerLabel", JsonPrimitive("Fixture AI"))
        })
    }.toString()
}
