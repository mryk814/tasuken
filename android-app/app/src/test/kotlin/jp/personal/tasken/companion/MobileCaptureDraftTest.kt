package jp.personal.tasken.companion

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class MobileCaptureDraftTest {
    /** 音声入力は #808 で外した。更新前に音声で作った下書きの出どころは、画面の作り直しをまたいでも残る。 */
    @Test
    fun oldSpeechDraftKeepsItsDateBasisAcrossStateRestore() {
        val spoken = MobileCaptureDraft.fresh(
            text = "明日買う",
            source = MobileCaptureSource.AndroidSpeech,
            now = { Instant.parse("2026-09-01T00:00:00Z") },
        ).copy(
            speech = MobileSpeechProvenance(
                recognitionMode = MobileSpeechRecognitionMode.OnDevice,
                language = "ja-JP",
                capturedAt = "2026-09-05T15:30:00Z",
                timeZone = "Asia/Tokyo",
            ),
        )
        val restored = TodayPaneState.restore(TodayPaneState(captureDraft = spoken).save()).captureDraft
        assertEquals(spoken.speech, restored.speech)
        assertEquals(MobileCaptureSource.AndroidSpeech, restored.source)
        val legacy = TodayPaneState.restore(TodayPaneState(captureDraft = spoken).save().take(28)).captureDraft
        assertEquals(null, legacy.speech?.capturedAt)
        assertEquals(null, legacy.speech?.timeZone)
    }

    /**
     * 更新前に音声で作り端末に保存した下書き（保存形式の JSON）が、#808 の後も読めて、
     * 元の出どころ（captureMethod = android_speech）のまま送る命令になる。
     */
    @Test
    fun storedSpeechDraftFromBeforeVoiceRemovalLoadsAndSendsWithItsProvenance() {
        val stored = """
            {"schemaVersion":1,"savedAt":"2026-11-20T09:00:00Z","captureOpen":true,
            "draftId":"draft-voice","text":"牛乳を買う","kind":"task","projectId":null,"source":"android_speech",
            "speechRecognitionMode":"on_device","speechLanguage":"ja-JP","speechConfidence":0.82,
            "speechSourceAudioAvailable":false,"sharedMimeType":null,"createdAt":"2026-11-20T08:59:00Z",
            "organization":null,"additionalOrganizations":[],"originalText":null,
            "speechCapturedAt":"2026-11-20T08:59:30Z","speechTimeZone":"Asia/Tokyo","originalThemeId":null,
            "photoFileNames":[]}
        """.trimIndent()

        val draft = CaptureDraftJson.decodeFromString(StoredCaptureDraftSnapshot.serializer(), stored).toSnapshot().draft

        assertEquals("牛乳を買う", draft.text)
        assertEquals(MobileCaptureSource.AndroidSpeech, draft.source)
        assertEquals(
            MobileSpeechProvenance(
                recognitionMode = MobileSpeechRecognitionMode.OnDevice,
                language = "ja-JP",
                confidence = 0.82f,
                sourceAudioAvailable = false,
                capturedAt = "2026-11-20T08:59:30Z",
                timeZone = "Asia/Tokyo",
            ),
            draft.speech,
        )
        // 保存し直しても同じ形に戻る（読むだけでなく書き戻しても出どころが消えない）。
        assertEquals(
            stored.lines().joinToString(""),
            CaptureDraftJson.encodeToString(
                StoredCaptureDraftSnapshot.serializer(),
                StoredCaptureDraftSnapshot.from(MobileCaptureDraftSnapshot(draft, captureOpen = true), "2026-11-20T09:00:00Z"),
            ),
        )

        val provenance = draft.toTaskCreationProvenanceDto()
        assertEquals(
            MobileTaskCreationProvenanceDto(
                reportedVia = "android_speech",
                capturedAt = "2026-11-20T08:59:00Z",
                captureMethod = "android_speech",
                recognitionMode = "on_device",
                language = "ja-JP",
                confidence = 0.82f,
                sourceAudioAvailable = false,
            ),
            provenance,
        )
        val task = MobileCreateTaskEnvelopeDto(
            TASKEN_MOBILE_API_VERSION, TASKEN_MOBILE_SCHEMA_VERSION,
            "request-voice", "command-voice", "command-voice", "device-test", draft.createdAt,
            MobileCreateTaskCommandDto("CreateTask", MobileCreateTaskCandidateDto("task-voice", draft.text), provenance = provenance),
        )
        assertEquals(
            provenance,
            MobileTaskCommandContract.decodeCreateEnvelope(MobileTaskCommandContract.encode(task)).command.provenance,
        )
        val capture = MobileCreateCaptureEnvelopeDto(
            TASKEN_MOBILE_API_VERSION, TASKEN_MOBILE_SCHEMA_VERSION,
            "request-voice-capture", "command-voice-capture", "command-voice-capture", "device-test", draft.createdAt,
            MobileCreateCaptureCommandDto(
                "CreateCapture",
                MobileCreateCaptureCandidateDto("capture-voice", draft.text, null, draft.createdAt),
                provenance = draft.toCaptureCreationProvenanceDto(),
            ),
        )
        assertEquals(
            provenance,
            MobileCaptureCommandContract.decodeCreateEnvelope(MobileCaptureCommandContract.encode(capture)).command.provenance,
        )
    }

    @Test
    fun overLimitTextAndEditsRemainIntactInDraft() {
        val draft = MobileCaptureDraft.fresh(text = "あ".repeat(521))
        assertEquals(521, draft.withText(draft.text.replaceFirst("あ", "う")).text.length)
        assertEquals(draft.text, MobileCaptureDraft.fresh(text = draft.text).text)
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
}
