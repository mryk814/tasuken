package jp.personal.tasken.companion

import java.time.Instant
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class DirectCaptureOrganizerTest {
    private val draft = MobileCaptureDraft.fresh(text = "明日、牛乳を買う", projectId = "home",
        now = { Instant.parse("2026-09-07T15:30:00Z") }).withSpeechResult(
            ShortSpeechRecognitionResult("明日、牛乳を買う", MobileSpeechRecognitionMode.OnDevice, "ja-JP", null),
            capturedAt = "2026-09-07T15:30:00Z", timeZone = "Asia/Tokyo")
    private val themes = listOf(MobileTheme("home", "家庭"))
    private val proposal = """{"title":"牛乳を買う","themeId":"home","startDate":"2026-09-09","endDate":null,"rangeSemantics":null,"checklist":["牛乳"],"supplement":"朝食用","warnings":[],"plannedStartTime":"16:00","plannedDurationMinutes":30}"""

    private fun settings(provider: CaptureAiProvider) = DirectCaptureSettings(enabled = true, provider = provider,
        model = if (provider in directCaptureChatModels) directCaptureChatModels.getValue(provider).first() else "example-model",
        endpoint = if (provider == CaptureAiProvider.Azure) "https://example.openai.azure.com/" else "")
    private fun response(provider: CaptureAiProvider, tasks: String = proposal, warnings: String = "[]"): String {
        val text = "{\"tasks\":[$tasks],\"warnings\":$warnings}"
        return if (provider == CaptureAiProvider.Gemini) buildJsonObject {
            put("candidates", buildJsonArray { add(buildJsonObject {
                put("finishReason", "STOP"); put("content", buildJsonObject {
                    put("parts", buildJsonArray { add(buildJsonObject { put("text", text) }) })
                })
            }) })
        }.toString() else buildJsonObject {
            put("choices", buildJsonArray { add(buildJsonObject {
                put("finish_reason", "stop"); put("message", buildJsonObject { put("content", text) })
            }) })
        }.toString()
    }

    @Test
    fun allFiveProvidersUseTheirFixedRouteAndCredentialsOutsidePrompt() = runBlocking {
        CaptureAiProvider.entries.forEach { provider ->
            var calls = 0
            val result = organizeCaptureDirectly(settings(provider), { "test-secret" }, draft, themes, emptyList(),
                DirectCaptureHttpClient { destination, header, key, body ->
                    calls++
                    assertEquals(settings(provider).destination(), destination)
                    assertEquals(if (provider == CaptureAiProvider.Gemini) "x-goog-api-key" else "Authorization", header)
                    assertEquals("test-secret", key)
                    assertFalse(body.contains("test-secret"))
                    val request = Json.parseToJsonElement(body).jsonObject
                    if (provider == CaptureAiProvider.Gemini) assertTrue(request.containsKey("generationConfig"))
                    else assertEquals("json_schema", request.getValue("response_format").jsonObject.getValue("type").jsonPrimitive.content)
                    response(provider)
                })
            assertEquals(1, calls)
            assertEquals("牛乳を買う", result.single().title)
            assertTrue(result.single().plannedTimeSupported)
            assertEquals("明日、牛乳を買う", draft.text)
        }
    }

    @Test
    fun speechDateAndPhotosAreCarriedWithoutSubstitutingRequestTime() {
        val photo = MobileCaptureImageDto("photo-1", "capture-test.jpg", "image/jpeg", "/9j/fixture")
        CaptureAiProvider.entries.forEach { provider ->
            val request = Json.parseToJsonElement(directCaptureRequest(settings(provider),
                draft.withPhoto(MobileCapturePhoto(photo.fileName)), themes, listOf(photo))).jsonObject
            val user = if (provider == CaptureAiProvider.Gemini) request.getValue("contents").jsonArray[0].jsonObject.getValue("parts").jsonArray
                else request.getValue("messages").jsonArray[1].jsonObject.getValue("content").jsonArray
            val input = Json.parseToJsonElement(user[0].jsonObject.getValue("text").jsonPrimitive.content).jsonObject
            assertEquals("2026-09-08", input.getValue("capturedLocalDate").jsonPrimitive.content)
            assertEquals("2026-09-09", input.getValue("relativeDateAnchors").jsonObject.getValue("tomorrow").jsonPrimitive.content)
            assertEquals(15, input.getValue("calendarAnchors").jsonArray.size)
            assertFalse(input.toString().contains(photo.dataBase64))
            assertTrue(user[1].toString().contains(photo.dataBase64))
        }
    }

    @Test
    fun unsafeEndpointsModelsAndUnknownThemesAreRejectedBeforeHttp() {
        listOf("https://attacker.test/", "http://example.openai.azure.com", "https://example.openai.azure.com/redirect",
            "https://user@example.openai.azure.com", "https://example.openai.azure.com:443", "https://example.openai.azure.com/?x=1",
            "https://example.openai.azure.com/#x").forEach {
            assertThrows(Exception::class.java) { settings(CaptureAiProvider.Azure).copy(endpoint = it).destination() }
        }
        assertEquals("https://example.services.ai.azure.com/openai/v1/chat/completions",
            settings(CaptureAiProvider.Azure).copy(endpoint = "https://example.services.ai.azure.com").destination())
        listOf("../model", "model/path", "model?key=x", "model\n").forEach {
            assertThrows(Exception::class.java) { settings(CaptureAiProvider.OpenAi).copy(model = it).destination() }
        }
        assertThrows(Exception::class.java) { settings(CaptureAiProvider.Go).copy(model = "unknown").destination() }
        assertThrows(Exception::class.java) { directCaptureRequest(settings(CaptureAiProvider.OpenAi), draft, emptyList(), emptyList()) }
        assertThrows(Exception::class.java) { directCaptureRequest(settings(CaptureAiProvider.OpenAi), draft, themes + themes, emptyList()) }
    }

    @Test
    fun strictProposalsRejectExtraMissingAndIncorrectTypesOrDates() {
        listOf(
            proposal.replace("\"title\":\"牛乳を買う\"", "\"title\":true"),
            proposal.replace("\"plannedDurationMinutes\":30", "\"plannedDurationMinutes\":\"30\""),
            proposal.replace("2026-09-09", "2026-02-30"),
            proposal.replace("2026-09-09", "2026-9-9"),
            proposal.replace("\"endDate\":null", "\"endDate\":\"2026-09-08\""),
            proposal.replace("\"home\"", "\"unknown\""),
            proposal.replace("\"warnings\":[],", ""),
            proposal.dropLast(1) + ",\"excluded\":true}",
            proposal.replace("\"title\":\"牛乳を買う\"", "\"title\":\"\""),
            proposal.replace("16:00", "25:00"),
        ).forEach { invalid -> assertThrows(Exception::class.java) {
            decodeDirectCaptureResponse(CaptureAiProvider.OpenAi, response(CaptureAiProvider.OpenAi, invalid), setOf("home"))
        } }
    }

    @Test
    fun refusesIncompleteBlockedAndOversizeResponses() {
        assertThrows(Exception::class.java) { decodeDirectCaptureResponse(CaptureAiProvider.OpenAi,
            response(CaptureAiProvider.OpenAi).replace("\"stop\"", "\"length\""), setOf("home")) }
        assertThrows(Exception::class.java) { decodeDirectCaptureResponse(CaptureAiProvider.Gemini,
            response(CaptureAiProvider.Gemini).replace("\"STOP\"", "\"SAFETY\""), setOf("home")) }
        assertThrows(Exception::class.java) { decodeDirectCaptureResponse(CaptureAiProvider.Gemini,
            response(CaptureAiProvider.Gemini).replace("\"text\":", "\"thought\":\"true\",\"text\":"), setOf("home")) }
        assertThrows(Exception::class.java) { decodeDirectCaptureResponse(CaptureAiProvider.OpenAi,
            response(CaptureAiProvider.OpenAi, List(9) { proposal }.joinToString(",")), setOf("home")) }
        assertThrows(Exception::class.java) { decodeDirectCaptureResponse(CaptureAiProvider.OpenAi, "あ".repeat(DIRECT_CAPTURE_RESPONSE_LIMIT), setOf("home")) }
        assertThrows(Exception::class.java) { decodeDirectCaptureResponse(CaptureAiProvider.OpenAi,
            response(CaptureAiProvider.OpenAi, warnings = "[\"\"]"), setOf("home")) }
    }

    @Test
    fun disabledOrInvalidInputsNeverReadCredentialsOrSendAndFailuresStaySanitized() = runBlocking {
        var keyReads = 0
        var calls = 0
        for (setting in listOf(settings(CaptureAiProvider.OpenAi).copy(enabled = false), settings(CaptureAiProvider.Go).copy(model = "invalid"))) {
            val failure = runCatching { organizeCaptureDirectly(setting, { keyReads++; "test-secret" }, draft, themes, emptyList(),
                DirectCaptureHttpClient { _, _, _, _ -> calls++; error("test-secret body") }) }.exceptionOrNull()
            assertEquals(DIRECT_CAPTURE_FAILURE, failure?.message)
            assertFalse(failure?.stackTraceToString().orEmpty().contains("test-secret"))
        }
        assertEquals(0, keyReads)
        assertEquals(0, calls)
        val failure = runCatching { organizeCaptureDirectly(settings(CaptureAiProvider.OpenAi), { "test-secret" }, draft, themes, emptyList(),
            DirectCaptureHttpClient { _, _, _, _ -> calls++; error("test-secret body") }) }.exceptionOrNull()
        assertEquals(DIRECT_CAPTURE_FAILURE, failure?.message)
        assertFalse(failure?.stackTraceToString().orEmpty().contains("test-secret"))
        assertEquals(1, calls)
    }
}
