package jp.personal.tasken.companion

import android.speech.SpeechRecognizer
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class MobileCaptureDraftTest {
    @Test
    fun themeSelectionNormalizesAndCanReturnToNoTheme() {
        val draft = MobileCaptureDraft.fresh(
            projectId = null,
            now = { Instant.parse("2026-08-23T00:00:00Z") },
            newId = { "draft-id" },
        )

        val selected = draft.withThemeId("  theme-research  ")
        val cleared = selected.withThemeId("   ")

        assertEquals("theme-research", selected.projectId)
        assertNull(cleared.projectId)
        assertEquals("draft-id", cleared.draftId)
    }

    @Test
    fun finalSpeechReplacesTextAndKeepsProvenanceWithoutAudio() {
        val draft = MobileCaptureDraft.fresh(
            text = "途中の文字",
            source = MobileCaptureSource.AppShortcut,
            now = { Instant.parse("2026-08-23T00:00:00Z") },
            newId = { "draft-id" },
        )

        val recognized = draft.withSpeechResult(
            ShortSpeechRecognitionResult(
                text = "音声で確定したTask",
                mode = MobileSpeechRecognitionMode.OnDevice,
                language = "ja-JP",
                confidence = 0.82f,
            ),
        )

        assertEquals("draft-id", recognized.draftId)
        assertEquals("音声で確定したTask", recognized.text)
        assertEquals(MobileCaptureSource.AndroidSpeech, recognized.source)
        assertEquals(MobileSpeechRecognitionMode.OnDevice, recognized.speech?.recognitionMode)
        assertEquals("ja-JP", recognized.speech?.language)
        assertEquals(0.82f, recognized.speech?.confidence)
        assertFalse(recognized.speech?.sourceAudioAvailable ?: true)
    }

    @Test
    fun partialRecognitionNeverMutatesDraft() {
        val draft = MobileCaptureDraft.fresh(
            text = "確認前の本文",
            now = { Instant.parse("2026-08-23T00:00:00Z") },
            newId = { "draft-id" },
        )
        val partial = ShortSpeechUiState.Partial(MobileSpeechRecognitionMode.SystemService, "未確定")

        assertEquals("確認前の本文", draft.text)
        assertNull(draft.speech)
        assertEquals("未確定", partial.text)
    }

    @Test
    fun speechDisclosureDistinguishesOnDeviceAndPossibleCloud() {
        assertEquals(
            "端末内で認識します。音声そのものはTaskenへ保存しません。",
            speechPrivacyDescription(MobileSpeechRecognitionMode.OnDevice),
        )
        assertEquals(
            "システム音声サービスを使います。音声がクラウドへ送信される可能性があります。",
            speechPrivacyDescription(MobileSpeechRecognitionMode.SystemService),
        )
        assertEquals(
            "音声を文字にできませんでした。内容を手入力するか、もう一度お話しください。",
            speechErrorMessage(SpeechRecognizer.ERROR_NO_MATCH),
        )
    }
}
