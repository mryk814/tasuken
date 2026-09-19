package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Test

class WidgetVoiceCaptureDraftTest {
    @Test
    fun short_text_becomes_task_with_speech_provenance() {
        val draft = buildWidgetVoiceDraft(
            text = "  牛乳を買う  ",
            language = "ja-JP",
            confidence = 0.9f,
            capturedAt = "2026-09-18T15:20:00Z",
            timeZone = "Asia/Tokyo",
        )

        assertEquals(MobileCaptureKind.Task, draft.kind)
        assertEquals("牛乳を買う", draft.text)
        assertEquals(MobileCaptureSource.AndroidSpeech, draft.source)
        assertEquals(MobileSpeechRecognitionMode.SystemService, draft.speech?.recognitionMode)
        assertEquals("ja-JP", draft.speech?.language)
        assertEquals(0.9f, draft.speech?.confidence)
        assertEquals("2026-09-18T15:20:00Z", draft.speech?.capturedAt)
    }

    @Test
    fun long_text_becomes_capture_without_losing_input() {
        val longText = "あ".repeat(501)
        val draft = buildWidgetVoiceDraft(
            text = longText,
            language = "ja-JP",
            confidence = null,
            capturedAt = "2026-09-18T15:20:00Z",
            timeZone = "Asia/Tokyo",
        )

        assertEquals(MobileCaptureKind.Capture, draft.kind)
        assertEquals(longText, draft.text)
        assertEquals(MobileCaptureSource.AndroidSpeech, draft.source)
    }

    @Test(expected = IllegalArgumentException::class)
    fun blank_text_is_rejected() {
        buildWidgetVoiceDraft(
            text = "   ",
            language = "ja-JP",
            confidence = null,
            capturedAt = "2026-09-18T15:20:00Z",
            timeZone = "Asia/Tokyo",
        )
    }

    @Test
    fun voice_capture_action_is_namespaced() {
        assertEquals(
            "jp.personal.tasken.companion.action.VOICE_CAPTURE",
            WidgetVoiceCaptureActivity.ACTION_VOICE_CAPTURE,
        )
    }
}
