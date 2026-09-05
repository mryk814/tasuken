package jp.personal.tasken.companion

import android.speech.SpeechRecognizer
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class MobileCaptureDraftTest {
    @Test
    fun speechRecordsItsOwnDateBasisWithoutChangingDraftCreationIdentity() {
        val draft = MobileCaptureDraft.fresh(
            text = "古い下書き", now = { Instant.parse("2026-09-01T00:00:00Z") },
        )
        val spoken = draft.withSpeechResult(
            ShortSpeechRecognitionResult("明日買う", MobileSpeechRecognitionMode.OnDevice, "ja-JP", null),
            capturedAt = "2026-09-05T15:30:00Z", timeZone = "Asia/Tokyo",
        )
        assertEquals(draft.createdAt, spoken.createdAt)
        assertEquals(draft.draftId, spoken.draftId)
        assertEquals("2026-09-05T15:30:00Z", spoken.speech?.capturedAt)
        assertEquals("Asia/Tokyo", spoken.speech?.timeZone)
        val restored = TodayPaneState.restore(TodayPaneState(captureDraft = spoken).save()).captureDraft
        assertEquals(spoken.speech, restored.speech)
        val legacy = TodayPaneState.restore(TodayPaneState(captureDraft = spoken).save().take(28)).captureDraft
        assertEquals(null, legacy.speech?.capturedAt)
        assertEquals(null, legacy.speech?.timeZone)
    }

    @Test
    fun overLimitSpeechAndEditsRemainIntactInDraft() {
        val original = "あ".repeat(490)
        val result = ShortSpeechRecognitionResult("い".repeat(30), MobileSpeechRecognitionMode.OnDevice, "ja-JP", null)
        val draft = MobileCaptureDraft.fresh(text = original).withSpeechResult(result, append = true)
        assertEquals("$original ${result.text}", draft.text)
        assertEquals(521, draft.withText(draft.text.replaceFirst("あ", "う")).text.length)
        assertEquals(draft.text, MobileCaptureDraft.fresh(text = draft.text).text)
    }

    @Test
    fun shortcutSpeechAppendsWithoutDiscardingExistingDraft() {
        val draft = MobileCaptureDraft.fresh(text = "牛乳を買う", projectId = "home")
        val result = ShortSpeechRecognitionResult("卵も買う", MobileSpeechRecognitionMode.OnDevice, "ja-JP", null)
        val appended = draft.withSpeechResult(result, append = true)
        assertEquals("牛乳を買う 卵も買う", appended.text)
        assertEquals(draft.draftId, appended.draftId)
        assertEquals("home", appended.projectId)
        assertEquals("卵も買う", draft.withSpeechResult(result).text)
        assertEquals("卵も買う", draft.withText("").withSpeechResult(result, append = true).text)
    }

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
            kind = MobileCaptureKind.Capture,
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
        assertEquals(MobileCaptureKind.Capture, recognized.kind)
        assertEquals(MobileCaptureSource.AndroidSpeech, recognized.source)
        assertEquals(MobileSpeechRecognitionMode.OnDevice, recognized.speech?.recognitionMode)
        assertEquals("ja-JP", recognized.speech?.language)
        assertEquals(0.82f, recognized.speech?.confidence)
        assertFalse(recognized.speech?.sourceAudioAvailable ?: true)
        assertNull(recognized.share)
    }

    @Test
    fun shareDraftKeepsOnlySafeMimeProvenance() {
        val draft = MobileCaptureDraft.fresh(
            text = "共有本文",
            source = MobileCaptureSource.ShareTarget,
            share = MobileShareProvenance("text/plain"),
            now = { Instant.parse("2026-08-23T00:00:00Z") },
            newId = { "share-draft" },
        )

        val provenance = draft.toTaskCreationProvenanceDto()

        assertEquals("share_target", provenance.reportedVia)
        assertEquals("2026-08-23T00:00:00Z", provenance.capturedAt)
        assertEquals("text/plain", provenance.sharedMimeType)
        assertNull(provenance.captureMethod)
        assertThrows(IllegalArgumentException::class.java) {
            MobileCaptureDraft.fresh(source = MobileCaptureSource.ShareTarget)
        }
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
