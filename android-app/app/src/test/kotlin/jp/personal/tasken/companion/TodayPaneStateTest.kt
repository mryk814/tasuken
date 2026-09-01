package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Test

class TodayPaneStateTest {
    @Test
    fun openingCaptureLeavesThemeOrInputAsTheUsersFirstChoice() {
        val state = TodayPaneState()
        state.openCapture(MobileCaptureSource.AndroidApp)
        assertEquals(false, state.captureInputFocusRequested)

        state.captureDraft = MobileCaptureDraft.fresh(text = "保留中のTask")
        state.openCapture(MobileCaptureSource.AndroidApp, replaceDraft = false)
        assertEquals("保留中のTask", state.captureDraft.text)
        assertEquals(false, state.captureInputFocusRequested)

        state.openCapture(MobileCaptureSource.AndroidApp, requestVoice = true)
        assertEquals(false, state.captureInputFocusRequested)
        assertEquals(true, state.captureVoiceStartRequested)

        state.openCapture(MobileCaptureSource.AndroidSpeech, requestVoice = true)
        assertEquals(false, state.captureInputFocusRequested)
        assertEquals(true, state.captureVoiceStartRequested)

        state.openCapture(
            MobileCaptureSource.ShareTarget,
            initialText = "共有された内容",
            sharedMimeType = "text/plain",
        )
        assertEquals(false, state.captureInputFocusRequested)
        assertEquals("共有された内容", state.captureDraft.text)
    }

    @Test
    fun selectionAndScrollRestoreAfterRecreation() {
        val before = TodayPaneState()
        before.selectedTaskId = "10000000-0000-4000-8000-000000000001"
        before.recordScroll(7, 32)
        before.captureDraft = MobileCaptureDraft.fresh(
            text = "折りたたみ後も残す",
            source = MobileCaptureSource.AndroidSpeech,
            kind = MobileCaptureKind.Capture,
            now = { java.time.Instant.parse("2026-08-23T00:00:00Z") },
            newId = { "draft-voice" },
        ).copy(
            projectId = "theme-research",
            speech = MobileSpeechProvenance(
                recognitionMode = MobileSpeechRecognitionMode.OnDevice,
                language = "ja-JP",
                confidence = 0.9f,
            ),
        )
        before.openCapture(
            source = MobileCaptureSource.AndroidSpeech,
            requestVoice = true,
            replaceDraft = false,
        )
        before.activeSection = AppSection.Ai
        before.taskSearch = "解析"
        before.taskFilter = TaskListFilter.Done
        before.recordTaskScroll(4, 18)
        before.recordAiScroll(2, 9)

        val restored = TodayPaneState.restore(before.save())

        assertEquals(before.selectedTaskId, restored.selectedTaskId)
        assertEquals(7, restored.listScrollIndex)
        assertEquals(32, restored.listScrollOffset)
        assertEquals("折りたたみ後も残す", restored.captureDraft.text)
        assertEquals("draft-voice", restored.captureDraft.draftId)
        assertEquals("theme-research", restored.captureDraft.projectId)
        assertEquals(MobileCaptureSource.AndroidSpeech, restored.captureDraft.source)
        assertEquals(MobileCaptureKind.Capture, restored.captureDraft.kind)
        assertEquals(MobileSpeechRecognitionMode.OnDevice, restored.captureDraft.speech?.recognitionMode)
        assertEquals("ja-JP", restored.captureDraft.speech?.language)
        assertEquals(0.9f, restored.captureDraft.speech?.confidence)
        assertEquals(true, restored.captureOpen)
        assertEquals(true, restored.captureVoiceStartRequested)
        assertEquals(false, restored.captureInputFocusRequested)
        assertEquals(AppSection.Ai, restored.activeSection)
        assertEquals("解析", restored.taskSearch)
        assertEquals(TaskListFilter.Done, restored.taskFilter)
        assertEquals(4, restored.taskListScrollIndex)
        assertEquals(18, restored.taskListScrollOffset)
        assertEquals(2, restored.aiListScrollIndex)
        assertEquals(9, restored.aiListScrollOffset)
    }

    @Test
    fun continueCaptureStartsDistinctDraftAndKeepsEntryDefaults() {
        val state = TodayPaneState(
            captureDraft = MobileCaptureDraft.fresh(
                text = "一件目",
                source = MobileCaptureSource.ShareTarget,
                projectId = "theme-research",
                share = MobileShareProvenance("text/plain"),
                newId = { "draft-first" },
            ),
            captureOpen = true,
        )

        state.continueCapture()

        assertEquals(true, state.captureOpen)
        assertEquals("", state.captureDraft.text)
        assertEquals(MobileCaptureSource.AndroidApp, state.captureDraft.source)
        assertEquals(null, state.captureDraft.share)
        assertEquals("theme-research", state.captureDraft.projectId)
        assertEquals(false, state.captureDraft.draftId == "draft-first")
        assertEquals(true, state.captureInputFocusRequested)

        val restored = TodayPaneState.restore(state.save())
        assertEquals(true, restored.captureInputFocusRequested)
        assertEquals(state.captureDraft.draftId, restored.captureDraft.draftId)
    }

    @Test
    fun shareMimeSurvivesProcessStateRecreation() {
        val before = TodayPaneState()
        before.openCapture(
            source = MobileCaptureSource.ShareTarget,
            initialText = "共有本文",
            sharedMimeType = "text/plain",
        )

        val restored = TodayPaneState.restore(before.save())

        assertEquals(MobileCaptureSource.ShareTarget, restored.captureDraft.source)
        assertEquals(MobileCaptureKind.Capture, restored.captureDraft.kind)
        assertEquals("text/plain", restored.captureDraft.share?.mimeType)
        assertEquals("共有本文", restored.captureDraft.text)
    }
}
