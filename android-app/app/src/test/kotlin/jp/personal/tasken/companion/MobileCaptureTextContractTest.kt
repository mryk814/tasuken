package jp.personal.tasken.companion

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MobileCaptureTextContractTest {
    @Test
    fun sharedUtf16BoundariesPreserveEveryAcceptedCharacter() {
        val source = requireNotNull(javaClass.classLoader?.getResource("mobile-capture-text-boundaries.json")).readText()
        Json.parseToJsonElement(source).jsonObject.getValue("cases").jsonArray.forEach { value ->
            val fixture = value.jsonObject
            val text = fixture.getValue("unit").jsonPrimitive.content.repeat(fixture.getValue("repeat").jsonPrimitive.int) +
                fixture.getValue("suffix").jsonPrimitive.content
            assertEquals(fixture.getValue("expectedUtf16Length").jsonPrimitive.int, text.length)
            val encoded = runCatching { MobileCaptureCommandContract.encode(envelope(text)) }
            assertEquals(fixture.getValue("name").jsonPrimitive.content,
                fixture.getValue("accepted").jsonPrimitive.boolean, encoded.isSuccess)
            if (encoded.isSuccess) assertEquals(text, MobileCaptureCommandContract.decodeCreateEnvelope(encoded.getOrThrow()).command.capture.text)
            assertEquals(text, MobileCaptureDraft.fresh(text = text, kind = MobileCaptureKind.Capture).text)
        }
        assertTrue(runCatching { MobileCaptureCommandContract.encode(envelope(" \n\t ")) }.isFailure)
    }

    @Test
    fun onlyConfirmedLongCaptureCompatibilityErrorsStopForExplicitRetry() {
        val json = MobileCaptureCommandContract.encode(envelope("長".repeat(501)))
        fun error(code: String, serverId: String = "server-1") = GatewayHttpResponse(400,
            """{"ok":false,"meta":{"serverId":"$serverId"},"error":{"code":"$code"}}""")
        assertTrue(isUnsupportedLongCapture(json, error("validation_failed"), "server-1"))
        assertTrue(isUnsupportedLongCapture(json, error("version_mismatch"), "server-1"))
        assertFalse(isUnsupportedLongCapture(json, error("validation_failed", "different"), "server-1"))
        assertFalse(isUnsupportedLongCapture(json, error("forbidden"), "server-1"))
        assertFalse(isUnsupportedLongCapture(json, GatewayHttpResponse(503, "offline"), "server-1"))
        val short = MobileCaptureCommandContract.encode(envelope("短".repeat(500)))
        assertFalse(isUnsupportedLongCapture(short, error("validation_failed"), "server-1"))
        val original = envelope("  短い原文  ")
        val marked = MobileCaptureCommandContract.encode(original.copy(command = original.command.copy(
            capture = original.command.capture.copy(textContract = MOBILE_CAPTURE_TEXT_CONTRACT),
        )))
        assertTrue(isUnsupportedLongCapture(marked, error("validation_failed"), "server-1"))
        assertEquals("  短い原文  ", MobileCaptureCommandContract.decodeCreateEnvelope(marked).command.capture.text)
    }

    private fun envelope(text: String) = MobileCreateCaptureEnvelopeDto(
        TASKEN_MOBILE_API_VERSION, TASKEN_MOBILE_SCHEMA_VERSION,
        "request-capture", "command-capture", "command-capture", "device-test", "2026-09-06T00:00:00Z",
        MobileCreateCaptureCommandDto("CreateCapture", MobileCreateCaptureCandidateDto(
            "capture-test", text, null, "2026-09-06T00:00:00Z",
        )),
    )
}
